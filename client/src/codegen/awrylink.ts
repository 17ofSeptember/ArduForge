/**
 * AwryLink injection (BUILD_PLAN.md §Phase 6, Mode B).
 *
 * When any variable is marked "Expose to Dashboard", codegen adds the link
 * runtime: the include, the generated variable table, the begin() call in
 * setup(), and awrylink_poll() as the FIRST statement of loop().
 */
import { sanitiseIdentifier } from '@/codegen/names';
import { isForgeNode, type AnyNode } from '@/graph/model';

export interface ExposedVariable {
  /** Name as it appears in the generated C++ and on the wire. */
  readonly name: string;
  readonly cppType: string;
  /** AwryLink type tag. */
  readonly tag: 'AWRY_INT' | 'AWRY_LONG' | 'AWRY_FLOAT' | 'AWRY_BOOL';
  readonly writable: boolean;
  readonly nodeId: string;
}

const TAG_FOR: Record<string, ExposedVariable['tag']> = {
  int: 'AWRY_INT',
  long: 'AWRY_LONG',
  float: 'AWRY_FLOAT',
  bool: 'AWRY_BOOL',
};

/**
 * Every variable the graph exposes, sorted by name so the table — and
 * therefore the generated sketch — is deterministic.
 *
 * `String` variables are deliberately excluded: the link's value buffer is
 * fixed-size and putting Strings in the telemetry hot path is exactly the
 * heap fragmentation §Phase 6 forbids.
 */
export function exposedVariables(nodes: readonly AnyNode[]): readonly ExposedVariable[] {
  const found: ExposedVariable[] = [];

  for (const node of nodes) {
    if (!isForgeNode(node)) continue;
    if (node.data.defId !== 'var.declare') continue;
    if (node.data.config['expose'] !== true) continue;

    const cppType = String(node.data.config['type'] ?? 'int');
    const tag = TAG_FOR[cppType];
    if (tag === undefined) continue; // String and anything unknown are skipped

    found.push({
      name: sanitiseIdentifier(String(node.data.config['name'] ?? 'value'), 'value'),
      cppType,
      tag,
      writable: true,
      nodeId: node.id,
    });
  }

  // De-duplicate by name; two declare nodes with the same name are one variable.
  const byName = new Map<string, ExposedVariable>();
  for (const variable of found) {
    if (!byName.has(variable.name)) byName.set(variable.name, variable);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A short, stable fingerprint of the exposed surface. The host uses it to
 * notice it is talking to a different build than the one it handshook with.
 */
export function sketchHash(variables: readonly ExposedVariable[]): string {
  const material = variables.map((variable) => `${variable.name}:${variable.tag}`).join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export interface AwryLinkInjection {
  readonly includes: readonly string[];
  readonly globals: readonly string[];
  readonly setup: readonly string[];
  /** Emitted as the first statement of loop(). */
  readonly loopPrologue: readonly string[];
  readonly variables: readonly ExposedVariable[];
}

export function buildInjection(nodes: readonly AnyNode[]): AwryLinkInjection | null {
  const variables = exposedVariables(nodes);
  if (variables.length === 0) return null;

  const hash = sketchHash(variables);
  const rows = variables.map(
    (variable) =>
      `  { "${variable.name}", (void *)&${variable.name}, ${variable.tag}, ${variable.writable ? 'true' : 'false'} },`,
  );

  return {
    variables,
    includes: ['AwryLink.h'],
    // One string, not many: globals are collected into a sorted Set, and a
    // multi-line table split across entries would be reordered into nonsense.
    globals: [
      [
        '// Variables exposed to the ArduForge dashboard.',
        'static const AwryVar AWRY_VARS[] = {',
        ...rows,
        '};',
        `static const char AWRY_HASH[] = "${hash}";`,
      ].join('\n'),
    ],
    setup: [
      `awrylink_begin(AWRY_VARS, ${variables.length}, AWRY_HASH);`,
    ],
    loopPrologue: ['awrylink_poll();'],
  };
}
