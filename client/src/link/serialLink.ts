/**
 * /ws/serial client. Connection mechanics live in createSocketClient (§3.4).
 */
import { createSocketClient, type SocketPhase } from '@/link/socketClient';

export type { SocketPhase };

export type RevokeReason = 'released' | 'preempted' | 'device-lost' | 'shutdown';
export type ConnectionState = 'idle' | 'queued' | 'open';

export type ServerMessage =
  | {
      t: 'status';
      state: ConnectionState;
      port: string | null;
      baud: number | null;
      queuePosition: number | null;
    }
  | { t: 'data'; b64: string; ts: number }
  | { t: 'revoked'; reason: RevokeReason }
  | { t: 'device-lost'; port: string }
  | { t: 'error'; message: string }
  | { t: 'pong'; ts: number };

export type ClientMessage =
  | { t: 'open'; port: string; baud: number }
  | { t: 'write'; b64: string }
  | { t: 'close' }
  | { t: 'ping' };

export const serialLink = createSocketClient<ServerMessage, ClientMessage>('/ws/serial');

if (import.meta.hot) {
  import.meta.hot.dispose(() => serialLink.destroy());
}

// ── payload helpers ──────────────────────────────────────────────────────────

export function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
