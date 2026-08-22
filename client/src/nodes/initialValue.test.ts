/**
 * Declare Variable's initial value: notation, the port, and validation.
 *
 * The old field ran every value through `Number()`, which made this the one
 * node in the registry that destroyed notation — `0x1A` became `26` and a
 * reference to a constant became `0`, both silently and both compiling fine.
 * These tests pin the new rule: a value on a typed port is source text, and the
 * port's type only decides how a *bare number* is formatted.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { validateGraph } from '@/graph/validate';
import type { AnyNode, ForgeEdge } from '@/graph/model';

let sequence = 0;
function node(defId: string, config: Record<string, unknown> = {}, literals: Record<string, unknown> = {}): AnyNode {
  sequence += 1;
  return {
    id: `n${sequence}`,
    type: 'forge',
    position: { x: 0, y: 0 },
    data: { defId, literals: literals as never, config: config as never },
  };
}

function exec(source: AnyNode, target: AnyNode, output = 'then'): ForgeEdge {
  return {
    id: `x_${source.id}_${output}_${target.id}`,
    source: source.id,
    target: target.id,
    sourceHandle: `exec-out:${output}`,
    targetHandle: 'exec-in',
    type: 'forge',
    data: { kind: 'exec', portType: 'exec' },
  };
}

function data(source: AnyNode, target: AnyNode, port: string, portType: 'int' | 'float'): ForgeEdge {
  return {
    id: `d_${source.id}_${target.id}_${port}`,
    source: source.id,
    target: target.id,
    sourceHandle: 'out:out',
    targetHandle: `in:${port}`,
    type: 'forge',
    data: { kind: 'data', portType },
  };
}

/** A declaration in setup(), so the emitted text is easy to assert on. */
function declared(config: Record<string, unknown>, extra: AnyNode[] = [], edges: ForgeEdge[] = []): string {
  const setup = node('event.setup');
  const declare = node('var.declare', { scope: 'local', ...config });
  return generate([setup, declare, ...extra], [exec(setup, declare), ...edges]).code;
}

describe('notation is preserved exactly', () => {
  it('keeps a hex literal hex', () => {
    // The old behaviour emitted 26, which compiles identically and is still a
    // fidelity failure — the user wrote a mask, not a count.
    expect(declared({ name: 'mask', type: 'int', initial: '0x1A' })).toContain('int mask = 0x1A;');
  });

  it('keeps a binary literal binary', () => {
    expect(declared({ name: 'bits', type: 'int', initial: '0b1010' })).toContain('int bits = 0b1010;');
  });

  it('keeps an exponent literal', () => {
    expect(declared({ name: 'big', type: 'float', initial: '1e3' })).toContain('float big = 1e3;');
  });

  it('keeps a float suffix', () => {
    // Number('0.05f') is NaN, which is how this used to become 0.0f.
    expect(declared({ name: 'gain', type: 'float', initial: '0.05f' })).toContain('float gain = 0.05f;');
  });

  it('keeps a character literal', () => {
    expect(declared({ name: 'key', type: 'int', initial: "'A'" })).toContain("int key = 'A';");
  });

  it('keeps a reference to another constant', () => {
    expect(declared({ name: 'limit', type: 'int', initial: 'LOW_THRESHOLD' })).toContain('int limit = LOW_THRESHOLD;');
  });

  it('keeps an Arduino pin constant', () => {
    expect(declared({ name: 'pin', type: 'int', initial: 'A0' })).toContain('int pin = A0;');
  });

  // ── the backward-compatible half ──

  it('still formats a bare decimal for a float', () => {
    // A bare number carries no notation the user chose, so formatting it is the
    // one reshaping that stays. This is what keeps saved projects identical.
    expect(declared({ name: 'x', type: 'float', initial: '0.05' })).toContain('float x = 0.05f;');
    expect(declared({ name: 'y', type: 'float', initial: '0' })).toContain('float y = 0.0f;');
  });

  it('still emits bare decimals unchanged for an int', () => {
    expect(declared({ name: 'n', type: 'int', initial: '255' })).toContain('int n = 255;');
  });

  it('still quotes a bare string', () => {
    expect(declared({ name: 's', type: 'String', initial: 'hello' })).toContain('String s = "hello";');
  });

  it('leaves an already-quoted string alone', () => {
    expect(declared({ name: 's', type: 'String', initial: '"hi"' })).toContain('String s = "hi";');
  });

  it('still maps bool the old way', () => {
    expect(declared({ name: 'b', type: 'bool', initial: 'false' })).toContain('bool b = false;');
    expect(declared({ name: 'c', type: 'bool', initial: '1' })).toContain('bool c = true;');
  });
});

describe('the initial value port', () => {
  it('is ignored when nothing is connected', () => {
    expect(declared({ name: 'x', type: 'int', initial: '7' })).toContain('int x = 7;');
  });

  it('does not require a connection', () => {
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'x', type: 'int', initial: '7', scope: 'local' });
    const errors = validateGraph([setup, declare], [exec(setup, declare)]).filter(
      (problem) => problem.severity === 'error',
    );
    expect(errors).toEqual([]);
  });

  it('uses the wired expression when connected, ignoring the field', () => {
    const source = node('io.analogRead', {}, { pin: 'A0' });
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'reading', type: 'int', initial: '999', scope: 'local' });

    const out = generate(
      [setup, declare, source],
      [exec(setup, declare), data(source, declare, 'value', 'int')],
    ).code;

    expect(out).toContain('int reading = analogRead(A0);');
    expect(out).not.toContain('999');
  });

  it('assigns rather than initialises when a global is wired', () => {
    // A global's initializer cannot depend on an expression evaluated later, so
    // the declaration stays bare and the value is assigned in the chain.
    const source = node('io.analogRead', {}, { pin: 'A0' });
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'reading', type: 'int', initial: '0', scope: 'global' });

    const out = generate(
      [setup, declare, source],
      [exec(setup, declare), data(source, declare, 'value', 'int')],
    ).code;

    expect(out).toContain('int reading;');
    expect(out).toContain('reading = analogRead(A0);');
    expect(out.indexOf('int reading;')).toBeLessThan(out.indexOf('void setup()'));
  });
});

describe('the field rejects an expression and points at the port', () => {
  const problemsFor = (initial: string, type = 'int') =>
    validateGraph([node('var.declare', { name: 'x', type, initial, scope: 'local' })], []).filter(
      (problem) => problem.severity === 'error',
    );

  it('rejects arithmetic', () => {
    const [problem] = problemsFor('a + b');
    expect(problem).toBeDefined();
    expect(problem?.message).toMatch(/Connect the Initial value input/i);
  });

  it('rejects a call', () => {
    expect(problemsFor('analogRead(A0)').length).toBeGreaterThan(0);
  });

  it('accepts every literal notation', () => {
    for (const value of ['0x1A', '0b1010', '42', '42UL', '1e3', '0.05f', "'A'", '-5', 'LOW_THRESHOLD', 'A0']) {
      expect(problemsFor(value), `expected ${value} to be accepted`).toEqual([]);
    }
  });

  it('accepts anything at all for a String', () => {
    expect(problemsFor('hello there', 'String')).toEqual([]);
  });

  it('says nothing when the port is wired, whatever the field holds', () => {
    const source = node('io.analogRead', {}, { pin: 'A0' });
    const declare = node('var.declare', { name: 'x', type: 'int', initial: 'a + b', scope: 'local' });
    const errors = validateGraph([declare, source], [data(source, declare, 'value', 'int')]).filter(
      (problem) => /Initial value/i.test(problem.message),
    );
    expect(errors).toEqual([]);
  });
});
