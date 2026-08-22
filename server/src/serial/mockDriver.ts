/**
 * In-process fake board, enabled only by ARDUFORGE_MOCK=1 (BUILD_PLAN.md §Phase 1).
 *
 * This exists so the editor, monitor, and tests can run with nothing plugged in.
 * It is NOT a hardware simulator and must never be reachable from a production
 * path (§6). If something fails against real hardware, fix the real path — do
 * not teach this file to fake a success.
 */
import { type PortDriver, type PortDriverEvents } from '@/serial/types.js';

export const MOCK_PORT_PATH = '/dev/cu.arduforge-mock';

type ListenerMap = { [E in keyof PortDriverEvents]: PortDriverEvents[E][] };

export class MockPortDriver implements PortDriver {
  readonly path: string;
  private open_ = false;
  private baud = 0;
  private tick: NodeJS.Timeout | null = null;
  private counter = 0;
  private rxLine = '';
  private readonly listeners: ListenerMap = { data: [], error: [], close: [] };

  constructor(path: string = MOCK_PORT_PATH) {
    this.path = path;
  }

  on<E extends keyof PortDriverEvents>(event: E, listener: PortDriverEvents[E]): void {
    this.listeners[event].push(listener);
  }

  removeAllListeners(): void {
    this.listeners.data = [];
    this.listeners.error = [];
    this.listeners.close = [];
  }

  private emit(chunk: Buffer): void {
    for (const listener of this.listeners.data) listener(chunk);
  }

  private say(text: string): void {
    this.emit(Buffer.from(`${text}\r\n`, 'utf8'));
  }

  isOpen(): boolean {
    return this.open_;
  }

  async open(baud: number): Promise<void> {
    if (this.open_) return;
    // Opening a real Uno toggles DTR and resets the sketch; the banner delay
    // mimics that bootloader pause so UI timing assumptions get exercised.
    await new Promise((resolve) => setTimeout(resolve, 120));
    this.open_ = true;
    this.baud = baud;
    this.counter = 0;
    this.rxLine = '';

    // Deferred: a real board sends its first bytes after the host has finished
    // opening and subscribed. Emitting synchronously here would fire before the
    // manager attaches its data listener, and the bytes would be dropped.
    setTimeout(() => {
      if (!this.open_) return;
      if (baud === 57600) {
        // StandardFirmata's version report: 0xF9 major minor. Lets the monitor's
        // hex view be developed without flashing a board.
        this.emit(Buffer.from([0xf9, 0x02, 0x05]));
      } else {
        this.say(`ArduForge mock board ready @ ${baud} baud`);
        this.say('Type anything; it will be echoed back.');
      }
    }, 10);

    this.tick = setInterval(() => {
      this.counter += 1;
      const analog = Math.round(512 + 400 * Math.sin(this.counter / 8));
      this.say(`uptime=${this.counter * 500}ms a0=${analog}`);
    }, 500);
  }

  async close(): Promise<void> {
    if (!this.open_) return;
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.open_ = false;
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const listener of this.listeners.close) listener();
  }

  async write(data: Buffer): Promise<void> {
    if (!this.open_) throw new Error(`Cannot write: ${this.path} is not open.`);

    this.rxLine += data.toString('utf8');
    let newline = this.rxLine.indexOf('\n');
    while (newline !== -1) {
      const line = this.rxLine.slice(0, newline).replace(/\r$/, '');
      this.rxLine = this.rxLine.slice(newline + 1);
      this.say(`echo: ${line}`);
      newline = this.rxLine.indexOf('\n');
    }
  }

  /** Test hook: simulate the board being yanked out (§3.6). */
  simulateUnplug(): void {
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.open_ = false;
    const error = new Error(`Device at ${this.path} was disconnected.`);
    for (const listener of this.listeners.error) listener(error);
    for (const listener of this.listeners.close) listener();
  }

  /** Exposed for assertions in tests. */
  get currentBaud(): number {
    return this.baud;
  }
}
