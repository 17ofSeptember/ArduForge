/**
 * The import flow behind every entry point (IMPORT.md §Phase 6).
 *
 * Open, paste and drag-drop all land here, so they cannot drift apart: one of
 * them silently skipping the preview, or laying out differently, is exactly the
 * kind of divergence that only shows up in the path nobody tests.
 *
 * Nothing here touches the store. It produces a *preview* — a laid-out graph
 * plus the report — and the caller decides whether to commit it. §Phase 6 is
 * explicit that the current project is never replaced without a confirmation
 * step, and the way to guarantee that is for the import path to have no way to
 * write.
 */
import { generate } from '@/codegen/generate';
import { importSketch, type ImportInputFile, type ImportReport } from '@/import/importSketch';
import { layoutGraph } from '@/import/layout';
import type { AnyNode, ForgeEdge } from '@/graph/model';
import { validateGraph, type Problem } from '@/graph/validate';

export interface ImportPreview {
  readonly name: string;
  readonly nodes: readonly AnyNode[];
  readonly edges: readonly ForgeEdge[];
  readonly report: ImportReport;
  /** Regenerated C++, for the side-by-side the user confirms against. */
  readonly regenerated: string;
  readonly problems: readonly Problem[];
  /** Ids of every Custom C++ node, for the report's click-throughs. */
  readonly rawNodeIds: readonly string[];
}

const RAW_DEF_IDS = new Set(['custom.statement', 'custom.expression', 'custom.global']);

/** True when a dropped or pasted payload looks like a sketch rather than a project. */
export function looksLikeSketch(name: string, content: string): boolean {
  if (name.endsWith('.ino') || name.endsWith('.pde')) return true;
  if (name.endsWith('.forge')) return false;
  // A .forge is JSON; a sketch is not. Checking the content rather than only
  // the name is what makes paste work, since pasted text has no name at all.
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) return false;
  return /\b(void\s+setup\s*\(|void\s+loop\s*\(|#include\s*<Arduino)/.test(content);
}

export async function buildPreview(
  files: readonly ImportInputFile[],
  sketchName: string,
): Promise<ImportPreview> {
  const result = await importSketch(files, { sketchName });

  const laidOut = await layoutGraph(result.nodes, result.edges);
  const generated = generate([...laidOut], [...result.edges], { projectName: sketchName });

  return {
    name: sketchName,
    nodes: laidOut,
    edges: result.edges,
    report: result.report,
    regenerated: generated.code,
    problems: validateGraph([...laidOut], [...result.edges]),
    rawNodeIds: laidOut
      .filter((node) => node.type === 'forge' && RAW_DEF_IDS.has((node.data as { defId?: string }).defId ?? ''))
      .map((node) => node.id),
  };
}

/** A sensible sketch name from a file name, or a fallback for pasted text. */
export function sketchNameFrom(fileName: string | null): string {
  if (fileName === null) return 'Pasted sketch';
  const base = fileName.replace(/\.(ino|pde)$/i, '');
  return base === '' ? 'Imported sketch' : base;
}
