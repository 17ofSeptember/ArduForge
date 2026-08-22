/**
 * Numeric type mode, shared by every arithmetic and bitwise node.
 *
 * The registry used to type all arithmetic as `float`, which meant a graph
 * computing `a + b` from two int inputs emitted `((float)(a) + (float)(b))`.
 * On an AVR with no FPU that is wrong for every user: it pulls in soft-float,
 * costs flash and cycles, and removes the 16-bit overflow the sketch may well
 * depend on.
 *
 * The mode defaults to `float`, which reproduces the old behaviour exactly, so
 * no saved project changes its output.
 *
 * `long` exists because `int` is 16 bits on AVR: `dev1 * dev1` overflows above
 * 181. Widening only the *first* operand is deliberate and sufficient — C++
 * promotes the whole expression to the wider type, so `((long)(a) * (b))` is
 * 32-bit arithmetic, while casting the result instead would truncate first and
 * widen the already-wrong answer.
 */
import type { LiteralSpec, LiteralValue, PortDef, PortType } from '@/nodes/types';

export type NumericMode = 'int' | 'long' | 'float';

export const NUMERIC_MODES = [
  { value: 'float', label: 'decimal' },
  { value: 'int', label: 'whole number (16-bit)' },
  { value: 'long', label: 'whole number (32-bit)' },
] as const;

export function numericMode(config: Readonly<Record<string, LiteralValue>>): NumericMode {
  const raw = String(config['numericType'] ?? 'float');
  return raw === 'int' || raw === 'long' ? raw : 'float';
}

/** Ports are int for both integer modes; only `float` risks a cast. */
export function numericPortType(mode: NumericMode): PortType {
  return mode === 'float' ? 'float' : 'int';
}

/** The literal editor, matching what the fixed-type ports used before. */
function numericLiteral(mode: NumericMode, def: number): LiteralSpec {
  return mode === 'float'
    ? { kind: 'number', default: def }
    : { kind: 'number', default: def, integer: true };
}

export function numericIn(id: string, label: string, mode: NumericMode, def = 0): PortDef {
  return { id, label, type: numericPortType(mode), literal: numericLiteral(mode, def) };
}

export function numericOut(mode: NumericMode, label = 'Result'): PortDef {
  return { id: 'out', label, type: numericPortType(mode) };
}

/**
 * Widens an expression to 32 bits when the mode calls for it. Applied to the
 * left operand only; C++ promotion carries the rest.
 */
export function widen(mode: NumericMode, expression: string): string {
  return mode === 'long' ? `(long)${expression}` : expression;
}

export const NUMERIC_FIELD = {
  kind: 'select',
  id: 'numericType',
  label: 'Number type',
  default: 'float',
  options: NUMERIC_MODES,
} as const;

/**
 * The same field for nodes where the integer modes are the meaningful ones.
 * Defaulting to `int` here matches what these nodes already were, so their
 * output does not move either.
 */
export const NUMERIC_FIELD_INT = {
  kind: 'select',
  id: 'numericType',
  label: 'Number type',
  default: 'int',
  options: NUMERIC_MODES,
} as const;
