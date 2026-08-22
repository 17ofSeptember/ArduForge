import { useEffect, useState } from 'react';
import { Copy, FilePlus2, FolderOpen, Pencil, Trash2, X } from 'lucide-react';
import { useProjects } from '@/store/projectManager';
import { examples } from '@/examples';
import { toast } from '@/ui/toast';

/**
 * Project browser and example gallery (BUILD_PLAN.md §Phase 7).
 * Examples open with their graph, their dashboard, a parts list, and a wiring
 * diagram, so a beginner has something that works before they build anything.
 */
export function ProjectBrowser({ onClose }: { onClose: () => void }) {
  const projects = useProjects();
  // Selected separately from the store object above: zustand actions keep a
  // stable identity, so the effect can name its real dependency instead of
  // claiming it has none. Depending on `projects` would refetch on every
  // store change, because this component subscribes to the whole store.
  const refresh = useProjects((state) => state.refresh);
  const [tab, setTab] = useState<'projects' | 'examples'>('examples');
  const [openExampleId, setOpenExampleId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const example = examples.find((candidate) => candidate.id === openExampleId) ?? null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim" onClick={onClose} role="presentation" />
      <div className="fixed inset-8 z-50 flex overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl">
        <div className="flex w-44 shrink-0 flex-col border-r border-edge-subtle p-3">
          <p className="mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
            Library
          </p>
          {(
            [
              { id: 'examples', label: 'Examples' },
              { id: 'projects', label: 'My projects' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setOpenExampleId(null);
              }}
              className={`rounded px-2 py-1.5 text-left text-xs ${
                tab === item.id
                  ? 'bg-header'
                  : 'text-content-secondary hover:bg-card'
              }`}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              void projects.newProject().then(() => {
                toast.success('New project started');
                onClose();
              });
            }}
            className="mt-auto flex items-center justify-center gap-1.5 rounded bg-interactive px-2 py-1.5 text-xs font-medium text-on-interactive"
          >
            <FilePlus2 size={12} /> New project
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 rounded p-1 text-content-muted hover:bg-card"
          >
            <X size={16} />
          </button>

          {tab === 'projects' ? (
            <>
              <h2 className="mb-3 text-sm font-semibold">My projects</h2>
              {projects.records.length === 0 ? (
                <p className="text-xs text-content-muted">
                  Nothing saved yet. Open an example or start a new project.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {projects.records.map((record) => (
                    <li
                      key={record.id}
                      className="flex items-center gap-2 rounded border border-edge-subtle bg-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{record.name}</p>
                        <p className="text-[10px] text-content-muted">
                          {new Date(record.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Open"
                        onClick={() => {
                          void projects.openProject(record.id).then(() => {
                            toast.success('Project opened', record.name);
                            onClose();
                          });
                        }}
                        className="rounded p-1 text-content-secondary hover:bg-header"
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        type="button"
                        title="Rename"
                        onClick={() => {
                          const name = window.prompt('Project name', record.name);
                          if (name !== null && name.trim() !== '') {
                            void projects.renameProject(record.id, name.trim());
                          }
                        }}
                        className="rounded p-1 text-content-secondary hover:bg-header"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        title="Duplicate"
                        onClick={() => void projects.duplicateProject(record.id)}
                        className="rounded p-1 text-content-secondary hover:bg-header"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => {
                          if (window.confirm(`Delete "${record.name}"? This cannot be undone.`)) {
                            void projects.deleteProject(record.id);
                          }
                        }}
                        className="rounded p-1 text-error hover:bg-header"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : example !== null ? (
            <>
              <button
                type="button"
                onClick={() => setOpenExampleId(null)}
                className="mb-3 text-[11px] text-content-secondary hover:text-content"
              >
                ← All examples
              </button>
              <h2 className="text-base font-semibold">{example.name}</h2>
              <p className="mt-1 mb-4 max-w-2xl text-sm text-content-secondary">
                {example.description}
              </p>

              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                    Wiring
                  </p>
                  <div
                    className="overflow-x-auto rounded border border-edge-subtle p-2"
                    // The diagram is generated by our own wiringDiagram(), never
                    // from user or network input.
                    dangerouslySetInnerHTML={{ __html: example.wiring }}
                  />
                </div>
                <div>
                  <p className="mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                    Parts
                  </p>
                  <ul className="space-y-2">
                    {example.parts.map((part) => (
                      <li
                        key={part.name}
                        className="rounded border border-edge-subtle bg-card p-2.5"
                      >
                        <p className="text-xs font-medium">{part.name}</p>
                        <p className="mt-0.5 text-[11px] text-content-secondary">
                          {part.detail}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  void projects.openExample(example.id).then(() => {
                    toast.success('Example opened', example.name);
                    onClose();
                  });
                }}
                className="mt-5 rounded bg-interactive px-3 py-1.5 text-xs font-medium text-on-interactive"
              >
                Open this example
              </button>
            </>
          ) : (
            <>
              <h2 className="mb-1 text-sm font-semibold">Examples</h2>
              <p className="mb-3 text-xs text-content-muted">
                Each one opens with a wired graph, a dashboard, and a parts list.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {examples.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOpenExampleId(item.id)}
                    className="rounded-lg border border-edge-subtle bg-card p-3 text-left hover:border-edge hover:bg-header"
                  >
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="mt-1 line-clamp-3 text-[11px] text-content-secondary">
                      {item.description}
                    </p>
                    <p className="mt-2 text-[10px] text-content-muted">
                      {item.parts.length} part{item.parts.length === 1 ? '' : 's'}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
