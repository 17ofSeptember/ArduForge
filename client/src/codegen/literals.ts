/**
 * Literal values to C++ (BUILD_PLAN.md §Phase 4).
 *
 * The port's TYPE decides the shape, not the editor widget: a select on a
 * string port must be quoted, the same select on a pin port must not be, or it
 * would emit "A0" where A0 was meant.
 */
import type { LiteralSpec, LiteralValue, PortType } from '@/nodes/types';

export function escapeCppString(value: string): string {
  let out = '';
  for (const char of value) {
    switch (char) {
      case '\\':
        out += '\\\\';
        break;
      case '"':
        out += '\\"';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out += char;
    }
  }
  return `"${out}"`;
}

/** A float literal must carry a decimal point, or C++ does integer division. */
export function formatFloat(value: number): string {
  if (!Number.isFinite(value)) return '0.0f';
  return Number.isInteger(value) ? `${value}.0f` : `${value}f`;
}

export function formatInt(value: number): string {
  return String(Math.round(value));
}

export function literalToCpp(
  spec: LiteralSpec | undefined,
  raw: LiteralValue | undefined,
  portType: PortType,
): string {
  const value = raw ?? spec?.default;

  if (value === undefined) {
    // Validation should have caught this long before codegen runs.
    return portType === 'string' ? '""' : '0';
  }

  if (typeof value === 'boolean') {
    if (spec?.kind === 'boolean') {
      return value ? (spec.cppTrue ?? 'true') : (spec.cppFalse ?? 'false');
    }
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (portType === 'float') return formatFloat(value);
    if (portType === 'string') return escapeCppString(String(value));
    return formatInt(value);
  }

  // Strings on a non-string port are symbolic constants (A0, INPUT_PULLUP),
  // which must be emitted bare.
  return portType === 'string' ? escapeCppString(value) : value;
}

/** Wraps `expr` so a value of type `from` is usable where `to` is expected. */
export function applyCast(expr: string, from: PortType, to: PortType): string {
  if (from === to) return expr;
  if (to === 'string' && from !== 'string') return `String(${expr})`;
  if (to === 'float' && (from === 'int' || from === 'pin' || from === 'bool')) {
    return `(float)(${expr})`;
  }
  return expr;
}
