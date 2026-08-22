/**
 * Graph layout for imported sketches (IMPORT.md §Phase 5).
 *
 * A correct graph dumped at the origin is unusable, so this runs before an
 * import is ever shown. elkjs with the `layered` algorithm, exec flow left to
 * right, data producers to the left of and above their consumer.
 *
 * **Determinism is a requirement, not a nicety** (§Non-negotiables 4). The same
 * sketch must lay out identically every time, or the idempotence check compares
 * two graphs that differ only by pixels and the canvas jumps on every re-import.
 * Nodes are therefore fed to elk in a sorted order and every coordinate is
 * rounded, because elk's floating-point output is not bit-stable across runs.
 */
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import { isForgeNode, type AnyNode, type ForgeEdge } from '@/graph/model';
import { getNodeDef, inputPorts, outputPorts, execOuts } from '@/nodes/registry';

/** Rough node box. Exact size is the renderer's business; elk needs an estimate. */
const NODE_WIDTH = 220;
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 22;
const MIN_HEIGHT = 64;

function sizeOf(node: AnyNode): { width: number; height: number } {
  if (!isForgeNode(node)) return { width: 160, height: 60 };

  const def = getNodeDef(node.data.defId);
  if (def === null) return { width: NODE_WIDTH, height: MIN_HEIGHT };

  const rows =
    inputPorts(def, node.data.config).length +
    outputPorts(def, node.data.config).length +
    execOuts(def, node.data.config).length;

  // A Raw node's height follows its text, which is often the tallest thing on
  // the canvas and the main source of overlap if ignored.
  const code = String(node.data.config['code'] ?? '');
  const codeLines = code === '' ? 0 : Math.min(code.split('\n').length, 20);

  return {
    width: NODE_WIDTH,
    height: Math.max(MIN_HEIGHT, HEADER_HEIGHT + rows * ROW_HEIGHT + codeLines * 14),
  };
}

const elk = new ELK();

/**
 * elk options.
 *
 * `RIGHT` puts exec flow left to right, which is the axis the graph is read
 * along. `NETWORK_SIMPLEX` is chosen over the faster heuristics because it is
 * deterministic for a given input; the layering heuristics are not.
 */
const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.edgeNode': '32',
  'elk.edgeRouting': 'ORTHOGONAL',
};

export interface LayoutOptions {
  /** Top-left of the laid-out graph. */
  readonly originX?: number;
  readonly originY?: number;
}

/**
 * Positions every node. Returns a new array; the input is not mutated.
 *
 * Falls back to the incoming positions if elk throws — a layout failure must
 * never lose an import, and an ugly graph beats no graph.
 */
export async function layoutGraph(
  nodes: readonly AnyNode[],
  edges: readonly ForgeEdge[],
  options: LayoutOptions = {},
): Promise<AnyNode[]> {
  if (nodes.length === 0) return [];

  // Sorted so elk sees the same input order every run, whatever order the
  // importer happened to create nodes in.
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  const children: ElkNode[] = ordered.map((node) => ({ id: node.id, ...sizeOf(node) }));

  const elkEdges: ElkExtendedEdge[] = [...edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))
    .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }));

  try {
    const result = await elk.layout({
      id: 'root',
      layoutOptions: OPTIONS,
      children,
      edges: elkEdges,
    });

    const placed = new Map<string, { x: number; y: number }>();
    for (const child of result.children ?? []) {
      placed.set(child.id, {
        // Rounded because elk's output is floating point and not bit-stable
        // between runs; unrounded coordinates make two identical imports
        // compare unequal.
        x: Math.round(child.x ?? 0) + (options.originX ?? 0),
        y: Math.round(child.y ?? 0) + (options.originY ?? 0),
      });
    }

    return nodes.map((node) => {
      const position = placed.get(node.id);
      return position === undefined ? node : { ...node, position };
    });
  } catch {
    // Layout is presentation. Losing it must not lose the import.
    return [...nodes];
  }
}
