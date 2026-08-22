/**
 * Servo component lifting (IMPORT.md §4.1).
 *
 * Every case is a round-trip, because a lift that does not survive one is
 * corruption. The refusals outnumber the lifts on purpose: a wrong pin here is
 * not a compile error, it is a signal on the wrong pin driving physical
 * hardware, and the user will suspect their wiring long before they suspect the
 * import.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { importSketch } from '@/import/importSketch';

async function roundTrip(source: string) {
  const result = await importSketch([{ name: 'Probe.ino', content: source }], { sketchName: 'Probe' });
  return {
    code: generate([...result.nodes], [...result.edges], { projectName: 'Probe' }).code,
    lifted: result.report.componentsLifted,
    warnings: result.report.warnings,
  };
}

const CANONICAL = [
  '#include <Servo.h>',
  'Servo myServo;',
  'int angle = 90;',
  'void setup() {',
  '  myServo.attach(9);',
  '}',
  'void loop() {',
  '  myServo.write(angle);',
  '}',
  '',
].join('\n');

describe('the canonical three-location pattern lifts', () => {
  it('correlates declaration, attach and use into one component', async () => {
    const { code, lifted } = await roundTrip(CANONICAL);

    expect(lifted).toEqual(['Servo myServo (pin 9)']);
    // The node re-emits the object, the include and the library requirement.
    expect(code).toContain('#include <Servo.h>');
    expect(code).toMatch(/Servo servo_\w+;/);
    expect(code).toMatch(/servo_\w+\.attach\(9\);/);
    expect(code).toMatch(/servo_\w+\.write\(angle\);/);
    // The user's object name is gone — that is what makes it a lift.
    expect(code).not.toContain('myServo');
  });

  it('keeps a named pin constant as written', async () => {
    const { code, lifted } = await roundTrip(
      CANONICAL.replace('myServo.attach(9);', 'myServo.attach(SERVO_PIN);').replace(
        'int angle = 90;',
        'const int SERVO_PIN = 6;\nint angle = 90;',
      ),
    );

    expect(lifted).toEqual(['Servo myServo (pin SERVO_PIN)']);
    expect(code).toMatch(/attach\(SERVO_PIN\)/);
  });

  it('lifts writeMicroseconds too', async () => {
    const { code, lifted } = await roundTrip(CANONICAL.replace('myServo.write(angle);', 'myServo.writeMicroseconds(1500);'));
    expect(lifted).toHaveLength(1);
    expect(code).toMatch(/writeMicroseconds\(1500\)/);
  });

  it('lifts two independent servos separately', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo left;',
      'Servo right;',
      'void setup() {',
      '  left.attach(9);',
      '  right.attach(10);',
      '}',
      'void loop() {',
      '  left.write(0);',
      '  right.write(180);',
      '}',
      '',
    ].join('\n');

    const { lifted } = await roundTrip(source);
    // Two objects are not inherently ambiguous; each is judged on its own.
    expect(lifted).toEqual(['Servo left (pin 9)', 'Servo right (pin 10)']);
  });
});

describe('a use lifts wherever the enclosing statements lower', () => {
  it('lifts from inside a canonical for loop, at depth', async () => {
    // The rule is not depth. This `for` lowers to control.for, so the write
    // lands in a real node and the object reference never escapes into raw text.
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  for (int i = 0; i < 180; i++) {',
      '    myServo.write(i);',
      '  }',
      '}',
      '',
    ].join('\n');

    const { code, lifted } = await roundTrip(source);
    expect(lifted).toEqual(['Servo myServo (pin 9)']);
    expect(code).toMatch(/for \(int i = 0; i < 180; i\+\+\)/);
    expect(code).toMatch(/servo_\w+\.write\(i\)/);
    expect(code).not.toContain('myServo');
  });

  it('lifts from inside an if branch', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'int angle = 0;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  if (angle > 90) {',
      '    myServo.write(angle);',
      '  }',
      '}',
      '',
    ].join('\n');

    const { lifted } = await roundTrip(source);
    expect(lifted).toEqual(['Servo myServo (pin 9)']);
  });

  it('lifts from inside a while loop', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'int angle = 0;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  while (angle < 90) {',
      '    myServo.write(angle);',
      '    angle++;',
      '  }',
      '}',
      '',
    ].join('\n');

    const { lifted } = await roundTrip(source);
    expect(lifted).toEqual(['Servo myServo (pin 9)']);
  });

  it('lifts from two levels down when both levels lower', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  for (int i = 0; i < 4; i++) {',
      '    if (i > 1) {',
      '      myServo.write(i);',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n');

    const { lifted } = await roundTrip(source);
    expect(lifted).toEqual(['Servo myServo (pin 9)']);
  });
});

describe('refusals — under any doubt the sketch imports as written', () => {
  const refusedFor = async (source: string) => {
    const { lifted, warnings } = await roundTrip(source);
    expect(lifted).toEqual([]);
    return warnings.filter((warning) => warning.code === 'servo-not-lifted');
  };

  it('refuses attach() outside setup()', async () => {
    const warnings = await refusedFor(CANONICAL.replace('void setup() {\n  myServo.attach(9);\n}', 'void setup() {}').replace('  myServo.write(angle);', '  myServo.attach(9);\n  myServo.write(angle);'));
    expect(warnings[0]?.message).toMatch(/not in setup|nested/i);
  });

  it('refuses attach() inside a branch', async () => {
    const source = CANONICAL.replace('  myServo.attach(9);', '  if (angle > 0) { myServo.attach(9); }');
    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/nested|branch/i);
  });

  it('refuses attach() called twice', async () => {
    const source = CANONICAL.replace('  myServo.attach(9);', '  myServo.attach(9);\n  myServo.attach(10);');
    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/more than once/i);
  });

  it('refuses a servo that is never attached', async () => {
    const warnings = await refusedFor(CANONICAL.replace('  myServo.attach(9);', ''));
    expect(warnings[0]?.message).toMatch(/never called/i);
  });

  it('refuses a computed pin', async () => {
    const warnings = await refusedFor(CANONICAL.replace('myServo.attach(9);', 'myServo.attach(base + 1);'));
    expect(warnings[0]?.message).toMatch(/computed pin/i);
  });

  it('refuses attach() with custom pulse limits', async () => {
    // Dropping them would change how far the servo actually travels.
    const warnings = await refusedFor(CANONICAL.replace('myServo.attach(9);', 'myServo.attach(9, 1000, 2000);'));
    expect(warnings[0]?.message).toMatch(/pulse limits/i);
  });

  it('refuses a pointer to a servo', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'Servo *p = &myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() { p->write(90); }',
      '',
    ].join('\n');
    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/used somewhere other than a method call/i);
  });

  it('refuses when the servo is passed to a function', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void move(Servo &s) { s.write(90); }',
      'void setup() { myServo.attach(9); }',
      'void loop() { move(myServo); }',
      '',
    ].join('\n');
    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/used somewhere other than a method call/i);
  });

  it('refuses a use nested inside a loop, and says why', async () => {
    // Sweep.ino, exactly. The write would stay in a Raw Statement naming an
    // object the lift had already removed.
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'int pos = 0;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  for (pos = 0; pos <= 180; pos += 1) {',
      '    myServo.write(pos);',
      '    delay(15);',
      '  }',
      '}',
      '',
    ].join('\n');

    const warnings = await refusedFor(source);
    // Refused because the enclosing `for` is not canonical and stays Raw — not
    // because of how deeply it is nested.
    expect(warnings[0]?.message).toMatch(/stays as Custom C\+\+/i);
    expect(warnings[0]?.message).toMatch(/an object the lift had removed/i);
  });

  it('refuses a use inside a switch, which does not lower', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'int mode = 0;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  switch (mode) {',
      '    case 0:',
      '      myServo.write(90);',
      '      break;',
      '  }',
      '}',
      '',
    ].join('\n');

    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/stays as Custom C\+\+/i);
  });

  it('refuses .read(), which has no statement node', async () => {
    const source = CANONICAL.replace('  myServo.write(angle);', '  angle = myServo.read();');
    const warnings = await refusedFor(source);
    expect(warnings[0]?.message).toMatch(/read as a value/i);
  });

  it('every refusal names the object and stays compilable', async () => {
    const { code } = await roundTrip(CANONICAL.replace('myServo.attach(9);', 'myServo.attach(base + 1);'));
    // Nothing removed: the declaration and both calls survive verbatim.
    expect(code).toContain('Servo myServo;');
    expect(code).toContain('myServo.attach(base + 1)');
    expect(code).toContain('myServo.write(angle)');
  });
});

describe('the PWM conflict on pins 9 and 10', () => {
  it('warns when analogWrite shares a pin the Servo library took', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() {',
      '  myServo.write(90);',
      '  analogWrite(9, 128);',
      '}',
      '',
    ].join('\n');

    const { warnings } = await roundTrip(source);
    const conflict = warnings.find((warning) => warning.code === 'servo-pwm-conflict');
    expect(conflict).toBeDefined();
    expect(conflict?.message).toMatch(/Timer1/);
    expect(conflict?.message).toMatch(/no effect/i);
  });

  it('warns about pin 10 even when the servo is on 9', async () => {
    // The library takes Timer1, which drives both pins, not just the one in use.
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() { myServo.write(90); analogWrite(10, 64); }',
      '',
    ].join('\n');

    const { warnings } = await roundTrip(source);
    expect(warnings.some((warning) => warning.code === 'servo-pwm-conflict')).toBe(true);
  });

  it('says nothing when analogWrite is on an unaffected pin', async () => {
    const source = [
      '#include <Servo.h>',
      'Servo myServo;',
      'void setup() { myServo.attach(9); }',
      'void loop() { myServo.write(90); analogWrite(3, 64); }',
      '',
    ].join('\n');

    const { warnings } = await roundTrip(source);
    expect(warnings.some((warning) => warning.code === 'servo-pwm-conflict')).toBe(false);
  });
});
