import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/** The full keyboard map (BUILD_PLAN.md §Phase 8), opened with `?`. */
const GROUPS: readonly { title: string; items: readonly [string, string][] }[] = [
  {
    title: 'Canvas',
    items: [
      ['⌘K', 'Add a node'],
      ['⌘F', 'Find a node'],
      ['⌘Z', 'Undo'],
      ['⇧⌘Z', 'Redo'],
      ['⌘C / ⌘V', 'Copy / paste'],
      ['⌘D', 'Duplicate selection'],
      ['⌫', 'Delete selection'],
    ],
  },
  {
    title: 'Navigation',
    items: [
      ['Scroll', 'Zoom'],
      ['Space + drag', 'Pan'],
      ['Middle drag', 'Pan'],
      ['Drag on empty', 'Marquee select'],
      ['⇧ + click', 'Add to selection'],
      ['Double-click edge', 'Add reroute point'],
      ['Right-click', 'Context menu'],
    ],
  },
  {
    title: 'General',
    items: [
      ['?', 'This overlay'],
      ['Esc', 'Close overlay or menu'],
    ],
  },
];

export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      // Never steal `?` from someone typing a question mark into a field.
      if (typing || event.metaKey || event.ctrlKey) return;
      if (event.key === '?') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-scrim"
        onClick={() => setOpen(false)}
        role="presentation"
      />
      <div className="fixed top-1/2 left-1/2 z-50 w-[min(46rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded p-1 text-content-muted hover:bg-card"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                {group.title}
              </p>
              <dl className="space-y-1.5">
                {group.items.map(([keys, description]) => (
                  <div key={keys} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0">
                      <kbd className="rounded border border-edge bg-card px-1.5 py-0.5 font-mono text-[10px]">
                        {keys}
                      </kbd>
                    </dt>
                    <dd className="text-right text-[11px] text-content-secondary">
                      {description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-edge-subtle pt-3 text-[11px] text-content-muted">
          Press <kbd className="font-mono">?</kbd> any time to bring this back.
        </p>
      </div>
    </>
  );
}
