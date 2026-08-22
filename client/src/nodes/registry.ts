/**
 * Node registry. Phase 3 ships the subset needed to prove the model; Phase 5
 * grows it to the full library. Nothing outside this file should hold a list
 * of node ids.
 */
import type { LiteralValue, NodeDef, PortDef, PortType } from '@/nodes/types';
import { eventNodes } from '@/nodes/defs/events';
import { ioNodes } from '@/nodes/defs/io';
import { controlNodes } from '@/nodes/defs/control';
import { mathNodes } from '@/nodes/defs/math';
import { logicNodes } from '@/nodes/defs/logic';
import { variableNodes } from '@/nodes/defs/variables';
import { timeNodes } from '@/nodes/defs/time';
import { serialNodes } from '@/nodes/defs/serial';
import { textNodes } from '@/nodes/defs/text';
import { componentNodes } from '@/nodes/defs/components';
import { customNodes } from '@/nodes/defs/custom';

const ALL: readonly NodeDef[] = [
  ...eventNodes,
  ...ioNodes,
  ...controlNodes,
  ...mathNodes,
  ...logicNodes,
  ...variableNodes,
  ...timeNodes,
  ...serialNodes,
  ...textNodes,
  ...componentNodes,
  ...customNodes,
];

const BY_ID = new Map<string, NodeDef>(ALL.map((def) => [def.id, def]));

if (BY_ID.size !== ALL.length) {
  throw new Error('Duplicate node definition id in the registry.');
}

export const allNodeDefs: readonly NodeDef[] = ALL;

export function getNodeDef(id: string): NodeDef | null {
  return BY_ID.get(id) ?? null;
}

export function requireNodeDef(id: string): NodeDef {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown node definition: ${id}`);
  return def;
}

type Config = Readonly<Record<string, LiteralValue>>;

const NO_CONFIG: Config = {};

/**
 * Port lists resolve against a node's configuration, because some nodes grow
 * ports from their settings (Sequence's step count, a Custom Function's
 * parameters). Every consumer — canvas, inspector, validation, connection
 * checking, codegen — must go through these so they agree on what exists.
 */
/**
 * A node's config with the def's declared defaults filled in.
 *
 * Every dynamic shape must be resolved against this rather than against the raw
 * stored config. `EmitContext.config()` already falls back to the def default
 * when a key is absent, so without the same fallback here the ports and the
 * emitted code disagree — and they disagree exactly for nodes saved before a
 * config field was added, which is every existing project.
 *
 * The bug this fixes: a graph saved before `numericType` existed reported float
 * ports for a Bitwise And (raw config, no key, falls through to `float`) while
 * emitting integer code (`ctx.config()`, def default `int`). codegen inserted
 * `(float)` casts to satisfy the ports, producing
 * `((float)(a) & (float)(b))` — which does not compile, with validation
 * reporting nothing.
 */
export function withConfigDefaults(def: NodeDef, config: Config): Config {
  const fields = def.config ?? [];
  if (fields.length === 0) return config;

  let merged: Record<string, LiteralValue> | null = null;
  for (const field of fields) {
    if (config[field.id] !== undefined) continue;
    merged ??= { ...config };
    merged[field.id] = field.default;
  }
  return merged ?? config;
}

export function inputPorts(def: NodeDef, config: Config = NO_CONFIG): readonly PortDef[] {
  return def.dynamic?.inputs?.(withConfigDefaults(def, config)) ?? def.inputs ?? [];
}

export function outputPorts(def: NodeDef, config: Config = NO_CONFIG): readonly PortDef[] {
  return def.dynamic?.outputs?.(withConfigDefaults(def, config)) ?? def.outputs ?? [];
}

export function execOuts(def: NodeDef, config: Config = NO_CONFIG): readonly string[] {
  return def.dynamic?.execOut?.(withConfigDefaults(def, config)) ?? def.execOut ?? [];
}

export function findInputPort(def: NodeDef, portId: string, config: Config = NO_CONFIG): PortDef | null {
  return inputPorts(def, config).find((port) => port.id === portId) ?? null;
}

export function findOutputPort(def: NodeDef, portId: string, config: Config = NO_CONFIG): PortDef | null {
  return outputPorts(def, config).find((port) => port.id === portId) ?? null;
}

/** Node types that can produce a value assignable to `target`. Powers the drag-to-empty picker. */
export function defsProducing(target: PortType): readonly NodeDef[] {
  return ALL.filter((def) => outputPorts(def).some((port) => port.type === target || target === 'any'));
}

/** Every library any node in the graph needs, for the missing-library check. */
export function librariesFor(defIds: Iterable<string>): readonly string[] {
  const libraries = new Set<string>();
  for (const id of defIds) {
    for (const library of getNodeDef(id)?.requires?.libraries ?? []) libraries.add(library);
  }
  return [...libraries].sort();
}

export function searchDefs(query: string): readonly NodeDef[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return ALL;

  // Simple subsequence match, so "dw" finds "Digital Write".
  const scored: { def: NodeDef; score: number }[] = [];
  for (const def of ALL) {
    const haystack = `${def.label} ${def.id} ${def.description}`.toLowerCase();
    const direct = haystack.indexOf(needle);
    if (direct !== -1) {
      scored.push({ def, score: direct });
      continue;
    }
    let cursor = 0;
    let matched = 0;
    for (const char of needle) {
      const found = haystack.indexOf(char, cursor);
      if (found === -1) break;
      cursor = found + 1;
      matched += 1;
    }
    if (matched === needle.length) scored.push({ def, score: 1_000 + cursor });
  }
  return scored.sort((a, b) => a.score - b.score || a.def.label.localeCompare(b.def.label)).map((s) => s.def);
}
