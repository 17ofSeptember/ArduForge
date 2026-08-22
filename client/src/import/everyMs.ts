/**
 * The non-blocking timing pattern (IMPORT.md §4.2).
 *
 *     static unsigned long last = 0;
 *     if (millis() - last >= 500) {
 *       last = millis();
 *       // body
 *     }
 *
 * becomes one **Every N Milliseconds** node with the body as its exec chain.
 *
 * The timestamp variable disappears into the node, which is what makes this a
 * lift rather than a rename — and also what makes it dangerous. Three things
 * are checked before any of it happens, and any one of them failing means the
 * statement imports as written:
 *
 *  1. The variable is declared `unsigned long` and initialised to zero.
 *  2. Its *only* other appearance is the `last = millis()` inside the block. If
 *     anything else reads it, the node cannot represent the sketch, because the
 *     variable it would delete is still being used.
 *  3. The interval is a literal or a named constant, not a computed value.
 *
 * **`millis() >= last + interval` is deliberately not matched.** That form is
 * rollover-unsafe: after 49.7 days `last + interval` wraps and the branch stops
 * firing. `control.everyMs` generates the safe subtraction form, so lifting it
 * would repair a latent bug without telling anyone — a behaviour change
 * disguised as an import. It is imported literally and warned about instead.
 */
import type { TsNode } from '@/import/grammar';

export interface EveryMsLift {
  /** The `if` being replaced. */
  readonly ifNode: TsNode;
  /** Interval source text, preserved as written. */
  readonly interval: string;
  /** Statements that become the node's exec chain — the body minus the stamp. */
  readonly body: readonly TsNode[];
  /**
   * Declarations absorbed into the node: the timestamp, and the hoisted
   * `currentMillis` local when one is used and used only here.
   */
  readonly absorbed: readonly TsNode[];
}

export interface RolloverWarning {
  readonly node: TsNode;
}

const UNSIGNED_LONG = /^(unsigned\s+long|uint32_t|unsigned\s+long\s+int)$/;

function isMillisCall(node: TsNode): boolean {
  return node.type === 'call_expression' && node.childForFieldName('function')?.text === 'millis';
}

/** Every identifier occurrence in a subtree, by name. */
function countIdentifier(root: TsNode, name: string): TsNode[] {
  const found: TsNode[] = [];
  const walk = (node: TsNode): void => {
    if (node.type === 'identifier' && node.text === name) found.push(node);
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return found;
}

/** `(unsigned long)(500)` -> `500`; anything else is returned unchanged. */
function unwrapUnsignedLongCast(node: TsNode): TsNode {
  let current = node;
  for (;;) {
    if (current.type === 'parenthesized_expression') {
      const inner = current.namedChild(0);
      if (inner === null) return current;
      current = inner;
      continue;
    }
    if (current.type === 'cast_expression') {
      const type = current.childForFieldName('type')?.text.trim() ?? '';
      if (!UNSIGNED_LONG.test(type)) return current;
      const value = current.childForFieldName('value');
      if (value === null || value === undefined) return current;
      current = value;
      continue;
    }
    return current;
  }
}

function statementsOf(block: TsNode): TsNode[] {
  const found: TsNode[] = [];
  for (let i = 0; i < block.namedChildCount; i += 1) {
    const child = block.namedChild(i);
    if (child !== null && child.type !== 'comment') found.push(child);
  }
  return found;
}

/** The declaration of `name`, if it is an `unsigned long` starting at zero. */
function timestampDeclaration(root: TsNode, name: string): TsNode | null {
  let found: TsNode | null = null;
  const walk = (node: TsNode): void => {
    if (found !== null) return;
    if (node.type === 'declaration') {
      const type = node.childForFieldName('type')?.text.trim() ?? '';
      const qualifiers = node.namedChildren
        .filter((child) => child.type === 'storage_class_specifier' || child.type === 'type_qualifier')
        .map((child) => child.text)
        .join(' ');
      const full = `${qualifiers} ${type}`.trim().replace(/^static\s+/, '').trim();

      if (UNSIGNED_LONG.test(full)) {
        for (const child of node.namedChildren) {
          if (child.type !== 'init_declarator') continue;
          if (child.childForFieldName('declarator')?.text !== name) continue;
          const value = child.childForFieldName('value')?.text.trim();
          // A non-zero start means the first tick is offset, which the node
          // cannot express.
          if (value === '0' || value === '0UL' || value === '0ul') found = node;
          return;
        }
      }
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return found;
}

/**
 * Matches the pattern at `ifNode`, or returns null.
 *
 * `root` is the whole translation unit, because the decisive check — that
 * nothing else reads the timestamp — cannot be made from the statement alone.
 */
export function matchEveryMs(root: TsNode, ifNode: TsNode): EveryMsLift | null {
  const condition = ifNode.childForFieldName('condition');
  const consequence = ifNode.childForFieldName('consequence');
  if (condition === null || consequence === null) return null;
  // An `else` has nowhere to go: the node has one branch.
  if (ifNode.childForFieldName('alternative') !== null) return null;

  const test = condition.namedChild(condition.namedChildCount - 1);
  if (test === null || test.type !== 'binary_expression') return null;
  const comparison = test.child(1)?.text ?? '';
  if (comparison !== '>=' && comparison !== '>') return null;

  const elapsed = test.childForFieldName('left');
  const interval = test.childForFieldName('right');
  if (elapsed === null || interval === null) return null;
  if (elapsed.type !== 'binary_expression' || elapsed.child(1)?.text !== '-') return null;

  const now = elapsed.childForFieldName('left');
  const stamp = elapsed.childForFieldName('right');
  if (now === null || stamp === null || stamp.type !== 'identifier') return null;

  // Only a direct millis() call.
  //
  // The hoisted variant — `unsigned long currentMillis = millis();` at the top
  // of loop(), then `currentMillis - previousMillis` — samples the clock *once*
  // and reuses it for both the test and the restamp. control.everyMs calls
  // millis() twice. That is different machine code and a marginally later
  // restamp, so lifting it is a behaviour change, not a lift. Gate 1 catches it,
  // which is exactly what the round-trip requirement is for. Recorded as a
  // registry gap: the node would need to reuse a single sample.
  if (!isMillisCall(now)) return null;

  // The interval must be something the node's literal port can hold verbatim.
  //
  // A cast to unsigned long is unwrapped first, because that is exactly what
  // control.everyMs emits — `>= (unsigned long)(500)` — so a sketch ArduForge
  // generated would otherwise fail to match its own output, which is the case
  // that matters most for round-tripping a saved project.
  const intervalText = unwrapUnsignedLongCast(interval).text.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(intervalText) && !/^-?\d+[uUlL]*$/.test(intervalText)) return null;

  const body = statementsOf(consequence);
  const first = body[0];
  if (first === undefined || first.type !== 'expression_statement') return null;

  const assignment = first.namedChild(0);
  if (assignment === null || assignment.type !== 'assignment_expression') return null;
  if (assignment.childForFieldName('left')?.text !== stamp.text) return null;

  const operator = assignment.child(1)?.text ?? '';
  const right = assignment.childForFieldName('right');
  if (right === null) return null;

  // `last = millis()` only. `last += interval` is the drift-free variant: it
  // schedules from the previous deadline rather than from now, so a late tick
  // is caught up rather than pushing every later tick out. The node emits the
  // resampling form, so swapping one for the other changes when the chain
  // fires. Another registry gap, not something to paper over here.
  if (operator !== '=') return null;
  if (!isMillisCall(right)) return null;

  const declaration = timestampDeclaration(root, stamp.text);
  if (declaration === null) return null;

  // The decisive check. Occurrences allowed: the declarator, the subtraction,
  // and the restamp. Anything else means something still reads it.
  const uses = countIdentifier(root, stamp.text);
  if (uses.length !== 3) return null;

  return { ifNode, interval: intervalText, body: body.slice(1), absorbed: [declaration] };
}

/**
 * The rollover-unsafe form: `millis() >= last + interval`.
 *
 * Detected only so it can be warned about. §Non-negotiables 3 is explicit that
 * the importer never fixes the user's code — the problems panel is where fixes
 * get suggested, and a 49.7-day bug the user does not know they have is
 * precisely the kind of thing to tell them about rather than silently repair.
 */
export function matchRolloverUnsafe(ifNode: TsNode): boolean {
  const condition = ifNode.childForFieldName('condition');
  if (condition === null) return false;
  const test = condition.namedChild(condition.namedChildCount - 1);
  if (test === null || test.type !== 'binary_expression') return false;

  const comparison = test.child(1)?.text ?? '';
  if (comparison !== '>=' && comparison !== '>') return false;

  const left = test.childForFieldName('left');
  const right = test.childForFieldName('right');
  if (left === null || right === null) return false;

  return isMillisCall(left) && right.type === 'binary_expression' && right.child(1)?.text === '+';
}
