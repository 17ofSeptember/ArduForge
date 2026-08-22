/**
 * Minimal unified diff for the fidelity report (IMPORT.md §0.1 `diff`).
 *
 * Hand-rolled rather than pulling in a dependency: the harness needs "show me
 * what changed" for a human reading a failure, not a patch anyone will apply.
 */

/** Classic LCS table. Sketches are small; the quadratic cost is irrelevant. */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i] as number[];
    const next = table[i + 1] as number[];
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  return table;
}

type Op = readonly ['same' | 'del' | 'add', string];

function operations(a: readonly string[], b: readonly string[]): Op[] {
  const table = lcs(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push(['same', a[i] as string]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      ops.push(['del', a[i] as string]);
      i += 1;
    } else {
      ops.push(['add', b[j] as string]);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) ops.push(['del', a[i] as string]);
  for (; j < b.length; j += 1) ops.push(['add', b[j] as string]);
  return ops;
}

export interface DiffOptions {
  readonly context?: number;
  readonly maxLines?: number;
  readonly labelA?: string;
  readonly labelB?: string;
}

export function unifiedDiff(original: string, regenerated: string, options: DiffOptions = {}): string {
  const context = options.context ?? 2;
  const maxLines = options.maxLines ?? 200;

  const a = original.split('\n');
  const b = regenerated.split('\n');
  const ops = operations(a, b);
  if (ops.every(([kind]) => kind === 'same')) return '';

  // Keep only changed regions plus a little context, so a wholly-rewritten
  // sketch does not print twice.
  const keep = new Set<number>();
  ops.forEach((op, index) => {
    if (op[0] === 'same') return;
    for (let k = index - context; k <= index + context; k += 1) {
      if (k >= 0 && k < ops.length) keep.add(k);
    }
  });

  const lines: string[] = [`--- ${options.labelA ?? 'original'}`, `+++ ${options.labelB ?? 'regenerated'}`];
  let skipping = false;
  for (let index = 0; index < ops.length; index += 1) {
    if (!keep.has(index)) {
      if (!skipping) {
        lines.push('@@ …');
        skipping = true;
      }
      continue;
    }
    skipping = false;
    const [kind, text] = ops[index] as Op;
    lines.push(`${kind === 'same' ? ' ' : kind === 'del' ? '-' : '+'}${text}`);
    if (lines.length >= maxLines) {
      lines.push(`… diff truncated at ${maxLines} lines`);
      break;
    }
  }
  return lines.join('\n');
}
