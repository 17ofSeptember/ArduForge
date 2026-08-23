/**
 * Minimal declarations for `firmata-io`, which ships no types.
 * Only the surface this project uses is declared — guessing at the rest would
 * be worse than not having it.
 *
 * This is deliberately `firmata-io` rather than `firmata`. The latter is a two
 * line wrapper whose only job is `require("serialport")` at module load, and it
 * pins serialport 8 from 2019, whose native bindings have no prebuild for any
 * current Node and fail to compile on Windows. We never let firmata open a port
 * anyway (see transport.ts and BUILD_PLAN.md §3.1), so that dependency was pure
 * cost. firmata-io is the same library with zero dependencies.
 */
declare module 'firmata-io' {
  import type { EventEmitter } from 'node:events';

  export interface PinCapability {
    [mode: number]: number;
  }

  export interface Pin {
    supportedModes: number[];
    mode: number;
    value: number;
    report: number;
    analogChannel: number;
  }

  export class Firmata extends EventEmitter {
    constructor(transport: unknown, options?: Record<string, unknown>, callback?: (error?: Error) => void);

    readonly pins: Pin[];
    readonly analogPins: number[];
    readonly firmware: { name?: string; version?: { major: number; minor: number } };
    readonly MODES: Record<string, number>;

    pinMode(pin: number, mode: number): void;
    digitalWrite(pin: number, value: number): void;
    analogWrite(pin: number, value: number): void;
    servoWrite(pin: number, value: number): void;
    digitalRead(pin: number, handler: (value: number) => void): void;
    analogRead(pin: number, handler: (value: number) => void): void;
    reportDigitalPin(pin: number, enable: number): void;
    reportAnalogPin(pin: number, enable: number): void;
    setSamplingInterval(ms: number): void;
    reset(): void;
  }

  /**
   * Binds a default Transport class and returns the Board. We never use it:
   * a transport instance is passed to the constructor instead, which leaves
   * the default unset so that any attempt to open a port by path throws
   * "Missing Default Transport" rather than quietly opening one.
   */
  const bindTransport: {
    (transport: unknown): typeof Firmata;
    Firmata: typeof Firmata;
  };

  export default bindTransport;
}
