/**
 * Process shutdown registry (BUILD_PLAN.md §3.3).
 *
 * Anything holding an OS handle — serial ports above all — registers a teardown
 * here. Phase 0 has no ports yet; the registry exists now so the SerialManager
 * in Phase 1 has an established place to hook into rather than bolting handlers
 * on later and missing a path.
 */

type TeardownFn = () => void | Promise<void>;

const teardowns = new Set<TeardownFn>();
let shuttingDown = false;

export function onShutdown(fn: TeardownFn): () => void {
  teardowns.add(fn);
  return () => teardowns.delete(fn);
}

async function runTeardowns(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[arduforge] ${signal} received — closing ${teardowns.size} resource(s)…`);

  for (const fn of teardowns) {
    try {
      await fn();
    } catch (error: unknown) {
      console.error('[arduforge] teardown failed:', error);
    }
  }
  console.log('[arduforge] shutdown complete.');
}

/**
 * Signals that mean "shut down", across platforms.
 *
 * Windows does not have POSIX signals. Node emulates SIGINT (Ctrl-C) and
 * SIGBREAK (Ctrl-Break) for a process attached to a console, and it accepts a
 * SIGTERM listener that will simply never fire, because nothing can deliver
 * one. Registering all three is correct rather than redundant: each platform
 * uses the subset it can deliver, and the serial port is released either way.
 *
 * SIGBREAK exists only on Windows and SIGHUP only off it, so the list is built
 * per platform rather than registered blind.
 */
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] =
  process.platform === 'win32'
    ? ['SIGINT', 'SIGBREAK', 'SIGTERM']
    : ['SIGINT', 'SIGTERM', 'SIGHUP'];

export function installShutdownHandlers(): void {
  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void runTeardowns(signal).then(() => process.exit(0));
    });
  }

  process.on('beforeExit', () => {
    void runTeardowns('beforeExit');
  });

  // A crash must still release the port, or the device needs a physical replug.
  process.on('uncaughtException', (error) => {
    console.error('[arduforge] uncaught exception:', error);
    void runTeardowns('uncaughtException').then(() => process.exit(1));
  });
}
