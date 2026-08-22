import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { PORT_COLOR } from '@/nodes/types';
import type { ForgeEdge } from '@/graph/model';

/**
 * Exec edges are thick, white, and arrowed — they read as "control flows here".
 * Data edges are thin and coloured by port type (§Phase 3).
 */
function ForgeEdgeViewInner({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<ForgeEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isExec = data?.kind === 'exec';
  const color = isExec ? PORT_COLOR.exec : PORT_COLOR[data?.portType ?? 'any'];

  return (
    <BaseEdge
      path={path}
      {...(markerEnd === undefined ? {} : { markerEnd })}
      style={{
        stroke: color,
        strokeWidth: isExec ? 2.5 : 1.5,
        opacity: selected === true ? 1 : 0.85,
        filter: selected === true ? `drop-shadow(0 0 4px ${color})` : undefined,
      }}
    />
  );
}

export const ForgeEdgeView = memo(ForgeEdgeViewInner);
