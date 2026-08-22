import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generate } from '@/codegen/generate';
import { exposedVariables, sketchHash } from '@/codegen/awrylink';
import { AWRYLINK_HEADER, AWRYLINK_SOURCE } from '@/codegen/awrylinkSource';
import { useGraphStore } from '@/store/graphStore';
import { resolveConnection } from '@/graph/connect';
import { sketchFilesFor } from '@/codegen/sketchFiles';
import { examples } from '@/examples';

const store = () => useGraphStore.getState();

function connect(source: string, sourceHandle: string, target: string, targetHandle: string): void {
  const result = resolveConnection({ source, sourceHandle, target, targetHandle }, store().nodes);
  if (!result.ok) throw new Error(result.reason);
  store().connect(result.edge);
}

function add(defId: string, x = 0, y = 0): string {
  const id = store().addNode(defId, { x, y });
  if (id === null) throw new Error(defId);
  return id;
}

function render(): string {
  const state = store();
  return generate(state.nodes, state.edges, { projectName: 'Live' }).code;
}

/** Declares an exposed variable inside setup. */
function expose(name: string, type = 'int'): string {
  const setup = store().nodes.find(
    (node) => node.type === 'forge' && node.data['defId'] === 'event.setup',
  );
  const setupId = setup?.id ?? add('event.setup');
  const declare = add('var.declare', 240);
  connect(setupId, 'exec-out:then', declare, 'exec-in');
  store().setConfig(declare, 'name', name);
  store().setConfig(declare, 'type', type);
  // Exposing requires a stable address, so the scope has to be global — a
  // local has none, and graph validation now says so explicitly.
  store().setConfig(declare, 'scope', 'global');
  store().setConfig(declare, 'expose', true);
  return declare;
}

beforeEach(() => {
  window.localStorage.clear();
  useGraphStore.setState({ nodes: [], edges: [], past: [], future: [], lastCommit: null });
  store().newProject();
});

describe('embedded firmware', () => {
  it('matches the canonical files in firmware/AwryLink', () => {
    // The firmware directory is the source of truth; the embedded copy exists
    // only so the client can post it with the sketch. Drift would be silent.
    // Resolved from cwd (the client workspace) because under jsdom
    // import.meta.url is an http URL, not a file one.
    const dir = resolve(process.cwd(), '../firmware/AwryLink');
    const header = readFileSync(`${dir}/AwryLink.h`, 'utf8');
    const source = readFileSync(`${dir}/AwryLink.cpp`, 'utf8');
    expect(AWRYLINK_HEADER).toBe(header);
    expect(AWRYLINK_SOURCE).toBe(source);
  });

  it('honours the constraints the plan sets for the hot path', () => {
    // No String, no dynamic allocation, no blocking.
    expect(AWRYLINK_SOURCE).not.toMatch(/\bString\b/);
    expect(AWRYLINK_SOURCE).not.toMatch(/\b(malloc|new |strdup)\b/);
    expect(AWRYLINK_SOURCE).not.toMatch(/\bdelay\s*\(/);
    // Frames are built with snprintf into a fixed buffer.
    expect(AWRYLINK_SOURCE).toContain('snprintf');
    expect(AWRYLINK_HEADER).toContain('AWRYLINK_MAX_LINE 128');
  });
});

describe('exposedVariables', () => {
  it('finds only variables marked Expose to Dashboard', () => {
    expose('shown');
    const hidden = add('var.declare', 480);
    store().setConfig(hidden, 'name', 'hidden');

    expect(exposedVariables(store().nodes).map((v) => v.name)).toEqual(['shown']);
  });

  it('sanitises names into valid identifiers', () => {
    expose('motor speed!');
    expect(exposedVariables(store().nodes)[0]?.name).toBe('motor_speed_');
  });

  it('sorts by name so the table is deterministic', () => {
    expose('zebra');
    expose('alpha');
    expect(exposedVariables(store().nodes).map((v) => v.name)).toEqual(['alpha', 'zebra']);
  });

  it('skips text variables, which cannot go in the fixed-size hot path', () => {
    expose('label', 'String');
    expect(exposedVariables(store().nodes)).toHaveLength(0);
  });

  it('changes the sketch hash when the exposed surface changes', () => {
    expose('a');
    const before = sketchHash(exposedVariables(store().nodes));
    expose('b');
    expect(sketchHash(exposedVariables(store().nodes))).not.toBe(before);
  });
});

describe('injection', () => {
  it('adds nothing when no variable is exposed', () => {
    const loop = add('event.loop');
    const wait = add('control.delay', 240);
    connect(loop, 'exec-out:then', wait, 'exec-in');

    const code = render();
    expect(code).not.toContain('AwryLink');
    expect(code).not.toContain('awrylink_poll');
  });

  it('injects the include, table, begin, and poll when something is exposed', () => {
    expose('potValue');
    const loop = add('event.loop', 0, 400);
    const wait = add('control.delay', 240, 400);
    connect(loop, 'exec-out:then', wait, 'exec-in');

    const code = render();
    expect(code).toContain('#include "AwryLink.h"');
    expect(code).toContain('{ "potValue", (void *)&potValue, AWRY_INT, true },');
    expect(code).toMatch(/awrylink_begin\(AWRY_VARS, 1, AWRY_HASH\);/);
    expect(code).toContain('awrylink_poll();');
  });

  it('declares the variable before the table that takes its address', () => {
    expose('potValue');
    const code = render();
    expect(code.indexOf('int potValue = 0;')).toBeLessThan(code.indexOf('AWRY_VARS[]'));
  });

  it('makes awrylink_poll the first statement of loop', () => {
    expose('a');
    const loop = add('event.loop', 0, 400);
    const wait = add('control.delay', 240, 400);
    connect(loop, 'exec-out:then', wait, 'exec-in');

    const code = render();
    const body = code.slice(code.indexOf('void loop() {'));
    const firstStatement = body.split('\n')[1]?.trim();
    expect(firstStatement).toBe('awrylink_poll();');
  });

  it('starts Serial itself when the graph does not', () => {
    expose('a');
    expect(render()).toContain('Serial.begin(115200);');
  });

  it('leaves the graph in charge of Serial when it starts it', () => {
    expose('a');
    const declare = store().nodes[store().nodes.length - 1];
    const begin = add('serial.begin', 480);
    connect(declare!.id, 'exec-out:then', begin, 'exec-in');

    const code = render();
    expect(code.match(/Serial\.begin/g)).toHaveLength(1);
  });

  it('reports the exposed variables on the result for dashboard bindings', () => {
    expose('potValue');
    expose('servoAngle');
    const state = store();
    const result = generate(state.nodes, state.edges);
    expect(result.exposed.map((v) => v.name)).toEqual(['potValue', 'servoAngle']);
  });

  it('stays deterministic with the link injected', () => {
    expose('a');
    expose('b');
    const first = render();
    const state = store();
    useGraphStore.setState({ nodes: [...state.nodes].reverse(), edges: [...state.edges].reverse() });
    expect(render()).toBe(first);
  });
});

describe('sketch file assembly', () => {
  it('sends only the sketch when nothing is exposed', () => {
    const loop = add('event.loop');
    const wait = add('control.delay', 240);
    connect(loop, 'exec-out:then', wait, 'exec-in');

    const state = store();
    const files = sketchFilesFor(generate(state.nodes, state.edges));
    expect(files.map((file) => file.name)).toEqual(['Sketch.ino']);
  });

  it('ships the firmware alongside a sketch that includes it', () => {
    // Regression: the Verify/Upload path sent only Sketch.ino, so every
    // example exposing a variable failed with "AwryLink.h: No such file".
    expose('potValue');
    const state = store();
    const result = generate(state.nodes, state.edges);
    const files = sketchFilesFor(result);

    expect(result.code).toContain('#include "AwryLink.h"');
    expect(files.map((file) => file.name).sort()).toEqual([
      'AwryLink.cpp',
      'AwryLink.h',
      'Sketch.ino',
    ]);
    for (const file of files) expect(file.content.length).toBeGreaterThan(0);
  });

  it('ships the firmware for every bundled example that needs it', () => {
    for (const example of examples) {
      const { nodes, edges } = example.build();
      const result = generate(nodes, edges, { projectName: example.name });
      const names = sketchFilesFor(result).map((file) => file.name);
      const needsFirmware = result.code.includes('#include "AwryLink.h"');
      expect(names.includes('AwryLink.h')).toBe(needsFirmware);
    }
  });
});
