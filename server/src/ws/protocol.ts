/**
 * /ws/serial wire protocol.
 *
 * Payloads are base64, not strings: raw serial is binary. Firmata's version
 * report (0xF9 0x02 0x05) is not valid UTF-8, and the Phase 1 gate requires
 * seeing exactly those bytes. Anything that stringifies early corrupts them.
 */
import { z } from 'zod';
import type { RevokeReason } from '@/serial/types.js';

/** Every inbound payload is validated at the boundary (§2). */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('open'),
    port: z.string().min(1).max(256),
    baud: z.number().int().positive().max(2_000_000),
  }),
  z.object({
    t: z.literal('write'),
    b64: z.string().max(64 * 1024),
  }),
  z.object({ t: z.literal('close') }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ConnectionState = 'idle' | 'queued' | 'open';

export type ServerMessage =
  | { t: 'status'; state: ConnectionState; port: string | null; baud: number | null; queuePosition: number | null }
  | { t: 'data'; b64: string; ts: number }
  | { t: 'revoked'; reason: RevokeReason }
  | { t: 'device-lost'; port: string }
  | { t: 'error'; message: string }
  | { t: 'pong'; ts: number };
