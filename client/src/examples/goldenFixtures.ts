/**
 * Golden graph fixtures — codegen coverage for nodes no sketch can reach.
 *
 * The import corpus regenerates Tier A from the bundled examples, which catches
 * any codegen drift for the 70-odd nodes those examples use. It catches nothing
 * for the rest, and there is no way to fix that with more sketches: a `.ino`
 * cannot produce a `control.sequence`, and until component lifting exists it
 * cannot produce an `lcd.printAt` either.
 *
 * So these are hand-built graphs, regenerated and diffed exactly like Tier A. A
 * fixture whose output changes is a hard stop.
 *
 * The component fixtures matter most and are the reason this stopped being
 * deferred work. A component lift writes to a node's config fields by name; a
 * wrong name on an LCD lift is a wrong I2C address, and nothing else in the
 * repo would notice. Each component fixture therefore sets **every** config
 * field it has, so a rename or a default change shows up as a diff.
 */
import { GraphBuilder } from '@/examples/builder';
import type { AnyNode, ForgeEdge } from '@/graph/model';

export interface GoldenFixture {
  readonly name: string;
  /** What this fixture exists to guard, shown when it fails. */
  readonly guards: string;
  build(): { nodes: AnyNode[]; edges: ForgeEdge[] };
}

export const goldenFixtures: readonly GoldenFixture[] = [
  {
    name: 'Sequence',
    guards: 'control.sequence — branch fan-out with no source form',
    build() {
      const b = new GraphBuilder();
      const loop = b.add('event.loop', { x: 0, y: 0 });
      const seq = b.add('control.sequence', { x: 260, y: 0 }, { config: { steps: 3 } });
      b.exec(loop, 'then', seq);
      for (let step = 1; step <= 3; step += 1) {
        const write = b.add('io.digitalWrite', { x: 520, y: step * 120 }, { literals: { pin: step + 1, value: true } });
        b.exec(seq, String(step), write);
      }
      return b.build();
    },
  },
  {
    name: 'Stopwatch',
    guards: 'time.stopwatch, time.stopwatchRead, time.elapsedSince',
    build() {
      const b = new GraphBuilder();
      const setup = b.add('event.setup', { x: 0, y: 0 });
      const start = b.add('time.stopwatch', { x: 260, y: 0 }, { config: { action: 'start', name: 'run' } });
      b.exec(setup, 'then', start);

      const loop = b.add('event.loop', { x: 0, y: 240 });
      const read = b.add('time.stopwatchRead', { x: 260, y: 360 }, { config: { name: 'run' } });
      const print = b.add('serial.printValue', { x: 520, y: 240 }, { literals: { label: 'elapsed' } });
      b.exec(loop, 'then', print);
      b.data(read, 'out', print, 'value');

      const since = b.add('time.elapsedSince', { x: 260, y: 520 }, { literals: { since: 0 } });
      const print2 = b.add('serial.printValue', { x: 780, y: 240 }, { literals: { label: 'since' } });
      b.exec(print, 'then', print2);
      b.data(since, 'out', print2, 'value');
      return b.build();
    },
  },
  {
    name: 'Arrays',
    guards: 'var.arrayDeclare, arrayGet, arraySet, arrayLength, var.decrement',
    build() {
      const b = new GraphBuilder();
      const setup = b.add('event.setup', { x: 0, y: 0 });
      const declare = b.add('var.arrayDeclare', { x: 260, y: 0 }, {
        config: { name: 'samples', type: 'int', size: 5, initial: '0' },
      });
      const set = b.add('var.arraySet', { x: 520, y: 0 }, { config: { name: 'samples' }, literals: { index: 0, value: 7 } });
      // var.decrement assigns but does not declare, exactly like var.set, so the
      // counter it touches needs a declaration of its own.
      const counter = b.add('var.declare', { x: 780, y: 0 }, {
        config: { name: 'counter', type: 'int', initial: '10', scope: 'global' },
      });
      const serial = b.add('serial.begin', { x: 1040, y: 0 }, { config: { baud: '9600' } });
      b.chain(setup, 'then', [declare, set, counter, serial]);

      const loop = b.add('event.loop', { x: 0, y: 260 });
      const get = b.add('var.arrayGet', { x: 260, y: 380 }, { config: { name: 'samples', type: 'int' }, literals: { index: 1 } });
      const length = b.add('var.arrayLength', { x: 260, y: 520 }, { config: { name: 'samples' } });
      const print = b.add('serial.printValue', { x: 520, y: 260 }, { literals: { label: 'value' } });
      const printLen = b.add('serial.printValue', { x: 780, y: 260 }, { literals: { label: 'length' } });
      const dec = b.add('var.decrement', { x: 1040, y: 260 }, { config: { name: 'counter' }, literals: { by: 1 } });
      b.chain(loop, 'then', [print, printLen, dec]);
      b.data(get, 'out', print, 'value');
      b.data(length, 'out', printLen, 'value');
      return b.build();
    },
  },
  {
    name: 'Literals',
    guards: 'math.number, math.float, logic.boolean — literal nodes with no source form',
    build() {
      const b = new GraphBuilder();
      const loop = b.add('event.loop', { x: 0, y: 0 });
      const number = b.add('math.number', { x: 260, y: 160 }, { literals: { value: 42 } });
      const decimal = b.add('math.float', { x: 260, y: 300 }, { literals: { value: 1.5 } });
      const flag = b.add('logic.boolean', { x: 260, y: 440 }, { literals: { value: true } });

      const wait = b.add('control.delay', { x: 520, y: 0 });
      const branch = b.add('control.if', { x: 780, y: 0 });
      const write = b.add('io.analogWrite', { x: 1040, y: 0 }, { literals: { pin: 9 } });
      b.exec(loop, 'then', wait);
      b.exec(wait, 'then', branch);
      b.exec(branch, 'true', write);
      b.data(number, 'out', wait, 'ms');
      b.data(flag, 'out', branch, 'condition');
      b.data(decimal, 'out', write, 'value');
      return b.build();
    },
  },
  {
    name: 'UserFunction',
    guards: 'event.function — a defined function with its own chain',
    build() {
      const b = new GraphBuilder();
      const fn = b.add('event.function', { x: 0, y: 0 }, {
        config: { name: 'blinkOnce', returns: 'void', params: '' },
      });
      const on = b.add('io.digitalWrite', { x: 260, y: 0 }, { literals: { pin: 13, value: true } });
      const wait = b.add('control.delay', { x: 520, y: 0 }, { literals: { ms: 50 } });
      const off = b.add('io.digitalWrite', { x: 780, y: 0 }, { literals: { pin: 13, value: false } });
      b.chain(fn, 'body', [on, wait, off]);

      const loop = b.add('event.loop', { x: 0, y: 260 });
      const call = b.add('event.callFunction', { x: 260, y: 260 }, { config: { name: 'blinkOnce', args: '' } });
      b.exec(loop, 'then', call);
      return b.build();
    },
  },

  // ── one per component family, every config field set ──

  {
    name: 'ServoComponent',
    guards: 'servo.attach/write/writeMicroseconds/detach — every field',
    build() {
      const b = new GraphBuilder();
      const setup = b.add('event.setup', { x: 0, y: 0 });
      const attach = b.add('servo.attach', { x: 260, y: 0 }, { config: { name: 'arm' }, literals: { pin: 9 } });
      b.exec(setup, 'then', attach);

      const loop = b.add('event.loop', { x: 0, y: 240 });
      const write = b.add('servo.write', { x: 260, y: 240 }, { config: { name: 'arm' }, literals: { angle: 120 } });
      const micro = b.add('servo.writeMicroseconds', { x: 520, y: 240 }, { config: { name: 'arm' }, literals: { us: 1750 } });
      const detach = b.add('servo.detach', { x: 780, y: 240 }, { config: { name: 'arm' } });
      b.chain(loop, 'then', [write, micro, detach]);
      return b.build();
    },
  },
  {
    name: 'LcdComponent',
    guards: 'lcd.init/printAt/clear/backlight — every field',
    build() {
      const b = new GraphBuilder();
      const setup = b.add('event.setup', { x: 0, y: 0 });
      const init = b.add('lcd.init', { x: 260, y: 0 });
      b.exec(setup, 'then', init);

      const loop = b.add('event.loop', { x: 0, y: 240 });
      const clear = b.add('lcd.clear', { x: 260, y: 240 });
      const print = b.add('lcd.printAt', { x: 520, y: 240 }, { literals: { col: 3, row: 1, text: 'Ready' } });
      const back = b.add('lcd.backlight', { x: 780, y: 240 }, { config: { on: false } });
      b.chain(loop, 'then', [clear, print, back]);
      return b.build();
    },
  },
  {
    name: 'NeoPixelComponent',
    guards: 'neopixel.init/setPixel/setAll/brightness/show — every field',
    build() {
      const b = new GraphBuilder();
      const setup = b.add('event.setup', { x: 0, y: 0 });
      const init = b.add('neopixel.init', { x: 260, y: 0 }, { config: { count: 12, pin: 5 } });
      const bright = b.add('neopixel.brightness', { x: 520, y: 0 }, { literals: { level: 90 } });
      b.chain(setup, 'then', [init, bright]);

      const loop = b.add('event.loop', { x: 0, y: 240 });
      const one = b.add('neopixel.setPixel', { x: 260, y: 240 }, { literals: { index: 2, r: 10, g: 200, b: 30 } });
      const all = b.add('neopixel.setAll', { x: 520, y: 240 }, { literals: { r: 5, g: 5, b: 5 } });
      const show = b.add('neopixel.show', { x: 780, y: 240 });
      b.chain(loop, 'then', [one, all, show]);
      return b.build();
    },
  },
  {
    name: 'DhtComponent',
    guards: 'dht.readTemperature/readHumidity — both models',
    build() {
      const b = new GraphBuilder();
      const loop = b.add('event.loop', { x: 0, y: 0 });
      const temperature = b.add('dht.readTemperature', { x: 260, y: 160 }, {
        config: { model: 'DHT11' },
        literals: { pin: 4 },
      });
      const humidity = b.add('dht.readHumidity', { x: 260, y: 320 }, {
        config: { model: 'DHT22' },
        literals: { pin: 7 },
      });
      const printT = b.add('serial.printValue', { x: 520, y: 0 }, { literals: { label: 'C' } });
      const printH = b.add('serial.printValue', { x: 780, y: 0 }, { literals: { label: 'RH' } });
      b.chain(loop, 'then', [printT, printH]);
      b.data(temperature, 'out', printT, 'value');
      b.data(humidity, 'out', printH, 'value');
      return b.build();
    },
  },
];
