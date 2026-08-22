/**
 * Export -> reload -> import, end to end (THEME.md Phase 1 item 4).
 *
 * The reload is what makes this worth testing at this level rather than by
 * clicking: everything in memory is gone, and the only thing carrying the
 * project across is the bytes in the file. These tests go through exactly the
 * path the Open button drives — serialize, JSON.parse, migrateWithReport — so a
 * regression in any of them fails here rather than in a user's hands.
 *
 * The dashboard is checked alongside the graph because it travels in a separate
 * block of the document and is the half more likely to be dropped quietly: a
 * graph that comes back without its widgets still looks like a successful
 * import.
 */
import { describe, it, expect } from 'vitest';
import { buildProject, emptyProject, migrateWithReport, serialize } from '@/store/persistence';
import { validateGraph } from '@/graph/validate';
import type { AnyNode, ForgeEdge } from '@/graph/model';

/** The file crossing the disk boundary: text out, text in. */
function reopen(text: string): ReturnType<typeof migrateWithReport> {
  return migrateWithReport(JSON.parse(text) as unknown);
}

const nodes: AnyNode[] = [
  {
    id: 'n1',
    type: 'forge',
    position: { x: 10, y: 20 },
    data: { defId: 'event.setup', literals: {}, config: {} },
  },
  {
    id: 'n2',
    type: 'forge',
    position: { x: 260, y: 20 },
    data: { defId: 'io.pinMode', literals: { pin: 13 }, config: { mode: 'OUTPUT' } },
  },
];

const edges: ForgeEdge[] = [
  {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    sourceHandle: 'exec-out:then',
    targetHandle: 'exec-in',
    type: 'forge',
    data: { kind: 'exec', portType: 'exec' },
  },
];

const dashboard = {
  pages: [{ id: 'page_1', name: 'Main' }],
  widgets: [
    {
      id: 'w1',
      type: 'gauge',
      pageId: 'page_1',
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      binding: { kind: 'var', name: 'speed', direction: 'both' },
      config: { min: 0, max: 255 },
    },
  ],
};

describe('export → reload → import', () => {
  it('restores the graph exactly', () => {
    const exported = serialize(buildProject(emptyProject('Round Trip'), nodes, edges, dashboard));
    const { project, warnings } = reopen(exported);

    expect(warnings).toEqual([]);
    expect(project.graph.nodes).toHaveLength(2);
    expect(project.graph.edges).toHaveLength(1);

    const pinMode = project.graph.nodes.find((node) => node.id === 'n2');
    expect(pinMode?.data['defId']).toBe('io.pinMode');
    // Literals and config are what make a node mean anything; a graph that
    // restores shape but not values is not a restored graph.
    expect((pinMode?.data['literals'] as Record<string, unknown>)['pin']).toBe(13);
    expect((pinMode?.data['config'] as Record<string, unknown>)['mode']).toBe('OUTPUT');
    expect(pinMode?.position).toEqual({ x: 260, y: 20 });

    const edge = project.graph.edges[0];
    expect(edge?.source).toBe('n1');
    expect(edge?.target).toBe('n2');
    expect(edge?.sourceHandle).toBe('exec-out:then');
  });

  it('restores the dashboard, not just the graph', () => {
    const exported = serialize(buildProject(emptyProject('Round Trip'), nodes, edges, dashboard));
    const { project } = reopen(exported);

    expect(project.dashboard.pages).toHaveLength(1);
    expect(project.dashboard.widgets).toHaveLength(1);

    const widget = project.dashboard.widgets[0] as Record<string, unknown>;
    expect(widget['type']).toBe('gauge');
    expect(widget['binding']).toEqual({ kind: 'var', name: 'speed', direction: 'both' });
    expect(widget['config']).toEqual({ min: 0, max: 255 });
  });

  it('restores the project name and board', () => {
    const base = { ...emptyProject('My Sketch'), board: { fqbn: 'arduino:avr:nano' } };
    const { project } = reopen(serialize(buildProject(base, nodes, edges, dashboard)));

    expect(project.meta.name).toBe('My Sketch');
    expect(project.board.fqbn).toBe('arduino:avr:nano');
  });

  it('produces a graph that still validates after the trip', () => {
    const { project } = reopen(serialize(buildProject(emptyProject('X'), nodes, edges, dashboard)));
    const errors = validateGraph(project.graph.nodes, project.graph.edges).filter(
      (problem) => problem.severity === 'error',
    );
    expect(errors).toEqual([]);
  });

  it('is stable across two trips', () => {
    const once = serialize(buildProject(emptyProject('X'), nodes, edges, dashboard));
    const first = reopen(once).project;
    const twice = serialize(buildProject(first, [...first.graph.nodes], [...first.graph.edges], first.dashboard));
    const second = reopen(twice).project;

    expect(second.graph).toEqual(first.graph);
    expect(second.dashboard).toEqual(first.dashboard);
  });
});

describe('a .forge naming node types this build does not have', () => {
  const fromTheFuture = {
    version: 1,
    meta: { name: 'Future', createdAt: '', updatedAt: '' },
    board: { fqbn: 'arduino:avr:uno' },
    graph: {
      nodes: [
        { id: 'n1', type: 'forge', position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
        { id: 'n2', type: 'forge', position: { x: 1, y: 1 }, data: { defId: 'quantum.entangle', literals: {}, config: {} } },
      ],
      edges: [],
    },
    dashboard: { pages: [], widgets: [] },
    settings: {},
  };

  it('warns at import time rather than opening silently', () => {
    const { warnings } = reopen(JSON.stringify(fromTheFuture));
    expect(warnings.some((warning) => /not in this build/i.test(warning))).toBe(true);
    expect(warnings.some((warning) => warning.includes('quantum.entangle'))).toBe(true);
  });

  it('keeps the unknown nodes instead of dropping the user’s work', () => {
    const { project } = reopen(JSON.stringify(fromTheFuture));
    expect(project.graph.nodes).toHaveLength(2);
    expect(project.graph.nodes.some((node) => node.data['defId'] === 'quantum.entangle')).toBe(true);
  });

  it('still reports the unknown type as a validation error', () => {
    const { project } = reopen(JSON.stringify(fromTheFuture));
    const problems = validateGraph(project.graph.nodes, project.graph.edges);
    expect(problems.some((problem) => /unknown node type/i.test(problem.message))).toBe(true);
  });

  it('says nothing when every type is known', () => {
    const { warnings } = reopen(serialize(buildProject(emptyProject('X'), nodes, edges, dashboard)));
    expect(warnings).toEqual([]);
  });
});
