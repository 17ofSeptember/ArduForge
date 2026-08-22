/**
 * Registry-wide invariants, checked against every node rather than a list.
 *
 * A hand-written list is how `math.modulo` was missed: it was in the approved
 * change set and in the validation rules, but nobody noticed the config field
 * was never added, because nothing enumerated the registry and asked. Both
 * suites below walk `allNodeDefs`, so a node added tomorrow is covered without
 * anyone remembering to add it here.
 */
import { describe, it, expect } from 'vitest';
import {
  allNodeDefs,
  execOuts,
  inputPorts,
  outputPorts,
  withConfigDefaults,
} from '@/nodes/registry';
import type { LiteralValue, NodeDef } from '@/nodes/types';

/** Config keys a node's emit/collect actually reads. */
function configKeysRead(def: NodeDef): string[] {
  const sources = [def.emit, def.collect, def.functionEntry]
    .filter((fn): fn is NonNullable<typeof fn> => typeof fn === 'function')
    .map((fn) => fn.toString());

  const keys = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\bconfig\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return [...keys];
}

describe('a node reads only config fields it declares', () => {
  // math.modulo read numericType through validation while never declaring the
  // field, which made its float rejection unreachable from the inspector.
  for (const def of allNodeDefs) {
    const declared = new Set((def.config ?? []).map((field) => field.id));
    const read = configKeysRead(def);
    if (read.length === 0) continue;

    it(`${def.id} declares every config key it reads`, () => {
      const missing = read.filter((key) => !declared.has(key));
      expect(missing, `${def.id} reads ${missing.join(', ')} but declares no such field`).toEqual([]);
    });
  }
});

describe('ports resolve identically whether or not config is fully populated', () => {
  /**
   * The root-cause invariant.
   *
   * `EmitContext.config()` falls back to the def's default when a key is
   * absent, so emit always behaves as though config were complete. If a dynamic
   * port function sees a *partial* config and returns different ports, the two
   * disagree — and codegen inserts casts to satisfy ports that emit never
   * agreed to.
   *
   * That is exactly what happened to the bitwise family: a graph saved before
   * `numericType` existed reported float ports and emitted integer code, so
   * codegen produced `((float)(a) & (float)(b))`, which does not compile.
   *
   * Partial configs are not hypothetical — every project saved before a field
   * was added has one.
   */
  const shapeOf = (def: NodeDef, config: Record<string, LiteralValue>) => ({
    inputs: inputPorts(def, config).map((port) => `${port.id}:${port.type}${port.optional === true ? '?' : ''}`),
    outputs: outputPorts(def, config).map((port) => `${port.id}:${port.type}`),
    execOut: [...execOuts(def, config)],
  });

  for (const def of allNodeDefs) {
    if (def.dynamic === undefined) continue;
    const fields = def.config ?? [];

    it(`${def.id} resolves the same ports from an empty config`, () => {
      const full = withConfigDefaults(def, {}) as Record<string, LiteralValue>;
      expect(shapeOf(def, {}), `${def.id} with no config`).toEqual(shapeOf(def, full));
    });

    for (const field of fields) {
      it(`${def.id} resolves the same ports with "${field.id}" absent`, () => {
        const full = withConfigDefaults(def, {}) as Record<string, LiteralValue>;
        const partial = { ...full };
        delete partial[field.id];
        expect(shapeOf(def, partial), `${def.id} without ${field.id}`).toEqual(shapeOf(def, full));
      });
    }
  }
});

describe('withConfigDefaults', () => {
  it('fills a missing key from the def', () => {
    const def = allNodeDefs.find((candidate) => candidate.id === 'logic.bitAnd');
    expect(def).toBeDefined();
    expect(withConfigDefaults(def!, {})['numericType']).toBe('int');
  });

  it('never overwrites a value the node already has', () => {
    const def = allNodeDefs.find((candidate) => candidate.id === 'logic.bitAnd');
    expect(withConfigDefaults(def!, { numericType: 'long' })['numericType']).toBe('long');
  });

  it('returns the original object when nothing is missing', () => {
    const def = allNodeDefs.find((candidate) => candidate.id === 'math.add');
    const config = { numericType: 'int' as LiteralValue };
    expect(withConfigDefaults(def!, config)).toBe(config);
  });
});

describe('the invariant above can actually fail', () => {
  // Negative control. A suite that only ever asserts "these match" will pass
  // when both sides are empty or when the comparison is inert — the precedence
  // guards did exactly that for three sessions. This proves the shape
  // comparison detects the defect it was written for.
  const broken: NodeDef = {
    id: 'test.broken',
    category: 'math',
    label: 'Broken',
    description: 'A node whose ports disagree with its own defaults.',
    icon: allNodeDefs[0]!.icon,
    kind: 'expression',
    config: [{ kind: 'select', id: 'mode', label: 'Mode', default: 'int', options: [] }],
    dynamic: {
      // Reads the raw config with its own fallback instead of the def default —
      // the exact shape of the bitwise bug.
      outputs: (config) => [{ id: 'out', label: 'Out', type: config['mode'] === 'int' ? 'int' : 'float' }],
    },
    emit: () => ({ expression: '0' }),
  };

  it('detects ports that differ between an empty and a defaulted config', () => {
    const rawShape = (broken.dynamic?.outputs?.({}) ?? []).map((port) => port.type);
    const defaulted = (broken.dynamic?.outputs?.(withConfigDefaults(broken, {})) ?? []).map((port) => port.type);

    expect(rawShape).toEqual(['float']);
    expect(defaulted).toEqual(['int']);
    expect(rawShape).not.toEqual(defaulted);
  });

  it('and the real resolvers no longer differ, because they merge defaults', () => {
    expect(outputPorts(broken, {}).map((port) => port.type)).toEqual(['int']);
  });
});
