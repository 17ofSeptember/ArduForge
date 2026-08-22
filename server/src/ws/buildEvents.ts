/**
 * WS /ws/build — compile and upload progress (BUILD_PLAN.md §Phase 2).
 *
 * Build progress is not per-client state: it describes what the one board is
 * doing, so events broadcast to every listener. Kept separate from /ws/serial
 * so a preempted serial socket does not take the build log down with it.
 */
import { WebSocketServer, WebSocket } from 'ws';

export type BuildPhase = 'compile' | 'upload';

export type BuildEvent =
  | { t: 'build:start'; buildId: string; phase: BuildPhase }
  | { t: 'build:log'; buildId: string; stream: 'out' | 'err'; line: string }
  | { t: 'build:step'; buildId: string; phase: BuildPhase; message: string }
  | { t: 'build:done'; buildId: string; phase: BuildPhase; ok: boolean; message: string | null };

const listeners = new Set<WebSocket>();

export function emitBuildEvent(event: BuildEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of listeners) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

/** Upgrades are dispatched by routeUpgrades(), so this server takes no HTTP server itself. */
export function createBuildSocket(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket) => {
    listeners.add(socket);
    socket.on('close', () => listeners.delete(socket));
    socket.on('error', () => listeners.delete(socket));
  });

  return wss;
}
