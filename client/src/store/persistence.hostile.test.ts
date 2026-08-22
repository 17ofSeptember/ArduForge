/**
 * AUDIT Pass 1 item 4 — hostile `.forge` documents.
 *
 * A project file is untrusted input: it arrives from disk, from another
 * machine, or from a half-written autosave. Every case here must fail with a
 * message that names the problem, or load into a graph the editor can render.
 * "Throws something" is not good enough and neither is "loads a shape that
 * white-screens the canvas two ticks later".
 */
import { describe, it, expect } from 'vitest';
import { migrate, ProjectFormatError, emptyProject } from '@/store/persistence';
import { validateGraph } from '@/graph/validate';
import type { AnyNode, ForgeEdge } from '@/graph/model';

/** What App.tsx does on import: parse, migrate, then hand to the store. */
function open(text: string) {
  return migrate(JSON.parse(text));
}

describe('hostile .forge documents', () => {
  it('rejects a non-object document with a specific message', () => {
    expect(() => migrate('nonsense')).toThrow(ProjectFormatError);
    expect(() => migrate(42)).toThrow(/not an ArduForge project/i);
    expect(() => migrate(null)).toThrow(/not an ArduForge project/i);
    // An array is JSON but not a document; it must not be mistaken for one.
    expect(() => migrate([])).toThrow(/not an ArduForge project/i);
  });

  it('rejects a truncated document rather than opening a blank canvas', () => {
    const full = JSON.stringify({ ...emptyProject('X'), graph: { nodes: [], edges: [] } });
    const truncated = full.slice(0, Math.floor(full.length / 2));
    expect(() => open(truncated)).toThrow(SyntaxError);
  });

  it('rejects a document whose graph is missing entirely', () => {
    expect(() => migrate({ version: 1 })).toThrow(/no readable graph/i);
    expect(() => migrate({ version: 1, graph: {} })).toThrow(/no readable graph/i);
    expect(() => migrate({ version: 1, graph: { nodes: [], edges: 'x' } })).toThrow(
      /no readable graph/i,
    );
  });

  it('refuses a document from a newer format version', () => {
    expect(() => migrate({ version: 99, graph: { nodes: [], edges: [] } })).toThrow(
      /newer version/i,
    );
  });

  it('lifts a v0 document that stored nodes and edges at the top level', () => {
    const migrated = migrate({ nodes: [], edges: [] });
    expect(migrated.version).toBe(1);
    expect(migrated.graph.nodes).toEqual([]);
  });

  // ── the ones the audit specifically calls out ──────────────────────────────

  it('surfaces an unknown node type as a validation error, not a crash', () => {
    const doc = {
      version: 1,
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'forge',
            position: { x: 0, y: 0 },
            data: { defId: 'from.the.future', literals: {}, config: {} },
          },
        ],
        edges: [],
      },
    };
    const project = migrate(doc);
    const problems = validateGraph(
      project.graph.nodes,
      project.graph.edges,
    );
    expect(problems.some((p) => /unknown node type/i.test(p.message))).toBe(true);
  });

  it('does not carry edges that reference nodes the document does not contain', () => {
    const doc = {
      version: 1,
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'forge',
            position: { x: 0, y: 0 },
            data: { defId: 'event.setup', literals: {}, config: {} },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'GONE',
            sourceHandle: 'exec-out:next',
            targetHandle: 'exec-in:in',
            data: { kind: 'exec', portType: 'exec' },
          },
        ],
      },
    };
    const project = migrate(doc);
    const ids = new Set(project.graph.nodes.map((n) => n.id));
    const dangling = project.graph.edges.filter(
      (e) => !ids.has(e.source) || !ids.has(e.target),
    );
    expect(dangling).toEqual([]);
  });

  it('survives a document whose meta block is the wrong shape', () => {
    for (const meta of [null, 'a string', 42, []]) {
      const project = migrate({ version: 1, meta, graph: { nodes: [], edges: [] } });
      // Anything that reads project.meta.name must not throw.
      expect(() => String(project.meta.name)).not.toThrow();
      expect(typeof project.meta.name).toBe('string');
    }
  });

  it('survives a document whose board and settings blocks are the wrong shape', () => {
    const project = migrate({
      version: 1,
      board: null,
      settings: 'nope',
      graph: { nodes: [], edges: [] },
    });
    expect(() => String(project.board.fqbn)).not.toThrow();
    expect(typeof project.board.fqbn).toBe('string');
  });

  it('survives a document whose dashboard block is the wrong shape', () => {
    const project = migrate({
      version: 1,
      dashboard: { pages: 'nope', widgets: null },
      graph: { nodes: [], edges: [] },
    });
    expect(Array.isArray(project.dashboard.pages)).toBe(true);
    expect(Array.isArray(project.dashboard.widgets)).toBe(true);
  });

  it('drops graph entries that are not usable nodes', () => {
    const doc = {
      version: 1,
      graph: {
        nodes: [
          null,
          'a string',
          42,
          { id: 'no-position', type: 'forge', data: { defId: 'event.setup' } },
          {
            id: 'good',
            type: 'forge',
            position: { x: 0, y: 0 },
            data: { defId: 'event.setup', literals: {}, config: {} },
          },
        ],
        edges: [null, 'x', { id: 'no-endpoints' }],
      },
    };
    const project = migrate(doc);
    for (const node of project.graph.nodes) {
      expect(node).not.toBeNull();
      expect(typeof node).toBe('object');
      expect(typeof node.id).toBe('string');
      expect(typeof node.position?.x).toBe('number');
    }
    for (const edge of project.graph.edges) {
      expect(typeof edge?.source).toBe('string');
      expect(typeof edge?.target).toBe('string');
    }
    // The one well-formed node must survive.
    expect(project.graph.nodes.map((n) => n.id)).toContain('good');
  });

  it('does not let a node without data reach validateGraph', () => {
    const doc = {
      version: 1,
      graph: { nodes: [{ id: 'x', type: 'forge', position: { x: 0, y: 0 } }], edges: [] },
    };
    const project = migrate(doc);
    expect(() =>
      validateGraph(project.graph.nodes as AnyNode[], project.graph.edges as ForgeEdge[]),
    ).not.toThrow();
  });
});
