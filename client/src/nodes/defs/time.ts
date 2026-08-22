import { Clock, Gauge, Timer, TimerReset } from 'lucide-react';
import { stableSuffix } from '@/codegen/names';
import type { NodeDef } from '@/nodes/types';

export const timeNodes: readonly NodeDef[] = [
  {
    id: 'time.millis',
    category: 'time',
    label: 'Milliseconds Since Start',
    description: 'How long the board has been running, in milliseconds.',
    icon: Clock,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'ms', type: 'int' }],
    summary: () => 'millis()',
    emit: () => ({ expression: 'millis()' }),
  },
  {
    id: 'time.micros',
    category: 'time',
    label: 'Microseconds Since Start',
    description: 'How long the board has been running, in microseconds.',
    icon: Gauge,
    kind: 'expression',
    outputs: [{ id: 'out', label: 'µs', type: 'int' }],
    summary: () => 'micros()',
    emit: () => ({ expression: 'micros()' }),
  },
  {
    id: 'time.elapsedSince',
    category: 'time',
    label: 'Elapsed Since',
    description: 'How long it has been since a recorded moment, in milliseconds.',
    icon: Timer,
    kind: 'expression',
    inputs: [
      { id: 'since', label: 'Timestamp', type: 'int', literal: { kind: 'number', default: 0, integer: true } },
    ],
    outputs: [{ id: 'out', label: 'Elapsed', type: 'int' }],
    summary: () => 'millis() - since',
    emit: (ctx) => ({
      // Unsigned subtraction so the result stays correct across millis() rollover.
      expression: `(long)(millis() - (unsigned long)(${ctx.input('since')}))`,
    }),
  },
  {
    id: 'time.stopwatch',
    category: 'time',
    label: 'Stopwatch',
    description: 'Starts, stops, and reads a running timer.',
    icon: TimerReset,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      {
        kind: 'select',
        id: 'action',
        label: 'Action',
        default: 'start',
        options: [
          { value: 'start', label: 'start' },
          { value: 'stop', label: 'stop' },
          { value: 'reset', label: 'reset' },
        ],
      },
      { kind: 'text', id: 'name', label: 'Name', default: 'timer', placeholder: 'timer' },
    ],
    summary: (v) => `${String(v['action'] ?? 'start')} ${String(v['name'] ?? 'timer')}`,
    collect: (ctx) => {
      const suffix = stableSuffix(String(ctx.config('name') || 'timer'));
      return {
        globals: [
          `unsigned long _af_sw_start_${suffix} = 0;`,
          `unsigned long _af_sw_total_${suffix} = 0;`,
          `bool _af_sw_running_${suffix} = false;`,
        ],
      };
    },
    emit: (ctx) => {
      const suffix = stableSuffix(String(ctx.config('name') || 'timer'));
      const action = String(ctx.config('action') ?? 'start');
      if (action === 'stop') {
        return {
          statements: [
            `if (_af_sw_running_${suffix}) {`,
            `  _af_sw_total_${suffix} += millis() - _af_sw_start_${suffix};`,
            `  _af_sw_running_${suffix} = false;`,
            `}`,
          ].join('\n'),
        };
      }
      if (action === 'reset') {
        return {
          statements: [
            `_af_sw_total_${suffix} = 0;`,
            `_af_sw_start_${suffix} = millis();`,
          ].join('\n'),
        };
      }
      return {
        statements: [
          `if (!_af_sw_running_${suffix}) {`,
          `  _af_sw_start_${suffix} = millis();`,
          `  _af_sw_running_${suffix} = true;`,
          `}`,
        ].join('\n'),
      };
    },
  },
  {
    id: 'time.stopwatchRead',
    category: 'time',
    label: 'Read Stopwatch',
    description: 'How many milliseconds a stopwatch has counted.',
    icon: TimerReset,
    kind: 'expression',
    config: [{ kind: 'text', id: 'name', label: 'Name', default: 'timer', placeholder: 'timer' }],
    outputs: [{ id: 'out', label: 'Elapsed', type: 'int' }],
    summary: (v) => `read ${String(v['name'] ?? 'timer')}`,
    emit: (ctx) => {
      const suffix = stableSuffix(String(ctx.config('name') || 'timer'));
      return {
        expression: `(long)(_af_sw_total_${suffix} + (_af_sw_running_${suffix} ? millis() - _af_sw_start_${suffix} : 0))`,
      };
    },
  },
];
