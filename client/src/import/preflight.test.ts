/**
 * Amendment B — lexical pre-flight, before tree-sitter sees anything.
 *
 * Phase 0 measured that an unterminated string swallows the entire file: no
 * functions are recovered, and the resulting tree is worthless. So the parser
 * cannot be the first line of defense. This scan runs first and, on any hit,
 * routes straight to whole-file fallback with a message naming the file, the
 * line, and the construct.
 *
 * The hard part is not finding an unterminated quote. It is not crying wolf on
 * the many places an apostrophe or quote legitimately appears — inside
 * comments, inside the other kind of quote, escaped, or as a digit separator.
 */
import { describe, it, expect } from 'vitest';
import { preflight } from '@/import/preflight';

const file = (content: string) => [{ name: 'Probe.ino', content }];

describe('amendment B — lexical pre-flight', () => {
  it('accepts a clean sketch', () => {
    const source = [
      '// A comment with an apostrophe: don\'t panic.',
      '/* block comment with "quotes" and a stray \' */',
      '#include <Servo.h>',
      'const char *msg = "hello";',
      "const char tab = '\\t';",
      'void setup(){ Serial.println("ok"); }',
      'void loop(){}',
      '',
    ].join('\n');
    expect(preflight(file(source))).toEqual([]);
  });

  it('catches an unterminated string and names the line', () => {
    const source = 'void setup(){\n  Serial.println("oops );\n}\n';
    const problems = preflight(file(source));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.construct).toBe('string');
    expect(problems[0]?.line).toBe(2);
    expect(problems[0]?.file).toBe('Probe.ino');
    expect(problems[0]?.message).toContain('string');
  });

  it('catches an unterminated char literal', () => {
    const source = "void loop(){\n  char c = 'a;\n}\n";
    const problems = preflight(file(source));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.construct).toBe('char');
    expect(problems[0]?.line).toBe(2);
  });

  it('catches an unterminated block comment and points at where it opened', () => {
    const source = 'void setup(){}\n\n/* this never closes\nvoid loop(){}\n';
    const problems = preflight(file(source));

    expect(problems).toHaveLength(1);
    expect(problems[0]?.construct).toBe('block-comment');
    expect(problems[0]?.line).toBe(3);
  });

  // ── the false-positive guards ──

  it('does not flag an apostrophe inside a line comment', () => {
    expect(preflight(file("// it's fine\nvoid setup(){}\n"))).toEqual([]);
  });

  it('does not flag quotes inside a block comment', () => {
    expect(preflight(file('/* "unclosed and unbalanced \' */\nvoid setup(){}\n'))).toEqual([]);
  });

  it('does not flag an escaped quote inside a string', () => {
    expect(preflight(file('const char *s = "she said \\"hi\\"";\n'))).toEqual([]);
  });

  it('does not flag a quote character held in a char literal', () => {
    expect(preflight(file("char q = '\"';\nchar a = '\\'';\n"))).toEqual([]);
  });

  it('does not flag a comment marker inside a string', () => {
    expect(preflight(file('const char *s = "/* not a comment */";\nvoid setup(){}\n'))).toEqual([]);
  });

  it('does not flag a backslash at the end of a string', () => {
    expect(preflight(file('const char *path = "C:\\\\";\nvoid setup(){}\n'))).toEqual([]);
  });

  it('reports the file that actually contains the problem', () => {
    const problems = preflight([
      { name: 'Main.ino', content: 'void setup(){}\n' },
      { name: 'helpers.ino', content: 'const char *s = "oops;\n' },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe('helpers.ino');
    expect(problems[0]?.line).toBe(1);
  });

  it('a string may not span a line break', () => {
    // C++ requires a continuation backslash; without one this is unterminated,
    // and treating it as multi-line would hide the error.
    const problems = preflight(file('const char *s = "start\nend";\n'));
    expect(problems.length).toBeGreaterThanOrEqual(1);
    expect(problems[0]?.construct).toBe('string');
  });

  it('allows a string continued with a trailing backslash', () => {
    expect(preflight(file('const char *s = "start\\\nend";\nvoid setup(){}\n'))).toEqual([]);
  });

  it('allows a raw string literal containing quotes', () => {
    expect(preflight(file('const char *s = R"(he said "hi")";\nvoid setup(){}\n'))).toEqual([]);
  });
});
