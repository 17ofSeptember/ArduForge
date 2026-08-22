/**
 * Adapts a SerialManager lease into the transport firmata.js expects.
 *
 * firmata.js would happily open its own SerialPort, and that is precisely what
 * §3.1 forbids: the SerialManager is the only thing in this process allowed to
 * construct one. So the lease is wrapped in the small duplex-ish surface
 * firmata actually uses — on('data'|'open'|'close'|'error') and write() — and
 * firmata never learns there is a port underneath.
 */
import { EventEmitter } from 'node:events';
import type { Lease } from '@/serial/types.js';

export class LeaseTransport extends EventEmitter {
  /** firmata checks this before writing. */
  isOpen = true;

  constructor(private readonly lease: Lease) {
    super();

    lease.onData((chunk) => this.emit('data', chunk));
    lease.onRevoked(() => {
      this.isOpen = false;
      this.emit('close');
    });

    // The lease is already open by the time this is constructed, but firmata
    // waits for an 'open' event before it starts talking. Deferring by a tick
    // gives the caller time to attach its listeners first.
    queueMicrotask(() => {
      if (this.isOpen) this.emit('open');
    });
  }

  write(data: Buffer | number[], callback?: (error?: Error | null) => void): void {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.lease
      .write(buffer)
      .then(() => callback?.(null))
      .catch((error: unknown) => {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        // Report through the callback when there is one; otherwise firmata has
        // no other way to learn the write failed.
        if (callback === undefined) this.emit('error', wrapped);
        else callback(wrapped);
      });
  }

  close(): void {
    this.isOpen = false;
    this.emit('close');
  }
}
