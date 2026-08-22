/**
 * WS /ws/serial — raw bidirectional bridge, always under a lease (§Phase 1).
 *
 * One socket owns at most one lease. A second browser tab opening the same port
 * QUEUES inside the SerialManager; it does not get a second handle. That is what
 * makes the two-tab gate pass instead of interleaving two readers on one device.
 */
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { serialManager } from '@/serial/manager.js';
import type { Lease } from '@/serial/types.js';
import { clientMessageSchema, type ServerMessage } from '@/ws/protocol.js';
import { rawDataToString } from '@/ws/rawData.js';

/** Serial can outrun a slow socket; drop rather than grow an unbounded buffer. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

class SerialSession {
  private readonly ownerId = randomUUID();
  private lease: Lease | null = null;
  private acquiring: AbortController | null = null;
  private unsubData: (() => void) | null = null;
  private unsubRevoked: (() => void) | null = null;

  constructor(private readonly socket: WebSocket) {}

  private send(message: ServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
    this.socket.send(JSON.stringify(message));
  }

  private sendStatus(state: 'idle' | 'queued' | 'open', queuePosition: number | null = null): void {
    this.send({
      t: 'status',
      state,
      port: this.lease?.port ?? null,
      baud: this.lease?.baud ?? null,
      queuePosition,
    });
  }

  async handle(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send({ t: 'error', message: 'Message was not valid JSON.' });
      return;
    }

    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.send({ t: 'error', message: `Invalid message: ${result.error.issues[0]?.message ?? 'unknown'}` });
      return;
    }

    const message = result.data;
    switch (message.t) {
      case 'ping':
        this.send({ t: 'pong', ts: Date.now() });
        return;
      case 'open':
        await this.open(message.port, message.baud);
        return;
      case 'write':
        await this.write(message.b64);
        return;
      case 'close':
        await this.close();
        return;
    }
  }

  private async open(port: string, baud: number): Promise<void> {
    await this.close();

    const controller = new AbortController();
    this.acquiring = controller;

    try {
      const lease = await serialManager.acquire(this.ownerId, 'raw', {
        port,
        baud,
        signal: controller.signal,
        onQueued: (position) => this.sendStatus('queued', position),
      });

      this.lease = lease;
      this.acquiring = null;

      this.unsubData = lease.onData((chunk) => {
        this.send({ t: 'data', b64: chunk.toString('base64'), ts: Date.now() });
      });

      this.unsubRevoked = lease.onRevoked((reason) => {
        this.lease = null;
        this.send({ t: 'revoked', reason });
        if (reason === 'device-lost') this.send({ t: 'device-lost', port });
        this.sendStatus('idle');
      });

      this.sendStatus('open');
    } catch (error: unknown) {
      this.acquiring = null;
      // An abort is a normal consequence of the client closing; not worth reporting.
      if (!controller.signal.aborted) {
        this.send({
          t: 'error',
          message: error instanceof Error ? error.message : 'Could not open the port.',
        });
      }
      this.sendStatus('idle');
    }
  }

  private async write(b64: string): Promise<void> {
    const lease = this.lease;
    if (lease === null || !lease.isValid()) {
      this.send({ t: 'error', message: 'Not connected. Open a port before writing.' });
      return;
    }
    try {
      await lease.write(Buffer.from(b64, 'base64'));
    } catch (error: unknown) {
      this.send({
        t: 'error',
        message: error instanceof Error ? error.message : 'Write failed.',
      });
    }
  }

  async close(): Promise<void> {
    if (this.acquiring !== null) {
      this.acquiring.abort();
      this.acquiring = null;
    }
    this.unsubData?.();
    this.unsubRevoked?.();
    this.unsubData = null;
    this.unsubRevoked = null;

    const lease = this.lease;
    this.lease = null;
    if (lease !== null) {
      await serialManager.release(lease.id);
    }
    this.sendStatus('idle');
  }
}

/** Upgrades are dispatched by routeUpgrades(), so this server takes no HTTP server itself. */
export function createSerialSocket(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (socket) => {
    const session = new SerialSession(socket);

    socket.on('message', (data) => {
      void session.handle(rawDataToString(data));
    });

    socket.on('close', () => {
      void session.close();
    });

    socket.on('error', (error) => {
      console.error('[ws] socket error:', error.message);
      void session.close();
    });
  });

  return wss;
}
