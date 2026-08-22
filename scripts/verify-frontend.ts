/**
 * Phase 1 gate (IMPORT.md §Phase 1).
 *
 *   "every Tier A and Tier B sketch preprocesses and parses without exception.
 *    Source map round-trips: pick 20 random AST nodes, resolve to original
 *    file/line, verify against the source text."
 *
 * Run across the whole corpus, not just A and B — Tier C is where the awkward
 * shapes live, and a source map that is off by one on a multi-tab sketch is
 * exactly the kind of thing that only shows up there.
 *
 * The node sample is seeded, so a failure is reproducible. A random sample that
 * cannot be replayed is a flake report, not a bug report.
 *
 * Run: npm run import:frontend
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { generate } from '@/codegen/generate';
import { parseCpp, type TsNode } from '@/import/grammar';
import { importSketch, stripGeneratedHeader } from '@/import/importSketch';
import { preflight } from '@/import/preflight';
import { preprocess } from '@/import/preprocess';
import { attachComments, allComments } from '@/import/comments';

const CORPUS = resolve('corpus');
const SAMPLE_SIZE = 20;

/** Mulberry32 — small, seeded, and good enough to pick array indices. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SketchCase {
  readonly tier: string;
  readonly name: string;
  readonly dir: string;
}

async function corpusSketches(): Promise<SketchCase[]> {
  const found: SketchCase[] = [];
  for (const tier of ['A', 'B', 'C']) {
    const dir = join(CORPUS, `tier${tier}`);
    let entries: string[];
    try {
      entries = (await readdir(dir)).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if ((await stat(full)).isDirectory()) found.push({ tier, name: entry, dir: full });
    }
  }
  return found;
}

async function inoFilesOf(dir: string): Promise<{ name: string; content: string }[]> {
  const names = (await readdir(dir)).filter((entry) => extname(entry) === '.ino').sort();
  const files: { name: string; content: string }[] = [];
  for (const name of names) files.push({ name, content: await readFile(join(dir, name), 'utf8') });
  return files;
}

interface CaseResult {
  readonly tier: string;
  readonly name: string;
  readonly parsed: boolean;
  readonly sampled: number;
  readonly mismatches: string[];
  readonly commentsFound: number;
  readonly commentsAttached: number;
  /** Comments that made it through lowering and back out of codegen. */
  readonly commentsSurvived: number;
  readonly lostComments: string[];
  readonly prototypes: number;
  readonly error: string | null;
}

/**
 * Comments are re-indented when codegen emits them inside a chain, so a literal
 * substring test would report false losses. Collapsing whitespace compares what
 * the comment *says* rather than how it happens to be laid out.
 */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Named nodes only: anonymous punctuation carries no position worth checking. */
function namedNodes(root: TsNode): TsNode[] {
  const found: TsNode[] = [];
  const walk = (node: TsNode): void => {
    if (node.isNamed && node.childCount === 0 && node.text.trim().length > 0) found.push(node);
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return found;
}

async function check(sketch: SketchCase): Promise<CaseResult> {
  const base = { tier: sketch.tier, name: sketch.name };
  try {
    const files = await inoFilesOf(sketch.dir);

    const problems = preflight(files);
    if (problems.length > 0) {
      return {
        ...base,
        parsed: false,
        sampled: 0,
        mismatches: [],
        commentsFound: 0,
        commentsAttached: 0,
        commentsSurvived: 0,
        lostComments: [],
        prototypes: 0,
        error: `pre-flight: ${problems[0]?.message ?? 'unterminated construct'}`,
      };
    }

    const pre = await preprocess(files, sketch.name);
    const { root } = await parseCpp(pre.text);

    const sources = new Map(files.map((file) => [file.name, file.content.split('\n')]));

    // ── the round-trip ──
    const candidates = namedNodes(root);
    const pick = rng(0xa11ce);
    const mismatches: string[] = [];
    let sampled = 0;

    for (let attempt = 0; attempt < SAMPLE_SIZE * 8 && sampled < SAMPLE_SIZE; attempt += 1) {
      const node = candidates[Math.floor(pick() * candidates.length)];
      if (node === undefined) continue;

      const position = pre.map.resolve(node.startIndex);
      // Synthetic text resolves to null by design; it is not a sample.
      if (position === null) continue;

      const line = sources.get(position.file)?.[position.line - 1];
      if (line === undefined) {
        mismatches.push(`${node.type} -> ${position.file}:${position.line} (no such line)`);
        sampled += 1;
        continue;
      }

      // resolve() gives the position where the node *starts*, so only its first
      // line can be checked against that source line. A block comment spanning
      // twenty lines still starts at exactly one place.
      const expected = node.text.split('\n')[0] ?? '';
      const actual = line.slice(position.column - 1, position.column - 1 + expected.length);
      if (actual !== expected) {
        mismatches.push(
          `${node.type} at ${position.file}:${position.line}:${position.column} — ` +
            `map says ${JSON.stringify(expected)}, source has ${JSON.stringify(actual)}`,
        );
      }
      sampled += 1;
    }

    // ── comments, which no fidelity gate can catch ──
    //
    // Gate 1 is blind to comments by construction, and idempotence only catches
    // them *accumulating*, never being lost — a graph that drops every comment
    // round-trips perfectly. So survival through lowering and re-emission is
    // checked directly against the regenerated source.
    // ArduForge's own banner is not user content — the importer strips it, and
    // codegen writes a fresh one. Counting it as a lost comment would report a
    // failure for doing exactly the right thing. Tier A sketches are generated
    // output, so every one of them carries it.
    const { root: plain } = await parseCpp(stripGeneratedHeader(pre.concatenated));
    const attached = attachComments(plain);
    let attachedCount = 0;
    for (const entry of attached.values()) attachedCount += entry.leading.length + entry.trailing.length;

    const imported = await importSketch(files, { sketchName: sketch.name });
    const regenerated = flatten(generate([...imported.nodes], [...imported.edges], { projectName: sketch.name }).code);

    const originals = allComments(plain);
    const lost: string[] = [];
    for (const comment of originals) {
      if (regenerated.includes(flatten(comment.text))) continue;
      lost.push(flatten(comment.text).slice(0, 60));
    }

    return {
      ...base,
      parsed: true,
      sampled,
      mismatches,
      commentsFound: originals.length,
      commentsAttached: attachedCount,
      commentsSurvived: originals.length - lost.length,
      lostComments: lost.slice(0, 3),
      prototypes: pre.prototypes.length,
      error: null,
    };
  } catch (error: unknown) {
    return {
      ...base,
      parsed: false,
      sampled: 0,
      mismatches: [],
      commentsFound: 0,
      commentsAttached: 0,
      commentsSurvived: 0,
      lostComments: [],
      prototypes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── run ──────────────────────────────────────────────────────────────────────

const sketches = await corpusSketches();
console.log(`\nPhase 1 frontend verification — ${sketches.length} corpus sketches\n`);

const results: CaseResult[] = [];
for (const sketch of sketches) results.push(await check(sketch));

const pad = (text: string, width: number): string =>
  text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);

console.log(
  `  ${pad('sketch', 26)}${pad('parse', 8)}${pad('sampled', 9)}${pad('map', 8)}${pad('attached', 11)}${pad('survived', 11)}protos`,
);
console.log(`  ${'─'.repeat(84)}`);

let failed = 0;
for (const result of results) {
  const mapOk = result.mismatches.length === 0;
  const commentsOk = result.commentsFound === result.commentsAttached;
  const survivalOk = result.commentsSurvived === result.commentsFound;
  if (!result.parsed || !mapOk || !commentsOk || !survivalOk) failed += 1;

  console.log(
    `  ${pad(result.name, 26)}${pad(result.parsed ? 'ok' : 'FAIL', 8)}${pad(String(result.sampled), 9)}` +
      `${pad(mapOk ? 'ok' : `${result.mismatches.length} BAD`, 8)}` +
      `${pad(`${result.commentsAttached}/${result.commentsFound}${commentsOk ? '' : ' LOST'}`, 11)}` +
      `${pad(`${result.commentsSurvived}/${result.commentsFound}${survivalOk ? '' : ' LOST'}`, 11)}${result.prototypes}`,
  );

  if (result.error !== null) console.log(`      ${result.error}`);
  for (const mismatch of result.mismatches.slice(0, 3)) console.log(`      ${mismatch}`);
  for (const lost of result.lostComments) console.log(`      lost comment: ${lost}`);
}

const totalSampled = results.reduce((sum, result) => sum + result.sampled, 0);
const totalComments = results.reduce((sum, result) => sum + result.commentsFound, 0);
const totalAttached = results.reduce((sum, result) => sum + result.commentsAttached, 0);
const totalSurvived = results.reduce((sum, result) => sum + result.commentsSurvived, 0);

console.log(`\n  ${results.length - failed}/${results.length} sketches pass.`);
console.log(`  Source map: ${totalSampled} nodes resolved and verified against the original text.`);
console.log(`  Comments:   ${totalAttached}/${totalComments} attached, ${totalSurvived}/${totalComments} survived lowering and re-emission.`);

if (failed > 0) {
  console.log('\n  FRONTEND VERIFICATION FAILED\n');
  process.exit(1);
}
console.log('  Every sketch preprocesses, parses, and round-trips.\n');
