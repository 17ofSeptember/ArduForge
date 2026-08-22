/**
 * Firmata "Quick Prototype" session (BUILD_PLAN.md §Phase 6, Mode A).
 *
 * Poke pins directly with no user program: upload StandardFirmata once, then
 * read and write pins from the dashboard. Pin capabilities come from Firmata's
 * own capability response rather than a hard-coded board table, so this works
 * on any board that speaks the protocol.
 */
import Board from 'firmata';
import { serialManager } from '@/serial/manager.js';
import type { Lease, RevokeReason } from '@/serial/types.js';
import { LeaseTransport } from '@/firmata/transport.js';

/** StandardFirmata's own baud, not the project's 115200 runtime rate. */
export const FIRMATA_BAUD = 57600;
const READY_TIMEOUT_MS = 12_000;
const DEFAULT_SAMPLING_MS = 50;

export type PinMode = 'input' | 'output' | 'analog' | 'pwm' | 'servo' | 'pullup' | 'unknown';

/** Firmata's numeric modes, named. */
const MODE_NAMES: Record<number, PinMode> = {
  0: 'input',
  1: 'output',
  2: 'analog',
  3: 'pwm',
  4: 'servo',
  11: 'pullup',
};

export interface PinInfo {
  readonly pin: number;
  readonly supportedModes: readonly PinMode[];
  readonly mode: PinMode;
  readonly analogChannel: number | null;
  readonly value: number;
}

export interface FirmataEvents {
  ready(info: { firmware: string; pins: readonly PinInfo[] }): void;
  pinValue(pin: number, value: number): void;
  revoked(reason: RevokeReason): void;
  error(message: string): void;
}

function describeModes(modes: readonly number[]): PinMode[] {
  return modes.map((mode) => MODE_NAMES[mode] ?? 'unknown');
}

export class FirmataSession {
  private lease: Lease | null = null;
  private board: Board | null = null;
  private transport: LeaseTransport | null = null;

  constructor(private readonly events: FirmataEvents) {}

  get connected(): boolean {
    return this.board !== null && this.lease !== null && this.lease.isValid();
  }

  async open(port: string, ownerId: string): Promise<{ firmware: string; pins: readonly PinInfo[] }> {
    await this.close();

    const lease = await serialManager.acquire(ownerId, 'firmata', { port, baud: FIRMATA_BAUD });
    this.lease = lease;
    lease.onRevoked((reason) => {
      this.board = null;
      this.events.revoked(reason);
    });

    const transport = new LeaseTransport(lease);
    this.transport = transport;

    const board = new Board(transport, { skipCapabilities: false });
    this.board = board;

    const info = await new Promise<{ firmware: string; pins: readonly PinInfo[] }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              'The board did not report Firmata capabilities in time. Upload StandardFirmata first, ' +
                'or check that the board is not running a different sketch.',
            ),
          );
        }, READY_TIMEOUT_MS);

        board.once('ready', () => {
          clearTimeout(timer);
          board.setSamplingInterval(DEFAULT_SAMPLING_MS);
          resolve({ firmware: this.firmwareLabel(), pins: this.describePins() });
        });

        board.once('error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );

    this.events.ready(info);
    return info;
  }

  private firmwareLabel(): string {
    const firmware = this.board?.firmware;
    if (firmware === undefined) return 'unknown';
    const version = firmware.version;
    const suffix = version === undefined ? '' : ` ${version.major}.${version.minor}`;
    return `${firmware.name ?? 'Firmata'}${suffix}`;
  }

  describePins(): PinInfo[] {
    const board = this.board;
    if (board === null) return [];

    return board.pins.map((pin, index) => ({
      pin: index,
      supportedModes: describeModes(pin.supportedModes ?? []),
      mode: MODE_NAMES[pin.mode] ?? 'unknown',
      analogChannel: pin.analogChannel === 127 ? null : pin.analogChannel,
      value: pin.value,
    }));
  }

  private require(): Board {
    const board = this.board;
    if (board === null || !this.connected) throw new Error('Not connected to a Firmata board.');
    return board;
  }

  setMode(pin: number, mode: PinMode): void {
    const board = this.require();
    const numeric = Object.entries(MODE_NAMES).find(([, name]) => name === mode)?.[0];
    if (numeric === undefined) throw new Error(`Unsupported pin mode: ${mode}`);

    if (mode === 'analog') {
      // firmata.js addresses ANALOG by channel, not by pin: pinMode(), and
      // analogRead() after it, both index this.analogPins. Passing the pin
      // number here reads past the end of that array and throws.
      const channel = this.analogChannelFor(pin);
      board.pinMode(channel, Number(numeric));
      // analogRead enables reporting itself, so there is no separate call.
      board.analogRead(channel, (value) => this.events.pinValue(pin, value));
      return;
    }

    board.pinMode(pin, Number(numeric));

    // Reporting has to be enabled explicitly, or an input pin stays silent.
    if (mode === 'input' || mode === 'pullup') {
      board.reportDigitalPin(pin, 1);
      board.digitalRead(pin, (value) => this.events.pinValue(pin, value));
    }
  }

  /** Firmata addresses analog reads by channel, not by pin number. */
  private analogChannelFor(pin: number): number {
    const info = this.board?.pins[pin];
    return info === undefined || info.analogChannel === 127 ? pin : info.analogChannel;
  }

  digitalWrite(pin: number, value: 0 | 1): void {
    this.require().digitalWrite(pin, value);
  }

  analogWrite(pin: number, value: number): void {
    this.require().analogWrite(pin, Math.min(255, Math.max(0, Math.round(value))));
  }

  servoWrite(pin: number, angle: number): void {
    this.require().servoWrite(pin, Math.min(180, Math.max(0, Math.round(angle))));
  }

  setSamplingInterval(ms: number): void {
    this.require().setSamplingInterval(Math.min(10_000, Math.max(10, Math.round(ms))));
  }

  async close(): Promise<void> {
    const lease = this.lease;
    this.board = null;
    this.lease = null;
    this.transport?.close();
    this.transport = null;
    if (lease !== null) await serialManager.release(lease.id);
  }
}
