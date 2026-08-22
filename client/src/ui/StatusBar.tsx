import { useEffect, useState } from 'react';
import { useDashboard } from '@/dashboard/store';
import { ConnectionDot, type ConnectionState } from '@/ui/primitives';
import type { Breakpoint } from '@/ui/useBreakpoint';

/**
 * Connection status bar (BUILD_PLAN.md §Phase 8): port, board, mode, latency,
 * and the free-SRAM estimate from the last compile.
 */
export interface LastBuild {
  readonly programUsed: number;
  readonly programMax: number;
  readonly dataUsed: number;
  readonly dataMax: number;
}

/** Set by the build actions so the bar can show it without prop drilling. */
let lastBuild: LastBuild | null = null;
const listeners = new Set<(build: LastBuild | null) => void>();

export function reportBuildSizes(build: LastBuild | null): void {
  lastBuild = build;
  for (const listener of listeners) listener(build);
}

function useLastBuild(): LastBuild | null {
  const [build, setBuild] = useState<LastBuild | null>(lastBuild);
  useEffect(() => {
    listeners.add(setBuild);
    return () => {
      listeners.delete(setBuild);
    };
  }, []);
  return build;
}

export function StatusBar({
  port,
  boardName,
  breakpoint,
}: {
  port: string | null;
  boardName: string | null;
  breakpoint: Breakpoint;
}) {
  const connected = useDashboard((state) => state.connected);
  const stale = useDashboard((state) => state.stale);
  const latency = useDashboard((state) => state.latencyMs);
  const linkMode = useDashboard((state) => state.linkMode);
  const build = useLastBuild();

  const mode = !connected ? 'Idle' : linkMode === 'firmata' ? 'Firmata' : 'AwryLink';
  const link: ConnectionState = !connected ? 'idle' : stale ? 'stale' : 'connected';

  // Free SRAM is what the compiler reports as left for locals and the stack.
  const freeSram = build === null ? null : build.dataMax - build.dataUsed;

  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-edge-subtle bg-panel px-3 py-1 font-mono text-[10px] text-content-secondary">
      <span className="flex items-center gap-1.5">
        <ConnectionDot state={link} pulse={stale} />
        {mode}
        {stale && <span className="text-[var(--conn-stale)]">stale</span>}
      </span>

      <span className="text-content-muted">|</span>
      <span>{port ?? 'no board'}</span>

      {boardName !== null && (
        <>
          <span className="text-content-muted">|</span>
          <span className="truncate">{boardName}</span>
        </>
      )}

      {connected && latency !== null && (
        <>
          <span className="text-content-muted">|</span>
          <span>{latency} ms</span>
        </>
      )}

      {build !== null && (
        <>
          <span className="text-content-muted">|</span>
          <span
            title="Flash used by the last build"
            className={build.programUsed / build.programMax > 0.9 ? 'text-warning' : undefined}
          >
            flash {Math.round((build.programUsed / build.programMax) * 100)}%
          </span>
          <span
            title="SRAM left for local variables and the stack"
            className={
              freeSram !== null && freeSram < 300 ? 'text-warning' : undefined
            }
          >
            free SRAM ~{freeSram} B
          </span>
        </>
      )}

      <span className="ml-auto text-content-muted">{breakpoint}</span>
      <span className="text-content-muted">press ? for shortcuts</span>
    </footer>
  );
}
