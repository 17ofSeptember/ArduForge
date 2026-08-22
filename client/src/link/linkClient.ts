/**
 * /ws/link client — the dashboard's transport (BUILD_PLAN.md §Phase 6).
 * Connection mechanics are shared with the other channels via createSocketClient (§3.4).
 */
import { createSocketClient, type SocketPhase } from '@/link/socketClient';

export type { SocketPhase };

export type LinkMessage =
  | { t: 'status'; connected: boolean; board: string | null; sketchHash: string | null }
  | { t: 'telemetry'; millis: number; values: Record<string, number>; at: number }
  | { t: 'log'; text: string }
  | { t: 'pinValue'; kind: 'digital' | 'analog'; pin: number; value: number }
  | { t: 'stale'; stale: boolean }
  | { t: 'revoked'; reason: string }
  | { t: 'error'; message: string }
  | { t: 'pong'; millis: number; at: number };

export type LinkCommand =
  | { t: 'open'; port: string }
  | { t: 'close' }
  | { t: 'telemetry'; intervalMs: number }
  | { t: 'stopTelemetry' }
  | { t: 'setVar'; name: string; value: string | number }
  | { t: 'getVar'; name: string }
  | { t: 'digitalWrite'; pin: number; value: 0 | 1 }
  | { t: 'analogWrite'; pin: number; value: number }
  | { t: 'digitalRead'; pin: number }
  | { t: 'analogRead'; pin: number }
  | { t: 'pinMode'; pin: number; mode: 0 | 1 | 2 }
  | { t: 'ping' };

export const linkClient = createSocketClient<LinkMessage, LinkCommand>('/ws/link');

if (import.meta.hot) {
  import.meta.hot.dispose(() => linkClient.destroy());
}
