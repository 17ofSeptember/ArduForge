import { Ampersand, ArrowDown, ArrowUp, Dices, Divide, Equal, Hash, Minus, Percent, Plus, Radical, Ruler, Shuffle, Sigma, TrendingUp, Waves, X } from 'lucide-react';
import { NUMERIC_FIELD, NUMERIC_FIELD_INT, numericIn, numericMode, numericOut, widen } from '@/nodes/numeric';
import type { NodeDef, PortDef } from '@/nodes/types';

const numIn = (id: string, label: string, def = 0): PortDef => ({
  id,
  label,
  type: 'float',
  literal: { kind: 'number', default: def },
});

const intIn = (id: string, label: string, def = 0): PortDef => ({
  id,
  label,
  type: 'int',
  literal: { kind: 'number', default: def, integer: true },
});

/** Binary operators share a shape, so they are generated rather than repeated. */
function binary(
  id: string,
  label: string,
  description: string,
  icon: NodeDef['icon'],
  operator: string,
  outType: 'int' | 'float' = 'float',
): NodeDef {
  return {
    id,
    category: 'math',
    label,
    description,
    icon,
    kind: 'expression',
    config: [NUMERIC_FIELD],
    dynamic: {
      inputs: (config) => [numericIn('a', 'A', numericMode(config)), numericIn('b', 'B', numericMode(config))],
      outputs: (config) => [numericOut(numericMode(config))],
    },
    inputs: [numIn('a', 'A'), numIn('b', 'B')],
    outputs: [{ id: 'out', label: 'Result', type: outType }],
    summary: (v) => `${v['a'] ?? 0} ${operator} ${v['b'] ?? 0}`,
    emit: (ctx) => {
      const mode = numericMode({ numericType: ctx.config('numericType') });
      return { expression: `(${widen(mode, ctx.input('a'))} ${operator} ${ctx.input('b')})` };
    },
  };
}

function unaryCall(
  id: string,
  label: string,
  description: string,
  icon: NodeDef['icon'],
  fn: string,
  outType: 'int' | 'float' = 'float',
): NodeDef {
  return {
    id,
    category: 'math',
    label,
    description,
    icon,
    kind: 'expression',
    inputs: [numIn('value', 'Value')],
    outputs: [{ id: 'out', label: 'Result', type: outType }],
    summary: (v) => `${fn}(${v['value'] ?? 0})`,
    emit: (ctx) => ({ expression: `${fn}(${ctx.input('value')})` }),
  };
}

/**
 * abs, min, max and constrain in typed form.
 *
 * Arduino's abs/min/max are *macros*, so they evaluate their arguments twice:
 * `abs(x++)` increments twice and `min(analogRead(A0), 100)` reads the pin
 * twice. The typed C++ forms do not, so integer modes use them and only the
 * float mode keeps the historical macro output.
 */
function typedNumeric(
  id: string,
  label: string,
  description: string,
  icon: NodeDef['icon'],
  // Port ids are given explicitly and must match what the node had before the
  // mode was added: a saved graph stores its literals under those ids, and
  // renaming one silently drops the value it held.
  used: readonly (readonly [string, string])[],
  build: (mode: 'int' | 'long' | 'float', args: readonly string[]) => string,
): NodeDef {
  return {
    id,
    category: 'math',
    label,
    description,
    icon,
    kind: 'expression',
    config: [NUMERIC_FIELD],
    dynamic: {
      inputs: (config) => used.map(([portId, portLabel]) => numericIn(portId, portLabel, numericMode(config))),
      outputs: (config) => [numericOut(numericMode(config))],
    },
    inputs: used.map(([portId, portLabel]) => numIn(portId, portLabel)),
    outputs: [{ id: 'out', label: 'Result', type: 'float' }],
    summary: () => label.toLowerCase(),
    emit: (ctx) => {
      const mode = numericMode({ numericType: ctx.config('numericType') });
      return { expression: build(mode, used.map(([portId]) => ctx.input(portId))) };
    },
  };
}

export const mathNodes: readonly NodeDef[] = [
  {
    id: 'math.number',
    category: 'math',
    label: 'Number',
    description: 'A fixed whole number.',
    icon: Hash,
    kind: 'expression',
    inputs: [intIn('value', 'Value')],
    outputs: [{ id: 'out', label: 'Value', type: 'int' }],
    summary: (v) => String(v['value'] ?? 0),
    emit: (ctx) => ({ expression: ctx.input('value') }),
  },
  {
    id: 'math.float',
    category: 'math',
    label: 'Decimal',
    description: 'A fixed number with a decimal point.',
    icon: Sigma,
    kind: 'expression',
    inputs: [{ id: 'value', label: 'Value', type: 'float', literal: { kind: 'number', default: 0, step: 0.1 } }],
    outputs: [{ id: 'out', label: 'Value', type: 'float' }],
    summary: (v) => String(v['value'] ?? 0),
    emit: (ctx) => ({ expression: ctx.input('value') }),
  },
  {
    id: 'math.ternary',
    category: 'math',
    label: 'If Value',
    description: 'Picks one of two values depending on a condition.',
    icon: Divide,
    kind: 'expression',
    // Every port is `any`, deliberately: nothing crossing an `any` port is ever
    // cast, so this composes with int, long, float and String subtrees alike
    // without changing any of them. The real type is whatever is wired in.
    inputs: [
      { id: 'cond', label: 'If', type: 'bool', literal: { kind: 'boolean', default: true } },
      { id: 'then', label: 'Then', type: 'any', literal: { kind: 'number', default: 1 } },
      { id: 'else', label: 'Else', type: 'any', literal: { kind: 'number', default: 0 } },
    ],
    outputs: [{ id: 'out', label: 'Value', type: 'any' }],
    summary: () => 'if ? a : b',
    emit: (ctx) => ({
      expression: `(${ctx.input('cond')} ? ${ctx.input('then')} : ${ctx.input('else')})`,
    }),
  },
  binary('math.add', 'Add', 'Adds two numbers together.', Plus, '+'),
  binary('math.subtract', 'Subtract', 'Subtracts the second number from the first.', Minus, '-'),
  binary('math.multiply', 'Multiply', 'Multiplies two numbers.', X, '*'),
  binary('math.divide', 'Divide', 'Divides the first number by the second.', Divide, '/'),
  {
    id: 'math.modulo',
    config: [NUMERIC_FIELD_INT],
    category: 'math',
    label: 'Remainder',
    description: 'The remainder left after dividing one whole number by another.',
    icon: Percent,
    kind: 'expression',
    dynamic: {
      inputs: (config) => [
        numericIn('a', 'A', numericMode(config)),
        numericIn('b', 'B', numericMode(config), 1),
      ],
      outputs: (config) => [numericOut(numericMode(config), 'Remainder')],
    },
    inputs: [intIn('a', 'A'), intIn('b', 'B', 1)],
    outputs: [{ id: 'out', label: 'Remainder', type: 'int' }],
    summary: (v) => `${v['a'] ?? 0} % ${v['b'] ?? 1}`,
    emit: (ctx) => {
      const mode = numericMode({ numericType: ctx.config('numericType') });
      return { expression: `(${widen(mode, ctx.input('a'))} % ${ctx.input('b')})` };
    },
  },
  {
    id: 'math.power',
    config: [NUMERIC_FIELD],
    category: 'math',
    label: 'Power',
    description: 'Raises a number to a power.',
    icon: TrendingUp,
    kind: 'expression',
    inputs: [numIn('base', 'Base', 2), numIn('exponent', 'Exponent', 2)],
    outputs: [{ id: 'out', label: 'Result', type: 'float' }],
    summary: (v) => `${v['base'] ?? 0} ^ ${v['exponent'] ?? 0}`,
    emit: (ctx) => ({ expression: `pow(${ctx.input('base')}, ${ctx.input('exponent')})` }),
  },
  unaryCall('math.sqrt', 'Square Root', 'The square root of a number.', Radical, 'sqrt'),
  typedNumeric('math.abs', 'Absolute', 'Drops the minus sign from a number.', Ampersand, [['value', 'Value']], (mode, args) =>
    // The Arduino abs() macro evaluates its argument twice, so abs(x++)
    // increments twice. The integer modes use a form that does not.
    mode === 'float' ? `abs(${args[0]})` : `((${args[0]}) < 0 ? -(${args[0]}) : (${args[0]}))`,
  ),
  unaryCall('math.round', 'Round', 'Rounds to the nearest whole number.', Equal, 'round', 'int'),
  unaryCall('math.floor', 'Floor', 'Rounds down to a whole number.', Equal, 'floor', 'int'),
  unaryCall('math.ceil', 'Ceiling', 'Rounds up to a whole number.', Equal, 'ceil', 'int'),
  unaryCall('math.sin', 'Sine', 'Sine of an angle in radians.', Waves, 'sin'),
  unaryCall('math.cos', 'Cosine', 'Cosine of an angle in radians.', Waves, 'cos'),
  unaryCall('math.tan', 'Tangent', 'Tangent of an angle in radians.', Waves, 'tan'),
  typedNumeric('math.min', 'Minimum', 'The smaller of two numbers.', ArrowDown, [['a', 'A'], ['b', 'B']], (mode, args) =>
    mode === 'float' ? `min(${args[0]}, ${args[1]})` : `((${args[0]}) < (${args[1]}) ? (${args[0]}) : (${args[1]}))`,
  ),
  typedNumeric('math.max', 'Maximum', 'The larger of two numbers.', ArrowUp, [['a', 'A'], ['b', 'B']], (mode, args) =>
    mode === 'float' ? `max(${args[0]}, ${args[1]})` : `((${args[0]}) > (${args[1]}) ? (${args[0]}) : (${args[1]}))`,
  ),
  typedNumeric('math.constrain', 'Constrain', 'Clamps a number between a low and a high limit.', Ruler, [['value', 'Value'], ['low', 'Low'], ['high', 'High']], (mode, args) =>
    mode === 'float'
      ? `constrain(${args[0]}, ${args[1]}, ${args[2]})`
      : `((${args[0]}) < (${args[1]}) ? (${args[1]}) : ((${args[0]}) > (${args[2]}) ? (${args[2]}) : (${args[0]})))`,
  ),
  {
    id: 'math.map',
    category: 'math',
    label: 'Map Range',
    description: 'Rescales a number from one range to another. The workhorse for sensors.',
    icon: Ruler,
    kind: 'expression',
    inputs: [
      intIn('value', 'Value'),
      intIn('fromLow', 'From low', 0),
      intIn('fromHigh', 'From high', 1023),
      intIn('toLow', 'To low', 0),
      intIn('toHigh', 'To high', 255),
    ],
    outputs: [{ id: 'out', label: 'Mapped', type: 'int' }],
    summary: (v) => `${v['fromLow'] ?? 0}..${v['fromHigh'] ?? 0} -> ${v['toLow'] ?? 0}..${v['toHigh'] ?? 0}`,
    emit: (ctx) => ({
      expression: `map(${ctx.input('value')}, ${ctx.input('fromLow')}, ${ctx.input('fromHigh')}, ${ctx.input('toLow')}, ${ctx.input('toHigh')})`,
    }),
  },
  {
    id: 'math.random',
    category: 'math',
    label: 'Random',
    description: 'A random whole number from the low value up to (but not including) the high one.',
    icon: Dices,
    kind: 'expression',
    inputs: [intIn('low', 'Low', 0), intIn('high', 'High', 100)],
    outputs: [{ id: 'out', label: 'Value', type: 'int' }],
    summary: (v) => `random ${v['low'] ?? 0}..${v['high'] ?? 0}`,
    emit: (ctx) => ({ expression: `random(${ctx.input('low')}, ${ctx.input('high')})` }),
  },
  {
    id: 'math.randomSeed',
    category: 'math',
    label: 'Random Seed',
    description: 'Seeds the random generator so runs differ. Read a floating analog pin for noise.',
    icon: Shuffle,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [intIn('seed', 'Seed', 0)],
    summary: () => 'seed random',
    emit: (ctx) => ({ statements: `randomSeed(${ctx.input('seed')});` }),
  },
];
