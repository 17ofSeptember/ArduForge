/**
 * Mirrors the server's HealthResponse (server/src/routes/health.ts).
 * Kept as a hand-written mirror for Phase 0; if this drifts more than once,
 * promote it to a shared workspace package rather than patching it.
 */

export interface CliVersion {
  readonly application: string;
  readonly version: string;
  readonly commit: string | null;
  readonly date: string | null;
  readonly supported: boolean;
}

export interface InstalledCore {
  readonly id: string;
  readonly maintainer: string | null;
  readonly installedVersion: string | null;
  readonly latestVersion: string | null;
}

export type IdentifiedBy = 'arduino-cli' | 'profile-table' | 'unidentified';

export interface BoardCandidate {
  readonly port: string;
  readonly vid: string | null;
  readonly pid: string | null;
  readonly serialNumber: string | null;
  readonly fqbn: string | null;
  readonly displayName: string;
  readonly identifiedBy: IdentifiedBy;
  readonly notes: string | null;
}

export interface HealthResponse {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly node: { readonly version: string; readonly ok: boolean };
  readonly arduinoCli:
    | { readonly installed: true; readonly version: CliVersion }
    | { readonly installed: false; readonly error: string };
  readonly cores: readonly InstalledCore[];
  readonly requiredCore: {
    readonly id: string;
    readonly installed: boolean;
    readonly version: string | null;
  };
  readonly boards: readonly BoardCandidate[];
  readonly warnings: readonly string[];
}

export async function fetchHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', { signal });
  if (!response.ok) {
    throw new Error(`Backend returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as HealthResponse;
}
