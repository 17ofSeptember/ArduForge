/**
 * The millis lift (IMPORT.md §4.2).
 *
 * Every case here is a round-trip: import, regenerate, and check the emitted
 * C++. A lift that does not survive that is corruption, not a lift — the graph
 * would look tidier on the canvas while describing a different program.
 *
 * The refusals matter as much as the lifts. Most of this file is cases that
 * must *not* be lifted, because the cost of a wrong lift here is a timing bug
 * the user will blame on their hardware.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { importSketch } from '@/import/importSketch';

async function roundTrip(source: string): Promise<{ code: string; lifted: readonly string[]; warnings: readonly string[] }> {
  const result = await importSketch([{ name: 'Probe.ino', content: source }], { sketchName: 'Probe' });
  return {
    code: generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code,
    lifted: result.report.patternsLifted,
    warnings: result.report.warnings.map((warning) => warning.code),
  };
}

const sketch = (globals: string, body: string): string =>
  `${globals}\nvoid setup(){ pinMode(13, OUTPUT); }\nvoid loop(){\n${body}\n}\n`;

describe('the canonical pattern lifts', () => {
  it('lifts a static local timestamp', async () => {
    const { code, lifted } = await roundTrip(
      sketch('', '  static unsigned long last = 0;\n  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }'),
    );

    expect(lifted).toContain('Every 500ms');
    // The node re-emits its own timestamp, so the shape survives.
    expect(code).toMatch(/static unsigned long _af_last_\w+ = 0;/);
    expect(code).toMatch(/if \(millis\(\) - _af_last_\w+ >= \(unsigned long\)\(500\)\)/);
    expect(code).toContain('digitalWrite(13, HIGH)');
    // The user's variable is gone, which is what makes this a lift. Matched on
    // a word boundary because the node's own generated name contains "last".
    expect(code).not.toMatch(/(?<!_af_)\blast\b/);
  });

  it('lifts a global timestamp', async () => {
    const { code, lifted } = await roundTrip(
      sketch(
        'unsigned long previousMillis = 0;',
        '  if (millis() - previousMillis >= 1000) {\n    previousMillis = millis();\n    digitalWrite(13, LOW);\n  }',
      ),
    );

    expect(lifted).toContain('Every 1000ms');
    expect(code).not.toContain('previousMillis');
    expect(code).toContain('digitalWrite(13, LOW)');
  });

  it('keeps the interval written as a named constant', async () => {
    const { code, lifted } = await roundTrip(
      sketch(
        'const long interval = 250;\nunsigned long last = 0;',
        '  if (millis() - last >= interval) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }',
      ),
    );

    expect(lifted).toHaveLength(1);
    // Emitting 250 where the user wrote `interval` would be a fidelity failure.
    expect(code).toContain('(unsigned long)(interval)');
    expect(code).toContain('const long interval = 250;');
  });

  it('carries the whole body into the node', async () => {
    const { code } = await roundTrip(
      sketch(
        'unsigned long last = 0;\nint count = 0;',
        '  if (millis() - last >= 100) {\n    last = millis();\n    count++;\n    digitalWrite(13, HIGH);\n    delay(1);\n  }',
      ),
    );

    expect(code).toContain('count++');
    expect(code).toContain('digitalWrite(13, HIGH)');
    expect(code).toContain('delay(1)');
  });
});

describe('refusals — anything ambiguous imports as written', () => {
  it('refuses the rollover-unsafe form and warns', async () => {
    const { code, lifted, warnings } = await roundTrip(
      sketch(
        'unsigned long last = 0;',
        '  if (millis() >= last + 1000) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }',
      ),
    );

    expect(lifted).toEqual([]);
    expect(warnings).toContain('rollover-unsafe-timer');
    // Imported as written — repairing a 49.7-day bug silently would be a
    // behaviour change disguised as an import. The comparison is lowered to a
    // node, so it is re-parenthesised, but the operands and the operator are
    // exactly the user's.
    expect(code).toContain('millis() >= (last + 1000)');
    expect(code).toContain('last = millis();');
  });

  it('refuses when anything else reads the timestamp', async () => {
    const { code, lifted } = await roundTrip(
      sketch(
        'unsigned long last = 0;',
        '  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }\n  Serial.println(last);',
      ),
    );

    // The node would delete a variable the sketch still uses.
    expect(lifted).toEqual([]);
    expect(code).toContain('Serial.println(last)');
    expect(code).toContain('unsigned long last = 0;');
  });

  it('refuses the drift-free restamp', async () => {
    // `last += interval` schedules from the previous deadline; the node
    // resamples the clock. A late tick is caught up in one and lost in the
    // other, so they are different programs.
    const { code, lifted } = await roundTrip(
      sketch('unsigned long last = 0;', '  if (millis() - last >= 250) {\n    last += 250;\n    digitalWrite(13, HIGH);\n  }'),
    );

    expect(lifted).toEqual([]);
    expect(code).toContain('last += 250');
  });

  it('refuses the hoisted-currentMillis variant', async () => {
    // The source samples millis() once and reuses it; the node calls it twice.
    // Different machine code, and a marginally later restamp.
    const { code, lifted } = await roundTrip(
      sketch(
        'unsigned long previousMillis = 0;',
        '  unsigned long currentMillis = millis();\n  if (currentMillis - previousMillis >= 500) {\n    previousMillis = currentMillis;\n    digitalWrite(13, HIGH);\n  }',
      ),
    );

    expect(lifted).toEqual([]);
    expect(code).toContain('currentMillis');
  });

  it('refuses a timestamp that does not start at zero', async () => {
    const { lifted } = await roundTrip(
      sketch('unsigned long last = 5000;', '  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }'),
    );
    expect(lifted).toEqual([]);
  });

  it('refuses when the timer has an else branch', async () => {
    const { lifted } = await roundTrip(
      sketch(
        'unsigned long last = 0;',
        '  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  } else {\n    digitalWrite(13, LOW);\n  }',
      ),
    );
    expect(lifted).toEqual([]);
  });

  it('refuses a timestamp that is not unsigned long', async () => {
    const { lifted } = await roundTrip(
      sketch('int last = 0;', '  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }'),
    );
    expect(lifted).toEqual([]);
  });

  it('lifts a timer that is not last, now that the node has a continuation', async () => {
    // This was a refusal until control.everyMs gained its `after` output: the
    // node consumed its only exec output, so a statement following the timer
    // would have been orphaned out of the chain.
    const { code, lifted } = await roundTrip(
      sketch(
        'unsigned long last = 0;',
        '  if (millis() - last >= 500) {\n    last = millis();\n    digitalWrite(13, HIGH);\n  }\n  digitalWrite(12, LOW);',
      ),
    );

    expect(lifted).toContain('Every 500ms');
    // The follower runs on every pass, outside the timer's block.
    const inside = code.indexOf('digitalWrite(13, HIGH)');
    const after = code.indexOf('digitalWrite(12, LOW)');
    expect(inside).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(inside);
    expect(code.slice(inside, after)).toContain('}');
  });
});
