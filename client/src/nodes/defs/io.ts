import { ArrowDownToLine, ArrowUpFromLine, Gauge, Music, Plug, Ruler, Share2, Volume, Waves } from 'lucide-react';
import type { NodeDef } from '@/nodes/types';

const PIN_MODES = [
  { value: 'OUTPUT', label: 'OUTPUT' },
  { value: 'INPUT', label: 'INPUT' },
  { value: 'INPUT_PULLUP', label: 'INPUT_PULLUP' },
] as const;

export const ioNodes: readonly NodeDef[] = [
  {
    id: 'io.pinMode',
    category: 'io',
    label: 'Pin Mode',
    description: 'Configures a pin as an input or an output.',
    icon: Plug,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [{ id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 13, min: 0, max: 19, integer: true } }],
    config: [{ kind: 'select', id: 'mode', label: 'Mode', default: 'OUTPUT', options: PIN_MODES }],
    summary: (v) => `PIN ${v['pin'] ?? '?'} -> ${v['mode'] ?? 'OUTPUT'}`,
    emit: (ctx) => ({ statements: `pinMode(${ctx.input('pin')}, ${String(ctx.config('mode'))});` }),
  },
  {
    id: 'io.digitalWrite',
    category: 'io',
    label: 'Digital Write',
    description: 'Drives a pin fully HIGH (5V) or LOW (0V).',
    icon: ArrowUpFromLine,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 13, min: 0, max: 19, integer: true } },
      {
        id: 'value',
        label: 'Value',
        type: 'bool',
        literal: {
          kind: 'boolean',
          default: true,
          trueLabel: 'HIGH',
          falseLabel: 'LOW',
          cppTrue: 'HIGH',
          cppFalse: 'LOW',
        },
      },
    ],
    summary: (v) => `PIN ${v['pin'] ?? '?'} <- ${v['value'] === false ? 'LOW' : 'HIGH'}`,
    emit: (ctx) => ({ statements: `digitalWrite(${ctx.input('pin')}, ${ctx.input('value')});` }),
  },
  {
    id: 'io.digitalRead',
    category: 'io',
    label: 'Digital Read',
    description: 'Reads whether a pin is HIGH or LOW.',
    icon: ArrowDownToLine,
    kind: 'expression',
    inputs: [{ id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 2, min: 0, max: 19, integer: true } }],
    outputs: [{ id: 'value', label: 'Is High', type: 'bool' }],
    summary: (v) => `read PIN ${v['pin'] ?? '?'}`,
    emit: (ctx) => ({ expression: `digitalRead(${ctx.input('pin')})` }),
  },
  {
    id: 'io.analogRead',
    category: 'io',
    label: 'Analog Read',
    description: 'Reads an analog pin as a number from 0 to 1023.',
    icon: Gauge,
    kind: 'expression',
    inputs: [
      {
        id: 'pin',
        label: 'Pin',
        type: 'pin',
        literal: {
          kind: 'select',
          default: 'A0',
          options: [
            { value: 'A0', label: 'A0' },
            { value: 'A1', label: 'A1' },
            { value: 'A2', label: 'A2' },
            { value: 'A3', label: 'A3' },
            { value: 'A4', label: 'A4' },
            { value: 'A5', label: 'A5' },
          ],
        },
      },
    ],
    outputs: [{ id: 'value', label: 'Value', type: 'int' }],
    summary: (v) => `read ${v['pin'] ?? 'A0'} (0-1023)`,
    emit: (ctx) => ({ expression: `analogRead(${ctx.input('pin')})` }),
  },
  {
    id: 'io.analogWrite',
    category: 'io',
    label: 'Analog Write (PWM)',
    description: 'Writes a 0-255 PWM duty cycle. Only works on PWM-capable pins.',
    icon: Waves,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 9, min: 0, max: 19, integer: true } },
      { id: 'value', label: 'Duty', type: 'int', literal: { kind: 'number', default: 128, min: 0, max: 255, integer: true } },
    ],
    summary: (v) => `PIN ${v['pin'] ?? '?'} <- PWM ${v['value'] ?? 0}`,
    emit: (ctx) => ({ statements: `analogWrite(${ctx.input('pin')}, ${ctx.input('value')});` }),
  },
  {
    id: 'io.tone',
    category: 'io',
    label: 'Tone',
    description: 'Plays a square-wave tone on a pin. Good enough for a buzzer.',
    icon: Music,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 8, min: 0, max: 19, integer: true } },
      { id: 'frequency', label: 'Hz', type: 'int', literal: { kind: 'number', default: 440, min: 31, integer: true } },
      { id: 'duration', label: 'ms (0 = hold)', type: 'int', literal: { kind: 'number', default: 0, min: 0, integer: true } },
    ],
    summary: (v) => `PIN ${v['pin'] ?? '?'} ${v['frequency'] ?? 0} Hz`,
    emit: (ctx) => {
      const duration = ctx.input('duration');
      // tone() with a duration of 0 would stop immediately, so omit the argument.
      return {
        statements:
          duration === '0'
            ? `tone(${ctx.input('pin')}, ${ctx.input('frequency')});`
            : `tone(${ctx.input('pin')}, ${ctx.input('frequency')}, ${duration});`,
      };
    },
  },
  {
    id: 'io.noTone',
    category: 'io',
    label: 'No Tone',
    description: 'Stops a tone that is playing on a pin.',
    icon: Volume,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 8, min: 0, max: 19, integer: true } },
    ],
    summary: (v) => `stop PIN ${v['pin'] ?? '?'}`,
    emit: (ctx) => ({ statements: `noTone(${ctx.input('pin')});` }),
  },
  {
    id: 'io.pulseIn',
    category: 'io',
    label: 'Pulse In',
    description: 'Measures how long a pulse lasts, in microseconds. Blocking.',
    icon: Ruler,
    kind: 'expression',
    inputs: [
      { id: 'pin', label: 'Pin', type: 'pin', literal: { kind: 'number', default: 7, min: 0, max: 19, integer: true } },
      {
        id: 'level',
        label: 'Level',
        type: 'bool',
        literal: { kind: 'boolean', default: true, trueLabel: 'HIGH', falseLabel: 'LOW', cppTrue: 'HIGH', cppFalse: 'LOW' },
      },
      { id: 'timeout', label: 'Timeout µs', type: 'int', literal: { kind: 'number', default: 1000000, min: 1, integer: true } },
    ],
    outputs: [{ id: 'out', label: 'Length µs', type: 'int' }],
    summary: (v) => `pulse PIN ${v['pin'] ?? '?'}`,
    emit: (ctx) => ({
      expression: `(long)pulseIn(${ctx.input('pin')}, ${ctx.input('level')}, ${ctx.input('timeout')})`,
    }),
  },
  {
    id: 'io.shiftOut',
    category: 'io',
    label: 'Shift Out',
    description: 'Clocks a byte out one bit at a time, for shift registers.',
    icon: Share2,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'dataPin', label: 'Data pin', type: 'pin', literal: { kind: 'number', default: 11, min: 0, max: 19, integer: true } },
      { id: 'clockPin', label: 'Clock pin', type: 'pin', literal: { kind: 'number', default: 12, min: 0, max: 19, integer: true } },
      { id: 'value', label: 'Byte', type: 'int', literal: { kind: 'number', default: 0, min: 0, max: 255, integer: true } },
    ],
    config: [
      {
        kind: 'select',
        id: 'order',
        label: 'Bit order',
        default: 'MSBFIRST',
        options: [
          { value: 'MSBFIRST', label: 'most significant first' },
          { value: 'LSBFIRST', label: 'least significant first' },
        ],
      },
    ],
    summary: (v) => `shift ${v['value'] ?? 0}`,
    emit: (ctx) => ({
      statements: `shiftOut(${ctx.input('dataPin')}, ${ctx.input('clockPin')}, ${String(ctx.config('order'))}, ${ctx.input('value')});`,
    }),
  },
  {
    id: 'io.analogReference',
    category: 'io',
    label: 'Analog Reference',
    description: 'Chooses the voltage that analog readings are measured against.',
    icon: Gauge,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      {
        kind: 'select',
        id: 'source',
        label: 'Reference',
        default: 'DEFAULT',
        options: [
          { value: 'DEFAULT', label: 'DEFAULT (5V)' },
          { value: 'INTERNAL', label: 'INTERNAL (1.1V)' },
          { value: 'EXTERNAL', label: 'EXTERNAL (AREF pin)' },
        ],
      },
    ],
    summary: (v) => String(v['source'] ?? 'DEFAULT'),
    emit: (ctx) => ({ statements: `analogReference(${String(ctx.config('source'))});` }),
  },
];
