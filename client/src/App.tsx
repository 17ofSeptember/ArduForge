import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Cpu, Download, FilePlus2, FolderOpen, Gauge, Save, Upload, Workflow } from 'lucide-react';
import { fetchHealth, type BoardCandidate, type HealthResponse } from '@/link/health';
import { fetchBoards } from '@/link/boards';
import { SerialMonitor } from '@/serial/SerialMonitor';
import { BuildPanel } from '@/build/BuildPanel';
const Canvas = lazy(() => import('@/canvas/Canvas').then((m) => ({ default: m.Canvas })));
const Dashboard = lazy(() => import('@/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
import { useDashboard } from '@/dashboard/store';
import { exposedVariables } from '@/codegen/awrylink';
import { Toasts } from '@/ui/Toasts';
import { toast } from '@/ui/toast';
import { Panel, StatusDot } from '@/ui/primitives';
import { useGraphStore } from '@/store/graphStore';
import { currentProject } from '@/store/graphStore';
import { migrateWithReport, serialize } from '@/store/persistence';
const ProjectBrowser = lazy(() =>
  import('@/ui/ProjectBrowser').then((m) => ({ default: m.ProjectBrowser })),
);
import { startProjectAutosave, useProjects } from '@/store/projectManager';
import { useLayout } from '@/ui/useBreakpoint';
import { ShortcutOverlay } from '@/ui/ShortcutOverlay';
import { StatusBar } from '@/ui/StatusBar';
import { FirstRunTour } from '@/ui/FirstRunTour';
import { ImportDialog, PasteDialog, type ImportTarget } from '@/ui/ImportDialog';
import { buildPreview, looksLikeSketch, sketchNameFrom, type ImportPreview } from '@/import/importFlow';
import type { ImportInputFile } from '@/import/importSketch';

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; data: HealthResponse }
  | { status: 'error'; message: string };

/** §3.6 — while nothing is attached, keep looking so replugging is picked up. */
const DISCONNECTED_POLL_MS = 2_000;
const CONNECTED_POLL_MS = 10_000;

const IDENTIFY_LABEL: Record<BoardCandidate['identifiedBy'], string> = {
  'arduino-cli': 'identified by arduino-cli',
  'profile-table': 'matched from ArduForge profile table',
  unidentified: 'not recognised',
};

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-content-muted">Loading {label}…</p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'error' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-content-secondary">{label}</span>
      <span className="flex items-center gap-2 font-mono text-sm">
        <StatusDot tone={tone} />
        {value}
      </span>
    </div>
  );
}

function BoardCard({ board }: { board: BoardCandidate }) {
  const resolved = board.fqbn !== null;
  return (
    <div className="rounded-md border border-edge-subtle bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot tone={resolved ? 'ok' : 'warn'} />
        <span className="font-medium">{board.displayName}</span>
        <span className="text-xs text-content-muted">
          {IDENTIFY_LABEL[board.identifiedBy]}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-content-muted">port</dt>
        <dd>{board.port}</dd>
        <dt className="text-content-muted">fqbn</dt>
        <dd className={resolved ? '' : 'text-warning'}>
          {board.fqbn ?? 'unresolved — choose manually'}
        </dd>
      </dl>
      {board.notes !== null && (
        <p className="mt-3 border-t border-edge-subtle pt-2 text-xs text-content-secondary">
          {board.notes}
        </p>
      )}
    </div>
  );
}

/** §Phase 7 recovery: offer back the autosave when the last session crashed. */
function RecoveryBanner() {
  const available = useProjects((state) => state.recoveryAvailable);
  const accept = useProjects((state) => state.acceptRecovery);
  const dismiss = useProjects((state) => state.dismissRecovery);

  if (!available) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-96 rounded-lg border border-warning bg-card p-3 shadow-lg">
      <p className="text-sm font-medium">Recovered unsaved work</p>
      <p className="mt-1 text-xs text-content-secondary">
        The last session ended unexpectedly. What was on the canvas has been restored.
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => void accept()}
          className="rounded bg-interactive px-2.5 py-1 text-xs font-medium text-on-interactive"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded border border-edge px-2.5 py-1 text-xs"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<'canvas' | 'dashboard' | 'hardware'>('canvas');
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [boards, setBoards] = useState<readonly BoardCandidate[]>([]);
  const boardsRef = useRef<readonly BoardCandidate[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const layout = useLayout();
  boardsRef.current = boards;

  // ── sketch import (IMPORT.md §Phase 6) ──
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const restoreAutosave = useGraphStore((state) => state.restoreAutosave);
  const newProject = useGraphStore((state) => state.newProject);
  const loadProject = useGraphStore((state) => state.loadProject);
  const save = useGraphStore((state) => state.save);

  // Restore the last autosave once, on first mount, then start the 5s autosave
  // and crash detection (§Phase 7).
  useEffect(() => {
    restoreAutosave();
  }, [restoreAutosave]);

  useEffect(() => startProjectAutosave(), []);

  // §Phase 8: below 768px the editor is not offered at all, so a phone that
  // lands on the canvas tab is moved to the dashboard rather than shown
  // something it cannot use.
  useEffect(() => {
    if (layout.dashboardOnly && tab !== 'dashboard') setTab('dashboard');
  }, [layout.dashboardOnly, tab]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetchHealth(controller.signal)
      .then((data) => {
        if (!cancelled) setHealth({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setHealth({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reach the backend.',
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const result = await fetchBoards(controller.signal);
        if (!cancelled) setBoards(result.boards);
      } catch {
        if (!cancelled) setBoards([]);
      }
      if (cancelled) return;
      const delay = boardsRef.current.length === 0 ? DISCONNECTED_POLL_MS : CONNECTED_POLL_MS;
      timer = setTimeout(() => void poll(), delay);
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  const handleDeviceLost = useCallback(() => setBoards([]), []);

  // The binding dropdown is built from what the graph actually exposes, so it
  // cannot drift out of sync with the sketch (§Phase 6).
  const graphNodes = useGraphStore((state) => state.nodes);
  const setExposedNames = useDashboard((state) => state.setExposedNames);
  useEffect(() => {
    setExposedNames(exposedVariables(graphNodes).map((variable) => variable.name));
  }, [graphNodes, setExposedNames]);

  const exportProject = useCallback(() => {
    const project = currentProject();
    const blob = new Blob([serialize(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.meta.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'project'}.forge`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Project exported');
  }, []);

  /**
   * Every entry point — Open, paste, drop — funnels through here, so none of
   * them can skip the preview or lay out differently.
   */
  const previewSketch = useCallback(async (files: readonly ImportInputFile[], name: string) => {
    setImportOpen(true);
    setImportBusy(true);
    setImportError(null);
    setImportPreview(null);
    try {
      setImportPreview(await buildPreview(files, name));
    } catch (error: unknown) {
      setImportError(
        error instanceof Error
          ? `${name} could not be imported: ${error.message}`
          : `${name} could not be imported.`,
      );
    } finally {
      setImportBusy(false);
    }
  }, []);

  const confirmImport = useCallback(
    (target: ImportTarget) => {
      const preview = importPreview;
      if (preview === null) return;

      // A new project first, so replacing never happens by accident.
      if (target === 'new') newProject();
      useGraphStore.getState().replaceGraph([...preview.nodes], [...preview.edges], preview.name);

      setImportOpen(false);
      setImportPreview(null);
      const lifted = preview.report.patternsLifted.length;
      toast.success(
        `Imported ${preview.name}`,
        `${preview.report.native} of ${preview.report.statements} statements on native nodes` +
          (lifted > 0 ? `, ${lifted} pattern${lifted === 1 ? '' : 's'} lifted` : ''),
      );
    },
    [importPreview, newProject],
  );

  const revealNode = useCallback((nodeId: string) => {
    useGraphStore.getState().selectOnly(nodeId);
    setImportOpen(false);
  }, []);

  const importProject = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // JSON.parse reports things like "Unexpected end of JSON input",
          // which tells a user nothing about what to do. A truncated or
          // corrupted file is the common cause and worth naming outright.
          toast.error(
            'Could not open that project',
            `${file.name} is not readable as a .forge file. It looks corrupted or was not saved completely.`,
          );
          return;
        }

        const { project, warnings } = migrateWithReport(parsed);
        loadProject(project);
        if (warnings.length === 0) {
          toast.success('Project loaded', file.name);
        } else {
          // Repairs and unknown node types are never silent: the user has to
          // know the file that came back is not the file that went in.
          toast.warning(`Opened ${file.name} with warnings`, warnings.join(' '));
        }
      } catch (error: unknown) {
        toast.error(
          'Could not open that project',
          error instanceof Error
            ? error.message
            : 'That file is not readable as an ArduForge project.',
        );
      }
    },
    [loadProject],
  );

  // Drop a sketch anywhere on the editor. Bound at the root rather than on the
  // canvas so it still works while the Dashboard tab is showing.
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const file = event.dataTransfer.files[0];
      if (file === undefined) return;
      event.preventDefault();
      void (async () => {
        const text = await file.text();
        if (looksLikeSketch(file.name, text)) {
          await previewSketch([{ name: file.name, content: text }], sketchNameFrom(file.name));
        } else {
          await importProject(file);
        }
      })();
    },
    [previewSketch, importProject],
  );

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <header className="flex shrink-0 items-center gap-4 border-b border-edge-subtle bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold tracking-tight">ArduForge</h1>

        <nav className="flex gap-1">
          {(
            [
              { id: 'canvas', label: 'Canvas', Icon: Workflow },
              { id: 'dashboard', label: 'Dashboard', Icon: Gauge },
              { id: 'hardware', label: 'Hardware', Icon: Cpu },
            ] as const
          )
            .filter(({ id }) => !layout.dashboardOnly || id === 'dashboard')
            .map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                tab === id
                  ? 'bg-header text-content'
                  : 'text-content-secondary hover:bg-card'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            title="New project"
            onClick={() => {
              newProject();
              toast.info('New project started');
            }}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            title="Projects and examples"
            onClick={() => setBrowserOpen(true)}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <FolderOpen size={14} />
          </button>
          <button
            type="button"
            title="Open a .forge file"
            onClick={() => fileRef.current?.click()}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <Upload size={14} />
          </button>
          <button
            type="button"
            title="Paste Arduino code"
            onClick={() => setPasteOpen(true)}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <ClipboardPaste size={14} />
          </button>
          <button
            type="button"
            title="Save now"
            onClick={() => {
              save();
              toast.success('Saved');
            }}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <Save size={14} />
          </button>
          <button
            type="button"
            title="Export .forge file"
            onClick={exportProject}
            className="rounded p-1.5 text-content-secondary hover:bg-card"
          >
            <Download size={14} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".forge,.ino,.pde,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file === undefined) return;
              void (async () => {
                const text = await file.text();
                // One control opens both kinds; the payload decides which, so
                // the user does not have to know the difference.
                if (looksLikeSketch(file.name, text)) {
                  await previewSketch([{ name: file.name, content: text }], sketchNameFrom(file.name));
                } else {
                  await importProject(file);
                }
              })();
            }}
          />
          <span className="ml-2 flex items-center gap-1.5 text-xs text-content-secondary">
            <StatusDot tone={boards.length > 0 ? 'ok' : 'idle'} />
            {boards.length > 0 ? (boards[0]?.port ?? '') : 'No board'}
          </span>
        </div>
      </header>

      {/*
        overflow-hidden is load-bearing: without it a tall tab grows past the
        shell, the document itself scrolls, and the status bar — which sits at
        the bottom of a viewport-height shell — appears stranded mid-page.
        Each tab scrolls its own content instead.
      */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'dashboard' ? (
          <Suspense fallback={<PanelLoading label="dashboard" />}>
          <Dashboard
            targets={boards.map((board) => ({
              port: board.port,
              displayName: board.displayName,
            }))}
            fqbn={boards[0]?.fqbn ?? 'arduino:avr:uno'}
          />
          </Suspense>
        ) : tab === 'canvas' ? (
          <Suspense fallback={<PanelLoading label="canvas" />}>
          <Canvas
            targets={boards.map((board) => ({
              port: board.port,
              fqbn: board.fqbn,
              displayName: board.displayName,
            }))}
          />
          </Suspense>
        ) : (
          // The scroll container is the full-height wrapper; the max-width
          // column lives inside it, or the column bounds the scrolling instead.
          <div className="h-full overflow-auto">
          <div className="mx-auto max-w-5xl space-y-5 px-6 py-6">
            {health.status === 'error' && (
              <Panel title="Backend unreachable">
                <p className="text-sm text-error">{health.message}</p>
                <p className="mt-3 text-sm text-content-secondary">
                  Start it with <code className="font-mono">npm run dev:server</code> from the repo
                  root.
                </p>
              </Panel>
            )}

            {health.status === 'ready' && (
              <div className="grid gap-5 md:grid-cols-2">
                <Panel title="Toolchain">
                  <Row
                    label="Node"
                    value={`v${health.data.node.version}`}
                    tone={health.data.node.ok ? 'ok' : 'error'}
                  />
                  {health.data.arduinoCli.installed ? (
                    <Row
                      label="arduino-cli"
                      value={health.data.arduinoCli.version.version}
                      tone={health.data.arduinoCli.version.supported ? 'ok' : 'warn'}
                    />
                  ) : (
                    <Row label="arduino-cli" value="not installed" tone="error" />
                  )}
                  <Row
                    label={health.data.requiredCore.id}
                    value={health.data.requiredCore.version ?? 'not installed'}
                    tone={health.data.requiredCore.installed ? 'ok' : 'error'}
                  />
                </Panel>

                <Panel title={`Boards (${boards.length})`}>
                  {boards.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-sm text-content-secondary">No boards detected.</p>
                      <p className="mt-1 text-xs text-content-muted">
                        Scanning every 2s. Plug a board in and it will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {boards.map((board) => (
                        <BoardCard key={board.port} board={board} />
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            )}

            <BuildPanel
              targets={boards.map((board) => ({
                port: board.port,
                fqbn: board.fqbn,
                displayName: board.displayName,
              }))}
            />

            <SerialMonitor
              boards={boards.map((board) => ({ port: board.port, displayName: board.displayName }))}
              onDeviceLost={handleDeviceLost}
            />
          </div>
          </div>
        )}
      </main>

      <StatusBar
        port={boards[0]?.port ?? null}
        boardName={boards[0]?.displayName ?? null}
        breakpoint={layout.breakpoint}
      />

      <ShortcutOverlay />
      <FirstRunTour />

      {browserOpen && (
        <Suspense fallback={null}>
          <ProjectBrowser onClose={() => setBrowserOpen(false)} />
        </Suspense>
      )}
      {importOpen ? (
        <ImportDialog
          preview={importPreview}
          busy={importBusy}
          error={importError}
          onConfirm={confirmImport}
          onCancel={() => {
            setImportOpen(false);
            setImportPreview(null);
          }}
          onReveal={revealNode}
          canReveal={false}
        />
      ) : null}

      {pasteOpen ? (
        <PasteDialog
          onCancel={() => setPasteOpen(false)}
          onImport={(source) => {
            setPasteOpen(false);
            void previewSketch([{ name: 'Pasted.ino', content: source }], sketchNameFrom(null));
          }}
        />
      ) : null}

      <RecoveryBanner />
      <Toasts />
    </div>
  );
}
