import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, Decoration, lineNumbers, type DecorationSet } from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Copy, Download } from 'lucide-react';
import { generate, type GenerateResult } from '@/codegen/generate';
import { useGraphStore } from '@/store/graphStore';
import { toast } from '@/ui/toast';

/** Code regenerates on a 200ms debounce as the graph changes (§Phase 4). */
const DEBOUNCE_MS = 200;

const setHighlight = StateEffect.define<readonly number[]>();

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlight)) continue;
      const marks = [];
      for (const lineNumber of effect.value) {
        if (lineNumber < 1 || lineNumber > transaction.state.doc.lines) continue;
        const line = transaction.state.doc.line(lineNumber);
        marks.push(
          Decoration.line({
            attributes: {
              style:
                'background-color: color-mix(in oklch, var(--bg-selected) 70%, transparent)',
            },
          }).range(line.from),
        );
      }
      next = Decoration.set(marks);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * HighlightStyle compiles to real CSS rules, so a var() here resolves against
 * the live theme — no rebuild and no token subscription needed, unlike uPlot.
 * Generated code is a primary surface in this app (THEME.md Phase 4), so the
 * full C++ token set is covered rather than the seven tags this had before.
 */
const forgeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--syntax-keyword)' },
  { tag: tags.modifier, color: 'var(--syntax-keyword)' },
  { tag: [tags.typeName, tags.standard(tags.typeName)], color: 'var(--syntax-type)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool], color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--syntax-preprocessor)' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--syntax-function)',
  },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--syntax-punctuation)' },
  { tag: tags.invalid, color: 'var(--syntax-error)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text-primary)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '12px' },
  '.cm-scroller': { overflow: 'auto' },

  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--bg-header) 45%, transparent)',
  },

  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--bg-selected)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-link)' },

  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--border-selected) 30%, transparent)',
    outline: '1px solid var(--border-selected)',
  },
  '.cm-nonmatchingBracket': { outline: '1px solid var(--feedback-destructive)' },

  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--feedback-warning) 30%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--feedback-warning) 55%, transparent)',
  },

  // Error squiggle. A wavy underline rather than a fill, so it never competes
  // with the syntax colours it sits under.
  '.cm-lintRange-error': {
    textDecoration: 'underline wavy var(--feedback-destructive)',
    textUnderlineOffset: '3px',
  },
});

const extensions: Extension[] = [
  lineNumbers(),
  cpp(),
  syntaxHighlighting(forgeHighlight),
  highlightField,
  theme,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  EditorView.lineWrapping,
];

export function CodePanel() {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const project = useGraphStore((state) => state.project);

  const [result, setResult] = useState<GenerateResult | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Debounced regeneration.
  useEffect(() => {
    const timer = setTimeout(() => {
      setResult(generate(nodes, edges, { projectName: project.meta.name, fqbn: project.board.fqbn }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nodes, edges, project]);

  // Create the editor once; StrictMode's double-mount must not leave two views.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent: host });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || result === null) return;
    if (view.state.doc.toString() === result.code) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.code },
    });
  }, [result]);

  // Selecting a node highlights the lines it generated (§Phase 4).
  const selectedId = useMemo(() => {
    const selected = nodes.filter((node) => node.selected === true);
    return selected.length === 1 ? (selected[0]?.id ?? null) : null;
  }, [nodes]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || result === null) return;
    const lines = selectedId === null ? [] : (result.nodeLines.get(selectedId) ?? []);
    view.dispatch({ effects: setHighlight.of(lines) });
    const first = lines[0];
    if (first !== undefined && first <= view.state.doc.lines) {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(first).from, { y: 'center' }) });
    }
  }, [selectedId, result]);

  const copy = () => {
    if (result === null) return;
    void navigator.clipboard.writeText(result.code).then(
      () => toast.success('Sketch copied', 'Paste it straight into the Arduino IDE.'),
      () => toast.error('Clipboard write was blocked by the browser.'),
    );
  };

  const download = () => {
    if (result === null) return;
    const name = project.meta.name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'Sketch';
    const blob = new Blob([result.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.ino`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Sketch downloaded', `${name}.ino`);
  };

  const errorCount = result?.problems.filter((problem) => problem.severity === 'error').length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-2 border-b border-edge-subtle px-3 py-1.5">
        <span className="text-[10px] tracking-[0.12em] text-content-secondary uppercase">
          Generated sketch
        </span>
        {errorCount > 0 && (
          <span className="text-[11px] text-error">
            {errorCount} error{errorCount === 1 ? '' : 's'} — fix before uploading
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={copy}
            title="Copy sketch"
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-content-secondary hover:bg-card"
          >
            <Copy size={12} /> Copy
          </button>
          <button
            type="button"
            onClick={download}
            title="Download .ino"
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-content-secondary hover:bg-card"
          >
            <Download size={12} /> .ino
          </button>
        </div>
      </header>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
