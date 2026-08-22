import { afterEach, describe, expect, it, vi } from 'vitest';
import { STALE_FLOOR_MS, Watchdog, staleLimitFor } from '@/link/watchdog.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('staleLimitFor', () => {
  it('is twice the interval', () => {
    expect(staleLimitFor(600)).toBe(1200);
    expect(staleLimitFor(1000)).toBe(2000);
  });

  it('never drops below the one second floor', () => {
    // §3.7 sets a floor so a 50ms interval does not flap on ordinary jitter.
    expect(staleLimitFor(50)).toBe(STALE_FLOOR_MS);
    expect(staleLimitFor(100)).toBe(STALE_FLOOR_MS);
  });
});

describe('Watchdog', () => {
  it('reports stale once telemetry stops arriving', () => {
    const changes: boolean[] = [];
    const watchdog = new Watchdog((stale) => changes.push(stale));

    watchdog.start(100, 0);
    watchdog.check(500);
    expect(changes).toEqual([]);

    // Limit is 1000ms (the floor), so 1200ms of silence is stale.
    watchdog.check(1200);
    expect(changes).toEqual([true]);
    expect(watchdog.isStale).toBe(true);
    watchdog.stop();
  });

  it('clears staleness as soon as a frame arrives', () => {
    const changes: boolean[] = [];
    const watchdog = new Watchdog((stale) => changes.push(stale));

    watchdog.start(100, 0);
    watchdog.check(2000);
    expect(changes).toEqual([true]);

    watchdog.sawFrame(2100);
    expect(changes).toEqual([true, false]);
    expect(watchdog.isStale).toBe(false);
    watchdog.stop();
  });

  it('reports each transition once, not on every check', () => {
    const changes: boolean[] = [];
    const watchdog = new Watchdog((stale) => changes.push(stale));

    watchdog.start(100, 0);
    watchdog.check(2000);
    watchdog.check(3000);
    watchdog.check(4000);
    expect(changes).toEqual([true]);
    watchdog.stop();
  });

  it('treats a deliberate stop as quiet, not as a fault', () => {
    // The link going silent because the user stopped telemetry must never be
    // reported as stale — that would be crying wolf.
    const changes: boolean[] = [];
    const watchdog = new Watchdog((stale) => changes.push(stale));

    watchdog.start(100, 0);
    watchdog.stop();
    watchdog.check(999_999);

    expect(changes).toEqual([]);
    expect(watchdog.isStale).toBe(false);
  });

  it('re-arms cleanly after being restarted', () => {
    const changes: boolean[] = [];
    const watchdog = new Watchdog((stale) => changes.push(stale));

    watchdog.start(100, 0);
    watchdog.check(2000);
    expect(watchdog.isStale).toBe(true);

    watchdog.start(100, 3000);
    expect(watchdog.isStale).toBe(false);
    watchdog.check(3500);
    expect(changes).toEqual([true]);
    watchdog.stop();
  });

  it('polls on a timer at least twice per window', () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    // Its own clock, so the assertion does not depend on whether the runner's
    // fake timers happen to mock Date as well.
    let clock = 0;
    const watchdog = new Watchdog((stale) => changes.push(stale), () => clock);

    watchdog.start(1000); // limit 2000ms, so it polls every 1000ms
    expect(watchdog.running).toBe(true);

    clock = 2500;
    vi.advanceTimersByTime(2500);
    expect(changes).toEqual([true]);

    watchdog.stop();
    expect(watchdog.running).toBe(false);
  });
});
