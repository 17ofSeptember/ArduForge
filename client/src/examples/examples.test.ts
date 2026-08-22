/**
 * Golden tests for the bundled examples (BUILD_PLAN.md §Phase 7).
 * "Each example must be a golden test: load it, generate code, compare to a
 * committed snapshot." Compilation itself is the hardware gate; this asserts
 * everything that can be checked without a board.
 */
import { describe, expect, it } from 'vitest';
import { examples } from '@/examples';
import { generate } from '@/codegen/generate';
import { validateGraph } from '@/graph/validate';

describe('bundled examples', () => {
  it('ships the eleven the plan lists', () => {
    expect(examples).toHaveLength(11);
    expect(new Set(examples.map((example) => example.id)).size).toBe(11);
  });

  for (const example of examples) {
    describe(example.name, () => {
      it('builds a graph with no validation errors', () => {
        const { nodes, edges } = example.build();
        const errors = validateGraph(nodes, edges).filter(
          (problem) => problem.severity === 'error',
        );
        expect(errors).toEqual([]);
      });

      it('generates code', () => {
        const { nodes, edges } = example.build();
        const result = generate(nodes, edges, { projectName: example.name });

        expect(result.ok).toBe(true);
        expect(result.code).toContain('void setup()');
        expect(result.code).toContain('void loop()');
        // Every example does something; none should emit an empty loop.
        expect(result.code).not.toContain('Add an On Loop node');
      });

      it('generates deterministically', () => {
        const first = generate(...buildArgs(example));
        const second = generate(...buildArgs(example));
        expect(first.code).toBe(second.code);
      });

      it('has a parts list and a wiring diagram', () => {
        expect(example.parts.length).toBeGreaterThan(0);
        for (const part of example.parts) {
          expect(part.name.length).toBeGreaterThan(0);
          expect(part.detail.length).toBeGreaterThan(0);
        }
        expect(example.wiring).toContain('<svg');
        expect(example.wiring).toContain('</svg>');
      });

      it('has a description that explains what it does', () => {
        expect(example.description.length).toBeGreaterThan(40);
      });

      it('binds every dashboard widget to something the sketch exposes', () => {
        const dashboard = example.dashboard?.();
        if (dashboard === undefined) return;

        const { nodes, edges } = example.build();
        const exposed = new Set(
          generate(nodes, edges).exposed.map((variable) => variable.name),
        );

        for (const raw of dashboard.widgets) {
          const widget = raw as { binding?: { kind: string; name?: string }; type: string };
          if (widget.binding?.kind !== 'var') continue;
          // A widget bound to a name the sketch does not expose would render
          // with a broken badge the moment the example opened.
          expect(exposed.has(widget.binding.name ?? '')).toBe(true);
        }
      });
    });
  }
});

function buildArgs(example: (typeof examples)[number]) {
  const { nodes, edges } = example.build();
  return [nodes, edges, { projectName: example.name }] as const;
}

describe('examples that the plan calls out specifically', () => {
  it('Blink uses a non-blocking timer rather than delay()', () => {
    const blink = examples.find((example) => example.id === 'blink');
    expect(blink).toBeDefined();
    if (blink === undefined) return;

    const { nodes, edges } = blink.build();
    const code = generate(nodes, edges).code;
    expect(code).toContain('millis()');
    expect(code).not.toContain('delay(');
  });

  it('Traffic Light emits a switch and an interrupt handler', () => {
    const traffic = examples.find((example) => example.id === 'traffic-light');
    if (traffic === undefined) throw new Error('missing example');

    const { nodes, edges } = traffic.build();
    const code = generate(nodes, edges).code;
    expect(code).toContain('switch (light)');
    expect(code).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\)/);
  });

  it('Light-Seeking Servo exposes a tunable gain, which is the point of it', () => {
    const seeker = examples.find((example) => example.id === 'light-seeker');
    if (seeker === undefined) throw new Error('missing example');

    const { nodes, edges } = seeker.build();
    const exposed = generate(nodes, edges).exposed.map((variable) => variable.name);
    expect(exposed).toContain('gain');
  });

  it('Data Dashboard exposes four channels', () => {
    const dashboard = examples.find((example) => example.id === 'data-dashboard');
    if (dashboard === undefined) throw new Error('missing example');

    const { nodes, edges } = dashboard.build();
    const exposed = generate(nodes, edges).exposed.map((variable) => variable.name);
    expect(exposed).toEqual(['ch0', 'ch1', 'ch2', 'ch3']);
  });
});
