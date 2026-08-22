/**
 * Graph builder for bundled examples (BUILD_PLAN.md §Phase 7).
 *
 * Ids are sequential rather than time-based, so an example builds to the same
 * graph every run and its golden file stays stable.
 */
import type { AnyNode, ForgeEdge, ForgeNode } from '@/graph/model';
import { getNodeDef, inputPorts } from '@/nodes/registry';
import type { LiteralValue } from '@/nodes/types';

export class GraphBuilder {
  private readonly nodes: AnyNode[] = [];
  private readonly edges: ForgeEdge[] = [];
  private sequence = 0;

  add(
    defId: string,
    position: { x: number; y: number },
    options: {
      config?: Record<string, LiteralValue>;
      literals?: Record<string, LiteralValue>;
    } = {},
  ): string {
    const def = getNodeDef(defId);
    if (def === null) throw new Error(`Unknown node in example: ${defId}`);

    this.sequence += 1;
    const id = `n${this.sequence}`;

    const literals: Record<string, LiteralValue> = {};
    for (const port of inputPorts(def, options.config ?? {})) {
      if (port.literal !== undefined) literals[port.id] = port.literal.default;
    }
    const config: Record<string, LiteralValue> = {};
    for (const field of def.config ?? []) config[field.id] = field.default;

    const node: ForgeNode = {
      id,
      type: 'forge',
      position,
      data: {
        defId,
        literals: { ...literals, ...options.literals },
        config: { ...config, ...options.config },
      },
    };
    this.nodes.push(node);
    return id;
  }

  /** Chains an exec output to the next node's exec input. */
  exec(source: string, output: string, target: string): void {
    this.edges.push({
      id: `e${this.edges.length + 1}`,
      source,
      target,
      sourceHandle: `exec-out:${output}`,
      targetHandle: 'exec-in',
      type: 'forge',
      data: { kind: 'exec', portType: 'exec' },
    });
  }

  /** Runs a straight chain of statements off one exec output. */
  chain(entry: string, output: string, steps: readonly string[]): void {
    let previous = entry;
    let handle = output;
    for (const step of steps) {
      this.exec(previous, handle, step);
      previous = step;
      handle = 'then';
    }
  }

  data(source: string, outputPort: string, target: string, inputPort: string): void {
    const sourceNode = this.nodes.find((node) => node.id === source);
    const defId = sourceNode?.type === 'forge' ? sourceNode.data.defId : '';
    const def = getNodeDef(defId);
    const config = sourceNode?.type === 'forge' ? sourceNode.data.config : {};
    const portType =
      def === null
        ? 'any'
        : ((def.dynamic?.outputs?.(config) ?? def.outputs ?? []).find(
            (port) => port.id === outputPort,
          )?.type ?? 'any');

    this.edges.push({
      id: `e${this.edges.length + 1}`,
      source,
      target,
      sourceHandle: `out:${outputPort}`,
      targetHandle: `in:${inputPort}`,
      type: 'forge',
      data: { kind: 'data', portType },
    });
  }

  build(): { nodes: AnyNode[]; edges: ForgeEdge[] } {
    return { nodes: [...this.nodes], edges: [...this.edges] };
  }
}

export interface WiringPart {
  readonly name: string;
  readonly detail: string;
}

export interface Example {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parts: readonly WiringPart[];
  /** Inline SVG wiring diagram. */
  readonly wiring: string;
  readonly build: () => { nodes: AnyNode[]; edges: ForgeEdge[] };
  readonly dashboard?: () => { pages: readonly unknown[]; widgets: readonly unknown[] };
}

// ── wiring diagram helpers ───────────────────────────────────────────────────

/**
 * DO NOT THEME (THEME.md Phase 5). These are literal wire colours. The user is
 * holding a physical wire against a physical breadboard and matching it to this
 * diagram, so they mean a real-world thing rather than a decorative one — the
 * moment they follow the app's palette instead, the diagram is wrong.
 *
 * A future colour sweep will want to "fix" these. Don't.
 *
 * The diagram's *chrome* below — plate, pin labels — is themed, because none of
 * it corresponds to anything physical.
 */
export const WIRE_COLORS = {
  power: '#E5484D', // red    — 5V / VCC
  ground: '#1A1A1A', // black  — GND
  signal: '#EFC544', // yellow — generic signal
  data: '#30A46C', // green  — data
  sda: '#2C7BE5', // blue   — I²C SDA
  scl: '#F5F5F5', // white  — I²C SCL
  pwm: '#F08519', // orange — PWM
} as const;

export type WireKind = keyof typeof WIRE_COLORS;

/**
 * Small inline SVG builder. Diagrams are schematic — pin labels and wire
 * colours — rather than pictorial: the point is which pin goes where.
 *
 * Rendered with dangerouslySetInnerHTML, so this lands as inline SVG in the
 * document and CSS custom properties resolve against the current theme.
 */
export function wiringDiagram(
  rows: readonly { readonly from: string; readonly to: string; readonly kind: WireKind }[],
): string {
  const rowHeight = 26;
  const height = rows.length * rowHeight + 24;

  const lines = rows
    .map((row, index) => {
      const y = 22 + index * rowHeight;
      const color = WIRE_COLORS[row.kind] ?? WIRE_COLORS.signal;
      // Halo (THEME.md Phase 5). Wire colours are literal, which means the set
      // includes both black (GND) and white (SCL) — one of which would vanish
      // into the plate in each theme. Drawing the stroke twice, wider and in the
      // plate colour underneath, keeps every wire legible in both without
      // touching the wire colour itself.
      return `
    <text x="8" y="${y + 4}" fill="var(--text-secondary)" font-family="ui-monospace, monospace" font-size="11">${row.from}</text>
    <line x1="96" y1="${y}" x2="196" y2="${y}" stroke="var(--bg-card)" stroke-width="4" stroke-linecap="round" />
    <line x1="96" y1="${y}" x2="196" y2="${y}" stroke="${color}" stroke-width="2" stroke-linecap="round" />
    <circle cx="96" cy="${y}" r="4" fill="var(--bg-card)" />
    <circle cx="196" cy="${y}" r="4" fill="var(--bg-card)" />
    <circle cx="96" cy="${y}" r="3" fill="${color}" />
    <circle cx="196" cy="${y}" r="3" fill="${color}" />
    <text x="206" y="${y + 4}" fill="var(--text-primary)" font-family="ui-monospace, monospace" font-size="11">${row.to}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 380 ${height}" width="100%" role="img" aria-label="Wiring diagram">
    <rect x="0" y="0" width="380" height="${height}" fill="var(--bg-input)" rx="6" />${lines}
  </svg>`;
}
