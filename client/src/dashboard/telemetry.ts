/**
 * Telemetry pipeline (BUILD_PLAN.md §Phase 6 performance rules).
 *
 * "Do not put telemetry in React state — that will re-render the tree 20x per
 * second and stutter." So:
 *
 *   - frames land in plain refs held by this module, outside React;
 *   - history is a fixed-capacity ring of typed arrays, never a growing array;
 *   - subscribers are flushed once per animation frame, not once per frame
 *     received, and only for the values that actually changed.
 */

/** Seconds of history retained per series, at the 20Hz ceiling in the plan. */
const CAPACITY = 20 * 120;

/** One series: a ring of timestamps and values, kept as typed arrays for uplot. */
class Series {
  readonly times = new Float64Array(CAPACITY);
  readonly values = new Float64Array(CAPACITY);
  private head = 0;
  private filled = 0;

  push(time: number, value: number): void {
    this.times[this.head] = time;
    this.values[this.head] = value;
    this.head = (this.head + 1) % CAPACITY;
    if (this.filled < CAPACITY) this.filled += 1;
  }

  get size(): number {
    return this.filled;
  }

  /**
   * Oldest-first copy of the last `seconds` of samples, as the two parallel
   * arrays uplot consumes directly.
   */
  window(seconds: number, now: number): [Float64Array, Float64Array] {
    const cutoff = now - seconds * 1000;
    const times = new Float64Array(this.filled);
    const values = new Float64Array(this.filled);
    let count = 0;

    const start = this.filled === CAPACITY ? this.head : 0;
    for (let step = 0; step < this.filled; step += 1) {
      const index = (start + step) % CAPACITY;
      const time = this.times[index] ?? 0;
      if (time < cutoff) continue;
      times[count] = time / 1000;
      values[count] = this.values[index] ?? 0;
      count += 1;
    }
    return [times.subarray(0, count), values.subarray(0, count)];
  }

  latest(): number | null {
    if (this.filled === 0) return null;
    const index = (this.head - 1 + CAPACITY) % CAPACITY;
    return this.values[index] ?? null;
  }
}

type ValueListener = (value: number) => void;

class TelemetryBus {
  private readonly series = new Map<string, Series>();
  private readonly listeners = new Map<string, Set<ValueListener>>();
  /** Names whose value changed since the last flush. */
  private readonly dirty = new Set<string>();
  private frame: number | null = null;
  private frames = 0;
  private lastRateAt = 0;
  private rate = 0;

  /** Feed one telemetry frame. Cheap: no allocation beyond the ring writes. */
  ingest(values: Record<string, number>, at: number): void {
    for (const [name, value] of Object.entries(values)) {
      let series = this.series.get(name);
      if (series === undefined) {
        series = new Series();
        this.series.set(name, series);
      }
      series.push(at, value);
      this.dirty.add(name);
    }

    this.frames += 1;
    if (at - this.lastRateAt >= 1000) {
      this.rate = this.frames;
      this.frames = 0;
      this.lastRateAt = at;
    }

    this.scheduleFlush();
  }

  /** Locally applied value, so a control reflects what was sent. */
  poke(name: string, value: number, at = performance.now()): void {
    let series = this.series.get(name);
    if (series === undefined) {
      series = new Series();
      this.series.set(name, series);
    }
    series.push(at, value);
    this.dirty.add(name);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      // Only widgets bound to a changed value are told anything.
      for (const name of this.dirty) {
        const series = this.series.get(name);
        const value = series?.latest();
        if (value === null || value === undefined) continue;
        for (const listener of this.listeners.get(name) ?? []) listener(value);
      }
      this.dirty.clear();
    });
  }

  subscribe(name: string, listener: ValueListener): () => void {
    let set = this.listeners.get(name);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);

    // Deliver the current value immediately so a widget never renders blank
    // while waiting for the next frame.
    const current = this.series.get(name)?.latest();
    if (current !== null && current !== undefined) listener(current);

    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(name);
    };
  }

  latest(name: string): number | null {
    return this.series.get(name)?.latest() ?? null;
  }

  window(name: string, seconds: number): [Float64Array, Float64Array] {
    const series = this.series.get(name);
    if (series === undefined) return [new Float64Array(0), new Float64Array(0)];
    return series.window(seconds, performance.now());
  }

  /** Frames per second actually arriving, for the status bar. */
  get frameRate(): number {
    return this.rate;
  }

  names(): string[] {
    return [...this.series.keys()].sort();
  }

  clear(): void {
    this.series.clear();
    this.dirty.clear();
    this.rate = 0;
    this.frames = 0;
  }
}

export const telemetry = new TelemetryBus();

/** Exported for tests. */
export const TELEMETRY_CAPACITY = CAPACITY;
