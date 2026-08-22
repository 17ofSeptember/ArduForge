/**
 * Assembles the import corpus (IMPORT.md §0.2).
 *
 * Tier A is generated from the bundled examples, so it is regenerated here
 * rather than hand-maintained — a Tier A sketch that drifts from its example is
 * a test of nothing. Tier B is copied from the Arduino IDE and Servo library
 * installs, with provenance recorded so a missing install is an obvious error
 * rather than a silently shrunken corpus. Tier C is hand-written and lives in
 * the repo; this script only indexes and verifies it.
 *
 * Every sketch is compiled here and its .hex hash recorded in the manifest.
 * That makes the corpus self-verifying — an entry that cannot compile is caught
 * at assembly time, not blamed on the importer three phases later.
 *
 * Run: npm run import:build-corpus
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { examples } from '@/examples/index';
import { generate } from '@/codegen/generate';
import { sketchFilesFor } from '@/codegen/sketchFiles';
import { FORGE_VERSION } from '@/store/persistence';

import { arduinoCliAvailable, compileSketch, DEFAULT_FQBN, type SketchFile } from './import/compile.ts';

const ROOT = resolve('.');
const CORPUS = join(ROOT, 'corpus');
const CACHE = join(CORPUS, '.hexcache');

const IDE_EXAMPLES =
  '/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/Examples';
const SKETCHBOOK_LIBS = join(process.env['HOME'] ?? '', 'Documents/Arduino/libraries');

// ── Tier B sources ───────────────────────────────────────────────────────────

interface TierBSource {
  readonly name: string;
  readonly from: string;
  readonly note?: string;
}

/**
 * The §0.2 minimum list. Sweep and Knob ship with the Servo library rather than
 * the IDE; ShiftOut is a web tutorial that Arduino IDE 2.x stopped bundling, so
 * it is transcribed below and labelled as such.
 */
const TIER_B: readonly TierBSource[] = [
  { name: 'BareMinimum', from: join(IDE_EXAMPLES, '01.Basics/BareMinimum') },
  { name: 'Blink', from: join(IDE_EXAMPLES, '01.Basics/Blink') },
  { name: 'DigitalReadSerial', from: join(IDE_EXAMPLES, '01.Basics/DigitalReadSerial') },
  { name: 'AnalogReadSerial', from: join(IDE_EXAMPLES, '01.Basics/AnalogReadSerial') },
  { name: 'Fade', from: join(IDE_EXAMPLES, '01.Basics/Fade') },
  { name: 'Button', from: join(IDE_EXAMPLES, '02.Digital/Button') },
  { name: 'Debounce', from: join(IDE_EXAMPLES, '02.Digital/Debounce') },
  { name: 'StateChangeDetection', from: join(IDE_EXAMPLES, '02.Digital/StateChangeDetection') },
  { name: 'BlinkWithoutDelay', from: join(IDE_EXAMPLES, '02.Digital/BlinkWithoutDelay') },
  { name: 'toneMelody', from: join(IDE_EXAMPLES, '02.Digital/toneMelody'), note: 'has a companion pitches.h' },
  { name: 'AnalogInOutSerial', from: join(IDE_EXAMPLES, '03.Analog/AnalogInOutSerial') },
  { name: 'Calibration', from: join(IDE_EXAMPLES, '03.Analog/Calibration') },
  { name: 'Smoothing', from: join(IDE_EXAMPLES, '03.Analog/Smoothing'), note: 'array + running total' },
  { name: 'RowColumnScanning', from: join(IDE_EXAMPLES, '07.Display/RowColumnScanning'), note: '2D array' },
  { name: 'Sweep', from: join(SKETCHBOOK_LIBS, 'Servo/examples/Sweep'), note: 'Servo component' },
  { name: 'Knob', from: join(SKETCHBOOK_LIBS, 'Servo/examples/Knob'), note: 'Servo component' },
];

/** Kept in source because Arduino IDE 2.x no longer ships it. */
const SHIFT_OUT = `// ShiftOut — 74HC595 shift register, one byte at a time.
//
// Transcribed for the ArduForge import corpus: Arduino IDE 2.x no longer
// bundles this example, but it is still one of the most-pasted sketches for
// anyone driving more outputs than the board has pins.

int latchPin = 8;
int clockPin = 12;
int dataPin = 11;

void setup() {
  pinMode(latchPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(dataPin, OUTPUT);
}

void loop() {
  for (int numberToDisplay = 0; numberToDisplay < 256; numberToDisplay++) {
    digitalWrite(latchPin, LOW);
    shiftOut(dataPin, clockPin, MSBFIRST, numberToDisplay);
    digitalWrite(latchPin, HIGH);
    delay(500);
  }
}
`;

// ── manifest ─────────────────────────────────────────────────────────────────

interface ManifestEntry {
  readonly tier: 'A' | 'B' | 'C';
  readonly name: string;
  readonly path: string;
  readonly provenance: string;
  readonly note: string | null;
  readonly lines: number;
  readonly compiles: boolean;
  readonly originalHexSha: string | null;
  readonly programBytes: number | null;
  readonly dataBytes: number | null;
  readonly groundTruth: string | null;
  readonly error: string | null;
}

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join('');
}

// ── Tier A ───────────────────────────────────────────────────────────────────

async function buildTierA(): Promise<{ name: string; dir: string; provenance: string }[]> {
  const tierDir = join(CORPUS, 'tierA');
  await rm(tierDir, { recursive: true, force: true });
  await mkdir(tierDir, { recursive: true });

  const built: { name: string; dir: string; provenance: string }[] = [];

  for (const example of examples) {
    const name = pascal(example.name);
    const graph = example.build();
    const result = generate([...graph.nodes], [...graph.edges], {
      projectName: example.name,
      fqbn: DEFAULT_FQBN,
    });

    if (!result.ok) {
      throw new Error(
        `Example "${example.id}" does not generate — the corpus cannot be built from a broken example.\n` +
          result.problems.map((problem) => `  ${problem.severity}: ${problem.message}`).join('\n'),
      );
    }

    const dir = join(tierDir, name);
    await mkdir(dir, { recursive: true });

    // Most examples expose variables for their dashboard, which makes codegen
    // emit `#include "AwryLink.h"`. sketchFilesFor carries the firmware along;
    // without it ten of the eleven Tier A sketches fail to compile on a missing
    // header and Gate 1 has nothing to anchor to.
    for (const file of sketchFilesFor(result)) {
      const fileName = file.name === 'Sketch.ino' ? `${name}.ino` : file.name;
      await writeFile(join(dir, fileName), file.content, 'utf8');
    }

    // The ground truth Tier A compares against: the exact graph the .ino came
    // from, in .forge shape so it can be opened in the app when a case fails.
    const project = {
      version: FORGE_VERSION,
      meta: { name: example.name, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' },
      board: { fqbn: DEFAULT_FQBN },
      graph: { nodes: graph.nodes, edges: graph.edges },
      dashboard: { pages: [], widgets: [] },
      settings: {},
    };
    await writeFile(join(dir, `${name}.forge`), `${JSON.stringify(project, null, 2)}\n`, 'utf8');

    built.push({ name, dir, provenance: `generated from examples/${example.id}` });
  }

  return built;
}

// ── Tier B ───────────────────────────────────────────────────────────────────

async function buildTierB(): Promise<{ name: string; dir: string; provenance: string; note: string | null }[]> {
  const tierDir = join(CORPUS, 'tierB');
  await rm(tierDir, { recursive: true, force: true });
  await mkdir(tierDir, { recursive: true });

  const built: { name: string; dir: string; provenance: string; note: string | null }[] = [];
  const missing: string[] = [];

  for (const source of TIER_B) {
    let exists = false;
    try {
      exists = (await stat(source.from)).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(`${source.name} (expected at ${source.from})`);
      continue;
    }

    const dir = join(tierDir, source.name);
    await mkdir(dir, { recursive: true });
    // Sketches only — the IDE examples ship .png and .txt alongside.
    for (const entry of await readdir(source.from)) {
      if (!/\.(ino|h|hpp|c|cpp)$/.test(entry)) continue;
      await cp(join(source.from, entry), join(dir, entry));
    }
    built.push({
      name: source.name,
      dir,
      provenance: `copied from ${source.from}`,
      note: source.note ?? null,
    });
  }

  const shiftDir = join(tierDir, 'ShiftOut');
  await mkdir(shiftDir, { recursive: true });
  await writeFile(join(shiftDir, 'ShiftOut.ino'), SHIFT_OUT, 'utf8');
  built.push({
    name: 'ShiftOut',
    dir: shiftDir,
    provenance: 'transcribed from the Arduino ShiftOut tutorial (not bundled in Arduino IDE 2.x)',
    note: 'nested loop + shiftOut()',
  });

  if (missing.length > 0) {
    console.warn(
      `\n  ⚠ ${missing.length} Tier B source(s) not found on this machine:\n` +
        missing.map((entry) => `      ${entry}`).join('\n') +
        '\n    Install the Arduino IDE and `arduino-cli lib install Servo`, then rerun.\n',
    );
  }

  return built;
}

// ── verification ─────────────────────────────────────────────────────────────

async function loadFiles(dir: string): Promise<SketchFile[]> {
  const files: SketchFile[] = [];
  for (const entry of (await readdir(dir)).sort()) {
    if (!/\.(ino|h|hpp|c|cpp)$/.test(entry)) continue;
    files.push({ name: entry, content: await readFile(join(dir, entry), 'utf8') });
  }
  return files;
}

async function verify(
  tier: 'A' | 'B' | 'C',
  entry: { name: string; dir: string; provenance: string; note?: string | null },
): Promise<ManifestEntry> {
  const files = await loadFiles(entry.dir);
  const main = files.find((file) => file.name.endsWith('.ino'));
  const lines = main === undefined ? 0 : main.content.split('\n').length;

  const result = await compileSketch(files, { cacheDir: CACHE, sketchName: entry.name });
  const groundTruth = (await readdir(entry.dir)).find((file) => file.endsWith('.forge')) ?? null;

  return {
    tier,
    name: entry.name,
    path: entry.dir.slice(ROOT.length + 1),
    provenance: entry.provenance,
    note: entry.note ?? null,
    lines,
    compiles: result.ok,
    originalHexSha: result.hexSha,
    programBytes: result.programBytes,
    dataBytes: result.dataBytes,
    groundTruth: groundTruth === null ? null : join(entry.dir.slice(ROOT.length + 1), groundTruth),
    error: result.ok ? null : result.stderr.split('\n').slice(0, 3).join(' ').trim().slice(0, 300),
  };
}

async function tierCEntries(): Promise<{ name: string; dir: string; provenance: string }[]> {
  const tierDir = join(CORPUS, 'tierC');
  try {
    const names = (await readdir(tierDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.map((name) => ({
      name,
      dir: join(tierDir, name),
      provenance: 'hand-written for the hard-case register',
    }));
  } catch {
    return [];
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const cli = await arduinoCliAvailable();
if (cli === null) {
  console.error('arduino-cli not found on PATH. Install it with `brew install arduino-cli`.');
  process.exit(2);
}

console.log(`Building import corpus with ${cli.split('\n')[0]}\n`);

const tierA = await buildTierA();
console.log(`  Tier A  ${tierA.length} sketches generated from bundled examples`);

const tierB = await buildTierB();
console.log(`  Tier B  ${tierB.length} sketches copied from Arduino installs`);

const tierC = await tierCEntries();
console.log(`  Tier C  ${tierC.length} hand-written sketches indexed`);

console.log('\nCompiling every sketch to anchor Gate 1…');

const entries: ManifestEntry[] = [];
for (const entry of tierA) entries.push(await verify('A', entry));
for (const entry of tierB) entries.push(await verify('B', entry));
for (const entry of tierC) entries.push(await verify('C', entry));

const broken = entries.filter((entry) => !entry.compiles);
for (const entry of broken) {
  console.log(`  ✗ Tier ${entry.tier}  ${entry.name}: ${entry.error ?? 'compile failed'}`);
}

const manifest = {
  fqbn: DEFAULT_FQBN,
  arduinoCli: cli.split('\n')[0] ?? cli,
  counts: {
    tierA: entries.filter((entry) => entry.tier === 'A').length,
    tierB: entries.filter((entry) => entry.tier === 'B').length,
    tierC: entries.filter((entry) => entry.tier === 'C').length,
  },
  sketches: entries,
};

await writeFile(join(CORPUS, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const ok = entries.length - broken.length;
console.log(`\n  ${ok}/${entries.length} corpus sketches compile.`);
console.log(`  Manifest written to corpus/manifest.json`);

if (broken.length > 0) {
  console.log('\n  A corpus sketch that will not compile cannot anchor Gate 1 and reports n/a.');
}
