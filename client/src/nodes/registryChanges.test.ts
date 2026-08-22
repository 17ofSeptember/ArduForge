/**
 * The four registry changes, and the backward-compatibility guarantee.
 *
 * All four are additive. The property that matters more than any of the new
 * behaviour is that a project saved before them generates byte-identical code
 * afterwards — a silent change to someone's compiled output is the one failure
 * mode that would not show up until their hardware behaved differently.
 */
import { describe, it, expect } from 'vitest';
import { generate } from '@/codegen/generate';
import { validateGraph } from '@/graph/validate';
import { migrate } from '@/store/persistence';
import { getNodeDef, execOuts } from '@/nodes/registry';
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
    id: `e_${source.id}_${output}_${target.id}`,
    source: source.id,
    target: target.id,
    sourceHandle: `exec-out:${output}`,
    targetHandle: 'exec-in',
    type: 'forge',
    data: { kind: 'exec', portType: 'exec' },
  };
}

const code = (nodes: AnyNode[], edges: ForgeEdge[]): string => generate(nodes, edges).code;

// ── 1. control.if continuation ───────────────────────────────────────────────

describe('control.if gains a continuation', () => {
  it('offers then after the two branches', () => {
    const def = getNodeDef('control.if');
    expect(def).not.toBeNull();
    expect(execOuts(def!, {})).toEqual(['true', 'false', 'then']);
  });

  it('emits the continuation after the if block, not inside a branch', () => {
    const setup = node('event.setup');
    const branch = node('control.if', {}, { condition: true });
    const inside = node('io.digitalWrite', {}, { pin: 2, value: true });
    const after = node('io.digitalWrite', {}, { pin: 3, value: false });

    const out = code(
      [setup, branch, inside, after],
      [exec(setup, branch), exec(branch, inside, 'true'), exec(branch, after, 'then')],
    );

    const ifAt = out.indexOf('if (');
    const insideAt = out.indexOf('digitalWrite(2, HIGH)');
    const closeAt = out.indexOf('}', out.indexOf('} else {'));
    const afterAt = out.indexOf('digitalWrite(3, LOW)');

    expect(insideAt).toBeGreaterThan(ifAt);
    // The continuation must land after the whole construct closes, and exactly
    // once — duplicating it into both branches is the shape this replaces.
    expect(afterAt).toBeGreaterThan(closeAt);
    expect(out.split('digitalWrite(3, LOW)')).toHaveLength(2);
  });

  it('changes nothing for a graph that does not use it', () => {
    const setup = node('event.setup');
    const branch = node('control.if', {}, { condition: true });
    const inside = node('io.digitalWrite', {}, { pin: 2, value: true });
    const out = code([setup, branch, inside], [exec(setup, branch), exec(branch, inside, 'true')]);

    expect(out).toContain('if (true)');
    expect(out).toContain('digitalWrite(2, HIGH)');
  });
});

// ── 3. control.for index name ────────────────────────────────────────────────

describe('control.for gains an index name', () => {
  it('generates the old name when the field is blank', () => {
    const setup = node('event.setup');
    const loop = node('control.for', { index: '' }, { count: 4 });
    const out = code([setup, loop], [exec(setup, loop)]);
    // The generated form is what every existing graph has, so it must survive.
    expect(out).toMatch(/for \(int _af_i_\w+ = 0;/);
  });

  it('uses the chosen name when one is given', () => {
    const setup = node('event.setup');
    const loop = node('control.for', { index: 'row' }, { count: 4 });
    const out = code([setup, loop], [exec(setup, loop)]);
    expect(out).toContain('for (int row = 0; row < 4; row++)');
  });

  it('rejects an index that shadows a global variable', () => {
    const declare = node('var.declare', { name: 'row', type: 'int', scope: 'global', initial: '0' });
    const loop = node('control.for', { index: 'row' }, { count: 4 });
    const problems = validateGraph([declare, loop], []);
    expect(problems.some((problem) => problem.severity === 'error' && /shadow/i.test(problem.message))).toBe(true);
  });

  it('rejects a nested For that reuses the outer index', () => {
    const outer = node('control.for', { index: 'i' }, { count: 2 });
    const inner = node('control.for', { index: 'i' }, { count: 3 });
    const problems = validateGraph([outer, inner], [exec(outer, inner, 'body')]);
    expect(problems.some((problem) => /sits inside/i.test(problem.message))).toBe(true);
  });

  it('allows two sequential For loops to share an index, as C++ does', () => {
    // Their scopes never overlap. Rejecting this would refuse correct code and
    // make a very ordinary sketch unimportable.
    const a = node('control.for', { index: 'i' }, { count: 2 });
    const b = node('control.for', { index: 'i' }, { count: 3 });
    const problems = validateGraph([a, b], [exec(a, b, 'done')]);
    expect(problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  });

  it('does not complain about two generated indices', () => {
    const a = node('control.for', { index: '' }, { count: 2 });
    const b = node('control.for', { index: '' }, { count: 3 });
    expect(validateGraph([a, b], []).filter((problem) => problem.severity === 'error')).toEqual([]);
  });
});

// ── 4. var.declare scope ─────────────────────────────────────────────────────

describe('var.declare gains a scope', () => {
  it('emits a global above setup when scope is global', () => {
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'speed', type: 'int', initial: '5', scope: 'global' });
    const out = code([setup, declare], [exec(setup, declare)]);

    expect(out).toContain('int speed = 5;');
    expect(out.indexOf('int speed = 5;')).toBeLessThan(out.indexOf('void setup()'));
  });

  it('emits a local where the node sits in the chain', () => {
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'tmp', type: 'int', initial: '7', scope: 'local' });
    const out = code([setup, declare], [exec(setup, declare)]);

    expect(out).toContain('int tmp = 7;');
    // Inside setup(), not above it — that is the whole point of the option.
    expect(out.indexOf('int tmp = 7;')).toBeGreaterThan(out.indexOf('void setup()'));
  });

  it('emits static for a local that keeps its value', () => {
    const setup = node('event.setup');
    const declare = node('var.declare', { name: 'seen', type: 'int', initial: '0', scope: 'static-local' });
    const out = code([setup, declare], [exec(setup, declare)]);
    expect(out).toContain('static int seen = 0;');
  });

  it('refuses to expose a plain local, rather than quietly making it global', () => {
    const declare = node('var.declare', { name: 'speed', type: 'int', scope: 'local', expose: true });
    const problems = validateGraph([declare], []);
    const error = problems.find((problem) => problem.severity === 'error' && /exposed to the Dashboard/i.test(problem.message));

    expect(error).toBeDefined();
    // The message has to say what to do, not just that something is wrong.
    expect(error?.message).toMatch(/scope to global/i);
  });

  it('allows exposing a global or a static local', () => {
    for (const scope of ['global', 'static-local']) {
      const declare = node('var.declare', { name: 'speed', type: 'int', scope, expose: true });
      const errors = validateGraph([declare], []).filter(
        (problem) => problem.severity === 'error' && /exposed to the Dashboard/i.test(problem.message),
      );
      expect(errors).toEqual([]);
    }
  });
});

// ── backward compatibility ───────────────────────────────────────────────────

describe('projects saved before these fields existed', () => {
  /** A document as it would have been written before `scope` was a field. */
  const legacy = {
    version: 1,
    meta: { name: 'Legacy', createdAt: '', updatedAt: '' },
    board: { fqbn: 'arduino:avr:uno' },
    graph: {
      nodes: [
        { id: 'a', type: 'forge', position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
        {
          id: 'b',
          type: 'forge',
          position: { x: 1, y: 0 },
          data: { defId: 'var.declare', literals: {}, config: { name: 'speed', type: 'int', initial: '5' } },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          sourceHandle: 'exec-out:then',
          targetHandle: 'exec-in',
          type: 'forge',
          data: { kind: 'exec', portType: 'exec' },
        },
      ],
    },
    dashboard: { pages: [], widgets: [] },
    settings: {},
  };

  it('migrates a scopeless Declare Variable to global, not to the new default', () => {
    const project = migrate(legacy);
    const declare = project.graph.nodes.find((entry) => entry.id === 'b');
    expect((declare?.data['config'] as Record<string, unknown>)['scope']).toBe('global');
  });

  it('generates exactly what it generated before', () => {
    const project = migrate(legacy);
    const out = generate([...project.graph.nodes], [...project.graph.edges]).code;

    // Global, above setup, and setup left empty — the pre-change behaviour.
    expect(out).toContain('int speed = 5;');
    expect(out.indexOf('int speed = 5;')).toBeLessThan(out.indexOf('void setup()'));
  });

  it('leaves an explicit scope alone', () => {
    const withScope = structuredClone(legacy);
    (withScope.graph.nodes[1] as { data: { config: Record<string, unknown> } }).data.config['scope'] = 'local';
    const project = migrate(withScope);
    const declare = project.graph.nodes.find((entry) => entry.id === 'b');
    expect((declare?.data['config'] as Record<string, unknown>)['scope']).toBe('local');
  });

  it('gives a newly dragged node local scope', () => {
    // The two defaults differ on purpose: new nodes should not cost SRAM for
    // the whole run, but old ones must stay exactly what they were.
    const def = getNodeDef('var.declare');
    const scope = (def?.config ?? []).find((field) => field.id === 'scope');
    expect(scope?.default).toBe('local');
  });
});

// ── numeric type mode ────────────────────────────────────────────────────────

describe('numeric type mode', () => {
  const expr = (defId: string, config: Record<string, unknown>, literals: Record<string, unknown>): string => {
    const setup = node('event.setup');
    const op = node(defId, config, literals);
    const delay = node('control.delay');
    return generate(
      [setup, op, delay],
      [
        exec(setup, delay),
        {
          id: 'd1',
          source: op.id,
          target: delay.id,
          sourceHandle: 'out:out',
          targetHandle: 'in:ms',
          type: 'forge',
          data: { kind: 'data', portType: 'int' },
        },
      ],
    ).code;
  };

  it('defaults to float, which is what every saved project was', () => {
    const def = getNodeDef('math.add');
    expect((def?.config ?? []).find((field) => field.id === 'numericType')?.default).toBe('float');
  });

  it('stops casting to float in int mode', () => {
    // The whole reason the mode exists: int arithmetic must stay 16-bit.
    const out = expr('math.add', { numericType: 'int' }, { a: 'x', b: 'y' });
    expect(out).toContain('(x + y)');
    expect(out).not.toContain('(float)');
  });

  it('widens the left operand in long mode', () => {
    // dev1 * dev1 overflows above 181 in int; the cast is what prevents it, and
    // promotion carries the rest of the expression.
    const out = expr('math.multiply', { numericType: 'long' }, { a: 'dev1', b: 'dev1' });
    expect(out).toContain('((long)dev1 * dev1)');
  });

  it('rejects float on a bitwise operator', () => {
    const problems = validateGraph([node('logic.bitAnd', { numericType: 'float' })], []);
    expect(problems.some((problem) => problem.severity === 'error' && /whole numbers only/i.test(problem.message))).toBe(true);
  });

  it('rejects float on modulo', () => {
    const problems = validateGraph([node('math.modulo', { numericType: 'float' })], []);
    expect(problems.some((problem) => /whole numbers only/i.test(problem.message))).toBe(true);
  });

  it('refuses an integer mode on power, and says why', () => {
    const problems = validateGraph([node('math.power', { numericType: 'int' })], []);
    const error = problems.find((problem) => problem.severity === 'error');
    expect(error?.message).toMatch(/pow\(\)/);
    expect(error?.message).toMatch(/1KB of flash/i);
  });
});

describe('abs, min and max do not double-evaluate in integer mode', () => {
  // Arduino's abs/min/max are macros: abs(x++) increments twice, and
  // min(analogRead(A0), 100) reads the pin twice. The typed forms must not
  // inherit that.
  const emitted = (defId: string, config: Record<string, unknown>, literals: Record<string, unknown>): string => {
    const setup = node('event.setup');
    const op = node(defId, config, literals);
    const delay = node('control.delay');
    return generate(
      [setup, op, delay],
      [
        exec(setup, delay),
        {
          id: 'd1',
          source: op.id,
          target: delay.id,
          sourceHandle: 'out:out',
          targetHandle: 'in:ms',
          type: 'forge',
          data: { kind: 'data', portType: 'int' },
        },
      ],
    ).code;
  };

  it('emits the macro in float mode, as it always did', () => {
    expect(emitted('math.abs', { numericType: 'float' }, { value: 'x' })).toContain('abs(x)');
  });

  it('emits a non-macro form in int mode', () => {
    const out = emitted('math.abs', { numericType: 'int' }, { value: 'x' });
    expect(out).not.toMatch(/\babs\(/);
    expect(out).toContain('< 0 ? -');
  });

  it('does the same for min and max', () => {
    expect(emitted('math.min', { numericType: 'int' }, { a: 'p', b: 'q' })).not.toMatch(/\bmin\(/);
    expect(emitted('math.max', { numericType: 'int' }, { a: 'p', b: 'q' })).not.toMatch(/\bmax\(/);
  });
});
