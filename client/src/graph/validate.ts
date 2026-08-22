/**
 * Graph validation (BUILD_PLAN.md §Phase 4 step 1, surfaced live in §Phase 3).
 *
 * Runs on every graph change to drive the error overlay and problems panel, and
 * is the same check codegen will refuse to run without.
 */
import { getNodeDef, inputPorts } from '@/nodes/registry';
import { isForgeNode, type AnyNode, type ForgeEdge, type ForgeNode } from '@/graph/model';
import { parseHandle } from '@/nodes/types';

export interface Problem {
  readonly nodeId: string | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** Data edges must never form a cycle; an expression that feeds itself cannot be emitted. */
function findDataCycle(nodes: readonly AnyNode[], edges: readonly ForgeEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.data?.kind !== 'data') continue;
    // Data flows source -> target.
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const node of nodes) colour.set(node.id, WHITE);

  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (id: string): boolean => {
    colour.set(id, GREY);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) {
        cycle = [...stack.slice(stack.indexOf(next)), next];
        return true;
      }
      if (state === WHITE && visit(next)) return true;
    }
    stack.pop();
    colour.set(id, BLACK);
    return false;
  };

  for (const node of nodes) {
    if ((colour.get(node.id) ?? WHITE) === WHITE && visit(node.id)) break;
  }
  return cycle;
}

export function validateGraph(
  nodes: readonly AnyNode[],
  edges: readonly ForgeEdge[],
): readonly Problem[] {
  const problems: Problem[] = [];
  const forgeNodes = nodes.filter(isForgeNode);

  // Which data inputs are satisfied by an edge.
  const connectedInputs = new Set<string>();
  for (const edge of edges) {
    if (edge.data?.kind !== 'data') continue;
    const handle = parseHandle(edge.targetHandle);
    if (handle?.kind === 'in') connectedInputs.add(`${edge.target}:${handle.portId}`);
  }

  const singletonCounts = new Map<string, number>();

  for (const node of forgeNodes) {
    const def = getNodeDef(node.data.defId);
    if (def === null) {
      problems.push({
        nodeId: node.id,
        severity: 'error',
        message: `Unknown node type "${node.data.defId}". It may come from a newer version of ArduForge.`,
      });
      continue;
    }

    if (def.singleton === true) {
      singletonCounts.set(def.id, (singletonCounts.get(def.id) ?? 0) + 1);
    }

    for (const port of inputPorts(def, node.data.config)) {
      const satisfied = connectedInputs.has(`${node.id}:${port.id}`);
      const hasLiteral = port.literal !== undefined;
      if (!satisfied && !hasLiteral && port.optional !== true) {
        problems.push({
          nodeId: node.id,
          severity: 'error',
          message: `${def.label}: input "${port.label}" needs a connection.`,
        });
      }
    }
  }

  for (const [defId, count] of singletonCounts) {
    if (count > 1) {
      const def = getNodeDef(defId);
      problems.push({
        nodeId: null,
        severity: 'error',
        message: `There are ${count} "${def?.label ?? defId}" nodes. Only one is allowed.`,
      });
    }
  }

  const cycle = findDataCycle(nodes, edges);
  if (cycle !== null) {
    problems.push({
      nodeId: cycle[0] ?? null,
      severity: 'error',
      message: 'These value connections form a loop. A value cannot depend on itself.',
    });
  }

  // Writing to a pin that was never set to OUTPUT is the classic silent
  // failure: on an Uno digitalWrite() on an INPUT pin only enables the pull-up,
  // so the LED glows faintly instead of blinking and nothing looks wrong.
  const pinModeOutputs = new Set<number>();
  for (const node of forgeNodes) {
    if (node.data.defId !== 'io.pinMode') continue;
    if (node.data.config['mode'] !== 'OUTPUT') continue;
    const pin = node.data.literals['pin'];
    if (typeof pin === 'number') pinModeOutputs.add(pin);
  }

  for (const node of forgeNodes) {
    if (node.data.defId !== 'io.digitalWrite' && node.data.defId !== 'io.analogWrite') continue;
    // Only checkable when the pin is a literal; a computed pin is the user's business.
    if (connectedInputs.has(`${node.id}:pin`)) continue;
    const pin = node.data.literals['pin'];
    if (typeof pin !== 'number' || pinModeOutputs.has(pin)) continue;

    problems.push({
      nodeId: node.id,
      severity: 'warning',
      message: `Pin ${pin} is written to but never set to OUTPUT. Add a Pin Mode node in On Setup, or the pin will only drive a weak pull-up.`,
    });
  }

  // Statement nodes stranded outside any exec chain will never run. Not fatal,
  // but silently dropping a node the user wired up would be worse.
  const execTargets = new Set<string>();
  for (const edge of edges) {
    if (edge.data?.kind === 'exec') execTargets.add(edge.target);
  }
  for (const node of forgeNodes) {
    const def = getNodeDef(node.data.defId);
    if (def === null || def.kind !== 'statement') continue;
    if (!execTargets.has(node.id)) {
      problems.push({
        nodeId: node.id,
        severity: 'warning',
        message: `${def.label} is not connected to On Setup or On Loop, so it will never run.`,
      });
    }
  }

  problems.push(...numericModeProblems(forgeNodes));
  problems.push(...variableScopeProblems(forgeNodes));
  problems.push(...initialValueProblems(forgeNodes, connectedInputs));
  problems.push(...loopIndexProblems(forgeNodes, edges));

  return problems;
}

/** Bitwise operators and modulo have no meaning on floating point in C++. */
const INTEGER_ONLY = new Set([
  'logic.bitAnd',
  'logic.bitOr',
  'logic.bitXor',
  'logic.shiftLeft',
  'logic.shiftRight',
  'math.modulo',
]);

/**
 * Numeric mode rules that C++ itself enforces, caught here instead.
 *
 * Without these the sketch reaches arduino-cli and fails on a line the user
 * never wrote — `invalid operands of types float and float to binary operator&`
 * pointing into generated code is not a diagnosis anyone can act on.
 */
function numericModeProblems(nodes: readonly ForgeNode[]): Problem[] {
  const problems: Problem[] = [];
  for (const node of nodes) {
    const mode = String(node.data.config['numericType'] ?? '');
    if (mode === '') continue;

    if (mode === 'float' && INTEGER_ONLY.has(node.data.defId)) {
      problems.push({
        nodeId: node.id,
        severity: 'error',
        message:
          `${getNodeDef(node.data.defId)?.label ?? node.data.defId} works on whole numbers only — ` +
          'C++ has no bitwise or remainder operation on decimals. Set the number type to a whole number.',
      });
      continue;
    }

    // pow() returns a double and drags roughly a kilobyte of floating-point
    // support into the sketch. Offering an integer mode that quietly emitted
    // pow() anyway would be a lie about the cost, and writing an integer power
    // helper invites overflow behaviour that differs from pow(); so the mode is
    // refused and the user is told what to do instead.
    if (node.data.defId === 'math.power' && mode !== 'float') {
      problems.push({
        nodeId: node.id,
        severity: 'error',
        message:
          'Power is only available on decimals: it emits pow(), which returns a double and costs about 1KB of flash. ' +
          'For a whole-number power, multiply in a loop instead.',
      });
    }
  }
  return problems;
}

/**
 * A dashboard-exposed variable must have a stable address.
 *
 * AWRY_VARS holds a raw `void *` to each exposed variable, taken once at
 * startup. A plain local lives on the stack: its address is only valid while
 * the chain is running, and writing through that pointer afterwards corrupts
 * whatever occupies that stack slot next. This is an error rather than a silent
 * coercion to global, because quietly changing where a variable lives changes
 * how much SRAM the sketch uses and how long the value survives — both things
 * the user chose deliberately.
 */
function variableScopeProblems(nodes: readonly ForgeNode[]): Problem[] {
  const problems: Problem[] = [];
  for (const node of nodes) {
    if (node.data.defId !== 'var.declare') continue;
    if (node.data.config['expose'] !== true) continue;
    const scope = String(node.data.config['scope'] ?? 'local');
    if (scope === 'global' || scope === 'static-local') continue;

    problems.push({
      nodeId: node.id,
      severity: 'error',
      message:
        `"${String(node.data.config['name'] ?? 'value')}" is exposed to the Dashboard but is local to its chain. ` +
        'A local variable has no fixed address for the Dashboard to read. Set its scope to global, or to "keeps its value".',
    });
  }
  return problems;
}

/**
 * The starting-value field holds a literal or a name — never an expression.
 *
 * Now that the field is emitted as source text rather than coerced through
 * `Number()`, anything typed into it lands in the generated sketch verbatim. A
 * literal or a reference is exactly what belongs there; an expression is not,
 * and the port beside it exists precisely so that expressions have somewhere
 * correct to go. Catching it here beats catching it as an arduino-cli error
 * pointing at a line the user never wrote.
 */
function initialValueProblems(
  nodes: readonly ForgeNode[],
  connectedInputs: ReadonlySet<string>,
): Problem[] {
  const problems: Problem[] = [];

  for (const node of nodes) {
    if (node.data.defId !== 'var.declare') continue;
    // A wired initializer takes over completely; the field is then unused.
    if (connectedInputs.has(`${node.id}:value`)) continue;

    const text = String(node.data.config['initial'] ?? '').trim();
    if (text === '') continue;

    const type = String(node.data.config['type'] ?? 'int');
    if (type === 'String') continue; // any text is a valid string

    if (isLiteralOrName(text)) continue;

    problems.push({
      nodeId: node.id,
      severity: 'error',
      message:
        `"${text}" is not a value — the starting value must be a literal or the name of another constant. ` +
        'Connect the Initial value input to compute it instead.',
    });
  }

  return problems;
}

/**
 * Every literal notation Arduino accepts, plus a bare identifier.
 *
 * Notation is preserved rather than normalized (§Phase 3), so each of these has
 * to be recognized in the form the user wrote it: hex, binary, octal, decimal,
 * float with or without a suffix, exponent, and character literals.
 */
function isLiteralOrName(text: string): boolean {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return true; // HIGH, A0, LED_BUILTIN
  if (/^-?0[xX][0-9a-fA-F]+[uUlL]*$/.test(text)) return true; // 0x1A
  if (/^-?0[bB][01]+[uUlL]*$/.test(text)) return true; // 0b1010
  if (/^-?\d+[uUlL]*$/.test(text)) return true; // 42, 42UL
  if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?[fFlL]?$/.test(text)) return true; // 1e3, 0.05f
  if (/^'([^'\\]|\\.)'$/.test(text)) return true; // 'A'
  return false;
}

/**
 * A named loop index must not collide with something already in scope.
 *
 * "In scope" is the operative word, and it is narrower than "used anywhere".
 * Two sequential `for (int i = 0; …)` loops are ordinary C++ — their indices
 * never coexist — so flagging them would reject correct code. What genuinely
 * shadows is a For *nested inside another For's body* with the same name, and a
 * global whose name the index takes over for the length of the loop.
 *
 * Nesting is resolved by walking the body chain rather than by position on the
 * canvas, because the exec edges are what decide containment in the emitted
 * source.
 */
function loopIndexProblems(nodes: readonly ForgeNode[], edges: readonly ForgeEdge[]): Problem[] {
  const problems: Problem[] = [];

  const globals = new Set<string>();
  for (const node of nodes) {
    if (node.data.defId !== 'var.declare') continue;
    if (String(node.data.config['scope'] ?? 'local') !== 'global') continue;
    const name = String(node.data.config['name'] ?? '').trim();
    if (name !== '') globals.add(name);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const execFrom = new Map<string, string[]>();
  const bodyFrom = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.data?.kind !== 'exec') continue;
    const list = execFrom.get(edge.source) ?? [];
    list.push(edge.target);
    execFrom.set(edge.source, list);

    // Containment begins at `body` and nowhere else. A loop reached through
    // `done` is the *next* statement, not a nested one, and following it would
    // report two sequential loops as if one were inside the other.
    if (edge.sourceHandle === 'exec-out:body') {
      const bodyList = bodyFrom.get(edge.source) ?? [];
      bodyList.push(edge.target);
      bodyFrom.set(edge.source, bodyList);
    }
  }

  /** Everything inside a loop's body: its body chain, and all of that chain's. */
  const contained = (start: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(bodyFrom.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      // Once inside the body, every continuation is still inside it.
      queue.push(...(execFrom.get(next) ?? []));
    }
    return seen;
  };

  const indexOf = (node: ForgeNode): string =>
    node.data.defId === 'control.for' ? String(node.data.config['index'] ?? '').trim() : '';

  for (const node of nodes) {
    const name = indexOf(node);
    if (name === '') continue; // generated names cannot collide

    if (globals.has(name)) {
      problems.push({
        nodeId: node.id,
        severity: 'error',
        message: `Loop index "${name}" has the same name as a global variable. Inside the loop it would shadow it, and the global would be unreachable.`,
      });
      continue;
    }

    for (const id of contained(node.id)) {
      const inner = byId.get(id);
      if (inner === undefined || inner.id === node.id) continue;
      if (indexOf(inner) !== name) continue;
      problems.push({
        nodeId: inner.id,
        severity: 'error',
        message: `Loop index "${name}" is already the index of the For loop this one sits inside. Give the inner loop a different name.`,
      });
      break;
    }
  }

  return problems;
}
