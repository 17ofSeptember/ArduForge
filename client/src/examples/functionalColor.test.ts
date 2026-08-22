/**
 * Functional colour that must NOT be themed (THEME.md Phase 5).
 *
 * These assertions exist because the failure mode is silent. A future colour
 * sweep — exactly like the one Phase 3 ran — will see literal hex in these
 * files and "fix" it, at which point the wiring diagrams stop matching the
 * wires in the user's hand and a saved dashboard quietly changes colour.
 *
 * Every case here is a rule from Phase 5, not a style preference.
 */
import { describe, expect, it } from 'vitest';
import { WIRE_COLORS, wiringDiagram } from '@/examples/builder';
import { WIDGET_SPECS } from '@/dashboard/model';
import { migrate, serialize } from '@/store/persistence';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance. The sRGB transfer function is not optional here:
 *  skipping it reports #1A1A1A as 0.102 rather than its actual 0.010. */
function luminance(hex: string): number {
  const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('wiring diagram wire colours', () => {
  it('are literal hex, never tokens', () => {
    for (const [kind, value] of Object.entries(WIRE_COLORS)) {
      expect(value, `${kind} must stay a literal colour`).toMatch(HEX);
      expect(value).not.toContain('var(');
    }
  });

  it('follows the real-world convention the examples teach', () => {
    // Red 5V, black GND, blue SDA, white SCL. These are the wires in the box.
    expect(WIRE_COLORS.power.toLowerCase()).toBe('#e5484d');
    expect(WIRE_COLORS.ground.toLowerCase()).toBe('#1a1a1a');
    expect(WIRE_COLORS.sda.toLowerCase()).toBe('#2c7be5');
    expect(WIRE_COLORS.scl.toLowerCase()).toBe('#f5f5f5');
  });

  it('includes both a near-black and a near-white wire', () => {
    // This is *why* the halo exists — one of these would vanish into the plate
    // in each theme without it.
    const values = Object.values(WIRE_COLORS).map(luminance);
    expect(Math.min(...values)).toBeLessThan(0.02);
    expect(Math.max(...values)).toBeGreaterThan(0.85);

    // Concretely: GND is unreadable on the dark plate and SCL on the light one,
    // so neither can rely on contrast against the background alone.
    expect(ratio(WIRE_COLORS.ground, '#19303C')).toBeLessThan(1.5);
    expect(ratio(WIRE_COLORS.scl, '#F0F5F8')).toBeLessThan(1.5);
  });

  it('draws every wire twice: a plate-coloured halo, then the wire itself', () => {
    const svg = wiringDiagram([{ from: 'GND', to: 'GND', kind: 'ground' }]);

    // Halo underneath, wider, in the surface colour.
    expect(svg).toContain('stroke="var(--bg-card)" stroke-width="4"');
    // The literal wire on top, narrower.
    expect(svg).toContain(`stroke="${WIRE_COLORS.ground}" stroke-width="2"`);
    // Halo is drawn first, or it would paint over the wire.
    expect(svg.indexOf('var(--bg-card)')).toBeLessThan(svg.indexOf(WIRE_COLORS.ground));
  });

  it('themes the diagram chrome but not the wires', () => {
    const svg = wiringDiagram([{ from: '5V', to: 'VCC', kind: 'power' }]);
    // Plate and labels follow the theme.
    expect(svg).toContain('fill="var(--bg-input)"');
    expect(svg).toContain('fill="var(--text-secondary)"');
    expect(svg).toContain('fill="var(--text-primary)"');
    // The wire does not.
    expect(svg).toContain(WIRE_COLORS.power);
  });
});

describe('user-configured widget colours', () => {
  it('offers defaults that are legible on both card surfaces', () => {
    // A widget colour is frozen into the project file, so it cannot be
    // theme-aware; each default is placed where the worse of the two is best.
    const DARK_CARD = '#19303C';
    const LIGHT_CARD = '#F0F5F8';

    const colors = WIDGET_SPECS.flatMap((spec) => {
      const direct = typeof spec.defaults.color === 'string' ? [spec.defaults.color] : [];
      const zones = (spec.defaults.zones ?? []).map((zone) => zone.color);
      return [...direct, ...zones];
    });

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toMatch(HEX);
      expect(ratio(color, DARK_CARD), `${color} on the dark card`).toBeGreaterThanOrEqual(3);
      expect(ratio(color, LIGHT_CARD), `${color} on the light card`).toBeGreaterThanOrEqual(3);
    }
  });

  it('round-trips a saved colour untouched — rewriting it would be data loss', () => {
    const raw = {
      version: 1,
      meta: { name: 'Saved', createdAt: 0, updatedAt: 0 },
      board: { fqbn: 'arduino:avr:uno', name: 'Uno' },
      graph: { nodes: [], edges: [] },
      dashboard: {
        pages: [{ id: 'p1', name: 'Page 1' }],
        widgets: [
          {
            id: 'w1',
            type: 'led',
            pageId: 'p1',
            x: 0,
            y: 0,
            w: 2,
            h: 2,
            binding: { kind: 'none' },
            // A colour the user picked. Not one of ours, and not on the palette.
            config: { label: 'LED', color: '#FF00AA' },
          },
        ],
      },
    };

    // ForgeProject keeps the dashboard as `readonly unknown[]` — persistence
    // deliberately does not model widget internals, which is precisely why a
    // saved colour cannot be rewritten in transit.
    const colorOf = (project: ReturnType<typeof migrate>): unknown =>
      (project.dashboard.widgets[0] as { config?: { color?: unknown } } | undefined)?.config?.color;

    const project = migrate(raw);
    expect(colorOf(project)).toBe('#FF00AA');

    // And it survives a further save/load cycle.
    expect(serialize(project)).toContain('#FF00AA');
    expect(colorOf(migrate(JSON.parse(serialize(project))))).toBe('#FF00AA');
  });
});
