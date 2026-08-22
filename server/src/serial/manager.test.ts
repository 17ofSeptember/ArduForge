/**
 * Tests for the stability contract in BUILD_PLAN.md §3.1.
 * These run with no hardware attached (Definition of Done).
 */
import { describe, expect, it, vi } from 'vitest';
import { SerialManager } from '@/serial/manager.js';
import { MockPortDriver } from '@/serial/mockDriver.js';
import {
  explainOpenFailure,
  LeaseRevokedError,
  preferCuPath,
  type PortDriver,
} from '@/serial/types.js';

const PORT = '/dev/cu.test';

/** Builds a manager whose drivers we keep references to. */
function harness() {
  const drivers: MockPortDriver[] = [];
  const manager = new SerialManager((path): PortDriver => {
    const driver = new MockPortDriver(path);
    drivers.push(driver);
    return driver;
  });
  return { manager, drivers };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('preferCuPath', () => {
  it('maps the tty. alias to its cu. twin', () => {
    // serialport's list() reports the tty. path; opening it would hang on DCD (§1).
    expect(preferCuPath('/dev/tty.usbmodem142101')).toBe('/dev/cu.usbmodem142101');
  });

  it('leaves cu. paths untouched', () => {
    expect(preferCuPath('/dev/cu.usbmodem142101')).toBe('/dev/cu.usbmodem142101');
  });
});

describe('preferCuPath leaves the other platforms alone', () => {
  it('does not touch Linux device names', () => {
    // /dev/ttyACM0 has no dot, so the macOS rule must not fire. If the dot were
    // ever dropped from that prefix this would rewrite a real device into a
    // path that does not exist.
    expect(preferCuPath('/dev/ttyACM0')).toBe('/dev/ttyACM0');
    expect(preferCuPath('/dev/ttyUSB0')).toBe('/dev/ttyUSB0');
  });

  it('does not touch Windows COM ports', () => {
    expect(preferCuPath('COM3')).toBe('COM3');
  });
});

describe('explainOpenFailure', () => {
  const denied = Object.assign(new Error('Permission denied, cannot open /dev/ttyACM0'), {
    code: 'EACCES',
  });

  it('names the dialout group and the log-out step on Linux', () => {
    const message = explainOpenFailure('/dev/ttyACM0', 115200, denied, 'linux').message;
    expect(message).toContain('usermod -a -G dialout');
    expect(message).toContain('log out and back in');
    // Sending a Linux user to look for a busy port is the failure mode this replaces.
    expect(message).not.toContain('serial monitor');
  });

  it('mentions uucp, because Arch does not use dialout', () => {
    expect(explainOpenFailure('/dev/ttyACM0', 115200, denied, 'linux').message).toContain('uucp');
  });

  it('does not give Linux group advice on macOS or Windows', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const message = explainOpenFailure('COM3', 115200, denied, platform).message;
      expect(message).not.toContain('usermod');
      expect(message).toContain('Permission was refused');
    }
  });

  it('treats a Windows access-denied string as a permission failure without a code', () => {
    const noCode = new Error('Opening COM3: Access is denied.');
    expect(explainOpenFailure('COM3', 115200, noCode, 'win32').message).toContain(
      'Permission was refused',
    );
  });

  it('reports a vanished device rather than a busy port', () => {
    const gone = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(explainOpenFailure('/dev/ttyACM0', 115200, gone, 'linux').message).toContain('replug');
  });

  it('falls back to the busy-port explanation for anything else', () => {
    const busy = Object.assign(new Error('Resource busy'), { code: 'EBUSY' });
    expect(explainOpenFailure('/dev/cu.usbmodem1', 115200, busy, 'darwin').message).toContain(
      'serial monitor',
    );
  });

  it('always keeps the underlying message and the baud rate', () => {
    const message = explainOpenFailure('/dev/ttyACM0', 57600, denied, 'linux').message;
    expect(message).toContain('57600 baud');
    expect(message).toContain('Permission denied');
  });
});

describe('SerialManager leases', () => {
  it('grants an uncontended acquire', async () => {
    const { manager } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    expect(lease.isValid()).toBe(true);
    expect(lease.port).toBe(PORT);
    expect(lease.baud).toBe(115200);
    await manager.closeAll();
  });

  it('queues a second acquire instead of rejecting it, and hands over on release', async () => {
    const { manager, drivers } = harness();
    const first = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    const onQueued = vi.fn();
    const secondPromise = manager.acquire('owner-b', 'raw', {
      port: PORT,
      baud: 9600,
      onQueued,
    });

    await flush();
    // Still exactly one driver: the queued owner never got a second handle.
    expect(drivers).toHaveLength(1);
    expect(onQueued).toHaveBeenCalledWith(1);
    expect(manager.status()[0]?.queued).toBe(1);

    await manager.release(first.id);
    const second = await secondPromise;

    expect(first.isValid()).toBe(false);
    expect(second.isValid()).toBe(true);
    expect(second.ownerId).toBe('owner-b');
    // Reopened at the new owner's baud.
    expect(second.baud).toBe(9600);
    expect(drivers).toHaveLength(2);
    await manager.closeAll();
  });

  it('closes the previous port before opening the next one', async () => {
    const { manager, drivers } = harness();
    const first = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });
    const secondPromise = manager.acquire('owner-b', 'raw', { port: PORT, baud: 115200 });

    await manager.release(first.id);
    await secondPromise;

    // Invariant 4: the first driver is genuinely closed, not merely abandoned.
    expect(drivers[0]?.isOpen()).toBe(false);
    expect(drivers[1]?.isOpen()).toBe(true);
    await manager.closeAll();
  });

  it('refuses writes through a revoked lease', async () => {
    const { manager } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });
    await manager.release(lease.id);

    expect(lease.isValid()).toBe(false);
    await expect(lease.write(Buffer.from('x'))).rejects.toBeInstanceOf(LeaseRevokedError);
    await manager.closeAll();
  });

  it('treats a double release as a no-op', async () => {
    const { manager } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });
    await manager.release(lease.id);
    await expect(manager.release(lease.id)).resolves.toBeUndefined();
    await manager.closeAll();
  });

  it('drops a queued acquire when its signal aborts', async () => {
    const { manager } = harness();
    const first = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    const controller = new AbortController();
    const queued = manager.acquire('owner-b', 'raw', {
      port: PORT,
      baud: 115200,
      signal: controller.signal,
    });
    const rejection = expect(queued).rejects.toThrow(/aborted/);

    await flush();
    controller.abort();
    await rejection;

    expect(manager.status()[0]?.queued).toBe(0);
    await manager.release(first.id);
    await manager.closeAll();
  });
});

describe('SerialManager.withExclusive (upload preemption, §3.1/§3.5)', () => {
  it('preempts the live lease and tears it down before running', async () => {
    const { manager, drivers } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    const reason = vi.fn();
    lease.onRevoked(reason);

    let portWasClosedDuringUpload = false;
    await manager.withExclusive(PORT, async () => {
      portWasClosedDuringUpload = drivers.every((driver) => !driver.isOpen());
    });

    expect(reason).toHaveBeenCalledWith('preempted');
    expect(lease.isValid()).toBe(false);
    // The upload must never run while a handle is still open (§3.5 step 3).
    expect(portWasClosedDuringUpload).toBe(true);
    await manager.closeAll();
  });

  it('blocks new acquires while exclusive, then grants them afterwards', async () => {
    const { manager } = harness();
    let granted = false;

    // A gate stands in for the compile/upload work, so the exclusive window
    // stays open while we prove an acquire cannot slip in.
    let openTheGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openTheGate = resolve;
    });
    const uploadDone = manager.withExclusive(PORT, () => gate);

    const queued = manager.acquire('owner-b', 'raw', { port: PORT, baud: 115200 });
    void queued.then(() => {
      granted = true;
    });

    await flush();
    expect(granted).toBe(false);

    openTheGate();
    await uploadDone;

    const lease = await queued;
    expect(lease.isValid()).toBe(true);
    await manager.closeAll();
  });
});

describe('SerialManager device loss (§3.6)', () => {
  it('revokes the lease and rejects queued waiters when the board vanishes', async () => {
    const { manager, drivers } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    const lost = vi.fn();
    manager.onDeviceLost(lost);
    const revoked = vi.fn();
    lease.onRevoked(revoked);

    const queued = manager.acquire('owner-b', 'raw', { port: PORT, baud: 115200 });
    const rejection = expect(queued).rejects.toThrow(/no longer available/);
    await flush();

    drivers[0]?.simulateUnplug();
    await rejection;

    expect(revoked).toHaveBeenCalledWith('device-lost');
    expect(lease.isValid()).toBe(false);
    expect(lost).toHaveBeenCalledWith(PORT);
    await manager.closeAll();
  });

  it('surfaces board data to the lease owner', async () => {
    const { manager } = harness();
    const lease = await manager.acquire('owner-a', 'raw', { port: PORT, baud: 115200 });

    const chunks: Buffer[] = [];
    lease.onData((chunk) => chunks.push(chunk));
    await flush();

    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('ArduForge mock board ready');
    await manager.closeAll();
  });

  it('preserves binary payloads that are not valid UTF-8', async () => {
    // The Phase 1 gate reads Firmata's 0xF9 version report off the wire.
    const { manager } = harness();
    const lease = await manager.acquire('owner-a', 'firmata', { port: PORT, baud: 57600 });

    const chunks: Buffer[] = [];
    lease.onData((chunk) => chunks.push(chunk));
    await flush();

    expect(chunks[0]?.[0]).toBe(0xf9);
    await manager.closeAll();
  });
});
