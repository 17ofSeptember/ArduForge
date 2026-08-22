/**
 * Phase 3 — precedence, associativity, and notation.
 *
 * Written before the expression lowering rules, for the same reason amendment
 * C's tests were: this is where a plausible-looking implementation silently
 * changes the program. The graph is a tree, and when codegen flattens it back
 * to text it has to parenthesize enough to preserve the original grouping —
 * over-parenthesizing is harmless, under-parenthesizing is a different program
 * that still compiles.
 *
 * Every case here is checked by *result*, not by shape: the regenerated source
 * is re-evaluated in C++ terms by comparing against the original's own
 * grouping. If the grouping is preserved, hex comparison in the corpus will
 * agree; these tests exist to say precisely *which* grouping broke when it does.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { importSketch } from '@/import/importSketch';
import { parseCpp, type TsNode } from '@/import/grammar';

/**
 * Imports a sketch and returns the regenerated source.
 *
 * The expression is placed inside `delay(...)` rather than on the right of an
 * assignment. That matters: assignments are not lowered, so `x = a + b;` stays
 * one Raw Statement and the expression never becomes a tree — the guard would
 * pass while testing nothing. An argument to a lowered statement is a position
 * where expression lowering actually runs.
 */
async function roundTrip(body: string): Promise<string> {
  const source = `int a = 1;\nint b = 2;\nint c = 3;\nint x = 0;\nvoid setup(){}\nvoid loop(){\n  ${body}\n}\n`;
  const result = await importSketch([{ name: 'Probe.ino', content: source }], { sketchName: 'Probe' });
  return generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code;
}

/** Puts an expression where lowering will actually reach it. */
const inArgument = (expression: string): string => `delay(${expression});`;

/**
 * The parse tree of an expression, with redundant parentheses removed.
 *
 * Comparing text does not work: codegen parenthesizes every operator node, so
 * `a + b * c` comes back as `(a + (b * c))`. That is the *same tree* and is
 * explicitly allowed — over-parenthesizing is harmless, regrouping is not. Only
 * the tree can tell those apart, so the tree is what gets compared. Operator
 * tokens are included, or `a + b` and `a - b` would look identical.
 */
function render(node: TsNode): string {
  if (node.type === 'parenthesized_expression') {
    const inner = node.namedChild(0);
    return inner === null ? node.text : render(inner);
  }
  if (node.childCount === 0) return node.text;
  const parts: string[] = [];
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    // The bare parens of a call's argument list carry no grouping.
    if (child === null || child.text === '(' || child.text === ')') continue;
    parts.push(render(child));
  }
  return `(${parts.join(' ')})`;
}

/** The shape of one expression, isolated inside a call argument. */
async function shapeOf(expression: string): Promise<string> {
  const { root } = await parseCpp(`void f(){ g(${expression}); }`);
  let found: TsNode | null = null;
  const walk = (node: TsNode): void => {
    if (found !== null) return;
    if (node.type === 'call_expression' && node.childForFieldName('function')?.text === 'g') {
      found = node.childForFieldName('arguments')?.namedChild(0) ?? null;
      return;
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  if (found === null) throw new Error(`could not isolate: ${expression}`);
  return render(found);
}

/** The argument text codegen emitted back into delay(...). */
function emittedArgument(code: string): string {
  const match = /delay\(([\s\S]*?)\);/.exec(code);
  if (match?.[1] === undefined) throw new Error('no delay() in regenerated source');
  return match[1];
}

/** Asserts the regenerated expression has the same tree as the original. */
async function expectSameShape(expression: string): Promise<void> {
  const code = await roundTrip(inArgument(expression));
  const before = await shapeOf(expression);
  const after = await shapeOf(emittedArgument(code));
  expect(after, `regrouped "${expression}" as "${emittedArgument(code)}"`).toBe(before);
}

describe('operator precedence survives the round trip', () => {
  const cases: readonly [string, string][] = [
    // The four IMPORT.md names explicitly.
    ['a + b * c', 'a+b*c'],
    ['(a + b) * c', '(a+b)*c'],
    ['a - b - c', 'a-b-c'],
    ['a << 1 + 2', 'a<<1+2'],
    // Mixed arithmetic and comparison.
    ['a + b > c', 'a+b>c'],
    ['a > b + c', 'a>b+c'],
    // Bitwise against comparison, the classic Arduino trap.
    ['a & b == c', 'a&b==c'],
    ['(a & b) == c', '(a&b)==c'],
    // Logical operators.
    ['a && b || c', 'a&&b||c'],
    ['a || b && c', 'a||b&&c'],
    ['(a || b) && c', '(a||b)&&c'],
    // Unary against binary.
    ['-a + b', '-a+b'],
    ['-(a + b)', '-(a+b)'],
    ['!a && b', '!a&&b'],
    ['!(a && b)', '!(a&&b)'],
    // Right-associative assignment inside an expression is not touched here,
    // but ternary nesting is a real shape in sketches.
    ['a ? b : c', 'a?b:c'],
  ];

  for (const [expression] of cases) {
    it(`preserves ${expression}`, async () => {
      await expectSameShape(expression);
    });
  }
});

describe('associativity survives the round trip', () => {
  // a - b - c is (a-b)-c. Reassociating to a-(b-c) compiles and is wrong.
  it('keeps left-associative subtraction left-associative', async () => {
    await expectSameShape('a - b - c');
    expect(await shapeOf('a - b - c')).not.toBe(await shapeOf('a - (b - c)'));
  });

  it('keeps left-associative division left-associative', async () => {
    await expectSameShape('a / b / c');
    expect(await shapeOf('a / b / c')).not.toBe(await shapeOf('a / (b / c)'));
  });

  it('keeps shift chains left-associative', async () => {
    await expectSameShape('a << b << c');
    expect(await shapeOf('a << b << c')).not.toBe(await shapeOf('a << (b << c)'));
  });
});

describe('literal notation survives the round trip', () => {
  const notations = ['0x1A', '0b1010', '1e3', "'A'", '013', '42UL', '3.5f'];

  for (const notation of notations) {
    it(`keeps ${notation} as written`, async () => {
      const out = await roundTrip(inArgument(notation));
      expect(out).toContain(notation);
    });
  }

  it('keeps Arduino constants as names', async () => {
    for (const name of ['HIGH', 'LOW', 'A0', 'LED_BUILTIN', 'INPUT_PULLUP']) {
      const out = await roundTrip(inArgument(name));
      expect(out, `${name} should survive`).toContain(name);
    }
  });
});

describe('impure calls are never deduplicated', () => {
  it('keeps both reads when the same call appears twice', async () => {
    // §Phase 3: two analogRead(A0) in the source are two nodes. Collapsing them
    // halves the number of conversions and changes the value that is computed.
    const out = await roundTrip(inArgument('analogRead(A0) - analogRead(A0)'));
    const occurrences = out.split('analogRead(A0)').length - 1;
    expect(occurrences).toBe(2);
  });

  it('keeps repeated millis() calls distinct', async () => {
    const out = await roundTrip(inArgument('millis() - millis()'));
    expect(out.split('millis()').length - 1).toBe(2);
  });
});
