/**
 * Graph store: nodes, edges, and a 100-deep undo stack (BUILD_PLAN.md §Phase 3).
 *
 * Undo is snapshot-based rather than command-inversion based. Snapshots of a
 * few hundred nodes are small, and inverting every mutation is where undo bugs
 * come from. What matters is WHEN a snapshot is taken:
 *
 *  - discrete edits (add, delete, connect, edit a value) commit;
 *  - drags commit once at drag START, not per animation frame;
 *  - selection and viewport changes never commit.
 */
import { create } from 'zustand';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import {
  isForgeNode,
  type AnyNode,
  type ForgeEdge,
  type ForgeNode,
  type GraphSnapshot,
} from '@/graph/model';
import { validateGraph, type Problem } from '@/graph/validate';
import { getNodeDef, inputPorts } from '@/nodes/registry';
import type { LiteralValue, NodeDef } from '@/nodes/types';
import {
  buildProject,
  emptyProject,
  loadFromStorage,
  saveToStorage,
  type ForgeProject,
} from '@/store/persistence';
import { useDashboard } from '@/dashboard/store';
import type { DashboardDoc } from '@/dashboard/model';

/** The dashboard lives in its own store but is persisted inside the project. */
function dashboardDoc(): DashboardDoc {
  return useDashboard.getState().toDoc();
}

const UNDO_DEPTH = 100;
/** Edits sharing a key within this window fold into one undo step (e.g. typing). */
const COALESCE_MS = 600;

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function defaultLiterals(def: NodeDef): Record<string, LiteralValue> {
  const literals: Record<string, LiteralValue> = {};
  for (const port of inputPorts(def)) {
    if (port.literal !== undefined) literals[port.id] = port.literal.default;
  }
  return literals;
}

function defaultConfig(def: NodeDef): Record<string, LiteralValue> {
  const config: Record<string, LiteralValue> = {};
  for (const field of def.config ?? []) config[field.id] = field.default;
  return config;
}

interface GraphState {
  nodes: AnyNode[];
  edges: ForgeEdge[];
  project: ForgeProject;
  problems: readonly Problem[];
  past: GraphSnapshot[];
  future: GraphSnapshot[];
  lastCommit: { key: string; at: number } | null;

  onNodesChange(changes: NodeChange<AnyNode>[]): void;
  onEdgesChange(changes: EdgeChange<ForgeEdge>[]): void;
  beginDrag(): void;

  addNode(defId: string, position: XYPosition): string | null;
  addFrame(position: XYPosition): string;
  addReroute(edgeId: string, position: XYPosition): void;
  connect(edge: ForgeEdge): void;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): void;
  paste(position: XYPosition | null): void;

  setLiteral(nodeId: string, portId: string, value: LiteralValue): void;
  setConfig(nodeId: string, fieldId: string, value: LiteralValue): void;
  setCollapsed(nodeId: string, collapsed: boolean): void;
  setFrameTitle(nodeId: string, title: string): void;
  setFrameColor(nodeId: string, color: string): void;
  alignSelection(axis: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'): void;
  distributeSelection(axis: 'horizontal' | 'vertical'): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  loadProject(project: ForgeProject): void;
  newProject(): void;
  /** Replaces the whole graph, undoably. Used by sketch import (§Phase 6). */
  replaceGraph(nodes: AnyNode[], edges: ForgeEdge[], name?: string): void;
  /** Selects exactly one node, for the import report's click-through. */
  selectOnly(nodeId: string): void;
  save(): void;
  restoreAutosave(): boolean;
}

let clipboard: GraphSnapshot = { nodes: [], edges: [] };

export const useGraphStore = create<GraphState>((set, get) => {
  const commit = (key?: string): void => {
    const state = get();
    const now = Date.now();
    if (
      key !== undefined &&
      state.lastCommit !== null &&
      state.lastCommit.key === key &&
      now - state.lastCommit.at < COALESCE_MS
    ) {
      // Fold into the previous step; just refresh the timer.
      set({ lastCommit: { key, at: now } });
      return;
    }
    const past = [...state.past, { nodes: state.nodes, edges: state.edges }];
    set({
      past: past.length > UNDO_DEPTH ? past.slice(past.length - UNDO_DEPTH) : past,
      future: [],
      lastCommit: key === undefined ? null : { key, at: now },
    });
  };

  /** Recompute problems and autosave after any structural change. */
  const settle = (nodes: AnyNode[], edges: ForgeEdge[]): void => {
    set({ nodes, edges, problems: validateGraph(nodes, edges) });
    const state = get();
    saveToStorage(buildProject(state.project, nodes, edges, dashboardDoc()));
  };

  return {
    nodes: [],
    edges: [],
    project: emptyProject(),
    problems: [],
    past: [],
    future: [],
    lastCommit: null,

    onNodesChange(changes) {
      // Removals are destructive and must be undoable; drags commit separately
      // in beginDrag(); selection and dimension changes never commit.
      if (changes.some((change) => change.type === 'remove')) commit();
      const nodes = applyNodeChanges(changes, get().nodes);
      const structural = changes.some((change) => change.type === 'remove');
      if (structural) {
        const removed = new Set(
          changes.filter((change) => change.type === 'remove').map((change) => change.id),
        );
        const edges = get().edges.filter(
          (edge) => !removed.has(edge.source) && !removed.has(edge.target),
        );
        settle(nodes, edges);
      } else {
        set({ nodes });
      }
    },

    onEdgesChange(changes) {
      if (changes.some((change) => change.type === 'remove')) commit();
      const edges = applyEdgeChanges(changes, get().edges);
      settle(get().nodes, edges);
    },

    beginDrag() {
      commit();
    },

    addNode(defId, position) {
      const def = getNodeDef(defId);
      if (def === null) return null;

      if (def.singleton === true) {
        const existing = get().nodes.some(
          (node) => isForgeNode(node) && node.data.defId === defId,
        );
        if (existing) return null;
      }

      commit();
      const node: ForgeNode = {
        id: makeId('n'),
        type: 'forge',
        position,
        data: { defId, literals: defaultLiterals(def), config: defaultConfig(def) },
      };
      settle([...get().nodes, node], get().edges);
      return node.id;
    },

    addFrame(position) {
      commit();
      const node: AnyNode = {
        id: makeId('f'),
        type: 'frame',
        position,
        // Frames sit behind nodes and must not swallow clicks meant for them.
        zIndex: -1,
        width: 360,
        height: 240,
        data: { title: 'Group', color: '#8B5CF6' },
      };
      settle([...get().nodes, node], get().edges);
      return node.id;
    },

    addReroute(edgeId, position) {
      const state = get();
      const edge = state.edges.find((candidate) => candidate.id === edgeId);
      if (edge === undefined || edge.data === undefined) return;

      commit();
      const reroute: AnyNode = {
        id: makeId('r'),
        type: 'reroute',
        position,
        data: { portType: edge.data.portType },
      };
      const first: ForgeEdge = {
        ...edge,
        id: makeId('e'),
        target: reroute.id,
        targetHandle: 'reroute-in',
      };
      const second: ForgeEdge = {
        ...edge,
        id: makeId('e'),
        source: reroute.id,
        sourceHandle: 'reroute-out',
      };
      settle(
        [...state.nodes, reroute],
        [...state.edges.filter((candidate) => candidate.id !== edgeId), first, second],
      );
    },

    connect(edge) {
      commit();
      const state = get();
      // A data input takes exactly one value; a new edge replaces the old one.
      const filtered =
        edge.data?.kind === 'data'
          ? state.edges.filter(
              (existing) =>
                !(existing.target === edge.target && existing.targetHandle === edge.targetHandle),
            )
          : state.edges.filter(
              // An exec output runs exactly one next statement.
              (existing) =>
                !(existing.source === edge.source && existing.sourceHandle === edge.sourceHandle),
            );
      settle(state.nodes, [...filtered, edge]);
    },

    deleteSelection() {
      const state = get();
      const selected = new Set(state.nodes.filter((node) => node.selected === true).map((n) => n.id));
      const selectedEdges = new Set(
        state.edges.filter((edge) => edge.selected === true).map((edge) => edge.id),
      );
      if (selected.size === 0 && selectedEdges.size === 0) return;

      commit();
      settle(
        state.nodes.filter((node) => !selected.has(node.id)),
        state.edges.filter(
          (edge) =>
            !selectedEdges.has(edge.id) && !selected.has(edge.source) && !selected.has(edge.target),
        ),
      );
    },

    copySelection() {
      const state = get();
      const nodes = state.nodes.filter((node) => node.selected === true);
      const ids = new Set(nodes.map((node) => node.id));
      clipboard = {
        nodes,
        edges: state.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      };
    },

    paste(position) {
      if (clipboard.nodes.length === 0) return;
      commit();

      const state = get();
      const remap = new Map<string, string>();
      const originX = Math.min(...clipboard.nodes.map((node) => node.position.x));
      const originY = Math.min(...clipboard.nodes.map((node) => node.position.y));
      const offset = position ?? { x: originX + 40, y: originY + 40 };

      const nodes = clipboard.nodes.flatMap((node) => {
        if (isForgeNode(node)) {
          const def = getNodeDef(node.data.defId);
          // Pasting a second On Loop would silently create an invalid graph.
          if (def?.singleton === true) return [];
        }
        const id = makeId('n');
        remap.set(node.id, id);
        return [
          {
            ...node,
            id,
            selected: true,
            position: {
              x: offset.x + (node.position.x - originX),
              y: offset.y + (node.position.y - originY),
            },
          },
        ];
      });

      const edges = clipboard.edges.flatMap((edge) => {
        const source = remap.get(edge.source);
        const target = remap.get(edge.target);
        if (source === undefined || target === undefined) return [];
        return [{ ...edge, id: makeId('e'), source, target, selected: false }];
      });

      settle(
        [...state.nodes.map((node) => ({ ...node, selected: false })), ...nodes],
        [...state.edges, ...edges],
      );
    },

    duplicateSelection() {
      get().copySelection();
      get().paste(null);
    },

    setLiteral(nodeId, portId, value) {
      commit(`literal:${nodeId}:${portId}`);
      const nodes = get().nodes.map((node) =>
        node.id === nodeId && isForgeNode(node)
          ? { ...node, data: { ...node.data, literals: { ...node.data.literals, [portId]: value } } }
          : node,
      );
      settle(nodes, get().edges);
    },

    setConfig(nodeId, fieldId, value) {
      commit(`config:${nodeId}:${fieldId}`);
      const nodes = get().nodes.map((node) =>
        node.id === nodeId && isForgeNode(node)
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [fieldId]: value } } }
          : node,
      );
      settle(nodes, get().edges);
    },

    setCollapsed(nodeId, collapsed) {
      commit();
      const nodes = get().nodes.map((node) =>
        node.id === nodeId && isForgeNode(node)
          ? { ...node, data: { ...node.data, collapsed } }
          : node,
      );
      settle(nodes, get().edges);
    },

    setFrameTitle(nodeId, title) {
      commit(`frame-title:${nodeId}`);
      const nodes = get().nodes.map((node) =>
        node.id === nodeId && node.type === 'frame'
          ? { ...node, data: { ...node.data, title } }
          : node,
      );
      settle(nodes, get().edges);
    },

    setFrameColor(nodeId, color) {
      commit();
      const nodes = get().nodes.map((node) =>
        node.id === nodeId && node.type === 'frame'
          ? { ...node, data: { ...node.data, color } }
          : node,
      );
      settle(nodes, get().edges);
    },

    alignSelection(axis) {
      const state = get();
      const selected = state.nodes.filter((node) => node.selected === true);
      if (selected.length < 2) return;
      commit();

      const width = (node: AnyNode) => node.measured?.width ?? node.width ?? 200;
      const height = (node: AnyNode) => node.measured?.height ?? node.height ?? 80;

      const lefts = selected.map((node) => node.position.x);
      const tops = selected.map((node) => node.position.y);
      const rights = selected.map((node) => node.position.x + width(node));
      const bottoms = selected.map((node) => node.position.y + height(node));

      const target = {
        left: Math.min(...lefts),
        right: Math.max(...rights),
        top: Math.min(...tops),
        bottom: Math.max(...bottoms),
        centerX: (Math.min(...lefts) + Math.max(...rights)) / 2,
        centerY: (Math.min(...tops) + Math.max(...bottoms)) / 2,
      };

      const nodes = state.nodes.map((node) => {
        if (node.selected !== true) return node;
        switch (axis) {
          case 'left':
            return { ...node, position: { ...node.position, x: target.left } };
          case 'right':
            return { ...node, position: { ...node.position, x: target.right - width(node) } };
          case 'top':
            return { ...node, position: { ...node.position, y: target.top } };
          case 'bottom':
            return { ...node, position: { ...node.position, y: target.bottom - height(node) } };
          case 'centerX':
            return { ...node, position: { ...node.position, x: target.centerX - width(node) / 2 } };
          case 'centerY':
            return { ...node, position: { ...node.position, y: target.centerY - height(node) / 2 } };
        }
      });
      settle(nodes, state.edges);
    },

    distributeSelection(axis) {
      const state = get();
      const selected = state.nodes.filter((node) => node.selected === true);
      if (selected.length < 3) return;
      commit();

      const key = axis === 'horizontal' ? 'x' : 'y';
      const sorted = [...selected].sort((a, b) => a.position[key] - b.position[key]);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first === undefined || last === undefined) return;

      const span = last.position[key] - first.position[key];
      const step = span / (sorted.length - 1);
      const positions = new Map<string, number>();
      sorted.forEach((node, index) => {
        positions.set(node.id, first.position[key] + step * index);
      });

      const nodes = state.nodes.map((node) => {
        const value = positions.get(node.id);
        if (value === undefined) return node;
        return { ...node, position: { ...node.position, [key]: value } };
      });
      settle(nodes, state.edges);
    },

    undo() {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return;
      set({
        past: state.past.slice(0, -1),
        future: [{ nodes: state.nodes, edges: state.edges }, ...state.future].slice(0, UNDO_DEPTH),
        lastCommit: null,
      });
      settle([...previous.nodes], [...previous.edges]);
    },

    redo() {
      const state = get();
      const next = state.future[0];
      if (next === undefined) return;
      set({
        past: [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-UNDO_DEPTH),
        future: state.future.slice(1),
        lastCommit: null,
      });
      settle([...next.nodes], [...next.edges]);
    },

    canUndo() {
      return get().past.length > 0;
    },

    canRedo() {
      return get().future.length > 0;
    },

    replaceGraph(nodes, edges, name) {
      // Committed to history first, so an import that turns out to be wrong is
      // one undo away rather than a lost afternoon.
      commit();
      set((state) => ({
        nodes,
        edges,
        project:
          name === undefined
            ? state.project
            : { ...state.project, meta: { ...state.project.meta, name } },
        problems: validateGraph(nodes, edges),
      }));
    },

    selectOnly(nodeId) {
      set((state) => ({
        nodes: state.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
        edges: state.edges.map((edge) => ({ ...edge, selected: false })),
      }));
    },

    loadProject(project) {
      set({ project, past: [], future: [], lastCommit: null });
      // Restore the dashboard before settling, so the autosave that settle()
      // writes carries the loaded dashboard rather than overwriting it.
      const dashboard = project.dashboard as DashboardDoc | undefined;
      useDashboard.getState().load({
        pages: dashboard?.pages ?? [],
        widgets: dashboard?.widgets ?? [],
      });
      settle([...project.graph.nodes], [...project.graph.edges]);
    },

    newProject() {
      const project = emptyProject();
      set({ project, past: [], future: [], lastCommit: null });
      settle([], []);
    },

    save() {
      const state = get();
      saveToStorage(buildProject(state.project, state.nodes, state.edges, dashboardDoc()));
    },

    restoreAutosave() {
      const project = loadFromStorage();
      if (project === null) return false;
      get().loadProject(project);
      return true;
    },
  };
});

export function currentProject(): ForgeProject {
  const state = useGraphStore.getState();
  return buildProject(state.project, state.nodes, state.edges, dashboardDoc());
}
