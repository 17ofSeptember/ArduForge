/**
 * Servo component lifting (IMPORT.md §4.1).
 *
 *     Servo myServo;                          // global declaration
 *     void setup() { myServo.attach(9); }     // initialisation
 *     void loop()  { myServo.write(angle); }  // use
 *
 * Three locations, one node — which is exactly why this is the riskiest lift in
 * the phase. A wrong pin is not a compile error. It is a signal on the wrong pin
 * driving physical hardware, and the user will look at their wiring first.
 *
 * So the correlation has to be *certain*, and every one of these is a refusal:
 *
 *  - `attach()` outside `setup()`, or inside an `if`/loop — the pin then depends
 *    on control flow the node cannot express.
 *  - `attach()` called more than once, or never.
 *  - A pin that is not a literal or a named constant.
 *  - The object declared as a pointer, a reference, an array, or with
 *    constructor arguments.
 *  - Any use of the object that is not a method this node set can represent.
 *
 * §Non-negotiables 2: a wrong lift is worse than no lift, because the user will
 * not notice. Under any doubt the sketch imports as Raw Global plus Raw
 * Statements, which is always correct.
 */
import type { TsNode } from '@/import/grammar';
import { canonicalFor } from '@/import/lower';

/** Methods the servo node set can represent. Anything else refuses the lift. */
const SUPPORTED = new Set(['attach', 'write', 'writeMicroseconds', 'read', 'detach', 'attached']);

/** Methods that map to a node; `attached` is readable but has no node. */
const METHOD_NODES: Record<string, string> = {
  write: 'servo.write',
  writeMicroseconds: 'servo.writeMicroseconds',
  detach: 'servo.detach',
};

export interface ServoUse {
  /** The statement or expression node for this call. */
  readonly node: TsNode;
  readonly method: string;
  readonly args: readonly TsNode[];
}

export interface ServoLift {
  /** The user's object name, for the report. */
  readonly name: string;
  /** Pin as written — `9`, or `SERVO_PIN`. */
  readonly pin: string;
  /** `Servo myServo;` — removed from the globals. */
  readonly declaration: TsNode;
  /** The `#include <Servo.h>` line, if present. The node re-adds it. */
  readonly include: TsNode | null;
  /** The `myServo.attach(9);` statement, replaced by a Servo Attach node. */
  readonly attach: TsNode;
  /** Every other call, keyed by the statement that contains it. */
  readonly uses: readonly ServoUse[];
}

export interface ServoRefusal {
  readonly name: string;
  readonly reason: string;
}

export interface ServoScan {
  readonly lifts: readonly ServoLift[];
  readonly refusals: readonly ServoRefusal[];
}

/** The statement wrapping a call, or the call itself when there is none. */
function attachStatementOf(call: TsNode): TsNode {
  let current: TsNode | null = call;
  while (current !== null) {
    if (current.type === 'expression_statement') return current;
    current = current.parent;
  }
  return call;
}

function walk(node: TsNode, visit: (node: TsNode) => void): void {
  visit(node);
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (child !== null) walk(child, visit);
  }
}

/** The function definition a node sits inside, by name. */
function enclosingFunction(node: TsNode): string | null {
  let current: TsNode | null = node.parent;
  while (current !== null) {
    if (current.type === 'function_definition') {
      const declarator = current.childForFieldName('declarator');
      return declarator?.childForFieldName('declarator')?.text ?? null;
    }
    current = current.parent;
  }
  return null;
}

/** True when anything between `node` and its function introduces a branch. */
function insideControlFlow(node: TsNode): boolean {
  let current: TsNode | null = node.parent;
  while (current !== null && current.type !== 'function_definition') {
    if (
      current.type === 'if_statement' ||
      current.type === 'for_statement' ||
      current.type === 'while_statement' ||
      current.type === 'do_statement' ||
      current.type === 'switch_statement' ||
      current.type === 'case_statement'
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** `Servo myServo;` at file scope — plain object, no pointer, no arguments. */
function servoDeclarations(root: TsNode): Map<string, TsNode> {
  const found = new Map<string, TsNode>();

  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child === null || child.type !== 'declaration') continue;
    if (child.childForFieldName('type')?.text !== 'Servo') continue;

    for (const declarator of child.namedChildren) {
      // A bare identifier is `Servo myServo;`. A pointer_declarator,
      // array_declarator or init_declarator is something this cannot represent.
      if (declarator.type === 'identifier') found.set(declarator.text, child);
    }
  }
  return found;
}

/** Every `name.method(...)` call in the unit. */
function methodCalls(root: TsNode, name: string): { call: TsNode; method: string; args: TsNode[] }[] {
  const found: { call: TsNode; method: string; args: TsNode[] }[] = [];

  walk(root, (node) => {
    if (node.type !== 'call_expression') return;
    const callee = node.childForFieldName('function');
    if (callee === null || callee.type !== 'field_expression') return;
    if (callee.childForFieldName('argument')?.text !== name) return;

    const method = callee.childForFieldName('field')?.text ?? '';
    const list = node.childForFieldName('arguments');
    const args: TsNode[] = [];
    for (let i = 0; i < (list?.namedChildCount ?? 0); i += 1) {
      const arg = list?.namedChild(i);
      if (arg !== null && arg !== undefined && arg.type !== 'comment') args.push(arg);
    }
    found.push({ call: node, method, args });
  });

  return found;
}

/** Every mention of the identifier, so uses outside a method call are caught. */
function identifierUses(root: TsNode, name: string): TsNode[] {
  const found: TsNode[] = [];
  walk(root, (node) => {
    if (node.type === 'identifier' && node.text === name) found.push(node);
  });
  return found;
}

/** The `#include <Servo.h>` directive, if the sketch has one. */
function servoInclude(root: TsNode): TsNode | null {
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child?.type === 'preproc_include' && /Servo\.h/.test(child.text)) return child;
  }
  return null;
}

/**
 * Whether a statement survives lowering as its own node.
 *
 * This is the real invariant behind component lifting, and it is not about
 * depth. A lift removes the object's declaration, so every reference to it must
 * end up inside a node the lift controls. If any *enclosing* statement stays
 * Raw, the reference escapes into raw text that still names an object which no
 * longer exists, and the sketch stops compiling — which is exactly how Sweep.ino
 * broke.
 *
 * So: a `servo.write` inside a canonical `for` is safe at any depth, because
 * that `for` becomes a control.for node. The same call inside a non-canonical
 * `for` is unsafe at depth one. Sweep still refuses, for the correct reason
 * rather than for its nesting.
 *
 * The check queries the same `canonicalFor` predicate the lowering uses, so the
 * two cannot disagree. Pass ordering is unchanged: the correlation still runs
 * before lowering, it just asks the same question lowering will ask.
 */
function reachableByLowering(statement: TsNode): boolean {
  let current: TsNode | null = statement.parent;

  while (current !== null) {
    switch (current.type) {
      case 'function_definition':
        // Reached the top of an entry function without meeting anything Raw.
        return true;

      case 'compound_statement':
      case 'else_clause':
        // Blocks are not statements; keep walking to whatever owns them.
        break;

      // These lower to nodes whose branches are real exec chains.
      case 'if_statement':
      case 'while_statement':
      case 'do_statement':
        break;

      case 'for_statement':
        // Only the shape control.for can express.
        if (canonicalFor(current) === null) return false;
        break;

      // switch is Phase 4.5 and stays Raw today, so anything inside it does too.
      default:
        return false;
    }
    current = current.parent;
  }

  return false;
}

/** The entry function a statement belongs to, or null if it is elsewhere. */
function entryFunctionOf(statement: TsNode): string | null {
  let current: TsNode | null = statement;
  while (current !== null) {
    if (current.type === 'function_definition') {
      return current.childForFieldName('declarator')?.childForFieldName('declarator')?.text ?? null;
    }
    current = current.parent;
  }
  return null;
}

/** A use must both lower and live in an entry function's chain. */
function atEntryTopLevel(statement: TsNode): boolean {
  const entry = entryFunctionOf(statement);
  if (entry !== 'setup' && entry !== 'loop') return false;
  return reachableByLowering(statement);
}

/** The statement containing an expression, for replacement. */
function enclosingStatement(node: TsNode): TsNode | null {
  let current: TsNode | null = node;
  while (current !== null) {
    if (current.type === 'expression_statement') return current;
    current = current.parent;
  }
  return null;
}

/**
 * Finds every liftable Servo, and records why each rejected one was rejected.
 *
 * Refusals are returned rather than swallowed: §4.1 requires an ambiguous
 * correlation to be *reported*, not silently downgraded, so the user knows the
 * object stayed as Custom C++ and why.
 */
export function scanServos(root: TsNode): ServoScan {
  const lifts: ServoLift[] = [];
  const refusals: ServoRefusal[] = [];
  const declarations = servoDeclarations(root);

  // Two objects are not automatically ambiguous, but they are the case §4.1
  // singles out, so each is still checked independently and refused on its own
  // merits rather than as a pair.
  for (const [name, declaration] of declarations) {
    const calls = methodCalls(root, name);

    const unsupported = calls.find((call) => !SUPPORTED.has(call.method));
    if (unsupported !== undefined) {
      refusals.push({ name, reason: `it calls ${name}.${unsupported.method}(), which has no node` });
      continue;
    }

    // Every mention must be one of: the declarator, or the object of a call.
    const mentions = identifierUses(root, name).length;
    const accountedFor = 1 + calls.length;
    if (mentions !== accountedFor) {
      refusals.push({
        name,
        reason: `${name} is used somewhere other than a method call — a pointer, a reference, or passed to a function`,
      });
      continue;
    }

    const attaches = calls.filter((call) => call.method === 'attach');
    if (attaches.length === 0) {
      refusals.push({ name, reason: `${name}.attach() is never called, so the pin is unknown` });
      continue;
    }
    if (attaches.length > 1) {
      refusals.push({ name, reason: `${name}.attach() is called more than once, so the pin is ambiguous` });
      continue;
    }

    const attach = attaches[0];
    if (attach === undefined) continue;

    if (!atEntryTopLevel(attachStatementOf(attach.call))) {
      refusals.push({ name, reason: `${name}.attach() is nested rather than a plain statement in setup()` });
      continue;
    }
    if (enclosingFunction(attach.call) !== 'setup') {
      refusals.push({ name, reason: `${name}.attach() is not in setup(), so the pin depends on when it runs` });
      continue;
    }
    if (insideControlFlow(attach.call)) {
      refusals.push({ name, reason: `${name}.attach() is inside a branch, so the pin depends on control flow` });
      continue;
    }

    // attach(pin) only. attach(pin, min, max) carries pulse limits the node
    // cannot express, and dropping them would change how far the servo travels.
    if (attach.args.length !== 1) {
      refusals.push({
        name,
        reason:
          attach.args.length === 0
            ? `${name}.attach() has no pin`
            : `${name}.attach() sets custom pulse limits, which the Servo node cannot represent`,
      });
      continue;
    }

    const pinNode = attach.args[0];
    if (pinNode === undefined) continue;
    const pin = pinNode.text.trim();
    // A literal or a named constant. Anything computed means the pin is not
    // knowable from the source, and guessing drives the wrong hardware.
    if (!/^\d+$/.test(pin) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(pin)) {
      refusals.push({ name, reason: `${name}.attach() takes a computed pin, which cannot be read from the source` });
      continue;
    }

    const attachStatement = enclosingStatement(attach.call);
    if (attachStatement === null) {
      refusals.push({ name, reason: `${name}.attach() is not a plain statement` });
      continue;
    }

    const uses: ServoUse[] = [];
    let usable = true;
    for (const call of calls) {
      if (call.method === 'attach') continue;
      if (call.method === 'attached' || call.method === 'read') {
        // Both are expressions rather than statements, and component lifting
        // does not reach the expression path yet. Refusing is correct: a
        // half-lifted object would leave a node and a raw call describing the
        // same servo.
        refusals.push({ name, reason: `${name}.${call.method}() is read as a value, which is not lifted yet` });
        usable = false;
        break;
      }
      if (METHOD_NODES[call.method] === undefined) {
        usable = false;
        break;
      }

      const statement = enclosingStatement(call.call);
      if (statement === null || !atEntryTopLevel(statement)) {
        refusals.push({
          name,
          reason: `${name}.${call.method}() sits inside something that stays as Custom C++, where the call would still name an object the lift had removed`,
        });
        usable = false;
        break;
      }
      uses.push({ node: call.call, method: call.method, args: call.args });
    }
    if (!usable) continue;

    lifts.push({
      name,
      pin,
      declaration,
      include: servoInclude(root),
      attach: attachStatement,
      uses,
    });
  }

  return { lifts, refusals };
}

export { METHOD_NODES as SERVO_METHOD_NODES };

/**
 * Pins 9 and 10 lose PWM the moment the Servo library is used, on every AVR
 * board with a 16-bit Timer1. `analogWrite` on either then silently does
 * nothing — the pin holds whatever the servo timer leaves it at. Worth saying at
 * import, not only at Verify, because the sketch compiles either way.
 */
export function pwmConflictPins(root: TsNode, servoPins: readonly string[]): string[] {
  const attached = new Set(servoPins);
  const conflicts = new Set<string>();

  walk(root, (node) => {
    if (node.type !== 'call_expression') return;
    if (node.childForFieldName('function')?.text !== 'analogWrite') return;
    const first = node.childForFieldName('arguments')?.namedChild(0);
    const pin = first?.text.trim();
    if (pin === undefined) return;
    if ((pin === '9' || pin === '10') && !attached.has(pin)) conflicts.add(pin);
    // Also flag analogWrite on the very pin a servo took.
    if (attached.has(pin)) conflicts.add(pin);
  });

  return [...conflicts].sort();
}
