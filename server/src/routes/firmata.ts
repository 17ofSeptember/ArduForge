/**
 * POST /api/firmata/upload — one-click StandardFirmata (BUILD_PLAN.md §Phase 6, Mode A).
 *
 * The plan suggests bundling a prebuilt hex to avoid a compile round-trip. This
 * builds it from the installed Firmata library instead and caches the result:
 * a checked-in binary would be unverifiable and could drift from the board
 * profile, whereas the cache buys back the round-trip after the first run.
 */
import { Router } from 'express';
import { z } from 'zod';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { getDirectories, installLibrary, listLibraries } from '@/cli/arduinoCli.js';
import { serialManager } from '@/serial/manager.js';
import { emitBuildEvent } from '@/ws/buildEvents.js';
import { asyncRoute } from '@/routes/asyncRoute.js';

export const firmataRouter: Router = Router();

const FIRMATA_LIBRARY = 'Firmata';
const CACHE_ROOT = join(homedir(), '.arduforge', 'firmata-build');

const EXAMPLE_TAIL = ['libraries', 'Firmata', 'examples', 'StandardFirmata'] as const;

/**
 * Last-resort locations, used only when `arduino-cli config get directories`
 * fails. Every one of these is the platform default that the CLI itself would
 * report, so this is a mirror of its behaviour rather than a second source of
 * truth.
 */
function defaultDirs(platform: NodeJS.Platform = process.platform): string[] {
  const home = homedir();
  switch (platform) {
    case 'win32': {
      const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
      return [join(home, 'Documents', 'Arduino'), join(localAppData, 'Arduino15')];
    }
    case 'darwin':
      return [join(home, 'Documents', 'Arduino'), join(home, 'Library', 'Arduino15')];
    default:
      // Linux and the BSDs. The sketchbook is ~/Arduino, not ~/Documents/Arduino.
      return [join(home, 'Arduino'), join(home, '.arduino15')];
  }
}

/**
 * Where the Firmata library's bundled examples live.
 *
 * The data and sketchbook directories are different on all three platforms and
 * the user can relocate either, so the toolchain is asked rather than guessed.
 * Hardcoded paths only run if that call fails.
 */
async function findSketch(): Promise<string | null> {
  const dirs = await getDirectories();
  const roots =
    dirs === null
      ? defaultDirs()
      : [dirs.user, dirs.data].filter((dir) => dir !== '');

  for (const root of roots) {
    const candidate = join(root, ...EXAMPLE_TAIL);
    try {
      await access(join(candidate, 'StandardFirmata.ino'), constants.R_OK);
      return candidate;
    } catch {
      // try the next location
    }
  }
  return null;
}

async function ensureLibrary(): Promise<void> {
  const installed = await listLibraries();
  const has = installed.some((library) => library.name.toLowerCase() === 'firmata');
  if (!has) await installLibrary(FIRMATA_LIBRARY);
}

const schema = z.object({
  port: z.string().min(1).max(256),
  fqbn: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/)
    .default('arduino:avr:uno'),
});

firmataRouter.post(
  '/firmata/upload',
  asyncRoute(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }
    const { port, fqbn } = parsed.data;
    const buildId = 'standard-firmata';

    emitBuildEvent({ t: 'build:start', buildId, phase: 'compile' });

    try {
      await ensureLibrary();
      const sketch = await findSketch();
      if (sketch === null) {
        throw new Error(
          'StandardFirmata was not found. Install the Firmata library, then try again.',
        );
      }

      const outputDir = join(CACHE_ROOT, fqbn.replace(/[^A-Za-z0-9]/g, '_'));
      await mkdir(outputDir, { recursive: true });

      emitBuildEvent({
        t: 'build:step',
        buildId,
        phase: 'compile',
        message: 'Building StandardFirmata…',
      });

      // --output-dir doubles as the cache: arduino-cli reuses its own build
      // cache, so repeat runs are fast without us managing hex files by hand.
      const compile = await execa(
        'arduino-cli',
        ['compile', '--fqbn', fqbn, '--output-dir', outputDir, '--format', 'json', sketch],
        { timeout: 300_000, reject: false },
      );

      if (compile.exitCode !== 0) {
        throw new Error('StandardFirmata failed to compile. Is the arduino:avr core installed?');
      }

      emitBuildEvent({ t: 'build:done', buildId, phase: 'compile', ok: true, message: null });
      emitBuildEvent({ t: 'build:start', buildId, phase: 'upload' });

      // §3.5: the upload preempts whatever holds the port and awaits its teardown.
      const result = await serialManager.withExclusive(port, async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return execa(
          'arduino-cli',
          ['upload', '-p', port, '--fqbn', fqbn, '--input-dir', outputDir],
          { timeout: 120_000, reject: false },
        );
      });

      const ok = result.exitCode === 0;
      emitBuildEvent({
        t: 'build:done',
        buildId,
        phase: 'upload',
        ok,
        message: ok ? null : 'avrdude reported a failure.',
      });

      if (!ok) {
        res.status(500).json({ ok: false, error: 'Uploading StandardFirmata failed.' });
        return;
      }

      // Give the bootloader time to hand over before anyone connects.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      res.json({ ok: true, baud: 57600 });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'StandardFirmata upload failed.';
      emitBuildEvent({ t: 'build:done', buildId, phase: 'upload', ok: false, message });
      res.status(500).json({ ok: false, error: message });
    }
  }),
);
