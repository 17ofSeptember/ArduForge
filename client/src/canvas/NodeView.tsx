import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, CircleAlert, HelpCircle } from 'lucide-react';
import { execOuts, getNodeDef, inputPorts, outputPorts } from '@/nodes/registry';
import {
  CATEGORY,
  EXEC_IN_HANDLE,
  PORT_COLOR,
  dataInHandle,
  dataOutHandle,
  execOutHandle,
  parseHandle,
  type LiteralValue,
} from '@/nodes/types';
import type { ForgeNode } from '@/graph/model';
import { useGraphStore } from '@/store/graphStore';
import { LiteralEditor } from '@/canvas/LiteralEditor';

/** Exec handles are square and white; data handles are round and type-coloured. */
function ExecHandle({ id, position }: { id: string; position: Position }) {
  return (
    <Handle
      id={id}
      type={position === Position.Left ? 'target' : 'source'}
      position={position}
      className="!size-3 !rounded-[2px] !border-2 !border-app"
      style={{ background: PORT_COLOR.exec }}
    />
  );
}

function DataHandle({
  id,
  position,
  color,
}: {
  id: string;
  position: Position;
  color: string;
}) {
  return (
    <Handle
      id={id}
      type={position === Position.Left ? 'target' : 'source'}
      position={position}
      className="!size-2.5 !border-2 !border-app"
      style={{ background: color }}
    />
  );
}

function NodeViewInner({ id, data, selected }: NodeProps<ForgeNode>) {
  const def = getNodeDef(data.defId);
  const edges = useGraphStore((state) => state.edges);
  const problems = useGraphStore((state) => state.problems);
  const setLiteral = useGraphStore((state) => state.setLiteral);
  const setCollapsed = useGraphStore((state) => state.setCollapsed);

  const connectedInputs = useMemo(() => {
    const set = new Set<string>();
    for (const edge of edges) {
      if (edge.target !== id) continue;
      const handle = parseHandle(edge.targetHandle);
      if (handle?.kind === 'in') set.add(handle.portId);
    }
    return set;
  }, [edges, id]);

  const nodeProblems = useMemo(
    () => problems.filter((problem) => problem.nodeId === id),
    [problems, id],
  );
  const hasError = nodeProblems.some((problem) => problem.severity === 'error');
  const hasWarning = !hasError && nodeProblems.length > 0;

  if (def === null) {
    return (
      <div className="rounded-lg border-2 border-error bg-panel p-3">
        <div className="flex items-center gap-2 text-sm">
          <HelpCircle size={14} className="text-error" />
          Unknown node
        </div>
        <p className="mt-1 font-mono text-[11px] text-content-muted">{data.defId}</p>
      </div>
    );
  }

  const category = CATEGORY[def.category];
  const Icon = def.icon;
  const collapsed = data.collapsed === true;
  const ins = inputPorts(def, data.config);
  const outs = outputPorts(def, data.config);
  const execOutNames = execOuts(def, data.config);

  const summaryValues: Record<string, LiteralValue> = { ...data.literals, ...data.config };
  const summary = def.summary?.(summaryValues) ?? '';

  const ring = hasError
    ? '0 0 0 2px var(--feedback-destructive), 0 0 16px color-mix(in oklch, var(--feedback-destructive) 45%, transparent)'
    : hasWarning
      ? '0 0 0 2px var(--feedback-warning)'
      : selected === true
        ? '0 0 0 2px var(--border-selected)'
        : undefined;

  return (
    <div
      className="w-[210px] overflow-hidden rounded-lg border border-edge bg-panel shadow-lg"
      style={{ boxShadow: ring }}
    >
      <header
        className="flex items-center gap-1.5 px-2 py-1.5"
        style={{ backgroundColor: category.color }}
      >
        <Icon size={13} className="shrink-0 text-on-semantic/80" />
        <span className="flex-1 truncate text-[12px] font-semibold text-on-semantic/90">{def.label}</span>
        {nodeProblems.length > 0 && (
          <CircleAlert
            size={13}
            className="shrink-0 text-on-semantic/80"
            aria-label={nodeProblems[0]?.message}
          />
        )}
        <button
          type="button"
          className="nodrag shrink-0 text-on-semantic/70 hover:text-on-semantic"
          onClick={() => setCollapsed(id, !collapsed)}
          aria-label={collapsed ? 'Expand node' : 'Collapse node'}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
      </header>

      {/* Exec row: the "when" of the node, kept visually above the data rows. */}
      {(def.execIn === true || execOutNames.length > 0) && (
        <div className="relative flex items-center justify-between border-b border-edge-subtle px-2 py-1.5">
          {def.execIn === true && <ExecHandle id={EXEC_IN_HANDLE} position={Position.Left} />}
          <span className="text-[10px] tracking-wider text-content-muted uppercase">
            {def.execIn === true ? 'run' : ''}
          </span>
          <div className="flex flex-col items-end gap-1">
            {execOutNames.map((name) => (
              <div key={name} className="relative flex items-center">
                <span className="text-[10px] tracking-wider text-content-secondary uppercase">
                  {name}
                </span>
                <ExecHandle id={execOutHandle(name)} position={Position.Right} />
              </div>
            ))}
          </div>
        </div>
      )}

      {collapsed ? (
        summary !== '' && (
          <div className="px-2 py-1.5 font-mono text-[11px] text-content-secondary">
            {summary}
          </div>
        )
      ) : (
        <>
          {ins.map((port) => {
            const connected = connectedInputs.has(port.id);
            return (
              <div key={port.id} className="relative flex items-center gap-2 px-2 py-1">
                <DataHandle
                  id={dataInHandle(port.id)}
                  position={Position.Left}
                  color={PORT_COLOR[port.type]}
                />
                <span className="flex-1 truncate text-[11px] text-content-secondary">
                  {port.label}
                </span>
                {connected ? (
                  <span className="font-mono text-[10px] text-content-muted italic">
                    linked
                  </span>
                ) : port.literal !== undefined ? (
                  <LiteralEditor
                    spec={port.literal}
                    value={data.literals[port.id]}
                    onChange={(value) => setLiteral(id, port.id, value)}
                    compact
                  />
                ) : (
                  <span className="font-mono text-[10px] text-error">
                    needs input
                  </span>
                )}
              </div>
            );
          })}

          {outs.map((port) => (
            <div key={port.id} className="relative flex items-center justify-end gap-2 px-2 py-1">
              <span className="truncate text-[11px] text-content-secondary">
                {port.label}
              </span>
              <DataHandle
                id={dataOutHandle(port.id)}
                position={Position.Right}
                color={PORT_COLOR[port.type]}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Memoised: a 200-node graph must not re-render every node on one node's change (§Phase 8). */
export const NodeView = memo(NodeViewInner);
