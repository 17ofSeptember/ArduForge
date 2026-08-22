/**
 * Lexical pre-flight (IMPORT.md §Phase 1 amendment B).
 *
 * Phase 0 measured that an unterminated string literal swallows the whole file:
 * tree-sitter recovers nothing, and the tree it returns is worse than useless
 * because it looks like a parse. So this scan runs *before* the parser, and any
 * hit routes straight to whole-file fallback rather than to a salvaged tree.
 *
 * It is a small hand-written scanner rather than a set of regexes, because the
 * thing that makes this hard is not finding an unterminated quote — it is not
 * crying wolf on the apostrophe in `// don't`, the `"` inside `'"'`, the
 * `/*` inside a string, or an escaped quote. Those all need a state machine
 * that knows which context it is in, which is exactly what a regex cannot do.
 */

export type UnterminatedConstruct = 'string' | 'char' | 'block-comment' | 'raw-string';

export interface PreflightProblem {
  readonly file: string;
  /** 1-based, and points at where the construct *opened*. */
  readonly line: number;
  readonly column: number;
  readonly construct: UnterminatedConstruct;
  readonly message: string;
}

export interface PreflightFile {
  readonly name: string;
  readonly content: string;
}

type State = 'code' | 'line-comment' | 'block-comment' | 'string' | 'char' | 'raw-string';

const LABEL: Record<UnterminatedConstruct, string> = {
  string: 'string literal',
  char: 'character literal',
  'block-comment': 'block comment',
  'raw-string': 'raw string literal',
};

/**
 * Scans every file and returns one problem per unterminated construct. An empty
 * result means the source is lexically sound enough to hand to tree-sitter — it
 * says nothing about whether it is valid C++, which is the parser's job.
 */
export function preflight(files: readonly PreflightFile[]): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  for (const file of files) problems.push(...scan(file));
  return problems;
}

function scan(file: PreflightFile): PreflightProblem[] {
  const source = file.content;
  const problems: PreflightProblem[] = [];

  let state: State = 'code';
  let line = 1;
  let column = 1;
  // Where the construct currently being scanned opened, for the message.
  let openLine = 1;
  let openColumn = 1;
  // Closing delimiter for a raw string: R"delim( … )delim"
  let rawCloser = '';

  const problem = (construct: UnterminatedConstruct): void => {
    problems.push({
      file: file.name,
      line: openLine,
      column: openColumn,
      construct,
      message: `Unterminated ${LABEL[construct]} starting at ${file.name}:${openLine}:${openColumn}.`,
    });
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];

    if (ch === '\n') {
      // A string or char literal may not span a raw line break; without a
      // continuation backslash (consumed below) this is the error we are here
      // to find. Reporting at the newline and resuming in `code` keeps one
      // broken line from cascading into every line after it.
      if (state === 'string') {
        problem('string');
        state = 'code';
      } else if (state === 'char') {
        problem('char');
        state = 'code';
      } else if (state === 'line-comment') {
        state = 'code';
      }
      line += 1;
      column = 1;
      i += 1;
      continue;
    }

    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') {
          state = 'line-comment';
          i += 2;
          column += 2;
          continue;
        }
        if (ch === '/' && next === '*') {
          state = 'block-comment';
          openLine = line;
          openColumn = column;
          i += 2;
          column += 2;
          continue;
        }
        // Raw string: R"delim( ... )delim". Its whole point is that quotes and
        // backslashes inside are literal, so it needs its own state.
        if ((ch === 'R' || (ch === 'L' && next === 'R')) && source[i + (ch === 'R' ? 1 : 2)] === '"') {
          const quote = i + (ch === 'R' ? 1 : 2);
          const open = source.indexOf('(', quote + 1);
          if (open !== -1) {
            rawCloser = `)${source.slice(quote + 1, open)}"`;
            state = 'raw-string';
            openLine = line;
            openColumn = column;
            const consumed = open + 1 - i;
            column += consumed;
            i = open + 1;
            continue;
          }
        }
        if (ch === '"') {
          state = 'string';
          openLine = line;
          openColumn = column;
        } else if (ch === "'") {
          state = 'char';
          openLine = line;
          openColumn = column;
        }
        i += 1;
        column += 1;
        continue;
      }

      case 'line-comment': {
        i += 1;
        column += 1;
        continue;
      }

      case 'block-comment': {
        if (ch === '*' && next === '/') {
          state = 'code';
          i += 2;
          column += 2;
          continue;
        }
        i += 1;
        column += 1;
        continue;
      }

      case 'string':
      case 'char': {
        if (ch === '\\') {
          // Consumes the escaped character whatever it is, which is what keeps
          // \" and \' and a trailing \ before a newline from ending the literal.
          if (next === '\n') {
            line += 1;
            column = 1;
            i += 2;
            continue;
          }
          i += 2;
          column += 2;
          continue;
        }
        if ((state === 'string' && ch === '"') || (state === 'char' && ch === "'")) {
          state = 'code';
        }
        i += 1;
        column += 1;
        continue;
      }

      case 'raw-string': {
        if (source.startsWith(rawCloser, i)) {
          state = 'code';
          column += rawCloser.length;
          i += rawCloser.length;
          continue;
        }
        i += 1;
        column += 1;
        continue;
      }
    }
  }

  // Whatever is still open at EOF never closed.
  if (state === 'block-comment') problem('block-comment');
  else if (state === 'string') problem('string');
  else if (state === 'char') problem('char');
  else if (state === 'raw-string') problem('raw-string');

  return problems;
}
