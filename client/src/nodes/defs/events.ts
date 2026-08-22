import { FunctionSquare, Play, RefreshCw, Zap } from 'lucide-react';
import { sanitiseIdentifier, stableSuffix } from '@/codegen/names';
import { parseNameList } from '@/nodes/defs/control';
import type { NodeDef } from '@/nodes/types';

const RETURN_TYPES = [
  { value: 'void', label: 'nothing' },
  { value: 'int', label: 'int' },
  { value: 'float', label: 'float' },
  { value: 'bool', label: 'bool' },
  { value: 'String', label: 'text' },
] as const;

export const eventNodes: readonly NodeDef[] = [
  {
    id: 'event.setup',
    category: 'events',
    label: 'On Setup',
    description: 'Runs once when the board powers on or resets.',
    icon: Play,
    kind: 'entry',
    execOut: ['then'],
    singleton: true,
    emit: (ctx) => ({ statements: ctx.branch('then') }),
  },
  {
    id: 'event.loop',
    category: 'events',
    label: 'On Loop',
    description: 'Runs over and over, forever, after setup finishes.',
    icon: RefreshCw,
    kind: 'entry',
    execOut: ['then'],
    singleton: true,
    emit: (ctx) => ({ statements: ctx.branch('then') }),
  },
  {
    id: 'event.interrupt',
    category: 'events',
    label: 'On Interrupt',
    description: 'Runs the moment a pin changes, interrupting whatever else is happening.',
    icon: Zap,
    kind: 'entry',
    execOut: ['then'],
    config: [
      {
        kind: 'select',
        id: 'pin',
        label: 'Pin',
        default: '2',
        // Only pins 2 and 3 support attachInterrupt() on an Uno.
        options: [
          { value: '2', label: 'D2' },
          { value: '3', label: 'D3' },
        ],
      },
      {
        kind: 'select',
        id: 'mode',
        label: 'Trigger on',
        default: 'RISING',
        options: [
          { value: 'RISING', label: 'RISING' },
          { value: 'FALLING', label: 'FALLING' },
          { value: 'CHANGE', label: 'CHANGE' },
        ],
      },
    ],
    summary: (v) => `D${v['pin'] ?? 2} ${v['mode'] ?? 'RISING'}`,
    collect: (ctx) => {
      const handler = `_af_isr_${ctx.slug}`;
      return {
        setup: [
          `attachInterrupt(digitalPinToInterrupt(${String(ctx.config('pin'))}), ${handler}, ${String(ctx.config('mode'))});`,
        ],
      };
    },
    functionEntry: (ctx) => ({ signature: `void _af_isr_${ctx.slug}()` }),
    emit: (ctx) => ({ statements: ctx.branch('then') }),
  },
  {
    id: 'event.function',
    category: 'events',
    label: 'Define Function',
    description: 'Defines a reusable function. Call it with the Call Function node.',
    icon: FunctionSquare,
    kind: 'entry',
    execOut: ['body'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myFunction', placeholder: 'myFunction' },
      { kind: 'select', id: 'returns', label: 'Returns', default: 'void', options: RETURN_TYPES },
      {
        kind: 'text',
        id: 'params',
        label: 'Parameters',
        default: '',
        placeholder: 'int speed, bool on',
      },
    ],
    summary: (v) => `${String(v['name'] ?? 'myFunction')}()`,
    functionEntry: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'myFunction'), 'myFunction');
      const params = String(ctx.config('params') ?? '').trim();
      return { signature: `${String(ctx.config('returns'))} ${name}(${params})` };
    },
    emit: (ctx) => ({ statements: ctx.branch('body') }),
  },
  {
    id: 'func.call',
    category: 'events',
    label: 'Call Function (value)',
    description: 'Runs a function you defined and uses the value it returns.',
    icon: FunctionSquare,
    kind: 'expression',
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myFunction', placeholder: 'myFunction' },
      { kind: 'text', id: 'args', label: 'Arguments', default: '', placeholder: '120, true' },
      {
        kind: 'select',
        id: 'returns',
        label: 'Returns',
        default: 'int',
        options: [
          { value: 'int', label: 'whole number' },
          { value: 'float', label: 'decimal' },
          { value: 'bool', label: 'true / false' },
          { value: 'String', label: 'text' },
        ],
      },
    ],
    dynamic: {
      outputs: (config) => [
        {
          id: 'out',
          label: 'Result',
          type:
            String(config['returns']) === 'float'
              ? 'float'
              : String(config['returns']) === 'bool'
                ? 'bool'
                : String(config['returns']) === 'String'
                  ? 'string'
                  : 'int',
        },
      ],
    },
    summary: (v) => `${String(v['name'] ?? 'myFunction')}(${String(v['args'] ?? '')})`,
    emit: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'myFunction'), 'myFunction');
      return { expression: `${name}(${String(ctx.config('args') ?? '').trim()})` };
    },
  },
  {
    id: 'event.callFunction',
    category: 'events',
    label: 'Call Function',
    description: 'Runs a function you defined with Define Function.',
    icon: FunctionSquare,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myFunction', placeholder: 'myFunction' },
      { kind: 'text', id: 'args', label: 'Arguments', default: '', placeholder: '120, true' },
    ],
    summary: (v) => `${String(v['name'] ?? 'myFunction')}(${String(v['args'] ?? '')})`,
    emit: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'myFunction'), 'myFunction');
      return { statements: `${name}(${String(ctx.config('args') ?? '').trim()});` };
    },
  },
];

/** Exported for tests: the ISR handler name a given node id produces. */
export function isrNameFor(nodeId: string): string {
  return `_af_isr_${stableSuffix(nodeId)}`;
}

export const eventStateNames = parseNameList;
