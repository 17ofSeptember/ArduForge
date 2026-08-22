/**
 * Exercises the Phase 3 gate as a test: build the Blink graph, undo/redo it,
 * and round-trip it through the .forge envelope.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore, currentProject } from '@/store/graphStore';
import { resolveConnection } from '@/graph/connect';
import { migrate } from '@/store/persistence';
import { isForgeNode } from '@/graph/model';

const store = () => useGraphStore.getState();

function connect(source: string, sourceHandle: string, target: string, targetHandle: string): void {
  const result = resolveConnection(
    { source, sourceHandle, target, targetHandle },
    store().nodes,
  );
  if (!result.ok) throw new Error(`connect failed: ${result.reason}`);
  store().connect(result.edge);
}

/** On Loop -> Digital Write(13, HIGH) -> Delay(500) -> Digital Write(13, LOW) -> Delay(500) */
function buildBlink(): void {
  const loop = store().addNode('event.loop', { x: 0, y: 0 });
  const high = store().addNode('io.digitalWrite', { x: 240, y: 0 });
  const wait1 = store().addNode('control.delay', { x: 480, y: 0 });
  const low = store().addNode('io.digitalWrite', { x: 720, y: 0 });
  const wait2 = store().addNode('control.delay', { x: 960, y: 0 });
  if (loop === null || high === null || wait1 === null || low === null || wait2 === null) {
    throw new Error('node creation failed');
  }

  connect(loop, 'exec-out:then', high, 'exec-in');
  connect(high, 'exec-out:then', wait1, 'exec-in');
  connect(wait1, 'exec-out:then', low, 'exec-in');
  connect(low, 'exec-out:then', wait2, 'exec-in');
  store().setLiteral(low, 'value', false);
}

beforeEach(() => {
  window.localStorage.clear();
  useGraphStore.setState({ nodes: [], edges: [], past: [], future: [], lastCommit: null });
  store().newProject();
});

describe('building the Blink graph', () => {
  it('produces five nodes and four exec edges', () => {
    buildBlink();
    expect(store().nodes).toHaveLength(5);
    expect(store().edges).toHaveLength(4);
    expect(store().edges.every((edge) => edge.data?.kind === 'exec')).toBe(true);
  });

  it('reports no errors once every input is satisfied', () => {
    buildBlink();
    expect(store().problems.filter((problem) => problem.severity === 'error')).toHaveLength(0);
  });

  it('refuses a second On Loop', () => {
    buildBlink();
    expect(store().addNode('event.loop', { x: 0, y: 400 })).toBeNull();
    expect(store().nodes).toHaveLength(5);
  });

  it('warns about a statement node left out of the exec chain', () => {
    store().addNode('io.digitalWrite', { x: 0, y: 0 });
    const warnings = store().problems.filter((problem) => problem.severity === 'warning');
    expect(warnings.some((problem) => /never run/i.test(problem.message))).toBe(true);
  });
});

describe('undo and redo', () => {
  it('steps back through the whole build and forward again', () => {
    buildBlink();
    const built = { nodes: store().nodes.length, edges: store().edges.length };

    for (let i = 0; i < 20; i += 1) store().undo();
    expect(store().nodes).toHaveLength(0);
    expect(store().edges).toHaveLength(0);

    for (let i = 0; i < 20; i += 1) store().redo();
    expect(store().nodes).toHaveLength(built.nodes);
    expect(store().edges).toHaveLength(built.edges);
  });

  it('undoes a literal edit back to its previous value', () => {
    const id = store().addNode('control.delay', { x: 0, y: 0 });
    expect(id).not.toBeNull();
    if (id === null) return;

    store().setLiteral(id, 'ms', 1000);
    const changed = store().nodes.find((node) => node.id === id);
    expect(isForgeNode(changed!) && changed.data.literals['ms']).toBe(1000);

    store().undo();
    const reverted = store().nodes.find((node) => node.id === id);
    expect(isForgeNode(reverted!) && reverted.data.literals['ms']).toBe(500);
  });

  it('discards the redo stack once a new edit lands', () => {
    store().addNode('control.delay', { x: 0, y: 0 });
    store().undo();
    expect(store().canRedo()).toBe(true);

    store().addNode('event.loop', { x: 0, y: 0 });
    expect(store().canRedo()).toBe(false);
  });

  it('does nothing when there is nothing to undo', () => {
    expect(store().canUndo()).toBe(false);
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('caps the history at 100 entries', () => {
    for (let i = 0; i < 130; i += 1) store().addNode('control.delay', { x: i, y: 0 });
    expect(store().past.length).toBeLessThanOrEqual(100);
  });
});

describe('save and reload', () => {
  it('restores the graph exactly from autosave', () => {
    buildBlink();
    const before = currentProject();

    // Simulate a page reload: wipe in-memory state, then restore.
    useGraphStore.setState({ nodes: [], edges: [], past: [], future: [] });
    expect(store().restoreAutosave()).toBe(true);

    const after = currentProject();
    expect(after.graph.nodes).toHaveLength(before.graph.nodes.length);
    expect(after.graph.edges).toHaveLength(before.graph.edges.length);
    expect(after.graph.nodes.map((node) => node.id).sort()).toEqual(
      before.graph.nodes.map((node) => node.id).sort(),
    );
    expect(after.graph.edges.map((edge) => edge.id).sort()).toEqual(
      before.graph.edges.map((edge) => edge.id).sort(),
    );
  });

  it('preserves literal values across a reload', () => {
    buildBlink();
    useGraphStore.setState({ nodes: [], edges: [] });
    store().restoreAutosave();

    const lows = store()
      .nodes.filter(isForgeNode)
      .filter((node) => node.data.defId === 'io.digitalWrite')
      .map((node) => node.data.literals['value']);
    expect(lows).toContain(false);
    expect(lows).toContain(true);
  });

  it('clears the undo stack on load so undo cannot escape past the restore', () => {
    buildBlink();
    store().restoreAutosave();
    expect(store().canUndo()).toBe(false);
  });
});

describe('.forge format migration', () => {
  it('accepts the current version unchanged', () => {
    buildBlink();
    const project = currentProject();
    expect(migrate(JSON.parse(JSON.stringify(project))).graph.nodes).toHaveLength(5);
  });

  it('lifts a pre-versioned document with a top-level graph', () => {
    const legacy = { nodes: [], edges: [] };
    const migrated = migrate(legacy);
    expect(migrated.version).toBe(1);
    expect(migrated.graph.nodes).toEqual([]);
  });

  it('refuses a document written by a newer format', () => {
    expect(() => migrate({ version: 99, graph: { nodes: [], edges: [] } })).toThrow(/newer version/i);
  });

  it('refuses something that is not a project', () => {
    expect(() => migrate('nonsense')).toThrow();
    expect(() => migrate({ version: 1 })).toThrow(/no readable graph/i);
  });
});

describe('copy and paste', () => {
  it('pastes a copy with fresh ids, skipping singletons', () => {
    buildBlink();
    useGraphStore.setState({
      nodes: store().nodes.map((node) => ({ ...node, selected: true })),
    });

    const before = store().nodes.length;
    store().copySelection();
    store().paste({ x: 0, y: 400 });

    // Four of the five copy; On Loop is a singleton and is skipped.
    expect(store().nodes).toHaveLength(before + 4);
    expect(new Set(store().nodes.map((node) => node.id)).size).toBe(store().nodes.length);
  });
});
