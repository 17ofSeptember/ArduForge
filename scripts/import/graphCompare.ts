/**
 * Structural graph comparison for Tier A (IMPORT.md §0.2).
 *
 * Tier A is the only tier where the ground truth graph is known, so it gets the
 * tightest check available: not "does it mean the same thing" but "is it the
 * same graph". Node ids and positions are excluded — ids are hashes of source
 * positions and layout is Phase 5's job, so neither is a fidelity property.
 *
 * This is a canonical-serialization comparison, not full graph isomorphism.
 * These graphs are rooted at entry nodes and walked through exec chains in a
 * fixed order, which makes the serialization deterministic and the comparison
 * exact for every shape the examples produce. A pair of graphs that differ only
 * by a permutation of unreachable orphan nodes would compare equal; orphans are
 * sorted and counted, so nothing is silently dropped.
 */
import { isForgeNode, isFrameNode, type AnyNode, type ForgeEdge } from '@/graph/model';
import { parseHandle } from '@/nodes/types';

/**
 * Separator for composite `${nodeId}<sep>${portId}` map keys. An ASCII unit
 * separator, written as an escape so this file stays plain text: a raw control
 * byte makes git treat the source as binary. It cannot appear in a node id or
 * a port id, so a prefix scan can never match across a key boundary.
 */
const KEY_SEP = '\u001F';

interface Indexed {
  readonly byId: Map<string, AnyNode>;
  /** `${nodeId}${KEY_SEP}${handle}` -> target node id. */
  readonly execOut: Map<string, string>;
  /** `${nodeId}${KEY_SEP}${portId}` -> source node id + port. */
  readonly dataIn: Map<string, { source: string; port: string }>;
  readonly hasExecIn: Set<string>;
}

function index(nodes: readonly AnyNode[], edges: readonly ForgeEdge[]): Indexed {
  const byId = new Map<string, AnyNode>(nodes.map((node) => [node.id, node]));
  const execOut = new Map<string, string>();
  const dataIn = new Map<string, { source: string; port: string }>();
  const hasExecIn = new Set<string>();

  // Sorted so a graph built in a different edge order still serializes the same.
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const target = parseHandle(edge.targetHandle);
    const source = parseHandle(edge.sourceHandle);
    if (edge.data?.kind === 'exec') {
      const handle = source?.kind === 'exec-out' ? source.name : 'then';
      execOut.set(`${edge.source}${KEY_SEP}${handle}`, edge.target);
      hasExecIn.add(edge.target);
    } else if (edge.data?.kind === 'data' && target?.kind === 'in') {
      dataIn.set(`${edge.target}${KEY_SEP}${target.portId}`, {
        source: edge.source,
        port: source?.kind === 'out' ? source.portId : 'out',
      });
    }
  }

  return { byId, execOut, dataIn, hasExecIn };
}

function record(values: Record<string, unknown> | undefined): string {
  if (values === undefined) return '';
  return Object.keys(values)
    .sort()
    .map((key) => `${key}=${JSON.stringify(values[key])}`)
    .join(',');
}

/** Recursively serializes the data subgraph feeding one node's inputs. */
function dataFor(nodeId: string, graph: Indexed, seen: Set<string>): string {
  const parts: string[] = [];
  const prefix = `${nodeId}${KEY_SEP}`;
  const keys = [...graph.dataIn.keys()].filter((key) => key.startsWith(prefix)).sort();
  for (const key of keys) {
    const link = graph.dataIn.get(key);
    if (link === undefined) continue;
    const port = key.slice(prefix.length);
    parts.push(`${port}<-${nodeText(link.source, graph, seen)}:${link.port}`);
  }
  return parts.join(' ');
}

/** One node and its data dependencies, without following its exec chain. */
function nodeText(nodeId: string, graph: Indexed, seen: Set<string>): string {
  const node = graph.byId.get(nodeId);
  if (node === undefined) return '<missing>';
  if (seen.has(nodeId)) return '<cycle>';

  const nested = new Set(seen);
  nested.add(nodeId);

  if (!isForgeNode(node)) return `${node.type}(${dataFor(nodeId, graph, nested)})`;

  const data = node.data;
  const inputs = dataFor(nodeId, graph, nested);
  return `${data.defId}{${record(data.config)}}[${record(data.literals)}]${inputs === '' ? '' : `(${inputs})`}`;
}

/** A node, its data, then each exec branch in sorted handle order. */
function chainText(nodeId: string, graph: Indexed, depth: number, seen: Set<string>): string[] {
  if (seen.has(nodeId)) return [`${'  '.repeat(depth)}<cycle ${nodeId}>`];
  const visited = new Set(seen);
  visited.add(nodeId);

  const lines = [`${'  '.repeat(depth)}${nodeText(nodeId, graph, new Set())}`];

  const prefix = `${nodeId}${KEY_SEP}`;
  const branches = [...graph.execOut.keys()].filter((key) => key.startsWith(prefix)).sort();
  for (const key of branches) {
    const target = graph.execOut.get(key);
    if (target === undefined) continue;
    lines.push(`${'  '.repeat(depth + 1)}-${key.slice(prefix.length)}->`);
    lines.push(...chainText(target, graph, depth + 2, visited));
  }
  return lines;
}

export function canonicalGraph(nodes: readonly AnyNode[], edges: readonly ForgeEdge[]): string {
  // Frames are pure decoration; including them would fail Tier A on a label.
  const real = nodes.filter((node) => !isFrameNode(node));
  const graph = index(real, edges);

  const roots = real
    .filter((node) => !graph.hasExecIn.has(node.id))
    .filter((node) => isForgeNode(node) && node.data.defId.startsWith('event.'))
    .map((node) => node.id);

  const lines: string[] = [];
  const covered = new Set<string>();

  const rootTexts = roots
    .map((id) => {
      const body = chainText(id, graph, 0, new Set());
      markCovered(id, graph, covered);
      return body.join('\n');
    })
    .sort();
  lines.push(...rootTexts);

  // Anything not reachable from an entry: still compared, just order-insensitive.
  const orphans = real
    .filter((node) => !covered.has(node.id))
    .map((node) => nodeText(node.id, graph, new Set()))
    .sort();
  if (orphans.length > 0) lines.push('--- unreachable ---', ...orphans);

  return lines.join('\n');
}

function markCovered(nodeId: string, graph: Indexed, covered: Set<string>): void {
  if (covered.has(nodeId)) return;
  covered.add(nodeId);
  const prefix = `${nodeId}${KEY_SEP}`;
  for (const [key, target] of graph.execOut) {
    if (key.startsWith(prefix)) markCovered(target, graph, covered);
  }
  for (const [key, link] of graph.dataIn) {
    if (key.startsWith(prefix)) markCovered(link.source, graph, covered);
  }
}

export interface GraphComparison {
  readonly equal: boolean;
  readonly detail: string | null;
}

export function compareGraphs(
  expected: { nodes: readonly AnyNode[]; edges: readonly ForgeEdge[] },
  actual: { nodes: readonly AnyNode[]; edges: readonly ForgeEdge[] },
): GraphComparison {
  const a = canonicalGraph(expected.nodes, expected.edges);
  const b = canonicalGraph(actual.nodes, actual.edges);
  if (a === b) return { equal: true, detail: null };

  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === right[i]) continue;
    return {
      equal: false,
      detail: `line ${i + 1}\n  expected: ${left[i] ?? '(absent)'}\n  actual:   ${right[i] ?? '(absent)'}`,
    };
  }
  return { equal: false, detail: 'graphs differ in length only' };
}
