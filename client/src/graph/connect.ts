/**
 * Turns a React Flow Connection into a typed ForgeEdge, or an explained refusal.
 *
 * Every rejection returns prose the UI shows verbatim (§Phase 3: "rejected at
 * connect time with a toast explaining why").
 */
import type { Connection } from '@xyflow/react';
import { findInputPort, findOutputPort, getNodeDef } from '@/nodes/registry';
import { canConnectTypes, castNote } from '@/nodes/typeSystem';
import { isForgeNode, isRerouteNode, type AnyNode, type ForgeEdge } from '@/graph/model';
import { parseHandle, type PortType } from '@/nodes/types';

export type ConnectResolution =
  | { ok: true; edge: ForgeEdge; note: string | null }
  | { ok: false; reason: string };

type EndpointInfo = { kind: 'exec' } | { kind: 'data'; type: PortType };

function sourceEndpoint(node: AnyNode, handleId: string | null): EndpointInfo | null {
  const handle = parseHandle(handleId);

  if (isRerouteNode(node)) {
    if (handleId !== 'reroute-out') return null;
    return { kind: 'data', type: node.data.portType };
  }
  if (!isForgeNode(node) || handle === null) return null;

  if (handle.kind === 'exec-out') return { kind: 'exec' };
  if (handle.kind !== 'out') return null;

  const def = getNodeDef(node.data.defId);
  if (def === null) return null;
  const port = findOutputPort(def, handle.portId, node.data.config);
  return port === null ? null : { kind: 'data', type: port.type };
}

function targetEndpoint(node: AnyNode, handleId: string | null): EndpointInfo | null {
  const handle = parseHandle(handleId);

  if (isRerouteNode(node)) {
    if (handleId !== 'reroute-in') return null;
    return { kind: 'data', type: node.data.portType };
  }
  if (!isForgeNode(node) || handle === null) return null;

  if (handle.kind === 'exec-in') return { kind: 'exec' };
  if (handle.kind !== 'in') return null;

  const def = getNodeDef(node.data.defId);
  if (def === null) return null;
  const port = findInputPort(def, handle.portId, node.data.config);
  return port === null ? null : { kind: 'data', type: port.type };
}

export function resolveConnection(
  connection: Connection,
  nodes: readonly AnyNode[],
): ConnectResolution {
  if (connection.source === connection.target) {
    return { ok: false, reason: 'A node cannot be connected to itself.' };
  }

  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (source === undefined || target === undefined) {
    return { ok: false, reason: 'One end of that connection no longer exists.' };
  }

  const from = sourceEndpoint(source, connection.sourceHandle ?? null);
  const to = targetEndpoint(target, connection.targetHandle ?? null);
  if (from === null || to === null) {
    return { ok: false, reason: 'Connections run from an output on the right to an input on the left.' };
  }

  if (from.kind === 'exec' || to.kind === 'exec') {
    if (from.kind !== to.kind) {
      return {
        ok: false,
        reason:
          'Execution ports (white squares) and value ports (coloured circles) cannot be joined.',
      };
    }
    return {
      ok: true,
      note: null,
      edge: {
        id: `e_${connection.source}_${connection.sourceHandle ?? ''}_${connection.target}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        type: 'forge',
        data: { kind: 'exec', portType: 'exec' },
      },
    };
  }

  const verdict = canConnectTypes(from.type, to.type);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  return {
    ok: true,
    note: castNote(from.type, to.type),
    edge: {
      id: `e_${connection.source}_${connection.sourceHandle ?? ''}_${connection.target}_${connection.targetHandle ?? ''}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      type: 'forge',
      data: { kind: 'data', portType: from.type },
    },
  };
}
