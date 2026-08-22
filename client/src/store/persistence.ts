/**
 * .forge project format (BUILD_PLAN.md §Phase 7, brought forward).
 *
 * Phase 3's gate requires save/reload fidelity, so the versioned envelope and
 * its migration function exist from the first commit that persists anything —
 * §Phase 7 is explicit that versioning starts on day one. Storage is
 * localStorage for now; Phase 7 moves autosave to IndexedDB with recovery.
 */
import type { AnyNode, ForgeEdge } from '@/graph/model';
import { getNodeDef } from '@/nodes/registry';

export const FORGE_VERSION = 1;
const STORAGE_KEY = 'arduforge.project.autosave';

export interface ForgeProject {
  readonly version: number;
  readonly meta: { readonly name: string; readonly createdAt: string; readonly updatedAt: string };
  readonly board: { readonly fqbn: string };
  readonly graph: { readonly nodes: readonly AnyNode[]; readonly edges: readonly ForgeEdge[] };
  readonly dashboard: { readonly pages: readonly unknown[]; readonly widgets: readonly unknown[] };
  readonly settings: Readonly<Record<string, unknown>>;
}

export function emptyProject(name = 'Untitled'): ForgeProject {
  const now = new Date().toISOString();
  return {
    version: FORGE_VERSION,
    meta: { name, createdAt: now, updatedAt: now },
    board: { fqbn: 'arduino:avr:uno' },
    graph: { nodes: [], edges: [] },
    dashboard: { pages: [], widgets: [] },
    settings: {},
  };
}

/**
 * React Flow decorates nodes with transient view state. Persisting it would
 * restore a graph that is, say, permanently mid-drag, so it is stripped here.
 */
function stripTransient(nodes: readonly AnyNode[]): AnyNode[] {
  return nodes.map((node) => {
    const { selected: _selected, dragging: _dragging, ...rest } = node;
    return rest;
  });
}

export function buildProject(
  base: ForgeProject,
  nodes: readonly AnyNode[],
  edges: readonly ForgeEdge[],
  dashboard?: { pages: readonly unknown[]; widgets: readonly unknown[] },
): ForgeProject {
  return {
    ...base,
    version: FORGE_VERSION,
    meta: { ...base.meta, updatedAt: new Date().toISOString() },
    graph: { nodes: stripTransient(nodes), edges: [...edges] },
    dashboard: dashboard ?? base.dashboard,
  };
}

export class ProjectFormatError extends Error {
  override readonly name = 'ProjectFormatError';
}

/** What a load had to repair. Surfaced to the user; never silently swallowed. */
export interface MigrationReport {
  readonly project: ForgeProject;
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * A node has to survive React Flow's renderer, which reads `id`, `type` and
 * `position` before anything of ours runs. An entry missing any of those takes
 * the canvas down, so it cannot be allowed into the document — and `data` is
 * required too, because every consumer reads `data.defId`.
 */
function isUsableNode(value: unknown): value is AnyNode {
  if (!isRecord(value)) return false;
  if (typeof value['id'] !== 'string' || value['id'] === '') return false;
  const position = value['position'];
  if (!isRecord(position)) return false;
  if (typeof position['x'] !== 'number' || !Number.isFinite(position['x'])) return false;
  if (typeof position['y'] !== 'number' || !Number.isFinite(position['y'])) return false;
  if (!isRecord(value['data'])) return false;
  // A 'forge' node without a defId cannot be looked up or drawn.
  if (value['type'] === 'forge' && typeof (value['data'])['defId'] !== 'string') {
    return false;
  }
  return true;
}

function isUsableEdge(value: unknown): value is ForgeEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['source'] === 'string' &&
    typeof value['target'] === 'string'
  );
}

/**
 * Bring any supported past version up to FORGE_VERSION.
 *
 * A `.forge` file is untrusted: it comes off disk, off another machine, or out
 * of an autosave that was interrupted mid-write. Two failure modes are kept
 * strictly apart. A document with no readable graph is an *error* — filling in
 * an empty one would open a blank canvas that looks exactly like silent data
 * loss. A document whose graph is readable but whose surrounding blocks are
 * the wrong shape is *repaired*, because dropping the user's nodes over a
 * malformed `meta` block would be a far worse outcome than a warning.
 *
 * Every repair is reported. Nothing here is allowed to drop something quietly.
 */
export function migrateWithReport(raw: unknown): MigrationReport {
  if (!isRecord(raw)) {
    throw new ProjectFormatError('That file is not an ArduForge project.');
  }

  const candidate = raw;
  const version = typeof candidate['version'] === 'number' ? candidate['version'] : 0;

  if (version > FORGE_VERSION) {
    throw new ProjectFormatError(
      `This project was saved by a newer version of ArduForge (format v${version}, this build reads v${FORGE_VERSION}).`,
    );
  }

  // Locate the graph in the RAW document before defaults are merged in.
  const graphBlock = isRecord(candidate['graph']) ? candidate['graph'] : undefined;

  // v0 -> v1: the pre-versioned shape stored nodes/edges at the top level.
  const rawNodes = graphBlock?.['nodes'] ?? (version < 1 ? candidate['nodes'] : undefined);
  const rawEdges = graphBlock?.['edges'] ?? (version < 1 ? candidate['edges'] : undefined);

  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    throw new ProjectFormatError('That project file has no readable graph.');
  }

  const warnings: string[] = [];
  const defaults = emptyProject();

  const nodes = rawNodes.filter(isUsableNode);
  if (nodes.length !== rawNodes.length) {
    warnings.push(
      `${rawNodes.length - nodes.length} node(s) were malformed and could not be opened.`,
    );
  }

  // An edge pointing at a node that is not in the document renders as an edge
  // to nowhere and breaks every traversal that assumes both ends resolve.
  const ids = new Set(nodes.map((node) => node.id));
  const wellFormed = rawEdges.filter(isUsableEdge);
  const edges = wellFormed.filter((edge) => ids.has(edge.source) && ids.has(edge.target));

  const malformedEdges = rawEdges.length - wellFormed.length;
  if (malformedEdges > 0) {
    warnings.push(`${malformedEdges} connection(s) were malformed and were dropped.`);
  }
  const danglingEdges = wellFormed.length - edges.length;
  if (danglingEdges > 0) {
    warnings.push(
      `${danglingEdges} connection(s) pointed at nodes that are not in this file and were dropped.`,
    );
  }

  // Declare Variable gained a `scope` field. Every node saved before it existed
  // was a global, and ctx.config falls back to the *def's* default — now
  // `local` — so without this migration every saved project would silently move
  // its variables onto the stack and change its generated output. The node's
  // default and the migration default differ on purpose: new nodes should be
  // local, old ones must stay exactly what they were.
  // Deliberately not a warning: nothing was lost or repaired and the generated
  // output is unchanged, so telling the user would train them to ignore the
  // warning toast that does matter.
  const migrated = nodes.map((node) => {
    if (node.type !== 'forge') return node;
    const data = node.data as Record<string, unknown>;
    if (data['defId'] !== 'var.declare') return node;
    const config = isRecord(data['config']) ? data['config'] : {};
    if (config['scope'] !== undefined) return node;
    const next = { ...config, scope: 'global' };
    return { ...node, data: { ...node.data, config: next } };
  });

  // A defId that no longer exists in the registry is not a malformed node — it
  // is a node from a build that had it. The nodes are kept, because dropping
  // them would lose work the user cannot get back, and NodeView draws them as
  // an explicit unknown-type card. What matters is that the user is told at
  // import time: without this the toast says "Project loaded" and the first
  // sign of trouble is a canvas of red placeholders.
  const unknownTypes = new Set<string>();
  for (const node of migrated) {
    if (node.type !== 'forge') continue;
    const defId = (node.data as { defId?: unknown })['defId'];
    if (typeof defId === 'string' && getNodeDef(defId) === null) unknownTypes.add(defId);
  }
  if (unknownTypes.size > 0) {
    const names = [...unknownTypes].sort();
    const shown = names.slice(0, 3).join(', ');
    warnings.push(
      `${names.length} node type(s) in this file are not in this build (${shown}${names.length > 3 ? ', …' : ''}). ` +
        'Those nodes are shown as unknown and the sketch will not generate until they are replaced.',
    );
  }

  const rawMeta = candidate['meta'];
  if (candidate['meta'] !== undefined && !isRecord(rawMeta)) {
    warnings.push('The project details block was unreadable and has been reset.');
  }
  const meta = isRecord(rawMeta) ? rawMeta : {};

  const rawBoard = candidate['board'];
  if (candidate['board'] !== undefined && !isRecord(rawBoard)) {
    warnings.push('The board block was unreadable; falling back to the default board.');
  }
  const board = isRecord(rawBoard) ? rawBoard : {};

  const rawDashboard = candidate['dashboard'];
  if (candidate['dashboard'] !== undefined && !isRecord(rawDashboard)) {
    warnings.push('The dashboard block was unreadable and has been reset.');
  }
  const dashboard = isRecord(rawDashboard) ? rawDashboard : {};
  const pages = Array.isArray(dashboard['pages']) ? dashboard['pages'] : [];
  const widgets = Array.isArray(dashboard['widgets']) ? dashboard['widgets'] : [];
  if (isRecord(rawDashboard) && (!Array.isArray(dashboard['pages']) || !Array.isArray(dashboard['widgets']))) {
    warnings.push('Part of the dashboard was unreadable and has been reset.');
  }

  const project: ForgeProject = {
    version: FORGE_VERSION,
    meta: {
      name: asString(meta['name'], defaults.meta.name),
      createdAt: asString(meta['createdAt'], defaults.meta.createdAt),
      updatedAt: asString(meta['updatedAt'], defaults.meta.updatedAt),
    },
    board: { fqbn: asString(board['fqbn'], defaults.board.fqbn) },
    graph: { nodes: migrated, edges },
    dashboard: { pages, widgets },
    settings: isRecord(candidate['settings']) ? candidate['settings'] : {},
  };

  return { project, warnings };
}

/** Migration for callers that only need the document. */
export function migrate(raw: unknown): ForgeProject {
  return migrateWithReport(raw).project;
}

export function serialize(project: ForgeProject): string {
  return JSON.stringify(project, null, 2);
}

export function saveToStorage(project: ForgeProject): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Quota or private-mode failures must not take the editor down.
  }
}

export function loadFromStorage(): ForgeProject | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearStorage(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
