import { describe, expect, it, vi } from 'vitest';
import { LeaseTransport } from '@/firmata/transport.js';
import type { Lease } from '@/serial/types.js';

/** A stand-in lease that records writes and lets a test push data through. */
function fakeLease() {
  let dataListener: ((chunk: Buffer) => void) | null = null;
  let revokedListener: ((reason: 'released') => void) | null = null;
  const writes: Buffer[] = [];
  let failWith: Error | null = null;

  const lease = {
    id: 'lease-1',
    ownerId: 'owner',
    port: '/dev/cu.test',
    mode: 'firmata',
    baud: 57600,
    isValid: () => true,
    write: async (data: Buffer) => {
      if (failWith !== null) throw failWith;
      writes.push(data);
    },
    onData: (listener: (chunk: Buffer) => void) => {
      dataListener = listener;
      return () => undefined;
    },
    onRevoked: (listener: (reason: 'released') => void) => {
      revokedListener = listener;
      return () => undefined;
    },
  } as unknown as Lease;

  return {
    lease,
    writes,
    push: (chunk: Buffer) => dataListener?.(chunk),
    revoke: () => revokedListener?.('released'),
    failNextWrites: (error: Error) => {
      failWith = error;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LeaseTransport', () => {
  it('emits open once, after listeners have had a chance to attach', async () => {
    const harness = fakeLease();
    const transport = new LeaseTransport(harness.lease);

    const opened = vi.fn();
    transport.on('open', opened);
    // Deferred by a microtask, so a listener attached right after construction
    // still sees it — firmata attaches its handlers this way.
    expect(opened).not.toHaveBeenCalled();

    await tick();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(true);
  });

  it('forwards board data as data events', async () => {
    const harness = fakeLease();
    const transport = new LeaseTransport(harness.lease);
    const chunks: Buffer[] = [];
    transport.on('data', (chunk: Buffer) => chunks.push(chunk));
    await tick();

    harness.push(Buffer.from([0xf9, 0x02, 0x05]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.[0]).toBe(0xf9);
  });

  it('writes through the lease rather than any port of its own', async () => {
    // This is the §3.1 guarantee: firmata never gets to construct a SerialPort.
    const harness = fakeLease();
    const transport = new LeaseTransport(harness.lease);
    await tick();

    await new Promise<void>((resolve) => transport.write(Buffer.from([0xf0]), () => resolve()));
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]?.[0]).toBe(0xf0);
  });

  it('accepts a plain number array, which firmata sends', async () => {
    const harness = fakeLease();
    const transport = new LeaseTransport(harness.lease);
    await tick();

    await new Promise<void>((resolve) => transport.write([0x90, 0x01], () => resolve()));
    expect(Array.from(harness.writes[0] ?? [])).toEqual([0x90, 0x01]);
  });

  it('reports a failed write through the callback', async () => {
    const harness = fakeLease();
    harness.failNextWrites(new Error('port closed'));
    const transport = new LeaseTransport(harness.lease);
    await tick();

    const error = await new Promise<Error | null | undefined>((resolve) =>
      transport.write(Buffer.from([1]), resolve),
    );
    expect(error).toBeInstanceOf(Error);
  });

  it('closes when the lease is revoked, so firmata stops writing', async () => {
    const harness = fakeLease();
    const transport = new LeaseTransport(harness.lease);
    const closed = vi.fn();
    transport.on('close', closed);
    await tick();

    harness.revoke();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(transport.isOpen).toBe(false);
  });
});
