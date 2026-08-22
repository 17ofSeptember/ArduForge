/**
 * arduino-cli compile wrapper for the fidelity harness (IMPORT.md §0.1 Gate 1).
 *
 * Separate from server/src/cli/arduinoCli.ts on purpose: that one is a request
 * handler with zod schemas and event streaming, this one is a batch tool that
 * wants a hex file and a cache. Sharing it would drag express plumbing into a
 * script.
 *
 * Determinism note, verified in Phase 0: for arduino:avr the emitted .hex is
 * byte-identical across different sketch folder names, file names, and build
 * paths given identical source. That is what makes Gate 1 a usable equality
 * test rather than a coin flip.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const DEFAULT_FQBN = 'arduino:avr:uno';

/** Generous: a cold core cache on the first sketch can take a while. */
const COMPILE_TIMEOUT_MS = 120_000;

export interface SketchFile {
  readonly name: string;
  readonly content: string;
}

export interface CompileResult {
  readonly ok: boolean;
  /** Intel HEX text, normalized. Null when the compile failed. */
  readonly hex: string | null;
  readonly hexSha: string | null;
  readonly stderr: string;
  readonly programBytes: number | null;
  readonly dataBytes: number | null;
}

/**
 * ASCII unit and record separators. Written as escapes rather than typed
 * literally so this file stays plain text — a raw control byte makes git treat
 * the source as binary and stop producing diffs. They cannot occur in a file
 * name or an FQBN, so no input can forge a collision by embedding the
 * delimiter in a field.
 */
const FIELD_SEP = '\u001F';
const RECORD_SEP = '\u001E';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Cache key covers everything that can change the output: every file's name and
 * content, plus the board. Name is in there because a sketch that uses __FILE__
 * would otherwise get a false cache hit.
 */
export function cacheKey(files: readonly SketchFile[], fqbn: string): string {
  const parts = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => `${file.name}${FIELD_SEP}${file.content}`);
  return sha256(`${fqbn}${FIELD_SEP}${parts.join(RECORD_SEP)}`);
}

/**
 * Intel HEX records carry no timestamps, but toolchains differ on trailing
 * newlines and case. Normalizing here means a cosmetic difference never gets
 * reported as a Gate 1 failure.
 */
function normalizeHex(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line.length > 0)
    .join('\n');
}

const SIZE_RE = /Sketch uses (\d+) bytes/;
const DATA_RE = /Global variables use (\d+) bytes/;

export interface CompileOptions {
  readonly fqbn?: string;
  /** Directory for the hex cache. Omit to disable caching. */
  readonly cacheDir?: string;
  /** Sketch folder name; arduino-cli requires the main .ino to match it. */
  readonly sketchName?: string;
}

export async function compileSketch(
  files: readonly SketchFile[],
  options: CompileOptions = {},
): Promise<CompileResult> {
  const fqbn = options.fqbn ?? DEFAULT_FQBN;
  const key = cacheKey(files, fqbn);

  if (options.cacheDir !== undefined) {
    const hit = await readCache(options.cacheDir, key);
    if (hit !== null) return hit;
  }

  const result = await compileUncached(files, fqbn, options.sketchName);

  if (options.cacheDir !== undefined) await writeCache(options.cacheDir, key, result);
  return result;
}

async function compileUncached(
  files: readonly SketchFile[],
  fqbn: string,
  sketchName: string | undefined,
): Promise<CompileResult> {
  const main = files.find((file) => file.name.endsWith('.ino'));
  if (main === undefined) {
    return { ok: false, hex: null, hexSha: null, stderr: 'No .ino file in sketch.', programBytes: null, dataBytes: null };
  }

  const folder = sketchName ?? basename(main.name, '.ino');
  const work = await mkdtemp(join(tmpdir(), 'arduforge-fidelity-'));
  const sketchDir = join(work, folder);
  const outDir = join(work, 'out');

  try {
    await mkdir(sketchDir, { recursive: true });
    // arduino-cli only accepts a folder whose main sketch matches its name.
    for (const file of files) {
      const name = file.name === main.name ? `${folder}.ino` : file.name;
      await writeFile(join(sketchDir, name), file.content, 'utf8');
    }

    let stdout = '';
    let stderr = '';
    try {
      const out = await run('arduino-cli', ['compile', '--fqbn', fqbn, '--output-dir', outDir, sketchDir], {
        timeout: COMPILE_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (error: unknown) {
      const shaped = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        hex: null,
        hexSha: null,
        stderr: shaped.stderr ?? shaped.message ?? 'arduino-cli failed',
        programBytes: null,
        dataBytes: null,
      };
    }

    // Never the .with_bootloader variant — it embeds the bootloader and would
    // compare equal even when the sketch differs in ways too small to notice.
    const produced = await readdir(outDir);
    const hexName = produced.find((name) => name.endsWith('.hex') && !name.includes('with_bootloader'));
    if (hexName === undefined) {
      return { ok: false, hex: null, hexSha: null, stderr: 'Compile produced no .hex', programBytes: null, dataBytes: null };
    }

    const hex = normalizeHex(await readFile(join(outDir, hexName), 'utf8'));
    const combined = `${stdout}\n${stderr}`;
    return {
      ok: true,
      hex,
      hexSha: sha256(hex),
      stderr,
      programBytes: numberFrom(combined, SIZE_RE),
      dataBytes: numberFrom(combined, DATA_RE),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function numberFrom(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

interface CachedCompile {
  readonly ok: boolean;
  readonly hex: string | null;
  readonly hexSha: string | null;
  readonly programBytes: number | null;
  readonly dataBytes: number | null;
  readonly stderr: string;
}

async function readCache(dir: string, key: string): Promise<CompileResult | null> {
  try {
    const raw = await readFile(join(dir, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as CachedCompile;
    return { ...parsed };
  } catch {
    return null;
  }
}

async function writeCache(dir: string, key: string, result: CompileResult): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    // Failed compiles are not cached: they are usually a missing library or a
    // half-installed core, and caching that makes the fix look like it failed.
    if (!result.ok) return;
    await writeFile(join(dir, `${key}.json`), JSON.stringify(result), 'utf8');
  } catch {
    // A broken cache must never fail a run.
  }
}

export async function arduinoCliAvailable(): Promise<string | null> {
  try {
    const { stdout } = await run('arduino-cli', ['version'], { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}
