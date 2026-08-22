/**
 * Graph document model. This is what gets persisted, so changes here need a
 * migration in store/persistence.ts.
 */
import type { Edge, Node } from '@xyflow/react';
import type { LiteralValue, PortType } from '@/nodes/types';

export interface ForgeNodeData extends Record<string, unknown> {
  readonly defId: string;
  /** Inline values for data inputs that have no incoming edge. */
  readonly literals: Record<string, LiteralValue>;
  /** Inspector config field values. */
  readonly config: Record<string, LiteralValue>;
  readonly collapsed?: boolean;
  /**
   * Comments that belong to this node, re-emitted verbatim above and beside its
   * statements. The importer fills these in so a sketch does not come back
   * stripped of every explanation the user wrote — a loss no fidelity gate can
   * see, since comments do not affect compiled output.
   */
  readonly comments?: NodeComments;
}

export interface NodeComments {
  readonly leading?: readonly string[];
  readonly trailing?: readonly string[];
}

export interface FrameNodeData extends Record<string, unknown> {
  readonly title: string;
  readonly color: string;
}

export interface RerouteNodeData extends Record<string, unknown> {
  readonly portType: PortType;
}

export type ForgeNode = Node<ForgeNodeData, 'forge'>;
export type FrameNode = Node<FrameNodeData, 'frame'>;
export type RerouteNode = Node<RerouteNodeData, 'reroute'>;
export type AnyNode = ForgeNode | FrameNode | RerouteNode;

export interface ForgeEdgeData extends Record<string, unknown> {
  readonly kind: 'exec' | 'data';
  readonly portType: PortType;
}

export type ForgeEdge = Edge<ForgeEdgeData>;

export interface GraphSnapshot {
  readonly nodes: readonly AnyNode[];
  readonly edges: readonly ForgeEdge[];
}

export function isForgeNode(node: AnyNode): node is ForgeNode {
  return node.type === 'forge';
}

export function isFrameNode(node: AnyNode): node is FrameNode {
  return node.type === 'frame';
}

export function isRerouteNode(node: AnyNode): node is RerouteNode {
  return node.type === 'reroute';
}

export const FRAME_COLORS = [
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#3E9EFF', label: 'Blue' },
  { value: '#30A46C', label: 'Green' },
  { value: '#F5A524', label: 'Amber' },
  { value: '#E5484D', label: 'Crimson' },
  { value: '#64748B', label: 'Slate' },
] as const;
