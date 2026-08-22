/**
 * Non-negotiable #5 — idempotent after one round.
 *
 *   "import(generate(import(x))) must equal import(x). Test it on all of
 *    Tier A and Tier B."
 *
 * Run on all three tiers, because Tier C is where the shapes that break this
 * live. Two Phase 1 bugs were caught only by this check, and neither moved any
 * fidelity gate — both were invisible to Gate 1 because they were whitespace
 * and comments, which do not affect compiled output:
 *
 *   - Codegen re-indents a Raw node's body when emitting it back inside
 *     `void loop() {`, so every round trip added two spaces forever.
 *   - Re-importing a generated sketch captured ArduForge's own banner as user
 *     code, stacking another copy on each round.
 *
 * Run: npm run import:idempotence
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { generate } from '@/codegen/generate';
import { importSketch } from '@/import/importSketch';

import { canonicalGraph } from './import/graphCompare.ts';
import { loadSketch } from './import-fidelity.ts';

const CORPUS = resolve('corpus');

interface Failure {
  readonly sketch: string;
  readonly detail: string;
}

const failures: Failure[] = [];
let checked = 0;

console.log('\nIdempotence — import(generate(import(x))) == import(x)\n');

for (const tier of ['A', 'B', 'C']) {
  const dir = join(CORPUS, `tier${tier}`);
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    continue;
  }

  let passed = 0;
  for (const name of names) {
    const sketch = await loadSketch(join(dir, name));

    const first = await importSketch(sketch.files, { sketchName: sketch.name });
    const regenerated = generate([...first.nodes], [...first.edges], { projectName: sketch.name }).code;
    const second = await importSketch([{ name: `${sketch.name}.ino`, content: regenerated }], {
      sketchName: sketch.name,
    });

    const before = canonicalGraph(first.nodes, first.edges);
    const after = canonicalGraph(second.nodes, second.edges);
    checked += 1;

    if (before === after) {
      passed += 1;
      continue;
    }

    const left = before.split('\n');
    const right = after.split('\n');
    let detail = 'graphs differ';
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      if (left[i] === right[i]) continue;
      detail =
        `line ${i + 1}\n        first:  ${(left[i] ?? '(absent)').slice(0, 150)}\n` +
        `        second: ${(right[i] ?? '(absent)').slice(0, 150)}`;
      break;
    }
    failures.push({ sketch: `tier${tier}/${name}`, detail });
  }

  console.log(`  Tier ${tier}  ${passed}/${names.length}`);
}

for (const failure of failures) {
  console.log(`\n  ✗ ${failure.sketch}\n        ${failure.detail}`);
}

console.log(`\n  ${checked - failures.length}/${checked} sketches are idempotent.\n`);
if (failures.length > 0) process.exit(1);
