import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts, type ToastLevel } from '@/ui/toast';

const STYLE: Record<ToastLevel, { color: string; Icon: typeof Info }> = {
  info: { color: 'var(--feedback-info)', Icon: Info },
  success: { color: 'var(--feedback-success)', Icon: CheckCircle2 },
  warning: { color: 'var(--feedback-warning)', Icon: AlertTriangle },
  error: { color: 'var(--feedback-destructive)', Icon: XCircle },
};

export function Toasts() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((item) => {
        const { color, Icon } = STYLE[item.level];
        return (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto flex gap-2.5 rounded-lg border bg-card p-3 shadow-lg"
            style={{ borderColor: color }}
          >
            <Icon size={16} style={{ color }} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.message}</p>
              {item.detail !== undefined && (
                <p className="mt-0.5 text-xs text-content-secondary">{item.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              className="shrink-0 text-content-muted hover:text-content"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
