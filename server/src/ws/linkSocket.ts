/**
 * WS /ws/link — dashboard transport (BUILD_PLAN.md §Phase 6).
 *
 * One session per socket. Telemetry is forwarded as it arrives; the client is
 * responsible for not re-rendering React on every frame (§Phase 6 performance).
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { AwryLinkSession } from '@/link/session.js';
import { command } from '@/link/protocol.js';
import type { BoardFrame } from '@/link/protocol.js';
import { rawDataToString } from '@/ws/rawData.js';

const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('open'), port: z.string().min(1).max(256) }),
  z.object({ t: z.literal('close') }),
  z.object({ t: z.literal('telemetry'), intervalMs: z.number().int().min(20).max(10_000) }),
  z.object({ t: z.literal('stopTelemetry') }),
  z.object({ t: z.literal('setVar'), name: z.string().min(1).max(64), value: z.union([z.string().max(64), z.number()]) }),
  z.object({ t: z.literal('getVar'), name: z.string().min(1).max(64) }),
  z.object({ t: z.literal('digitalWrite'), pin: z.number().int().min(0).max(63), value: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ t: z.literal('analogWrite'), pin: z.number().int().min(0).max(63), value: z.number().int().min(0).max(255) }),
  z.object({ t: z.literal('digitalRead'), pin: z.number().int().min(0).max(63) }),
  z.object({ t: z.literal('analogRead'), pin: z.number().int().min(0).max(63) }),
  z.object({ t: z.literal('pinMode'), pin: z.number().int().min(0).max(63), mode: z.union([z.literal(0), z.literal(1), z.literal(2)]) }),
  z.object({ t: z.literal('ping') }),
]);

type ServerMessage =
  | { t: 'status'; connected: boolean; board: string | null; sketchHash: string | null }
  | { t: 'telemetry'; millis: number; values: Record<string, number>; at: number }
  | { t: 'log'; text: string }
  | { t: 'pinValue'; kind: 'digital' | 'analog'; pin: number; value: number }
  | { t: 'stale'; stale: boolean }
  | { t: 'revoked'; reason: string }
  | { t: 'error'; message: string }
  | { t: 'pong'; millis: number; at: number };

export function createLinkSocket(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket) => {
    const ownerId = randomUUID();

    const send = (message: ServerMessage): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      // Telemetry can outrun a slow socket; dropping is better than unbounded growth.
      if (socket.bufferedAmount > 1024 * 1024) return;
      socket.send(JSON.stringify(message));
    };

    const session = new AwryLinkSession({
      frame: (frame: BoardFrame) => {
        switch (frame.kind) {
          case 'telemetry':
            send({
              t: 'telemetry',
              millis: frame.millis,
              values: Object.fromEntries(frame.values),
              at: Date.now(),
            });
            break;
          case 'log':
            send({ t: 'log', text: frame.text });
            break;
          case 'error':
            send({ t: 'error', message: `${frame.code}: ${frame.detail}` });
            break;
          case 'digital':
          case 'analog':
            send({ t: 'pinValue', kind: frame.kind, pin: frame.pin, value: frame.value });
            break;
          case 'pong':
            send({ t: 'pong', millis: frame.millis, at: Date.now() });
            break;
          default:
            break;
        }
      },
      stale: (isStale) => send({ t: 'stale', stale: isStale }),
      revoked: (reason) => {
        send({ t: 'revoked', reason });
        send({ t: 'status', connected: false, board: null, sketchHash: null });
      },
    });

    socket.on('message', (raw) => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawDataToString(raw));
        } catch {
          send({ t: 'error', message: 'Message was not valid JSON.' });
          return;
        }

        const result = clientMessageSchema.safeParse(parsed);
        if (!result.success) {
          send({ t: 'error', message: result.error.issues[0]?.message ?? 'Invalid message.' });
          return;
        }

        const message = result.data;
        try {
          switch (message.t) {
            case 'open': {
              const info = await session.open(message.port, ownerId);
              send({ t: 'status', connected: true, board: info.board, sketchHash: info.sketchHash });
              break;
            }
            case 'close':
              await session.close();
              send({ t: 'status', connected: false, board: null, sketchHash: null });
              break;
            case 'telemetry':
              await session.startTelemetry(message.intervalMs);
              break;
            case 'stopTelemetry':
              await session.stopTelemetry();
              break;
            case 'setVar':
              await session.send(command.setVar(message.name, message.value));
              break;
            case 'getVar':
              await session.send(command.getVar(message.name));
              break;
            case 'digitalWrite':
              await session.send(command.digitalWrite(message.pin, message.value));
              break;
            case 'analogWrite':
              await session.send(command.analogWrite(message.pin, message.value));
              break;
            case 'digitalRead':
              await session.send(command.digitalRead(message.pin));
              break;
            case 'analogRead':
              await session.send(command.analogRead(message.pin));
              break;
            case 'pinMode':
              await session.send(command.pinMode(message.pin, message.mode));
              break;
            case 'ping':
              await session.send(command.ping());
              break;
          }
        } catch (error: unknown) {
          send({
            t: 'error',
            message: error instanceof Error ? error.message : 'Link command failed.',
          });
        }
      })();
    });

    socket.on('close', () => void session.close());
    socket.on('error', () => void session.close());
  });

  return wss;
}
