/**
 * The widget set (BUILD_PLAN.md §Phase 6).
 * Every widget reads through useBoundValue and writes through the store's
 * writeBinding, so none of them talk to the socket directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '@/dashboard/store';
import { useBoundValue } from '@/dashboard/useBoundValue';
import { telemetry } from '@/dashboard/telemetry';
import { ChartWidget } from '@/dashboard/widgets/Chart';
import type { Widget } from '@/dashboard/model';

function Label({ text }: { text: string | undefined }) {
  if (text === undefined || text === '') return null;
  return (
    <p className="mb-1 truncate text-[10px] tracking-wider text-content-muted uppercase">
      {text}
    </p>
  );
}

function format(value: number | null, decimals = 0, unit = ''): string {
  if (value === null) return '—';
  return `${value.toFixed(decimals)}${unit === '' ? '' : ` ${unit}`}`;
}

// ── controls ─────────────────────────────────────────────────────────────────

function ButtonWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const on = widget.config.onValue ?? 1;
  const off = widget.config.offValue ?? 0;
  const momentary = widget.config.momentary !== false;
  const [held, setHeld] = useState(false);

  const press = () => {
    if (!running) return;
    setHeld(true);
    write(widget.binding, on);
  };
  const release = () => {
    if (!running) return;
    setHeld(false);
    if (momentary) write(widget.binding, off);
  };

  return (
    <div className="flex h-full flex-col">
      <Label text={widget.config.label} />
      <button
        type="button"
        disabled={!running}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={() => held && release()}
        onClick={() => {
          if (!momentary && running) write(widget.binding, held ? off : on);
        }}
        className="min-h-0 flex-1 rounded-md text-sm font-medium text-on-interactive transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{ backgroundColor: widget.config.color ?? '#3084D7' }}
      >
        {widget.config.label ?? 'Press'}
      </button>
    </div>
  );
}

function SliderWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const bound = useBoundValue(widget.binding);
  const min = widget.config.min ?? 0;
  const max = widget.config.max ?? 180;
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState<number>(min);

  // While dragging, the knob follows the finger; otherwise it follows the board.
  const value = dragging ? local : (bound ?? local);

  const commit = (next: number) => {
    setLocal(next);
    if (running) write(widget.binding, next);
  };

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-baseline justify-between">
        <Label text={widget.config.label} />
        <span className="font-mono text-xs">{format(value, 0, widget.config.unit ?? '')}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={widget.config.step ?? 1}
        value={value}
        disabled={!running}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          setLocal(next);
          if (widget.config.liveSend !== false) commit(next);
        }}
        onMouseUp={() => {
          if (widget.config.liveSend === false) commit(local);
        }}
        className="w-full accent-interactive disabled:opacity-40"
      />
    </div>
  );
}

function SwitchWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const bound = useBoundValue(widget.binding);
  const on = widget.config.onValue ?? 1;
  const off = widget.config.offValue ?? 0;
  const isOn = (bound ?? off) > off / 2 + off;

  return (
    <div className="flex h-full flex-col justify-center">
      <Label text={widget.config.label} />
      <button
        type="button"
        disabled={!running}
        onClick={() => write(widget.binding, isOn ? off : on)}
        className="flex items-center gap-2 disabled:opacity-40"
      >
        <span
          className="relative h-5 w-9 rounded-full transition-colors"
          style={{ backgroundColor: isOn ? 'var(--feedback-success)' : 'var(--bg-header)' }}
        >
          {/*
            The knob stays light in both themes, like every platform toggle.
            --text-on-structural is the fixed-light token (Ghost White in both
            schemes); a token that flipped per theme would hide the knob in one
            of them. The shadow carries the edge against the lighter "on" track.
          */}
          <span
            className="absolute top-0.5 size-4 rounded-full bg-on-structural shadow-e1 transition-all"
            style={{ left: isOn ? '18px' : '2px' }}
          />
        </span>
        <span className="text-xs">{isOn ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

function NumberWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const bound = useBoundValue(widget.binding);
  const [draft, setDraft] = useState<string>('');

  return (
    <div className="flex h-full flex-col justify-center">
      <Label text={widget.config.label} />
      <input
        type="number"
        min={widget.config.min}
        max={widget.config.max}
        step={widget.config.step ?? 1}
        value={draft === '' ? (bound ?? '') : draft}
        disabled={!running}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number.parseFloat(draft);
          if (Number.isFinite(parsed)) write(widget.binding, parsed);
          setDraft('');
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const parsed = Number.parseFloat(draft);
          if (Number.isFinite(parsed)) write(widget.binding, parsed);
          setDraft('');
        }}
        className="w-full rounded border border-edge bg-input px-2 py-1 font-mono text-sm disabled:opacity-40"
      />
    </div>
  );
}

// ── indicators ───────────────────────────────────────────────────────────────

function LedWidget({ widget }: { widget: Widget }) {
  const value = useBoundValue(widget.binding);
  const lit = (value ?? 0) > 0.5;
  const color = widget.config.color ?? '#00945B';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5">
      <span
        className="size-7 rounded-full transition-all"
        style={{
          backgroundColor: lit ? color : 'var(--bg-header)',
          boxShadow: lit ? `0 0 14px ${color}` : 'none',
        }}
      />
      <span className="truncate text-[10px] text-content-muted">
        {widget.config.label ?? ''}
      </span>
    </div>
  );
}

function GaugeWidget({ widget }: { widget: Widget }) {
  const value = useBoundValue(widget.binding);
  const min = widget.config.min ?? 0;
  const max = widget.config.max ?? 1023;
  const fraction = value === null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min || 1)));

  const zones = widget.config.zones ?? [];
  const colour =
    [...zones].reverse().find((zone) => fraction >= zone.from)?.color ?? 'var(--feedback-success)';

  // 240-degree sweep, starting at the lower left.
  const radius = 42;
  const sweep = 240;
  const start = 150;
  const angle = (start + sweep * fraction) * (Math.PI / 180);
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <svg viewBox="0 0 100 100" className="min-h-0 w-full flex-1">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--bg-header)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * sweep) / 360} ${circumference}`}
          transform={`rotate(${start} 50 50)`}
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * sweep * fraction) / 360} ${circumference}`}
          transform={`rotate(${start} 50 50)`}
        />
        <circle
          cx={50 + radius * Math.cos(angle)}
          cy={50 + radius * Math.sin(angle)}
          r="4"
          fill="var(--text-primary)"
        />
      </svg>
      <span className="font-mono text-sm">
        {format(value, widget.config.decimals ?? 0, widget.config.unit ?? '')}
      </span>
      <span className="truncate text-[10px] text-content-muted">
        {widget.config.label ?? ''}
      </span>
    </div>
  );
}

function ReadoutWidget({ widget }: { widget: Widget }) {
  const value = useBoundValue(widget.binding);
  return (
    <div className="flex h-full flex-col justify-center">
      <Label text={widget.config.label} />
      <span className="truncate font-mono text-2xl">
        {format(value, widget.config.decimals ?? 0, widget.config.unit ?? '')}
      </span>
    </div>
  );
}

function BarWidget({ widget }: { widget: Widget }) {
  const value = useBoundValue(widget.binding);
  const min = widget.config.min ?? 0;
  const max = widget.config.max ?? 1023;
  const fraction = value === null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min || 1)));
  const vertical = widget.config.vertical === true;
  const threshold = widget.config.threshold;
  const over = threshold !== undefined && (value ?? 0) >= threshold;

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-baseline justify-between">
        <Label text={widget.config.label} />
        <span className="font-mono text-xs">{format(value, widget.config.decimals ?? 0, widget.config.unit ?? '')}</span>
      </div>
      <div
        className={`relative overflow-hidden rounded bg-header ${vertical ? 'h-full w-6 self-center' : 'h-3 w-full'}`}
      >
        <div
          className="absolute transition-[width,height]"
          style={{
            backgroundColor: over ? 'var(--feedback-destructive)' : 'var(--bg-interactive)',
            ...(vertical
              ? { bottom: 0, left: 0, right: 0, height: `${fraction * 100}%` }
              : { top: 0, bottom: 0, left: 0, width: `${fraction * 100}%` }),
          }}
        />
      </div>
    </div>
  );
}

// ── multi-value controls ─────────────────────────────────────────────────────

function XYPadWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState({ x: 0.5, y: 0.5 });
  const min = widget.config.min ?? -255;
  const max = widget.config.max ?? 255;

  const emit = useCallback(
    (fx: number, fy: number) => {
      setPoint({ x: fx, y: fy });
      if (!running) return;
      write(widget.binding, Math.round(min + fx * (max - min)));
      const second = widget.config.bindingY;
      // Y is inverted: up on screen should mean a larger value.
      if (second !== undefined) write(second, Math.round(min + (1 - fy) * (max - min)));
    },
    [running, write, widget.binding, widget.config.bindingY, min, max],
  );

  const track = (event: React.PointerEvent) => {
    const host = hostRef.current;
    if (host === null) return;
    const rect = host.getBoundingClientRect();
    emit(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Label text={widget.config.label} />
      <div
        ref={hostRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          track(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return;
          track(event);
        }}
        onPointerUp={() => {
          if (widget.config.springToCentre !== false) emit(0.5, 0.5);
        }}
        className="relative min-h-0 flex-1 cursor-crosshair rounded border border-edge bg-input"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-edge-subtle" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-edge-subtle" />
        <div
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-interactive"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        />
      </div>
    </div>
  );
}

function ColorWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const write = useDashboard((state) => state.writeBinding);
  const [colour, setColour] = useState('#ff0000');

  const apply = (hex: string) => {
    setColour(hex);
    if (!running) return;
    const bindings = widget.config.bindingsRgb;
    if (bindings === undefined) return;
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    write(bindings[0], red);
    write(bindings[1], green);
    write(bindings[2], blue);
  };

  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <Label text={widget.config.label} />
      <input
        type="color"
        value={colour}
        disabled={!running}
        onChange={(event) => apply(event.target.value)}
        className="h-10 w-full cursor-pointer rounded border border-edge bg-transparent disabled:opacity-40"
      />
      <span className="text-center font-mono text-[10px] text-content-muted">{colour}</span>
    </div>
  );
}

// ── text panels ──────────────────────────────────────────────────────────────

function TerminalWidget({ widget }: { widget: Widget }) {
  const logs = useDashboard((state) => state.logs);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [logs]);

  const rows = filter === '' ? logs : logs.filter((row) => row.text.includes(filter));

  return (
    <div className="flex h-full flex-col">
      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="filter…"
        className="mb-1 shrink-0 rounded border border-edge bg-input px-1.5 py-0.5 text-[11px]"
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        {rows.length === 0 ? (
          <p className="text-content-muted">
            Log lines from the board appear here.
          </p>
        ) : (
          rows.slice(-(widget.config.maxRows ?? 300)).map((row) => (
            <div key={row.id} className="text-content-secondary">
              {row.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LogTableWidget({ widget }: { widget: Widget }) {
  const logs = useDashboard((state) => state.logs);
  const clear = useDashboard((state) => state.clearLogs);
  const rows = logs.slice(-(widget.config.maxRows ?? 200));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex shrink-0 items-center justify-between">
        <Label text={widget.config.label} />
        <button
          type="button"
          onClick={clear}
          className="rounded border border-edge px-1.5 py-0.5 text-[10px] hover:bg-header"
        >
          clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="text-[11px] text-content-muted">No log lines yet.</p>
        ) : (
          <table className="w-full text-left font-mono text-[11px]">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-edge-subtle">
                  <td className="w-20 py-0.5 text-content-muted">
                    {new Date(row.at).toLocaleTimeString()}
                  </td>
                  <td className="py-0.5">{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatGridWidget({ widget }: { widget: Widget }) {
  const configuredNames = widget.config.names ?? [];
  // Stable across renders that did not actually change the bound names, so
  // resubscribing happens when the selection changes and not before.
  const nameSignature = configuredNames.join('|');
  const names = useMemo(
    () => (nameSignature === '' ? [] : nameSignature.split('|')),
    [nameSignature],
  );
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    const unsubscribes = names.map((name) =>
      telemetry.subscribe(name, (value) => {
        setValues((current) => (current[name] === value ? current : { ...current, [name]: value }));
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [names]);

  if (names.length === 0) {
    return (
      <p className="p-2 text-xs text-content-muted">
        Choose which values to show in the inspector.
      </p>
    );
  }

  return (
    <div className="grid h-full auto-rows-min grid-cols-2 gap-2 overflow-auto">
      {names.map((name) => (
        <div key={name} className="rounded border border-edge-subtle bg-input p-2">
          <p className="truncate text-[10px] text-content-muted">{name}</p>
          <p className="font-mono text-base">
            {format(values[name] ?? null, widget.config.decimals ?? 0)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── dispatch ─────────────────────────────────────────────────────────────────

export function WidgetBody({ widget, running }: { widget: Widget; running: boolean }) {
  switch (widget.type) {
    case 'button':
      return <ButtonWidget widget={widget} running={running} />;
    case 'slider':
      return <SliderWidget widget={widget} running={running} />;
    case 'switch':
      return <SwitchWidget widget={widget} running={running} />;
    case 'number':
      return <NumberWidget widget={widget} running={running} />;
    case 'led':
      return <LedWidget widget={widget} />;
    case 'gauge':
      return <GaugeWidget widget={widget} />;
    case 'chart':
      return <ChartWidget widget={widget} running={running} />;
    case 'readout':
      return <ReadoutWidget widget={widget} />;
    case 'bar':
      return <BarWidget widget={widget} />;
    case 'xypad':
      return <XYPadWidget widget={widget} running={running} />;
    case 'color':
      return <ColorWidget widget={widget} running={running} />;
    case 'terminal':
      return <TerminalWidget widget={widget} />;
    case 'logTable':
      return <LogTableWidget widget={widget} />;
    case 'statGrid':
      return <StatGridWidget widget={widget} />;
  }
}
