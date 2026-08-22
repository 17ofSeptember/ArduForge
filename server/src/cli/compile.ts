/**
 * arduino-cli compile / upload (BUILD_PLAN.md §Phase 2).
 *
 * arduino-cli 1.5.x already reports structured diagnostics (file/line/column/
 * severity), so those are used directly. The gcc text parser is a fallback for
 * the cases where it doesn't — a hard link error, or a future CLI that drops
 * the field — so a failure is never reported as an empty diagnostic list.
 */
import { execa } from 'execa';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { Build } from '@/build/store.js';

const COMPILE_TIMEOUT_MS = 180_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export type Severity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  readonly file: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly severity: Severity;
  readonly message: string;
  /** The source excerpt and caret gcc appends, if any. */
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
  readonly stdout: string;
  readonly stderr: string;
  readonly hexPath: string | null;
  readonly error: string | null;
}

const compileOutputSchema = z.object({
  compiler_out: z.string().default(''),
  compiler_err: z.string().default(''),
  success: z.boolean().default(false),
  error: z.string().optional(),
  builder_result: z
    .object({
      build_path: z.string().optional(),
      executable_sections_size: z
        .array(z.object({ name: z.string(), size: z.number(), max_size: z.number() }))
        .default([]),
      diagnostics: z
        .array(
          z.object({
            severity: z.string(),
            message: z.string(),
            file: z.string().optional(),
            line: z.number().optional(),
            column: z.number().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

function toSeverity(raw: string): Severity {
  const value = raw.toLowerCase();
  // gcc emits "fatal error" for things like a missing header, which is the most
  // common failure of all once libraries are involved. It must not read as a note.
  if (value.startsWith('err') || value.startsWith('fatal')) return 'error';
  if (value.startsWith('warn')) return 'warning';
  return 'note';
}

/**
 * gcc packs the source excerpt and caret into the same string as the message.
 * Split them so the UI can show a one-line message and an optional excerpt.
 */
export function splitMessage(raw: string): { message: string; snippet: string | null } {
  const newline = raw.indexOf('\n');
  if (newline === -1) return { message: raw.trim(), snippet: null };
  return {
    message: raw.slice(0, newline).trim(),
    snippet: raw.slice(newline + 1).replace(/\s+$/, ''),
  };
}

/** Just the fields path handling needs; a Build satisfies this structurally. */
export interface PathContext {
  readonly sketchDir: string;
  readonly sketchName: string;
}

/** Absolute temp paths mean nothing to the user; show the sketch-relative name. */
function relativise(file: string | undefined, build: PathContext): string {
  if (file === undefined || file === '') return `${build.sketchName}.ino`;
  return file.startsWith(build.sketchDir) ? basename(file) : file;
}

const GCC_LINE = /^(.*?):(\d+):(?:(\d+):)?\s*(error|warning|note|fatal error):\s*(.*)$/;

/** Fallback for when structured diagnostics are absent. */
export function parseCompilerErr(text: string, build: PathContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const rawLine of text.split('\n')) {
    const match = GCC_LINE.exec(rawLine.trim());
    if (match === null) continue;
    const [, file, line, column, severity, message] = match;
    diagnostics.push({
      file: relativise(file, build),
      line: line === undefined ? null : Number.parseInt(line, 10),
      column: column === undefined ? null : Number.parseInt(column, 10),
      severity: toSeverity(severity ?? 'error'),
      message: (message ?? '').trim(),
      snippet: null,
    });
  }
  return diagnostics;
}

function toSection(
  sizes: readonly { name: string; size: number; max_size: number }[],
  name: string,
): SectionSize | null {
  const found = sizes.find((section) => section.name === name);
  if (found === undefined || found.max_size <= 0) return null;
  return {
    name: found.name,
    used: found.size,
    max: found.max_size,
    percent: Math.round((found.size / found.max_size) * 1000) / 10,
  };
}

export async function compileSketch(
  build: Build,
  libraries: readonly string[],
  onLog?: (stream: 'out' | 'err', line: string) => void,
): Promise<CompileResult> {
  const args = [
    'compile',
    '--fqbn',
    build.fqbn,
    '--output-dir',
    build.outputDir,
    '--format',
    'json',
  ];
  for (const library of libraries) args.push('--library', library);
  args.push(build.sketchDir);

  onLog?.('out', `$ arduino-cli ${args.slice(0, -1).join(' ')} <sketch>`);

  let stdout = '';
  let exitFailed = false;
  try {
    const result = await execa('arduino-cli', args, { timeout: COMPILE_TIMEOUT_MS, reject: false });
    stdout = result.stdout;
    exitFailed = result.exitCode !== 0;
  } catch (error: unknown) {
    return {
      ok: false,
      buildId: build.id,
      diagnostics: [],
      program: null,
      data: null,
      stdout: '',
      stderr: '',
      hexPath: null,
      error: error instanceof Error ? error.message : 'arduino-cli could not be run.',
    };
  }

  let parsed: z.infer<typeof compileOutputSchema>;
  try {
    parsed = compileOutputSchema.parse(JSON.parse(stdout));
  } catch {
    return {
      ok: false,
      buildId: build.id,
      diagnostics: [],
      program: null,
      data: null,
      stdout,
      stderr: '',
      hexPath: null,
      error: 'arduino-cli returned output this build could not parse.',
    };
  }

  const builder = parsed.builder_result;
  const structured = builder?.diagnostics ?? [];
  let diagnostics: Diagnostic[] = structured.map((diagnostic) => {
    const { message, snippet } = splitMessage(diagnostic.message);
    return {
      file: relativise(diagnostic.file, build),
      line: diagnostic.line ?? null,
      column: diagnostic.column ?? null,
      severity: toSeverity(diagnostic.severity),
      message,
      snippet,
    };
  });

  if (diagnostics.length === 0 && parsed.compiler_err.trim() !== '') {
    diagnostics = parseCompilerErr(parsed.compiler_err, build);
  }

  const ok = parsed.success && !exitFailed;

  // A failure must never surface as "no problems found".
  if (!ok && diagnostics.length === 0) {
    diagnostics = [
      {
        file: `${build.sketchName}.ino`,
        line: null,
        column: null,
        severity: 'error',
        message: parsed.error ?? 'Compilation failed without a specific diagnostic.',
        snippet: parsed.compiler_err.trim() === '' ? null : parsed.compiler_err.trim(),
      },
    ];
  }

  for (const line of parsed.compiler_out.split('\n')) {
    if (line.trim() !== '') onLog?.('out', line);
  }
  for (const line of parsed.compiler_err.split('\n')) {
    if (line.trim() !== '') onLog?.('err', line);
  }

  const sizes = builder?.executable_sections_size ?? [];
  const hexPath = ok ? join(build.outputDir, `${build.sketchName}.ino.hex`) : null;
  if (ok) {
    build.hexPath = hexPath;
    build.compiled = true;
  }

  return {
    ok,
    buildId: build.id,
    diagnostics,
    program: toSection(sizes, 'text'),
    data: toSection(sizes, 'data'),
    stdout: parsed.compiler_out,
    stderr: parsed.compiler_err,
    hexPath,
    error: ok ? null : (parsed.error ?? 'Compilation failed.'),
  };
}

export interface UploadResult {
  readonly ok: boolean;
  readonly error: string | null;
}

/**
 * Runs avrdude. MUST be called inside SerialManager.withExclusive() — this
 * function does not take the port itself, and calling it without exclusivity
 * is the classic two-owners bug (§3.1).
 */
export async function uploadBuild(
  build: Build,
  port: string,
  onLog: (stream: 'out' | 'err', line: string) => void,
): Promise<UploadResult> {
  const args = [
    'upload',
    '-p',
    port,
    '--fqbn',
    build.fqbn,
    '--input-dir',
    build.outputDir,
    '--verbose',
  ];
  onLog('out', `$ arduino-cli ${args.join(' ')}`);

  try {
    const subprocess = execa('arduino-cli', args, {
      timeout: UPLOAD_TIMEOUT_MS,
      reject: false,
      buffer: false,
    });

    const pump = (stream: NodeJS.ReadableStream | undefined, which: 'out' | 'err') => {
      if (stream === undefined) return;
      let carry = '';
      stream.on('data', (chunk: Buffer) => {
        carry += chunk.toString('utf8');
        let index = carry.indexOf('\n');
        while (index !== -1) {
          const line = carry.slice(0, index).replace(/\r$/, '');
          carry = carry.slice(index + 1);
          if (line.trim() !== '') onLog(which, line);
          index = carry.indexOf('\n');
        }
      });
    };

    pump(subprocess.stdout ?? undefined, 'out');
    pump(subprocess.stderr ?? undefined, 'err');

    const result = await subprocess;
    if (result.exitCode !== 0) {
      return { ok: false, error: `arduino-cli upload exited with code ${result.exitCode}.` };
    }
    return { ok: true, error: null };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Upload failed.',
    };
  }
}
