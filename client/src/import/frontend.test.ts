/**
 * Comment attachment and directive classification (IMPORT.md §Phase 1).
 *
 * Comment attachment gets its own tests because it is the one part of the
 * frontend the fidelity gates cannot check: comments do not affect compiled
 * output, so Gate 1 passes on a sketch stripped of every one of them.
 */
import { describe, it, expect } from 'vitest';
import { parseCpp } from '@/import/grammar';
import { allComments, attachComments } from '@/import/comments';
import { classifyDirectives } from '@/import/directives';

describe('comment attachment', () => {
  it('attaches a comment above a statement as leading', async () => {
    const source = ['void setup(){', '  // turn the LED on', '  digitalWrite(13, HIGH);', '}', ''].join('\n');
    const { root } = await parseCpp(source);
    const map = attachComments(root);

    const target = source.indexOf('digitalWrite');
    expect(map.get(target)?.leading).toEqual(['// turn the LED on']);
  });

  it('attaches a same-line comment as trailing', async () => {
    const source = ['void setup(){', '  digitalWrite(13, HIGH); // on', '}', ''].join('\n');
    const { root } = await parseCpp(source);
    const map = attachComments(root);

    const target = source.indexOf('digitalWrite');
    expect(map.get(target)?.trailing).toEqual(['// on']);
  });

  it('keeps a run of comments together as one leading block', async () => {
    const source = ['// first', '// second', '// third', 'int pin = 13;', ''].join('\n');
    const { root } = await parseCpp(source);
    const map = attachComments(root);

    expect(map.get(source.indexOf('int pin'))?.leading).toEqual(['// first', '// second', '// third']);
  });

  it('attaches a block comment above a function to that function', async () => {
    const source = ['/* Blinks the LED. */', 'void blink(){}', ''].join('\n');
    const { root } = await parseCpp(source);
    const map = attachComments(root);

    expect(map.get(source.indexOf('void blink'))?.leading).toEqual(['/* Blinks the LED. */']);
  });

  it('gives a trailing comment at the end of a block to the last statement', async () => {
    const source = ['void setup(){', '  pinMode(13, OUTPUT);', '  // nothing else to do', '}', ''].join('\n');
    const { root } = await parseCpp(source);
    const map = attachComments(root);

    expect(map.get(source.indexOf('pinMode'))?.trailing).toEqual(['// nothing else to do']);
  });

  it('loses no comment anywhere in a realistic sketch', async () => {
    const source = [
      '// header comment',
      '#include <Servo.h>   // the library',
      '',
      '/* a block',
      '   over two lines */',
      'int pin = 9;',
      '',
      'void setup(){',
      '  // configure',
      '  pinMode(pin, OUTPUT); // trailing',
      '}',
      'void loop(){}',
      '',
    ].join('\n');

    const { root } = await parseCpp(source);
    const attached = attachComments(root);

    let count = 0;
    for (const entry of attached.values()) count += entry.leading.length + entry.trailing.length;

    expect(count).toBe(allComments(root).length);
    expect(count).toBe(5);
  });
});

describe('directive classification', () => {
  it('treats an object-like define of a number as a literal', async () => {
    const { root } = await parseCpp('#define LED_PIN 13\n');
    const [directive] = classifyDirectives(root);
    expect(directive?.kind).toBe('define-literal');
    expect(directive?.name).toBe('LED_PIN');
    expect(directive?.value).toBe('13');
  });

  it('preserves the original notation of a hex define', async () => {
    const { root } = await parseCpp('#define MASK 0x1A\n');
    expect(classifyDirectives(root)[0]?.value).toBe('0x1A');
  });

  it('treats an Arduino pin constant as a literal', async () => {
    const { root } = await parseCpp('#define SENSOR_PIN A0\n');
    expect(classifyDirectives(root)[0]?.kind).toBe('define-literal');
  });

  it('treats a string define as a literal', async () => {
    const { root } = await parseCpp('#define VERSION "1.2.0"\n');
    const [directive] = classifyDirectives(root);
    expect(directive?.kind).toBe('define-literal');
    expect(directive?.value).toBe('"1.2.0"');
  });

  it('does not treat a compound expression as a literal', async () => {
    // Turning this into a variable would change when it is evaluated.
    const { root } = await parseCpp('#define AREA (WIDTH * HEIGHT)\n');
    expect(classifyDirectives(root)[0]?.kind).toBe('define-expression');
  });

  it('classifies a function-like macro separately', async () => {
    const { root } = await parseCpp('#define SQUARE(x) ((x) * (x))\n');
    const [directive] = classifyDirectives(root);
    expect(directive?.kind).toBe('define-function');
    expect(directive?.name).toBe('SQUARE');
  });

  it('takes an entire conditional block as one unit, directives included', async () => {
    const source = ['#ifdef __AVR__', '  const int maxSamples = 16;', '#else', '  const int maxSamples = 64;', '#endif', ''].join(
      '\n',
    );
    const { root } = await parseCpp(source);
    const conditionals = classifyDirectives(root).filter((directive) => directive.kind === 'conditional');

    expect(conditionals).toHaveLength(1);
    const block = conditionals[0];
    if (block === undefined) throw new Error('no block');
    expect(block.text).toContain('#ifdef __AVR__');
    expect(block.text).toContain('#endif');
    expect(block.text).toContain('maxSamples = 64');
  });

  it('does not lift a define out of a conditional', async () => {
    // Hoisting this out would apply it unconditionally on every board.
    const source = ['#if DEBUG', '#define LOG(m) Serial.println(m)', '#endif', ''].join('\n');
    const { root } = await parseCpp(source);
    const directives = classifyDirectives(root);

    expect(directives).toHaveLength(1);
    expect(directives[0]?.kind).toBe('conditional');
  });

  it('records includes', async () => {
    const { root } = await parseCpp('#include <Servo.h>\n#include "local.h"\n');
    const includes = classifyDirectives(root).filter((directive) => directive.kind === 'include');
    expect(includes.map((directive) => directive.name)).toEqual(['<Servo.h>', '"local.h"']);
  });
});
