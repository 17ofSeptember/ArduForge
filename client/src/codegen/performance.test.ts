/**
 * Performance budgets (BUILD_PLAN.md §Phase 8).
 *
 * "Performance targets (measure, don't assume)". These are real measurements
 * against a real 200-node graph, not assertions of intent. The thresholds are
 * deliberately looser than the plan's targets so the suite does not go red on a
 * loaded CI box — the reported numbers below each budget are what matter, and a
 * regression large enough to matter will still trip them.
 */
import { describe, expect, it } from 'vitest';
import { generate } from '@/codegen/generate';
import { validateGraph } from '@/graph/validate';
import { GraphBuilder } from '@/examples/builder';
import { telemetry } from '@/dashboard/telemetry';

/** A realistic 200-node graph: a long exec chain with data subgraphs hanging off it. */
function bigGraph(statementCount: number) {
  const b = new GraphBuilder();
  const setup = b.add('event.setup', { x: 0, y: 0 });
  const declare = b.add('var.declare', { x: 200, y: 0 }, {
    config: { name: 'level', type: 'int', initial: '0' },
  });
  b.exec(setup, 'then', declare);

  const loop = b.add('event.loop', { x: 0, y: 200 });
  const steps: string[] = [];

  for (let index = 0; index < statementCount; index += 1) {
    const write = b.add('io.analogWrite', { x: 260 * (index + 1), y: 200 }, {
      literals: { pin: 9 },
    });
    // Each statement is fed by a small expression tree, so the data walker is
    // exercised too rather than only the exec chain.
    const read = b.add('pot.readRaw', { x: 260 * (index + 1), y: 420 }, { literals: { pin: 'A0' } });
    const mapped = b.add('math.map', { x: 260 * (index + 1), y: 560 });
    const clamp = b.add('math.constrain', { x: 260 * (index + 1), y: 700 }, {
      literals: { low: 0, high: 255 },
    });
    b.data(read, 'out', mapped, 'value');
    b.data(mapped, 'out', clamp, 'value');
    b.data(clamp, 'out', write, 'value');
    steps.push(write);
  }

  b.chain(loop, 'then', steps);
  return b.build();
}

describe('codegen performance', () => {
  it('generates a 200-node graph well inside the budget', () => {
    const { nodes, edges } = bigGraph(50); // 50 statements x 4 nodes = ~200
    expect(nodes.length).toBeGreaterThanOrEqual(200);

    // Warm once so the measurement is not dominated by first-call JIT.
    generate(nodes, edges);

    const started = performance.now();
    const runs = 5;
    for (let run = 0; run < runs; run += 1) generate(nodes, edges);
    const each = (performance.now() - started) / runs;

    console.log(`    codegen: ${nodes.length} nodes in ${each.toFixed(1)}ms (budget 50ms)`);
    // §Phase 8 target is 50ms; allow headroom for a busy machine.
    expect(each).toBeLessThan(250);
  });

  it('validates a 200-node graph quickly, since it runs on every edit', () => {
    const { nodes, edges } = bigGraph(50);
    validateGraph(nodes, edges);

    const started = performance.now();
    const runs = 10;
    for (let run = 0; run < runs; run += 1) validateGraph(nodes, edges);
    const each = (performance.now() - started) / runs;

    console.log(`    validate: ${nodes.length} nodes in ${each.toFixed(1)}ms`);
    expect(each).toBeLessThan(100);
  });

  it('stays deterministic at scale', () => {
    const { nodes, edges } = bigGraph(50);
    expect(generate(nodes, edges).code).toBe(generate(nodes, edges).code);
  });
});

describe('telemetry performance', () => {
  it('absorbs a 20Hz four-series stream cheaply', () => {
    telemetry.clear();

    // Two minutes of four series at 20Hz — the plan's stated ceiling.
    const frames = 20 * 120;
    const started = performance.now();
    for (let frame = 0; frame < frames; frame += 1) {
      telemetry.ingest({ ch0: frame, ch1: frame * 2, ch2: frame / 2, ch3: -frame }, frame * 50);
    }
    const elapsed = performance.now() - started;

    console.log(
      `    telemetry: ${frames} frames x 4 series in ${elapsed.toFixed(1)}ms ` +
        `(${((elapsed / frames) * 1000).toFixed(1)}µs per frame)`,
    );
    // Per frame this must be far below the 50ms budget between frames.
    expect(elapsed / frames).toBeLessThan(1);
  });

  it('reads a chart window fast enough to redraw every animation frame', () => {
    telemetry.clear();
    const now = performance.now();
    for (let frame = 0; frame < 2400; frame += 1) {
      telemetry.ingest({ ch0: frame, ch1: frame, ch2: frame, ch3: frame }, now - (2400 - frame) * 50);
    }

    const started = performance.now();
    const runs = 60;
    for (let run = 0; run < runs; run += 1) {
      for (const name of ['ch0', 'ch1', 'ch2', 'ch3']) telemetry.window(name, 20);
    }
    const each = (performance.now() - started) / runs;

    console.log(`    chart window: 4 series in ${each.toFixed(2)}ms (16.7ms frame budget)`);
    expect(each).toBeLessThan(16.7);
  });

  it('never grows without bound, however long it runs', () => {
    // §Phase 8: zero unbounded arrays.
    telemetry.clear();
    for (let frame = 0; frame < 20_000; frame += 1) {
      telemetry.ingest({ ch0: frame }, frame * 50);
    }
    const [times] = telemetry.window('ch0', Number.MAX_SAFE_INTEGER);
    console.log(`    ring buffer: capped at ${times.length} samples after 20000 frames`);
    expect(times.length).toBeLessThanOrEqual(2400);
  });
});
