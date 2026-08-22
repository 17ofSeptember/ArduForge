/**
 * The importer (IMPORT.md §Mission, §Phase 1).
 *
 * Phase 1 builds the frontend — Arduino preprocessing, prototypes, the source
 * map, comment attachment, directive classification — and lands the *fallback*
 * end of the lowering spectrum. Every construct becomes a Raw node, which is
 * deliberately the least interesting graph that is still completely faithful:
 * regenerated output is the user's own text, so Gate 1 and Gate 3 sit at 100%
 * from here on and become floors that later phases may not break.
 *
 * Coverage is therefore ~0% at this phase by design. Phases 2 through 4 move
 * statements off Raw nodes and onto native ones; that number is the ratchet.
 *
 * The one structural decision made here, rather than deferred: setup() and
 * loop() are split out into real entry nodes. Codegen always emits
 * `void setup()` and `void loop()` itself, so a single Raw Global holding the
 * whole file would define both twice and fail to compile. Splitting at the two
 * entry points is the minimum structure that makes the fallback valid, and it
 * is also where Phase 2 starts lowering.
 */
import type { AnyNode, ForgeEdge } from '@/graph/model';
import { attachComments, type CommentMap } from '@/import/comments';
import { classifyDirectives, type Directive } from '@/import/directives';
import { fallbackRegions } from '@/import/boundaries';
import { parseCpp, type TsNode } from '@/import/grammar';
import { preflight, type PreflightProblem } from '@/import/preflight';
import { preprocess } from '@/import/preprocess';
import { GraphDraft, Lowerer } from '@/import/lower';
import { detectAwryLink, type AwryLinkSignature } from '@/import/awrylink';
import { pwmConflictPins, scanServos, SERVO_METHOD_NODES } from '@/import/servo';
import { stableSuffix } from '@/codegen/names';
import type { ComponentPlan } from '@/import/lower';
import type { SourceMap } from '@/import/sourceMap';

export interface ImportInputFile {
  readonly name: string;
  readonly content: string;
}

export interface SemanticDivergence {
  readonly file: string;
  readonly line: number;
  readonly kind: 'duplicate-impure-expression' | 'other';
  readonly message: string;
}

export interface ImportWarning {
  readonly file: string;
  readonly line: number;
  /** Stable code so the UI can route a warning to a click-through target. */
  readonly code: string;
  readonly message: string;
  readonly nodeId: string | null;
}

export interface ImportReport {
  /** Total statements found in the source — the coverage denominator. */
  readonly statements: number;
  /** Statements lowered onto native nodes. */
  readonly native: number;
  /** Statements left on Custom C++ nodes. */
  readonly raw: number;
  readonly componentsLifted: readonly string[];
  readonly patternsLifted: readonly string[];
  readonly warnings: readonly ImportWarning[];
  readonly divergences: readonly SemanticDivergence[];
  /** Prototypes the preprocessor generated, for diagnostics. */
  readonly prototypes: readonly string[];
  /** True when the sketch was taken whole because it could not be trusted. */
  readonly wholeFileFallback: boolean;
}

export interface ImportResult {
  readonly nodes: readonly AnyNode[];
  readonly edges: readonly ForgeEdge[];
  readonly report: ImportReport;
}

export interface ImportOptions {
  /** Sketch folder name, which decides Arduino's concatenation order. */
  readonly sketchName?: string;
}

// ── deterministic ids (§Non-negotiables 4) ───────────────────────────────────

// ── graph assembly ───────────────────────────────────────────────────────────

// ── the import ───────────────────────────────────────────────────────────────

export async function importSketch(
  files: readonly ImportInputFile[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const inos = files.filter((file) => file.name.endsWith('.ino'));
  if (inos.length === 0) throw new Error('No .ino file to import.');

  const sketchName = options.sketchName ?? inos[0]?.name.replace(/\.ino$/, '') ?? 'Sketch';
  const warnings: ImportWarning[] = [];

  // Companion .h/.cpp are out of scope for v1 (§Hard-case register). Detect and
  // say so plainly rather than importing something incomplete in silence.
  for (const file of files) {
    if (file.name.endsWith('.ino')) continue;
    warnings.push({
      file: file.name,
      line: 1,
      code: 'companion-file-not-imported',
      message: `${file.name} sits beside the sketch but is not imported. It still travels with the sketch when compiling.`,
      nodeId: null,
    });
  }

  // ── amendment B: lexical pre-flight, before tree-sitter sees anything ──
  const problems = preflight(inos);
  if (problems.length > 0) {
    return wholeFileFallback(inos, sketchName, problems, warnings);
  }

  const pre = await preprocess(inos, sketchName);
  const { root } = await parseCpp(pre.concatenated);

  const comments = attachComments(root);
  const directives = classifyDirectives(root);
  const regions = fallbackRegions(root);

  for (const region of regions) {
    const at = pre.concatMap.resolve(region.startIndex);
    warnings.push({
      file: at?.file ?? sketchName,
      line: at?.line ?? region.startRow + 1,
      code: 'unparsed-region',
      message: 'This region could not be parsed and was kept as Custom C++, exactly as written.',
      nodeId: null,
    });
  }

  return lower(root, pre.concatenated, pre.concatMap, {
    sketchName,
    warnings,
    comments,
    directives,
    prototypes: pre.prototypes,
    awrylink: detectAwryLink(root, pre.concatenated),
  });
}

interface LowerContext {
  readonly sketchName: string;
  readonly warnings: ImportWarning[];
  readonly comments: CommentMap;
  readonly directives: readonly Directive[];
  readonly prototypes: readonly string[];
  readonly awrylink: AwryLinkSignature | null;
}

/** The entry points codegen emits itself, and so must not appear in a global. */
function entryFunction(node: TsNode, name: 'setup' | 'loop'): boolean {
  if (node.type !== 'function_definition') return false;
  const declarator = node.childForFieldName('declarator');
  if (declarator === null) return false;
  const identifier = declarator.childForFieldName('declarator');
  return identifier?.text === name;
}

function bodyOf(node: TsNode): TsNode | null {
  return node.childForFieldName('body');
}

/**
 * Removes the banner codegen writes at the top of every sketch it generates.
 *
 * Also required for idempotence (§Non-negotiables 5): re-importing a generated
 * sketch would otherwise capture ArduForge's own banner as user code, and each
 * round trip would stack another copy of it inside the Raw Global.
 *
 * The match is deliberately exact — the box rule, the byline, and the closing
 * rule — rather than "a comment at the top of the file", so a user's own header
 * comment is never mistaken for ours and deleted.
 */
export function stripGeneratedHeader(text: string): string {
  const rule = `// ${'─'.repeat(45)}`;
  if (!text.startsWith(rule)) return text;

  const lines = text.split('\n');
  if (!lines.some((line, index) => index < 6 && line === '//  Generated by ArduForge')) return text;

  const closing = lines.findIndex((line, index) => index > 0 && line === rule);
  if (closing === -1) return text;

  let after = closing + 1;
  while (after < lines.length && lines[after]?.trim() === '') after += 1;
  return lines.slice(after).join('\n');
}

/**
 * Strips the common leading whitespace, preserving relative nesting.
 *
 * Required for idempotence (§Non-negotiables 5). A function body is captured at
 * whatever indentation it had inside `void loop() {`, and codegen then indents
 * it again when emitting it back inside `void loop() {`. Without dedenting,
 * every round trip adds two spaces and `import(generate(import(x)))` never
 * equals `import(x)` — the graphs differ by whitespace forever.
 */
function dedent(text: string): string {
  const lines = text.split('\n');
  let common: number | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    common = common === null ? indent : Math.min(common, indent);
  }
  if (common === null || common === 0) return text.trim();
  return lines
    .map((line) => (line.trim() === '' ? '' : line.slice(common)))
    .join('\n')
    .trim();
}

function lower(
  root: TsNode,
  source: string,
  map: SourceMap,
  context: LowerContext,
): ImportResult {
  const draft = new GraphDraft();

  let setupNode: TsNode | null = null;
  let loopNode: TsNode | null = null;
  const userFunctions = new Set<string>();

  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child === null) continue;
    if (child.type === 'function_definition') {
      const name = functionNameOf(child);
      if (name !== null && name !== 'setup' && name !== 'loop') userFunctions.add(name);
    }
    if (setupNode === null && entryFunction(child, 'setup')) setupNode = child;
    else if (loopNode === null && entryFunction(child, 'loop')) loopNode = child;
  }

  let exposedDeclarations =
    context.awrylink === null ? null : resolveExposed(root, source, context.awrylink);

  // Lifting a declaration out of the Raw Global moves it into codegen's globals
  // block, which sits *after* the Raw Global's own text. If anything still in
  // that text refers to the variable — an ISR body, another initializer — the
  // reference now precedes the declaration and the sketch stops compiling. That
  // is a reordering of declarations, which §Non-negotiables 10 forbids outright,
  // so the whole un-injection is abandoned and the sketch imports literally.
  if (exposedDeclarations !== null && context.awrylink !== null) {
    const cuts = [
      ...context.awrylink.globalSpans,
      ...exposedDeclarations.map((found) => ({ start: found.start, end: found.end })),
    ].sort((a, b) => a.start - b.start);

    let remaining = '';
    let at = 0;
    for (const cut of cuts) {
      remaining += source.slice(at, cut.start);
      at = cut.end;
    }
    remaining += source.slice(at);
    // Only what stays behind as a global matters, so the entry bodies go too.
    const outsideEntries = remaining
      .replace(setupNode === null ? '' : source.slice(setupNode.startIndex, setupNode.endIndex), '')
      .replace(loopNode === null ? '' : source.slice(loopNode.startIndex, loopNode.endIndex), '');

    const referenced = exposedDeclarations.some((found) =>
      new RegExp(`\\b${found.name}\\b`).test(outsideEntries),
    );
    if (referenced) exposedDeclarations = null;
  }

  // ── §4.1 component lifting: Servo ──
  const servos = scanServos(root);
  const componentPlans = new Map<number, ComponentPlan>();
  const componentsLifted: string[] = [];
  // Collected here and merged into `excised` below, which is built after
  // lowering so it can also pick up whatever the pattern lifts absorbed.
  const componentExcisions: Array<{ start: number; end: number }> = [];

  for (const servo of servos.lifts) {
    // The report keeps the user's own name; the node config gets the name the
    // object will actually be emitted under.
    //
    // The servo nodes derive their C++ object as `servo_<stableSuffix(name)>`,
    // so storing `myservo` emits `servo_yservo` — and re-importing that sketch
    // reads `servo_yservo` and stores *that*, giving a different graph on the
    // second pass. Storing the emitted form makes it a fixed point, because
    // stableSuffix('servo_yservo') is 'yservo' again. Both forms generate the
    // same C++; only idempotence tells them apart.
    const objectName = `servo_${stableSuffix(servo.name)}`;
    componentsLifted.push(`Servo ${servo.name} (pin ${servo.pin})`);

    componentPlans.set(servo.attach.startIndex, {
      defId: 'servo.attach',
      config: { name: objectName },
      ports: [{ id: 'pin', type: 'pin', arg: attachPinNode(servo.attach) }],
    });

    for (const use of servo.uses) {
      const defId = SERVO_METHOD_NODES[use.method];
      const statement = use.node.parent?.type === 'expression_statement' ? use.node.parent : null;
      if (defId === undefined || statement === null) continue;
      const first = use.args[0];
      componentPlans.set(statement.startIndex, {
        defId,
        config: { name: objectName },
        ports:
          first === undefined
            ? []
            : [{ id: use.method === 'writeMicroseconds' ? 'us' : 'angle', type: 'int', arg: first }],
      });
    }

    // The declaration and the include are re-emitted by the node's requires.
    componentExcisions.push({ start: servo.declaration.startIndex, end: servo.declaration.endIndex });
    if (servo.include !== null) {
      componentExcisions.push({ start: servo.include.startIndex, end: servo.include.endIndex });
    }
  }

  for (const refusal of servos.refusals) {
    context.warnings.push({
      file: context.sketchName,
      line: 1,
      code: 'servo-not-lifted',
      message: `${refusal.name} was kept as Custom C++ because ${refusal.reason}. A wrong pin drives the wrong hardware, so it is left exactly as written.`,
      nodeId: null,
    });
  }

  // Timer1 belongs to the Servo library on AVR, so pins 9 and 10 lose PWM the
  // moment a servo is attached. analogWrite on either then does nothing at all,
  // and the sketch still compiles — which is why this is said at import.
  for (const pin of pwmConflictPins(root, servos.lifts.map((servo) => servo.pin))) {
    context.warnings.push({
      file: context.sketchName,
      line: 1,
      code: 'servo-pwm-conflict',
      message: `analogWrite() is used on pin ${pin}, but the Servo library takes over Timer1 and disables PWM on pins 9 and 10. That analogWrite will have no effect.`,
      nodeId: null,
    });
  }

  const statements = countStatements(root);
  const skip =
    context.awrylink !== null && exposedDeclarations !== null
      ? new Set([...context.awrylink.setupCalls, ...context.awrylink.loopCalls])
      : new Set<number>();
  const lowerer = new Lowerer(
    source,
    context.comments,
    draft,
    userFunctions,
    variableTypes(root),
    functionReturns(root),
    skip,
    root,
    (node, code, message) => {
      const at = map.resolve(node.startIndex);
      context.warnings.push({
        file: at?.file ?? context.sketchName,
        line: at?.line ?? node.startPosition.row + 1,
        code,
        message,
        nodeId: null,
      });
    },
    componentPlans,
  );

  // ── nodes ──
  let native = 0;
  let raw = 0;

  const setupId = draft.node(draft.id('setup', setupNode?.startIndex ?? 0), 'event.setup', { x: 0, y: 0 });

  // Declare Variable nodes lead the setup chain, matching where the graphs that
  // generated these sketches put them.
  let tail = setupId;
  for (const found of exposedDeclarations ?? []) {
    const id = draft.node(draft.id('v', found.start), 'var.declare', {
      config: {
        name: found.name,
        type: found.type,
        initial: found.initial,
        scope: 'global',
        expose: true,
      },
      x: 260,
      y: 0,
    });
    draft.exec(tail, id);
    tail = id;
    native += 1;
  }

  const setupBody = setupNode === null ? null : bodyOf(setupNode);
  if (setupBody !== null) {
    const chain = lowerer.lowerBlock(setupBody);
    if (chain.first !== null) draft.exec(tail, chain.first);
    native += chain.native;
    raw += chain.raw;
  }

  const loopId = draft.node(draft.id('loop', loopNode?.startIndex ?? 1), 'event.loop', { x: 0, y: 400 });
  const loopBody = loopNode === null ? null : bodyOf(loopNode);
  if (loopBody !== null) {
    const chain = lowerer.lowerBlock(loopBody);
    if (chain.first !== null) draft.exec(loopId, chain.first);
    native += chain.native;
    raw += chain.raw;
  }

  // Everything that is not setup() or loop(), with the interstitial whitespace
  // and comments preserved — those are part of the file, and cutting on node
  // extents alone would quietly drop the blank lines and stray comments between
  // declarations.
  const excised: Array<{ start: number; end: number }> = [];
  if (setupNode !== null) excised.push({ start: setupNode.startIndex, end: setupNode.endIndex });
  if (loopNode !== null) excised.push({ start: loopNode.startIndex, end: loopNode.endIndex });

  // Un-inject AwryLink: the include, the table and the hash come out of the
  // globals, and each exposed variable's declaration becomes a Declare Variable
  // carrying `expose: true` — which is the fact the injection encoded and the
  // only part worth recovering.
  //
  // All or nothing. If even one exposed variable cannot be represented as a
  // Declare Variable, restoring the others would leave the graph generating a
  // sketch with a smaller AWRY_VARS table than the original — different code,
  // and a broken Gate 1. In that case the sketch imports literally.

  if (context.awrylink !== null && exposedDeclarations !== null) {
    for (const span of context.awrylink.globalSpans) excised.push(span);
    for (const found of exposedDeclarations) excised.push({ start: found.start, end: found.end });
  }

  // A lift may absorb a global declaration — the timestamp of an
  // Every-N-Milliseconds pattern. The node re-emits its own, so leaving the
  // original in the globals would declare it twice.
  excised.push(...componentExcisions);

  for (const start of lowerer.absorbed) {
    const declaration = topLevelAt(root, start);
    if (declaration !== null) excised.push({ start: declaration.startIndex, end: declaration.endIndex });
  }

  excised.sort((a, b) => a.start - b.start);

  let globals = '';
  let cursor = 0;
  for (const cut of excised) {
    globals += source.slice(cursor, cut.start);
    cursor = cut.end;
  }
  globals += source.slice(cursor);


  const globalsCode = dedent(stripGeneratedHeader(globals));
  if (globalsCode !== '') {
    draft.node(draft.id('g', 0), 'custom.global', { config: { code: globalsCode }, x: 0, y: -260 });
  }

  if (setupNode === null) {
    context.warnings.push({
      file: context.sketchName,
      line: 1,
      code: 'missing-setup',
      message: 'This sketch has no setup(). An empty one was added so the graph generates.',
      nodeId: setupId,
    });
  }
  if (loopNode === null) {
    context.warnings.push({
      file: context.sketchName,
      line: 1,
      code: 'missing-loop',
      message: 'This sketch has no loop(). An empty one was added so the graph generates.',
      nodeId: loopId,
    });
  }

  for (const directive of context.directives) {
    if (directive.kind !== 'conditional') continue;
    const at = map.resolve(directive.startIndex);
    context.warnings.push({
      file: at?.file ?? context.sketchName,
      line: at?.line ?? directive.startRow + 1,
      code: 'conditional-not-evaluated',
      message:
        'Conditional compilation is kept exactly as written and never resolved — the result depends on the board it is built for.',
      nodeId: null,
    });
  }

  // The denominator is every statement in the sketch, including those inside
  // user function bodies that this phase leaves in the Raw Global. Counting
  // only what the chains touched would let coverage flatter itself by shrinking
  // the denominator instead of growing the numerator.
  void raw;
  return {
    nodes: draft.nodes,
    edges: draft.edges,
    report: {
      statements,
      native,
      raw: Math.max(0, statements - native),
      componentsLifted,
      patternsLifted: [...new Set(lowerer.lifted)],
      warnings: context.warnings,
      divergences: [],
      prototypes: context.prototypes,
      wholeFileFallback: false,
    },
  };
}

/** A global declaration that a Declare Variable node can carry faithfully. */
interface ExposedDeclaration {
  readonly name: string;
  readonly type: string;
  readonly initial: string;
  readonly start: number;
  readonly end: number;
}

/** Types var.declare offers. Anything else cannot be represented. */
const DECLARABLE = new Set(['int', 'float', 'bool', 'String']);

/**
 * Finds the global declaration behind each exposed name, or returns null.
 *
 * Null means "do not un-inject". Two things can force that, and both matter:
 * a type var.declare does not offer, and an initializer that is not a plain
 * literal — `initialiserFor` runs Number() over that field, so a computed
 * initializer would silently come back as 0.
 */
function resolveExposed(
  root: TsNode,
  source: string,
  signature: AwryLinkSignature,
): ExposedDeclaration[] | null {
  const found: ExposedDeclaration[] = [];

  for (const name of signature.exposed) {
    let match: ExposedDeclaration | null = null;

    for (let i = 0; i < root.childCount; i += 1) {
      const child = root.child(i);
      if (child === null || child.type !== 'declaration') continue;

      const type = child.childForFieldName('type')?.text ?? '';
      if (!DECLARABLE.has(type)) continue;

      const declarator = child.namedChildren.find((entry) => entry.type === 'init_declarator');
      if (declarator === undefined) continue;
      if (declarator.childForFieldName('declarator')?.text !== name) continue;

      const value = declarator.childForFieldName('value');
      if (value === null || value === undefined) continue;
      const literal = literalInitialiser(value, type);
      if (literal === null) return null;

      match = { name, type, initial: literal, start: child.startIndex, end: child.endIndex };
      break;
    }

    if (match === null) return null;
    found.push(match);
  }

  void source;
  return found;
}

/**
 * The `initial` text for a literal value, or null if var.declare cannot carry
 * it faithfully.
 *
 * This is a round-trip check rather than a parse. `initialiserFor` in
 * variables.ts coerces the field through `Number()` and reformats it, so the
 * only safe test is to reproduce exactly what it will emit and compare against
 * what the user wrote. That catches two very different failures with one rule:
 * `0.05f` (Number() returns NaN on the suffix, so it would come back `0.0f`)
 * and `0x1A` (Number() succeeds, and it would come back `26` — a fidelity
 * failure even though it compiles the same).
 */
function literalInitialiser(value: TsNode, type: string): string | null {
  const text = value.type === 'unary_expression' ? value.text : value.text;

  if (type === 'bool') {
    if (text === 'true' || text === 'false') return text;
    return null;
  }

  if (type === 'String') {
    if (value.type !== 'string_literal') return null;
    const inner = text.slice(1, -1);
    // initialiserFor re-quotes with JSON.stringify; anything that does not
    // survive that unchanged would come back different.
    return JSON.stringify(inner) === text ? inner : null;
  }

  if (type === 'float') {
    const stripped = text.replace(/[fF]$/, '');
    const numeric = Number(stripped);
    if (!Number.isFinite(numeric)) return null;
    const emitted = Number.isInteger(numeric) ? `${numeric}.0f` : `${numeric}f`;
    return emitted === text ? stripped : null;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  // String(Math.round(n)) is what will be emitted; `0x1A` fails here, as it
  // must, because it would come back as `26`.
  return String(Math.round(numeric)) === text ? text : null;
}

/**
 * Declared C++ type for every variable in the unit, global or local.
 *
 * Get Variable carries a type, and it has to be the one the source declared:
 * typing an int variable as float would make every edge out of it insert a
 * cast, which is the difference between integer and floating-point arithmetic
 * on AVR. A name declared twice with different types is dropped rather than
 * guessed at.
 */
function variableTypes(root: TsNode): Map<string, string> {
  const types = new Map<string, string>();
  const conflicting = new Set<string>();

  const visit = (node: TsNode): void => {
    if (node.type === 'declaration' || node.type === 'parameter_declaration') {
      const type = node.childForFieldName('type')?.text;
      if (type !== undefined) {
        for (const child of node.namedChildren) {
          const name =
            child.type === 'identifier'
              ? child
              : child.type === 'init_declarator'
                ? child.childForFieldName('declarator')
                : null;
          if (name === null || name === undefined || name.type !== 'identifier') continue;
          const existing = types.get(name.text);
          if (existing !== undefined && existing !== type) conflicting.add(name.text);
          types.set(name.text, type);
        }
      }
    }
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) visit(child);
    }
  };
  visit(root);

  for (const name of conflicting) types.delete(name);
  // Only the four types Declare Variable and Get Variable can represent.
  for (const [name, type] of [...types]) {
    if (type !== 'int' && type !== 'float' && type !== 'bool' && type !== 'String') types.delete(name);
  }
  return types;
}

/**
 * Declared return type per user function, for calls used as values.
 *
 * Only the four types Call Function (value) can carry. A void function has no
 * value to use, and anything else — a pointer, a struct, a library type —
 * cannot be represented, so those calls stay Raw Expression.
 */
function functionReturns(root: TsNode): Map<string, string> {
  const returns = new Map<string, string>();
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child?.type !== 'function_definition') continue;
    const type = child.childForFieldName('type')?.text ?? '';
    if (type !== 'int' && type !== 'float' && type !== 'bool' && type !== 'String') continue;
    const name = functionNameOf(child);
    if (name !== null) returns.set(name, type);
  }
  return returns;
}

/** The top-level declaration starting at `offset`, if there is one. */
/** The pin argument inside a `servo.attach(pin);` statement. */
function attachPinNode(statement: TsNode): TsNode {
  const call = statement.namedChild(0);
  const first = call?.childForFieldName('arguments')?.namedChild(0);
  return first ?? statement;
}

function topLevelAt(root: TsNode, offset: number): TsNode | null {
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (child !== null && child.startIndex === offset) return child;
  }
  return null;
}

function functionNameOf(node: TsNode): string | null {
  const declarator = node.childForFieldName('declarator');
  const identifier = declarator?.childForFieldName('declarator');
  return identifier?.text ?? null;
}

/**
 * The degenerate path: the file is not lexically sound, so the parse would be
 * worthless (Phase 0 measured that an unterminated string recovers nothing).
 * The whole sketch becomes one Raw Global — still a valid, generatable,
 * compiling graph that loses not one byte.
 *
 * setup() and loop() cannot be located without a trustworthy parse, so codegen
 * would emit its own alongside the ones inside the Raw Global. They are found
 * lexically instead, which is crude but only ever runs on a file that is
 * already broken.
 */
function wholeFileFallback(
  inos: readonly ImportInputFile[],
  sketchName: string,
  problems: readonly PreflightProblem[],
  warnings: ImportWarning[],
): ImportResult {
  const draft = new GraphDraft();
  const source = inos.map((file) => file.content).join('\n');

  for (const problem of problems) {
    warnings.push({
      file: problem.file,
      line: problem.line,
      code: `unterminated-${problem.construct}`,
      message: `${problem.message} The sketch was imported whole as Custom C++ so that nothing is lost.`,
      nodeId: null,
    });
  }

  draft.node(draft.id('g', 0), 'custom.global', { config: { code: dedent(stripGeneratedHeader(source)) }, x: 0, y: -260 });

  // A broken file still has to produce a graph that generates. If it already
  // defines setup/loop inside the Raw Global, codegen's own would collide, so
  // the Raw Global is renamed-free and we leave the entries empty only when the
  // text does not appear to define them.
  const definesSetup = /\bvoid\s+setup\s*\(/.test(source);
  const definesLoop = /\bvoid\s+loop\s*\(/.test(source);

  if (!definesSetup) draft.node(draft.id('setup', 0), 'event.setup', { x: 0, y: 0 });
  if (!definesLoop) draft.node(draft.id('loop', 1), 'event.loop', { x: 0, y: 400 });

  if (definesSetup || definesLoop) {
    warnings.push({
      file: sketchName,
      line: 1,
      code: 'entry-points-inside-raw',
      message:
        'setup() and loop() are inside the Custom C++ block because the sketch could not be parsed. Fix the reported problem and import again for a real graph.',
      nodeId: null,
    });
  }

  return {
    nodes: draft.nodes,
    edges: draft.edges,
    report: {
      statements: 0,
      native: 0,
      raw: 0,
      componentsLifted: [],
      patternsLifted: [],
      warnings,
      divergences: [],
      prototypes: [],
      wholeFileFallback: true,
    },
  };
}

const STATEMENT_NODE_TYPES = new Set([
  'expression_statement',
  'if_statement',
  'for_statement',
  'for_range_loop',
  'while_statement',
  'do_statement',
  'switch_statement',
  'return_statement',
  'break_statement',
  'continue_statement',
  'goto_statement',
  'labeled_statement',
  'declaration',
]);

/**
 * The coverage denominator: how many statements the sketch contains. Counting
 * from the AST rather than from emitted nodes keeps the number stable as
 * lowering improves — the denominator must not move when the numerator does.
 */
export function countStatements(root: TsNode): number {
  let count = 0;
  const walk = (node: TsNode): void => {
    if (STATEMENT_NODE_TYPES.has(node.type)) count += 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i);
      if (child !== null) walk(child);
    }
  };
  walk(root);
  return count;
}

export class ImporterNotImplementedError extends Error {
  override readonly name = 'ImporterNotImplementedError';
  constructor() {
    super('The sketch importer is not implemented yet.');
  }
}
