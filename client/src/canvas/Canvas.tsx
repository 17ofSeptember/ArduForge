import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type OnConnectStartParams,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NodeView } from '@/canvas/NodeView';
import { FrameNodeView } from '@/canvas/FrameNodeView';
import { RerouteNodeView } from '@/canvas/RerouteNodeView';
import { ForgeEdgeView } from '@/canvas/ForgeEdgeView';
import { NodePicker } from '@/canvas/NodePicker';
import { Inspector } from '@/canvas/Inspector';
import { ProblemsPanel } from '@/canvas/ProblemsPanel';
import { ContextMenu, type ContextMenuState } from '@/canvas/ContextMenu';
import { useGraphStore } from '@/store/graphStore';
import { resolveConnection } from '@/graph/connect';
import { isForgeNode, isFrameNode, type AnyNode } from '@/graph/model';
import { canConnectTypes } from '@/nodes/typeSystem';
import { execOuts, getNodeDef, inputPorts, outputPorts } from '@/nodes/registry';
import { CATEGORY, parseHandle, type NodeDef, type PortType } from '@/nodes/types';
import { toast } from '@/ui/toast';
import { useLayout } from '@/ui/useBreakpoint';
// CodeMirror is the single largest dependency and the panel is toggleable, so
// it streams in rather than blocking the canvas from appearing.
const CodePanel = lazy(() => import('@/codegen/CodePanel').then((m) => ({ default: m.CodePanel })));
import { GraphBuildActions } from '@/codegen/GraphBuildActions';
import type { UploadTarget } from '@/build/BuildPanel';

const nodeTypes: NodeTypes = {
  forge: NodeView,
  frame: FrameNodeView,
  reroute: RerouteNodeView,
};

const edgeTypes: EdgeTypes = { forge: ForgeEdgeView };

// The arrowhead is an SVG <marker> in React Flow's <defs>, so a var() resolves
// here and tracks the theme without rebuilding the graph.
const defaultEdgeOptions = {
  type: 'forge',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: 'var(--port-exec)',
  },
};

interface PendingConnection {
  readonly screen: { x: number; y: number };
  readonly flow: XYPosition;
  readonly filter: (def: NodeDef) => boolean;
  readonly connect: (newNodeId: string) => void;
}

function CanvasInner({ targets }: { targets: readonly UploadTarget[] }) {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const store = useGraphStore();
  const { screenToFlowPosition, fitView, setCenter, getZoom } = useReactFlow();
  const layout = useLayout();

  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [palette, setPalette] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [search, setSearch] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const connectStart = useRef<OnConnectStartParams | null>(null);
  /** Nodes captured inside a frame when its drag began, so they move with it. */
  const frameDrag = useRef<{ id: string; last: XYPosition; children: string[] } | null>(null);

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected === true), [nodes]);

  // ── connection handling ────────────────────────────────────────────────────

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => resolveConnection(connection as Connection, nodes).ok,
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = resolveConnection(connection, nodes);
      if (!result.ok) {
        toast.warning('Connection rejected', result.reason);
        return;
      }
      store.connect(result.edge);
      if (result.note !== null) toast.info('Value converted', result.note);
    },
    [nodes, store],
  );

  const onConnectStart = useCallback((_: unknown, params: OnConnectStartParams) => {
    connectStart.current = params;
  }, []);

  /** Dropping a connection on empty canvas offers only type-compatible nodes. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const start = connectStart.current;
      connectStart.current = null;
      if (state.isValid === true || start === null || start.nodeId === null) return;
      // Captured so the narrowing survives into the callbacks below.
      const originId: string = start.nodeId;
      const originHandle: string | null = start.handleId ?? null;

      const point =
        'changedTouches' in event
          ? { x: event.changedTouches[0]?.clientX ?? 0, y: event.changedTouches[0]?.clientY ?? 0 }
          : { x: event.clientX, y: event.clientY };
      const flow = screenToFlowPosition(point);

      const originNode = nodes.find((node) => node.id === originId);
      if (originNode === undefined || !isForgeNode(originNode)) return;
      const originDef = getNodeDef(originNode.data.defId);
      if (originDef === null) return;

      const handle = parseHandle(originHandle);
      if (handle === null) return;

      // Dragging from an output looks for a node with a compatible input, and
      // vice versa. Anything else would offer nodes that cannot be connected.
      if (start.handleType === 'source') {
        const fromType: PortType =
          handle.kind === 'exec-out'
            ? 'exec'
            : handle.kind === 'out'
              ? (outputPorts(originDef).find((port) => port.id === handle.portId)?.type ?? 'any')
              : 'any';

        setPending({
          screen: point,
          flow,
          filter: (def) =>
            fromType === 'exec'
              ? def.execIn === true
              : inputPorts(def).some((port) => canConnectTypes(fromType, port.type).ok),
          connect: (newNodeId) => {
            const targetDef = getNodeDef(
              (useGraphStore.getState().nodes.find((n) => n.id === newNodeId) as
                | { data: { defId: string } }
                | undefined)?.data.defId ?? '',
            );
            if (targetDef === null) return;
            const targetHandle =
              fromType === 'exec'
                ? 'exec-in'
                : `in:${inputPorts(targetDef).find((port) => canConnectTypes(fromType, port.type).ok)?.id ?? ''}`;
            const resolution = resolveConnection(
              {
                source: originId,
                sourceHandle: originHandle,
                target: newNodeId,
                targetHandle,
              },
              useGraphStore.getState().nodes,
            );
            if (resolution.ok) store.connect(resolution.edge);
          },
        });
      } else {
        const toType: PortType =
          handle.kind === 'exec-in'
            ? 'exec'
            : handle.kind === 'in'
              ? (inputPorts(originDef).find((port) => port.id === handle.portId)?.type ?? 'any')
              : 'any';

        setPending({
          screen: point,
          flow,
          filter: (def) =>
            toType === 'exec'
              ? execOuts(def).length > 0
              : outputPorts(def).some((port) => canConnectTypes(port.type, toType).ok),
          connect: (newNodeId) => {
            const sourceDef = getNodeDef(
              (useGraphStore.getState().nodes.find((n) => n.id === newNodeId) as
                | { data: { defId: string } }
                | undefined)?.data.defId ?? '',
            );
            if (sourceDef === null) return;
            const sourceHandle =
              toType === 'exec'
                ? `exec-out:${execOuts(sourceDef)[0] ?? 'then'}`
                : `out:${outputPorts(sourceDef).find((port) => canConnectTypes(port.type, toType).ok)?.id ?? ''}`;
            const resolution = resolveConnection(
              {
                source: newNodeId,
                sourceHandle,
                target: originId,
                targetHandle: originHandle,
              },
              useGraphStore.getState().nodes,
            );
            if (resolution.ok) store.connect(resolution.edge);
          },
        });
      }
    },
    [nodes, screenToFlowPosition, store],
  );

  // ── frames drag their contents ─────────────────────────────────────────────

  const onNodeDragStart = useCallback(
    (_: unknown, node: Node) => {
      store.beginDrag();
      const target = nodes.find((candidate) => candidate.id === node.id);
      if (target === undefined || !isFrameNode(target)) return;

      const left = target.position.x;
      const top = target.position.y;
      const right = left + (target.width ?? 360);
      const bottom = top + (target.height ?? 240);

      frameDrag.current = {
        id: target.id,
        last: { ...target.position },
        children: nodes
          .filter(
            (candidate) =>
              candidate.id !== target.id &&
              candidate.position.x >= left &&
              candidate.position.y >= top &&
              candidate.position.x <= right &&
              candidate.position.y <= bottom,
          )
          .map((candidate) => candidate.id),
      };
    },
    [nodes, store],
  );

  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      const drag = frameDrag.current;
      if (drag === null || drag.id !== node.id) return;

      const dx = node.position.x - drag.last.x;
      const dy = node.position.y - drag.last.y;
      if (dx === 0 && dy === 0) return;
      drag.last = { ...node.position };

      const children = new Set(drag.children);
      useGraphStore.setState((state) => ({
        nodes: state.nodes.map((candidate) =>
          children.has(candidate.id)
            ? {
                ...candidate,
                position: { x: candidate.position.x + dx, y: candidate.position.y + dy },
              }
            : candidate,
        ),
      }));
    },
    [],
  );

  const onNodeDragStop = useCallback(() => {
    frameDrag.current = null;
    store.save();
  }, [store]);

  // ── keyboard map ───────────────────────────────────────────────────────────

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().nodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) return;
      const width = node.measured?.width ?? 210;
      const height = node.measured?.height ?? 100;
      void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom: Math.max(getZoom(), 1),
        duration: 300,
      });
      useGraphStore.setState((state) => ({
        nodes: state.nodes.map((candidate) => ({
          ...candidate,
          selected: candidate.id === nodeId,
        })),
      }));
    },
    [setCenter, getZoom],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
        return;
      }
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearch('');
        return;
      }
      if (typing) return;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        store.copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        store.paste(null);
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        store.duplicateSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  // ── context menus ──────────────────────────────────────────────────────────

  const openCanvasMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      setMenu({
        x: point.x,
        y: point.y,
        items: [
          { label: 'Add node…', shortcut: '⌘K', onSelect: () => setPalette(point) },
          {
            label: 'Add group frame',
            onSelect: () => store.addFrame(screenToFlowPosition(point)),
          },
          { label: 'Paste', shortcut: '⌘V', onSelect: () => store.paste(screenToFlowPosition(point)) },
          { label: 'Fit to view', onSelect: () => void fitView({ duration: 300 }) },
        ],
      });
    },
    [fitView, screenToFlowPosition, store],
  );

  const openNodeMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const isCollapsible = isForgeNode(node as AnyNode);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: 'Duplicate', shortcut: '⌘D', onSelect: () => store.duplicateSelection() },
          {
            label: (node as AnyNode & { data: { collapsed?: boolean } }).data.collapsed === true
              ? 'Expand'
              : 'Collapse',
            disabled: !isCollapsible,
            onSelect: () =>
              store.setCollapsed(
                node.id,
                !((node as AnyNode & { data: { collapsed?: boolean } }).data.collapsed === true),
              ),
          },
          { label: 'Delete', shortcut: '⌫', danger: true, onSelect: () => store.deleteSelection() },
        ],
      });
    },
    [store],
  );

  const openEdgeMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: 'Add reroute point',
            onSelect: () =>
              store.addReroute(edge.id, screenToFlowPosition({ x: event.clientX, y: event.clientY })),
          },
          {
            label: 'Delete connection',
            danger: true,
            onSelect: () => store.onEdgesChange([{ id: edge.id, type: 'remove' }]),
          },
        ],
      });
    },
    [screenToFlowPosition, store],
  );

  // ── node search (⌘F) ───────────────────────────────────────────────────────

  const searchMatches = useMemo(() => {
    if (search === null || search.trim() === '') return [];
    const needle = search.trim().toLowerCase();
    return nodes.filter((node) => {
      if (!isForgeNode(node)) return false;
      const def = getNodeDef(node.data.defId);
      return def !== null && def.label.toLowerCase().includes(needle);
    });
  }, [nodes, search]);

  return (
    <div ref={wrapperRef} className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={store.onNodesChange}
          onEdgesChange={store.onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onPaneContextMenu={openCanvasMenu}
          onNodeContextMenu={openNodeMenu}
          onEdgeContextMenu={openEdgeMenu}
          onEdgeDoubleClick={(event, edge) =>
            store.addReroute(edge.id, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
          }
          nodesDraggable={layout.canEditGraph}
          nodesConnectable={layout.canEditGraph}
          elementsSelectable={layout.canEditGraph}
          snapToGrid={snapToGrid}
          snapGrid={[16, 16]}
          selectionOnDrag
          panOnDrag={[1, 2]}
          multiSelectionKeyCode="Shift"
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={0.2}
          maxZoom={2.5}
        >
          {/*
            No colour props here on purpose. The dot pattern, the controls, and
            the minimap background and mask all come from the --xy-* overrides
            in tokens.css, which is the override point React Flow documents and
            the only one that follows a theme change without a remount.
          */}
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              const candidate = node as AnyNode;
              // A frame's colour is user data (THEME.md Phase 5) — passed through.
              if (isFrameNode(candidate)) return candidate.data.color;
              if (!isForgeNode(candidate)) return 'var(--port-any)';
              const def = getNodeDef(candidate.data.defId);
              return def === null ? 'var(--port-any)' : CATEGORY[def.category].color;
            }}
          />
        </ReactFlow>

        {!layout.canEditGraph && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <p className="pointer-events-auto rounded-full border border-edge bg-card/95 px-3 py-1 text-[11px] text-content-secondary backdrop-blur">
              View only on this screen size — pan and zoom to explore. Editing needs 1024px or wider.
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute top-3 left-3 flex gap-2">
          <button
            type="button"
            onClick={() => setSnapToGrid((value) => !value)}
            className="pointer-events-auto rounded border border-edge bg-card/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-header"
          >
            Snap: {snapToGrid ? 'on' : 'off'}
          </button>
          <button
            type="button"
            onClick={() => void fitView({ duration: 300 })}
            className="pointer-events-auto rounded border border-edge bg-card/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-header"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => setPalette({ x: window.innerWidth / 2, y: window.innerHeight / 3 })}
            className="pointer-events-auto rounded border border-edge bg-card/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-header"
          >
            Add node ⌘K
          </button>
          <button
            type="button"
            onClick={() => setShowCode((value) => !value)}
            className="pointer-events-auto rounded border border-edge bg-card/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-header"
          >
            {showCode ? 'Hide code' : 'Show code'}
          </button>
          <GraphBuildActions targets={targets} />
        </div>

        {search !== null && (
          <div className="absolute top-3 right-3 w-64 rounded-md border border-edge bg-card p-2 shadow-xl">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch(null);
                if (event.key === 'Enter' && searchMatches[0] !== undefined) {
                  focusNode(searchMatches[0].id);
                }
              }}
              placeholder="Find node… (Esc to close)"
              className="w-full bg-transparent text-xs"
            />
            {search.trim() !== '' && (
              <ul className="mt-1.5 max-h-48 overflow-auto">
                {searchMatches.length === 0 ? (
                  <li className="px-1 py-1 text-[11px] text-content-muted">
                    No matches.
                  </li>
                ) : (
                  searchMatches.map((node) => {
                    const def = isForgeNode(node) ? getNodeDef(node.data.defId) : null;
                    return (
                      <li key={node.id}>
                        <button
                          type="button"
                          onClick={() => focusNode(node.id)}
                          className="w-full rounded px-1 py-1 text-left text-[11px] hover:bg-header"
                        >
                          {def?.label ?? node.id}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      {showCode && layout.showCodePanel && (
        <div className="hidden w-96 shrink-0 border-l border-edge-subtle lg:block">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-content-muted">Loading editor…</p>
              </div>
            }
          >
            <CodePanel />
          </Suspense>
        </div>
      )}

      {layout.showInspector && (
      <aside className="flex w-72 shrink-0 flex-col border-l border-edge-subtle bg-panel">
        <div className="min-h-0 flex-1 overflow-auto">
          <Inspector selected={selectedNodes} />
        </div>
        <div className="h-56 shrink-0 border-t border-edge-subtle">
          <ProblemsPanel onFocusNode={focusNode} />
        </div>
      </aside>
      )}

      {palette !== null && (
        <NodePicker
          title="Add node"
          onClose={() => setPalette(null)}
          onPick={(defId) => {
            const created = store.addNode(defId, screenToFlowPosition(palette));
            if (created === null) {
              toast.warning('Only one allowed', 'That node already exists in this graph.');
            }
            setPalette(null);
          }}
        />
      )}

      {pending !== null && (
        <NodePicker
          title="Connect to…"
          anchor={pending.screen}
          filter={pending.filter}
          onClose={() => setPending(null)}
          onPick={(defId) => {
            const created = store.addNode(defId, pending.flow);
            if (created === null) {
              toast.warning('Only one allowed', 'That node already exists in this graph.');
            } else {
              pending.connect(created);
            }
            setPending(null);
          }}
        />
      )}

      {menu !== null && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function Canvas({ targets = [] }: { targets?: readonly UploadTarget[] }) {
  return (
    <ReactFlowProvider>
      <CanvasInner targets={targets} />
    </ReactFlowProvider>
  );
}
