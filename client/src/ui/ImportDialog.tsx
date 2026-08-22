/**
 * Import preview and report (IMPORT.md §Phase 6).
 *
 * Three entry points feed this — Open, paste, drop — and none of them may
 * replace the current project without passing through here. That is the whole
 * point of the dialog: an import that silently overwrites work is worse than no
 * import, and "import into a new project" has to be one click away rather than
 * something the user thinks of afterwards.
 *
 * The report is the trust anchor. A user who can see how much of their sketch
 * became real nodes, what was kept as Custom C++, and which lines carry a
 * warning will believe the graph. One who cannot is guessing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Code2, FileCode2, Info, X } from 'lucide-react';
import type { ImportPreview } from '@/import/importFlow';

export type ImportTarget = 'replace' | 'new';

interface Props {
  readonly preview: ImportPreview | null;
  /** Set while the importer is running, so the dialog can say so. */
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConfirm: (target: ImportTarget) => void;
  readonly onCancel: () => void;
  /**
   * Selects and centres a node on the canvas. Only meaningful once the graph
   * has been committed — a preview's nodes are not on the canvas yet.
   */
  readonly onReveal: (nodeId: string) => void;
  /** False while previewing, because nothing is on the canvas to reveal. */
  readonly canReveal: boolean;
}

export function ImportDialog({ preview, busy, error, onConfirm, onCancel, onReveal, canReveal }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const coverage = useMemo(() => {
    if (preview === null) return 0;
    const { native, raw } = preview.report;
    const total = native + raw;
    return total === 0 ? 0 : Math.round((native / total) * 100);
  }, [preview]);

  const blocking = preview?.problems.filter((problem) => problem.severity === 'error') ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import sketch"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-edge-subtle bg-panel shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-4 py-3">
          <FileCode2 size={16} className="text-content-secondary" />
          <h2 className="text-sm font-semibold">
            {busy ? 'Reading sketch…' : preview === null ? 'Import sketch' : `Import ${preview.name}`}
          </h2>
          <button
            ref={closeRef}
            type="button"
            title="Cancel"
            onClick={onCancel}
            className="ml-auto rounded p-1 text-content-secondary hover:bg-card"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {error !== null ? (
            <p className="text-sm text-error">{error}</p>
          ) : busy || preview === null ? (
            <p className="text-sm text-content-secondary">Parsing and laying out the graph…</p>
          ) : (
            <Report preview={preview} coverage={coverage} onReveal={onReveal} canReveal={canReveal} />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-edge-subtle px-4 py-3">
          {blocking.length > 0 ? (
            <span className="text-xs text-error">
              {blocking.length} problem{blocking.length === 1 ? '' : 's'} would stop this generating.
            </span>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm hover:bg-card">
              Cancel
            </button>
            {/* Offered first, and by name, because replacing the open project
                is the destructive option and should never be the reflex. */}
            <button
              type="button"
              disabled={preview === null}
              onClick={() => onConfirm('new')}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
            >
              Import into a new project
            </button>
            <button
              type="button"
              disabled={preview === null}
              onClick={() => onConfirm('replace')}
              className="rounded border border-edge-subtle px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Replace this project
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Report({
  preview,
  coverage,
  onReveal,
  canReveal,
}: {
  preview: ImportPreview;
  coverage: number;
  onReveal: (nodeId: string) => void;
  canReveal: boolean;
}) {
  const { report } = preview;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span>
          <strong>{report.statements}</strong> statements
        </span>
        <span>
          <strong>{report.native}</strong> native ({coverage}%)
        </span>
        <span>
          <strong>{report.raw}</strong> Custom C++
        </span>
      </div>

      {report.patternsLifted.length > 0 ? (
        <Line label="Patterns lifted">{report.patternsLifted.join(', ')}</Line>
      ) : null}
      {report.componentsLifted.length > 0 ? (
        <Line label="Components lifted">{report.componentsLifted.join(', ')}</Line>
      ) : null}

      {report.wholeFileFallback ? (
        <p className="flex gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs">
          <Info size={14} className="mt-0.5 shrink-0" />
          This sketch could not be parsed, so it was imported whole as one Custom C++ block. Nothing was lost, and it
          will still generate and compile.
        </p>
      ) : null}

      {report.warnings.length > 0 ? (
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-content-secondary">
            <AlertTriangle size={13} /> {report.warnings.length} warning
            {report.warnings.length === 1 ? '' : 's'}
          </h3>
          <ul className="flex flex-col gap-1">
            {report.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex gap-2 text-xs">
                <button
                  type="button"
                  disabled={!canReveal || warning.nodeId === null}
                  onClick={() => {
                    if (warning.nodeId !== null) onReveal(warning.nodeId);
                  }}
                  className="shrink-0 font-mono text-content-secondary underline-offset-2 hover:underline disabled:no-underline"
                >
                  line {warning.line}
                </button>
                <span className="text-content-secondary">{warning.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {preview.rawNodeIds.length > 0 ? (
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-content-secondary">
            <Code2 size={13} /> {preview.rawNodeIds.length} kept as Custom C++
          </h3>
          {/* Click-through needs the nodes to exist, which they do not until the
              import is confirmed. Buttons that silently do nothing are worse
              than ones that say why, so they are disabled with a note. */}
          <div className="flex flex-wrap gap-1">
            {preview.rawNodeIds.map((id, index) => (
              <button
                key={id}
                type="button"
                disabled={!canReveal}
                onClick={() => onReveal(id)}
                className="rounded border border-edge-subtle px-1.5 py-0.5 font-mono text-[11px] text-content-secondary enabled:hover:bg-card disabled:opacity-70"
              >
                #{index + 1}
              </button>
            ))}
          </div>
          {!canReveal ? (
            <p className="mt-1 text-[11px] text-content-muted">
              These become selectable on the canvas once the import is confirmed.
            </p>
          ) : null}
        </section>
      ) : null}

      <details className="rounded border border-edge-subtle">
        <summary className="cursor-pointer px-2 py-1 text-xs text-content-secondary">
          Regenerated sketch ({preview.regenerated.split('\n').length} lines)
        </summary>
        <pre className="max-h-64 overflow-auto px-2 pb-2 font-mono text-[11px] leading-relaxed">
          {preview.regenerated}
        </pre>
      </details>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-xs">
      <span className="text-content-secondary">{label}: </span>
      {children}
    </p>
  );
}

/** The paste dialog: C++ in, preview out. */
export function PasteDialog({
  onImport,
  onCancel,
}: {
  readonly onImport: (source: string) => void;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    areaRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paste sketch"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-edge-subtle bg-panel p-4 shadow-2xl">
        <h2 className="text-sm font-semibold">Paste Arduino code</h2>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          placeholder={'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n}'}
          className="h-64 w-full resize-none rounded border border-edge-subtle bg-card p-2 font-mono text-xs"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm hover:bg-card">
            Cancel
          </button>
          <button
            type="button"
            disabled={text.trim() === ''}
            onClick={() => onImport(text)}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
          >
            Preview import
          </button>
        </div>
      </div>
    </div>
  );
}
