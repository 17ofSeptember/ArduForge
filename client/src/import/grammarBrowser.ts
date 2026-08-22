/**
 * Browser wiring for the tree-sitter wasm files.
 *
 * Imported for its side effect by `main.tsx`, and by nothing else — Node tests
 * and scripts must keep the disk fallback in `grammar.ts`.
 *
 * The `?url` suffix hands both files to Vite as real assets: they are hashed,
 * emitted into `dist/assets`, and the import evaluates to the URL they actually
 * landed at. A hand-written path is the bug this replaces — it works under the
 * dev server, 404s in a production build, and the 404 comes back as `index.html`
 * so the only symptom is WebAssembly refusing to parse it.
 */
import runtimeUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import grammarUrl from 'tree-sitter-cpp/tree-sitter-cpp.wasm?url';
import { setGrammarSources } from '@/import/grammar';

setGrammarSources({ runtime: runtimeUrl, grammar: grammarUrl });
