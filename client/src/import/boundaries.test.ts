/**
 * Amendment C — fallback boundaries are structural, never span-based.
 *
 * Written before the implementation, using the three cases Phase 0 measured on
 * tree-sitter-cpp 0.23.4 (docs/IMPORT.md §Error recovery). The original
 * smallest-unit rule in IMPORT.md assumed ERROR spans are well-scoped; they are
 * not, and these tests pin down what "structural" has to mean in each case:
 *
 *   1. Garbage in a function body — the ERROR sits exactly at statement
 *      position, so the region must stay tight and must not grow to the
 *      enclosing block.
 *   2. Garbage at top level — the ERROR bleeds forward and swallows the next
 *      declaration's header, leaving an orphaned fragment behind it. The region
 *      must absorb that fragment but must not reach backwards over the
 *      declarations before it, and must stop at the next well-formed one.
 *   3. Unterminated string — never reaches this code at all. It is caught by
 *      the lexical pre-flight (amendment B) and routed to whole-file fallback,
 *      because the parse is worthless: nothing is recovered.
 */
import { describe, it, expect } from 'vitest';
import { parseCpp } from '@/import/grammar';
import { fallbackRegions } from '@/import/boundaries';
import { preflight } from '@/import/preflight';

const textOf = (source: string, region: { startIndex: number; endIndex: number }): string =>
  source.slice(region.startIndex, region.endIndex);

describe('amendment C — structural fallback boundaries', () => {
  it('case 1: garbage in a function body stays tight', async () => {
    const source = [
      'void setup(){ pinMode(13,OUTPUT); }',
      'void loop(){',
      '  digitalWrite(13,HIGH);',
      '  @@@ @@@ @@@',
      '  delay(500);',
      '}',
      '',
    ].join('\n');

    const { root } = await parseCpp(source);
    const regions = fallbackRegions(root);

    expect(regions).toHaveLength(1);
    const only = regions[0];
    if (only === undefined) throw new Error('no region');

    // Exactly the bad statement — not the block, not its neighbours.
    expect(textOf(source, only).trim()).toBe('@@@ @@@ @@@');
    expect(textOf(source, only)).not.toContain('digitalWrite');
    expect(textOf(source, only)).not.toContain('delay');
    expect(only.kind).toBe('statement');
  });

  it('case 2: garbage at top level absorbs the orphaned fragment but not its neighbours', async () => {
    const source = [
      'int before = 1;',
      'void setup(){}',
      '@@@ junk %%%',
      'void loop(){ delay(1); }',
      'int after = 2;',
      '',
    ].join('\n');

    const { root } = await parseCpp(source);
    const regions = fallbackRegions(root);

    expect(regions).toHaveLength(1);
    const only = regions[0];
    if (only === undefined) throw new Error('no region');
    const covered = textOf(source, only);

    // Must not reach backwards over the declarations that parsed cleanly.
    expect(covered).not.toContain('int before');
    expect(covered).not.toContain('void setup');

    // tree-sitter drags `void loop()` into the ERROR, orphaning `{ delay(1); }`
    // as a bare sibling. Emitting that fragment on its own would be broken C++,
    // so the region has to absorb it.
    expect(covered).toContain('@@@ junk %%%');
    expect(covered).toContain('delay(1)');

    // ...and must stop at the next well-formed declaration.
    expect(covered).not.toContain('int after');
    expect(only.kind).toBe('declaration');
  });

  it('case 3: an unterminated string never reaches the parser', () => {
    const source = 'void setup(){ Serial.println("oops );\n}\nvoid loop(){ delay(1); }\n';

    const problems = preflight([{ name: 'Probe.ino', content: source }]);

    expect(problems).toHaveLength(1);
    const problem = problems[0];
    if (problem === undefined) throw new Error('no problem');
    expect(problem.construct).toBe('string');
    expect(problem.file).toBe('Probe.ino');
    expect(problem.line).toBe(1);
  });

  it('an error nested inside an expression falls back to the enclosing statement', async () => {
    const source = ['void loop(){', '  int x = 1 + @@@;', '  delay(1);', '}', ''].join('\n');

    const { root } = await parseCpp(source);
    const regions = fallbackRegions(root);

    expect(regions).toHaveLength(1);
    const only = regions[0];
    if (only === undefined) throw new Error('no region');
    const covered = textOf(source, only);

    // The whole enclosing statement, because half a declaration is not
    // emittable. Note this region legitimately also covers `delay(1);`: the
    // malformed declaration bled forward and tree-sitter returns the two as a
    // single `declaration` node. Bleed is not exclusive to top level, which
    // Phase 0's characterization did not show. Splitting a node tree-sitter
    // says is one thing would be a guess, and a wrong guess emits broken code.
    expect(only.kind).toBe('statement');
    expect(covered.startsWith('int x')).toBe(true);

    // What must still hold: it does not grow to the enclosing block or past
    // the function.
    expect(covered).not.toContain('void loop');
    expect(covered.trimEnd().endsWith('}')).toBe(false);
  });

  it('never absorbs the closing brace of the enclosing block', async () => {
    // A bled ERROR's next sibling is the block's `}`. Absorbing it emits a Raw
    // node with an unbalanced brace — broken code that still looks plausible.
    const source = ['void setup(){', '  @@@ one', '  pinMode(13,OUTPUT);', '  @@@ two', '}', 'void loop(){ delay(1); }', ''].join(
      '\n',
    );

    const { root } = await parseCpp(source);
    const regions = fallbackRegions(root);

    for (const region of regions) {
      const covered = textOf(source, region);
      const opens = (covered.match(/\{/g) ?? []).length;
      const closes = (covered.match(/\}/g) ?? []).length;
      expect(closes).toBeLessThanOrEqual(opens);
    }

    // loop() parsed cleanly and must survive untouched.
    expect(regions.map((region) => textOf(source, region)).join('\n')).not.toContain('void loop');
  });

  it('clean source produces no fallback regions', async () => {
    const source = 'int a = 1;\nvoid setup(){ pinMode(13,OUTPUT); }\nvoid loop(){ delay(1); }\n';
    const { root } = await parseCpp(source);
    expect(fallbackRegions(root)).toEqual([]);
  });

  it('regions never overlap and are returned in source order', async () => {
    // Two errors tree-sitter keeps genuinely separate, one per function. Two
    // errors inside a *single* body collapse into one outer ERROR node, so that
    // shape yields one region and would not exercise ordering at all.
    const source = [
      'void setup(){',
      '  @@@ one',
      '}',
      'void helper(){',
      '  @@@ two',
      '}',
      'void loop(){ delay(1); }',
      '',
    ].join('\n');

    const { root } = await parseCpp(source);
    const regions = fallbackRegions(root);

    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < regions.length; i += 1) {
      const previous = regions[i - 1];
      const current = regions[i];
      if (previous === undefined || current === undefined) throw new Error('gap');
      expect(current.startIndex).toBeGreaterThanOrEqual(previous.endIndex);
    }
  });
});
