import { beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetry, TELEMETRY_CAPACITY } from '@/dashboard/telemetry';

/** rAF is async in jsdom; this drains one flush. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  telemetry.clear();
});

describe('telemetry ring buffer', () => {
  it('keeps the latest value per series', () => {
    telemetry.ingest({ a: 1, b: 2 }, 1000);
    telemetry.ingest({ a: 5 }, 1050);
    expect(telemetry.latest('a')).toBe(5);
    expect(telemetry.latest('b')).toBe(2);
  });

  it('returns null for a series it has never seen', () => {
    expect(telemetry.latest('nothing')).toBeNull();
  });

  it('is bounded: history never grows past capacity', () => {
    // §Phase 8 forbids unbounded arrays anywhere in the app.
    for (let index = 0; index < TELEMETRY_CAPACITY + 500; index += 1) {
      telemetry.ingest({ a: index }, index);
    }
    const [times] = telemetry.window('a', 1e9);
    expect(times.length).toBeLessThanOrEqual(TELEMETRY_CAPACITY);
    expect(telemetry.latest('a')).toBe(TELEMETRY_CAPACITY + 499);
  });

  it('returns a window in oldest-first order', () => {
    for (let index = 0; index < 10; index += 1) telemetry.ingest({ a: index }, index * 100);
    const [times, values] = telemetry.window('a', 1e9);
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(9);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]!).toBeGreaterThanOrEqual(times[index - 1]!);
    }
  });

  it('drops samples older than the requested window', () => {
    const now = performance.now();
    telemetry.ingest({ a: 1 }, now - 60_000);
    telemetry.ingest({ a: 2 }, now);
    const [, values] = telemetry.window('a', 5);
    expect(Array.from(values)).toEqual([2]);
  });

  it('reports an empty window for an unknown series', () => {
    const [times, values] = telemetry.window('ghost', 10);
    expect(times.length).toBe(0);
    expect(values.length).toBe(0);
  });
});

describe('subscriptions', () => {
  it('delivers the current value immediately on subscribe', () => {
    telemetry.ingest({ a: 42 }, 1);
    const listener = vi.fn();
    telemetry.subscribe('a', listener);
    expect(listener).toHaveBeenCalledWith(42);
  });

  it('coalesces many frames into one notification per animation frame', async () => {
    const listener = vi.fn();
    telemetry.subscribe('a', listener);
    listener.mockClear();

    // Twenty frames in one tick must not become twenty renders.
    for (let index = 0; index < 20; index += 1) telemetry.ingest({ a: index }, index);
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(19);
  });

  it('only notifies series that changed', async () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    telemetry.subscribe('a', listenerA);
    telemetry.subscribe('b', listenerB);
    telemetry.ingest({ a: 1, b: 1 }, 1);
    await flush();
    listenerA.mockClear();
    listenerB.mockClear();

    telemetry.ingest({ a: 2 }, 2);
    await flush();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', async () => {
    const listener = vi.fn();
    const unsubscribe = telemetry.subscribe('a', listener);
    unsubscribe();
    listener.mockClear();

    telemetry.ingest({ a: 9 }, 1);
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('surfaces a locally applied value so a control does not feel dead', async () => {
    const listener = vi.fn();
    telemetry.subscribe('speed', listener);
    listener.mockClear();

    telemetry.poke('speed', 120);
    await flush();
    expect(listener).toHaveBeenLastCalledWith(120);
  });
});
