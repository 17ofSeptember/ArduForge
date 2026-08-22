/**
 * Link staleness watchdog (BUILD_PLAN.md §3.7).
 *
 * "If AwryLink telemetry has not arrived in 2x the configured interval (min
 * 1000ms), mark the link as stale in the UI. Do not silently show frozen
 * values as if they were live."
 *
 * Extracted from the session so it can be tested deterministically: on real
 * hardware the only way to arm this and then go quiet is for the board to
 * fail, which is not something a test can arrange on demand.
 */

/** §3.7: never shorter than a second, however fast telemetry is configured. */
export const STALE_FLOOR_MS = 1_000;

export function staleLimitFor(intervalMs: number): number {
  return Math.max(STALE_FLOOR_MS, intervalMs * 2);
}

export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeen = 0;
  private stale = false;
  private limit = STALE_FLOOR_MS;

  /**
   * `now` is injectable so the timing can be tested deterministically without
   * depending on whether the test runner's fake timers also mock Date.
   */
  constructor(
    private readonly onChange: (stale: boolean) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get isStale(): boolean {
    return this.stale;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Arms the watchdog for a given telemetry interval. */
  start(intervalMs: number, now = this.now()): void {
    this.stop();
    this.limit = staleLimitFor(intervalMs);
    this.lastSeen = now;
    this.stale = false;
    // Check at least twice per window, so staleness is noticed promptly.
    this.timer = setInterval(() => this.check(), Math.max(250, Math.floor(this.limit / 2)));
  }

  /** Call for every frame received. Clears staleness if it had been set. */
  sawFrame(now = this.now()): void {
    this.lastSeen = now;
    if (this.stale) {
      this.stale = false;
      this.onChange(false);
    }
  }

  check(now = this.now()): void {
    if (this.timer === null) return;
    const quiet = now - this.lastSeen > this.limit;
    if (quiet !== this.stale) {
      this.stale = quiet;
      this.onChange(quiet);
    }
  }

  /**
   * Disarms. A deliberate stop is NOT staleness: the link going quiet because
   * the user asked it to must never be reported as a fault.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stale = false;
  }
}
