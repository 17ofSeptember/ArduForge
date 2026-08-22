/**
 * The fidelity harness (IMPORT.md §0.1).
 *
 * This is the judge every later phase reports against, so it is deliberately
 * built before any importer exists. Right now every gate fails through
 * ImporterNotImplementedError — that is the Phase 0 baseline and the number to
 * beat.
 *
 * Three gates, descending strength:
 *
 *   Gate 1  compile both, compare .hex          the real definition of identical
 *   Gate 2  normalized AST equivalence          "the difference is cosmetic"
 *   Gate 3  regenerates, compiles, graph valid  the floor
 *
 * Run one sketch:   npm run import:fidelity -- corpus/tierB/Blink
 * Run the corpus:   npm run import:corpus
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '@/codegen/generate';
import { sketchFilesFor } from '@/codegen/sketchFiles';
import type { GraphSnapshot } from '@/graph/model';
import { validateGraph } from '@/graph/validate';
import {
  importSketch,
  ImporterNotImplementedError,
  type ImportInputFile,
  type ImportResult,
  type SemanticDivergence,
} from '@/import/importSketch';

import { compareAst } from './import/ast.ts';
import { checkTokenLoss, type TokenLoss } from './import/ast.ts';
import { compileSketch, DEFAULT_FQBN, type SketchFile } from './import/compile.ts';
import { unifiedDiff } from './import/diff.ts';
import { compareGraphs } from './import/graphCompare.ts';

export type Gate = 'pass' | 'fail' | 'n/a';

export interface Coverage {
  readonly native: number;
  readonly raw: number;
  readonly pct: number;
}

export interface FidelityResult {
  readonly sketch: string;
  readonly gate1: Gate;
  readonly gate2: Gate;
  readonly gate3: Gate;
  /**
   * Tier A only: does the imported graph match the graph the .ino was generated
   * from? n/a when no ground-truth .forge sits beside the sketch. This is the
   * tightest check in the harness — it is the one tier where the right answer
   * is known rather than inferred (§0.2).
   */
  readonly structural: Gate;
  readonly structuralDetail: string | null;
  readonly coverage: Coverage;
  readonly divergences: readonly SemanticDivergence[];
  readonly diff: string;
  /** Non-negotiable #1: every token of the original survives into the output. */
  readonly tokenLoss: TokenLoss | null;
  /** First thing that went wrong, for the table's failure column. */
  readonly failure: string | null;
  readonly originalHexSha: string | null;
  readonly regeneratedHexSha: string | null;
  readonly ms: number;
}

export interface FidelityOptions {
  readonly fqbn?: string;
  readonly cacheDir?: string;
  /** Skip compiles entirely. Gate 1 reports n/a; useful when arduino-cli is absent. */
  readonly skipCompile?: boolean;
}

// ── loading a sketch folder ──────────────────────────────────────────────────

export interface LoadedSketch {
  readonly name: string;
  readonly files: readonly ImportInputFile[];
  /** The .ino files concatenated in Arduino's order — what the user's code *is*. */
  readonly source: string;
  /** Companion .h/.cpp files. Out of scope for v1 import, but they must compile. */
  readonly companions: readonly SketchFile[];
  /** Tier A ground truth: the graph this sketch was generated from. */
  readonly groundTruth: GraphSnapshot | null;
}

/**
 * Arduino's concatenation order: the .ino matching the folder name first, then
 * the rest alphabetically. Replicated here because Gate 2 compares against the
 * source the compiler actually saw, not the files as they sit on disk.
 */
export async function loadSketch(sketchPath: string): Promise<LoadedSketch> {
  const full = resolve(sketchPath);
  const info = await stat(full);

  if (!info.isDirectory()) {
    const content = await readFile(full, 'utf8');
    const name = basename(full, '.ino');
    return {
      name,
      files: [{ name: basename(full), content }],
      source: content,
      companions: [],
      groundTruth: null,
    };
  }

  const folder = basename(full);
  const entries = (await readdir(full)).sort();

  const inoNames = entries.filter((entry) => extname(entry) === '.ino');
  inoNames.sort((a, b) => {
    if (a === `${folder}.ino`) return -1;
    if (b === `${folder}.ino`) return 1;
    return a.localeCompare(b);
  });

  const files: ImportInputFile[] = [];
  for (const name of inoNames) {
    files.push({ name, content: await readFile(join(full, name), 'utf8') });
  }

  const companions: SketchFile[] = [];
  for (const name of entries) {
    const ext = extname(name);
    if (ext !== '.h' && ext !== '.cpp' && ext !== '.hpp' && ext !== '.c') continue;
    companions.push({ name, content: await readFile(join(full, name), 'utf8') });
  }

  const forgeName = entries.find((entry) => extname(entry) === '.forge');
  let groundTruth: GraphSnapshot | null = null;
  if (forgeName !== undefined) {
    const raw = JSON.parse(await readFile(join(full, forgeName), 'utf8')) as { graph?: GraphSnapshot };
    groundTruth = raw.graph ?? null;
  }

  return {
    name: folder,
    files,
    source: files.map((file) => file.content).join('\n'),
    companions,
    groundTruth,
  };
}

// ── the harness ──────────────────────────────────────────────────────────────

export async function importFidelity(
  sketchPath: string,
  options: FidelityOptions = {},
): Promise<FidelityResult> {
  const started = Date.now();
  const sketch = await loadSketch(sketchPath);
  const fqbn = options.fqbn ?? DEFAULT_FQBN;

  const compileOptions = {
    fqbn,
    ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
  };

  const fail = (failure: string, extra: Partial<FidelityResult> = {}): FidelityResult => ({
    sketch: sketch.name,
    gate1: 'fail',
    gate2: 'fail',
    gate3: 'fail',
    structural: sketch.groundTruth === null ? 'n/a' : 'fail',
    structuralDetail: null,
    coverage: { native: 0, raw: 0, pct: 0 },
    divergences: [],
    diff: '',
    tokenLoss: null,
    failure,
    originalHexSha: null,
    regeneratedHexSha: null,
    ms: Date.now() - started,
    ...extra,
  });

  // ── import ──
  let imported: ImportResult;
  try {
    imported = await importSketch(sketch.files, { sketchName: sketch.name });
  } catch (error: unknown) {
    const message =
      error instanceof ImporterNotImplementedError
        ? 'importer not implemented (Phase 0 baseline)'
        : `import threw: ${error instanceof Error ? error.message : String(error)}`;
    return fail(message);
  }

  const coverage = coverageOf(imported);

  // Tier A: the .ino was generated from a known graph, so the import must land
  // back on that graph — not merely on something that means the same thing.
  const structuralResult =
    sketch.groundTruth === null
      ? null
      : compareGraphs(sketch.groundTruth, { nodes: imported.nodes, edges: imported.edges });
  const structural: Gate =
    structuralResult === null ? 'n/a' : structuralResult.equal ? 'pass' : 'fail';

  // ── regenerate ──
  const generated = generate([...imported.nodes], [...imported.edges], { projectName: sketch.name, fqbn });
  const problems = validateGraph([...imported.nodes], [...imported.edges]);
  const errors = problems.filter((problem) => problem.severity === 'error');

  if (!generated.ok || errors.length > 0) {
    const first = errors[0]?.message ?? generated.problems[0]?.message ?? 'codegen reported failure';
    return fail(`graph invalid: ${first}`, { coverage, divergences: imported.report.divergences });
  }

  const regenerated = generated.code;
  const diff = unifiedDiff(sketch.source, regenerated, {
    labelA: `${sketch.name} (original)`,
    labelB: `${sketch.name} (regenerated)`,
  });

  // ── Gate 2 and the token check ──
  const [ast, tokenLoss] = await Promise.all([
    compareAst(sketch.source, regenerated),
    checkTokenLoss(sketch.source, regenerated),
  ]);
  const gate2: Gate = ast.equal ? 'pass' : 'fail';

  // ── Gates 1 and 3 ──
  if (options.skipCompile === true) {
    return {
      sketch: sketch.name,
      gate1: 'n/a',
      gate2,
      gate3: 'pass',
      structural,
      structuralDetail: structuralResult?.detail ?? null,
      coverage,
      divergences: imported.report.divergences,
      diff,
      tokenLoss,
      failure: gate2 === 'pass' ? null : (ast.detail ?? 'AST differs'),
      originalHexSha: null,
      regeneratedHexSha: null,
      ms: Date.now() - started,
    };
  }

  const originalFiles: SketchFile[] = [
    ...sketch.files.map((file) => ({ name: file.name, content: file.content })),
    ...sketch.companions,
  ];
  // sketchFilesFor adds the AwryLink firmware when the graph exposes variables;
  // without it a sketch that exposes anything fails on a missing header. The
  // original's companions may include those same files, so codegen's copies win
  // — they are the ones that match the code being compiled.
  const regeneratedFiles = dedupeByName([
    ...sketchFilesFor(generated).map((file) => ({ name: file.name, content: file.content })),
    ...sketch.companions,
  ]);

  const [before, after] = await Promise.all([
    compileSketch(originalFiles, { ...compileOptions, sketchName: sketch.name }),
    compileSketch(regeneratedFiles, { ...compileOptions, sketchName: sketch.name }),
  ]);

  const gate3: Gate = after.ok ? 'pass' : 'fail';

  // An original that will not compile cannot anchor a hex comparison. That is a
  // corpus problem, not an importer verdict, so Gate 1 reports n/a rather than
  // blaming the importer for it.
  let gate1: Gate;
  if (!before.ok) gate1 = 'n/a';
  else if (!after.ok) gate1 = 'fail';
  else gate1 = before.hexSha === after.hexSha ? 'pass' : 'fail';

  const failure =
    gate3 === 'fail'
      ? `regenerated will not compile: ${firstLine(after.stderr)}`
      : gate1 === 'fail'
        ? 'hex differs from original'
        : gate1 === 'n/a' && !before.ok
          ? `original will not compile: ${firstLine(before.stderr)}`
          : gate2 === 'fail'
            ? (ast.detail ?? 'AST differs')
            : null;

  return {
    sketch: sketch.name,
    gate1,
    gate2,
    gate3,
    structural,
    structuralDetail: structuralResult?.detail ?? null,
    coverage,
    divergences: imported.report.divergences,
    diff,
    tokenLoss,
    failure,
    originalHexSha: before.hexSha,
    regeneratedHexSha: after.hexSha,
    ms: Date.now() - started,
  };
}

/** First occurrence of each name wins. */
function dedupeByName(files: readonly SketchFile[]): SketchFile[] {
  const seen = new Set<string>();
  const kept: SketchFile[] = [];
  for (const file of files) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    kept.push(file);
  }
  return kept;
}

/**
 * Coverage is measured in *statements*, not nodes (§Phase 6's report is
 * "71 statements, 62 native"). Counting nodes would let the two entry nodes
 * every sketch has flatter the number — a whole-file fallback would score 40%
 * while lowering nothing at all.
 */
function coverageOf(result: ImportResult): Coverage {
  const { native, raw } = result.report;
  const total = native + raw;
  return { native, raw, pct: total === 0 ? 0 : Math.round((native / total) * 100) };
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0) ?? '';
  return line.trim().slice(0, 120);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const target = process.argv[2];
  if (target === undefined) {
    console.error('usage: npm run import:fidelity -- <sketch-path>');
    process.exit(2);
  }

  const result = await importFidelity(target, { cacheDir: resolve('corpus/.hexcache') });

  console.log(`\n${result.sketch}`);
  console.log(`  Gate 1 (hex)      ${result.gate1}`);
  console.log(`  Gate 2 (AST)      ${result.gate2}`);
  console.log(`  Gate 3 (compiles) ${result.gate3}`);
  if (result.structural !== 'n/a') {
    console.log(`  Tier A structural ${result.structural}`);
    if (result.structuralDetail !== null) {
      console.log(result.structuralDetail.split('\n').map((line) => `      ${line}`).join('\n'));
    }
  }
  console.log(`  coverage          ${result.coverage.native} native / ${result.coverage.raw} raw (${result.coverage.pct}%)`);
  if (result.tokenLoss !== null) {
    console.log(
      `  tokens            ${result.tokenLoss.ok ? 'none lost' : `${result.tokenLoss.missing.length} missing: ${result.tokenLoss.missing.slice(0, 8).join(' ')}`}`,
    );
  }
  if (result.failure !== null) console.log(`  failure           ${result.failure}`);
  for (const divergence of result.divergences) {
    console.log(`  SEMANTIC-DIVERGENCE ${divergence.file}:${divergence.line} ${divergence.message}`);
  }
  if (result.diff !== '') console.log(`\n${result.diff}`);

  process.exit(result.gate3 === 'pass' ? 0 : 1);
}
