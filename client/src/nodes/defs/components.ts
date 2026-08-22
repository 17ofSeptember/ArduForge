/**
 * Composite component nodes (BUILD_PLAN.md §Phase 5j).
 *
 * Each pulls its own #include, library, and setup() lines through `collect`,
 * so dropping one on the canvas is all the user has to do. Generated object
 * names are derived from the node's stable slug, which keeps two servos from
 * colliding and keeps output byte-identical across regenerations.
 */
import {
  ArrowLeftRight,
  Circle,
  Clock,
  Cpu,
  Fan,
  Gauge,
  Lightbulb,
  MonitorSmartphone,
  Move3d,
  Music,
  Radio,
  Rss,
  SaveAll,
  Share2,
  Sparkles,
  ToggleLeft,
  Volume2,
  Waves,
} from 'lucide-react';
import { stableSuffix } from '@/codegen/names';
import type { NodeDef, PortDef } from '@/nodes/types';

const pin = (id: string, label: string, def: number): PortDef => ({
  id,
  label,
  type: 'pin',
  literal: { kind: 'number', default: def, min: 0, max: 19, integer: true },
});

const int = (id: string, label: string, def: number, min?: number, max?: number): PortDef => ({
  id,
  label,
  type: 'int',
  literal: { kind: 'number', default: def, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), integer: true },
});

// ── LED ──────────────────────────────────────────────────────────────────────

const ledNodes: NodeDef[] = [
  {
    id: 'led.on',
    category: 'components',
    label: 'LED On',
    description: 'Turns an LED fully on.',
    icon: Lightbulb,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 13)],
    summary: (v) => `LED ${v['pin'] ?? '?'} on`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, OUTPUT);`] };
    },
    emit: (ctx) => ({ statements: `digitalWrite(${ctx.input('pin')}, HIGH);` }),
  },
  {
    id: 'led.off',
    category: 'components',
    label: 'LED Off',
    description: 'Turns an LED off.',
    icon: Lightbulb,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 13)],
    summary: (v) => `LED ${v['pin'] ?? '?'} off`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, OUTPUT);`] };
    },
    emit: (ctx) => ({ statements: `digitalWrite(${ctx.input('pin')}, LOW);` }),
  },
  {
    id: 'led.toggle',
    category: 'components',
    label: 'LED Toggle',
    description: 'Flips an LED between on and off.',
    icon: Lightbulb,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 13)],
    summary: (v) => `LED ${v['pin'] ?? '?'} toggle`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, OUTPUT);`] };
    },
    emit: (ctx) => ({
      statements: `digitalWrite(${ctx.input('pin')}, !digitalRead(${ctx.input('pin')}));`,
    }),
  },
  {
    id: 'led.fadeTo',
    category: 'components',
    label: 'LED Fade To',
    description: 'Sets an LED brightness from 0 to 255. Needs a PWM pin.',
    icon: Lightbulb,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 9), int('level', 'Brightness', 128, 0, 255)],
    summary: (v) => `LED ${v['pin'] ?? '?'} -> ${v['level'] ?? 0}`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, OUTPUT);`] };
    },
    emit: (ctx) => ({ statements: `analogWrite(${ctx.input('pin')}, ${ctx.input('level')});` }),
  },
];

// ── Push button ──────────────────────────────────────────────────────────────

const buttonNodes: NodeDef[] = [
  {
    id: 'button.isPressed',
    category: 'components',
    label: 'Button Is Pressed',
    description: 'True while a button is held down. Wired with the internal pull-up.',
    icon: Circle,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 2)],
    outputs: [{ id: 'out', label: 'Pressed', type: 'bool' }],
    summary: (v) => `button ${v['pin'] ?? '?'}`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, INPUT_PULLUP);`] };
    },
    // INPUT_PULLUP reads LOW when pressed, so the sense is inverted here rather
    // than leaving the user to discover it.
    emit: (ctx) => ({ expression: `(digitalRead(${ctx.input('pin')}) == LOW)` }),
  },
  {
    id: 'button.onPress',
    category: 'components',
    label: 'Button On Press',
    description: 'True for a single pass when a button goes down. Debounced internally.',
    icon: Circle,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 2), int('debounce', 'Debounce ms', 25, 1)],
    outputs: [{ id: 'out', label: 'Just pressed', type: 'bool' }],
    summary: (v) => `press ${v['pin'] ?? '?'}`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return {
        ...(p === null ? {} : { setup: [`pinMode(${String(p)}, INPUT_PULLUP);`] }),
        functions: [
          {
            signature: `bool _af_press_${ctx.slug}(uint8_t buttonPin, unsigned long settleMs)`,
            body: [
              'static bool wasDown = false;',
              'static unsigned long changedAt = 0;',
              '',
              'bool isDown = (digitalRead(buttonPin) == LOW);',
              'if (isDown != wasDown && millis() - changedAt >= settleMs) {',
              '  changedAt = millis();',
              '  wasDown = isDown;',
              '  return isDown;',
              '}',
              'return false;',
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({
      expression: `_af_press_${stableSuffix(ctx.nodeId)}(${ctx.input('pin')}, ${ctx.input('debounce')})`,
    }),
  },
  {
    id: 'button.onRelease',
    category: 'components',
    label: 'Button On Release',
    description: 'True for a single pass when a button comes back up.',
    icon: Circle,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 2), int('debounce', 'Debounce ms', 25, 1)],
    outputs: [{ id: 'out', label: 'Just released', type: 'bool' }],
    summary: (v) => `release ${v['pin'] ?? '?'}`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return {
        ...(p === null ? {} : { setup: [`pinMode(${String(p)}, INPUT_PULLUP);`] }),
        functions: [
          {
            signature: `bool _af_release_${ctx.slug}(uint8_t buttonPin, unsigned long settleMs)`,
            body: [
              'static bool wasDown = false;',
              'static unsigned long changedAt = 0;',
              '',
              'bool isDown = (digitalRead(buttonPin) == LOW);',
              'if (isDown != wasDown && millis() - changedAt >= settleMs) {',
              '  changedAt = millis();',
              '  wasDown = isDown;',
              '  return !isDown;',
              '}',
              'return false;',
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({
      expression: `_af_release_${stableSuffix(ctx.nodeId)}(${ctx.input('pin')}, ${ctx.input('debounce')})`,
    }),
  },
  {
    id: 'button.isHeld',
    category: 'components',
    label: 'Button Is Held',
    description: 'True once a button has been held down for long enough.',
    icon: Circle,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 2), int('ms', 'Hold ms', 800, 1)],
    outputs: [{ id: 'out', label: 'Held', type: 'bool' }],
    summary: (v) => `hold ${v['ms'] ?? 0} ms`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return {
        ...(p === null ? {} : { setup: [`pinMode(${String(p)}, INPUT_PULLUP);`] }),
        functions: [
          {
            signature: `bool _af_held_${ctx.slug}(uint8_t buttonPin, unsigned long holdMs)`,
            body: [
              'static unsigned long downAt = 0;',
              '',
              'if (digitalRead(buttonPin) == LOW) {',
              '  if (downAt == 0) downAt = millis();',
              '  return millis() - downAt >= holdMs;',
              '}',
              'downAt = 0;',
              'return false;',
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({
      expression: `_af_held_${stableSuffix(ctx.nodeId)}(${ctx.input('pin')}, ${ctx.input('ms')})`,
    }),
  },
];

// ── Potentiometer ────────────────────────────────────────────────────────────

const ANALOG_PINS = {
  kind: 'select' as const,
  default: 'A0',
  options: [
    { value: 'A0', label: 'A0' },
    { value: 'A1', label: 'A1' },
    { value: 'A2', label: 'A2' },
    { value: 'A3', label: 'A3' },
    { value: 'A4', label: 'A4' },
    { value: 'A5', label: 'A5' },
  ],
};

const potNodes: NodeDef[] = [
  {
    id: 'pot.readRaw',
    category: 'components',
    label: 'Potentiometer Raw',
    description: 'Reads a potentiometer as a number from 0 to 1023.',
    icon: Gauge,
    kind: 'expression',
    inputs: [{ id: 'pin', label: 'Pin', type: 'pin', literal: ANALOG_PINS }],
    outputs: [{ id: 'out', label: 'Value', type: 'int' }],
    summary: (v) => `pot ${v['pin'] ?? 'A0'}`,
    emit: (ctx) => ({ expression: `analogRead(${ctx.input('pin')})` }),
  },
  {
    id: 'pot.readMapped',
    category: 'components',
    label: 'Potentiometer Mapped',
    description: 'Reads a potentiometer and rescales it to a range you choose.',
    icon: Gauge,
    kind: 'expression',
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: ANALOG_PINS },
      int('toLow', 'To low', 0),
      int('toHigh', 'To high', 180),
    ],
    outputs: [{ id: 'out', label: 'Value', type: 'int' }],
    summary: (v) => `pot -> ${v['toLow'] ?? 0}..${v['toHigh'] ?? 0}`,
    emit: (ctx) => ({
      expression: `map(analogRead(${ctx.input('pin')}), 0, 1023, ${ctx.input('toLow')}, ${ctx.input('toHigh')})`,
    }),
  },
  {
    id: 'pot.readSmoothed',
    category: 'components',
    label: 'Potentiometer Smoothed',
    description: 'Reads a potentiometer through a smoothing filter, so the value stops jittering.',
    icon: Waves,
    kind: 'expression',
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: ANALOG_PINS },
      { id: 'smoothing', label: 'Smoothing', type: 'float', literal: { kind: 'number', default: 0.2, min: 0.01, max: 1, step: 0.01 } },
    ],
    outputs: [{ id: 'out', label: 'Value', type: 'int' }],
    summary: () => 'smoothed pot',
    collect: (ctx) => ({
      functions: [
        {
          signature: `int _af_ema_${ctx.slug}(uint8_t analogPin, float alpha)`,
          body: [
            '// Exponential moving average: cheap, and needs no history buffer.',
            'static float smoothed = -1.0f;',
            '',
            'int raw = analogRead(analogPin);',
            'if (smoothed < 0.0f) smoothed = raw;',
            'smoothed = (alpha * raw) + ((1.0f - alpha) * smoothed);',
            'return (int)(smoothed + 0.5f);',
          ].join('\n'),
        },
      ],
    }),
    emit: (ctx) => ({
      expression: `_af_ema_${stableSuffix(ctx.nodeId)}(${ctx.input('pin')}, ${ctx.input('smoothing')})`,
    }),
  },
];

// ── Servo ────────────────────────────────────────────────────────────────────

function servoObject(slug: string): string {
  return `servo_${slug}`;
}

const servoNodes: NodeDef[] = [
  {
    id: 'servo.attach',
    category: 'components',
    label: 'Servo Attach',
    description: 'Connects a servo to a pin. Put this in setup.',
    icon: Move3d,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 9)],
    config: [{ kind: 'text', id: 'name', label: 'Servo name', default: 'servo', placeholder: 'servo' }],
    requires: { includes: ['Servo.h'], libraries: ['Servo'] },
    summary: (v) => `attach ${String(v['name'] ?? 'servo')} to ${v['pin'] ?? '?'}`,
    collect: (ctx) => ({
      globals: [`Servo ${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))};`],
    }),
    emit: (ctx) => ({
      statements: `${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))}.attach(${ctx.input('pin')});`,
    }),
  },
  {
    id: 'servo.write',
    category: 'components',
    label: 'Servo Write Angle',
    description: 'Moves a servo to an angle between 0 and 180 degrees.',
    icon: Move3d,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('angle', 'Angle', 90, 0, 180)],
    config: [{ kind: 'text', id: 'name', label: 'Servo name', default: 'servo', placeholder: 'servo' }],
    requires: { includes: ['Servo.h'], libraries: ['Servo'] },
    summary: (v) => `${String(v['name'] ?? 'servo')} -> ${v['angle'] ?? 0}°`,
    emit: (ctx) => ({
      statements: `${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))}.write(${ctx.input('angle')});`,
    }),
  },
  {
    id: 'servo.writeMicroseconds',
    category: 'components',
    label: 'Servo Write Microseconds',
    description: 'Drives a servo with a raw pulse width, for finer control than degrees.',
    icon: Move3d,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('us', 'Pulse µs', 1500, 500, 2500)],
    config: [{ kind: 'text', id: 'name', label: 'Servo name', default: 'servo', placeholder: 'servo' }],
    requires: { includes: ['Servo.h'], libraries: ['Servo'] },
    summary: (v) => `${v['us'] ?? 1500} µs`,
    emit: (ctx) => ({
      statements: `${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))}.writeMicroseconds(${ctx.input('us')});`,
    }),
  },
  {
    id: 'servo.read',
    category: 'components',
    label: 'Servo Read',
    description: 'The angle a servo was last told to go to.',
    icon: Move3d,
    kind: 'expression',
    config: [{ kind: 'text', id: 'name', label: 'Servo name', default: 'servo', placeholder: 'servo' }],
    outputs: [{ id: 'out', label: 'Angle', type: 'int' }],
    requires: { includes: ['Servo.h'], libraries: ['Servo'] },
    summary: (v) => `read ${String(v['name'] ?? 'servo')}`,
    emit: (ctx) => ({
      expression: `${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))}.read()`,
    }),
  },
  {
    id: 'servo.detach',
    category: 'components',
    label: 'Servo Detach',
    description: 'Releases a servo so it stops holding its position.',
    icon: Move3d,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [{ kind: 'text', id: 'name', label: 'Servo name', default: 'servo', placeholder: 'servo' }],
    requires: { includes: ['Servo.h'], libraries: ['Servo'] },
    summary: (v) => `detach ${String(v['name'] ?? 'servo')}`,
    emit: (ctx) => ({
      statements: `${servoObject(stableSuffix(String(ctx.config('name') || 'servo')))}.detach();`,
    }),
  },
];

// ── Ultrasonic HC-SR04 ───────────────────────────────────────────────────────

const ultrasonicNodes: NodeDef[] = [
  {
    id: 'ultrasonic.readDistance',
    category: 'components',
    label: 'Ultrasonic Distance',
    description: 'Measures distance with an HC-SR04. No library needed.',
    icon: Radio,
    kind: 'expression',
    inputs: [pin('trigger', 'Trigger pin', 7), pin('echo', 'Echo pin', 6)],
    config: [
      {
        kind: 'select',
        id: 'unit',
        label: 'Units',
        default: 'cm',
        options: [
          { value: 'cm', label: 'centimetres' },
          { value: 'in', label: 'inches' },
        ],
      },
    ],
    outputs: [{ id: 'out', label: 'Distance', type: 'float' }],
    summary: (v) => `distance (${String(v['unit'] ?? 'cm')})`,
    collect: (ctx) => {
      const trigger = ctx.literal('trigger');
      const echo = ctx.literal('echo');
      const setup: string[] = [];
      if (trigger !== null) setup.push(`pinMode(${String(trigger)}, OUTPUT);`);
      if (echo !== null) setup.push(`pinMode(${String(echo)}, INPUT);`);

      const divisor = String(ctx.config('unit')) === 'in' ? '148.0f' : '58.0f';
      return {
        setup,
        functions: [
          {
            signature: `float _af_distance_${ctx.slug}(uint8_t triggerPin, uint8_t echoPin)`,
            body: [
              '// Standard HC-SR04 sequence: 10µs trigger, then time the echo.',
              'digitalWrite(triggerPin, LOW);',
              'delayMicroseconds(2);',
              'digitalWrite(triggerPin, HIGH);',
              'delayMicroseconds(10);',
              'digitalWrite(triggerPin, LOW);',
              '',
              '// 30ms timeout keeps a missing echo from stalling the whole loop.',
              'unsigned long echoUs = pulseIn(echoPin, HIGH, 30000UL);',
              'if (echoUs == 0) return -1.0f; // nothing came back',
              `return echoUs / ${divisor};`,
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({
      expression: `_af_distance_${stableSuffix(ctx.nodeId)}(${ctx.input('trigger')}, ${ctx.input('echo')})`,
    }),
  },
];

// ── DHT temperature / humidity ───────────────────────────────────────────────

const dhtNodes: NodeDef[] = [
  {
    id: 'dht.readTemperature',
    category: 'components',
    label: 'DHT Temperature',
    description: 'Reads temperature in Celsius from a DHT11 or DHT22.',
    icon: Gauge,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 4)],
    config: [
      {
        kind: 'select',
        id: 'model',
        label: 'Sensor',
        default: 'DHT22',
        options: [
          { value: 'DHT11', label: 'DHT11' },
          { value: 'DHT22', label: 'DHT22' },
        ],
      },
    ],
    outputs: [{ id: 'out', label: '°C', type: 'float' }],
    requires: { includes: ['DHT.h'], libraries: ['DHT sensor library'] },
    summary: (v) => `${String(v['model'] ?? 'DHT22')} °C`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      const object = `dht_${ctx.slug}`;
      return {
        globals: [`DHT ${object}(${p === null ? 4 : String(p)}, ${String(ctx.config('model'))});`],
        setup: [`${object}.begin();`],
      };
    },
    emit: (ctx) => ({ expression: `dht_${stableSuffix(ctx.nodeId)}.readTemperature()` }),
  },
  {
    id: 'dht.readHumidity',
    category: 'components',
    label: 'DHT Humidity',
    description: 'Reads relative humidity as a percentage from a DHT11 or DHT22.',
    icon: Waves,
    kind: 'expression',
    inputs: [pin('pin', 'Pin', 4)],
    config: [
      {
        kind: 'select',
        id: 'model',
        label: 'Sensor',
        default: 'DHT22',
        options: [
          { value: 'DHT11', label: 'DHT11' },
          { value: 'DHT22', label: 'DHT22' },
        ],
      },
    ],
    outputs: [{ id: 'out', label: '%', type: 'float' }],
    requires: { includes: ['DHT.h'], libraries: ['DHT sensor library'] },
    summary: (v) => `${String(v['model'] ?? 'DHT22')} %RH`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      const object = `dht_${ctx.slug}`;
      return {
        globals: [`DHT ${object}(${p === null ? 4 : String(p)}, ${String(ctx.config('model'))});`],
        setup: [`${object}.begin();`],
      };
    },
    emit: (ctx) => ({ expression: `dht_${stableSuffix(ctx.nodeId)}.readHumidity()` }),
  },
];

// ── LCD 16x2 I2C ─────────────────────────────────────────────────────────────

const LCD_OBJECT = 'lcd';
const lcdRequires = {
  includes: ['Wire.h', 'LiquidCrystal_I2C.h'],
  libraries: ['LiquidCrystal I2C'],
  globals: [`LiquidCrystal_I2C ${LCD_OBJECT}(0x27, 16, 2);`],
};

const lcdNodes: NodeDef[] = [
  {
    id: 'lcd.init',
    category: 'components',
    label: 'LCD Init',
    description: 'Starts a 16x2 I2C character display. Put this in setup.',
    icon: MonitorSmartphone,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    requires: lcdRequires,
    summary: () => 'lcd init',
    emit: () => ({ statements: `${LCD_OBJECT}.init();\n${LCD_OBJECT}.backlight();` }),
  },
  {
    id: 'lcd.printAt',
    category: 'components',
    label: 'LCD Print At',
    description: 'Prints text at a chosen row and column of the display.',
    icon: MonitorSmartphone,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      int('col', 'Column', 0, 0, 15),
      int('row', 'Row', 0, 0, 1),
      { id: 'text', label: 'Text', type: 'string', literal: { kind: 'string', default: 'Hello' } },
    ],
    requires: lcdRequires,
    summary: (v) => `(${v['col'] ?? 0},${v['row'] ?? 0}) "${String(v['text'] ?? '')}"`,
    emit: (ctx) => ({
      statements: `${LCD_OBJECT}.setCursor(${ctx.input('col')}, ${ctx.input('row')});\n${LCD_OBJECT}.print(${ctx.input('text')});`,
    }),
  },
  {
    id: 'lcd.clear',
    category: 'components',
    label: 'LCD Clear',
    description: 'Wipes the display.',
    icon: MonitorSmartphone,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    requires: lcdRequires,
    summary: () => 'lcd clear',
    emit: () => ({ statements: `${LCD_OBJECT}.clear();` }),
  },
  {
    id: 'lcd.backlight',
    category: 'components',
    label: 'LCD Backlight',
    description: 'Turns the display backlight on or off.',
    icon: MonitorSmartphone,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'on', label: 'On', type: 'bool', literal: { kind: 'boolean', default: true } },
    ],
    requires: lcdRequires,
    summary: (v) => `backlight ${v['on'] === false ? 'off' : 'on'}`,
    emit: (ctx) => ({
      statements: `if (${ctx.input('on')}) { ${LCD_OBJECT}.backlight(); } else { ${LCD_OBJECT}.noBacklight(); }`,
    }),
  },
];

// ── NeoPixel ─────────────────────────────────────────────────────────────────

const NEO_OBJECT = 'pixels';
const neoNodes: NodeDef[] = [
  {
    id: 'neopixel.init',
    category: 'components',
    label: 'NeoPixel Init',
    description: 'Starts an addressable LED strip. Put this in setup.',
    icon: Sparkles,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'number', id: 'count', label: 'Pixel count', default: 8, min: 1, max: 300 },
      { kind: 'number', id: 'pin', label: 'Data pin', default: 6, min: 0, max: 19 },
    ],
    requires: { includes: ['Adafruit_NeoPixel.h'], libraries: ['Adafruit NeoPixel'] },
    summary: (v) => `${v['count'] ?? 8} pixels on ${v['pin'] ?? 6}`,
    collect: (ctx) => {
      const count = ctx.config('count');
      const dataPin = ctx.config('pin');
      return {
        globals: [
          `Adafruit_NeoPixel ${NEO_OBJECT}(${typeof count === 'number' ? Math.round(count) : 8}, ${typeof dataPin === 'number' ? Math.round(dataPin) : 6}, NEO_GRB + NEO_KHZ800);`,
        ],
      };
    },
    emit: () => ({ statements: `${NEO_OBJECT}.begin();\n${NEO_OBJECT}.show();` }),
  },
  {
    id: 'neopixel.setPixel',
    category: 'components',
    label: 'NeoPixel Set Colour',
    description: 'Sets one pixel to a red/green/blue colour. Call Show to display it.',
    icon: Sparkles,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      int('index', 'Pixel', 0, 0),
      int('r', 'Red', 255, 0, 255),
      int('g', 'Green', 0, 0, 255),
      int('b', 'Blue', 0, 0, 255),
    ],
    requires: { includes: ['Adafruit_NeoPixel.h'], libraries: ['Adafruit NeoPixel'] },
    summary: (v) => `#${v['index'] ?? 0} rgb(${v['r'] ?? 0},${v['g'] ?? 0},${v['b'] ?? 0})`,
    emit: (ctx) => ({
      statements: `${NEO_OBJECT}.setPixelColor(${ctx.input('index')}, ${NEO_OBJECT}.Color(${ctx.input('r')}, ${ctx.input('g')}, ${ctx.input('b')}));`,
    }),
  },
  {
    id: 'neopixel.setAll',
    category: 'components',
    label: 'NeoPixel Set All',
    description: 'Sets every pixel to the same colour.',
    icon: Sparkles,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('r', 'Red', 255, 0, 255), int('g', 'Green', 0, 0, 255), int('b', 'Blue', 0, 0, 255)],
    requires: { includes: ['Adafruit_NeoPixel.h'], libraries: ['Adafruit NeoPixel'] },
    summary: (v) => `all rgb(${v['r'] ?? 0},${v['g'] ?? 0},${v['b'] ?? 0})`,
    emit: (ctx) => ({
      statements: `${NEO_OBJECT}.fill(${NEO_OBJECT}.Color(${ctx.input('r')}, ${ctx.input('g')}, ${ctx.input('b')}));`,
    }),
  },
  {
    id: 'neopixel.brightness',
    category: 'components',
    label: 'NeoPixel Brightness',
    description: 'Sets overall strip brightness from 0 to 255.',
    icon: Sparkles,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('level', 'Brightness', 64, 0, 255)],
    requires: { includes: ['Adafruit_NeoPixel.h'], libraries: ['Adafruit NeoPixel'] },
    summary: (v) => `brightness ${v['level'] ?? 0}`,
    emit: (ctx) => ({ statements: `${NEO_OBJECT}.setBrightness(${ctx.input('level')});` }),
  },
  {
    id: 'neopixel.show',
    category: 'components',
    label: 'NeoPixel Show',
    description: 'Pushes the colours you set out to the strip.',
    icon: Sparkles,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    requires: { includes: ['Adafruit_NeoPixel.h'], libraries: ['Adafruit NeoPixel'] },
    summary: () => 'show',
    emit: () => ({ statements: `${NEO_OBJECT}.show();` }),
  },
];

// ── Buzzer, relay, motors, shift register ────────────────────────────────────

const NOTES = [
  { value: '262', label: 'C4' },
  { value: '294', label: 'D4' },
  { value: '330', label: 'E4' },
  { value: '349', label: 'F4' },
  { value: '392', label: 'G4' },
  { value: '440', label: 'A4' },
  { value: '494', label: 'B4' },
  { value: '523', label: 'C5' },
];

const miscNodes: NodeDef[] = [
  {
    id: 'buzzer.beep',
    category: 'components',
    label: 'Buzzer Beep',
    description: 'Plays a short beep.',
    icon: Volume2,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 8), int('frequency', 'Hz', 880, 31), int('ms', 'Length ms', 120, 1)],
    summary: (v) => `beep ${v['frequency'] ?? 0} Hz`,
    emit: (ctx) => ({
      statements: `tone(${ctx.input('pin')}, ${ctx.input('frequency')}, ${ctx.input('ms')});`,
    }),
  },
  {
    id: 'buzzer.playNote',
    category: 'components',
    label: 'Buzzer Play Note',
    description: 'Plays a named musical note.',
    icon: Music,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 8), int('ms', 'Length ms', 200, 1)],
    config: [{ kind: 'select', id: 'note', label: 'Note', default: '440', options: NOTES }],
    summary: (v) => `note ${NOTES.find((n) => n.value === String(v['note']))?.label ?? 'A4'}`,
    emit: (ctx) => ({
      statements: `tone(${ctx.input('pin')}, ${String(ctx.config('note'))}, ${ctx.input('ms')});`,
    }),
  },
  {
    id: 'buzzer.stop',
    category: 'components',
    label: 'Buzzer Stop',
    description: 'Silences the buzzer.',
    icon: Volume2,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('pin', 'Pin', 8)],
    summary: () => 'stop',
    emit: (ctx) => ({ statements: `noTone(${ctx.input('pin')});` }),
  },
  {
    id: 'relay.set',
    category: 'components',
    label: 'Relay Set',
    description: 'Switches a relay on or off.',
    icon: ToggleLeft,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      pin('pin', 'Pin', 5),
      { id: 'on', label: 'On', type: 'bool', literal: { kind: 'boolean', default: true } },
    ],
    config: [
      {
        kind: 'checkbox',
        id: 'activeLow',
        label: 'Active LOW module',
        default: true,
      },
    ],
    summary: (v) => `relay ${v['on'] === false ? 'off' : 'on'}`,
    collect: (ctx) => {
      const p = ctx.literal('pin');
      return p === null ? {} : { setup: [`pinMode(${String(p)}, OUTPUT);`] };
    },
    emit: (ctx) => {
      // Most hobby relay boards switch on when the pin is pulled LOW.
      const on = ctx.input('on');
      const level = ctx.config('activeLow') === true ? `(${on} ? LOW : HIGH)` : `(${on} ? HIGH : LOW)`;
      return { statements: `digitalWrite(${ctx.input('pin')}, ${level});` };
    },
  },
  {
    id: 'motor.setSpeed',
    category: 'components',
    label: 'Motor Drive',
    description: 'Drives one channel of an L298N motor driver forward or backward.',
    icon: Fan,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      pin('enable', 'Enable (PWM)', 5),
      pin('in1', 'IN1', 6),
      pin('in2', 'IN2', 7),
      int('speed', 'Speed -255..255', 200, -255, 255),
    ],
    summary: (v) => `motor ${v['speed'] ?? 0}`,
    collect: (ctx) => {
      const setup: string[] = [];
      for (const port of ['enable', 'in1', 'in2'] as const) {
        const value = ctx.literal(port);
        if (value !== null) setup.push(`pinMode(${String(value)}, OUTPUT);`);
      }
      return { setup };
    },
    emit: (ctx) => {
      const speed = ctx.input('speed');
      return {
        statements: [
          `digitalWrite(${ctx.input('in1')}, ${speed} >= 0 ? HIGH : LOW);`,
          `digitalWrite(${ctx.input('in2')}, ${speed} >= 0 ? LOW : HIGH);`,
          `analogWrite(${ctx.input('enable')}, constrain(abs(${speed}), 0, 255));`,
        ].join('\n'),
      };
    },
  },
  {
    id: 'motor.stop',
    category: 'components',
    label: 'Motor Stop',
    description: 'Stops a motor, either coasting or braking.',
    icon: Fan,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('enable', 'Enable (PWM)', 5), pin('in1', 'IN1', 6), pin('in2', 'IN2', 7)],
    config: [{ kind: 'checkbox', id: 'brake', label: 'Brake (short the motor)', default: false }],
    summary: (v) => (v['brake'] === true ? 'brake' : 'coast'),
    emit: (ctx) => {
      const brake = ctx.config('brake') === true;
      return {
        statements: [
          `digitalWrite(${ctx.input('in1')}, ${brake ? 'HIGH' : 'LOW'});`,
          `digitalWrite(${ctx.input('in2')}, ${brake ? 'HIGH' : 'LOW'});`,
          `analogWrite(${ctx.input('enable')}, 0);`,
        ].join('\n'),
      };
    },
  },
  {
    id: 'shift595.writeByte',
    category: 'components',
    label: 'Shift Register Write',
    description: 'Writes eight outputs at once through a 74HC595.',
    icon: Share2,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      pin('data', 'Data (DS)', 11),
      pin('clock', 'Clock (SH)', 12),
      pin('latch', 'Latch (ST)', 8),
      int('value', 'Byte', 0, 0, 255),
    ],
    summary: (v) => `write ${v['value'] ?? 0}`,
    collect: (ctx) => {
      const setup: string[] = [];
      for (const port of ['data', 'clock', 'latch'] as const) {
        const value = ctx.literal(port);
        if (value !== null) setup.push(`pinMode(${String(value)}, OUTPUT);`);
      }
      return { setup };
    },
    emit: (ctx) => ({
      statements: [
        `digitalWrite(${ctx.input('latch')}, LOW);`,
        `shiftOut(${ctx.input('data')}, ${ctx.input('clock')}, MSBFIRST, ${ctx.input('value')});`,
        `digitalWrite(${ctx.input('latch')}, HIGH);`,
      ].join('\n'),
    }),
  },
];

// ── Stepper, IR, SoftwareSerial, RTC, SD ─────────────────────────────────────

const peripheralNodes: NodeDef[] = [
  {
    id: 'stepper.setSpeed',
    category: 'components',
    label: 'Stepper Set Speed',
    description: 'Sets how fast a stepper turns, in revolutions per minute.',
    icon: ArrowLeftRight,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('rpm', 'RPM', 60, 1)],
    config: [{ kind: 'number', id: 'steps', label: 'Steps per revolution', default: 200, min: 1 }],
    requires: { includes: ['Stepper.h'], libraries: ['Stepper'] },
    summary: (v) => `${v['rpm'] ?? 0} rpm`,
    collect: (ctx) => {
      const steps = ctx.config('steps');
      return {
        globals: [
          `Stepper stepper_${ctx.slug}(${typeof steps === 'number' ? Math.round(steps) : 200}, 8, 9, 10, 11);`,
        ],
      };
    },
    emit: (ctx) => ({
      statements: `stepper_${stableSuffix(ctx.nodeId)}.setSpeed(${ctx.input('rpm')});`,
    }),
  },
  {
    id: 'stepper.step',
    category: 'components',
    label: 'Stepper Step',
    description: 'Turns a stepper by a number of steps. Negative goes the other way.',
    icon: ArrowLeftRight,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [int('steps', 'Steps', 100)],
    config: [{ kind: 'number', id: 'perRev', label: 'Steps per revolution', default: 200, min: 1 }],
    requires: { includes: ['Stepper.h'], libraries: ['Stepper'] },
    summary: (v) => `${v['steps'] ?? 0} steps`,
    collect: (ctx) => {
      const steps = ctx.config('perRev');
      return {
        globals: [
          `Stepper stepper_${ctx.slug}(${typeof steps === 'number' ? Math.round(steps) : 200}, 8, 9, 10, 11);`,
        ],
      };
    },
    emit: (ctx) => ({ statements: `stepper_${stableSuffix(ctx.nodeId)}.step(${ctx.input('steps')});` }),
  },
  {
    id: 'ir.readCode',
    category: 'components',
    label: 'IR Read Code',
    description: 'Reads a code from an infrared remote. 0 when nothing arrived.',
    icon: Rss,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'Code', type: 'int' }],
    config: [{ kind: 'number', id: 'pin', label: 'Receiver pin', default: 2, min: 0, max: 19 }],
    requires: { includes: ['IRremote.hpp'], libraries: ['IRremote'] },
    summary: () => 'ir code',
    collect: (ctx) => {
      const receiverPin = ctx.config('pin');
      return {
        setup: [
          `IrReceiver.begin(${typeof receiverPin === 'number' ? Math.round(receiverPin) : 2}, ENABLE_LED_FEEDBACK);`,
        ],
        functions: [
          {
            signature: `long _af_ir_${ctx.slug}()`,
            body: [
              'if (!IrReceiver.decode()) return 0;',
              'long value = (long)IrReceiver.decodedIRData.decodedRawData;',
              'IrReceiver.resume();',
              'return value;',
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({ expression: `_af_ir_${stableSuffix(ctx.nodeId)}()` }),
  },
  {
    id: 'softserial.begin',
    category: 'components',
    label: 'Software Serial Begin',
    description: 'Starts a second serial port on ordinary pins.',
    icon: Cpu,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'number', id: 'rx', label: 'RX pin', default: 10, min: 0, max: 19 },
      { kind: 'number', id: 'tx', label: 'TX pin', default: 11, min: 0, max: 19 },
      { kind: 'number', id: 'baud', label: 'Baud', default: 9600, min: 300 },
    ],
    requires: { includes: ['SoftwareSerial.h'], libraries: ['SoftwareSerial'] },
    summary: (v) => `soft serial ${v['baud'] ?? 9600}`,
    collect: (ctx) => {
      const rx = ctx.config('rx');
      const tx = ctx.config('tx');
      return {
        globals: [
          `SoftwareSerial softSerial(${typeof rx === 'number' ? Math.round(rx) : 10}, ${typeof tx === 'number' ? Math.round(tx) : 11});`,
        ],
      };
    },
    emit: (ctx) => ({ statements: `softSerial.begin(${String(ctx.config('baud'))});` }),
  },
  {
    id: 'softserial.print',
    category: 'components',
    label: 'Software Serial Print',
    description: 'Sends text out of the software serial port.',
    icon: Cpu,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [{ id: 'value', label: 'Text', type: 'string', literal: { kind: 'string', default: '' } }],
    requires: { includes: ['SoftwareSerial.h'], libraries: ['SoftwareSerial'] },
    summary: () => 'soft print',
    emit: (ctx) => ({ statements: `softSerial.println(${ctx.input('value')});` }),
  },
  {
    id: 'softserial.available',
    category: 'components',
    label: 'Software Serial Available',
    description: 'How many bytes are waiting on the software serial port.',
    icon: Cpu,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'Bytes', type: 'int' }],
    requires: { includes: ['SoftwareSerial.h'], libraries: ['SoftwareSerial'] },
    summary: () => 'soft available',
    emit: () => ({ expression: 'softSerial.available()' }),
  },
  {
    id: 'softserial.read',
    category: 'components',
    label: 'Software Serial Read',
    description: 'Reads one waiting byte from the software serial port.',
    icon: Cpu,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'Byte', type: 'int' }],
    requires: { includes: ['SoftwareSerial.h'], libraries: ['SoftwareSerial'] },
    summary: () => 'soft read',
    emit: () => ({ expression: 'softSerial.read()' }),
  },
  {
    id: 'rtc.readTime',
    category: 'components',
    label: 'RTC Read Time',
    description: 'Reads the current time from a DS3231 clock as text.',
    icon: Clock,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'hh:mm:ss', type: 'string' }],
    requires: { includes: ['Wire.h', 'RTClib.h'], libraries: ['RTClib'], globals: ['RTC_DS3231 rtc;'] },
    summary: () => 'rtc time',
    collect: (ctx) => ({
      setup: ['rtc.begin();'],
      functions: [
        {
          signature: `String _af_rtcTime_${ctx.slug}()`,
          body: [
            'DateTime now = rtc.now();',
            'char buffer[9];',
            'snprintf(buffer, sizeof(buffer), "%02d:%02d:%02d", now.hour(), now.minute(), now.second());',
            'return String(buffer);',
          ].join('\n'),
        },
      ],
    }),
    emit: (ctx) => ({ expression: `_af_rtcTime_${stableSuffix(ctx.nodeId)}()` }),
  },
  {
    id: 'rtc.readDate',
    category: 'components',
    label: 'RTC Read Date',
    description: 'Reads the current date from a DS3231 clock as text.',
    icon: Clock,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'yyyy-mm-dd', type: 'string' }],
    requires: { includes: ['Wire.h', 'RTClib.h'], libraries: ['RTClib'], globals: ['RTC_DS3231 rtc;'] },
    summary: () => 'rtc date',
    collect: (ctx) => ({
      setup: ['rtc.begin();'],
      functions: [
        {
          signature: `String _af_rtcDate_${ctx.slug}()`,
          body: [
            'DateTime now = rtc.now();',
            'char buffer[11];',
            'snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d", now.year(), now.month(), now.day());',
            'return String(buffer);',
          ].join('\n'),
        },
      ],
    }),
    emit: (ctx) => ({ expression: `_af_rtcDate_${stableSuffix(ctx.nodeId)}()` }),
  },
  {
    id: 'sd.init',
    category: 'components',
    label: 'SD Card Init',
    description: 'Starts an SD card module. Put this in setup.',
    icon: SaveAll,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [pin('cs', 'Chip select', 10)],
    requires: { includes: ['SPI.h', 'SD.h'], libraries: ['SD'] },
    summary: (v) => `sd init CS ${v['cs'] ?? 10}`,
    emit: (ctx) => ({ statements: `SD.begin(${ctx.input('cs')});` }),
  },
  {
    id: 'sd.writeLine',
    category: 'components',
    label: 'SD Write Line',
    description: 'Appends a line of text to a file on the SD card.',
    icon: SaveAll,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'file', label: 'File', type: 'string', literal: { kind: 'string', default: 'log.txt' } },
      { id: 'text', label: 'Text', type: 'string', literal: { kind: 'string', default: '' } },
    ],
    requires: { includes: ['SPI.h', 'SD.h'], libraries: ['SD'] },
    summary: (v) => `write ${String(v['file'] ?? 'log.txt')}`,
    collect: (ctx) => ({
      functions: [
        {
          signature: `void _af_sdWrite_${ctx.slug}(const String &path, const String &line)`,
          body: [
            'File handle = SD.open(path.c_str(), FILE_WRITE);',
            'if (!handle) return;',
            'handle.println(line);',
            '// Closing every time is slower but survives losing power mid-log.',
            'handle.close();',
          ].join('\n'),
        },
      ],
    }),
    emit: (ctx) => ({
      statements: `_af_sdWrite_${stableSuffix(ctx.nodeId)}(${ctx.input('file')}, ${ctx.input('text')});`,
    }),
  },
];

export const componentNodes: readonly NodeDef[] = [
  ...ledNodes,
  ...buttonNodes,
  ...potNodes,
  ...servoNodes,
  ...ultrasonicNodes,
  ...dhtNodes,
  ...lcdNodes,
  ...neoNodes,
  ...miscNodes,
  ...peripheralNodes,
];
