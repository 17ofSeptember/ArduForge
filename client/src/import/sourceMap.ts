/**
 * Source map from the preprocessed buffer back to the user's files
 * (IMPORT.md §Phase 1).
 *
 * Everything downstream — every warning, every node's origin, every
 * click-through in the import report — resolves through here. It has to be
 * exact, because "line 34" pointing at the wrong line is worse than no line at
 * all: the user goes looking and finds nothing wrong.
 *
 * Two kinds of span exist in the buffer. Original spans came from a file and
 * map back to a real (file, line, column). Synthetic spans are text the
 * preprocessor invented — the Arduino.h include and the generated prototypes —
 * and map to nothing. Lowering must skip them, or it emits nodes for
 * declarations the user never wrote.
 */

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

export interface OriginalPosition {
  readonly file: string;
  /** 1-based, matching what an editor shows. */
  readonly line: number;
  readonly column: number;
}

interface Segment {
  readonly bufferStart: number;
  readonly bufferEnd: number;
  /** Null for text the preprocessor invented. */
  readonly file: string | null;
  readonly fileStart: number;
}

export class SourceMap {
  private readonly segments: readonly Segment[];
  /** file name -> offsets at which each line starts, for O(log n) lookup. */
  private readonly lineStarts: ReadonlyMap<string, readonly number[]>;

  constructor(segments: readonly Segment[], files: readonly SourceFile[]) {
    this.segments = segments;
    const starts = new Map<string, number[]>();
    for (const file of files) starts.set(file.name, lineStartsOf(file.content));
    this.lineStarts = starts;
  }

  /** The segment covering an offset, or null past the end of the buffer. */
  private segmentAt(offset: number): Segment | null {
    let low = 0;
    let high = this.segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = this.segments[mid];
      if (segment === undefined) return null;
      if (offset < segment.bufferStart) high = mid - 1;
      else if (offset >= segment.bufferEnd) low = mid + 1;
      else return segment;
    }
    return null;
  }

  /** True when this offset is preprocessor-invented text, not the user's. */
  isSynthetic(offset: number): boolean {
    return this.segmentAt(offset)?.file === null;
  }

  /** Resolves a buffer offset to the user's file, or null if synthetic. */
  resolve(offset: number): OriginalPosition | null {
    const segment = this.segmentAt(offset);
    if (segment === null || segment.file === null) return null;

    const fileOffset = segment.fileStart + (offset - segment.bufferStart);
    const starts = this.lineStarts.get(segment.file);
    if (starts === undefined) return null;

    // Largest line start <= fileOffset.
    let low = 0;
    let high = starts.length - 1;
    let line = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = starts[mid];
      if (start === undefined) break;
      if (start <= fileOffset) {
        line = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return {
      file: segment.file,
      line: line + 1,
      column: fileOffset - (starts[line] ?? 0) + 1,
    };
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * Accumulates the buffer and its map together, so the two cannot drift. Every
 * write goes through append or appendSynthetic — there is no way to add text to
 * the buffer without recording where it came from.
 */
export class SourceMapBuilder {
  private text = '';
  private readonly segments: Segment[] = [];

  /** Text copied verbatim out of one of the user's files. */
  append(file: string, fileStart: number, content: string): void {
    if (content.length === 0) return;
    this.segments.push({
      bufferStart: this.text.length,
      bufferEnd: this.text.length + content.length,
      file,
      fileStart,
    });
    this.text += content;
  }

  /** Text the preprocessor invented. Resolves to null, and lowering skips it. */
  appendSynthetic(content: string): void {
    if (content.length === 0) return;
    this.segments.push({
      bufferStart: this.text.length,
      bufferEnd: this.text.length + content.length,
      file: null,
      fileStart: 0,
    });
    this.text += content;
  }

  get length(): number {
    return this.text.length;
  }

  build(files: readonly SourceFile[]): { text: string; map: SourceMap } {
    return { text: this.text, map: new SourceMap(this.segments, files) };
  }
}
