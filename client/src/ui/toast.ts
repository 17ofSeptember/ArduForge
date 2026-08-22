/**
 * Toast store (BUILD_PLAN.md §Phase 8: distinct treatments per level, and
 * errors persist until dismissed).
 */
import { create } from 'zustand';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: number;
  readonly level: ToastLevel;
  readonly message: string;
  readonly detail?: string;
}

const AUTO_DISMISS_MS: Record<ToastLevel, number | null> = {
  info: 3_500,
  success: 3_000,
  warning: 6_000,
  // Errors stay until the user dismisses them.
  error: null,
};

const MAX_TOASTS = 5;

interface ToastState {
  toasts: readonly Toast[];
  push(level: ToastLevel, message: string, detail?: string): void;
  dismiss(id: number): void;
  clear(): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push(level, message, detail) {
    const id = nextId;
    nextId += 1;
    const toast: Toast = detail === undefined ? { id, level, message } : { id, level, message, detail };

    set((state) => {
      const next = [...state.toasts, toast];
      return { toasts: next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next };
    });

    const timeout = AUTO_DISMISS_MS[level];
    if (timeout !== null) {
      setTimeout(() => get().dismiss(id), timeout);
    }
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear() {
    set({ toasts: [] });
  },
}));

export const toast = {
  info: (message: string, detail?: string) => useToasts.getState().push('info', message, detail),
  success: (message: string, detail?: string) => useToasts.getState().push('success', message, detail),
  warning: (message: string, detail?: string) => useToasts.getState().push('warning', message, detail),
  error: (message: string, detail?: string) => useToasts.getState().push('error', message, detail),
};
