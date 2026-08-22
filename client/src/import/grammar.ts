/**
 * tree-sitter-cpp loading for the importer (IMPORT.md §Architecture).
 *
 * The grammar wasm ships inside the `tree-sitter-cpp` package. Do not switch to
 * `tree-sitter-wasms` — its prebuilt wasm is ABI-incompatible with
 * web-tree-sitter 0.26 and fails with a bare Error naming neither file nor
 * cause. See docs/IMPORT.md §Parser.
 *
 * **There are two wasm files and both must resolve:**
 *
 *   web-tree-sitter.wasm   the runtime, loaded by Parser.init()
 *   tree-sitter-cpp.wasm   the grammar, loaded by Language.load()
 *
 * Node and the browser locate them differently, so both are injected rather
 * than guessed. Node reads them off disk and is the default, so scripts and
 * node tests work with no setup. The browser passes hashed asset URLs produced
 * by Vite — see `grammarBrowser.ts`, which `main.tsx` imports for its side
 * effect.
 *
 * Getting this wrong does not fail loudly. `Parser.init()` with no options asks
 * Emscripten to locate the runtime relative to the script URL; a dev server
 * answers that request with `index.html`, and the only symptom is
 * `WebAssembly.Module doesn't parse at byte 0: module doesn't start with
 * '\0asm'` — an error that names neither file.
 */
import { Language, Parser, type Node as TsNode, type Tree } from 'web-tree-sitter';

interface GrammarSources {
  /** URL of web-tree-sitter.wasm, the runtime. */
  readonly runtime: string;
  /** URL of tree-sitter-cpp.wasm, the grammar. */
  readonly grammar: string;
}

let sources: GrammarSources | null = null;

/**
 * Point the loader at bundled assets. Called once, at browser startup.
 *
 * Both URLs are required together: a build that resolves the grammar but not
 * the runtime fails inside `Parser.init()`, before the grammar is ever read.
 */
export function setGrammarSources(next: GrammarSources): void {
  sources = next;
  cached = null;
}

/** Node/vitest fallback: resolve both files on disk. */
async function diskSources(): Promise<GrammarSources> {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  return {
    runtime: require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    grammar: require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm'),
  };
}

let cached: Promise<Parser> | null = null;

/**
 * One parser, reused. Parser.init() loads the runtime wasm and is not cheap;
 * doing it per sketch turns a corpus run into a minute of startup.
 */
export function cppParser(): Promise<Parser> {
  cached ??= (async () => {
    const resolved = sources ?? (await diskSources());
    // locateFile is how Emscripten is told where the runtime lives. Without it
    // the request goes to a path derived from the script URL, which in a bundled
    // app is not where the asset landed.
    await Parser.init({ locateFile: () => resolved.runtime });
    const language = await Language.load(resolved.grammar);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();
  return cached;
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

export interface ParseResult {
  readonly tree: Tree;
  readonly root: TsNode;
  readonly errors: readonly ErrorSpan[];
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
