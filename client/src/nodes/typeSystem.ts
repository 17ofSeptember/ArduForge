/**
 * Port compatibility (BUILD_PLAN.md §Phase 3).
 *
 * "The port/type system is the thing that makes this tool trustworthy" (§6), so
 * every rejection carries a reason the UI can show verbatim. Silent refusals
 * teach the user nothing.
 */
import type { PortType } from '@/nodes/types';

/** Implicit casts allowed by §Phase 3. Everything else is rejected at connect time. */
const IMPLICIT_CASTS: Readonly<Record<PortType, readonly PortType[]>> = {
  // pin is an int subtype, so it flows anywhere an int does.
  pin: ['int', 'float', 'bool', 'string', 'any'],
  int: ['float', 'bool', 'string', 'pin', 'any'],
  bool: ['int', 'float', 'string', 'any'],
  float: ['string', 'any'],
  string: ['any'],
  any: ['bool', 'int', 'float', 'string', 'pin', 'any'],
  exec: [],
};

const TYPE_LABEL: Record<PortType, string> = {
  exec: 'execution',
  bool: 'boolean',
  int: 'integer',
  float: 'float',
  string: 'string',
  pin: 'pin',
  any: 'any',
};

export type ConnectVerdict =
  | { ok: true; cast: 'none' | 'implicit' }
  | { ok: false; reason: string };

export function canConnectTypes(from: PortType, to: PortType): ConnectVerdict {
  if (from === 'exec' || to === 'exec') {
    if (from === 'exec' && to === 'exec') return { ok: true, cast: 'none' };
    return {
      ok: false,
      reason: 'Execution and data ports cannot be connected to each other.',
    };
  }

  if (from === to) return { ok: true, cast: 'none' };

  if (IMPLICIT_CASTS[from].includes(to)) {
    return { ok: true, cast: 'implicit' };
  }

  return {
    ok: false,
    reason: `A ${TYPE_LABEL[from]} output cannot feed a ${TYPE_LABEL[to]} input. Convert it first.`,
  };
}

/** Human-readable note for why a value changes shape across an edge. */
export function castNote(from: PortType, to: PortType): string | null {
  if (from === to) return null;
  const verdict = canConnectTypes(from, to);
  if (!verdict.ok || verdict.cast === 'none') return null;

  if (to === 'string') return 'wrapped in String()';
  if (from === 'bool' && (to === 'int' || to === 'float')) return 'true becomes 1, false becomes 0';
  if ((from === 'int' || from === 'pin') && to === 'bool') return 'non-zero becomes true';
  if ((from === 'int' || from === 'pin') && to === 'float') return 'widened to float';
  return null;
}

export function typeLabel(type: PortType): string {
  return TYPE_LABEL[type];
}
