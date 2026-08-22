/**
 * Statement lowering (IMPORT.md §Phase 2).
 *
 * Walks setup(), loop() and every user function, emitting exec chains **in
 * exactly source order**. Order is the invariant here: reordering statements —
 * including hoisting a declaration to the top of a block because it reads more
 * tidily — is a semantic change, not a formatting one.
 *
 * ## The rule for arguments
 *
 * A statement lowers to a native node when its *shape* is recognized. Its
 * arguments are then handled one of two ways, and never a third:
 *
 *   - A literal — a number in the notation the user wrote, or a constant like
 *     HIGH, A0, LED_BUILTIN — becomes an inline literal on the input port.
 *     Non-string ports emit strings bare, so `0x1A` comes back as `0x1A` and
 *     not as `26`.
 *   - Anything else becomes a **Raw Expression** node wired to that port, which
 *     is what §Fallback granularity prescribes for an unmappable expression.
 *
 * There is no placeholder. A placeholder would generate code that differs from
 * the source, which breaks Gate 1 — the floor this phase makes load-bearing for
 * the first time.
 *
 * ## What deliberately does not lower yet, and why
 *
 * Each of these is a property of the *node model*, not of the parser, so
 * forcing them would produce a wrong graph rather than a missing one:
 *
 *   - **Declarations with a computed initializer.** `var.declare`'s `initial`
 *     is a coercing text field: `initialiserFor` runs `Number()` over it, so
 *     `int reading = digitalRead(pin);` would come back as `int reading = 0;`.
 *     Scope is no longer the blocker — the initializer is.
 *   - **Non-canonical for loops.** `control.for` emits
 *     `for (int i = 0; i < n; i++)`. A loop that counts differently — down, by
 *     twos, from a non-zero start, or with `<=` — cannot be expressed by it, and
 *     rebuilding one from a While plus a counter would be a lie about the
 *     source.
 *   - **`Serial.print(x)` and `return x;` with a non-literal.** Both ports are
 *     typed `string`, so a non-string argument is wrapped in `String(...)` —
 *     a different overload and different machine code.
 *   - **switch.** Phase 4 decides between State Machine, If-chain, and Raw.
 */
import type { ForgeEdge, ForgeNode, NodeComments } from '@/graph/model';
import type { PortType } from '@/nodes/types';
import type { CommentMap } from '@/import/comments';
import type { TsNode } from '@/import/grammar';
import { matchEveryMs, matchRolloverUnsafe, type EveryMsLift } from '@/import/everyMs';

// ── graph draft ──────────────────────────────────────────────────────────────

export class GraphDraft {
  readonly nodes: ForgeNode[] = [];
  readonly edges: ForgeEdge[] = [];
  private readonly used = new Set<string>();

  /**
   * Ids come from a hash of the source position (§Non-negotiables 4), never a
   * counter. The suffix only ever grows on a genuine collision, which keeps the
   * same sketch importing to the same ids every time.
   */
  id(role: string, position: number): string {
    let hash = 0x811c9dc5;
    const key = `${role}:${position}`;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    let id = `${role}_${hash.toString(36)}`;
    let salt = 0;
    while (this.used.has(id)) {
      salt += 1;
      id = `${role}_${hash.toString(36)}_${salt}`;
    }
    this.used.add(id);
    return id;
  }

  node(
    id: string,
    defId: string,
    options: {
      literals?: Record<string, string | number | boolean>;
      config?: Record<string, string | number | boolean>;
      comments?: NodeComments;
      x?: number;
      y?: number;
    } = {},
  ): string {
    const data: ForgeNode['data'] = {
      defId,
      literals: options.literals ?? {},
      config: options.config ?? {},
      ...(options.comments === undefined ? {} : { comments: options.comments }),
    };
    this.nodes.push({ id, type: 'forge', position: { x: options.x ?? 0, y: options.y ?? 0 }, data });
    return id;
  }

  exec(source: string, target: string, output = 'then'): void {
    this.edges.push({
      id: `x_${source}_${output}_${target}`,
      source,
      target,
      sourceHandle: `exec-out:${output}`,
      targetHandle: 'exec-in',
      type: 'forge',
      data: { kind: 'exec', portType: 'exec' },
    });
  }

  data(source: string, sourcePort: string, target: string, targetPort: string, portType: PortType): void {
    this.edges.push({
      id: `d_${source}_${target}_${targetPort}`,
      source,
      target,
      sourceHandle: `out:${sourcePort}`,
      targetHandle: `in:${targetPort}`,
      type: 'forge',
      data: { kind: 'data', portType },
    });
  }
}

// ── recognizing literals ─────────────────────────────────────────────────────

/**
 * Constants a user writes as names and expects back as names. §Phase 3 is
 * explicit that emitting `14` where the user wrote `A0` is a fidelity failure
 * even though it compiles identically.
 */
const CONSTANTS = new Set([
  'HIGH',
  'LOW',
  'INPUT',
  'OUTPUT',
  'INPUT_PULLUP',
  'LED_BUILTIN',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'MSBFIRST',
  'LSBFIRST',
  'true',
  'false',
]);

function isLiteralArgument(node: TsNode): boolean {
  if (node.type === 'number_literal' || node.type === 'char_literal') return true;
  if (node.type === 'true' || node.type === 'false') return true;
  if (node.type === 'identifier') return CONSTANTS.has(node.text);
  // A negative number is a unary expression around a literal.
  if (node.type === 'unary_expression') {
    const operand = node.child(1);
    return node.child(0)?.text === '-' && operand !== null && operand.type === 'number_literal';
  }
  return false;
}

const PIN_MODES = new Set(['INPUT', 'OUTPUT', 'INPUT_PULLUP']);
const SUPPORTED_BAUDS = new Set(['9600', '57600', '115200']);

/**
 * Comments codegen writes into empty branches. They are ArduForge's own output,
 * not the user's, and treating them as content makes re-importing a generated
 * sketch produce an `else` branch the original never had — which breaks
 * idempotence and puts a node on the canvas that stands for nothing.
 */
const COMPARISONS = new Set(['<', '>', '<=', '>=', '==', '!=']);

/** Arithmetic and bitwise operators, with the node each maps to. */
const ARITHMETIC: Record<string, { defId: string; integerOnly: boolean }> = {
  '+': { defId: 'math.add', integerOnly: false },
  '-': { defId: 'math.subtract', integerOnly: false },
  '*': { defId: 'math.multiply', integerOnly: false },
  '/': { defId: 'math.divide', integerOnly: false },
  '%': { defId: 'math.modulo', integerOnly: true },
  '&': { defId: 'logic.bitAnd', integerOnly: true },
  '|': { defId: 'logic.bitOr', integerOnly: true },
  '^': { defId: 'logic.bitXor', integerOnly: true },
  '<<': { defId: 'logic.shiftLeft', integerOnly: true },
  '>>': { defId: 'logic.shiftRight', integerOnly: true },
};

/**
 * Builtins whose node ports match the real C++ return and argument types, so
 * lowering them introduces no cast. `min`, `max`, `abs` and `constrain` are
 * deliberately absent: their ports are float, and routing integer arguments
 * through them turns integer arithmetic into floating-point arithmetic.
 */
const BUILTIN_EXPRESSIONS: Record<
  string,
  { defId: string; out: PortType; ports: readonly { id: string; type: PortType }[] }
> = {
  analogRead: { defId: 'io.analogRead', out: 'int', ports: [{ id: 'pin', type: 'pin' }] },
  digitalRead: { defId: 'io.digitalRead', out: 'bool', ports: [{ id: 'pin', type: 'pin' }] },
  millis: { defId: 'time.millis', out: 'int', ports: [] },
  micros: { defId: 'time.micros', out: 'int', ports: [] },
  random: {
    defId: 'math.random',
    out: 'int',
    ports: [
      { id: 'low', type: 'int' },
      { id: 'high', type: 'int' },
    ],
  },
  map: {
    defId: 'math.map',
    out: 'int',
    ports: [
      { id: 'value', type: 'int' },
      { id: 'fromLow', type: 'int' },
      { id: 'fromHigh', type: 'int' },
      { id: 'toLow', type: 'int' },
      { id: 'toHigh', type: 'int' },
    ],
  },
  pulseIn: {
    defId: 'io.pulseIn',
    out: 'int',
    ports: [
      { id: 'pin', type: 'pin' },
      { id: 'level', type: 'bool' },
      { id: 'timeout', type: 'int' },
    ],
  },
};

/**
 * Whether a value of type `from` reaches a port of type `to` untouched.
 * Mirrors applyCast: only float and string ports ever wrap their input.
 */
function castFree(from: PortType, to: PortType): boolean {
  if (from === to) return true;
  if (to === 'string') return false;
  if (to === 'float') return !(from === 'int' || from === 'pin' || from === 'bool');
  return true;
}

/**
 * The one `for` shape `control.for` can express: `for (int i = 0; i < n; i++)`.
 *
 * Shared with the component correlation, which has to know whether a `for`
 * lowers before it can decide whether a component use nested inside it is safe.
 * Two copies of this test would drift, and the direction it would drift is
 * towards a lift the lowering does not actually support.
 */
export function canonicalFor(node: TsNode): { name: TsNode; limit: TsNode; body: TsNode } | null {
  const initializer = node.childForFieldName('initializer');
  const condition = node.childForFieldName('condition');
  const update = node.childForFieldName('update');
  const body = node.childForFieldName('body');
  if (initializer === null || condition === null || update === null || body === null) return null;

  // init: exactly `int NAME = 0`
  if (initializer.type !== 'declaration') return null;
  if (initializer.childForFieldName('type')?.text !== 'int') return null;
  const declarator = initializer.namedChildren.find((child) => child.type === 'init_declarator');
  const name = declarator?.childForFieldName('declarator');
  const start = declarator?.childForFieldName('value');
  if (name === undefined || name === null || name.type !== 'identifier') return null;
  if (start === undefined || start === null || start.text !== '0') return null;

  // cond: exactly `NAME < LIMIT`
  if (condition.type !== 'binary_expression') return null;
  if (condition.child(1)?.text !== '<') return null;
  if (condition.childForFieldName('left')?.text !== name.text) return null;
  const limit = condition.childForFieldName('right');
  if (limit === null || limit === undefined) return null;

  // step: exactly `NAME++` or `++NAME`
  if (update.type !== 'update_expression') return null;
  if (update.childForFieldName('operator')?.text !== '++' && !update.text.includes('++')) return null;
  if (update.childForFieldName('argument')?.text !== name.text) return null;

  return { name, limit, body };
}

/** The four types Declare Variable offers. Anything else stays raw. */
const DECLARABLE_TYPES = new Set(['int', 'float', 'bool', 'String']);

function declaredPortType(cppType: string): PortType {
  if (cppType === 'float') return 'float';
  if (cppType === 'bool') return 'bool';
  if (cppType === 'String') return 'string';
  return 'int';
}

const CODEGEN_MARKERS = new Set(['// nothing connected', '// (loop in the execution chain stops here)']);

// ── the lowerer ──────────────────────────────────────────────────────────────

/** A statement a component lift replaces with a node. */
export interface ComponentPlan {
  readonly defId: string;
  readonly config: Record<string, string>;
  readonly ports: readonly { id: string; type: PortType; arg: TsNode }[];
}

export interface Chain {
  readonly first: string | null;
  readonly last: string | null;
  /** Statements in this chain that landed on native nodes. */
  readonly native: number;
  readonly raw: number;
}

export class Lowerer {
  constructor(
    private readonly source: string,
    private readonly comments: CommentMap,
    private readonly draft: GraphDraft,
    private readonly userFunctions: ReadonlySet<string>,
    /** Declared C++ type per variable name, for typing Get Variable nodes. */
    private readonly variableTypes: ReadonlyMap<string, string> = new Map(),
    /** Declared return type per user function, for value-returning calls. */
    private readonly functionReturns: ReadonlyMap<string, string> = new Map(),
    /**
     * Source offsets of statements to drop entirely — the awrylink_begin and
     * awrylink_poll calls codegen injected. They are ours, not the user's, and
     * re-adding them is codegen's job on the way back out.
     */
    private readonly skip: ReadonlySet<number> = new Set(),
    /** The whole unit, for checks a single statement cannot make. */
    private readonly root: TsNode | null = null,
    /** Warnings raised during lowering, e.g. a rollover-unsafe timer. */
    private readonly warn: (node: TsNode, code: string, message: string) => void = () => {},
    /** Statements a component lift replaces, keyed by source offset. */
    private readonly components: ReadonlyMap<number, ComponentPlan> = new Map(),
  ) {}

  /** Declarations absorbed into a lifted node; skipped where they were written. */
  readonly absorbed = new Set<number>();
  /** Patterns lifted, for the import report. */
  readonly lifted: string[] = [];
  private readonly plans = new Map<number, EveryMsLift>();

  private commentsFor(node: TsNode): NodeComments | undefined {
    const found = this.comments.get(node.startIndex);
    if (found === undefined) return undefined;
    const leading = found.leading.length > 0 ? found.leading : undefined;
    const trailing = found.trailing.length > 0 ? found.trailing : undefined;
    if (leading === undefined && trailing === undefined) return undefined;
    return { ...(leading === undefined ? {} : { leading }), ...(trailing === undefined ? {} : { trailing }) };
  }

  /** Statement children of a block, in source order. Comments are not statements. */
  private statementsOf(block: TsNode): TsNode[] {
    const found: TsNode[] = [];
    for (let i = 0; i < block.childCount; i += 1) {
      const child = block.child(i);
      if (child === null || !child.isNamed || child.type === 'comment') continue;
      found.push(child);
    }
    return found;
  }

  /**
   * Lowers a block into one chain, preserving source order exactly. Every
   * statement is linked to the one that follows it, in the order it was
   * written; nothing is grouped, sorted, or hoisted.
   */
  lowerBlock(block: TsNode): Chain {
    const statements = this.statementsOf(block);
    this.planLifts(statements);

    // A block with nothing but comments in it. attachComments gives those to
    // the block itself, since there is no statement to own them, so without
    // this they would have no node to live on and would be silently dropped —
    // `void setup() { // put your setup code here }` is the commonest sketch in
    // existence and consists of exactly this.
    if (statements.length === 0) {
      const own = this.commentsFor(block);
      const text = [...(own?.leading ?? []), ...(own?.trailing ?? [])]
        .filter((comment) => !CODEGEN_MARKERS.has(comment.trim()))
        .join('\n');
      if (text === '') return { first: null, last: null, native: 0, raw: 0 };
      const id = this.draft.id('c', block.startIndex);
      this.draft.node(id, 'custom.statement', { config: { code: text } });
      return { first: id, last: id, native: 0, raw: 0 };
    }

    let first: string | null = null;
    let last: string | null = null;
    let native = 0;
    let raw = 0;

    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      if (statement === undefined) continue;
      if (this.skip.has(statement.startIndex)) continue;
      // A declaration the Every-N-Milliseconds node swallowed. It is not lost:
      // the node re-emits an equivalent one.
      if (this.absorbed.has(statement.startIndex)) continue;
      const isLast = index === statements.length - 1;

      const lowered = this.lowerStatement(statement, isLast);
      if (lowered.first === null) continue;

      native += lowered.native;
      raw += lowered.raw;
      if (first === null) first = lowered.first;
      if (last !== null) this.draft.exec(last, lowered.first, this.continuationOf(last));
      last = lowered.last;

      // A node with no continuation output ends the chain; anything after it
      // could not be reached, so it must not have been lowered natively.
      if (last === null) break;
    }

    return { first, last, native, raw };
  }

  /**
   * Finds the timing patterns in a block before lowering starts.
   *
   * A pre-pass is required because the declarations a lift absorbs sit *before*
   * the `if` that triggers it — a hoisted `currentMillis`, or a `static unsigned
   * long last` — and by the time the walk reaches the `if` they would already
   * have been lowered into nodes of their own.
   */
  private planLifts(statements: readonly TsNode[]): void {
    if (this.root === null) return;

    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      if (statement === undefined || statement.type !== 'if_statement') continue;

      if (matchRolloverUnsafe(statement)) {
        this.warn(
          statement,
          'rollover-unsafe-timer',
          'This timer compares millis() against a sum, which stops firing after 49.7 days when the sum wraps. ' +
            'It was imported exactly as written — the safe form is millis() - last >= interval.',
        );
        continue;
      }

      const plan = matchEveryMs(this.root, statement);
      if (plan === null) continue;

      this.plans.set(statement.startIndex, plan);
      for (const declaration of plan.absorbed) this.absorbed.add(declaration.startIndex);
    }
  }

  private lowerEveryMs(plan: EveryMsLift): Chain {
    const id = this.draft.id('every', plan.ifNode.startIndex);
    const comments = this.commentsFor(plan.ifNode);
    // A bare decimal is stored as a number, not as source text. There is no
    // notation to preserve in `500`, and a number is what a hand-built graph
    // holds — so the imported graph matches the graph that generated the
    // sketch, which is what the Tier A structural check compares.
    const interval = /^-?\d+$/.test(plan.interval) ? Number(plan.interval) : plan.interval;
    this.draft.node(id, 'control.everyMs', {
      literals: { ms: interval },
      ...(comments === undefined ? {} : { comments }),
    });
    this.lifted.push(`Every ${plan.interval}ms`);

    let first: string | null = null;
    let last: string | null = null;
    let native = 1;
    let raw = 0;

    for (let index = 0; index < plan.body.length; index += 1) {
      const statement = plan.body[index];
      if (statement === undefined) continue;
      const lowered = this.lowerStatement(statement, index === plan.body.length - 1);
      if (lowered.first === null) continue;
      native += lowered.native;
      raw += lowered.raw;
      if (first === null) first = lowered.first;
      else if (last !== null) this.draft.exec(last, lowered.first, this.continuationOf(last));
      last = lowered.last;
      if (last === null) break;
    }

    if (first !== null) this.draft.exec(id, first, 'then');
    // `after` carries the chain on past the timer.
    return { first: id, last: id, native, raw };
  }

  /** Which exec output continues the chain after a given node. */
  private continuationOf(nodeId: string): string {
    const node = this.draft.nodes.find((candidate) => candidate.id === nodeId);
    const defId = node?.data.defId ?? '';
    if (defId === 'control.while' || defId === 'control.doWhile' || defId === 'control.for') return 'done';
    if (defId === 'control.everyMs') return 'after';
    return 'then';
  }

  private rawStatement(node: TsNode): Chain {
    const id = this.draft.id('raw', node.startIndex);
    const comments = this.commentsFor(node);
    this.draft.node(id, 'custom.statement', {
      config: { code: dedentStatement(this.source.slice(node.startIndex, node.endIndex)) },
      ...(comments === undefined ? {} : { comments }),
    });
    return { first: id, last: id, native: 0, raw: 1 };
  }

  /**
   * One statement. `isLast` matters because `control.if` has no continuation
   * output — an `if` with anything after it cannot be represented as a chain.
   */
  lowerStatement(node: TsNode, isLast: boolean): Chain {
    const component = this.components.get(node.startIndex);
    if (component !== undefined) return this.lowerComponent(node, component);

    switch (node.type) {
      case 'expression_statement':
        return this.lowerExpressionStatement(node);
      case 'if_statement': {
        const plan = this.plans.get(node.startIndex);
        if (plan !== undefined) return this.lowerEveryMs(plan);
        return this.lowerIf(node);
      }
      case 'while_statement':
        return this.lowerWhile(node, 'control.while');
      case 'do_statement':
        return this.lowerDoWhile(node);
      case 'for_statement':
        return this.lowerFor(node);
      case 'declaration':
        return this.lowerDeclaration(node);
      // These three have no exec output at all, so they end a chain. Lowering
      // one that is *not* last would orphan everything after it — the nodes
      // would exist but nothing would reach them, and their code would vanish
      // from the output. That is silent loss, so they only lower when last.
      case 'break_statement':
        return isLast ? this.simple(node, 'control.break') : this.rawStatement(node);
      case 'continue_statement':
        return isLast ? this.simple(node, 'control.continue') : this.rawStatement(node);
      case 'return_statement':
        // Only a bare `return;`. With a value the port is typed string and the
        // argument would come back wrapped in String(...).
        return isLast && node.namedChildCount === 0
          ? this.simple(node, 'control.return')
          : this.rawStatement(node);
      default:
        return this.rawStatement(node);
    }
  }

  /**
   * A statement replaced by a component node — a Servo attach or write.
   *
   * The object name travels into the node's `name` config so every node for the
   * same servo derives the same C++ object, and so the inspector shows the name
   * the user chose rather than a generated one.
   */
  private lowerComponent(node: TsNode, plan: ComponentPlan): Chain {
    const id = this.draft.id('cmp', node.startIndex);
    const comments = this.commentsFor(node);
    const literals: Record<string, string | number | boolean> = {};
    const wires: { arg: TsNode; port: string; type: PortType }[] = [];

    for (const port of plan.ports) {
      const inner = unwrapParens(port.arg);
      const literal = this.literalFor(inner, port.type);
      if (literal === null) wires.push({ arg: inner, port: port.id, type: port.type });
      else literals[port.id] = literal;
    }

    this.draft.node(id, plan.defId, {
      literals,
      config: plan.config,
      ...(comments === undefined ? {} : { comments }),
    });
    for (const wire of wires) this.wireExpression(wire.arg, id, wire.port, wire.type);

    return { first: id, last: id, native: 1, raw: 0 };
  }

  private simple(node: TsNode, defId: string): Chain {
    const id = this.draft.id('n', node.startIndex);
    const comments = this.commentsFor(node);
    this.draft.node(id, defId, { ...(comments === undefined ? {} : { comments }) });
    return { first: id, last: id, native: 1, raw: 0 };
  }

  // ── calls and assignments ──

  private lowerExpressionStatement(node: TsNode): Chain {
    const inner = node.namedChild(0);
    if (inner === null) return this.rawStatement(node);
    if (inner.type !== 'call_expression') return this.rawStatement(node);

    const callee = inner.childForFieldName('function');
    const argumentList = inner.childForFieldName('arguments');
    if (callee === null || argumentList === null) return this.rawStatement(node);

    const args: TsNode[] = [];
    for (let i = 0; i < argumentList.namedChildCount; i += 1) {
      const arg = argumentList.namedChild(i);
      if (arg !== null && arg.type !== 'comment') args.push(arg);
    }

    if (callee.type === 'identifier') return this.lowerBuiltinCall(node, callee.text, args);
    // Serial.println(...) and friends.
    if (callee.type === 'field_expression') return this.lowerSerialCall(node, callee, args);
    return this.rawStatement(node);
  }

  private lowerBuiltinCall(statement: TsNode, name: string, args: readonly TsNode[]): Chain {
    const emit = (defId: string, ports: readonly { port: string; type: PortType; arg: TsNode }[],
                  config: Record<string, string> = {}): Chain => {
      const id = this.draft.id('n', statement.startIndex);
      const literals: Record<string, string | number | boolean> = {};
      const wires: { arg: TsNode; port: string; type: PortType }[] = [];

      for (const { port, type, arg } of ports) {
        // Unwrap before wiring, not just before the literal test. A Raw
        // Expression emits parenthesized, so storing `(x)` rather than `x`
        // makes every round trip add another pair — invisible to Gate 1 and
        // caught only by idempotence.
        const inner = unwrapParens(arg);
        const literal = this.literalFor(inner, type);
        if (literal === null) wires.push({ arg: inner, port, type });
        else literals[port] = literal;
      }

      const comments = this.commentsFor(statement);
      this.draft.node(id, defId, {
        literals,
        config,
        ...(comments === undefined ? {} : { comments }),
      });
      for (const wire of wires) this.wireExpression(wire.arg, id, wire.port, wire.type);
      return { first: id, last: id, native: 1, raw: 0 };
    };

    switch (name) {
      case 'pinMode': {
        const [pin, mode] = args;
        if (args.length !== 2 || pin === undefined || mode === undefined) break;
        // The mode is a config select, so it has to be one of the three the
        // node offers; anything else would be silently replaced.
        if (mode.type !== 'identifier' || !PIN_MODES.has(mode.text)) break;
        return emit('io.pinMode', [{ port: 'pin', type: 'pin', arg: pin }], { mode: mode.text });
      }
      case 'digitalWrite': {
        const [pin, value] = args;
        if (args.length !== 2 || pin === undefined || value === undefined) break;
        return emit('io.digitalWrite', [
          { port: 'pin', type: 'pin', arg: pin },
          { port: 'value', type: 'bool', arg: value },
        ]);
      }
      case 'analogWrite': {
        const [pin, value] = args;
        if (args.length !== 2 || pin === undefined || value === undefined) break;
        return emit('io.analogWrite', [
          { port: 'pin', type: 'pin', arg: pin },
          { port: 'value', type: 'int', arg: value },
        ]);
      }
      case 'delay': {
        const [ms] = args;
        if (args.length !== 1 || ms === undefined) break;
        return emit('control.delay', [{ port: 'ms', type: 'int', arg: ms }]);
      }
      case 'delayMicroseconds': {
        const [us] = args;
        if (args.length !== 1 || us === undefined) break;
        return emit('control.delayMicroseconds', [{ port: 'us', type: 'int', arg: us }]);
      }
      case 'noTone': {
        const [pin] = args;
        if (args.length !== 1 || pin === undefined) break;
        return emit('io.noTone', [{ port: 'pin', type: 'pin', arg: pin }]);
      }
      case 'tone': {
        const [pin, frequency, duration] = args;
        if (pin === undefined || frequency === undefined) break;
        if (args.length === 2) {
          // The node omits the third argument only when duration reads as 0.
          return emit(
            'io.tone',
            [
              { port: 'pin', type: 'pin', arg: pin },
              { port: 'frequency', type: 'int', arg: frequency },
            ],
          );
        }
        if (args.length === 3 && duration !== undefined) {
          return emit('io.tone', [
            { port: 'pin', type: 'pin', arg: pin },
            { port: 'frequency', type: 'int', arg: frequency },
            { port: 'duration', type: 'int', arg: duration },
          ]);
        }
        break;
      }
      default:
        break;
    }

    // A call to a function this sketch defines. Arguments travel verbatim as
    // text, which preserves them exactly; a library call does not qualify
    // because its object is not a plain identifier.
    if (this.userFunctions.has(name)) {
      const id = this.draft.id('n', statement.startIndex);
      const comments = this.commentsFor(statement);
      const argText = args.map((arg) => this.source.slice(arg.startIndex, arg.endIndex)).join(', ');
      this.draft.node(id, 'event.callFunction', {
        config: { name, args: argText },
        ...(comments === undefined ? {} : { comments }),
      });
      return { first: id, last: id, native: 1, raw: 0 };
    }

    return this.rawStatement(statement);
  }

  private lowerSerialCall(statement: TsNode, callee: TsNode, args: readonly TsNode[]): Chain {
    const object = callee.childForFieldName('argument');
    const field = callee.childForFieldName('field');
    if (object?.text !== 'Serial' || field === null) return this.rawStatement(statement);

    const method = field.text;
    const comments = this.commentsFor(statement);

    if (method === 'begin' && args.length === 1) {
      const baud = args[0];
      if (baud === undefined || baud.type !== 'number_literal' || !SUPPORTED_BAUDS.has(baud.text)) {
        return this.rawStatement(statement);
      }
      const id = this.draft.id('n', statement.startIndex);
      this.draft.node(id, 'serial.begin', {
        config: { baud: baud.text },
        ...(comments === undefined ? {} : { comments }),
      });
      return { first: id, last: id, native: 1, raw: 0 };
    }

    if (method === 'flush' && args.length === 0) {
      const id = this.draft.id('n', statement.startIndex);
      this.draft.node(id, 'serial.flush', { ...(comments === undefined ? {} : { comments }) });
      return { first: id, last: id, native: 1, raw: 0 };
    }

    // Only a string literal. The value port is typed string, so anything else
    // arrives wrapped in String(...) — a different overload, different machine
    // code, and a broken Gate 1.
    if ((method === 'print' || method === 'println') && args.length === 1) {
      const value = args[0];
      if (value === undefined || value.type !== 'string_literal') return this.rawStatement(statement);
      const text = decodeStringLiteral(value.text);
      if (text === null) return this.rawStatement(statement);

      const id = this.draft.id('n', statement.startIndex);
      this.draft.node(id, method === 'print' ? 'serial.print' : 'serial.println', {
        literals: { value: text },
        ...(comments === undefined ? {} : { comments }),
      });
      return { first: id, last: id, native: 1, raw: 0 };
    }

    return this.rawStatement(statement);
  }

  // ── control flow ──

  private lowerIf(node: TsNode): Chain {
    const condition = node.childForFieldName('condition');
    const consequence = node.childForFieldName('consequence');
    if (condition === null || consequence === null) return this.rawStatement(node);

    const id = this.draft.id('n', node.startIndex);
    const comments = this.commentsFor(node);
    this.draft.node(id, 'control.if', { ...(comments === undefined ? {} : { comments }) });

    const inner = unwrapParens(condition);
    const literal = this.literalFor(inner, 'bool');
    if (literal === null) this.wireExpression(inner, id, 'condition', 'bool');
    else this.setLiteral(id, 'condition', literal);

    let native = 1;
    let raw = 0;

    const trueChain = this.lowerBranch(consequence);
    if (trueChain.first !== null) this.draft.exec(id, trueChain.first, 'true');
    native += trueChain.native;
    raw += trueChain.raw;

    const alternative = node.childForFieldName('alternative');
    if (alternative !== null) {
      // `else_clause` wraps the branch; an `else if` chains another statement.
      const body = alternative.type === 'else_clause' ? alternative.namedChild(0) : alternative;
      if (body !== null) {
        const falseChain = this.lowerBranch(body);
        if (falseChain.first !== null) this.draft.exec(id, falseChain.first, 'false');
        native += falseChain.native;
        raw += falseChain.raw;
      }
    }

    // `then` continues after the branches rejoin, so the if no longer has to
    // be the last statement in its block.
    return { first: id, last: id, native, raw };
  }

  /** A branch body: a block, or a single statement written without braces. */
  private lowerBranch(node: TsNode): Chain {
    if (node.type === 'compound_statement') return this.lowerBlock(node);
    const lowered = this.lowerStatement(node, true);
    return lowered;
  }

  private lowerWhile(node: TsNode, defId: string): Chain {
    const condition = node.childForFieldName('condition');
    const body = node.childForFieldName('body');
    if (condition === null || body === null) return this.rawStatement(node);

    const id = this.draft.id('n', node.startIndex);
    const comments = this.commentsFor(node);
    this.draft.node(id, defId, { ...(comments === undefined ? {} : { comments }) });

    const inner = unwrapParens(condition);
    const literal = this.literalFor(inner, 'bool');
    if (literal === null) this.wireExpression(inner, id, 'condition', 'bool');
    else this.setLiteral(id, 'condition', literal);

    const bodyChain = this.lowerBranch(body);
    if (bodyChain.first !== null) this.draft.exec(id, bodyChain.first, 'body');

    return { first: id, last: id, native: 1 + bodyChain.native, raw: bodyChain.raw };
  }

  /**
   * `int x = <anything>;` as a Declare Variable scoped to the chain.
   *
   * The initializer goes to the config field when it is a literal and to the
   * node's Initial value port otherwise — the same two-way rule arguments
   * follow. Before that port existed this could not be lowered at all: the
   * field coerced through `Number()`, so a computed initializer came back as 0.
   */
  private lowerDeclaration(node: TsNode): Chain {
    const type = node.childForFieldName('type');
    if (type === null || !DECLARABLE_TYPES.has(type.text)) return this.rawStatement(node);

    // One declarator only. `int a = 1, b = 2;` is two variables in one
    // statement and would need two nodes plus a rule about their order.
    const declarators = node.namedChildren.filter(
      (child) => child.type === 'init_declarator' || child.type === 'identifier',
    );
    if (declarators.length !== 1) return this.rawStatement(node);

    const only = declarators[0];
    if (only === undefined) return this.rawStatement(node);

    const name = only.type === 'identifier' ? only : only.childForFieldName('declarator');
    if (name === null || name === undefined || name.type !== 'identifier') return this.rawStatement(node);

    const value = only.type === 'identifier' ? null : (only.childForFieldName('value') ?? null);

    const id = this.draft.id('n', node.startIndex);
    const comments = this.commentsFor(node);
    const config: Record<string, string> = {
      name: name.text,
      type: type.text,
      scope: 'local',
    };

    const portType = declaredPortType(type.text);
    let wire: TsNode | null = null;

    if (value === null) {
      config['initial'] = '';
    } else {
      const inner = unwrapParens(value);
      const literal = this.literalFor(inner, portType);
      if (literal === null) wire = inner;
      else config['initial'] = this.source.slice(inner.startIndex, inner.endIndex);
    }

    this.draft.node(id, 'var.declare', { config, ...(comments === undefined ? {} : { comments }) });
    if (wire !== null) this.wireExpression(wire, id, 'value', portType);

    return { first: id, last: id, native: 1, raw: 0 };
  }

  private lowerDoWhile(node: TsNode): Chain {
    return this.lowerWhile(node, 'control.doWhile');
  }

  /**
   * Only the exact shape `control.for` emits: `for (int i = 0; i < n; i++)`.
   *
   * Every other counting loop — downwards, by twos, from a non-zero start, or
   * with `<=` — would have to be re-expressed, and the closest available
   * re-expression changes the text. `i <= n` as a count of `n + 1` is the
   * tempting one and the worst: it compiles, it runs correctly, and the number
   * in the user's source has silently become a different number.
   */
  private lowerFor(node: TsNode): Chain {
    const canonical = canonicalFor(node);
    if (canonical === null) return this.rawStatement(node);
    const { name, limit, body } = canonical;

    const id = this.draft.id('n', node.startIndex);
    const comments = this.commentsFor(node);
    this.draft.node(id, 'control.for', {
      config: { index: name.text },
      ...(comments === undefined ? {} : { comments }),
    });

    const inner = unwrapParens(limit);
    const literal = this.literalFor(inner, 'int');
    if (literal === null) this.wireExpression(inner, id, 'count', 'int');
    else this.setLiteral(id, 'count', literal);

    const bodyChain = this.lowerBranch(body);
    if (bodyChain.first !== null) this.draft.exec(id, bodyChain.first, 'body');

    return { first: id, last: id, native: 1 + bodyChain.native, raw: bodyChain.raw };
  }

  // ── argument handling ──

  private setLiteral(nodeId: string, port: string, value: string | number | boolean): void {
    const node = this.draft.nodes.find((candidate) => candidate.id === nodeId);
    if (node === undefined) return;
    (node.data.literals as Record<string, string | number | boolean>)[port] = value;
  }

  /**
   * The inline literal for an argument, or null when it needs a Raw Expression.
   *
   * Source text is stored verbatim for non-string ports, because literalToCpp
   * emits a string on a non-string port bare — which is what preserves `0x1A`
   * as `0x1A` rather than normalizing it to `26`.
   */
  private literalFor(node: TsNode, portType: PortType): string | number | boolean | null {
    const inner = unwrapParens(node);
    if (!isLiteralArgument(inner)) return null;
    const text = this.source.slice(inner.startIndex, inner.endIndex);

    if (portType === 'bool') {
      // The boolean literal spec carries cppTrue/cppFalse, so HIGH and LOW come
      // back as HIGH and LOW rather than as 1 and 0.
      if (text === 'HIGH' || text === 'true') return true;
      if (text === 'LOW' || text === 'false') return false;
      return null;
    }
    return text;
  }

  private wireExpression(node: TsNode, targetId: string, port: string, portType: PortType): void {
    const lowered = this.lowerExpression(node, portType);
    if (lowered !== null) {
      this.draft.data(lowered.id, 'out', targetId, port, portType);
      return;
    }
    const id = this.draft.id('e', node.startIndex);
    this.draft.node(id, 'custom.expression', {
      config: { code: this.source.slice(node.startIndex, node.endIndex), type: rawExpressionType(portType) },
    });
    this.draft.data(id, 'out', targetId, port, portType);
  }

  /**
   * An expression as a real node tree, or null to fall back to Raw Expression.
   *
   * The governing rule is that **no connection may introduce a cast**.
   * `applyCast` wraps a value when it crosses into a `float` or `string` port,
   * and on AVR that is not cosmetic: `int a + int b` lowered through math.add,
   * whose ports are float, emits `((float)(a) + (float)(b))`. That is float
   * arithmetic where the source had 16-bit integer arithmetic — different
   * machine code, no overflow at 32767, and a broken Gate 1. So a node is only
   * used when every edge in its subtree is cast-free, and everything else stays
   * Raw Expression, which emits the user's own text verbatim.
   */
  private lowerExpression(node: TsNode, want: PortType): { id: string; type: PortType } | null {
    const inner = unwrapParens(node);

    switch (inner.type) {
      case 'identifier': {
        const declared = this.variableTypes.get(inner.text);
        if (declared === undefined) return null;
        const type = declaredPortType(declared);
        if (!castFree(type, want)) return null;
        const id = this.draft.id('g', inner.startIndex);
        this.draft.node(id, 'var.get', { config: { name: inner.text, type: declared } });
        return { id, type };
      }

      case 'binary_expression':
        return this.lowerBinary(inner, want);

      case 'unary_expression': {
        if (inner.child(0)?.text !== '!') return null;
        const operand = inner.child(1);
        if (operand === null || !castFree('bool', want)) return null;
        const id = this.draft.id('u', inner.startIndex);
        this.draft.node(id, 'logic.not', {});
        this.connectOperand(operand, id, 'value', 'bool');
        return { id, type: 'bool' };
      }

      case 'conditional_expression': {
        // Every port on math.ternary is `any`, so nothing crossing it is cast.
        const condition = inner.childForFieldName('condition');
        const whenTrue = inner.childForFieldName('consequence');
        const whenFalse = inner.childForFieldName('alternative');
        if (condition === null || whenTrue === null || whenFalse === null) return null;
        const id = this.draft.id('t', inner.startIndex);
        this.draft.node(id, 'math.ternary', {});
        this.connectOperand(condition, id, 'cond', 'bool');
        this.connectOperand(whenTrue, id, 'then', 'any');
        this.connectOperand(whenFalse, id, 'else', 'any');
        return { id, type: 'any' };
      }

      case 'call_expression':
        return this.lowerCall(inner, want);

      default:
        return null;
    }
  }

  /** Comparisons and the logical connectives. Arithmetic is not here: see above. */
  private lowerBinary(node: TsNode, want: PortType): { id: string; type: PortType } | null {
    const operator = node.child(1)?.text ?? '';
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (left === null || right === null) return null;

    const arithmetic = ARITHMETIC[operator];
    if (arithmetic !== undefined) {
      // The mode comes from the operands' declared types, widened. An unknown
      // operand means no mode can be chosen, and guessing one silently changes
      // the arithmetic — so the whole expression falls back to Raw Expression,
      // which emits the user's own text.
      const mode = this.numericModeFor(node);
      if (mode === null) return null;
      if (arithmetic.integerOnly && mode === 'float') return null;

      const portType: PortType = mode === 'float' ? 'float' : 'int';
      if (!castFree(portType, want)) return null;

      const id = this.draft.id('m', node.startIndex);
      this.draft.node(id, arithmetic.defId, { config: { numericType: mode } });
      this.connectOperand(left, id, 'a', portType);
      this.connectOperand(right, id, 'b', portType);
      return { id, type: portType };
    }

    if (COMPARISONS.has(operator)) {
      if (!castFree('bool', want)) return null;
      const id = this.draft.id('c', node.startIndex);
      // logic.compare's operands are typed `any`, so nothing crossing into them
      // is ever cast — which is what makes comparisons safe to lower while
      // arithmetic is not.
      this.draft.node(id, 'logic.compare', { config: { op: operator } });
      this.connectOperand(left, id, 'a', 'any');
      this.connectOperand(right, id, 'b', 'any');
      return { id, type: 'bool' };
    }

    const defId = operator === '&&' ? 'logic.and' : operator === '||' ? 'logic.or' : null;
    if (defId === null || !castFree('bool', want)) return null;

    // Both operands must already be boolean, or the node would coerce them.
    const leftBool = this.lowerExpression(left, 'bool');
    const rightBool = this.lowerExpression(right, 'bool');
    if (leftBool === null || rightBool === null) return null;

    const id = this.draft.id('c', node.startIndex);
    this.draft.node(id, defId, {});
    this.draft.data(leftBool.id, 'out', id, 'a', 'bool');
    this.draft.data(rightBool.id, 'out', id, 'b', 'bool');
    return { id, type: 'bool' };
  }

  /** The Arduino builtins whose node ports match their real return types. */
  private lowerCall(node: TsNode, want: PortType): { id: string; type: PortType } | null {
    const callee = node.childForFieldName('function');
    if (callee === null || callee.type !== 'identifier') return null;

    const args: TsNode[] = [];
    const list = node.childForFieldName('arguments');
    for (let i = 0; i < (list?.namedChildCount ?? 0); i += 1) {
      const arg = list?.namedChild(i);
      if (arg !== null && arg !== undefined && arg.type !== 'comment') args.push(arg);
    }

    const spec = BUILTIN_EXPRESSIONS[callee.text];
    if (spec === undefined) {
      // A call to a function this sketch defines, used for its value.
      const returns = this.functionReturns.get(callee.text);
      if (returns === undefined) return null;
      const type = declaredPortType(returns);
      if (!castFree(type, want)) return null;
      const id = this.draft.id('f', node.startIndex);
      const argText = args.map((arg) => this.source.slice(arg.startIndex, arg.endIndex)).join(', ');
      this.draft.node(id, 'func.call', { config: { name: callee.text, args: argText, returns } });
      return { id, type };
    }
    if (spec.ports.length !== args.length) return null;
    if (!castFree(spec.out, want)) return null;

    const id = this.draft.id('b', node.startIndex);
    this.draft.node(id, spec.defId, {});
    for (let i = 0; i < args.length; i += 1) {
      const port = spec.ports[i];
      const arg = args[i];
      if (port === undefined || arg === undefined) continue;
      this.connectOperand(arg, id, port.id, port.type);
    }
    return { id, type: spec.out };
  }

  /**
   * The numeric mode for an arithmetic node: the widest of its operands.
   *
   * Widening runs int -> long -> float. Null means at least one operand has no
   * known type, and the caller falls back rather than guessing — a wrong mode
   * changes the result of the arithmetic, which is the worst outcome available.
   */
  private numericModeFor(node: TsNode): 'int' | 'long' | 'float' | null {
    let widest: 'int' | 'long' | 'float' = 'int';
    let known = false;

    const rank = { int: 0, long: 1, float: 2 } as const;

    const visit = (expression: TsNode): boolean => {
      const inner = unwrapParens(expression);
      switch (inner.type) {
        case 'number_literal': {
          const text = inner.text;
          const type = /[.eE]/.test(text) && !/^0[xX]/.test(text) ? 'float' : /[lL]/.test(text) ? 'long' : 'int';
          if (rank[type] > rank[widest]) widest = type;
          known = true;
          return true;
        }
        case 'identifier': {
          if (CONSTANTS.has(inner.text)) {
            known = true;
            return true;
          }
          const declared = this.variableTypes.get(inner.text);
          if (declared === undefined) return false;
          const type = declared === 'float' ? 'float' : declared === 'long' ? 'long' : 'int';
          if (rank[type] > rank[widest]) widest = type;
          known = true;
          return true;
        }
        case 'binary_expression': {
          const left = inner.childForFieldName('left');
          const right = inner.childForFieldName('right');
          return left !== null && right !== null && visit(left) && visit(right);
        }
        case 'cast_expression': {
          // An explicit cast is the user stating the width they need — the
          // `(long)dev1 * dev1` idiom exists precisely to stop 16-bit overflow.
          const type = inner.childForFieldName('type')?.text ?? '';
          const widthed = type.includes('float') || type.includes('double') ? 'float' : type.includes('long') ? 'long' : 'int';
          if (rank[widthed] > rank[widest]) widest = widthed;
          known = true;
          return true;
        }
        case 'call_expression': {
          const callee = inner.childForFieldName('function')?.text ?? '';
          const spec = BUILTIN_EXPRESSIONS[callee];
          if (spec !== undefined) {
            known = true;
            return true;
          }
          const returns = this.functionReturns.get(callee);
          if (returns === undefined) return false;
          const type = returns === 'float' ? 'float' : 'int';
          if (rank[type] > rank[widest]) widest = type;
          known = true;
          return true;
        }
        default:
          return false;
      }
    };

    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (left === null || right === null) return null;
    if (!visit(left) || !visit(right)) return null;
    return known ? widest : null;
  }

  /** An operand: inline literal where possible, else a nested tree, else raw. */
  private connectOperand(node: TsNode, targetId: string, port: string, portType: PortType): void {
    const inner = unwrapParens(node);
    const literal = this.literalFor(inner, portType);
    if (literal !== null) {
      this.setLiteral(targetId, port, literal);
      return;
    }
    this.wireExpression(inner, targetId, port, portType);
  }
}

function rawExpressionType(portType: PortType): string {
  // Must match the port, or codegen inserts a cast that changes the emitted
  // call — `String(x)` instead of `x` is a different overload.
  switch (portType) {
    case 'bool':
      return 'bool';
    case 'float':
      return 'float';
    case 'string':
      return 'String';
    default:
      return 'int';
  }
}

/**
 * Removes the block indentation from a multi-line statement, keeping relative
 * nesting.
 *
 * Required for idempotence (§Non-negotiables 5). A statement is sliced starting
 * at its first token, so line one has no leading whitespace but the lines below
 * it still carry the indentation of the block they were written in. Codegen
 * then indents every line again, and each round trip adds another level —
 * whitespace-only drift that Gate 1 is blind to, since it does not change
 * compiled output. The first line is excluded from the measurement precisely
 * because the slice already stripped its indentation.
 */
export function dedentStatement(text: string): string {
  const lines = text.split('\n');
  if (lines.length < 2) return text.trim();

  let common: number | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    common = common === null ? indent : Math.min(common, indent);
  }
  if (common === null || common === 0) return text.trimEnd();

  return [
    lines[0] ?? '',
    ...lines.slice(1).map((line) => (line.trim() === '' ? '' : line.slice(common))),
  ]
    .join('\n')
    .trimEnd();
}

/**
 * The bare expression inside a condition or a parenthesis nest.
 *
 * `if_statement`'s `condition` field is a `condition_clause` whose text
 * *includes* the surrounding parentheses. Storing that text verbatim in a Raw
 * Expression means codegen re-parenthesizes it — once for the Raw Expression
 * and once for the `if` — and every round trip nests it one level deeper. The
 * grammar's own child is the expression itself, so it is taken directly.
 */
function unwrapParens(node: TsNode): TsNode {
  let current = node;
  for (;;) {
    if (current.type === 'condition_clause') {
      // C++17 allows `if (init; cond)`, so the condition is the last child.
      const inner = current.namedChild(current.namedChildCount - 1);
      if (inner === null) return current;
      current = inner;
      continue;
    }
    if (current.type === 'parenthesized_expression') {
      const inner = current.namedChild(0);
      if (inner === null) return current;
      current = inner;
      continue;
    }
    return current;
  }
}

/**
 * The text of a C++ string literal, or null when it uses an escape this cannot
 * round-trip. escapeCppString re-emits only these, so anything else would come
 * back different.
 */
export function decodeStringLiteral(raw: string): string | null {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return null;
  const body = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case '\\':
        out += '\\';
        break;
      case '"':
        out += '"';
        break;
      default:
        return null;
    }
  }
  return out;
}
