import { useEffect, useState } from 'react';
import { telemetry } from '@/dashboard/telemetry';
import type { Binding } from '@/dashboard/model';

/** The telemetry series a binding reads from, or null if it is write-only. */
export function bindingKey(binding: Binding): string | null {
  if (binding.kind === 'var') return binding.name;
  if (binding.kind === 'pin') return `pin${binding.pin}`;
  return null;
}

/**
 * Subscribes one widget to one value.
 *
 * This is the only place telemetry reaches React state, and it is per-widget:
 * a frame that changes two of twenty values re-renders two widgets, not the
 * tree (§Phase 6).
 */
export function useBoundValue(binding: Binding): number | null {
  const key = bindingKey(binding);
  const [value, setValue] = useState<number | null>(() => (key === null ? null : telemetry.latest(key)));

  useEffect(() => {
    if (key === null) {
      setValue(null);
      return;
    }
    return telemetry.subscribe(key, setValue);
  }, [key]);

  return value;
}
