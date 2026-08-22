/**
 * WS /ws/firmata — pin-level control for Mode A (BUILD_PLAN.md §Phase 6).
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { FirmataSession, type PinInfo } from '@/firmata/session.js';
import { rawDataToString } from '@/ws/rawData.js';

const PIN_MODES = ['input', 'output', 'analog', 'pwm', 'servo', 'pullup'] as const;

const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('open'), port: z.string().min(1).max(256) }),
  z.object({ t: z.literal('close') }),
  z.object({ t: z.literal('pinMode'), pin: z.number().int().min(0).max(127), mode: z.enum(PIN_MODES) }),
  z.object({ t: z.literal('digitalWrite'), pin: z.number().int().min(0).max(127), value: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ t: z.literal('analogWrite'), pin: z.number().int().min(0).max(127), value: z.number().int().min(0).max(255) }),
  z.object({ t: z.literal('servoWrite'), pin: z.number().int().min(0).max(127), angle: z.number().int().min(0).max(180) }),
  z.object({ t: z.literal('sampling'), intervalMs: z.number().int().min(10).max(10_000) }),
  z.object({ t: z.literal('pins') }),
]);

type ServerMessage =
  | { t: 'status'; connected: boolean; firmware: string | null; pins: readonly PinInfo[] }
  | { t: 'pinValue'; pin: number; value: number }
  | { t: 'revoked'; reason: string }
  | { t: 'error'; message: string };

export function createFirmataSocket(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket) => {
    const ownerId = randomUUID();

    const send = (message: ServerMessage): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 1024 * 1024) return;
      socket.send(JSON.stringify(message));
    };

    const session = new FirmataSession({
      ready: (info) => send({ t: 'status', connected: true, firmware: info.firmware, pins: info.pins }),
      pinValue: (pin, value) => send({ t: 'pinValue', pin, value }),
      revoked: (reason) => {
        send({ t: 'revoked', reason });
        send({ t: 'status', connected: false, firmware: null, pins: [] });
      },
      error: (message) => send({ t: 'error', message }),
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
            case 'open':
              await session.open(message.port, ownerId);
              break;
            case 'close':
              await session.close();
              send({ t: 'status', connected: false, firmware: null, pins: [] });
              break;
            case 'pinMode':
              session.setMode(message.pin, message.mode);
              break;
            case 'digitalWrite':
              session.digitalWrite(message.pin, message.value);
              break;
            case 'analogWrite':
              session.analogWrite(message.pin, message.value);
              break;
            case 'servoWrite':
              session.servoWrite(message.pin, message.angle);
              break;
            case 'sampling':
              session.setSamplingInterval(message.intervalMs);
              break;
            case 'pins':
              send({ t: 'status', connected: session.connected, firmware: null, pins: session.describePins() });
              break;
          }
        } catch (error: unknown) {
          send({
            t: 'error',
            message: error instanceof Error ? error.message : 'Firmata command failed.',
          });
        }
      })();
    });

    socket.on('close', () => void session.close());
    socket.on('error', () => void session.close());
  });

  return wss;
}
