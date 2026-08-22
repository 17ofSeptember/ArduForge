import { useEffect } from 'react';

export interface MenuItem {
  readonly label: string;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed z-50 min-w-48 overflow-hidden rounded-md border border-edge bg-card py-1 shadow-2xl"
      style={{ top: state.y, left: state.x }}
      onClick={(event) => event.stopPropagation()}
      role="menu"
    >
      {state.items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          disabled={item.disabled === true}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs hover:bg-header disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: item.danger === true ? 'var(--feedback-destructive)' : undefined }}
        >
          {item.label}
          {item.shortcut !== undefined && (
            <span className="font-mono text-[10px] text-content-muted">
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
