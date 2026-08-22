import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { FrameNode } from '@/graph/model';
import { useGraphStore } from '@/store/graphStore';

/**
 * Comment/group frame. Sits behind nodes (zIndex -1) and is deliberately
 * transparent to pointer events except on its title bar and border, so
 * clicking "through" a frame selects the node on top of it.
 */
function FrameNodeViewInner({ id, data, selected }: NodeProps<FrameNode>) {
  const setFrameTitle = useGraphStore((state) => state.setFrameTitle);

  return (
    <>
      <NodeResizer
        color={data.color}
        isVisible={selected === true}
        minWidth={160}
        minHeight={120}
        lineClassName="!border-2"
        handleClassName="!size-2.5 !rounded-sm"
      />
      <div
        className="pointer-events-none h-full w-full rounded-lg border-2"
        style={{ borderColor: data.color, backgroundColor: `${data.color}14` }}
      >
        <input
          value={data.title}
          onChange={(event) => setFrameTitle(id, event.target.value)}
          spellCheck={false}
          aria-label="Frame title"
          className="nodrag pointer-events-auto w-full truncate rounded-t-md bg-transparent px-2 py-1 text-xs font-semibold"
          style={{ color: data.color }}
        />
      </div>
    </>
  );
}

export const FrameNodeView = memo(FrameNodeViewInner);
