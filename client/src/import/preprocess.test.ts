/**
 * Preprocessing and the source map (IMPORT.md §Phase 1).
 *
 * The gate for this phase is a source-map round-trip: resolve AST nodes back to
 * the original file and line, and verify against the source text. That is
 * tested here on hand-built cases and again across the whole corpus by
 * scripts/verify-frontend.ts, which is where the "20 random nodes" requirement
 * is actually met at scale.
 */
import { describe, it, expect } from 'vitest';
import { parseCpp, type TsNode } from '@/import/grammar';
import { arduinoOrder, generatePrototypes, preprocess } from '@/import/preprocess';

describe('Arduino concatenation order', () => {
  it('puts the folder-matching tab first, then the rest alphabetically', () => {
    const order = arduinoOrder(
      [
        { name: 'zebra.ino', content: '' },
        { name: 'Sketch.ino', content: '' },
        { name: 'alpha.ino', content: '' },
        { name: 'notes.txt', content: '' },
      ],
      'Sketch',
    );
    expect(order.map((file) => file.name)).toEqual(['Sketch.ino', 'alpha.ino', 'zebra.ino']);
  });

  it('drops non-.ino files', () => {
    const order = arduinoOrder(
      [
        { name: 'Sketch.ino', content: '' },
        { name: 'sensor.h', content: '' },
        { name: 'sensor.cpp', content: '' },
      ],
      'Sketch',
    );
    expect(order.map((file) => file.name)).toEqual(['Sketch.ino']);
  });
});

describe('prototype generation', () => {
  it('generates one per top-level function', async () => {
    const { root } = await parseCpp('int add(int a, int b) { return a + b; }\nvoid setup(){}\n');
    expect(generatePrototypes(root)).toEqual(['int add(int a, int b);', 'void setup();']);
  });

  it('skips functions with default arguments', async () => {
    const { root } = await parseCpp('int ramp(int v, int step = 5) { return v + step; }\nvoid loop(){}\n');
    expect(generatePrototypes(root)).toEqual(['void loop();']);
  });

  it('skips templates, which cannot be prototyped mechanically', async () => {
    const { root } = await parseCpp('template <typename T> T clamp(T v) { return v; }\nvoid loop(){}\n');
    expect(generatePrototypes(root)).toEqual(['void loop();']);
  });

  it('preserves pointer return types', async () => {
    const { root } = await parseCpp('const char *name(int i) { return "x"; }\n');
    expect(generatePrototypes(root)[0]).toContain('*name(int i);');
  });
});

describe('source map round-trip', () => {
  it('resolves every identifier back to its real file, line and column', async () => {
    const main = ['int ledPin = 13;', '', 'void setup() {', '  pinMode(ledPin, OUTPUT);', '}', ''].join('\n');
    const helpers = ['void blink() {', '  digitalWrite(ledPin, HIGH);', '}', ''].join('\n');

    const result = await preprocess(
      [
        { name: 'Sketch.ino', content: main },
        { name: 'helpers.ino', content: helpers },
      ],
      'Sketch',
    );

    const sources = new Map([
      ['Sketch.ino', main.split('\n')],
      ['helpers.ino', helpers.split('\n')],
    ]);

    const { root } = await parseCpp(result.text);
    const identifiers: TsNode[] = [];
    const walk = (node: TsNode): void => {
      if (node.type === 'identifier') identifiers.push(node);
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child !== null) walk(child);
      }
    };
    walk(root);
    expect(identifiers.length).toBeGreaterThan(5);

    let checked = 0;
    for (const node of identifiers) {
      const position = result.map.resolve(node.startIndex);
      if (position === null) continue; // a prototype we invented

      const line = sources.get(position.file)?.[position.line - 1];
      expect(line).toBeDefined();
      // The identifier must actually be at the column we claim.
      expect(line?.slice(position.column - 1, position.column - 1 + node.text.length)).toBe(node.text);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('maps text from the second tab to that tab, not the first', async () => {
    const main = 'void setup(){}\n';
    const helpers = 'void marker(){}\n';

    const result = await preprocess(
      [
        { name: 'Sketch.ino', content: main },
        { name: 'helpers.ino', content: helpers },
      ],
      'Sketch',
    );

    // The definition, not the generated prototype — that appears first in the
    // buffer and is synthetic by design.
    const definition = result.text.indexOf('void marker(){}');
    expect(definition).toBeGreaterThan(-1);
    const position = result.map.resolve(definition + 'void '.length);
    expect(position).toEqual({ file: 'helpers.ino', line: 1, column: 6 });
  });

  it('marks generated prototypes and the Arduino include as synthetic', async () => {
    const result = await preprocess([{ name: 'Sketch.ino', content: 'void setup(){}\nvoid loop(){}\n' }], 'Sketch');

    expect(result.map.isSynthetic(result.text.indexOf('#include <Arduino.h>'))).toBe(true);

    // The prototype block, not the definitions, is synthetic.
    const prototype = result.text.indexOf('void setup();');
    expect(prototype).toBeGreaterThan(-1);
    expect(result.map.isSynthetic(prototype)).toBe(true);
    expect(result.map.resolve(prototype)).toBeNull();

    const definition = result.text.indexOf('void setup(){}');
    expect(result.map.isSynthetic(definition)).toBe(false);
    expect(result.map.resolve(definition)?.line).toBe(1);
  });

  it('keeps the user source byte-for-byte inside the buffer', async () => {
    const content = 'int a = 0x1A;  // hex stays hex\nvoid setup(){}\nvoid loop(){}\n';
    const result = await preprocess([{ name: 'Sketch.ino', content }], 'Sketch');
    expect(result.text).toContain('int a = 0x1A;  // hex stays hex');
  });

  it('inserts prototypes before the first function, not at the top of the file', async () => {
    const content = 'struct Reading { int raw; };\nReading make(){ return Reading{1}; }\nvoid setup(){}\nvoid loop(){}\n';
    const result = await preprocess([{ name: 'Sketch.ino', content }], 'Sketch');

    // The struct must still precede any prototype that names it.
    expect(result.text.indexOf('struct Reading')).toBeLessThan(result.text.indexOf('Reading make();'));
  });
});
