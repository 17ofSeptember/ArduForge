/**
 * Reversing the AwryLink injection.
 *
 * When a graph exposes variables to the dashboard, codegen splices a runtime
 * into the sketch: an `AwryLink.h` include, an `AWRY_VARS[]` table of pointers,
 * an `AWRY_HASH`, an `awrylink_begin(...)` call at the top of setup() and an
 * `awrylink_poll()` at the top of loop(). Importing that sketch back without
 * undoing it produces five Raw nodes standing for code the user never wrote,
 * and loses the one fact that actually mattered: which variables were exposed.
 *
 * This is not pattern lifting. It is the exact inverse of a transform we own,
 * so it can be recognized by its precise shape rather than guessed at — and it
 * is refused unless the *whole* signature is present. A sketch that happens to
 * define its own `awrylink_poll` is somebody else's code and imports literally.
 */
import type { TsNode } from '@/import/grammar';

export interface AwryLinkSignature {
  /** Names in AWRY_VARS, in table order. */
  readonly exposed: readonly string[];
  /** Byte ranges to remove from the globals text, in source order. */
  readonly globalSpans: readonly { start: number; end: number }[];
  /** Statement nodes to drop from setup() and loop(). */
  readonly setupCalls: ReadonlySet<number>;
  readonly loopCalls: ReadonlySet<number>;
}

const ROW = /\{\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*,\s*\(void \*\)&([A-Za-z_][A-Za-z0-9_]*)\s*,/g;

/**
 * Detects the injection, or returns null.
 *
 * Every part has to be present: the include, the table, the hash, the begin
 * call and the poll call. A partial match is not our output — it is a user who
 * has written something that resembles it, and rewriting that would be the
 * "wrong lift" IMPORT.md warns is worse than no lift at all.
 */
export function detectAwryLink(root: TsNode, source: string): AwryLinkSignature | null {
  let include: TsNode | null = null;
  let table: TsNode | null = null;
  let hash: TsNode | null = null;
  let comment: TsNode | null = null;
  const exposed: string[] = [];

  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child === null) continue;

    if (child.type === 'preproc_include' && child.text.includes('"AwryLink.h"')) {
      include = child;
      continue;
    }
    if (child.type === 'comment' && child.text.includes('exposed to the ArduForge dashboard')) {
      comment = child;
      continue;
    }
    if (child.type === 'declaration') {
      const text = child.text;
      if (table === null && text.includes('AWRY_VARS') && text.includes('AwryVar')) {
        table = child;
        ROW.lastIndex = 0;
        for (let match = ROW.exec(text); match !== null; match = ROW.exec(text)) {
          // The table's name and the address it takes must agree; if they do
          // not, this is not the table we generate.
          if (match[1] !== match[2]) return null;
          exposed.push(match[1] as string);
        }
        continue;
      }
      if (hash === null && text.includes('AWRY_HASH')) {
        hash = child;
        continue;
      }
    }
  }

  if (include === null || table === null || hash === null || exposed.length === 0) return null;

  const setupCalls = findCalls(root, 'setup', 'awrylink_begin');

  // The injection also starts Serial when the graph does not, and emits it in
  // the same sorted requires block — `Serial.begin(115200);` sorts immediately
  // before `awrylink_begin(...)`. Lowering it into a Serial Begin node moves it
  // *after* awrylink_begin on the way back out, which is a different call order
  // and therefore different machine code.
  //
  // Skipping it is safe either way: codegen re-adds exactly this line whenever
  // the graph has no Serial Begin of its own, so the output is the same whether
  // or not the original graph had one.
  for (const statement of statementsOf(root, 'setup')) {
    if (statement.text.replace(/\s+/g, '') !== 'Serial.begin(115200);') continue;
    setupCalls.add(statement.startIndex);
  }
  const loopCalls = findCalls(root, 'loop', 'awrylink_poll');
  if (setupCalls.size === 0 || loopCalls.size === 0) return null;

  // The begin call names the table, its length and the hash. If it does not,
  // the include and table belong to something else.
  const begin = source.slice(...beginRange(root));
  if (!begin.includes('AWRY_VARS') || !begin.includes('AWRY_HASH')) return null;

  const spans = [include, table, hash, ...(comment === null ? [] : [comment])]
    .map((node) => ({ start: node.startIndex, end: node.endIndex }))
    .sort((a, b) => a.start - b.start);

  return { exposed, globalSpans: spans, setupCalls, loopCalls };
}

function beginRange(root: TsNode): [number, number] {
  const found = callNodesIn(root, 'setup', 'awrylink_begin')[0];
  return found === undefined ? [0, 0] : [found.startIndex, found.endIndex];
}

function functionNamed(root: TsNode, name: string): TsNode | null {
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child?.type !== 'function_definition') continue;
    const declarator = child.childForFieldName('declarator');
    if (declarator?.childForFieldName('declarator')?.text === name) return child;
  }
  return null;
}

function statementsOf(root: TsNode, functionName: string): TsNode[] {
  const fn = functionNamed(root, functionName);
  const body = fn?.childForFieldName('body');
  if (body === null || body === undefined) return [];
  const found: TsNode[] = [];
  for (let i = 0; i < body.namedChildCount; i += 1) {
    const statement = body.namedChild(i);
    if (statement !== null) found.push(statement);
  }
  return found;
}

function callNodesIn(root: TsNode, functionName: string, callee: string): TsNode[] {
  const fn = functionNamed(root, functionName);
  const body = fn?.childForFieldName('body');
  if (body === null || body === undefined) return [];

  const found: TsNode[] = [];
  for (let i = 0; i < body.namedChildCount; i += 1) {
    const statement = body.namedChild(i);
    if (statement?.type !== 'expression_statement') continue;
    const call = statement.namedChild(0);
    if (call?.type !== 'call_expression') continue;
    if (call.childForFieldName('function')?.text !== callee) continue;
    found.push(statement);
  }
  return found;
}

/** Start offsets of the injected statements, which lowering then skips. */
function findCalls(root: TsNode, functionName: string, callee: string): Set<number> {
  return new Set(callNodesIn(root, functionName, callee).map((node) => node.startIndex));
}

/** Removes the injected declarations from the globals text. */
export function stripAwryLinkGlobals(source: string, signature: AwryLinkSignature): string {
  let out = '';
  let cursor = 0;
  for (const span of signature.globalSpans) {
    out += source.slice(cursor, span.start);
    cursor = span.end;
  }
  out += source.slice(cursor);
  return out;
}
