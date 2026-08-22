/**
 * SerialManager — the single owner of every serial handle in this process.
 * BUILD_PLAN.md §3.1 is the specification for this file; read it before changing anything here.
 *
 * Invariants this file is responsible for:
 *  1. One open port per path, held by at most one lease at a time.
 *  2. Contending acquires QUEUE. They are never rejected for being busy.
 *  3. Uploads PREEMPT via withExclusive(), and the preempted lease is fully torn
 *     down — close callback fired — before the upload starts.
 *  4. release() resolves only after the port has actually closed.
 *  5. A revoked lease can never write, even if it still holds a reference.
 */
import { randomUUID } from 'node:crypto';
import {
  DeviceLostError,
  LeaseRevokedError,
  preferCuPath,
  type Lease,
  type PortDriver,
  type RevokeReason,
  type SerialMode,
} from '@/serial/types.js';
import { RealPortDriver } from '@/serial/realDriver.js';
import { MockPortDriver, MOCK_PORT_PATH } from '@/serial/mockDriver.js';

/**
 * The mock board is enabled by env var or by `--mock` on the command line.
 *
 * The flag exists because `ARDUFORGE_MOCK=1 npm run dev:server` is POSIX shell
 * syntax that cmd.exe and PowerShell both reject, so the env var alone made the
 * documented instruction unusable on Windows. `npm run dev:server -- --mock`
 * works identically everywhere.
 */
export const MOCK_ENABLED =
  process.env['ARDUFORGE_MOCK'] === '1' || process.argv.includes('--mock');

export interface AcquireOptions {
  readonly port: string;
  readonly baud: number;
  /** Cancels the wait if this lease is still queued. */
  readonly signal?: AbortSignal | undefined;
  /** Called when the request is parked behind another owner. */
  readonly onQueued?: ((position: number) => void) | undefined;
}

class LeaseImpl implements Lease {
  readonly id = randomUUID();
  private revoked: RevokeReason | null = null;
  private readonly dataListeners = new Set<(chunk: Buffer) => void>();
  private readonly revokeListeners = new Set<(reason: RevokeReason) => void>();

  constructor(
    readonly ownerId: string,
    readonly port: string,
    readonly mode: SerialMode,
    readonly baud: number,
    private readonly driver: PortDriver,
  ) {}

  isValid(): boolean {
    return this.revoked === null;
  }

  async write(data: Buffer): Promise<void> {
    // Invariant 5. This check is the whole reason writes go through the lease
    // rather than the driver.
    if (this.revoked !== null) throw new LeaseRevokedError(this.revoked);
    await this.driver.write(data);
  }

  onData(listener: (chunk: Buffer) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onRevoked(listener: (reason: RevokeReason) => void): () => void {
    this.revokeListeners.add(listener);
    return () => this.revokeListeners.delete(listener);
  }

  /** Internal — called by the manager only. */
  pushData(chunk: Buffer): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  /** Internal — called by the manager only. Idempotent. */
  revoke(reason: RevokeReason): void {
    if (this.revoked !== null) return;
    this.revoked = reason;
    for (const listener of this.revokeListeners) listener(reason);
    this.revokeListeners.clear();
    this.dataListeners.clear();
  }
}

interface QueueEntry {
  readonly ownerId: string;
  readonly mode: SerialMode;
  readonly baud: number;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (lease: Lease) => void;
  readonly reject: (error: Error) => void;
  cancelled: boolean;
}

interface PortState {
  readonly path: string;
  driver: PortDriver | null;
  current: LeaseImpl | null;
  queue: QueueEntry[];
  /** True while an upload holds the port. Blocks all grants. */
  exclusive: boolean;
  /** Guards against re-entrant pumping. */
  pumping: boolean;
}

export type DriverFactory = (path: string) => PortDriver;

export const defaultDriverFactory: DriverFactory = (path) => {
  if (MOCK_ENABLED && path === MOCK_PORT_PATH) return new MockPortDriver(path);
  return new RealPortDriver(path);
};

export class SerialManager {
  private readonly ports = new Map<string, PortState>();
  private readonly deviceLostListeners = new Set<(port: string) => void>();
  private shuttingDown = false;

  /**
   * The factory is injectable so tests can drive the queue against mock drivers
   * they hold references to. Production always uses the default.
   */
  constructor(private readonly createDriver: DriverFactory = defaultDriverFactory) {}

  private stateFor(rawPath: string): PortState {
    const path = preferCuPath(rawPath);
    let state = this.ports.get(path);
    if (state === undefined) {
      state = { path, driver: null, current: null, queue: [], exclusive: false, pumping: false };
      this.ports.set(path, state);
    }
    return state;
  }

  onDeviceLost(listener: (port: string) => void): () => void {
    this.deviceLostListeners.add(listener);
    return () => this.deviceLostListeners.delete(listener);
  }

  /**
   * Take the port. Queues behind any current holder rather than failing (invariant 2).
   */
  acquire(ownerId: string, mode: SerialMode, opts: AcquireOptions): Promise<Lease> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('Server is shutting down.'));
    }
    const state = this.stateFor(opts.port);

    return new Promise<Lease>((resolve, reject) => {
      const entry: QueueEntry = {
        ownerId,
        mode,
        baud: opts.baud,
        signal: opts.signal,
        resolve,
        reject,
        cancelled: false,
      };

      if (opts.signal !== undefined) {
        if (opts.signal.aborted) {
          reject(new Error('Acquire aborted before it was granted.'));
          return;
        }
        opts.signal.addEventListener(
          'abort',
          () => {
            entry.cancelled = true;
            reject(new Error('Acquire aborted while queued.'));
          },
          { once: true },
        );
      }

      state.queue.push(entry);

      const busy = state.current !== null || state.exclusive;
      if (busy && opts.onQueued !== undefined) {
        opts.onQueued(state.queue.length);
      }

      void this.pump(state);
    });
  }

  /** Resolves only after the port has actually closed (invariant 4). */
  async release(leaseId: string): Promise<void> {
    for (const state of this.ports.values()) {
      if (state.current !== null && state.current.id === leaseId) {
        await this.teardown(state, 'released');
        void this.pump(state);
        return;
      }
    }
    // Unknown or already-released lease: releasing twice is not an error.
  }

  /**
   * Run `fn` with the port held exclusively, preempting whoever has it (invariant 3).
   * This is the upload path — see §3.5 for the sequence the caller must follow.
   */
  async withExclusive<T>(rawPort: string, fn: () => Promise<T>): Promise<T> {
    const state = this.stateFor(rawPort);
    state.exclusive = true;
    try {
      if (state.current !== null) {
        await this.teardown(state, 'preempted');
      }
      return await fn();
    } finally {
      state.exclusive = false;
      void this.pump(state);
    }
  }

  /** Close the driver and revoke the current lease. Always awaits the real close. */
  private async teardown(state: PortState, reason: RevokeReason): Promise<void> {
    const lease = state.current;
    const driver = state.driver;
    state.current = null;
    state.driver = null;

    if (lease !== null) lease.revoke(reason);
    if (driver !== null) {
      driver.removeAllListeners();
      await driver.close();
    }
  }

  private async pump(state: PortState): Promise<void> {
    if (state.pumping) return;
    state.pumping = true;
    try {
      while (
        !this.shuttingDown &&
        !state.exclusive &&
        state.current === null &&
        state.queue.length > 0
      ) {
        const entry = state.queue.shift();
        if (entry === undefined) break;
        if (entry.cancelled) continue;

        const driver = this.createDriver(state.path);
        try {
          await driver.open(entry.baud);
        } catch (error: unknown) {
          driver.removeAllListeners();
          entry.reject(error instanceof Error ? error : new Error(String(error)));
          continue;
        }

        // Re-check: an abort could have landed during the await.
        if (entry.cancelled) {
          await driver.close();
          continue;
        }

        const lease = new LeaseImpl(entry.ownerId, state.path, entry.mode, entry.baud, driver);
        state.driver = driver;
        state.current = lease;

        driver.on('data', (chunk) => lease.pushData(chunk));
        driver.on('error', (error) => {
          console.error(`[serial] ${state.path} error: ${error.message}`);
          void this.handleDeviceLost(state);
        });
        driver.on('close', () => {
          // An unexpected close (still the current lease) means the device went away.
          if (state.current === lease) void this.handleDeviceLost(state);
        });

        entry.resolve(lease);
      }
    } finally {
      state.pumping = false;
    }
  }

  /** §3.6 — the board vanished. Tear down, notify, never crash. */
  private async handleDeviceLost(state: PortState): Promise<void> {
    if (state.current === null && state.driver === null) return;
    await this.teardown(state, 'device-lost');

    const pending = state.queue.splice(0, state.queue.length);
    for (const entry of pending) {
      if (!entry.cancelled) entry.reject(new DeviceLostError(state.path));
    }

    for (const listener of this.deviceLostListeners) listener(state.path);
  }

  /** §3.3 — synchronously reachable teardown for process exit. */
  async closeAll(): Promise<void> {
    this.shuttingDown = true;
    for (const state of this.ports.values()) {
      const pending = state.queue.splice(0, state.queue.length);
      for (const entry of pending) {
        if (!entry.cancelled) entry.reject(new Error('Server is shutting down.'));
      }
      await this.teardown(state, 'shutdown');
    }
  }

  /** Debug/introspection for the status bar and tests. */
  status(): { port: string; holder: string | null; mode: SerialMode | null; queued: number }[] {
    return [...this.ports.values()].map((state) => ({
      port: state.path,
      holder: state.current?.ownerId ?? null,
      mode: state.current?.mode ?? null,
      queued: state.queue.filter((entry) => !entry.cancelled).length,
    }));
  }
}

/** The one instance (§3.1). Import this, never construct SerialManager. */
export const serialManager = new SerialManager();
