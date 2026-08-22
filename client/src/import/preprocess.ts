/**
 * Arduino's preprocessing, replicated (IMPORT.md §".ino is not valid C++").
 *
 * A .ino is not a translation unit. The Arduino build concatenates the sketch's
 * tabs, prepends Arduino.h, and generates function prototypes — which is why a
 * sketch can call a function defined further down the file. Skipping any of
 * that gives a parse that disagrees with what the compiler saw, and every
 * conclusion drawn from it is then suspect.
 *
 * The prototypes matter here for a different reason than they do in the real
 * build: this buffer is never compiled, only parsed, so their job is to tell
 * Phase 2 which identifiers name user functions. They are marked synthetic in
 * the source map so lowering skips them rather than emitting a node for a
 * declaration the user never wrote.
 */
import { parseCpp, type TsNode } from '@/import/grammar';
import { SourceMapBuilder, type SourceFile, type SourceMap } from '@/import/sourceMap';

export interface PreprocessResult {
  /** The concatenated, prototyped buffer — what the compiler conceptually sees. */
  readonly text: string;
  readonly map: SourceMap;
  /**
   * Concatenation only, with nothing invented. Lowering works from this: the
   * prototyped buffer would have the importer emit nodes for declarations the
   * user never wrote, and filtering them back out is a check you only have to
   * forget once.
   */
  readonly concatenated: string;
  readonly concatMap: SourceMap;
  /** Prototypes generated, in emission order. Reported, never emitted to output. */
  readonly prototypes: readonly string[];
  /** The .ino files in the order Arduino concatenates them. */
  readonly order: readonly string[];
}

/**
 * Arduino's order: the tab matching the folder name first, then the rest
 * alphabetically. Any other order changes which declaration wins and can change
 * the program.
 */
export function arduinoOrder(files: readonly SourceFile[], sketchName: string): SourceFile[] {
  const inos = files.filter((file) => file.name.endsWith('.ino'));
  const main = `${sketchName}.ino`;
  return [...inos].sort((a, b) => {
    if (a.name === main) return -1;
    if (b.name === main) return 1;
    return a.name.localeCompare(b.name);
  });
}

const ARDUINO_INCLUDE = '#include <Arduino.h>\n';

export async function preprocess(
  files: readonly SourceFile[],
  sketchName: string,
): Promise<PreprocessResult> {
  const ordered = arduinoOrder(files, sketchName);

  // Pass one: concatenate, so the prototype scan sees what the compiler sees.
  // The pieces are kept explicitly rather than recomputed later — the offset
  // arithmetic for "which file does buffer position N belong to" is exactly the
  // kind of thing that is easy to get subtly wrong and hard to notice, since a
  // map that is off by one still resolves to a plausible line.
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const file of ordered) {
    pieces.push({ file: file.name, fileStart: 0, text: file.content, bufferStart: cursor });
    cursor += file.content.length;
    // Arduino joins tabs with a newline; without it the last line of one tab
    // and the first of the next would fuse into one statement.
    if (!file.content.endsWith('\n')) {
      pieces.push({ file: null, fileStart: 0, text: '\n', bufferStart: cursor });
      cursor += 1;
    }
  }
  const concatBuilder = new SourceMapBuilder();
  emitSlice(concatBuilder, pieces, 0, cursor);
  const concat = concatBuilder.build(ordered);
  const joinedText = concat.text;

  const { root } = await parseCpp(joinedText);
  const prototypes = generatePrototypes(root);
  const insertAt = prototypeInsertionPoint(root);

  // Pass two: rebuild with the include and prototypes spliced in. Rebuilding
  // rather than patching keeps the map honest — every offset is recorded once,
  // by the same code path.
  const out = new SourceMapBuilder();
  out.appendSynthetic(ARDUINO_INCLUDE);

  if (prototypes.length > 0) {
    emitSlice(out, pieces, 0, insertAt);
    out.appendSynthetic(`${prototypes.join('\n')}\n`);
    emitSlice(out, pieces, insertAt, joinedText.length);
  } else {
    emitSlice(out, pieces, 0, joinedText.length);
  }

  const built = out.build(ordered);
  return {
    text: built.text,
    map: built.map,
    concatenated: concat.text,
    concatMap: concat.map,
    prototypes,
    order: ordered.map((file) => file.name),
  };
}

/** One contiguous run of the concatenated buffer with a single origin. */
interface Piece {
  readonly file: string | null;
  readonly fileStart: number;
  readonly text: string;
  readonly bufferStart: number;
}

/** Copies [from, to) of the concatenated buffer, preserving each piece's origin. */
function emitSlice(out: SourceMapBuilder, pieces: readonly Piece[], from: number, to: number): void {
  for (const piece of pieces) {
    const pieceEnd = piece.bufferStart + piece.text.length;
    const start = Math.max(from, piece.bufferStart);
    const end = Math.min(to, pieceEnd);
    if (end <= start) continue;

    const offset = start - piece.bufferStart;
    const slice = piece.text.slice(offset, end - piece.bufferStart);
    if (piece.file === null) out.appendSynthetic(slice);
    else out.append(piece.file, piece.fileStart + offset, slice);
  }
}

/**
 * Where Arduino splices prototypes in: immediately before the first function
 * definition. Putting them at the very top would break any signature naming a
 * type declared in the sketch itself.
 */
function prototypeInsertionPoint(root: TsNode): number {
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child?.type === 'function_definition') return child.startIndex;
  }
  return root.endIndex;
}

/**
 * A prototype per top-level function definition.
 *
 * Deliberately conservative. Templates cannot be prototyped this way, and a
 * function with default arguments must not repeat them in both places — both
 * become Raw Globals downstream anyway, so a prototype for them would buy
 * nothing and could be wrong.
 */
export function generatePrototypes(root: TsNode): string[] {
  const prototypes: string[] = [];

  for (let i = 0; i < root.childCount; i += 1) {
    const node = root.child(i);
    if (node === null || node.type !== 'function_definition') continue;
    if (node.hasError) continue;

    const declarator = node.childForFieldName('declarator');
    if (declarator === null) continue;

    // A pointer or reference return wraps the function_declarator, so the
    // function is not always the immediate child. `const char *name(int)` is a
    // pointer_declarator whose own declarator is the function.
    const fn = functionDeclarator(declarator);
    if (fn === null) continue;

    const parameters = fn.childForFieldName('parameters');
    if (parameters === null) continue;
    // A default argument in the definition means the prototype must not carry
    // one, and reproducing the signature correctly stops being mechanical.
    if (parameters.text.includes('=')) continue;

    const type = node.childForFieldName('type');
    if (type === null) continue;

    // The declarator's own text already carries any pointer or reference
    // decoration along with the name and parameters.
    prototypes.push(`${type.text} ${declarator.text};`);
  }

  return prototypes;
}

function functionDeclarator(node: TsNode): TsNode | null {
  let current: TsNode | null = node;
  while (current !== null) {
    if (current.type === 'function_declarator') return current;
    if (current.type !== 'pointer_declarator' && current.type !== 'reference_declarator') return null;
    current = current.childForFieldName('declarator');
  }
  return null;
}
