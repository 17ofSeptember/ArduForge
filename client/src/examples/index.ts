/**
 * The 11 bundled examples (BUILD_PLAN.md §Phase 7).
 * Each opens with a wired graph, a parts list, and a wiring diagram; every one
 * is covered by a golden codegen test.
 */
import { GraphBuilder, wiringDiagram, type Example } from '@/examples/builder';

/** Widget helper, so example dashboards stay readable. */
function widget(
  id: string,
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  binding: unknown,
  config: Record<string, unknown>,
): unknown {
  return { id, type, pageId: 'page_1', x, y, w, h, binding, config };
}

const MAIN_PAGE = [{ id: 'page_1', name: 'Main' }];
const varBinding = (name: string) => ({ kind: 'var', name, direction: 'both' });

// ── 1. Blink ─────────────────────────────────────────────────────────────────

const blink: Example = {
  id: 'blink',
  name: 'Blink',
  description:
    'The hello world of Arduino, written the way you should write it: a non-blocking timer instead of delay(), so the board stays free to do other things.',
  parts: [{ name: 'Arduino Uno', detail: 'The on-board LED on pin 13 is all you need.' }],
  wiring: wiringDiagram([{ from: 'D13', to: 'On-board LED', kind: 'signal' }]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const mode = b.add('io.pinMode', { x: 260, y: 0 }, { literals: { pin: 13 } });
    b.exec(setup, 'then', mode);

    const loop = b.add('event.loop', { x: 0, y: 200 });
    const every = b.add('control.everyMs', { x: 260, y: 200 }, { literals: { ms: 500 } });
    const toggle = b.add('led.toggle', { x: 540, y: 200 }, { literals: { pin: 13 } });
    b.exec(loop, 'then', every);
    b.exec(every, 'then', toggle);
    return b.build();
  },
};

// ── 2. Button + LED ──────────────────────────────────────────────────────────

const buttonLed: Example = {
  id: 'button-led',
  name: 'Button + LED',
  description:
    'A button that toggles an LED. Uses edge detection so one press is one toggle, and internal debouncing so a noisy contact does not fire twice.',
  parts: [
    { name: 'Push button', detail: 'Between D2 and GND. No resistor needed — the pin uses its internal pull-up.' },
    { name: 'LED + 220Ω resistor', detail: 'From D13 to GND.' },
  ],
  wiring: wiringDiagram([
    { from: 'D2', to: 'Button leg 1', kind: 'signal' },
    { from: 'GND', to: 'Button leg 2', kind: 'ground' },
    { from: 'D13', to: 'LED anode (+)', kind: 'signal' },
    { from: 'GND', to: 'LED cathode via 220Ω', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const declare = b.add('var.declare', { x: 260, y: 0 }, {
      config: { scope: 'global', name: 'ledOn', type: 'bool', initial: 'false', expose: true },
    });
    const mode = b.add('io.pinMode', { x: 520, y: 0 }, { literals: { pin: 13 } });
    b.chain(setup, 'then', [declare, mode]);

    const loop = b.add('event.loop', { x: 0, y: 220 });
    const branch = b.add('control.if', { x: 300, y: 220 });
    const press = b.add('button.onPress', { x: 300, y: 420 }, { literals: { pin: 2 } });
    const toggle = b.add('var.set', { x: 560, y: 180 }, {
      config: { name: 'ledOn', type: 'bool' },
      literals: { value: true },
    });
    const not = b.add('logic.not', { x: 560, y: 380 });
    const get = b.add('var.get', { x: 300, y: 560 }, { config: { name: 'ledOn', type: 'bool' } });
    const write = b.add('io.digitalWrite', { x: 820, y: 220 }, { literals: { pin: 13 } });
    const getAgain = b.add('var.get', { x: 560, y: 560 }, { config: { name: 'ledOn', type: 'bool' } });

    b.exec(loop, 'then', branch);
    b.data(press, 'out', branch, 'condition');
    b.exec(branch, 'true', toggle);
    b.data(not, 'out', toggle, 'value');
    b.data(get, 'out', not, 'value');
    b.exec(toggle, 'then', write);
    b.data(getAgain, 'out', write, 'value');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'led', 0, 0, 2, 2, varBinding('ledOn'), { label: 'LED', color: '#F5A524' }),
      widget('w2', 'switch', 2, 0, 3, 2, varBinding('ledOn'), { label: 'Override' }),
    ],
  }),
};

// ── 3. Potentiometer Fade ────────────────────────────────────────────────────

const potFade: Example = {
  id: 'pot-fade',
  name: 'Potentiometer Fade',
  description:
    'A knob controls LED brightness. Reads the pot, rescales 0–1023 into 0–255, and writes it as PWM — with a live chart of the reading.',
  parts: [
    { name: 'Potentiometer (10kΩ)', detail: 'Outer legs to 5V and GND, wiper to A0.' },
    { name: 'LED + 220Ω resistor', detail: 'From D9 (a PWM pin) to GND.' },
  ],
  wiring: wiringDiagram([
    { from: '5V', to: 'Pot leg 1', kind: 'power' },
    { from: 'A0', to: 'Pot wiper', kind: 'signal' },
    { from: 'GND', to: 'Pot leg 3', kind: 'ground' },
    { from: 'D9', to: 'LED via 220Ω', kind: 'signal' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const declare = b.add('var.declare', { x: 260, y: 0 }, {
      config: { scope: 'global', name: 'brightness', type: 'int', initial: '0', expose: true },
    });
    const mode = b.add('io.pinMode', { x: 520, y: 0 }, { literals: { pin: 9 } });
    b.chain(setup, 'then', [declare, mode]);

    const loop = b.add('event.loop', { x: 0, y: 220 });
    const every = b.add('control.everyMs', { x: 260, y: 220 }, { literals: { ms: 50 } });
    const set = b.add('var.set', { x: 520, y: 220 }, { config: { name: 'brightness', type: 'int' } });
    const fade = b.add('led.fadeTo', { x: 800, y: 220 }, { literals: { pin: 9 } });
    const mapped = b.add('pot.readMapped', { x: 260, y: 440 }, {
      literals: { pin: 'A0', toLow: 0, toHigh: 255 },
    });
    const get = b.add('var.get', { x: 560, y: 440 }, { config: { name: 'brightness', type: 'int' } });

    b.chain(loop, 'then', [every]);
    b.exec(every, 'then', set);
    b.exec(set, 'then', fade);
    b.data(mapped, 'out', set, 'value');
    b.data(get, 'out', fade, 'level');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'gauge', 0, 0, 4, 4, varBinding('brightness'), { label: 'Brightness', min: 0, max: 255 }),
      widget('w2', 'chart', 4, 0, 8, 4, varBinding('brightness'), { label: 'Brightness', windowSeconds: 20 }),
    ],
  }),
};

// ── 4. Servo Control Panel ───────────────────────────────────────────────────

const servoPanel: Example = {
  id: 'servo-panel',
  name: 'Servo Control Panel',
  description:
    'Drive a servo from a dashboard slider, with a live angle readout. The angle is an exposed variable, so the slider writes it and the board reports it back.',
  parts: [
    { name: 'Servo (SG90 or similar)', detail: 'Signal to D9, red to 5V, brown/black to GND.' },
    { name: 'External 5V supply', detail: 'Recommended for anything larger than a micro servo.' },
  ],
  wiring: wiringDiagram([
    { from: 'D9', to: 'Servo signal (orange)', kind: 'signal' },
    { from: '5V', to: 'Servo power (red)', kind: 'power' },
    { from: 'GND', to: 'Servo ground (brown)', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const declare = b.add('var.declare', { x: 260, y: 0 }, {
      config: { scope: 'global', name: 'angle', type: 'int', initial: '90', expose: true },
    });
    const attach = b.add('servo.attach', { x: 520, y: 0 }, { literals: { pin: 9 } });
    b.chain(setup, 'then', [declare, attach]);

    const loop = b.add('event.loop', { x: 0, y: 220 });
    const every = b.add('control.everyMs', { x: 260, y: 220 }, { literals: { ms: 50 } });
    const write = b.add('servo.write', { x: 520, y: 220 });
    const get = b.add('var.get', { x: 260, y: 420 }, { config: { name: 'angle', type: 'int' } });

    b.exec(loop, 'then', every);
    b.exec(every, 'then', write);
    b.data(get, 'out', write, 'angle');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'slider', 0, 0, 8, 2, varBinding('angle'), {
        label: 'Angle', min: 0, max: 180, step: 1, liveSend: true, unit: '°',
      }),
      widget('w2', 'readout', 8, 0, 4, 2, varBinding('angle'), { label: 'Angle', unit: '°' }),
      widget('w3', 'chart', 0, 2, 12, 4, varBinding('angle'), { label: 'Angle', windowSeconds: 30 }),
    ],
  }),
};

// ── 5. Ultrasonic Parking Sensor ─────────────────────────────────────────────

const parkingSensor: Example = {
  id: 'parking-sensor',
  name: 'Ultrasonic Parking Sensor',
  description:
    'Measures distance with an HC-SR04 and beeps faster as you get closer. Distance is exposed, so the dashboard shows it on a gauge with red/amber/green zones.',
  parts: [
    { name: 'HC-SR04 ultrasonic sensor', detail: 'TRIG to D7, ECHO to D6, VCC to 5V, GND to GND.' },
    { name: 'Passive buzzer', detail: 'From D8 to GND.' },
  ],
  wiring: wiringDiagram([
    { from: 'D7', to: 'HC-SR04 TRIG', kind: 'signal' },
    { from: 'D6', to: 'HC-SR04 ECHO', kind: 'signal' },
    { from: '5V', to: 'HC-SR04 VCC', kind: 'power' },
    { from: 'GND', to: 'HC-SR04 GND', kind: 'ground' },
    { from: 'D8', to: 'Buzzer +', kind: 'data' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const declare = b.add('var.declare', { x: 260, y: 0 }, {
      config: { scope: 'global', name: 'distance', type: 'float', initial: '0', expose: true },
    });
    b.exec(setup, 'then', declare);

    const loop = b.add('event.loop', { x: 0, y: 220 });
    const every = b.add('control.everyMs', { x: 240, y: 220 }, { literals: { ms: 100 } });
    const set = b.add('var.set', { x: 480, y: 220 }, { config: { name: 'distance', type: 'float' } });
    const branch = b.add('control.if', { x: 720, y: 220 });
    const beep = b.add('buzzer.beep', { x: 980, y: 160 }, { literals: { pin: 8, frequency: 1200, ms: 60 } });
    const quiet = b.add('buzzer.stop', { x: 980, y: 380 }, { literals: { pin: 8 } });

    const read = b.add('ultrasonic.readDistance', { x: 240, y: 460 }, {
      literals: { trigger: 7, echo: 6 },
    });
    const get = b.add('var.get', { x: 480, y: 460 }, { config: { name: 'distance', type: 'float' } });
    const close = b.add('logic.compare', { x: 720, y: 460 }, {
      config: { op: '<' },
      literals: { b: 30 },
    });

    b.exec(loop, 'then', every);
    b.exec(every, 'then', set);
    b.exec(set, 'then', branch);
    b.data(read, 'out', set, 'value');
    b.data(get, 'out', close, 'a');
    b.data(close, 'out', branch, 'condition');
    b.exec(branch, 'true', beep);
    b.exec(branch, 'false', quiet);
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'gauge', 0, 0, 5, 4, varBinding('distance'), {
        label: 'Distance', min: 0, max: 200, decimals: 1, unit: 'cm',
        zones: [{ from: 0, color: '#E5484D' }, { from: 0.15, color: '#F5A524' }, { from: 0.35, color: '#30A46C' }],
      }),
      widget('w2', 'chart', 5, 0, 7, 4, varBinding('distance'), { label: 'Distance', windowSeconds: 30 }),
    ],
  }),
};

// ── 6. Traffic Light State Machine ───────────────────────────────────────────

const trafficLight: Example = {
  id: 'traffic-light',
  name: 'Traffic Light State Machine',
  description:
    'A three-state traffic light driven by the State Machine node, with a pedestrian button on an interrupt so a press is never missed.',
  parts: [
    { name: 'Red / amber / green LEDs', detail: 'On D11, D12, D13, each through a 220Ω resistor to GND.' },
    { name: 'Push button', detail: 'Between D2 and GND — D2 is one of the Uno interrupt pins.' },
  ],
  wiring: wiringDiagram([
    { from: 'D11', to: 'Red LED via 220Ω', kind: 'signal' },
    { from: 'D12', to: 'Amber LED via 220Ω', kind: 'signal' },
    { from: 'D13', to: 'Green LED via 220Ω', kind: 'signal' },
    { from: 'D2', to: 'Pedestrian button', kind: 'data' },
    { from: 'GND', to: 'Button + LED grounds', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const declare = b.add('var.declare', { x: 240, y: 0 }, {
      config: { scope: 'global', name: 'waiting', type: 'bool', initial: 'false', expose: true },
    });
    const m1 = b.add('io.pinMode', { x: 480, y: 0 }, { literals: { pin: 11 } });
    const m2 = b.add('io.pinMode', { x: 720, y: 0 }, { literals: { pin: 12 } });
    const m3 = b.add('io.pinMode', { x: 960, y: 0 }, { literals: { pin: 13 } });
    b.chain(setup, 'then', [declare, m1, m2, m3]);

    // Pedestrian request arrives on an interrupt so it is never missed.
    const isr = b.add('event.interrupt', { x: 0, y: 200 }, {
      config: { pin: '2', mode: 'FALLING' },
    });
    const request = b.add('var.set', { x: 260, y: 200 }, {
      config: { name: 'waiting', type: 'bool' },
      literals: { value: true },
    });
    b.exec(isr, 'then', request);

    const loop = b.add('event.loop', { x: 0, y: 400 });
    const every = b.add('control.everyMs', { x: 240, y: 400 }, { literals: { ms: 1000 } });
    const machine = b.add('control.stateMachine', { x: 480, y: 400 }, {
      config: { name: 'light', states: 'Red, Green, Amber' },
    });
    b.exec(loop, 'then', every);
    b.exec(every, 'then', machine);

    const branches: [string, number, string][] = [
      ['Red', 11, 'Green'],
      ['Green', 13, 'Amber'],
      ['Amber', 12, 'Red'],
    ];
    branches.forEach(([state, pin, next], index) => {
      const y = 620 + index * 220;
      const on = b.add('led.on', { x: 760, y }, { literals: { pin } });
      const offA = b.add('led.off', { x: 1000, y }, { literals: { pin: branches[(index + 1) % 3]?.[1] ?? 11 } });
      const offB = b.add('led.off', { x: 1240, y }, { literals: { pin: branches[(index + 2) % 3]?.[1] ?? 12 } });
      const go = b.add('control.goToState', { x: 1480, y }, {
        config: { name: 'light', state: next },
      });
      b.exec(machine, state, on);
      b.chain(on, 'then', [offA, offB, go]);
    });

    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'led', 0, 0, 2, 2, varBinding('waiting'), { label: 'Pedestrian', color: '#F5A524' }),
      widget('w2', 'button', 2, 0, 3, 2, varBinding('waiting'), { label: 'Request', onValue: 1, offValue: 0 }),
    ],
  }),
};

// ── 7. Temperature Logger ────────────────────────────────────────────────────

const temperatureLogger: Example = {
  id: 'temperature-logger',
  name: 'Temperature Logger',
  description:
    'Reads a DHT22 every two seconds, shows temperature and humidity on an LCD, and streams both to a dual-series chart you can export as CSV.',
  parts: [
    { name: 'DHT22 sensor', detail: 'Data to D4, with a 10kΩ pull-up to 5V.' },
    { name: 'LCD 16x2 (I2C backpack)', detail: 'SDA to A4, SCL to A5.' },
  ],
  wiring: wiringDiagram([
    { from: 'D4', to: 'DHT22 DATA', kind: 'data' },
    { from: '5V', to: 'DHT22 VCC + LCD VCC', kind: 'power' },
    { from: 'GND', to: 'DHT22 GND + LCD GND', kind: 'ground' },
    { from: 'A4', to: 'LCD SDA', kind: 'signal' },
    { from: 'A5', to: 'LCD SCL', kind: 'signal' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const dTemp = b.add('var.declare', { x: 240, y: 0 }, {
      config: { scope: 'global', name: 'tempC', type: 'float', initial: '0', expose: true },
    });
    const dHum = b.add('var.declare', { x: 480, y: 0 }, {
      config: { scope: 'global', name: 'humidity', type: 'float', initial: '0', expose: true },
    });
    const lcdInit = b.add('lcd.init', { x: 720, y: 0 });
    b.chain(setup, 'then', [dTemp, dHum, lcdInit]);

    const loop = b.add('event.loop', { x: 0, y: 240 });
    const every = b.add('control.everyMs', { x: 240, y: 240 }, { literals: { ms: 2000 } });
    const setT = b.add('var.set', { x: 480, y: 240 }, { config: { name: 'tempC', type: 'float' } });
    const setH = b.add('var.set', { x: 720, y: 240 }, { config: { name: 'humidity', type: 'float' } });
    const clear = b.add('lcd.clear', { x: 960, y: 240 });
    const print = b.add('lcd.printAt', { x: 1200, y: 240 }, { literals: { col: 0, row: 0, text: 'Temp C:' } });

    const readT = b.add('dht.readTemperature', { x: 240, y: 480 }, { literals: { pin: 4 } });
    const readH = b.add('dht.readHumidity', { x: 480, y: 480 }, { literals: { pin: 4 } });

    b.exec(loop, 'then', every);
    b.chain(every, 'then', [setT, setH, clear, print]);
    b.data(readT, 'out', setT, 'value');
    b.data(readH, 'out', setH, 'value');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'readout', 0, 0, 3, 2, varBinding('tempC'), { label: 'Temperature', decimals: 1, unit: '°C' }),
      widget('w2', 'readout', 3, 0, 3, 2, varBinding('humidity'), { label: 'Humidity', decimals: 1, unit: '%' }),
      widget('w3', 'chart', 0, 2, 12, 5, varBinding('tempC'), { label: 'Temperature', windowSeconds: 60 }),
    ],
  }),
};

// ── 8. NeoPixel Studio ───────────────────────────────────────────────────────

const neopixelStudio: Example = {
  id: 'neopixel-studio',
  name: 'NeoPixel Studio',
  description:
    'Drive an addressable LED strip from the dashboard: a colour picker sets red, green, and blue, and a slider controls overall brightness.',
  parts: [
    { name: 'NeoPixel strip (8 pixels)', detail: 'Data to D6, through a 330Ω resistor.' },
    { name: 'External 5V supply', detail: 'A strip draws far more than USB can give. Share grounds.' },
  ],
  wiring: wiringDiagram([
    { from: 'D6', to: 'Strip DIN via 330Ω', kind: 'data' },
    { from: '5V ext', to: 'Strip 5V', kind: 'power' },
    { from: 'GND', to: 'Strip GND (shared)', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const dr = b.add('var.declare', { x: 240, y: 0 }, { config: { scope: 'global', name: 'red', type: 'int', initial: '255', expose: true } });
    const dg = b.add('var.declare', { x: 480, y: 0 }, { config: { scope: 'global', name: 'green', type: 'int', initial: '0', expose: true } });
    const db = b.add('var.declare', { x: 720, y: 0 }, { config: { scope: 'global', name: 'blue', type: 'int', initial: '0', expose: true } });
    const dbr = b.add('var.declare', { x: 960, y: 0 }, { config: { scope: 'global', name: 'brightness', type: 'int', initial: '64', expose: true } });
    const init = b.add('neopixel.init', { x: 1200, y: 0 }, { config: { count: 8, pin: 6 } });
    b.chain(setup, 'then', [dr, dg, db, dbr, init]);

    const loop = b.add('event.loop', { x: 0, y: 260 });
    const every = b.add('control.everyMs', { x: 240, y: 260 }, { literals: { ms: 50 } });
    const bright = b.add('neopixel.brightness', { x: 480, y: 260 });
    const setAll = b.add('neopixel.setAll', { x: 720, y: 260 });
    const show = b.add('neopixel.show', { x: 960, y: 260 });

    const gr = b.add('var.get', { x: 240, y: 500 }, { config: { name: 'red', type: 'int' } });
    const gg = b.add('var.get', { x: 440, y: 500 }, { config: { name: 'green', type: 'int' } });
    const gb = b.add('var.get', { x: 640, y: 500 }, { config: { name: 'blue', type: 'int' } });
    const gbr = b.add('var.get', { x: 840, y: 500 }, { config: { name: 'brightness', type: 'int' } });

    b.exec(loop, 'then', every);
    b.chain(every, 'then', [bright, setAll, show]);
    b.data(gbr, 'out', bright, 'level');
    b.data(gr, 'out', setAll, 'r');
    b.data(gg, 'out', setAll, 'g');
    b.data(gb, 'out', setAll, 'b');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'color', 0, 0, 4, 3, { kind: 'none' }, {
        label: 'Colour',
        bindingsRgb: [varBinding('red'), varBinding('green'), varBinding('blue')],
      }),
      widget('w2', 'slider', 4, 0, 8, 2, varBinding('brightness'), { label: 'Brightness', min: 0, max: 255 }),
    ],
  }),
};

// ── 9. Motor Speed Controller ────────────────────────────────────────────────

const motorController: Example = {
  id: 'motor-controller',
  name: 'Motor Speed Controller',
  description:
    'Differential drive for two motors through an L298N, steered from an XY pad. Both motor speeds are exposed so you can watch them respond.',
  parts: [
    { name: 'L298N motor driver', detail: 'ENA to D5, IN1 to D6, IN2 to D7. ENB to D10, IN3 to D8, IN4 to D9.' },
    { name: 'Two DC motors', detail: 'To OUT1/OUT2 and OUT3/OUT4.' },
    { name: 'Motor supply', detail: '6–12V into the L298N, grounds shared with the Uno.' },
  ],
  wiring: wiringDiagram([
    { from: 'D5', to: 'L298N ENA (PWM)', kind: 'signal' },
    { from: 'D6', to: 'L298N IN1', kind: 'signal' },
    { from: 'D7', to: 'L298N IN2', kind: 'signal' },
    { from: 'D10', to: 'L298N ENB (PWM)', kind: 'signal' },
    { from: 'GND', to: 'L298N GND (shared)', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const dl = b.add('var.declare', { x: 240, y: 0 }, { config: { scope: 'global', name: 'leftSpeed', type: 'int', initial: '0', expose: true } });
    const dr = b.add('var.declare', { x: 520, y: 0 }, { config: { scope: 'global', name: 'rightSpeed', type: 'int', initial: '0', expose: true } });
    b.chain(setup, 'then', [dl, dr]);

    const loop = b.add('event.loop', { x: 0, y: 240 });
    const every = b.add('control.everyMs', { x: 240, y: 240 }, { literals: { ms: 50 } });
    const left = b.add('motor.setSpeed', { x: 520, y: 240 }, {
      literals: { enable: 5, in1: 6, in2: 7 },
    });
    const right = b.add('motor.setSpeed', { x: 820, y: 240 }, {
      literals: { enable: 10, in1: 8, in2: 9 },
    });
    const gl = b.add('var.get', { x: 240, y: 500 }, { config: { name: 'leftSpeed', type: 'int' } });
    const gr = b.add('var.get', { x: 520, y: 500 }, { config: { name: 'rightSpeed', type: 'int' } });

    b.exec(loop, 'then', every);
    b.chain(every, 'then', [left, right]);
    b.data(gl, 'out', left, 'speed');
    b.data(gr, 'out', right, 'speed');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'xypad', 0, 0, 5, 5, varBinding('leftSpeed'), {
        label: 'Drive', min: -255, max: 255, springToCentre: true, bindingY: varBinding('rightSpeed'),
      }),
      widget('w2', 'bar', 5, 0, 7, 2, varBinding('leftSpeed'), { label: 'Left', min: -255, max: 255 }),
      widget('w3', 'bar', 5, 2, 7, 2, varBinding('rightSpeed'), { label: 'Right', min: -255, max: 255 }),
    ],
  }),
};

// ── 10. Data Dashboard ───────────────────────────────────────────────────────

const dataDashboard: Example = {
  id: 'data-dashboard',
  name: 'Data Dashboard',
  description:
    'Four analog channels streaming at the telemetry ceiling. Built to show what 20Hz across four series actually looks like — and that it stays smooth.',
  parts: [
    { name: 'Four analog sources', detail: 'Potentiometers, LDRs, or anything else on A0–A3.' },
  ],
  wiring: wiringDiagram([
    { from: 'A0', to: 'Channel 1', kind: 'signal' },
    { from: 'A1', to: 'Channel 2', kind: 'signal' },
    { from: 'A2', to: 'Channel 3', kind: 'signal' },
    { from: 'A3', to: 'Channel 4', kind: 'signal' },
    { from: 'GND', to: 'Common ground', kind: 'ground' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const names = ['ch0', 'ch1', 'ch2', 'ch3'];
    const declares = names.map((name, index) =>
      b.add('var.declare', { x: 240 + index * 240, y: 0 }, {
        config: { scope: 'global', name, type: 'int', initial: '0', expose: true },
      }),
    );
    b.chain(setup, 'then', declares);

    const loop = b.add('event.loop', { x: 0, y: 260 });
    const every = b.add('control.everyMs', { x: 240, y: 260 }, { literals: { ms: 50 } });
    b.exec(loop, 'then', every);

    const sets = names.map((name, index) => {
      const set = b.add('var.set', { x: 480 + index * 260, y: 260 }, {
        config: { name, type: 'int' },
      });
      const read = b.add('pot.readRaw', { x: 480 + index * 260, y: 480 }, {
        literals: { pin: `A${index}` },
      });
      b.data(read, 'out', set, 'value');
      return set;
    });
    b.chain(every, 'then', sets);
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'chart', 0, 0, 12, 5, varBinding('ch0'), { label: 'Channel 1', windowSeconds: 15 }),
      widget('w2', 'statGrid', 0, 5, 6, 3, { kind: 'none' }, { label: 'Channels', names: ['ch0', 'ch1', 'ch2', 'ch3'] }),
      widget('w3', 'chart', 6, 5, 6, 3, varBinding('ch1'), { label: 'Channel 2', windowSeconds: 15 }),
    ],
  }),
};

// ── 11. Light-Seeking Servo ──────────────────────────────────────────────────

const lightSeeker: Example = {
  id: 'light-seeker',
  name: 'Light-Seeking Servo',
  description:
    'Two light sensors and a proportional control loop: the servo turns towards whichever side is brighter. The gain is an exposed variable, so you can tune the loop live from a slider while it runs — which is the whole point of this tool.',
  parts: [
    { name: 'Two LDRs', detail: 'Each in a divider with a 10kΩ resistor, to A0 and A1.' },
    { name: 'Servo', detail: 'Signal to D9.' },
  ],
  wiring: wiringDiagram([
    { from: 'A0', to: 'Left LDR divider', kind: 'signal' },
    { from: 'A1', to: 'Right LDR divider', kind: 'signal' },
    { from: '5V', to: 'LDR top legs', kind: 'power' },
    { from: 'GND', to: '10kΩ resistors', kind: 'ground' },
    { from: 'D9', to: 'Servo signal', kind: 'signal' },
  ]),
  build() {
    const b = new GraphBuilder();
    const setup = b.add('event.setup', { x: 0, y: 0 });
    const dGain = b.add('var.declare', { x: 240, y: 0 }, {
      config: { scope: 'global', name: 'gain', type: 'float', initial: '0.05', expose: true },
    });
    const dAngle = b.add('var.declare', { x: 520, y: 0 }, {
      config: { scope: 'global', name: 'angle', type: 'int', initial: '90', expose: true },
    });
    const dError = b.add('var.declare', { x: 800, y: 0 }, {
      config: { scope: 'global', name: 'error', type: 'int', initial: '0', expose: true },
    });
    const attach = b.add('servo.attach', { x: 1080, y: 0 }, { literals: { pin: 9 } });
    b.chain(setup, 'then', [dGain, dAngle, dError, attach]);

    const loop = b.add('event.loop', { x: 0, y: 260 });
    const every = b.add('control.everyMs', { x: 220, y: 260 }, { literals: { ms: 50 } });
    const setError = b.add('var.set', { x: 460, y: 260 }, { config: { name: 'error', type: 'int' } });
    const bump = b.add('var.increment', { x: 720, y: 260 }, { config: { name: 'angle' } });
    const write = b.add('servo.write', { x: 980, y: 260 });

    // error = left - right
    const left = b.add('pot.readRaw', { x: 220, y: 520 }, { literals: { pin: 'A0' } });
    const right = b.add('pot.readRaw', { x: 420, y: 520 }, { literals: { pin: 'A1' } });
    const difference = b.add('math.subtract', { x: 640, y: 520 });
    // correction = error * gain
    const getError = b.add('var.get', { x: 220, y: 720 }, { config: { name: 'error', type: 'int' } });
    const getGain = b.add('var.get', { x: 420, y: 720 }, { config: { name: 'gain', type: 'float' } });
    const correction = b.add('math.multiply', { x: 640, y: 720 });
    const getAngle = b.add('var.get', { x: 720, y: 900 }, { config: { name: 'angle', type: 'int' } });
    const clamp = b.add('math.constrain', { x: 940, y: 900 }, { literals: { low: 0, high: 180 } });

    b.exec(loop, 'then', every);
    b.chain(every, 'then', [setError, bump, write]);
    b.data(left, 'out', difference, 'a');
    b.data(right, 'out', difference, 'b');
    b.data(difference, 'out', setError, 'value');
    b.data(getError, 'out', correction, 'a');
    b.data(getGain, 'out', correction, 'b');
    b.data(correction, 'out', bump, 'by');
    b.data(getAngle, 'out', clamp, 'value');
    b.data(clamp, 'out', write, 'angle');
    return b.build();
  },
  dashboard: () => ({
    pages: MAIN_PAGE,
    widgets: [
      widget('w1', 'slider', 0, 0, 6, 2, varBinding('gain'), {
        label: 'Gain', min: 0, max: 1, step: 0.01, liveSend: true,
      }),
      widget('w2', 'readout', 6, 0, 3, 2, varBinding('angle'), { label: 'Angle', unit: '°' }),
      widget('w3', 'readout', 9, 0, 3, 2, varBinding('error'), { label: 'Error' }),
      widget('w4', 'chart', 0, 2, 12, 5, varBinding('error'), { label: 'Error', windowSeconds: 30 }),
    ],
  }),
};

export const examples: readonly Example[] = [
  blink,
  buttonLed,
  potFade,
  servoPanel,
  parkingSensor,
  trafficLight,
  temperatureLogger,
  neopixelStudio,
  motorController,
  dataDashboard,
  lightSeeker,
];

export function exampleById(id: string): Example | null {
  return examples.find((example) => example.id === id) ?? null;
}
