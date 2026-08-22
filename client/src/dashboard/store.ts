/**
 * Dashboard store: pages, widgets, edit/run mode, and the link connection.
 * BUILD_PLAN.md §Phase 6.
 */
import { create } from 'zustand';
import {
  GRID_COLUMNS,
  specFor,
  type Binding,
  type DashboardDoc,
  type DashboardPage,
  type Widget,
  type WidgetConfig,
  type WidgetType,
} from '@/dashboard/model';
import { linkClient } from '@/link/linkClient';
import { firmataClient } from '@/link/firmataClient';
import { telemetry } from '@/dashboard/telemetry';

let counter = 0;
function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export interface LogRow {
  readonly id: number;
  readonly at: number;
  readonly text: string;
}

const MAX_LOG_ROWS = 500;

interface DashboardState {
  pages: DashboardPage[];
  widgets: Widget[];
  activePageId: string;
  mode: 'edit' | 'run';
  /** Which transport pin bindings talk to (§Phase 6 Modes A and B). */
  linkMode: 'awrylink' | 'firmata';
  selectedId: string | null;

  // link state
  connected: boolean;
  connecting: boolean;
  stale: boolean;
  board: string | null;
  sketchHash: string | null;
  intervalMs: number;
  latencyMs: number | null;
  error: string | null;
  logs: LogRow[];
  exposedNames: string[];

  setMode(mode: 'edit' | 'run'): void;
  setLinkMode(mode: 'awrylink' | 'firmata'): void;
  setActivePage(id: string): void;
  addPage(): void;
  renamePage(id: string, name: string): void;
  removePage(id: string): void;

  addWidget(type: WidgetType): string;
  removeWidget(id: string): void;
  select(id: string | null): void;
  moveWidget(id: string, x: number, y: number): void;
  resizeWidget(id: string, w: number, h: number): void;
  setBinding(id: string, binding: Binding): void;
  setConfig(id: string, patch: Partial<WidgetConfig>): void;

  load(doc: DashboardDoc): void;
  toDoc(): DashboardDoc;

  connect(port: string): void;
  disconnect(): void;
  setInterval(ms: number): void;
  setExposedNames(names: readonly string[]): void;
  writeBinding(binding: Binding, value: number): void;
  clearLogs(): void;
}

const FIRST_PAGE: DashboardPage = { id: 'page_1', name: 'Main' };

let logSeq = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pendingPingAt = 0;

export const useDashboard = create<DashboardState>((set, get) => ({
  pages: [FIRST_PAGE],
  widgets: [],
  activePageId: FIRST_PAGE.id,
  mode: 'edit',
  linkMode: 'awrylink',
  selectedId: null,

  connected: false,
  connecting: false,
  stale: false,
  board: null,
  sketchHash: null,
  intervalMs: 100,
  latencyMs: null,
  error: null,
  logs: [],
  exposedNames: [],

  setMode: (mode) => set({ mode, selectedId: mode === 'run' ? null : get().selectedId }),
  setLinkMode: (linkMode) => set({ linkMode }),
  setActivePage: (id) => set({ activePageId: id, selectedId: null }),

  addPage() {
    const page: DashboardPage = { id: makeId('page'), name: `Page ${get().pages.length + 1}` };
    set((state) => ({ pages: [...state.pages, page], activePageId: page.id }));
  },

  renamePage(id, name) {
    set((state) => ({
      pages: state.pages.map((page) => (page.id === id ? { ...page, name } : page)),
    }));
  },

  removePage(id) {
    const state = get();
    if (state.pages.length <= 1) return;
    const pages = state.pages.filter((page) => page.id !== id);
    set({
      pages,
      widgets: state.widgets.filter((widget) => widget.pageId !== id),
      activePageId: state.activePageId === id ? (pages[0]?.id ?? '') : state.activePageId,
    });
  },

  addWidget(type) {
    const spec = specFor(type);
    const state = get();
    const onPage = state.widgets.filter((widget) => widget.pageId === state.activePageId);
    // Drop it below everything already placed, so nothing is ever hidden.
    const bottom = onPage.reduce((lowest, widget) => Math.max(lowest, widget.y + widget.h), 0);

    const widget: Widget = {
      id: makeId('w'),
      type,
      pageId: state.activePageId,
      x: 0,
      y: bottom,
      w: Math.min(spec.w, GRID_COLUMNS),
      h: spec.h,
      binding: { kind: 'none' },
      config: { ...spec.defaults },
    };
    set({ widgets: [...state.widgets, widget], selectedId: widget.id });
    return widget.id;
  },

  removeWidget(id) {
    set((state) => ({
      widgets: state.widgets.filter((widget) => widget.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }));
  },

  select: (id) => set({ selectedId: id }),

  moveWidget(id, x, y) {
    set((state) => ({
      widgets: state.widgets.map((widget) =>
        widget.id === id
          ? {
              ...widget,
              x: Math.max(0, Math.min(x, GRID_COLUMNS - widget.w)),
              y: Math.max(0, y),
            }
          : widget,
      ),
    }));
  },

  resizeWidget(id, w, h) {
    set((state) => ({
      widgets: state.widgets.map((widget) =>
        widget.id === id
          ? {
              ...widget,
              w: Math.max(1, Math.min(w, GRID_COLUMNS - widget.x)),
              h: Math.max(1, h),
            }
          : widget,
      ),
    }));
  },

  setBinding(id, binding) {
    set((state) => ({
      widgets: state.widgets.map((widget) => (widget.id === id ? { ...widget, binding } : widget)),
    }));
  },

  setConfig(id, patch) {
    set((state) => ({
      widgets: state.widgets.map((widget) =>
        widget.id === id ? { ...widget, config: { ...widget.config, ...patch } } : widget,
      ),
    }));
  },

  load(doc) {
    const pages = doc.pages.length > 0 ? [...doc.pages] : [FIRST_PAGE];
    set({
      pages,
      widgets: [...doc.widgets],
      activePageId: pages[0]?.id ?? FIRST_PAGE.id,
      selectedId: null,
    });
  },

  toDoc() {
    const state = get();
    return { pages: state.pages, widgets: state.widgets };
  },

  connect(port) {
    set({ connecting: true, error: null });
    linkClient.send({ t: 'open', port });
  },

  disconnect() {
    linkClient.send({ t: 'close' });
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    set({ connected: false, connecting: false, stale: false, board: null, sketchHash: null });
  },

  setInterval(ms) {
    set({ intervalMs: ms });
    if (get().connected) linkClient.send({ t: 'telemetry', intervalMs: ms });
  },

  setExposedNames: (names) => set({ exposedNames: [...names] }),

  /**
   * §3.2 — issue the hardware command first. The local echo below is only so a
   * control does not feel dead; the authoritative value still arrives as
   * telemetry from the board and overwrites it.
   */
  writeBinding(binding, value) {
    switch (binding.kind) {
      case 'var':
        linkClient.send({ t: 'setVar', name: binding.name, value });
        telemetry.poke(binding.name, value);
        break;
      case 'pin': {
        // Pin writes go to whichever transport is live: the user's own program
        // in Mode B, or StandardFirmata in Mode A.
        const viaFirmata = get().linkMode === 'firmata';
        if (binding.op === 'analogWrite') {
          if (viaFirmata) firmataClient.send({ t: 'analogWrite', pin: binding.pin, value });
          else linkClient.send({ t: 'analogWrite', pin: binding.pin, value });
        } else if (binding.op === 'digitalWrite') {
          const level = value > 0 ? 1 : 0;
          if (viaFirmata) firmataClient.send({ t: 'digitalWrite', pin: binding.pin, value: level });
          else linkClient.send({ t: 'digitalWrite', pin: binding.pin, value: level });
        }
        telemetry.poke(`pin${binding.pin}`, value);
        break;
      }
      case 'command':
        break;
      case 'none':
        break;
    }
  },

  clearLogs: () => set({ logs: [] }),
}));

/**
 * Bridges the link socket into the store. Called once from the dashboard;
 * telemetry deliberately bypasses the store and goes straight to the bus.
 */
export function attachLink(): () => void {
  const unsubscribe = linkClient.subscribe((message) => {
    const state = useDashboard.getState();

    switch (message.t) {
      case 'status':
        useDashboard.setState({
          connected: message.connected,
          connecting: false,
          board: message.board,
          sketchHash: message.sketchHash,
          stale: false,
        });
        if (message.connected) {
          linkClient.send({ t: 'telemetry', intervalMs: state.intervalMs });
          if (pingTimer === null) {
            pingTimer = setInterval(() => {
              pendingPingAt = performance.now();
              linkClient.send({ t: 'ping' });
            }, 2000);
          }
        }
        break;

      case 'telemetry':
        // Straight to the ring buffer; never through React state.
        telemetry.ingest(message.values, performance.now());
        break;

      case 'pinValue':
        telemetry.poke(`pin${message.pin}`, message.value);
        break;

      case 'log':
        useDashboard.setState((current) => {
          logSeq += 1;
          const rows = [...current.logs, { id: logSeq, at: Date.now(), text: message.text }];
          return { logs: rows.length > MAX_LOG_ROWS ? rows.slice(rows.length - MAX_LOG_ROWS) : rows };
        });
        break;

      case 'stale':
        useDashboard.setState({ stale: message.stale });
        break;

      case 'pong':
        useDashboard.setState({ latencyMs: Math.round(performance.now() - pendingPingAt) });
        break;

      case 'revoked':
        useDashboard.setState({
          connected: false,
          connecting: false,
          error:
            message.reason === 'preempted'
              ? 'Port taken by an upload. Reconnecting when it finishes.'
              : message.reason === 'device-lost'
                ? 'Board disconnected.'
                : null,
        });
        break;

      case 'error':
        useDashboard.setState({ error: message.message, connecting: false });
        break;
    }
  });

  return () => {
    unsubscribe();
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };
}
