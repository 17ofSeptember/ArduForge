/**
 * tree-sitter-cpp loader (IMPORT.md §Architecture, §0.3).
 *
 * The grammar wasm ships inside the `tree-sitter-cpp` npm package rather than
 * being built here. That matters: the prebuilt wasm in `tree-sitter-wasms` is
 * compiled against an older runtime and web-tree-sitter 0.26 rejects it with a
 * bare dylink error, so the package a search engine suggests first is the one
 * that does not work. Verified pairing is recorded in docs/IMPORT.md.
 *
 * Node-side only for now. Phase 6 serves the same wasm to the browser, which is
 * why the path is resolved rather than hard-coded — the browser build points at
 * a public asset URL instead.
 */
import { createRequire } from 'node:module';
import { Language, Parser, type Node as TsNode, type Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

/** Resolved through the package so a version bump moves the file with it. */
export function grammarWasmPath(): string {
  return require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm');
}

let cached: Parser | null = null;

/**
 * One parser instance, reused. Parser.init() loads the runtime wasm and is not
 * cheap; doing it per sketch turns a corpus run into a minute of startup.
 */
export async function cppParser(): Promise<Parser> {
  if (cached !== null) return cached;
  await Parser.init();
  const language = await Language.load(grammarWasmPath());
  const parser = new Parser();
  parser.setLanguage(language);
  cached = parser;
  return parser;
}

export interface ParseResult {
  readonly tree: Tree;
  readonly root: TsNode;
  /** Spans tree-sitter could not parse. Each becomes a Custom C++ node later. */
  readonly errors: readonly ErrorSpan[];
}

export interface ErrorSpan {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startRow: number;
  readonly endRow: number;
  readonly text: string;
  /** MISSING nodes are zero-width insertions tree-sitter invented to recover. */
  readonly kind: 'error' | 'missing';
}

export async function parseCpp(source: string): Promise<ParseResult> {
  const parser = await cppParser();
  const tree = parser.parse(source);
  if (tree === null) throw new Error('tree-sitter returned no tree');
  return { tree, root: tree.rootNode, errors: collectErrors(tree.rootNode) };
}

/**
 * Walks for ERROR and MISSING nodes without descending into an ERROR's own
 * children — one span per unparseable region, not one per confused token.
 */
export function collectErrors(root: TsNode): ErrorSpan[] {
  const spans: ErrorSpan[] = [];
  const visit = (node: TsNode): void => {
    if (node.type === 'ERROR') {
      spans.push(toSpan(node, 'error'));
      return;
    }
    if (node.isMissing) {
      spans.push(toSpan(node, 'missing'));
      return;
    }
    // hasError is false for whole subtrees, so this prunes most of the walk.
    if (!node.hasError) return;
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) visit(child);
    }
  };
  visit(root);
  return spans;
}

function toSpan(node: TsNode, kind: ErrorSpan['kind']): ErrorSpan {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startRow: node.startPosition.row,
    endRow: node.endPosition.row,
    text: node.text,
    kind,
  };
}

export type { TsNode, Tree };
