/**
 * Preprocessor directive classification (IMPORT.md §Phase 1).
 *
 * Two rules here exist to stop the importer from being clever, and both matter
 * more than they look:
 *
 * **Macros are never expanded.** An object-like `#define` of a literal becomes a
 * Declare Variable flagged `emitAsDefine`; a function-like macro becomes a Raw
 * Global. Expanding either would make the regenerated sketch diverge visibly
 * from the original even where it compiles identically, and the user would find
 * their constants inlined everywhere with no way back.
 *
 * **Conditionals are never evaluated.** An `#ifdef` block, directives included,
 * becomes one Raw Global. Resolving it needs the full build configuration, and
 * guessing produces a sketch that behaves differently on someone else's board —
 * a failure that shows up as hardware behaviour, not as a compile error.
 */
import type { TsNode } from '@/import/grammar';

export type DirectiveKind =
  /** Object-like #define of a literal — becomes a Declare Variable. */
  | 'define-literal'
  /** Object-like #define of anything else — Raw Global. */
  | 'define-expression'
  /** Function-like macro — Raw Global. */
  | 'define-function'
  /** #if / #ifdef / #ifndef block, entire — Raw Global. */
  | 'conditional'
  | 'include'
  | 'other';

export interface Directive {
  readonly kind: DirectiveKind;
  readonly name: string | null;
  /** Raw replacement text for a #define, exactly as written. */
  readonly value: string | null;
  /** The whole directive, verbatim, including the leading #. */
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startRow: number;
}

const CONDITIONALS = new Set(['preproc_if', 'preproc_ifdef', 'preproc_elif', 'preproc_else']);

/**
 * Arduino constants that are literals as far as a user is concerned. §Phase 3
 * requires the original notation preserved — a user who wrote `A0` must not get
 * `14` back — so these are classified as literals rather than expressions.
 */
const CONSTANT_IDENTIFIERS = new Set([
  'HIGH',
  'LOW',
  'INPUT',
  'OUTPUT',
  'INPUT_PULLUP',
  'LED_BUILTIN',
  'true',
  'false',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
]);

const LITERAL_TYPES = new Set([
  'number_literal',
  'string_literal',
  'char_literal',
  'true',
  'false',
  'concatenated_string',
]);

/**
 * Top-level directives only. A directive nested inside a conditional belongs to
 * that conditional's Raw Global and must not be lifted out of it — doing so
 * would apply it unconditionally.
 */
export function classifyDirectives(root: TsNode): Directive[] {
  const found: Directive[] = [];

  for (let i = 0; i < root.childCount; i += 1) {
    const node = root.child(i);
    if (node === null) continue;

    const base = {
      text: node.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      startRow: node.startPosition.row,
    };

    if (CONDITIONALS.has(node.type)) {
      found.push({ ...base, kind: 'conditional', name: null, value: null });
      continue;
    }

    if (node.type === 'preproc_include') {
      const path = node.childForFieldName('path');
      found.push({ ...base, kind: 'include', name: path?.text ?? null, value: null });
      continue;
    }

    if (node.type === 'preproc_function_def') {
      const name = node.childForFieldName('name');
      found.push({ ...base, kind: 'define-function', name: name?.text ?? null, value: null });
      continue;
    }

    if (node.type === 'preproc_def') {
      const name = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      const text = value?.text.trim() ?? '';
      found.push({
        ...base,
        kind: isLiteralValue(value, text) ? 'define-literal' : 'define-expression',
        name: name?.text ?? null,
        value: text === '' ? null : text,
      });
      continue;
    }

    if (node.type.startsWith('preproc_')) {
      found.push({ ...base, kind: 'other', name: null, value: null });
    }
  }

  return found;
}

/**
 * A value is a literal only if it is a *single* token. `#define THRESHOLD 512`
 * qualifies; `#define AREA (W * H)` does not, because turning that into a
 * variable would change when it is evaluated.
 */
function isLiteralValue(value: TsNode | null, text: string): boolean {
  if (value === null || text === '') return false;
  // preproc_arg is unparsed replacement text, so fall back to inspecting it.
  if (value.type === 'preproc_arg') {
    if (/^-?\d+(\.\d+)?[uUlLfF]*$/.test(text)) return true;
    if (/^0[xXbB][0-9a-fA-F]+[uUlL]*$/.test(text)) return true;
    if (/^"([^"\\]|\\.)*"$/.test(text)) return true;
    if (/^'([^'\\]|\\.)'$/.test(text)) return true;
    return CONSTANT_IDENTIFIERS.has(text);
  }
  if (LITERAL_TYPES.has(value.type)) return true;
  if (value.type === 'identifier') return CONSTANT_IDENTIFIERS.has(text);
  return false;
}
