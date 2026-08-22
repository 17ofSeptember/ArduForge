/**
 * Node and port model (BUILD_PLAN.md §Phase 3).
 *
 * The dual-edge model is the load-bearing decision here. Arduino code is
 * imperative and ordered, so a pure dataflow graph cannot express setup() vs
 * loop(), statement ordering, or control flow. Instead:
 *
 *  - EXEC edges say WHEN something happens. They chain statement nodes.
 *  - DATA edges say WHAT VALUE feeds an input. They are pulled, not pushed:
 *    an expression node emits a C++ expression, never a statement.
 */
import type { LucideIcon } from 'lucide-react';

export type PortType = 'exec' | 'bool' | 'int' | 'float' | 'string' | 'pin' | 'any';

/** §Phase 3 port colour table. Mirrors the tokens in styles/tokens.css. */
export const PORT_COLOR: Record<PortType, string> = {
  exec: 'var(--port-exec)',
  bool: 'var(--port-bool)',
  int: 'var(--port-int)',
  float: 'var(--port-float)',
  string: 'var(--port-string)',
  pin: 'var(--port-pin)',
  any: 'var(--port-any)',
};

export type NodeCategory =
  | 'events'
  | 'io'
  | 'control'
  | 'math'
  | 'logic'
  | 'variables'
  | 'time'
  | 'serial'
  | 'components'
  | 'custom';

export interface CategoryStyle {
  readonly label: string;
  readonly color: string;
}

/** §Phase 3 category hue table. */
export const CATEGORY: Record<NodeCategory, CategoryStyle> = {
  events: { label: 'Events', color: 'var(--cat-events)' },
  io: { label: 'I/O', color: 'var(--cat-io)' },
  control: { label: 'Control Flow', color: 'var(--cat-control)' },
  math: { label: 'Math', color: 'var(--cat-math)' },
  logic: { label: 'Logic', color: 'var(--cat-logic)' },
  variables: { label: 'Variables', color: 'var(--cat-variables)' },
  time: { label: 'Time', color: 'var(--cat-time)' },
  serial: { label: 'Serial', color: 'var(--cat-serial)' },
  components: { label: 'Components', color: 'var(--cat-components)' },
  custom: { label: 'Custom C++', color: 'var(--cat-custom)' },
};

// ── literals ─────────────────────────────────────────────────────────────────

export type LiteralValue = number | boolean | string;

export type LiteralSpec =
  | { kind: 'number'; default: number; min?: number; max?: number; step?: number; integer?: boolean }
  | {
      kind: 'boolean';
      default: boolean;
      /** Shown on the node. Presentation only — never used for codegen. */
      trueLabel?: string;
      falseLabel?: string;
      /** C++ emitted for this literal. Defaults to true/false. */
      cppTrue?: string;
      cppFalse?: string;
    }
  | { kind: 'string'; default: string; placeholder?: string }
  | { kind: 'select'; default: string; options: readonly { value: string; label: string }[] };

export interface PortDef {
  readonly id: string;
  readonly label: string;
  readonly type: PortType;
  /**
   * Inline editor shown on the node when this input has no data edge. Inputs
   * without a literal and without a connection are a validation error, unless
   * the port is `optional`.
   */
  readonly literal?: LiteralSpec;
  /**
   * An input the node can do without. Declare Variable is the case this exists
   * for: its initial value normally comes from a config field, and the port is
   * there to *override* that with an expression. A literal spec would put the
   * same value in two places on the inspector, and no spec at all would make
   * every unconnected node an error.
   */
  readonly optional?: boolean;
}

// ── config fields (inspector panel) ──────────────────────────────────────────

export type FieldDef =
  | { kind: 'text'; id: string; label: string; default: string; placeholder?: string }
  | { kind: 'number'; id: string; label: string; default: number; min?: number; max?: number }
  | { kind: 'checkbox'; id: string; label: string; default: boolean }
  | {
      kind: 'select';
      id: string;
      label: string;
      default: string;
      options: readonly { value: string; label: string }[];
    };

// ── codegen contract (implemented in Phase 4) ────────────────────────────────

export interface EmitContext {
  /** Resolved C++ expression for a data input, literal or connected. */
  input(portId: string): string;
  /** Whether a data edge feeds this input. Optional ports need to know. */
  connected(portId: string): boolean;
  /** Value of an inspector config field. */
  config(fieldId: string): LiteralValue;
  /** Emit the statements chained to the named exec output, already indented. */
  branch(execOut: string): string;
  /** Register a unique temp/global name derived from `base`. */
  unique(base: string): string;
  readonly nodeId: string;
}

export interface EmitResult {
  /** C++ statements, for kind 'statement' | 'entry'. */
  readonly statements?: string;
  /** C++ expression, for kind 'expression'. */
  readonly expression?: string;
}

export interface NodeRequires {
  readonly includes?: readonly string[];
  readonly libraries?: readonly string[];
  readonly globals?: readonly string[];
  readonly setup?: readonly string[];
  /** Whole functions emitted after loop(), with forward declarations above setup(). */
  readonly functions?: readonly { readonly signature: string; readonly body: string }[];
}

/**
 * Read-only view of a node used before statements are emitted.
 * Nodes whose globals depend on their settings — a Servo object named after its
 * pin, a user variable's declaration — compute them here rather than declaring
 * a fixed `requires` block.
 */
export interface CollectContext {
  config(fieldId: string): LiteralValue;
  /**
   * Inline literal for an input, or null when a wire supplies it instead.
   *
   * Null is ambiguous on an optional port — it also means "no literal was ever
   * set" — so use `connected` when the distinction matters.
   */
  literal(portId: string): LiteralValue | null;
  /** Whether a data edge feeds this input. */
  connected(portId: string): boolean;
  readonly nodeId: string;
  /** Stable identifier suffix unique to this node, for naming generated globals. */
  readonly slug: string;
}

/** Ports that depend on a node's configuration rather than being fixed. */
export interface DynamicPorts {
  inputs?(config: Readonly<Record<string, LiteralValue>>): readonly PortDef[];
  outputs?(config: Readonly<Record<string, LiteralValue>>): readonly PortDef[];
  execOut?(config: Readonly<Record<string, LiteralValue>>): readonly string[];
}

export interface NodeDef {
  readonly id: string;
  readonly category: NodeCategory;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
  readonly kind: 'entry' | 'statement' | 'expression';
  readonly execIn?: boolean;
  /** Named exec outputs, e.g. ['then'] or ['true','false'] or ['body','done']. */
  readonly execOut?: readonly string[];
  readonly inputs?: readonly PortDef[];
  readonly outputs?: readonly PortDef[];
  readonly config?: readonly FieldDef[];
  readonly requires?: NodeRequires;
  /** Computed requires, merged with the static `requires` block above. */
  readonly collect?: (ctx: CollectContext) => NodeRequires;
  /** Ports derived from config; overrides the static arrays when present. */
  readonly dynamic?: DynamicPorts;
  /**
   * Marks this node as the head of a user-defined function: its exec chain
   * becomes the body, emitted after loop() with a forward declaration above
   * setup(). Keeps the generator free of any knowledge of specific node ids.
   */
  readonly functionEntry?: (ctx: CollectContext) => { readonly signature: string };
  /** Only one instance of this node may exist in a graph (On Setup, On Loop). */
  readonly singleton?: boolean;
  /** Compact body summary, e.g. "PIN 13 <- HIGH". */
  readonly summary?: (values: Readonly<Record<string, LiteralValue>>) => string;
  readonly emit: (ctx: EmitContext) => EmitResult;
}

// ── handle id encoding ───────────────────────────────────────────────────────
//
// React Flow identifies connection endpoints by handle id, so the id has to
// carry enough to type-check a connection without looking anything else up.

export const EXEC_IN_HANDLE = 'exec-in';

export function execOutHandle(name: string): string {
  return `exec-out:${name}`;
}

export function dataInHandle(portId: string): string {
  return `in:${portId}`;
}

export function dataOutHandle(portId: string): string {
  return `out:${portId}`;
}

export function isExecHandle(handleId: string | null | undefined): boolean {
  return handleId === EXEC_IN_HANDLE || (handleId ?? '').startsWith('exec-out:');
}

export function parseHandle(
  handleId: string | null | undefined,
): { kind: 'exec-in' } | { kind: 'exec-out'; name: string } | { kind: 'in' | 'out'; portId: string } | null {
  if (handleId === null || handleId === undefined) return null;
  if (handleId === EXEC_IN_HANDLE) return { kind: 'exec-in' };
  if (handleId.startsWith('exec-out:')) return { kind: 'exec-out', name: handleId.slice(9) };
  if (handleId.startsWith('in:')) return { kind: 'in', portId: handleId.slice(3) };
  if (handleId.startsWith('out:')) return { kind: 'out', portId: handleId.slice(4) };
  return null;
}
