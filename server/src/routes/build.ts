/**
 * POST /api/compile and POST /api/upload (BUILD_PLAN.md §Phase 2).
 * Upload follows the ordering rules in §3.5.
 */
import { Router } from 'express';
import { z } from 'zod';
import { buildStore, validateFileName } from '@/build/store.js';
import { compileSketch, uploadBuild } from '@/cli/compile.js';
import { serialManager } from '@/serial/manager.js';
import { emitBuildEvent } from '@/ws/buildEvents.js';
import { asyncRoute } from '@/routes/asyncRoute.js';

export const buildRouter: Router = Router();

/** Time for the OS to actually surrender the descriptor after close (§3.5 step 4). */
const SETTLE_MS = 250;
/** Bootloader handoff plus sketch start (§3.5 step 7). */
const BOOTLOADER_HANDOFF_MS = 2_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const compileSchema = z.object({
  files: z
    .array(z.object({ name: z.string().min(1).max(64), content: z.string().max(1_000_000) }))
    .min(1)
    .max(32),
  fqbn: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/, 'FQBN contains invalid characters.'),
  libraries: z.array(z.string().min(1).max(128)).max(32).default([]),
});

buildRouter.post(
  '/compile',
  asyncRoute(async (req, res) => {
    const parsed = compileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }

    const { files, fqbn, libraries } = parsed.data;
    for (const file of files) {
      const problem = validateFileName(file.name);
      if (problem !== null) {
        res.status(400).json({ ok: false, error: problem });
        return;
      }
    }

    try {
      const build = await buildStore.create(files, fqbn);
      emitBuildEvent({ t: 'build:start', buildId: build.id, phase: 'compile' });

      const result = await compileSketch(build, libraries, (stream, line) =>
        emitBuildEvent({ t: 'build:log', buildId: build.id, stream, line }),
      );

      emitBuildEvent({
        t: 'build:done',
        buildId: build.id,
        phase: 'compile',
        ok: result.ok,
        message: result.error,
      });

      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Compile failed.',
      });
    }
  }),
);

const uploadSchema = z.object({
  buildId: z.string().uuid(),
  port: z.string().min(1).max(256),
});

buildRouter.post(
  '/upload',
  asyncRoute(async (req, res) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }

    const { buildId, port } = parsed.data;
    const build = buildStore.get(buildId);
    if (build === null) {
      res.status(404).json({ ok: false, error: 'Unknown build id. Compile again.' });
      return;
    }
    if (!build.compiled) {
      res.status(409).json({ ok: false, error: 'That build did not compile successfully.' });
      return;
    }

    emitBuildEvent({ t: 'build:start', buildId, phase: 'upload' });

    try {
      // withExclusive preempts any live lease and awaits its full teardown before
      // the body runs — §3.5 steps 3 and 6. Never run avrdude outside this.
      const result = await serialManager.withExclusive(port, async () => {
        emitBuildEvent({
          t: 'build:step',
          buildId,
          phase: 'upload',
          message: 'Serial released. Waiting for the port to settle…',
        });
        await delay(SETTLE_MS);

        return uploadBuild(build, port, (stream, line) =>
          emitBuildEvent({ t: 'build:log', buildId, stream, line }),
        );
      });

      if (result.ok) {
        emitBuildEvent({
          t: 'build:step',
          buildId,
          phase: 'upload',
          message: 'Waiting for bootloader handoff and sketch start…',
        });
        await delay(BOOTLOADER_HANDOFF_MS);
      }

      emitBuildEvent({
        t: 'build:done',
        buildId,
        phase: 'upload',
        ok: result.ok,
        message: result.error,
      });

      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed.';
      emitBuildEvent({ t: 'build:done', buildId, phase: 'upload', ok: false, message });
      // §3.5: a failure returns to a clean state, never a half-open one.
      res.status(500).json({ ok: false, error: message });
    }
  }),
);
