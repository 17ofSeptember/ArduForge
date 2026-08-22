/**
 * GET /api/health — Phase 0 gate endpoint (BUILD_PLAN.md §Phase 0).
 *
 * Reports arduino-cli version, installed cores, and detected boards. Never throws:
 * a missing toolchain is a reported state, not a 500, because the frontend has to
 * be able to render "arduino-cli not installed" as a first-class empty state.
 */
import { Router } from 'express';
import {
  getVersion,
  listCores,
  ArduinoCliMissingError,
  type CliVersion,
  type InstalledCore,
} from '@/cli/arduinoCli.js';
import { discoverBoards, type BoardCandidate } from '@/boards/discovery.js';
import { asyncRoute } from '@/routes/asyncRoute.js';

export const REQUIRED_CORE = 'arduino:avr';
const REQUIRED_NODE_MAJOR = 22;

export interface HealthResponse {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly node: {
    readonly version: string;
    readonly ok: boolean;
  };
  readonly arduinoCli:
    | { readonly installed: true; readonly version: CliVersion }
    | { readonly installed: false; readonly error: string };
  readonly cores: readonly InstalledCore[];
  readonly requiredCore: {
    readonly id: string;
    readonly installed: boolean;
    readonly version: string | null;
  };
  readonly boards: readonly BoardCandidate[];
  /** Non-fatal problems worth surfacing in the UI. */
  readonly warnings: readonly string[];
}

export const healthRouter: Router = Router();

healthRouter.get(
  '/health',
  asyncRoute(async (_req, res) => {
    const warnings: string[] = [];
    const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
    const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= REQUIRED_NODE_MAJOR;
    if (!nodeOk) {
      warnings.push(
        `Node ${process.versions.node} is older than the required v${REQUIRED_NODE_MAJOR}.`,
      );
    }

    let version: CliVersion | null = null;
    let cliError: string | null = null;
    try {
      version = await getVersion();
      if (!version.supported) {
        warnings.push(
          `arduino-cli ${version.version} has not been verified with ArduForge (expected 1.x).`,
        );
      }
    } catch (error: unknown) {
      cliError =
        error instanceof ArduinoCliMissingError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'arduino-cli failed for an unknown reason.';
    }

    let cores: InstalledCore[] = [];
    let boards: BoardCandidate[] = [];
    if (version !== null) {
      try {
        cores = await listCores();
      } catch (error: unknown) {
        warnings.push(
          `Could not list cores: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      try {
        boards = await discoverBoards();
      } catch (error: unknown) {
        warnings.push(
          `Could not enumerate boards: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    const avr = cores.find((core) => core.id === REQUIRED_CORE) ?? null;
    const avrInstalled = avr !== null && avr.installedVersion !== null;
    if (version !== null && !avrInstalled) {
      warnings.push(
        `The ${REQUIRED_CORE} core is not installed. Run \`arduino-cli core install ${REQUIRED_CORE}\`.`,
      );
    }

    for (const board of boards) {
      if (board.identifiedBy === 'profile-table') {
        warnings.push(
          `${board.port} was identified as "${board.displayName}" from ArduForge's VID/PID table, ` +
            `not by arduino-cli. Confirm the board type before uploading.`,
        );
      }
      if (board.identifiedBy === 'unidentified') {
        warnings.push(
          `${board.port} (VID ${board.vid ?? '?'} PID ${board.pid ?? '?'}) is not recognised. ` +
            `Select a board type manually.`,
        );
      }
    }

    const payload: HealthResponse = {
      ok: nodeOk && version !== null && avrInstalled,
      checkedAt: new Date().toISOString(),
      node: { version: process.versions.node, ok: nodeOk },
      arduinoCli:
        version !== null
          ? { installed: true, version }
          : { installed: false, error: cliError ?? 'arduino-cli is unavailable.' },
      cores,
      requiredCore: {
        id: REQUIRED_CORE,
        installed: avrInstalled,
        version: avr?.installedVersion ?? null,
      },
      boards,
      warnings,
    };

    res.json(payload);
  }),
);
