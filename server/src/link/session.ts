/**
 * AwryLink session: owns a lease, speaks the protocol, and reports staleness.
 * BUILD_PLAN.md §Phase 6 (Mode B), §3.5 (upload sequencing), §3.7 (watchdog).
 */
import { serialManager } from '@/serial/manager.js';
import type { Lease, RevokeReason } from '@/serial/types.js';
import { command, parseFrame, MIN_TELEMETRY_MS, type BoardFrame } from '@/link/protocol.js';
import { Watchdog } from '@/link/watchdog.js';

const HANDSHAKE_ATTEMPTS = 3;
const HANDSHAKE_GAP_MS = 500;

export interface SessionEvents {
  frame(frame: BoardFrame): void;
  /** Link went quiet for longer than the watchdog allows. */
  stale(isStale: boolean): void;
  revoked(reason: RevokeReason): void;
}

export class AwryLinkSession {
  private lease: Lease | null = null;
  private carry = '';
  private telemetryMs = 0;
  private handshake: { board: string; sketchHash: string } | null = null;
  private readonly watchdog: Watchdog;

  constructor(private readonly events: SessionEvents) {
    this.watchdog = new Watchdog((stale) => this.events.stale(stale));
  }

  get connected(): boolean {
    return this.lease !== null && this.lease.isValid();
  }

  get info(): { board: string; sketchHash: string } | null {
    return this.handshake;
  }

  async open(port: string, ownerId: string): Promise<{ board: string; sketchHash: string }> {
    await this.close();

    const lease = await serialManager.acquire(ownerId, 'awrylink', { port, baud: 115200 });
    this.lease = lease;
    this.carry = '';

    lease.onData((chunk) => this.ingest(chunk));
    lease.onRevoked((reason) => {
      this.lease = null;
      this.watchdog.stop();
      this.events.revoked(reason);
    });

    // §3.5 step 9: handshake with retries. A board that just reset is still in
    // its bootloader for the first attempt or two.
    for (let attempt = 0; attempt < HANDSHAKE_ATTEMPTS; attempt += 1) {
      const reply = await this.tryHandshake();
      if (reply !== null) {
        this.handshake = reply;
        return reply;
      }
    }

    await this.close();
    throw new Error(
      'The board did not answer the AwryLink handshake. Is a sketch with exposed variables running on it?',
    );
  }

  private tryHandshake(): Promise<{ board: string; sketchHash: string } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingHandshake = null;
        resolve(null);
      }, HANDSHAKE_GAP_MS);

      this.pendingHandshake = (reply) => {
        clearTimeout(timer);
        this.pendingHandshake = null;
        resolve(reply);
      };

      void this.write(command.handshake());
    });
  }

  private pendingHandshake: ((reply: { board: string; sketchHash: string }) => void) | null = null;

  private ingest(chunk: Buffer): void {
    this.carry += chunk.toString('utf8');

    let newline = this.carry.indexOf('\n');
    while (newline !== -1) {
      const line = this.carry.slice(0, newline);
      this.carry = this.carry.slice(newline + 1);
      newline = this.carry.indexOf('\n');

      if (line.trim() === '') continue;
      const frame = parseFrame(line);

      this.watchdog.sawFrame();

      if (frame.kind === 'handshake' && this.pendingHandshake !== null) {
        this.pendingHandshake({ board: frame.board, sketchHash: frame.sketchHash });
      }
      this.events.frame(frame);
    }

    // A board spewing without newlines must not grow this without bound.
    if (this.carry.length > 4096) this.carry = '';
  }

  private async write(text: string): Promise<void> {
    const lease = this.lease;
    if (lease === null || !lease.isValid()) {
      throw new Error('Not connected to the board.');
    }
    await lease.write(Buffer.from(text, 'ascii'));
  }

  async send(text: string): Promise<void> {
    await this.write(text);
  }

  async startTelemetry(intervalMs: number): Promise<void> {
    this.telemetryMs = Math.max(MIN_TELEMETRY_MS, Math.round(intervalMs));
    await this.write(command.startTelemetry(this.telemetryMs));
    this.watchdog.start(this.telemetryMs);
  }

  async stopTelemetry(): Promise<void> {
    this.watchdog.stop();
    this.telemetryMs = 0;
    if (this.connected) await this.write(command.stopTelemetry());
  }

  async close(): Promise<void> {
    this.watchdog.stop();
    this.pendingHandshake = null;
    const lease = this.lease;
    this.lease = null;
    this.handshake = null;
    if (lease !== null) {
      // Best effort: the board may already be gone.
      try {
        if (lease.isValid()) await lease.write(Buffer.from(command.stopTelemetry(), 'ascii'));
      } catch {
        // ignore
      }
      await serialManager.release(lease.id);
    }
  }
}
