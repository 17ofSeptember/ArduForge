import { useEffect, useMemo, useRef, useState } from 'react';
import { searchDefs } from '@/nodes/registry';
import { CATEGORY, type NodeDef } from '@/nodes/types';

/**
 * Shared node chooser. Backs both the ⌘K command palette and the
 * drag-from-port-to-empty-canvas picker, which differ only in their filter.
 */
export function NodePicker({
  title,
  filter,
  onPick,
  onClose,
  anchor,
}: {
  title: string;
  /** When present, only defs satisfying it are offered. */
  filter?: (def: NodeDef) => boolean;
  onPick: (defId: string) => void;
  onClose: () => void;
  /** Screen coordinates to anchor at; centred when absent. */
  anchor?: { x: number; y: number };
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const found = searchDefs(query);
    return filter === undefined ? found : found.filter(filter);
  }, [query, filter]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const style =
    anchor === undefined
      ? { top: '18%', left: '50%', transform: 'translateX(-50%)' }
      : { top: anchor.y, left: anchor.x };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} role="presentation" />
      <div
        className="fixed z-50 w-96 overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
        style={style}
      >
        <div className="border-b border-edge-subtle px-3 py-2">
          <p className="mb-1.5 text-[10px] tracking-[0.12em] text-content-muted uppercase">
            {title}
          </p>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const chosen = results[active];
                if (chosen !== undefined) onPick(chosen.id);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Search nodes…"
            className="w-full bg-transparent text-sm"
          />
        </div>

        <ul ref={listRef} className="max-h-80 overflow-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-content-muted">
              No matching nodes.
              {filter !== undefined && (
                <span className="mt-1 block">Only type-compatible nodes are shown here.</span>
              )}
            </li>
          ) : (
            results.map((def, index) => {
              const category = CATEGORY[def.category];
              const Icon = def.icon;
              return (
                <li key={def.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onPick(def.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                      index === active ? 'bg-header' : ''
                    }`}
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded"
                      style={{ backgroundColor: category.color }}
                    >
                      <Icon size={12} className="text-on-semantic/80" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{def.label}</span>
                      <span className="block truncate text-[11px] text-content-muted">
                        {def.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-content-muted">
                      {category.label}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </>
  );
}
