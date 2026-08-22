/**
 * Corpus runner (IMPORT.md §0.1).
 *
 * Prints the fidelity table across all three tiers and enforces
 * corpus/expectations.json, which holds the minimum number of sketches that
 * must pass each gate. Wired into `npm run check`, so the rule it enforces is
 * "a phase may not go backwards" rather than "everything must pass" — at the
 * Phase 0 baseline every threshold is zero and every gate fails, which is the
 * whole point of recording a baseline.
 *
 * Raise the thresholds as each phase lands. A phase that does not move the
 * number needs an explanation (§Non-negotiables 6).
 *
 * Run: npm run import:corpus
 *      npm run import:corpus -- --tier A --verbose
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

import { arduinoCliAvailable } from './import/compile.ts';
import { importFidelity, type FidelityResult, type Gate } from './import-fidelity.ts';

const CORPUS = resolve('corpus');
const CACHE = join(CORPUS, '.hexcache');
const EXPECTATIONS = join(CORPUS, 'expectations.json');

type Tier = 'A' | 'B' | 'C';
const TIERS: readonly Tier[] = ['A', 'B', 'C'];

const TIER_LABEL: Record<Tier, string> = {
  A: 'Tier A — ArduForge examples (ground truth known)',
  B: 'Tier B — Arduino bundled examples',
  C: 'Tier C — the wild (Raw nodes allowed, failure is not)',
};

interface Thresholds {
  readonly gate1: number;
  readonly gate2: number;
  readonly gate3: number;
  /** Tier A only — n/a everywhere else, so the threshold stays 0 there. */
  readonly structural: number;
  /** Percentage of imported nodes on native (non-Custom C++) nodes. */
  readonly coverage: number;
}

const GATES = ['gate1', 'gate2', 'gate3', 'structural'] as const;

/**
 * Gate 1 and Gate 3 are floors, not climbing numbers. Once whole-file fallback
 * lands in Phase 1, every sketch imports to a valid graph whose regenerated
 * source is byte-identical, so both sit at 100% and must never move again.
 * A drop is a hard stop — something became unimportable or stopped compiling —
 * not a threshold that was optimistically set.
 *
 * Coverage is the only ratcheting metric: it is what actually improves as
 * statement lowering, expression lowering, and pattern lifting land.
 */
const FLOOR_GATES = new Set<keyof Thresholds>(['gate1', 'gate3']);

interface Expectations {
  readonly phase: number;
  readonly note: string;
  readonly tiers: Record<Tier, Thresholds>;
}

// ── args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);
const value = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const onlyTier = value('--tier')?.toUpperCase() as Tier | undefined;
const verbose = has('--verbose');
const skipCompile = has('--skip-compile');
const record = has('--record');

// ── discovery ────────────────────────────────────────────────────────────────

async function sketchesIn(tier: Tier): Promise<string[]> {
  const dir = join(CORPUS, `tier${tier}`);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/** Compiles dominate the wall clock, and arduino-cli is single-threaded per run. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  });
  await Promise.all(runners);
  return results;
}

// ── table ────────────────────────────────────────────────────────────────────

const MARK: Record<Gate, string> = { pass: 'pass', fail: 'FAIL', 'n/a': ' —  ' };

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function printTier(tier: Tier, results: readonly FidelityResult[]): void {
  console.log(`\n${TIER_LABEL[tier]}`);
  if (results.length === 0) {
    console.log('  (no sketches — run npm run import:build-corpus)');
    return;
  }

  // Tier A is the only tier with a ground-truth graph to compare against.
  const showStructural = results.some((result) => result.structural !== 'n/a');

  console.log(
    `  ${pad('sketch', 24)} ${pad('G1', 5)}${pad('G2', 5)}${pad('G3', 5)}${showStructural ? pad('graph', 6) : ''} ${padLeft('native', 7)}${padLeft('raw', 5)}${padLeft('cov', 6)}  ${pad('tokens', 7)} notes`,
  );
  console.log(`  ${'─'.repeat(showStructural ? 102 : 96)}`);

  for (const result of results) {
    const tokens = result.tokenLoss === null ? '  —  ' : result.tokenLoss.ok ? '  ok ' : ' LOST';
    const note = result.failure ?? '';
    console.log(
      `  ${pad(result.sketch, 24)} ${pad(MARK[result.gate1], 5)}${pad(MARK[result.gate2], 5)}${pad(MARK[result.gate3], 5)}` +
        `${showStructural ? pad(MARK[result.structural], 6) : ''} ` +
        `${padLeft(String(result.coverage.native), 7)}${padLeft(String(result.coverage.raw), 5)}${padLeft(`${result.coverage.pct}%`, 6)}  ` +
        `${pad(tokens, 7)} ${note.slice(0, 44)}`,
    );

    // A Tier A sketch that passes Gate 1 but fails structurally is the case
    // worth seeing: the graph means the same thing but is not the graph the
    // .ino came from, and no other gate can tell you that.
    if (result.structural === 'fail' && result.structuralDetail !== null) {
      const headline = result.gate1 === 'pass' ? 'structural mismatch (Gate 1 passes — shape differs, meaning does not)' : 'structural mismatch';
      console.log(`      ${headline}`);
      console.log(
        result.structuralDetail
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n'),
      );
    }

    if (verbose && result.diff !== '') {
      console.log(
        result.diff
          .split('\n')
          .map((line) => `      ${line}`)
          .join('\n'),
      );
    }
  }
}

function count(results: readonly FidelityResult[], gate: keyof Thresholds): number {
  return results.filter((result) => result[gate] === 'pass').length;
}

/** n/a does not count against a rate — it means the gate could not run. */
function applicable(results: readonly FidelityResult[], gate: keyof Thresholds): number {
  return results.filter((result) => result[gate] !== 'n/a').length;
}

/**
 * Tier coverage is pooled across sketches rather than averaged per sketch, so a
 * five-node sketch cannot outweigh a two-hundred-node one.
 */
function coverageOf(results: readonly FidelityResult[]): number {
  let native = 0;
  let total = 0;
  for (const result of results) {
    native += result.coverage.native;
    total += result.coverage.native + result.coverage.raw;
  }
  return total === 0 ? 0 : Math.round((native / total) * 100);
}

// ── run ──────────────────────────────────────────────────────────────────────

const cli = await arduinoCliAvailable();
const compileAvailable = cli !== null && !skipCompile;
if (cli === null && !skipCompile) {
  console.warn('  ⚠ arduino-cli not found — Gate 1 and Gate 3 will report n/a.\n');
}

const expectations = JSON.parse(await readFile(EXPECTATIONS, 'utf8')) as Expectations;

console.log(`ArduForge import fidelity — corpus run (expectations recorded at Phase ${expectations.phase})`);
if (cli !== null) console.log(`${cli.split('\n')[0]}`);

const byTier = new Map<Tier, FidelityResult[]>();
const concurrency = Math.max(2, Math.min(6, cpus().length - 1));

for (const tier of TIERS) {
  if (onlyTier !== undefined && tier !== onlyTier) continue;
  const paths = await sketchesIn(tier);
  const results = await pool(paths, concurrency, (path) =>
    importFidelity(path, {
      cacheDir: CACHE,
      ...(compileAvailable ? {} : { skipCompile: true }),
    }),
  );
  byTier.set(tier, results);
  printTier(tier, results);
}

// ── divergences ──────────────────────────────────────────────────────────────

const divergences = [...byTier.values()].flat().flatMap((result) =>
  result.divergences.map((divergence) => ({ sketch: result.sketch, divergence })),
);
if (divergences.length > 0) {
  console.log('\nSEMANTIC-DIVERGENCE');
  for (const { sketch, divergence } of divergences) {
    console.log(`  ${sketch}  ${divergence.file}:${divergence.line}  ${divergence.message}`);
  }
}

// ── totals ───────────────────────────────────────────────────────────────────

console.log('\nTotals');
console.log(
  `  ${pad('tier', 8)}${pad('sketches', 10)}${pad('Gate 1 ▲', 14)}${pad('Gate 2', 14)}${pad('Gate 3 ▲', 14)}${padLeft('cov', 6)}`,
);
console.log(`  ${'─'.repeat(72)}`);

const failures: string[] = [];
let totalSketches = 0;
let totalGate3 = 0;

for (const tier of TIERS) {
  const results = byTier.get(tier);
  if (results === undefined) continue;
  totalSketches += results.length;
  totalGate3 += count(results, 'gate3');

  const cell = (gate: keyof Thresholds): string => {
    const passed = count(results, gate);
    const total = applicable(results, gate);
    const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
    return `${passed}/${total} (${pct}%)`;
  };

  const structuralCell = applicable(results, 'structural') === 0 ? '' : `  graph ${cell('structural')}`;
  console.log(
    `  ${pad(tier, 8)}${pad(String(results.length), 10)}${pad(cell('gate1'), 14)}${pad(cell('gate2'), 14)}${pad(cell('gate3'), 14)}${padLeft(`${coverageOf(results)}%`, 6)}${structuralCell}`,
  );

  const threshold = expectations.tiers[tier];
  for (const gate of GATES) {
    const passed = count(results, gate);
    const minimum = threshold[gate];
    if (passed < minimum) {
      const label = FLOOR_GATES.has(gate) ? 'HARD STOP' : 'regression';
      failures.push(
        `[${label}] Tier ${tier} ${gate}: ${passed} passing, floor is ${minimum}` +
          (FLOOR_GATES.has(gate)
            ? ' — a sketch stopped importing to a byte-identical, compiling graph'
            : ''),
      );
    }
  }

  const coverage = coverageOf(results);
  if (coverage < threshold.coverage) {
    failures.push(
      `[regression] Tier ${tier} coverage: ${coverage}%, ratchet is ${threshold.coverage}% — ` +
        'statements moved off native nodes onto Custom C++',
    );
  }
}

const overall = totalSketches === 0 ? 0 : Math.round((totalGate3 / totalSketches) * 100);
console.log(`\n  Overall Gate 3 (the floor): ${totalGate3}/${totalSketches} (${overall}%)`);

// ── expectations ─────────────────────────────────────────────────────────────

if (record) {
  const updated: Expectations = {
    ...expectations,
    tiers: Object.fromEntries(
      TIERS.map((tier) => {
        const results = byTier.get(tier) ?? [];
        return [
          tier,
          {
            ...(Object.fromEntries(GATES.map((gate) => [gate, count(results, gate)])) as unknown as Thresholds),
            coverage: coverageOf(results),
          },
        ];
      }),
    ) as Record<Tier, Thresholds>,
  };
  await writeFile(EXPECTATIONS, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  console.log('\n  Expectations re-recorded from this run.');
  process.exit(0);
}

if (failures.length > 0) {
  console.log('\n  REGRESSION');
  for (const failure of failures) console.log(`    ${failure}`);
  console.log('\n  If this drop is intentional, rerun with --record to move the baseline.');
  process.exit(1);
}

console.log('\n  No regression against recorded expectations.');
