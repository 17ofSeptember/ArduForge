import { describe, expect, it } from 'vitest';
import { parseCompilerErr, splitMessage } from '@/cli/compile.js';
import { validateFileName } from '@/build/store.js';

const CTX = { sketchDir: '/private/tmp/build/Sketch', sketchName: 'Sketch' };

describe('splitMessage', () => {
  it('separates the gcc message from its source excerpt', () => {
    const { message, snippet } = splitMessage("expected ';' before 'delay'\n   delay(500);\n   ^~~~~");
    expect(message).toBe("expected ';' before 'delay'");
    expect(snippet).toBe('   delay(500);\n   ^~~~~');
  });

  it('handles a message with no excerpt', () => {
    expect(splitMessage('redefinition of int x')).toEqual({
      message: 'redefinition of int x',
      snippet: null,
    });
  });
});

describe('parseCompilerErr (fallback when structured diagnostics are absent)', () => {
  it('extracts file, line, column, severity, and message', () => {
    const diagnostics = parseCompilerErr(
      "/private/tmp/build/Sketch/Sketch.ino:7:3: error: expected ';' before 'delay'",
      CTX,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      file: 'Sketch.ino',
      line: 7,
      column: 3,
      severity: 'error',
      message: "expected ';' before 'delay'",
    });
  });

  it('parses a diagnostic with no column', () => {
    const diagnostics = parseCompilerErr('/private/tmp/build/Sketch/Sketch.ino:12: warning: unused', CTX);
    expect(diagnostics[0]?.line).toBe(12);
    expect(diagnostics[0]?.column).toBeNull();
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('maps "fatal error" to error severity', () => {
    const diagnostics = parseCompilerErr(
      '/private/tmp/build/Sketch/Sketch.ino:1:10: fatal error: Servo.h: No such file or directory',
      CTX,
    );
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('keeps paths outside the sketch dir absolute so library errors stay traceable', () => {
    const diagnostics = parseCompilerErr('/usr/local/lib/Servo/Servo.cpp:44:1: error: boom', CTX);
    expect(diagnostics[0]?.file).toBe('/usr/local/lib/Servo/Servo.cpp');
  });

  it('ignores lines that are not diagnostics', () => {
    expect(parseCompilerErr('Linking everything together...\nDone.', CTX)).toHaveLength(0);
  });
});

describe('validateFileName', () => {
  it('accepts ordinary sketch and source file names', () => {
    for (const name of ['Sketch.ino', 'AwryLink.h', 'AwryLink.cpp', 'my_helper-2.hpp']) {
      expect(validateFileName(name)).toBeNull();
    }
  });

  it('rejects path traversal and separators', () => {
    // These names are written straight to disk, so rejection must be total.
    for (const name of ['../evil.ino', '/etc/passwd.ino', 'a/b.ino', '..ino', './x.ino']) {
      expect(validateFileName(name)).not.toBeNull();
    }
  });

  it('rejects disallowed extensions', () => {
    for (const name of ['payload.sh', 'notes.txt', 'Sketch']) {
      expect(validateFileName(name)).not.toBeNull();
    }
  });
});
