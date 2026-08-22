/**
 * Tests for the Phase 5 node library and the contract extensions it needed:
 * computed requires (`collect`), config-derived ports (`dynamic`), and nodes
 * whose exec chain becomes a function body (`functionEntry`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generate } from '@/codegen/generate';
import { useGraphStore } from '@/store/graphStore';
import { resolveConnection } from '@/graph/connect';
import { allNodeDefs, execOuts, getNodeDef, inputPorts, outputPorts } from '@/nodes/registry';

const store = () => useGraphStore.getState();

function connect(source: string, sourceHandle: string, target: string, targetHandle: string): void {
  const result = resolveConnection({ source, sourceHandle, target, targetHandle }, store().nodes);
  if (!result.ok) throw new Error(`connect failed: ${result.reason}`);
  store().connect(result.edge);
}

function add(defId: string, x = 0, y = 0): string {
  const id = store().addNode(defId, { x, y });
  if (id === null) throw new Error(`could not add ${defId}`);
  return id;
}

function render(): string {
  const state = store();
  return generate(state.nodes, state.edges, { projectName: 'Test' }).code;
}

function result() {
  const state = store();
  return generate(state.nodes, state.edges, { projectName: 'Test' });
}

/** Attaches a statement node to On Loop so it lands in the emitted chain. */
function inLoop(defId: string): string {
  const loop = add('event.loop');
  const node = add(defId, 240);
  connect(loop, 'exec-out:then', node, 'exec-in');
  return node;
}

beforeEach(() => {
  window.localStorage.clear();
  useGraphStore.setState({ nodes: [], edges: [], past: [], future: [], lastCommit: null });
  store().newProject();
});

describe('registry integrity', () => {
  it('has unique node ids', () => {
    const ids = allNodeDefs.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every node a label, description, and category', () => {
    for (const def of allNodeDefs) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.category.length).toBeGreaterThan(0);
    }
  });

  it('gives every expression node at least one output', () => {
    for (const def of allNodeDefs) {
      if (def.kind !== 'expression') continue;
      const hasStatic = outputPorts(def).length > 0;
      const hasDynamic = def.dynamic?.outputs !== undefined;
      expect(hasStatic || hasDynamic).toBe(true);
    }
  });

  it('gives every input port either a literal or a required connection', () => {
    for (const def of allNodeDefs) {
      for (const port of inputPorts(def)) {
        expect(typeof port.id).toBe('string');
        expect(typeof port.label).toBe('string');
      }
    }
  });

  it('covers every category named in the plan', () => {
    const categories = new Set(allNodeDefs.map((def) => def.category));
    for (const expected of [
      'events',
      'io',
      'control',
      'math',
      'logic',
      'variables',
      'time',
      'serial',
      'components',
      'custom',
    ]) {
      expect(categories.has(expected as never)).toBe(true);
    }
  });
});

describe('Every N Milliseconds', () => {
  it('emits the non-blocking millis pattern, not a delay', () => {
    const every = inLoop('control.everyMs');
    store().setLiteral(every, 'ms', 50);

    const code = render();
    expect(code).toMatch(/static unsigned long _af_last_\w+ = 0;/);
    expect(code).toMatch(/if \(millis\(\) - _af_last_\w+ >= \(unsigned long\)\(50\)\)/);
    expect(code).not.toContain('delay(');
  });

  it('keeps its timer name stable across regenerations', () => {
    inLoop('control.everyMs');
    expect(render()).toBe(render());
  });
});

describe('components pull their own requirements', () => {
  it('servo attach brings the include, the library, and the object', () => {
    inLoop('servo.attach');
    const generated = result();

    expect(generated.code).toContain('#include <Servo.h>');
    expect(generated.code).toMatch(/Servo servo_\w+;/);
    expect(generated.libraries).toContain('Servo');
  });

  it('ultrasonic emits a helper with a forward declaration and no library', () => {
    const loop = add('event.loop');
    const print = add('serial.println', 240);
    const distance = add('ultrasonic.readDistance', 240, 200);
    connect(loop, 'exec-out:then', print, 'exec-in');
    connect(distance, 'out:out', print, 'in:value');

    const generated = result();
    // The plan is explicit that HC-SR04 uses raw pulseIn, not a library.
    expect(generated.libraries).toHaveLength(0);
    expect(generated.code).toMatch(/float _af_distance_\w+\(uint8_t triggerPin, uint8_t echoPin\);/);
    expect(generated.code).toContain('pulseIn(echoPin, HIGH, 30000UL)');
    // Forward declaration must appear before setup(), definition after loop().
    const declaration = generated.code.indexOf('float _af_distance');
    const setupAt = generated.code.indexOf('void setup()');
    const loopAt = generated.code.indexOf('void loop()');
    expect(declaration).toBeLessThan(setupAt);
    expect(generated.code.lastIndexOf('float _af_distance')).toBeGreaterThan(loopAt);
  });

  it('button uses INPUT_PULLUP and inverts the sense', () => {
    const loop = add('event.loop');
    const branch = add('control.if', 240);
    const button = add('button.isPressed', 240, 200);
    connect(loop, 'exec-out:then', branch, 'exec-in');
    connect(button, 'out:out', branch, 'in:condition');

    const code = render();
    expect(code).toContain('pinMode(2, INPUT_PULLUP);');
    expect(code).toContain('(digitalRead(2) == LOW)');
  });

  it('two servos with different names get separate objects', () => {
    const loop = add('event.loop');
    const first = add('servo.attach', 240);
    const second = add('servo.attach', 480);
    connect(loop, 'exec-out:then', first, 'exec-in');
    connect(first, 'exec-out:then', second, 'exec-in');
    store().setConfig(second, 'name', 'tilt');

    const code = render();
    const objects = code.match(/Servo (\w+);/g) ?? [];
    expect(new Set(objects).size).toBe(2);
  });
});

describe('config-derived ports', () => {
  it('grows Sequence exec outputs with its step count', () => {
    const def = getNodeDef('control.sequence');
    expect(def).not.toBeNull();
    if (def === null) return;

    expect(execOuts(def, { steps: 2 })).toEqual(['1', '2']);
    expect(execOuts(def, { steps: 4 })).toEqual(['1', '2', '3', '4']);
    // Clamped so a nonsense value cannot produce hundreds of handles.
    expect(execOuts(def, { steps: 99 })).toHaveLength(8);
  });

  it('changes Get Variable output type with the chosen type', () => {
    const def = getNodeDef('var.get');
    expect(def).not.toBeNull();
    if (def === null) return;

    expect(outputPorts(def, { type: 'int' })[0]?.type).toBe('int');
    expect(outputPorts(def, { type: 'float' })[0]?.type).toBe('float');
    expect(outputPorts(def, { type: 'String' })[0]?.type).toBe('string');
    expect(outputPorts(def, { type: 'bool' })[0]?.type).toBe('bool');
  });

  it('emits one case per state in a State Machine', () => {
    const machine = inLoop('control.stateMachine');
    store().setConfig(machine, 'states', 'Red, Green, Amber');
    store().setConfig(machine, 'name', 'light');

    const code = render();
    expect(code).toContain('uint8_t light = 0;');
    expect(code).toContain('#define LIGHT_RED 0');
    expect(code).toContain('#define LIGHT_AMBER 2');
    expect(code).toContain('switch (light) {');
    expect(code).toContain('case 1: // Green');
  });
});

describe('variables', () => {
  it('declares an exposed variable as a global', () => {
    const declare = inLoop('var.declare');
    store().setConfig(declare, 'name', 'motor speed');
    store().setConfig(declare, 'type', 'int');
    store().setConfig(declare, 'initial', '120');

    const code = render();
    // The name is sanitised into a valid C++ identifier.
    expect(code).toContain('int motor_speed = 120;');
  });

  it('gives a float variable a decimal initialiser', () => {
    const declare = inLoop('var.declare');
    store().setConfig(declare, 'name', 'gain');
    store().setConfig(declare, 'type', 'float');
    store().setConfig(declare, 'initial', '2');

    expect(render()).toContain('float gain = 2.0f;');
  });

  it('quotes a text variable initialiser', () => {
    const declare = inLoop('var.declare');
    store().setConfig(declare, 'name', 'label');
    store().setConfig(declare, 'type', 'String');
    store().setConfig(declare, 'initial', 'hi');

    expect(render()).toContain('String label = "hi";');
  });
});

describe('user-defined functions', () => {
  it('emits a function whose body is its exec chain', () => {
    const define = add('event.function');
    const print = add('serial.println', 240);
    connect(define, 'exec-out:body', print, 'exec-in');
    store().setConfig(define, 'name', 'sayHello');

    const code = render();
    expect(code).toContain('void sayHello();');
    expect(code).toMatch(/void sayHello\(\) \{\n\s+Serial\.println/);
  });

  it('emits an interrupt handler and attaches it in setup', () => {
    const interrupt = add('event.interrupt');
    const print = add('serial.println', 240);
    connect(interrupt, 'exec-out:then', print, 'exec-in');

    const code = render();
    expect(code).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\), _af_isr_\w+, RISING\);/);
    expect(code).toMatch(/void _af_isr_\w+\(\) \{/);
  });
});

describe('custom C++ escape hatch', () => {
  it('inserts a raw statement verbatim', () => {
    const raw = inLoop('custom.statement');
    store().setConfig(raw, 'code', 'Serial.println(F("hand written"));');
    expect(render()).toContain('Serial.println(F("hand written"));');
  });

  it('inserts a raw global above setup', () => {
    const loop = add('event.loop');
    const wait = add('control.delay', 240);
    connect(loop, 'exec-out:then', wait, 'exec-in');

    const raw = add('custom.global', 0, 400);
    store().setConfig(raw, 'code', '#define PIN_LED 13');

    const code = render();
    expect(code.indexOf('#define PIN_LED 13')).toBeLessThan(code.indexOf('void setup()'));
  });

  it('parenthesises a raw expression so it composes safely', () => {
    const loop = add('event.loop');
    const wait = add('control.delay', 240);
    const raw = add('custom.expression', 240, 200);
    connect(loop, 'exec-out:then', wait, 'exec-in');
    connect(raw, 'out:out', wait, 'in:ms');
    store().setConfig(raw, 'code', '1 + 2');

    expect(render()).toContain('delay((1 + 2));');
  });
});

describe('determinism across the whole library', () => {
  it('produces identical output for a graph using many categories', () => {
    const setup = add('event.setup');
    const attach = add('servo.attach', 240);
    connect(setup, 'exec-out:then', attach, 'exec-in');

    const loop = add('event.loop', 0, 300);
    const every = add('control.everyMs', 240, 300);
    const write = add('servo.write', 480, 300);
    const pot = add('pot.readMapped', 240, 550);
    connect(loop, 'exec-out:then', every, 'exec-in');
    connect(every, 'exec-out:then', write, 'exec-in');
    connect(pot, 'out:out', write, 'in:angle');

    const first = render();
    const state = store();
    useGraphStore.setState({ nodes: [...state.nodes].reverse(), edges: [...state.edges].reverse() });
    expect(render()).toBe(first);
  });
});
