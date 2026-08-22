import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2Off, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import {
  GRID_COLUMNS,
  ROW_HEIGHT_PX,
  WIDGET_SPECS,
  bindingLabel,
  isBrokenBinding,
  type Widget,
} from '@/dashboard/model';
import { attachLink, useDashboard } from '@/dashboard/store';
import { WidgetBody } from '@/dashboard/widgets';
import { WidgetInspector } from '@/dashboard/WidgetInspector';
import { PinInspector } from '@/dashboard/PinInspector';
import { telemetry } from '@/dashboard/telemetry';
import { StatusDot } from '@/ui/primitives';

export interface DashboardTarget {
  readonly port: string;
  readonly displayName: string;
}

const INTERVALS = [50, 100, 200, 500, 1000];

function WidgetFrame({
  widget,
  editing,
  selected,
  broken,
  onSelect,
  onRemove,
  onMove,
  onResize,
}: {
  widget: Widget;
  editing: boolean;
  selected: boolean;
  broken: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
}) {
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      style={{
        gridColumn: `${widget.x + 1} / span ${widget.w}`,
        gridRow: `${widget.y + 1} / span ${widget.h}`,
      }}
      onClick={editing ? onSelect : undefined}
      className={`relative overflow-hidden rounded-lg bg-panel p-2 ${
        editing ? 'cursor-pointer' : ''
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-lg"
        style={{
          boxShadow: broken
            ? '0 0 0 2px var(--feedback-warning)'
            : selected
              ? '0 0 0 2px var(--border-selected)'
              : '0 0 0 1px var(--border-subtle)',
        }}
      />

      {editing && (
        <div className="absolute top-1 right-1 z-10 flex gap-0.5">
          <button
            type="button"
            title="Move"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              const start = dragRef.current;
              if (start === null || event.buttons === 0) return;
              const cellWidth = (event.currentTarget.closest('[data-grid]')?.clientWidth ?? 1200) / GRID_COLUMNS;
              const dx = Math.round((event.clientX - start.x) / cellWidth);
              const dy = Math.round((event.clientY - start.y) / ROW_HEIGHT_PX);
              if (dx === 0 && dy === 0) return;
              onMove(dx, dy);
              dragRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            className="cursor-move rounded bg-header/90 px-1 text-[10px] text-content-secondary"
          >
            ✥
          </button>
          <button
            type="button"
            title="Remove"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="rounded bg-header/90 px-1 text-[10px] text-error"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {broken && (
        <span
          title={`"${bindingLabel(widget.binding)}" is no longer exposed by the sketch`}
          className="absolute bottom-1 left-1 z-10 flex items-center gap-1 rounded bg-warning px-1 text-[9px] font-medium text-on-interactive"
        >
          <Link2Off size={9} /> broken
        </span>
      )}

      <div className="h-full">
        <WidgetBody widget={widget} running={!editing} />
      </div>

      {editing && (
        <div
          title="Resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const start = dragRef.current;
            if (start === null || event.buttons === 0) return;
            const cellWidth = (event.currentTarget.closest('[data-grid]')?.clientWidth ?? 1200) / GRID_COLUMNS;
            const dw = Math.round((event.clientX - start.x) / cellWidth);
            const dh = Math.round((event.clientY - start.y) / ROW_HEIGHT_PX);
            if (dw === 0 && dh === 0) return;
            onResize(dw, dh);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          className="absolute right-0 bottom-0 z-10 size-3 cursor-nwse-resize bg-edge"
          style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        />
      )}
    </div>
  );
}

export function Dashboard({
  targets,
  fqbn = 'arduino:avr:uno',
}: {
  targets: readonly DashboardTarget[];
  fqbn?: string;
}) {
  const store = useDashboard();
  const [port, setPort] = useState('');
  const [rate, setRate] = useState(0);

  useEffect(() => attachLink(), []);

  useEffect(() => {
    if (targets.length === 0) {
      setPort('');
      return;
    }
    if (!targets.some((target) => target.port === port)) setPort(targets[0]?.port ?? '');
  }, [targets, port]);

  // Frame rate is display-only; polling it once a second avoids re-rendering
  // the dashboard on every telemetry frame.
  useEffect(() => {
    const timer = setInterval(() => setRate(telemetry.frameRate), 1000);
    return () => clearInterval(timer);
  }, []);

  const exposed = useMemo(() => new Set(store.exposedNames), [store.exposedNames]);
  const editing = store.mode === 'edit';
  const onPage = store.widgets.filter((widget) => widget.pageId === store.activePageId);
  const selected = store.widgets.find((widget) => widget.id === store.selectedId) ?? null;

  const rows = Math.max(8, ...onPage.map((widget) => widget.y + widget.h + 1));

  const connect = useCallback(() => {
    if (port === '') return;
    store.connect(port);
  }, [port, store]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle bg-panel px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => store.setMode('edit')}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${editing ? 'bg-header' : 'text-content-secondary hover:bg-card'}`}
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              type="button"
              onClick={() => store.setMode('run')}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${!editing ? 'bg-header' : 'text-content-secondary hover:bg-card'}`}
            >
              <Play size={12} /> Run
            </button>
          </div>

          <div className="flex items-center gap-1 border-l border-edge-subtle pl-2">
            {(
              [
                { id: 'awrylink', label: 'My Program' },
                { id: 'firmata', label: 'Quick Pins' },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => store.setLinkMode(option.id)}
                title={
                  option.id === 'awrylink'
                    ? 'Bind widgets to variables your own sketch exposes'
                    : 'Poke pins directly through StandardFirmata, with no program'
                }
                className={`rounded px-2 py-1 text-xs ${
                  store.linkMode === option.id
                    ? 'bg-header'
                    : 'text-content-secondary hover:bg-card'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-edge-subtle pl-2">
            {store.pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => store.setActivePage(page.id)}
                onDoubleClick={() => {
                  const name = window.prompt('Page name', page.name);
                  if (name !== null && name.trim() !== '') store.renamePage(page.id, name.trim());
                }}
                className={`rounded px-2 py-1 text-xs ${page.id === store.activePageId ? 'bg-header' : 'text-content-secondary hover:bg-card'}`}
              >
                {page.name}
              </button>
            ))}
            {editing && (
              <>
                <button
                  type="button"
                  onClick={store.addPage}
                  title="Add page"
                  className="rounded p-1 text-content-secondary hover:bg-card"
                >
                  <Plus size={12} />
                </button>
                {store.pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => store.removePage(store.activePageId)}
                    title="Delete page"
                    className="rounded p-1 text-error hover:bg-card"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 text-xs">
            <select
              value={port}
              data-port-select
              onChange={(event) => setPort(event.target.value)}
              disabled={store.connected || targets.length === 0}
              className="rounded border border-edge bg-card px-1.5 py-1 font-mono text-[11px]"
            >
              {targets.length === 0 ? (
                <option value="">No boards</option>
              ) : (
                targets.map((target) => (
                  <option key={target.port} value={target.port}>
                    {target.port}
                  </option>
                ))
              )}
            </select>

            <select
              value={store.intervalMs}
              onChange={(event) => store.setInterval(Number(event.target.value))}
              title="Telemetry interval"
              className="rounded border border-edge bg-card px-1.5 py-1 font-mono text-[11px]"
            >
              {INTERVALS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms} ms
                </option>
              ))}
            </select>

            {store.connected ? (
              <button
                type="button"
                onClick={store.disconnect}
                className="rounded bg-destructive px-2 py-1 text-[11px] font-medium text-on-destructive"
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={connect}
                disabled={port === '' || store.connecting}
                className="rounded bg-interactive px-2 py-1 text-[11px] font-medium text-on-interactive disabled:opacity-40"
              >
                {store.connecting ? 'Connecting…' : 'Connect'}
              </button>
            )}

            <span className="flex items-center gap-1.5 font-mono text-[11px] text-content-secondary">
              <StatusDot
                tone={!store.connected ? 'idle' : store.stale ? 'warn' : 'ok'}
                pulse={store.stale}
              />
              {store.connected
                ? store.stale
                  ? 'stale'
                  : `${rate} Hz${store.latencyMs === null ? '' : ` · ${store.latencyMs} ms`}`
                : 'offline'}
            </span>
          </div>
        </header>

        {store.error !== null && (
          <div className="shrink-0 border-b border-edge-subtle bg-card px-3 py-1.5 text-xs text-error">
            {store.error}
          </div>
        )}

        {store.linkMode === 'firmata' ? (
          <div className="min-h-0 flex-1">
            <PinInspector port={port} fqbn={fqbn} />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {onPage.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-content-secondary">This page is empty.</p>
              <p className="text-xs text-content-muted">
                {editing
                  ? 'Pick a widget from the palette on the right.'
                  : 'Switch to Edit mode to add widgets.'}
              </p>
            </div>
          ) : (
            <div
              data-grid
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
                gridAutoRows: `${ROW_HEIGHT_PX}px`,
                gridTemplateRows: `repeat(${rows}, ${ROW_HEIGHT_PX}px)`,
              }}
            >
              {onPage.map((widget) => (
                <WidgetFrame
                  key={widget.id}
                  widget={widget}
                  editing={editing}
                  selected={widget.id === store.selectedId}
                  broken={isBrokenBinding(widget.binding, exposed)}
                  onSelect={() => store.select(widget.id)}
                  onRemove={() => store.removeWidget(widget.id)}
                  onMove={(dx, dy) => store.moveWidget(widget.id, widget.x + dx, widget.y + dy)}
                  onResize={(dw, dh) => store.resizeWidget(widget.id, widget.w + dw, widget.h + dh)}
                />
              ))}
            </div>
          )}
        </div>
        )}
      </div>

      {editing && store.linkMode !== 'firmata' && (
        <aside className="flex w-72 shrink-0 flex-col border-l border-edge-subtle bg-panel">
          <div className="min-h-0 flex-1 overflow-auto">
            {selected === null ? (
              <div className="p-3">
                <p className="mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                  Widgets
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {WIDGET_SPECS.map((spec) => (
                    <button
                      key={spec.type}
                      type="button"
                      onClick={() => store.addWidget(spec.type)}
                      title={spec.description}
                      className="rounded border border-edge bg-card px-2 py-1.5 text-left text-[11px] hover:bg-header"
                    >
                      {spec.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <WidgetInspector widget={selected} />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
