/**
 * GET /api/boards — board enumeration (BUILD_PLAN.md §Phase 1).
 * Adds the mock board to the list when ARDUFORGE_MOCK=1 so the UI has something
 * to connect to with no hardware attached.
 */
import { Router } from 'express';
import { discoverBoards, type BoardCandidate } from '@/boards/discovery.js';
import { MOCK_ENABLED, serialManager } from '@/serial/manager.js';
import { MOCK_PORT_PATH } from '@/serial/mockDriver.js';
import { asyncRoute } from '@/routes/asyncRoute.js';

export const boardsRouter: Router = Router();

const MOCK_BOARD: BoardCandidate = {
  port: MOCK_PORT_PATH,
  vid: null,
  pid: null,
  serialNumber: 'ARDUFORGE-MOCK',
  profile: null,
  fqbn: 'arduino:avr:uno',
  displayName: 'Mock board (ARDUFORGE_MOCK=1)',
  identifiedBy: 'profile-table',
  notes: 'Emulated in-process. Not real hardware — never upload to this.',
};

boardsRouter.get(
  '/boards',
  asyncRoute(async (_req, res) => {
    try {
      const boards = await discoverBoards();
      const all = MOCK_ENABLED ? [MOCK_BOARD, ...boards] : boards;
      res.json({ boards: all, portStatus: serialManager.status() });
    } catch (error: unknown) {
      res.status(503).json({
        boards: [],
        portStatus: serialManager.status(),
        error: error instanceof Error ? error.message : 'Board enumeration failed.',
      });
    }
  }),
);
