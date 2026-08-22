/**
 * Statement lowering (IMPORT.md §Phase 2).
 *
 * The invariant these exist to protect is order. Every other property of a
 * lowered graph is visible in the output; order is the one that can look
 * completely reasonable on the canvas and still be a different program.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { importSketch } from '@/import/importSketch';
import { dedentStatement } from '@/import/lower';

async function roundTrip(source: string): Promise<string> {
  const result = await importSketch([{ name: 'Probe.ino', content: source }], { sketchName: 'Probe' });
  return generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code;
}

/** Where each needle appears in the regenerated output, in order. */
function positionsOf(code: string, needles: readonly string[]): number[] {
  return needles.map((needle) => code.indexOf(needle));
}

describe('statement order is preserved exactly', () => {
  it('keeps a straight run of calls in source order', async () => {
    const code = await roundTrip(
      ['void setup(){', '  pinMode(2, OUTPUT);', '  pinMode(3, INPUT);', '  pinMode(4, OUTPUT);', '}', 'void loop(){}', ''].join(
        '\n',
      ),
    );

    const [first, second, third] = positionsOf(code, ['pinMode(2, OUTPUT)', 'pinMode(3, INPUT)', 'pinMode(4, OUTPUT)']);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first as number);
    expect(third).toBeGreaterThan(second as number);
  });

  it('does not hoist a declaration above the statements before it', async () => {
    // The declaration reads `x`, which the line above it sets. Hoisting the
    // declaration — the tidy-looking rearrangement — reads x before it is
    // assigned and silently changes the program.
    const source = [
      'int x = 0;',
      'int y = 0;',
      'void setup(){',
      '  x = 5;',
      '  int local = x * 2;',
      '  y = local;',
      '}',
      'void loop(){}',
      '',
    ].join('\n');

    const code = await roundTrip(source);
    // The declaration now lowers to a Declare Variable whose initializer is a
    // wired expression, so it emits as `int local = (x * 2);` — the grouping is
    // parenthesised but the position, which is what this guards, is unchanged.
    const [assign, declare, use] = positionsOf(code, ['x = 5', 'int local =', 'y = local']);

    expect(assign).toBeGreaterThan(-1);
    expect(declare).toBeGreaterThan(assign as number);
    expect(use).toBeGreaterThan(declare as number);
  });

  it('preserves initialization order of globals whose values depend on each other', async () => {
    const source = ['int base = 10;', 'int derived = base * 2;', 'void setup(){}', 'void loop(){}', ''].join('\n');
    const code = await roundTrip(source);

    const [base, derived] = positionsOf(code, ['int base = 10', 'int derived = base * 2']);
    expect(base).toBeGreaterThan(-1);
    expect(derived).toBeGreaterThan(base as number);
  });

  it('keeps a mixture of lowered and raw statements interleaved correctly', async () => {
    // digitalWrite lowers, the struct assignment does not. The raw one must
    // stay exactly where it was, not drift to the end of the chain.
    const source = [
      'int counter = 0;',
      'void setup(){}',
      'void loop(){',
      '  digitalWrite(13, HIGH);',
      '  counter += 2;',
      '  delay(100);',
      '  counter *= 3;',
      '  digitalWrite(13, LOW);',
      '}',
      '',
    ].join('\n');

    const code = await roundTrip(source);
    const order = positionsOf(code, ['digitalWrite(13, HIGH)', 'counter += 2', 'delay(100)', 'counter *= 3', 'digitalWrite(13, LOW)']);

    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]).toBeGreaterThan(order[i - 1] as number);
    }
  });
});

describe('argument handling', () => {
  it('preserves the notation a literal was written in', async () => {
    const code = await roundTrip('void setup(){ analogWrite(9, 0x1A); }\nvoid loop(){}\n');
    expect(code).toContain('0x1A');
    expect(code).not.toContain('analogWrite(9, 26)');
  });

  it('keeps a named constant named', async () => {
    const code = await roundTrip('void setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){}\n');
    expect(code).toContain('LED_BUILTIN');
    expect(code).not.toContain('pinMode(13,');
  });

  it('keeps HIGH and LOW rather than 1 and 0', async () => {
    const code = await roundTrip('void setup(){ digitalWrite(7, LOW); }\nvoid loop(){}\n');
    expect(code).toContain('digitalWrite(7, LOW)');
  });

  it('lowers a declared variable argument to Get Variable', async () => {
    // Phase 3: this was a Raw Expression until identifiers had a type to carry.
    const result = await importSketch(
      [{ name: 'Probe.ino', content: 'int p = 3;\nvoid setup(){ pinMode(p, OUTPUT); }\nvoid loop(){}\n' }],
      { sketchName: 'Probe' },
    );

    const get = result.nodes.find(
      (node) => node.type === 'forge' && (node.data as { defId?: string }).defId === 'var.get',
    );
    expect(get).toBeDefined();

    const code = generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code;
    // Get Variable emits the bare name, so the parentheses a Raw Expression
    // would have added are gone too.
    expect(code).toContain('pinMode(p, OUTPUT)');
  });

  it('still falls back to a Raw Expression for something it cannot type', async () => {
    const result = await importSketch(
      [{ name: 'Probe.ino', content: 'void setup(){ pinMode(cfg.pin, OUTPUT); }\nvoid loop(){}\n' }],
      { sketchName: 'Probe' },
    );

    const rawExpression = result.nodes.find(
      (node) => node.type === 'forge' && (node.data as { defId?: string }).defId === 'custom.expression',
    );
    expect(rawExpression).toBeDefined();

    const code = generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code;
    expect(code).toContain('cfg.pin');
  });
});

describe('constructs that must not lower yet', () => {
  it('leaves a for loop whole rather than rebuilding it from a counter', async () => {
    const source = 'void setup(){}\nvoid loop(){\n  for (int i = 0; i < 8; i++) {\n    digitalWrite(i, HIGH);\n  }\n}\n';
    const code = await roundTrip(source);
    // The user's own loop variable survives, which a counted-For node would lose.
    expect(code).toContain('for (int i = 0; i < 8; i++)');
  });

  it('leaves a return with a value alone', async () => {
    const source = 'int twice(int v){\n  return v * 2;\n}\nvoid setup(){}\nvoid loop(){}\n';
    const code = await roundTrip(source);
    expect(code).toContain('return v * 2;');
    expect(code).not.toContain('return "');
  });

  it('leaves Serial.print of a variable alone rather than wrapping it in String()', async () => {
    const source = 'int v = 0;\nvoid setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println(v); }\n';
    const code = await roundTrip(source);
    expect(code).toContain('Serial.println(v);');
    expect(code).not.toContain('String(');
  });

  it('does not orphan statements after a break', async () => {
    const source = [
      'void setup(){}',
      'void loop(){',
      '  while (true) {',
      '    break;',
      '    digitalWrite(13, HIGH);',
      '  }',
      '}',
      '',
    ].join('\n');
    const code = await roundTrip(source);
    // Unreachable in C++, but it is in the user's file and must survive.
    expect(code).toContain('digitalWrite(13, HIGH)');
  });
});

describe('dedentStatement', () => {
  it('leaves a single line alone', () => {
    expect(dedentStatement('digitalWrite(13, HIGH);')).toBe('digitalWrite(13, HIGH);');
  });

  it('strips block indentation while keeping relative nesting', () => {
    const input = 'if (x) {\n    a();\n    if (y) {\n      b();\n    }\n  }';
    expect(dedentStatement(input)).toBe('if (x) {\n  a();\n  if (y) {\n    b();\n  }\n}');
  });

  it('is stable when applied twice', () => {
    const input = 'if (x) {\n    a();\n  }';
    const once = dedentStatement(input);
    expect(dedentStatement(once)).toBe(once);
  });
});
