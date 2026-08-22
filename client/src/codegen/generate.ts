/**
 * Graph -> Arduino C++ (BUILD_PLAN.md §Phase 4).
 *
 * Two hard requirements shape this file:
 *
 *  1. The output is a product surface. Users paste it into the official Arduino
 *     IDE, so it must be clean, commented, and idiomatic — not machine sludge.
 *  2. It must be deterministic: the same graph produces byte-identical output.
 *     Every collection is sorted before emission and object key order is never
 *     relied on.
 *
 * The five stages follow §Phase 4: validate, collect requires, emit expressions
 * depth-first, walk exec chains into statements, then assemble in fixed order.
 */
import {
  execOuts,
  findOutputPort,
  getNodeDef,
  inputPorts,
} from '@/nodes/registry';
import {
  isForgeNode,
  isRerouteNode,
  type AnyNode,
  type ForgeEdge,
  type ForgeNode,
} from '@/graph/model';
import { validateGraph, type Problem } from '@/graph/validate';
import {
  parseHandle,
  type CollectContext,
  type EmitContext,
  type LiteralValue,
  type NodeDef,
  type NodeRequires,
  type PortType,
} from '@/nodes/types';
import { applyCast, literalToCpp } from '@/codegen/literals';
import { NameAllocator } from '@/codegen/names';
import { buildInjection, type ExposedVariable } from '@/codegen/awrylink';

export interface GeneratedLine {
  readonly text: string;
  /** Node this line came from, for the code<->canvas highlight link. */
  readonly nodeId: string | null;
}

export interface GenerateResult {
  readonly ok: boolean;
  readonly code: string;
  readonly lines: readonly GeneratedLine[];
  /** 1-based line number -> node id (§Phase 4 source map). */
  readonly sourceMap: ReadonlyMap<number, string>;
  readonly nodeLines: ReadonlyMap<string, readonly number[]>;
  readonly problems: readonly Problem[];
  readonly libraries: readonly string[];
  /** Variables the sketch exposes over AwryLink, for dashboard bindings. */
  readonly exposed: readonly ExposedVariable[];
}

const INDENT = '  ';
const BRANCH_SENTINEL = /^\0branch:(\d+)\0$/;

const CPP_TYPE: Record<PortType, string> = {
  bool: 'bool',
  int: 'int',
  float: 'float',
  string: 'String',
  pin: 'uint8_t',
  any: 'int',
  exec: 'void',
};

/** A value cheap enough that evaluating it twice costs nothing. */
function isTrivialExpression(expression: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression) || /^-?[0-9]+(\.[0-9]+f?)?$/.test(expression);
}

interface Ctx {
  readonly nodes: ReadonlyMap<string, AnyNode>;
  readonly edges: readonly ForgeEdge[];
  /** target node id + ':' + input port id -> edge */
  readonly incomingData: ReadonlyMap<string, ForgeEdge>;
  /** true producer node id + ':' + output port id -> consumer count */
  readonly consumerCount: Map<string, number>;
  readonly names: NameAllocator;
  readonly hoisted: Map<string, { name: string; type: PortType; expression: string }>;
  readonly expressionCache: Map<string, string>;
  readonly requires: {
    includes: Set<string>;
    libraries: Set<string>;
    globals: Set<string>;
    setup: Set<string>;
    functions: Map<string, string>;
  };
}

function keyFor(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`;
}

/** Reroute nodes are pure pass-throughs; follow them to the real producer. */
function resolveProducer(
  ctx: Ctx,
  nodeId: string,
  portId: string,
): { node: ForgeNode; portId: string } | null {
  const node = ctx.nodes.get(nodeId);
  if (node === undefined) return null;

  if (isRerouteNode(node)) {
    const incoming = ctx.edges.find(
      (edge) => edge.target === nodeId && edge.targetHandle === 'reroute-in',
    );
    if (incoming === undefined) return null;
    const handle = parseHandle(incoming.sourceHandle);
    if (handle?.kind !== 'out') return null;
    return resolveProducer(ctx, incoming.source, handle.portId);
  }

  return isForgeNode(node) ? { node, portId } : null;
}

/**
 * The real producer behind a data edge, seeing through reroute points.
 * A reroute uses its own handle ids, so parsing the edge's handle is not enough.
 */
function producerOfEdge(ctx: Ctx, edge: ForgeEdge): { node: ForgeNode; portId: string } | null {
  const sourceNode = ctx.nodes.get(edge.source);
  if (sourceNode !== undefined && isRerouteNode(sourceNode)) {
    return resolveProducer(ctx, edge.source, '');
  }
  const handle = parseHandle(edge.sourceHandle);
  if (handle?.kind !== 'out') return null;
  return resolveProducer(ctx, edge.source, handle.portId);
}

// ── stage 3: expressions ─────────────────────────────────────────────────────

function expressionForOutput(ctx: Ctx, nodeId: string, portId: string, seen: Set<string>): string {
  const cacheKey = keyFor(nodeId, portId);
  const cached = ctx.expressionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (seen.has(cacheKey)) return '0'; // cycle; validation reports it separately
  seen.add(cacheKey);

  const producer = resolveProducer(ctx, nodeId, portId);
  if (producer === null) return '0';

  const def = getNodeDef(producer.node.data.defId);
  if (def === null) return '0';

  const result = def.emit(makeEmitContext(ctx, producer.node, def, seen));
  const expression = result.expression ?? '0';
  ctx.expressionCache.set(cacheKey, expression);
  return expression;
}

function resolveInput(
  ctx: Ctx,
  node: ForgeNode,
  def: NodeDef,
  portId: string,
  seen: Set<string>,
): string {
  const port = inputPorts(def, node.data.config).find((candidate) => candidate.id === portId);
  if (port === undefined) return '0';

  const edge = ctx.incomingData.get(keyFor(node.id, portId));
  if (edge === undefined) {
    return literalToCpp(port.literal, node.data.literals[portId], port.type);
  }

  const producer = producerOfEdge(ctx, edge);
  if (producer === null) return '0';

  const hoist = ctx.hoisted.get(keyFor(producer.node.id, producer.portId));
  const producerDef = getNodeDef(producer.node.data.defId);
  const sourceType =
    producerDef === null
      ? 'any'
      : (findOutputPort(producerDef, producer.portId, producer.node.data.config)?.type ?? 'any');

  const raw =
    hoist !== undefined
      ? hoist.name
      : expressionForOutput(ctx, producer.node.id, producer.portId, seen);

  return applyCast(raw, sourceType, port.type);
}

function makeEmitContext(
  ctx: Ctx,
  node: ForgeNode,
  def: NodeDef,
  seen: Set<string>,
  branches?: { requested: string[]; render: (name: string) => number },
): EmitContext {
  return {
    nodeId: node.id,
    input: (portId) => resolveInput(ctx, node, def, portId, seen),
    connected: (portId) => ctx.incomingData.has(keyFor(node.id, portId)),
    config: (fieldId): LiteralValue => {
      const configured = node.data.config[fieldId];
      if (configured !== undefined) return configured;
      const field = (def.config ?? []).find((candidate) => candidate.id === fieldId);
      return field?.default ?? '';
    },
    branch: (name) => {
      if (branches === undefined) return '';
      branches.requested.push(name);
      return `\0branch:${branches.render(name)}\0`;
    },
    unique: (base) => ctx.names.allocateTemp(base),
  };
}

/**
 * Nodes name their generated globals from `slug`, which is derived from the
 * node id. It must stay stable for a given node so regenerating produces
 * identical output, and differ between nodes so two Servos do not collide.
 */
function makeCollectContext(ctx: Ctx, node: ForgeNode, def: NodeDef): CollectContext {
  return {
    nodeId: node.id,
    slug: node.id.replace(/[^A-Za-z0-9]/g, '').slice(-6),
    config: (fieldId) => {
      const configured = node.data.config[fieldId];
      if (configured !== undefined) return configured;
      return (def.config ?? []).find((field) => field.id === fieldId)?.default ?? '';
    },
    connected: (portId) => ctx.incomingData.has(keyFor(node.id, portId)),
    literal: (portId) => {
      if (ctx.incomingData.has(keyFor(node.id, portId))) return null;
      const value = node.data.literals[portId];
      if (value !== undefined) return value;
      const port = inputPorts(def, node.data.config).find((candidate) => candidate.id === portId);
      return port?.literal?.default ?? null;
    },
  };
}

// ── stage 4: statements ──────────────────────────────────────────────────────

function emitChain(
  ctx: Ctx,
  startNodeId: string | null,
  depth: number,
  visited: Set<string>,
): GeneratedLine[] {
  const lines: GeneratedLine[] = [];
  let currentId = startNodeId;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      lines.push({
        text: `${INDENT.repeat(depth)}// (loop in the execution chain stops here)`,
        nodeId: currentId,
      });
      break;
    }
    visited.add(currentId);

    const node = ctx.nodes.get(currentId);
    if (node === undefined || !isForgeNode(node)) break;
    const def = getNodeDef(node.data.defId);
    if (def === null) break;

    const rendered: GeneratedLine[][] = [];
    const branches = {
      requested: [] as string[],
      render: (name: string): number => {
        const next = execTargetOf(ctx, currentId as string, name);
        rendered.push(emitChain(ctx, next, depth + 1, visited));
        return rendered.length - 1;
      },
    };

    const result = def.emit(makeEmitContext(ctx, node, def, new Set(), branches));
    const body = result.statements ?? '';

    // Comments the node carries are emitted verbatim, at the chain's own
    // indentation. A multi-line block comment keeps its shape.
    for (const comment of node.data.comments?.leading ?? []) {
      for (const line of comment.split('\n')) {
        lines.push({ text: `${INDENT.repeat(depth)}${line}`, nodeId: currentId });
      }
    }

    // Declaration-only nodes (Declare Variable, Declare Array) contribute
    // globals and no statements; they must not leave blank lines in the chain.
    for (const rawLine of body.trim() === '' ? [] : body.split('\n')) {
      const match = BRANCH_SENTINEL.exec(rawLine.trim());
      if (match !== null) {
        const index = Number.parseInt(match[1] ?? '', 10);
        const block = rendered[index] ?? [];
        if (block.length === 0) {
          lines.push({ text: `${INDENT.repeat(depth + 1)}// nothing connected`, nodeId: currentId });
        } else {
          lines.push(...block);
        }
        continue;
      }
      if (rawLine.trim() === '') {
        lines.push({ text: '', nodeId: null });
        continue;
      }
      lines.push({ text: `${INDENT.repeat(depth)}${rawLine}`, nodeId: currentId });
    }

    // A trailing comment goes on the node's last emitted line, which is where
    // the user had it. If the node emitted nothing, it becomes its own line
    // rather than being dropped.
    const trailing = node.data.comments?.trailing ?? [];
    if (trailing.length > 0) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last.nodeId === currentId && last.text.trim() !== '') {
        lines[lines.length - 1] = { text: `${last.text}  ${trailing.join(' ')}`, nodeId: currentId };
      } else {
        for (const comment of trailing) {
          lines.push({ text: `${INDENT.repeat(depth)}${comment}`, nodeId: currentId });
        }
      }
    }

    // Continue along whichever exec output the node did not consume itself.
    const consumed = new Set(branches.requested);
    const remaining = execOuts(def, node.data.config).filter((name) => !consumed.has(name));
    const nextName = remaining[0];
    currentId = nextName === undefined ? null : execTargetOf(ctx, currentId, nextName);
  }

  return lines;
}

function execTargetOf(ctx: Ctx, nodeId: string, execOut: string): string | null {
  const edge = ctx.edges.find(
    (candidate) =>
      candidate.source === nodeId &&
      candidate.data?.kind === 'exec' &&
      parseHandle(candidate.sourceHandle)?.kind === 'exec-out' &&
      candidate.sourceHandle === `exec-out:${execOut}`,
  );
  return edge?.target ?? null;
}

// ── hoisting ─────────────────────────────────────────────────────────────────

/**
 * Values consumed more than once are evaluated once into a local.
 * This is not a micro-optimisation: analogRead() called twice returns two
 * different readings, so re-evaluating would silently change behaviour.
 */
function planHoists(ctx: Ctx): void {
  const candidates = [...ctx.consumerCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();

  for (const key of candidates) {
    const separator = key.lastIndexOf(':');
    const nodeId = key.slice(0, separator);
    const portId = key.slice(separator + 1);

    const producer = resolveProducer(ctx, nodeId, portId);
    if (producer === null) continue;
    const def = getNodeDef(producer.node.data.defId);
    if (def === null) continue;

    const expression = expressionForOutput(ctx, producer.node.id, producer.portId, new Set());
    if (isTrivialExpression(expression)) continue;

    const port = findOutputPort(def, producer.portId, producer.node.data.config);
    ctx.hoisted.set(key, {
      name: ctx.names.allocateTemp(def.label.replace(/\s+/g, '')),
      type: port?.type ?? 'int',
      expression,
    });
  }
}

// ── stage 5: assembly ────────────────────────────────────────────────────────

function findEntry(nodes: readonly AnyNode[], defId: string): ForgeNode | null {
  const found = nodes.filter(
    (node): node is ForgeNode => isForgeNode(node) && node.data.defId === defId,
  );
  return found[0] ?? null;
}

export interface GenerateOptions {
  readonly projectName?: string;
  readonly boardName?: string;
  readonly fqbn?: string;
}

export function generate(
  nodes: readonly AnyNode[],
  edges: readonly ForgeEdge[],
  options: GenerateOptions = {},
): GenerateResult {
  const problems = validateGraph(nodes, edges);

  // ── stage 1 + 2: index and collect ──
  const nodeMap = new Map<string, AnyNode>(nodes.map((node) => [node.id, node]));
  const incomingData = new Map<string, ForgeEdge>();
  const consumerCount = new Map<string, number>();

  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.data?.kind !== 'data') continue;
    const targetHandle = parseHandle(edge.targetHandle);
    if (targetHandle?.kind === 'in') {
      incomingData.set(keyFor(edge.target, targetHandle.portId), edge);
    }
  }

  const ctx: Ctx = {
    nodes: nodeMap,
    edges,
    incomingData,
    consumerCount,
    names: new NameAllocator(),
    hoisted: new Map(),
    expressionCache: new Map(),
    requires: {
      includes: new Set(),
      libraries: new Set(),
      globals: new Set(),
      setup: new Set(),
      functions: new Map(),
    },
  };

  // Sorted so the union is order-independent (determinism requirement).
  const sortedForge = [...nodes]
    .filter(isForgeNode)
    .sort((a, b) => a.id.localeCompare(b.id));

  const absorb = (requires: NodeRequires | undefined): void => {
    if (requires === undefined) return;
    for (const include of requires.includes ?? []) ctx.requires.includes.add(include);
    for (const library of requires.libraries ?? []) ctx.requires.libraries.add(library);
    for (const global of requires.globals ?? []) ctx.requires.globals.add(global);
    for (const line of requires.setup ?? []) ctx.requires.setup.add(line);
    for (const fn of requires.functions ?? []) ctx.requires.functions.set(fn.signature, fn.body);
  };

  for (const node of sortedForge) {
    const def = getNodeDef(node.data.defId);
    if (def === null) continue;
    absorb(def.requires);
    if (def.collect !== undefined) {
      absorb(def.collect(makeCollectContext(ctx, node, def)));
    }
  }

  // Counted after ctx exists so consumption can be attributed through reroute
  // points to the node that actually computes the value.
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.data?.kind !== 'data') continue;
    const target = ctx.nodes.get(edge.target);
    if (target !== undefined && isRerouteNode(target)) continue; // counted at its consumers
    const producer = producerOfEdge(ctx, edge);
    if (producer === null) continue;
    const key = keyFor(producer.node.id, producer.portId);
    consumerCount.set(key, (consumerCount.get(key) ?? 0) + 1);
  }

  // AwryLink (§Phase 6 Mode B): injected only when the graph exposes something.
  const injection = buildInjection(nodes);
  if (injection !== null) {
    for (const include of injection.includes) ctx.requires.includes.add(`"${include}"`);
    // The link needs the serial port up. If the graph starts Serial itself we
    // leave it alone; otherwise the link would silently never speak.
    const startsSerial = sortedForge.some((node) => node.data.defId === 'serial.begin');
    if (!startsSerial) ctx.requires.setup.add('Serial.begin(115200);');
    for (const line of injection.setup) ctx.requires.setup.add(line);
  }

  planHoists(ctx);

  // ── emit ──
  const setupEntry = findEntry(nodes, 'event.setup');
  const loopEntry = findEntry(nodes, 'event.loop');

  const hoistLines = (): GeneratedLine[] =>
    [...ctx.hoisted.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, hoist]) => ({
        text: `${INDENT}const ${CPP_TYPE[hoist.type]} ${hoist.name} = ${hoist.expression};`,
        nodeId: null,
      }));

  // Entries emit at depth 0: their body is the branch, which renders at depth 1
  // — exactly one indent inside the function braces.
  const setupBody = setupEntry === null ? [] : emitChain(ctx, setupEntry.id, 0, new Set());
  const loopBody = loopEntry === null ? [] : emitChain(ctx, loopEntry.id, 0, new Set());

  // User-defined functions and ISRs: the node's exec chain becomes the body.
  // Each gets its own visited set so a node used in two functions is not
  // silently dropped from the second.
  const entryFunctions: { signature: string; lines: GeneratedLine[] }[] = [];
  for (const node of sortedForge) {
    const def = getNodeDef(node.data.defId);
    if (def?.functionEntry === undefined) continue;
    const { signature } = def.functionEntry(makeCollectContext(ctx, node, def));
    entryFunctions.push({ signature, lines: emitChain(ctx, node.id, 0, new Set()) });
  }
  entryFunctions.sort((a, b) => a.signature.localeCompare(b.signature));

  const lines: GeneratedLine[] = [];
  const push = (text: string, nodeId: string | null = null) => lines.push({ text, nodeId });

  const rule = '─'.repeat(45);
  push(`// ${rule}`);
  push('//  Generated by ArduForge');
  push(`//  Project: ${options.projectName ?? 'Untitled'}`);
  push(`//  Board:   ${options.boardName ?? 'Arduino Uno'} (${options.fqbn ?? 'arduino:avr:uno'})`);
  push(`// ${rule}`);
  push('');

  const includes = [...ctx.requires.includes].sort();
  if (includes.length > 0) {
    // A local header arrives already quoted; a library header gets angle brackets.
    for (const include of includes) {
      push(include.startsWith('"') ? `#include ${include}` : `#include <${include}>`);
    }
    push('');
  }

  const globals = [...ctx.requires.globals].sort();
  if (globals.length > 0) {
    // A global may be a multi-line block (the AwryLink table). It has to be
    // split here, or one "line" would carry embedded newlines and every
    // source-map line number after it would be wrong.
    for (const global of globals) {
      for (const line of global.split('\n')) push(line);
    }
    push('');
  }

  // The AwryLink table takes the address of every exposed variable, so it must
  // follow their declarations. Sorting it in with the other globals would put
  // it first and the sketch would not compile.
  if (injection !== null) {
    for (const global of injection.globals) {
      for (const line of global.split('\n')) push(line);
    }
    push('');
  }

  const functions = [...ctx.requires.functions.entries()].sort(([a], [b]) => a.localeCompare(b));
  const allSignatures = [
    ...functions.map(([signature]) => signature),
    ...entryFunctions.map((fn) => fn.signature),
  ].sort();
  if (allSignatures.length > 0) {
    for (const signature of allSignatures) push(`${signature};`);
    push('');
  }

  push('void setup() {');
  const setupRequires = [...ctx.requires.setup].sort();
  for (const line of setupRequires) push(`${INDENT}${line}`);
  if (setupBody.length === 0 && setupRequires.length === 0) {
    push(`${INDENT}// Nothing to do at startup.`);
  }
  lines.push(...setupBody);
  push('}');
  push('');

  push('void loop() {');
  if (loopBody.length === 0 && ctx.hoisted.size === 0 && injection === null) {
    push(`${INDENT}// Add an On Loop node to make this board do something.`);
  }
  // §Phase 6: awrylink_poll() is the first statement of loop(), before anything
  // else, so a long user chain cannot starve the link.
  if (injection !== null) {
    for (const line of injection.loopPrologue) push(`${INDENT}${line}`);
  }
  lines.push(...hoistLines());
  lines.push(...loopBody);
  push('}');

  for (const [signature, body] of functions) {
    push('');
    push(`${signature} {`);
    for (const line of body.split('\n')) push(line === '' ? '' : `${INDENT}${line}`);
    push('}');
  }

  for (const fn of entryFunctions) {
    push('');
    push(`${fn.signature} {`);
    if (fn.lines.length === 0) push(`${INDENT}// nothing connected`);
    lines.push(...fn.lines);
    push('}');
  }

  // ── source map ──
  const sourceMap = new Map<number, string>();
  const nodeLines = new Map<string, number[]>();
  lines.forEach((line, index) => {
    if (line.nodeId === null) return;
    const lineNumber = index + 1;
    sourceMap.set(lineNumber, line.nodeId);
    const existing = nodeLines.get(line.nodeId);
    if (existing === undefined) nodeLines.set(line.nodeId, [lineNumber]);
    else existing.push(lineNumber);
  });

  return {
    ok: problems.every((problem) => problem.severity !== 'error'),
    code: `${lines.map((line) => line.text).join('\n')}\n`,
    lines,
    sourceMap,
    nodeLines,
    problems,
    libraries: [...ctx.requires.libraries].sort(),
    exposed: injection?.variables ?? [],
  };
}
