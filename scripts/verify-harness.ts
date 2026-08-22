/**
 * Harness self-test (IMPORT.md §0.1).
 *
 * The corpus baseline is 0% because the importer throws, and a judge that
 * reports failure for everything proves nothing — it would look identical to a
 * judge that is simply broken. Phase 0 is where that has to be settled, because
 * every later phase reports against these gates and nobody re-audits a number
 * that has been on screen since session one.
 *
 * So each gate is exercised in both directions: it must pass a change that
 * genuinely does not matter, and fail one that does. The pairs below are the
 * exact tolerances IMPORT.md claims — renaming, whitespace, comments and
 * declaration order on the tolerant side; a changed constant or a different
 * function call on the strict side.
 *
 * Run: npm run import:selftest
 */
import { resolve } from 'node:path';

import { compareAst, checkTokenLoss, normalizeAst } from './import/ast.ts';
import { compileSketch, type SketchFile } from './import/compile.ts';
import { canonicalGraph } from './import/graphCompare.ts';
import { loadSketch } from './import-fidelity.ts';

const CACHE = resolve('corpus/.hexcache');

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : `  — ${detail}`}`);
}

// ── the fixtures ─────────────────────────────────────────────────────────────

/** The reference sketch. */
const BASE = `const int ledPin = 13;
const int wait = 500;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  digitalWrite(ledPin, HIGH);
  delay(wait);
  digitalWrite(ledPin, LOW);
  delay(wait);
}
`;

/**
 * Everything IMPORT.md says must not count: identifiers renamed, whitespace and
 * bracing changed, comments added, declarations reordered.
 */
const COSMETIC = `// A comment that did not exist before.
const int pause = 500;
const int outputPin = 13;

void setup()
{
    pinMode( outputPin , OUTPUT );
}

void loop()
{
    digitalWrite( outputPin , HIGH ); /* inline */
    delay( pause );
    digitalWrite( outputPin , LOW );
    delay( pause );
}
`;

/** One constant changed. Compiles fine, behaves differently. */
const SEMANTIC = BASE.replace('const int wait = 500;', 'const int wait = 250;');

/** Same shape, different Arduino call. The Gate 2 rubber-stamp guard. */
const DIFFERENT_CALL = BASE.replace(/digitalWrite\(ledPin, HIGH\)/, 'analogWrite(ledPin, 255)');

/** A whole statement dropped — what "nothing is ever lost" has to catch. */
const TRUNCATED = BASE.replace('  delay(wait);\n  digitalWrite(ledPin, LOW);\n', '  digitalWrite(ledPin, LOW);\n');

/** Additions are allowed: prototypes, hoisted temporaries, extra parentheses. */
const AUGMENTED = `#include <Arduino.h>

void setup();
void loop();

${BASE}
// trailing comment
`;

// ── Gate 1: hex comparison ───────────────────────────────────────────────────

console.log('\nHarness self-test (IMPORT.md §0.1)\n');
console.log('Gate 1 — hex comparison');

const asSketch = (content: string): SketchFile[] => [{ name: 'Probe.ino', content }];

const [baseHex, cosmeticHex, semanticHex, callHex] = await Promise.all([
  compileSketch(asSketch(BASE), { cacheDir: CACHE, sketchName: 'Probe' }),
  compileSketch(asSketch(COSMETIC), { cacheDir: CACHE, sketchName: 'Probe' }),
  compileSketch(asSketch(SEMANTIC), { cacheDir: CACHE, sketchName: 'Probe' }),
  compileSketch(asSketch(DIFFERENT_CALL), { cacheDir: CACHE, sketchName: 'Probe' }),
]);

check('all four probes compile', baseHex.ok && cosmeticHex.ok && semanticHex.ok && callHex.ok);
check(
  'tolerates renaming, whitespace, comments and declaration order',
  baseHex.hexSha === cosmeticHex.hexSha,
  `${baseHex.hexSha?.slice(0, 12)} vs ${cosmeticHex.hexSha?.slice(0, 12)}`,
);
check('catches a changed constant', baseHex.hexSha !== semanticHex.hexSha);
check('catches a different Arduino call', baseHex.hexSha !== callHex.hexSha);
check(
  'compiling the same source twice is deterministic',
  (await compileSketch(asSketch(BASE), { sketchName: 'Elsewhere' })).hexSha === baseHex.hexSha,
  'different sketch folder name, same hex',
);

// ── Gate 2: normalized AST ───────────────────────────────────────────────────

console.log('\nGate 2 — normalized AST equivalence');

const cosmeticAst = await compareAst(BASE, COSMETIC);
check('tolerates the cosmetic rewrite', cosmeticAst.equal, cosmeticAst.detail ?? '');

const semanticAst = await compareAst(BASE, SEMANTIC);
check('catches a changed constant', !semanticAst.equal);

const callAst = await compareAst(BASE, DIFFERENT_CALL);
check('does not collapse distinct Arduino calls', !callAst.equal);

// The failure mode this guards against: canonicalizing *every* identifier makes
// any two structurally similar sketches compare equal, and Gate 2 silently
// becomes a rubber stamp.
const swapped = BASE.replace(/pinMode/g, 'digitalWrite');
const swappedAst = await compareAst(BASE, swapped);
check('does not canonicalize library identifiers', !swappedAst.equal);

// setup and loop are pinned for the same reason: renaming them consistently
// would let their bodies trade places unnoticed.
const bodiesSwapped = `void setup() {
  digitalWrite(13, HIGH);
}

void loop() {
  pinMode(13, OUTPUT);
}
`;
const bodiesOriginal = `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
}
`;
const swapCheck = await compareAst(bodiesOriginal, bodiesSwapped);
check('catches setup and loop trading bodies', !swapCheck.equal);

// Arduino invents prototypes, so their presence can never be a real difference.
const prototypeAst = await compareAst(BASE, AUGMENTED.replace('#include <Arduino.h>\n\n', ''));
check('ignores generated prototypes', prototypeAst.equal, prototypeAst.detail ?? '');

// Phase 2 added three normalizations for shapes codegen produces. Each one is
// a place Gate 2 could quietly become a rubber stamp, so each is paired with a
// case that must still compare unequal.
const parens = await compareAst('void loop(){ int x = a + b; }', 'void loop(){ int x = ((a) + (b)); }');
check('tolerates redundant parentheses', parens.equal, parens.detail ?? '');

const precedence = await compareAst('void loop(){ int x = a + b * c; }', 'void loop(){ int x = (a + b) * c; }');
check('still distinguishes precedence', !precedence.equal);

const operator = await compareAst('void loop(){ int x = a - b; }', 'void loop(){ int x = a + b; }');
check('still distinguishes operators', !operator.equal);

const emptyElse = await compareAst('void loop(){ if (c) { f(); } }', 'void loop(){ if (c) { f(); } else { } }');
check('tolerates an empty else branch', emptyElse.equal, emptyElse.detail ?? '');

const realElse = await compareAst('void loop(){ if (c) { f(); } }', 'void loop(){ if (c) { f(); } else { g(); } }');
check('still catches a real else branch', !realElse.equal);

const braces = await compareAst('void loop(){ if (c) f(); }', 'void loop(){ if (c) { f(); } }');
check('tolerates braces added around a single statement', braces.equal, braces.detail ?? '');

const swappedBranches = await compareAst(
  'void loop(){ if (c) { f(); } else { g(); } }',
  'void loop(){ if (c) { g(); } else { f(); } }',
);
check('still catches branches trading places', !swappedBranches.equal);

const normalized = await normalizeAst(BASE);
check('normalization produces a non-empty canonical form', normalized.text.length > 0, `${normalized.declarations.length} declarations`);

// ── the "nothing is lost" check ──────────────────────────────────────────────

console.log('\nNon-negotiable #1 — nothing is ever lost');

const lossNone = await checkTokenLoss(BASE, BASE);
check('identical source loses nothing', lossNone.ok, `${lossNone.originalCount} tokens`);

const lossAdded = await checkTokenLoss(BASE, AUGMENTED);
check('additions are allowed', lossAdded.ok);

const lossDropped = await checkTokenLoss(BASE, TRUNCATED);
check('a dropped statement is caught', !lossDropped.ok, `missing: ${lossDropped.missing.join(' ')}`);

const lossRenamed = await checkTokenLoss(BASE, COSMETIC);
check(
  'renaming is reported as loss at the token level',
  !lossRenamed.ok,
  'expected — this check is a byte-level backstop, not a semantic one',
);

// ── Tier A graph comparison ──────────────────────────────────────────────────

console.log('\nTier A — structural graph comparison');

const graphA = {
  nodes: [
    { id: 'n1', type: 'forge' as const, position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
    { id: 'n2', type: 'forge' as const, position: { x: 200, y: 0 }, data: { defId: 'io.pinMode', literals: { pin: 13 }, config: {} } },
  ],
  edges: [
    {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      sourceHandle: 'exec-out:then',
      targetHandle: 'exec-in',
      data: { kind: 'exec' as const, portType: 'exec' as const },
    },
  ],
};

// Same graph, different ids and positions — neither is a fidelity property.
const graphRelabelled = {
  nodes: [
    { id: 'x9', type: 'forge' as const, position: { x: 999, y: 42 }, data: { defId: 'event.setup', literals: {}, config: {} } },
    { id: 'x3', type: 'forge' as const, position: { x: -5, y: 7 }, data: { defId: 'io.pinMode', literals: { pin: 13 }, config: {} } },
  ],
  edges: [
    {
      id: 'zz',
      source: 'x9',
      target: 'x3',
      sourceHandle: 'exec-out:then',
      targetHandle: 'exec-in',
      data: { kind: 'exec' as const, portType: 'exec' as const },
    },
  ],
};

const graphDifferentPin = {
  ...graphA,
  nodes: [
    graphA.nodes[0] as (typeof graphA.nodes)[0],
    { id: 'n2', type: 'forge' as const, position: { x: 200, y: 0 }, data: { defId: 'io.pinMode', literals: { pin: 9 }, config: {} } },
  ],
};

check(
  'ignores node ids and positions',
  canonicalGraph(graphA.nodes, graphA.edges) === canonicalGraph(graphRelabelled.nodes, graphRelabelled.edges),
);
check(
  'catches a changed literal',
  canonicalGraph(graphA.nodes, graphA.edges) !== canonicalGraph(graphDifferentPin.nodes, graphDifferentPin.edges),
);

// ── Arduino concatenation order ──────────────────────────────────────────────

console.log('\nSketch loading — Arduino concatenation order');

const multi = await loadSketch(resolve('corpus/tierC/MultiFileSketch'));
check(
  'the folder-matching .ino comes first',
  multi.files[0]?.name === 'MultiFileSketch.ino' && multi.files[1]?.name === 'helpers.ino',
  multi.files.map((file) => file.name).join(' then '),
);

const withHeader = await loadSketch(resolve('corpus/tierC/SketchWithHeader'));
check(
  'companion .h/.cpp are kept out of the importer input',
  withHeader.files.every((file) => file.name.endsWith('.ino')) && withHeader.companions.length === 2,
  `${withHeader.files.length} .ino, ${withHeader.companions.length} companions`,
);

// ── result ───────────────────────────────────────────────────────────────────

console.log(`\n  ${checks - failures}/${checks} harness self-tests passed.`);
if (failures > 0) {
  console.log('\n  THE HARNESS ITSELF IS BROKEN. Fix this before trusting any corpus number.\n');
  process.exit(1);
}
console.log('  The gates discriminate in both directions.\n');
