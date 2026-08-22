/**
 * Line buffer for the serial monitor.
 *
 * Lives outside React and notifies on requestAnimationFrame, so a board
 * spraying data cannot drive one render per chunk (§Phase 6 performance rule,
 * applied here from the start). The buffer is hard-capped with FIFO eviction —
 * §Phase 8 forbids unbounded arrays anywhere in the app.
 */

export interface MonitorLine {
  readonly id: number;
  readonly ts: number;
  readonly bytes: Uint8Array;
}

const MAX_LINES = 5_000;
/**
 * Binary protocols never send a newline — Firmata's version report is three
 * bytes with no terminator. Without this, such data would sit in the partial
 * buffer forever and the monitor would look dead.
 */
const PARTIAL_FLUSH_MS = 100;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export class MonitorBuffer {
  private lines: MonitorLine[] = [];
  private partial: number[] = [];
  private partialTs = 0;
  private nextId = 1;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private droppedWhilePaused = 0;
  private readonly listeners = new Set<() => void>();

  paused = false;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const listener of this.listeners) listener();
    });
  }

  private pushLine(bytes: number[], ts: number): void {
    this.lines.push({ id: this.nextId, ts, bytes: Uint8Array.from(bytes) });
    this.nextId += 1;
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
  }

  append(chunk: Uint8Array, ts: number): void {
    if (this.paused) {
      this.droppedWhilePaused += chunk.length;
      this.notify();
      return;
    }

    for (const byte of chunk) {
      if (byte === NEWLINE) {
        this.pushLine(this.partial, this.partialTs === 0 ? ts : this.partialTs);
        this.partial = [];
        this.partialTs = 0;
        continue;
      }
      if (byte === CARRIAGE_RETURN) continue; // normalise CRLF
      if (this.partial.length === 0) this.partialTs = ts;
      this.partial.push(byte);
    }

    this.schedulePartialFlush();
    this.notify();
  }

  private schedulePartialFlush(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    if (this.partial.length === 0) {
      this.flushTimer = null;
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.partial.length === 0) return;
      this.pushLine(this.partial, this.partialTs);
      this.partial = [];
      this.partialTs = 0;
      this.notify();
    }, PARTIAL_FLUSH_MS);
  }

  snapshot(): readonly MonitorLine[] {
    return this.lines;
  }

  get droppedCount(): number {
    return this.droppedWhilePaused;
  }

  clear(): void {
    this.lines = [];
    this.partial = [];
    this.partialTs = 0;
    this.droppedWhilePaused = 0;
    this.notify();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.droppedWhilePaused = 0;
    this.notify();
  }
}

// ── rendering helpers ────────────────────────────────────────────────────────

const decoder = new TextDecoder('utf-8', { fatal: false });

/** True when a line contains bytes that would render as mojibake. */
export function isBinary(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x09) continue; // tab
    if (byte < 0x20 || byte === 0x7f) return true;
  }
  return false;
}

export function toText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export const LINE_ENDINGS = {
  none: '',
  lf: '\n',
  cr: '\r',
  crlf: '\r\n',
} as const;

export type LineEnding = keyof typeof LINE_ENDINGS;

export const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000,
  1000000, 2000000,
] as const;
