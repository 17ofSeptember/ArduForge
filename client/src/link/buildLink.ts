/**
 * /ws/build client plus the compile and upload REST calls (§Phase 2).
 */
import { createSocketClient } from '@/link/socketClient';

export type BuildPhase = 'compile' | 'upload';

export type BuildEvent =
  | { t: 'build:start'; buildId: string; phase: BuildPhase }
  | { t: 'build:log'; buildId: string; stream: 'out' | 'err'; line: string }
  | { t: 'build:step'; buildId: string; phase: BuildPhase; message: string }
  | { t: 'build:done'; buildId: string; phase: BuildPhase; ok: boolean; message: string | null };

/** The build channel is receive-only. */
export const buildLink = createSocketClient<BuildEvent, never>('/ws/build');

if (import.meta.hot) {
  import.meta.hot.dispose(() => buildLink.destroy());
}

export type Severity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  readonly file: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly severity: Severity;
  readonly message: string;
  readonly snippet: string | null;
}

export interface SectionSize {
  readonly name: string;
  readonly used: number;
  readonly max: number;
  readonly percent: number;
}

export interface CompileResult {
  readonly ok: boolean;
  readonly buildId: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly program: SectionSize | null;
  readonly data: SectionSize | null;
  readonly hexPath: string | null;
  readonly error: string | null;
}

export interface UploadResult {
  readonly ok: boolean;
  readonly error: string | null;
}

export interface SketchFile {
  readonly name: string;
  readonly content: string;
}

export async function compile(
  files: readonly SketchFile[],
  fqbn: string,
  libraries: readonly string[] = [],
): Promise<CompileResult> {
  const response = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, fqbn, libraries }),
  });
  const payload = (await response.json()) as Partial<CompileResult> & { error?: string };
  if (!response.ok && payload.buildId === undefined) {
    throw new Error(payload.error ?? `Compile request failed (${response.status}).`);
  }
  return payload as CompileResult;
}

export async function upload(buildId: string, port: string): Promise<UploadResult> {
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buildId, port }),
  });
  const payload = (await response.json()) as UploadResult;
  if (!response.ok) {
    return { ok: false, error: payload.error ?? `Upload request failed (${response.status}).` };
  }
  return payload;
}

// ── libraries ────────────────────────────────────────────────────────────────

export interface LibraryCheck {
  readonly missing: readonly string[];
  readonly error?: string;
}

export async function checkLibraries(required: readonly string[]): Promise<LibraryCheck> {
  if (required.length === 0) return { missing: [] };
  const response = await fetch('/api/libraries/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ required }),
  });
  return (await response.json()) as LibraryCheck;
}

export async function installLibrary(name: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/libraries/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await response.json()) as { ok: boolean; error?: string };
}
