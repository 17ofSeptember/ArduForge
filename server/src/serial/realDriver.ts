/**
 * Real hardware driver. The ONLY place in this project that constructs a
 * SerialPort (BUILD_PLAN.md §3.1). Nothing else may import `serialport`.
 */
import { SerialPort } from 'serialport';
import {
  explainOpenFailure,
  preferCuPath,
  type PortDriver,
  type PortDriverEvents,
} from '@/serial/types.js';

type ListenerMap = {
  [E in keyof PortDriverEvents]: PortDriverEvents[E][];
};

export class RealPortDriver implements PortDriver {
  readonly path: string;
  private port: SerialPort | null = null;
  private readonly listeners: ListenerMap = { data: [], error: [], close: [] };

  constructor(path: string) {
    this.path = preferCuPath(path);
  }

  on<E extends keyof PortDriverEvents>(event: E, listener: PortDriverEvents[E]): void {
    this.listeners[event].push(listener);
  }

  removeAllListeners(): void {
    this.listeners.data = [];
    this.listeners.error = [];
    this.listeners.close = [];
  }

  private emitData(chunk: Buffer): void {
    for (const listener of this.listeners.data) listener(chunk);
  }

  private emitError(error: Error): void {
    for (const listener of this.listeners.error) listener(error);
  }

  private emitClose(): void {
    for (const listener of this.listeners.close) listener();
  }

  isOpen(): boolean {
    return this.port !== null && this.port.isOpen;
  }

  open(baud: number): Promise<void> {
    if (this.isOpen()) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const port = new SerialPort(
        { path: this.path, baudRate: baud, autoOpen: false },
        // Constructor-level errors surface through the open callback below.
      );

      port.on('data', (chunk: Buffer) => this.emitData(chunk));
      port.on('error', (error: Error) => this.emitError(error));
      port.on('close', () => {
        this.port = null;
        this.emitClose();
      });

      port.open((error) => {
        if (error) {
          this.port = null;
          reject(explainOpenFailure(this.path, baud, error));
          return;
        }
        this.port = port;
        resolve();
      });
    });
  }

  /**
   * Resolves only after the OS close has actually fired its callback.
   * Fire-and-forget closing is what leaks descriptors and forces a replug (§3.1).
   */
  close(): Promise<void> {
    const port = this.port;
    if (port === null || !port.isOpen) {
      this.port = null;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      port.close((error) => {
        if (error) {
          // A close error still means the handle is gone as far as we can act on it.
          console.error(`[serial] close(${this.path}) reported: ${error.message}`);
        }
        this.port = null;
        resolve();
      });
    });
  }

  write(data: Buffer): Promise<void> {
    const port = this.port;
    if (port === null || !port.isOpen) {
      return Promise.reject(new Error(`Cannot write: ${this.path} is not open.`));
    }

    return new Promise<void>((resolve, reject) => {
      port.write(data, (error) => {
        if (error) {
          reject(new Error(`Write to ${this.path} failed: ${error.message}`));
          return;
        }
        port.drain((drainError) => {
          if (drainError) {
            reject(new Error(`Drain on ${this.path} failed: ${drainError.message}`));
            return;
          }
          resolve();
        });
      });
    });
  }
}
