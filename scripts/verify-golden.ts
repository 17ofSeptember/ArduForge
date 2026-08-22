/**
 * Golden graph gate.
 *
 * Regenerates every fixture in `client/src/examples/goldenFixtures.ts` and
 * compares against the committed `.ino`. A difference is a hard stop, exactly
 * like the corpus gate — the two guard different halves of the same property:
 *
 *   corpus/tierA     codegen for nodes the bundled examples use
 *   corpus/golden    codegen for nodes nothing else can reach
 *
 * The second half is not a nicety. Component lifting writes to a node's config
 * fields *by name*, and a wrong name on an LCD lift is a wrong I2C address. No
 * corpus sketch builds an LCD graph, so nothing else in the repo would notice.
 *
 * Run:  npm run import:golden            check against committed output
 *       npm run import:golden -- --write regenerate after an intended change
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { generate } from '@/codegen/generate';
import { goldenFixtures } from '@/examples/goldenFixtures';
import { FORGE_VERSION } from '@/store/persistence';
import { validateGraph } from '@/graph/validate';

import { arduinoCliAvailable, compileSketch, DEFAULT_FQBN } from './import/compile.ts';

const GOLDEN = resolve('corpus/golden');
const CACHE = resolve('corpus/.hexcache');

const write = process.argv.includes('--write');

interface Result {
  readonly name: string;
  readonly guards: string;
  readonly generated: boolean;
  readonly matches: boolean;
  readonly compiles: boolean;
  readonly problems: readonly string[];
  readonly diff: string | null;
}

async function committed(name: string): Promise<string | null> {
  try {
    return await readFile(join(GOLDEN, name, `${name}.ino`), 'utf8');
  } catch {
    return null;
  }
}

/** First differing line, which is all anyone needs to start looking. */
function firstDifference(before: string, after: string): string {
  const left = before.split('\n');
  const right = after.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === right[i]) continue;
    return `line ${i + 1}\n      committed: ${left[i] ?? '(absent)'}\n      generated: ${right[i] ?? '(absent)'}`;
  }
  return 'files differ in length only';
}

const cli = await arduinoCliAvailable();
console.log(`\nGolden graph fixtures — ${goldenFixtures.length} graphs\n`);

const results: Result[] = [];

for (const fixture of goldenFixtures) {
  const graph = fixture.build();
  const problems = validateGraph(graph.nodes, graph.edges)
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);

  const result = generate(graph.nodes, graph.edges, { projectName: fixture.name, fqbn: DEFAULT_FQBN });
  const previous = await committed(fixture.name);
  const matches = previous === null ? false : previous === result.code;

  if (write) {
    const dir = join(GOLDEN, fixture.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${fixture.name}.ino`), result.code, 'utf8');
    // The graph travels with its output, so a failure can be opened and looked
    // at rather than reconstructed from the fixture source.
    const project = {
      version: FORGE_VERSION,
      meta: { name: fixture.name, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' },
      board: { fqbn: DEFAULT_FQBN },
      graph,
      dashboard: { pages: [], widgets: [] },
      settings: {},
    };
    await writeFile(join(dir, `${fixture.name}.forge`), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  }

  let compiles = true;
  if (cli !== null && result.ok) {
    const compiled = await compileSketch([{ name: `${fixture.name}.ino`, content: result.code }], {
      cacheDir: CACHE,
      sketchName: fixture.name,
    });
    compiles = compiled.ok;
  }

  results.push({
    name: fixture.name,
    guards: fixture.guards,
    generated: result.ok,
    matches: write ? true : matches,
    compiles,
    problems,
    diff: !write && previous !== null && !matches ? firstDifference(previous, result.code) : null,
  });
}

// A fixture removed from the source but left on disk would silently stop being
// checked, so the directory is reconciled rather than only added to.
if (write) {
  const expected = new Set(goldenFixtures.map((fixture) => fixture.name));
  for (const entry of await readdir(GOLDEN).catch(() => [])) {
    if (!expected.has(entry)) await rm(join(GOLDEN, entry), { recursive: true, force: true });
  }
}

const pad = (text: string, width: number): string =>
  text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);

console.log(`  ${pad('fixture', 22)}${pad('generates', 11)}${pad('matches', 9)}${pad('compiles', 10)}guards`);
console.log(`  ${'─'.repeat(96)}`);

let failed = 0;
for (const result of results) {
  const ok = result.generated && result.matches && result.compiles && result.problems.length === 0;
  if (!ok) failed += 1;
  console.log(
    `  ${pad(result.name, 22)}${pad(result.generated ? 'ok' : 'FAIL', 11)}` +
      `${pad(write ? 'written' : result.matches ? 'ok' : 'DRIFT', 9)}` +
      `${pad(result.compiles ? 'ok' : 'FAIL', 10)}${result.guards}`,
  );
  for (const problem of result.problems) console.log(`      invalid: ${problem}`);
  if (result.diff !== null) console.log(`      ${result.diff}`);
}

console.log(`\n  ${results.length - failed}/${results.length} fixtures hold.`);

if (failed > 0) {
  console.log(
    '\n  GOLDEN DRIFT — codegen for these nodes changed.\n' +
      '  Nothing else in the repo guards them: no corpus sketch can produce them.\n' +
      '  If the change is intended, rerun with --write and read the diff before committing.\n',
  );
  process.exit(1);
}
console.log('  Codegen for the nodes no sketch can reach is unchanged.\n');
