/**
 * Grammar verification (IMPORT.md §0.3).
 *
 * IMPORT.md is explicit that this runs before anything else is built: if
 * tree-sitter-cpp cannot be sourced and loaded, Phase 0 stops and reports
 * rather than falling back to a hand-written parser. This script is that check,
 * kept around because the failure it catches — a version bump that breaks the
 * wasm ABI — is silent and looks like an importer bug.
 *
 * Run: npm run import:grammar
 */
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { collectErrors, cppParser, grammarWasmPath, parseCpp, type TsNode } from './import/grammar.ts';

let failed = false;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : `  ${detail}`}`);
  if (!ok) failed = true;
}

console.log('\ntree-sitter-cpp verification (IMPORT.md §0.3)\n');

// ── 1. the wasm is obtainable and loads ──

const wasmPath = grammarWasmPath();
const size = statSync(wasmPath).size;
check('grammar wasm resolved', size > 0, `${(size / 1024 / 1024).toFixed(1)} MB`);

const parser = await cppParser();
const language = parser.language;
check('loads under web-tree-sitter', language !== null, `ABI ${language?.abiVersion ?? '?'}`);

// ── 2. it parses a real sketch ──

const blinkPath = resolve('corpus/tierB/Blink/Blink.ino');
let blink: string;
try {
  blink = await readFile(blinkPath, 'utf8');
} catch {
  // Falls back to the canonical source so this script works before the corpus
  // is assembled — it is supposed to be runnable first.
  blink = `void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(1000);\n}\n`;
  console.log('    (corpus not built yet — using the canonical Blink source)');
}

// §Architecture: .ino is not valid C++ until Arduino's preprocessing runs.
// Phase 1 builds the real step; this is the minimum that makes the parse honest.
const preprocessed = `#include <Arduino.h>\n\n${blink}`;

const parsed = await parseCpp(preprocessed);
check('parses Blink after preprocessing', !parsed.root.hasError, `${parsed.root.childCount} top-level declarations`);

const functions: string[] = [];
const walk = (node: TsNode): void => {
  if (node.type === 'function_definition') {
    const declarator = node.childForFieldName('declarator');
    if (declarator !== null) functions.push(declarator.text.split('(')[0] ?? '');
  }
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null) walk(child);
  }
};
walk(parsed.root);
check('finds setup and loop', functions.includes('setup') && functions.includes('loop'), functions.join(', '));

// ── 3. error recovery ──

// The whole architecture rests on this: an unparseable region becomes one
// Custom C++ node and everything around it still imports. A parser that threw
// would fail an entire sketch on one unfamiliar template.
//
// Recovery quality is not uniform, and Phase 0 measured exactly where it is
// good and where it is not — see docs/IMPORT.md §Error recovery. The two
// asserted below are the ones the design depends on. The weaker cases are
// printed rather than asserted, because the correct response to them is
// Phase 7's whole-file fallback, not a stricter parser.

function functionsIn(root: TsNode): string[] {
  const found: string[] = [];
  const walk = (node: TsNode): void => {
    if (node.type === 'function_definition') {
      const declarator = node.childForFieldName('declarator');
      if (declarator !== null) found.push(declarator.text.split('(')[0] ?? '');
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return found;
}

// The case fallback granularity actually rests on (§Fallback granularity): one
// unrecognized statement inside a body must not swallow the body around it.
// The garbage is deliberately not "almost C++": `not c++ ???` would partly
// tokenize, since `not` is an alternative operator and `c++` is an increment.
const GARBAGE_ROW = 4;
const brokenBody = `void setup() { pinMode(13, OUTPUT); }

void loop() {
  digitalWrite(13, HIGH);
  @@@ @@@ @@@
  delay(500);
}
`;

const bodyParse = await parseCpp(brokenBody);
const bodyErrors = collectErrors(bodyParse.root);
const bodyFunctions = functionsIn(bodyParse.root);

check('broken sketch still produces a tree', bodyParse.root.childCount > 0);
check('emits an ERROR node', bodyErrors.length > 0, bodyErrors.map((span) => `line ${span.startRow + 1}`).join(', '));
check(
  'an unparseable statement does not swallow its function',
  bodyFunctions.includes('setup') && bodyFunctions.includes('loop'),
  `recovered: ${bodyFunctions.join(', ')}`,
);
// Confinement, not an exact span: what fallback granularity needs is that the
// unparseable region does not reach the statements around it.
const confined =
  bodyErrors.length > 0 &&
  bodyErrors.every((span) => span.startRow === GARBAGE_ROW && span.endRow === GARBAGE_ROW) &&
  !bodyErrors.some((span) => /delay|digitalWrite/.test(span.text));
check(
  'the ERROR stays on the bad line and does not reach its neighbours',
  confined,
  `${bodyErrors.length} span(s) on line ${GARBAGE_ROW + 1}`,
);

// An unfamiliar top-level construct must not take the file down with it.
const exotic = `template<class... Ts> struct Overload : Ts... { using Ts::operator()...; };

void setup() { Serial.begin(9600); }
void loop() { delay(10); }
`;

const exoticParse = await parseCpp(exotic);
const exoticFunctions = functionsIn(exoticParse.root);
check(
  'an exotic template does not take the file down',
  exoticFunctions.includes('setup') && exoticFunctions.includes('loop'),
  `recovered: ${exoticFunctions.join(', ')}`,
);

// Measured, not asserted: where recovery is coarse. Phase 1 must not assume an
// ERROR span stops at a line boundary, and Phase 7 has to handle the last one
// by falling back to a single Raw Global for the whole file.
console.log('\n  Recovery characterization (measured, not asserted):');
const coarse: [string, string][] = [
  ['garbage at top level', 'int a = 1;\nvoid setup(){}\n@@@ junk %%%\nvoid loop(){ delay(1); }\n'],
  ['unbalanced brace', 'void setup() { pinMode(13, OUTPUT);\nvoid loop() { delay(1); }\n'],
  ['unterminated string', 'void setup(){ Serial.println("oops );\n}\nvoid loop(){ delay(1); }\n'],
];
for (const [label, source] of coarse) {
  const result = await parseCpp(source);
  const spans = collectErrors(result.root);
  const recovered = functionsIn(result.root);
  const reach = spans.map((span) => `${span.kind} L${span.startRow + 1}-${span.endRow + 1}`).join(', ');
  console.log(
    `    ${pad(label, 22)} ${pad(reach === '' ? 'clean' : reach, 26)} recovered: [${recovered.join(', ')}]`,
  );
}

// ── 4. the AST is inspectable ──

console.log('\n  AST of the Blink loop():\n');
const loopNode = (() => {
  let found: TsNode | null = null;
  const find = (node: TsNode): void => {
    if (found !== null) return;
    if (node.type === 'function_definition') {
      const declarator = node.childForFieldName('declarator');
      if (declarator?.text.startsWith('loop') === true) {
        found = node;
        return;
      }
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) find(child);
    }
  };
  find(parsed.root);
  return found as TsNode | null;
})();

if (loopNode !== null) {
  const sexp = loopNode.toString();
  console.log(
    sexp
      .replace(/\) \(/g, ')\n(')
      .split('\n')
      .slice(0, 14)
      .map((line) => `    ${line}`)
      .join('\n'),
  );
  if (sexp.split('\n').length > 14) console.log('    …');
}

console.log(`\n${failed ? '  GRAMMAR VERIFICATION FAILED' : '  Grammar verified. Phase 1 can build on it.'}\n`);
process.exit(failed ? 1 : 0);
