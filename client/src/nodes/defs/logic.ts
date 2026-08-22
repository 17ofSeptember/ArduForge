import { Binary, Equal, ToggleLeft, Zap } from 'lucide-react';
import { NUMERIC_FIELD_INT, numericIn, numericMode, numericOut, widen } from '@/nodes/numeric';
import type { NodeDef, PortDef } from '@/nodes/types';

const boolIn = (id: string, label: string, def = false): PortDef => ({
  id,
  label,
  type: 'bool',
  literal: { kind: 'boolean', default: def },
});

const intIn = (id: string, label: string, def = 0): PortDef => ({
  id,
  label,
  type: 'int',
  literal: { kind: 'number', default: def, integer: true },
});

const COMPARISONS = [
  { value: '==', label: 'equal to' },
  { value: '!=', label: 'not equal to' },
  { value: '<', label: 'less than' },
  { value: '>', label: 'greater than' },
  { value: '<=', label: 'at most' },
  { value: '>=', label: 'at least' },
] as const;

function boolBinary(id: string, label: string, description: string, operator: string): NodeDef {
  return {
    id,
    category: 'logic',
    label,
    description,
    icon: Zap,
    kind: 'expression',
    inputs: [boolIn('a', 'A'), boolIn('b', 'B')],
    outputs: [{ id: 'out', label: 'Result', type: 'bool' }],
    summary: () => `a ${operator} b`,
    emit: (ctx) => ({ expression: `(${ctx.input('a')} ${operator} ${ctx.input('b')})` }),
  };
}

/**
 * Bitwise operators are already integer-typed, so the mode only adds `long`.
 * `float` is offered by the shared field but rejected in validation: the C++
 * operators are undefined on floating point, and emitting `a & b` for two
 * floats produces a compile error pointing at generated code.
 */
function bitBinary(id: string, label: string, description: string, operator: string): NodeDef {
  return {
    id,
    category: 'logic',
    label,
    description,
    icon: Binary,
    kind: 'expression',
    config: [NUMERIC_FIELD_INT],
    dynamic: {
      inputs: (config) => [numericIn('a', 'A', numericMode(config)), numericIn('b', 'B', numericMode(config))],
      outputs: (config) => [numericOut(numericMode(config))],
    },
    inputs: [intIn('a', 'A'), intIn('b', 'B')],
    outputs: [{ id: 'out', label: 'Result', type: 'int' }],
    summary: () => `a ${operator} b`,
    emit: (ctx) => {
      const mode = numericMode({ numericType: ctx.config('numericType') });
      return { expression: `(${widen(mode, ctx.input('a'))} ${operator} ${ctx.input('b')})` };
    },
  };
}

export const logicNodes: readonly NodeDef[] = [
  {
    id: 'logic.boolean',
    category: 'logic',
    label: 'Boolean',
    description: 'A fixed true or false value.',
    icon: ToggleLeft,
    kind: 'expression',
    inputs: [
      {
        id: 'value',
        label: 'Value',
        type: 'bool',
        literal: { kind: 'boolean', default: true, trueLabel: 'true', falseLabel: 'false' },
      },
    ],
    outputs: [{ id: 'out', label: 'Value', type: 'bool' }],
    summary: (v) => (v['value'] === false ? 'false' : 'true'),
    emit: (ctx) => ({ expression: ctx.input('value') }),
  },
  boolBinary('logic.and', 'And', 'True only when both inputs are true.', '&&'),
  boolBinary('logic.or', 'Or', 'True when either input is true.', '||'),
  {
    id: 'logic.not',
    category: 'logic',
    label: 'Not',
    description: 'Flips true to false and false to true.',
    icon: ToggleLeft,
    kind: 'expression',
    inputs: [boolIn('value', 'Value')],
    outputs: [{ id: 'out', label: 'Result', type: 'bool' }],
    summary: () => 'not value',
    emit: (ctx) => ({ expression: `(!${ctx.input('value')})` }),
  },
  {
    id: 'logic.xor',
    category: 'logic',
    label: 'Exclusive Or',
    description: 'True when exactly one of the two inputs is true.',
    icon: Zap,
    kind: 'expression',
    inputs: [boolIn('a', 'A'), boolIn('b', 'B')],
    outputs: [{ id: 'out', label: 'Result', type: 'bool' }],
    summary: () => 'a xor b',
    emit: (ctx) => ({ expression: `(${ctx.input('a')} != ${ctx.input('b')})` }),
  },
  {
    id: 'logic.compare',
    category: 'logic',
    label: 'Compare',
    description: 'Compares two numbers and returns true or false.',
    icon: Equal,
    kind: 'expression',
    // Deliberately `any`: C++ comparison works for both int and float, so typing
    // these as float would force integer literals to emit as 5.0f, and typing
    // them as int would block a sensor reading from ever reaching a threshold.
    inputs: [
      { id: 'a', label: 'A', type: 'any', literal: { kind: 'number', default: 0 } },
      { id: 'b', label: 'B', type: 'any', literal: { kind: 'number', default: 0 } },
    ],
    outputs: [{ id: 'out', label: 'Result', type: 'bool' }],
    config: [{ kind: 'select', id: 'op', label: 'Operator', default: '==', options: COMPARISONS }],
    summary: (v) => `${v['a'] ?? 0} ${v['op'] ?? '=='} ${v['b'] ?? 0}`,
    emit: (ctx) => ({
      expression: `(${ctx.input('a')} ${String(ctx.config('op'))} ${ctx.input('b')})`,
    }),
  },
  bitBinary('logic.bitAnd', 'Bitwise And', 'Combines two numbers bit by bit with AND.', '&'),
  bitBinary('logic.bitOr', 'Bitwise Or', 'Combines two numbers bit by bit with OR.', '|'),
  bitBinary('logic.bitXor', 'Bitwise Xor', 'Combines two numbers bit by bit with XOR.', '^'),
  bitBinary('logic.shiftLeft', 'Shift Left', 'Moves the bits of a number to the left.', '<<'),
  bitBinary('logic.shiftRight', 'Shift Right', 'Moves the bits of a number to the right.', '>>'),
  {
    id: 'logic.bitNot',
    category: 'logic',
    label: 'Bitwise Not',
    description: 'Flips every bit of a number.',
    icon: Binary,
    kind: 'expression',
    inputs: [intIn('value', 'Value')],
    outputs: [{ id: 'out', label: 'Result', type: 'int' }],
    summary: () => '~value',
    emit: (ctx) => ({ expression: `(~${ctx.input('value')})` }),
  },
  {
    id: 'logic.bitRead',
    category: 'logic',
    label: 'Bit Read',
    description: 'Reads one bit out of a number.',
    icon: Binary,
    kind: 'expression',
    inputs: [intIn('value', 'Value'), intIn('bit', 'Bit', 0)],
    outputs: [{ id: 'out', label: 'Bit', type: 'int' }],
    summary: (v) => `bit ${v['bit'] ?? 0}`,
    emit: (ctx) => ({ expression: `bitRead(${ctx.input('value')}, ${ctx.input('bit')})` }),
  },
  {
    id: 'logic.bitSet',
    category: 'logic',
    label: 'Bit Set',
    description: 'Turns one bit of a number on.',
    icon: Binary,
    kind: 'expression',
    inputs: [intIn('value', 'Value'), intIn('bit', 'Bit', 0)],
    outputs: [{ id: 'out', label: 'Result', type: 'int' }],
    summary: (v) => `set bit ${v['bit'] ?? 0}`,
    emit: (ctx) => ({ expression: `(${ctx.input('value')} | (1UL << ${ctx.input('bit')}))` }),
  },
  {
    id: 'logic.bitClear',
    category: 'logic',
    label: 'Bit Clear',
    description: 'Turns one bit of a number off.',
    icon: Binary,
    kind: 'expression',
    inputs: [intIn('value', 'Value'), intIn('bit', 'Bit', 0)],
    outputs: [{ id: 'out', label: 'Result', type: 'int' }],
    summary: (v) => `clear bit ${v['bit'] ?? 0}`,
    emit: (ctx) => ({ expression: `(${ctx.input('value')} & ~(1UL << ${ctx.input('bit')}))` }),
  },
  {
    id: 'logic.bitWrite',
    category: 'logic',
    label: 'Bit Write',
    description: 'Sets one bit of a number to a chosen value.',
    icon: Binary,
    kind: 'expression',
    inputs: [intIn('value', 'Value'), intIn('bit', 'Bit', 0), boolIn('on', 'On')],
    outputs: [{ id: 'out', label: 'Result', type: 'int' }],
    summary: (v) => `write bit ${v['bit'] ?? 0}`,
    emit: (ctx) => ({
      expression: `(${ctx.input('on')} ? (${ctx.input('value')} | (1UL << ${ctx.input('bit')})) : (${ctx.input('value')} & ~(1UL << ${ctx.input('bit')})))`,
    }),
  },
];
