import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PORT_COLOR } from '@/nodes/types';
import type { RerouteNode } from '@/graph/model';

/** A bare pass-through dot, used to route an edge around other nodes. */
function RerouteNodeViewInner({ data, selected }: NodeProps<RerouteNode>) {
  const color = PORT_COLOR[data.portType];
  return (
    <div
      className="size-3 rounded-full border-2"
      style={{
        backgroundColor: color,
        borderColor: selected === true ? 'var(--border-selected)' : 'var(--bg-app)',
      }}
    >
      <Handle
        id="reroute-in"
        type="target"
        position={Position.Left}
        className="!size-3 !border-0 !bg-transparent"
      />
      <Handle
        id="reroute-out"
        type="source"
        position={Position.Right}
        className="!size-3 !border-0 !bg-transparent"
      />
    </div>
  );
}

export const RerouteNodeView = memo(RerouteNodeViewInner);
