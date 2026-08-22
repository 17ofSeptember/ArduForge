/**
 * Structural fallback boundaries (IMPORT.md §Phase 1 amendment C).
 *
 * IMPORT.md's original smallest-unit rule assumed an ERROR node's own extent is
 * a usable boundary. Phase 0 proved it is not: inside a function body the span
 * is exact, but at top level it bleeds forward and swallows the next
 * declaration's header, leaving an orphaned fragment behind it.
 *
 * So a boundary is never read off the ERROR's span. Instead:
 *
 *   1. Walk *up* from the ERROR to the nearest ancestor whose parent is a
 *      container that holds statements or declarations. That ancestor is the
 *      anchor, and its extent — not the ERROR's — starts the region. This is
 *      what turns an error buried in an expression into "replace the whole
 *      enclosing statement", which is the smallest thing that is still
 *      emittable C++.
 *
 *   2. Extend forward over following siblings for as long as they are not
 *      themselves well-formed legal boundaries. That is what absorbs the
 *      orphaned `{ delay(1); }` left behind by a bled top-level ERROR — emitting
 *      that fragment on its own would be broken code — and what makes the
 *      region stop at the next clean declaration.
 *
 * What counts as a legal boundary depends on the container, which is the whole
 * reason this is structural: a bare compound_statement is a fine boundary inside
 * a function body and an orphan at file scope.
 */
import type { TsNode } from '@/import/grammar';

export type BoundaryKind = 'statement' | 'declaration';

export interface FallbackRegion {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly kind: BoundaryKind;
  /** 0-based rows, for warnings that point back at the user's file. */
  readonly startRow: number;
  readonly endRow: number;
}

/** Containers whose children are declarations. */
const DECLARATION_CONTAINERS = new Set([
  'translation_unit',
  'declaration_list',
  'field_declaration_list',
  'linkage_specification',
  'namespace_definition',
]);

/** Containers whose children are statements. */
const STATEMENT_CONTAINERS = new Set(['compound_statement', 'case_statement']);

const DECLARATION_TYPES = new Set([
  'function_definition',
  'declaration',
  'type_definition',
  'struct_specifier',
  'class_specifier',
  'enum_specifier',
  'union_specifier',
  'template_declaration',
  'namespace_definition',
  'using_declaration',
  'alias_declaration',
  'linkage_specification',
  'field_declaration',
  'preproc_include',
  'preproc_def',
  'preproc_function_def',
  'preproc_if',
  'preproc_ifdef',
  'preproc_else',
  'preproc_elif',
  'preproc_call',
  'comment',
]);

const STATEMENT_TYPES = new Set([
  'expression_statement',
  'compound_statement',
  'if_statement',
  'for_statement',
  'for_range_loop',
  'while_statement',
  'do_statement',
  'switch_statement',
  'case_statement',
  'return_statement',
  'break_statement',
  'continue_statement',
  'goto_statement',
  'labeled_statement',
  'declaration',
  'try_statement',
  'comment',
  'preproc_if',
  'preproc_ifdef',
  'preproc_def',
  'preproc_call',
]);

function containerKind(node: TsNode | null): BoundaryKind | null {
  if (node === null) return null;
  if (DECLARATION_CONTAINERS.has(node.type)) return 'declaration';
  if (STATEMENT_CONTAINERS.has(node.type)) return 'statement';
  return null;
}

/**
 * Whether a node is a structural unit of the kind its container holds.
 *
 * Deliberately a *type* test and not a well-formedness test. Amendment C says
 * "cut at the next well-formed sibling declaration", but taken strictly that
 * merges two independent failures into one region: two malformed functions in a
 * row would become a single Raw node spanning both, which contradicts the
 * smallest-unit principle this all exists to serve.
 *
 * Cutting on type instead is safe because it costs nothing in output fidelity —
 * adjacent regions are emitted in source order and reproduce the same bytes as
 * one merged region would — while keeping each failure its own node. A sibling
 * that is a declaration but broken simply gets its own region from its own
 * error.
 */
function isLegalBoundary(node: TsNode, kind: BoundaryKind): boolean {
  if (node.isMissing) return false;
  return kind === 'declaration' ? DECLARATION_TYPES.has(node.type) : STATEMENT_TYPES.has(node.type);
}

/**
 * The ERROR itself, or the smallest ancestor sitting directly inside a
 * statement/declaration container. Returns null if no such container exists,
 * which means the error reaches the root and the caller should fall back at
 * file scope.
 */
function anchorFor(error: TsNode): { node: TsNode; kind: BoundaryKind } | null {
  let current: TsNode | null = error;
  while (current !== null) {
    const kind = containerKind(current.parent);
    if (kind !== null) return { node: current, kind };
    current = current.parent;
  }
  return null;
}

function collectErrorNodes(root: TsNode): TsNode[] {
  const found: TsNode[] = [];
  const visit = (node: TsNode): void => {
    if (node.type === 'ERROR' || node.isMissing) {
      found.push(node);
      return;
    }
    if (!node.hasError) return;
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * Every region of the source that cannot be lowered and must become a Raw node.
 * Returned in source order, non-overlapping.
 */
export function fallbackRegions(root: TsNode): FallbackRegion[] {
  const regions: FallbackRegion[] = [];

  for (const error of collectErrorNodes(root)) {
    const anchor = anchorFor(error);
    if (anchor === null) {
      // The error reaches the root with no container in between: the whole file
      // is the boundary. Phase 7's degenerate case.
      regions.push({
        startIndex: root.startIndex,
        endIndex: root.endIndex,
        kind: 'declaration',
        startRow: root.startPosition.row,
        endRow: root.endPosition.row,
      });
      continue;
    }

    let last = anchor.node;
    // Absorb trailing fragments the bleed orphaned, stopping at the first
    // sibling that is a well-formed boundary in its own right.
    for (let sibling = last.nextSibling; sibling !== null; sibling = sibling.nextSibling) {
      // Punctuation is never absorbed. The closing `}` of the enclosing block is
      // an unnamed sibling of a bled ERROR, and swallowing it would emit a Raw
      // node with an unbalanced brace — broken code that still looks plausible.
      if (!sibling.isNamed) break;
      if (isLegalBoundary(sibling, anchor.kind)) break;
      last = sibling;
    }

    regions.push({
      startIndex: anchor.node.startIndex,
      endIndex: last.endIndex,
      kind: anchor.kind,
      startRow: anchor.node.startPosition.row,
      endRow: last.endPosition.row,
    });
  }

  return merge(regions);
}

/** Sorts and coalesces, so two errors in one statement yield one region. */
function merge(regions: readonly FallbackRegion[]): FallbackRegion[] {
  const sorted = [...regions].sort((a, b) =>
    a.startIndex === b.startIndex ? a.endIndex - b.endIndex : a.startIndex - b.startIndex,
  );

  const merged: FallbackRegion[] = [];
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && region.startIndex < previous.endIndex) {
      if (region.endIndex > previous.endIndex) {
        merged[merged.length - 1] = {
          ...previous,
          endIndex: region.endIndex,
          endRow: region.endRow,
        };
      }
      continue;
    }
    merged.push(region);
  }
  return merged;
}
