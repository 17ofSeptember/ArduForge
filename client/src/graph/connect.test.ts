import { describe, expect, it } from 'vitest';
import { resolveConnection } from '@/graph/connect';
import type { AnyNode } from '@/graph/model';

function forgeNode(id: string, defId: string): AnyNode {
  return {
    id,
    type: 'forge',
    position: { x: 0, y: 0 },
    data: { defId, literals: {}, config: {} },
  };
}

const NODES: AnyNode[] = [
  forgeNode('loop', 'event.loop'),
  forgeNode('write', 'io.digitalWrite'),
  forgeNode('delay', 'control.delay'),
  forgeNode('text', 'text.string'),
  forgeNode('analog', 'io.analogRead'),
];

describe('resolveConnection', () => {
  it('accepts an exec edge between an entry and a statement', () => {
    const result = resolveConnection(
      { source: 'loop', sourceHandle: 'exec-out:then', target: 'write', targetHandle: 'exec-in' },
      NODES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.edge.data?.kind).toBe('exec');
  });

  it('accepts a data edge whose types match', () => {
    const result = resolveConnection(
      { source: 'analog', sourceHandle: 'out:value', target: 'delay', targetHandle: 'in:ms' },
      NODES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edge.data?.kind).toBe('data');
      expect(result.edge.data?.portType).toBe('int');
    }
  });

  it('rejects a string output feeding an int input, and says why', () => {
    // The Phase 3 gate: "Try to connect a string output to an int input and get
    // a clear rejection."
    const result = resolveConnection(
      { source: 'text', sourceHandle: 'out:out', target: 'delay', targetHandle: 'in:ms' },
      NODES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/string .*cannot feed .*integer/i);
  });

  it('rejects mixing exec and data ports', () => {
    const result = resolveConnection(
      { source: 'analog', sourceHandle: 'out:value', target: 'write', targetHandle: 'exec-in' },
      NODES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/execution/i);
  });

  it('rejects a self-connection', () => {
    const result = resolveConnection(
      { source: 'write', sourceHandle: 'exec-out:then', target: 'write', targetHandle: 'exec-in' },
      NODES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/itself/i);
  });

  it('rejects an endpoint that no longer exists', () => {
    const result = resolveConnection(
      { source: 'ghost', sourceHandle: 'exec-out:then', target: 'write', targetHandle: 'exec-in' },
      NODES,
    );
    expect(result.ok).toBe(false);
  });

  it('reports the implicit conversion on an int -> string edge', () => {
    const result = resolveConnection(
      { source: 'analog', sourceHandle: 'out:value', target: 'text', targetHandle: 'in:value' },
      NODES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toMatch(/String\(\)/);
  });
});
