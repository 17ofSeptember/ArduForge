/**
 * Minimal declarations for the `firmata` package, which ships no types.
 * Only the surface this project uses is declared — guessing at the rest would
 * be worse than not having it.
 */
declare module 'firmata' {
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

  export default class Board extends EventEmitter {
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
}
