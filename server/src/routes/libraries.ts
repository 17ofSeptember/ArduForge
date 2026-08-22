/**
 * Library management (BUILD_PLAN.md §Phase 5).
 * On Verify the client sends the libraries its graph needs; anything missing is
 * offered for one-click install.
 */
import { Router } from 'express';
import { z } from 'zod';
import { installLibrary, listLibraries } from '@/cli/arduinoCli.js';
import { asyncRoute } from '@/routes/asyncRoute.js';

export const librariesRouter: Router = Router();

/** arduino-cli installs can pull a lot down, so this gets its own budget. */
const INSTALL_TIMEOUT_NOTE = 'Installing a library can take a minute on a slow connection.';

librariesRouter.get(
  '/libraries',
  asyncRoute(async (_req, res) => {
    try {
      res.json({ libraries: await listLibraries() });
    } catch (error: unknown) {
      res.status(503).json({
        libraries: [],
        error: error instanceof Error ? error.message : 'Could not list libraries.',
      });
    }
  }),
);

const checkSchema = z.object({
  required: z.array(z.string().min(1).max(128)).max(64).default([]),
});

librariesRouter.post(
  '/libraries/check',
  asyncRoute(async (req, res) => {
    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }

    try {
      const installed = await listLibraries();
      // arduino-cli's index names and the names in node definitions differ in
      // punctuation often enough that an exact match is too strict.
      const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const have = new Set(installed.map((library) => normalise(library.name)));

      const missing = parsed.data.required.filter((name) => !have.has(normalise(name))).sort();
      res.json({ missing, installed });
    } catch (error: unknown) {
      res.status(503).json({
        missing: [],
        installed: [],
        error: error instanceof Error ? error.message : 'Could not check libraries.',
      });
    }
  }),
);

const installSchema = z.object({ name: z.string().min(1).max(128) });

librariesRouter.post(
  '/libraries/install',
  asyncRoute(async (req, res) => {
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }

    try {
      await installLibrary(parsed.data.name);
      res.json({ ok: true, name: parsed.data.name });
    } catch (error: unknown) {
      res.status(500).json({
        ok: false,
        error: `${error instanceof Error ? error.message : 'Install failed.'} ${INSTALL_TIMEOUT_NOTE}`,
      });
    }
  }),
);
