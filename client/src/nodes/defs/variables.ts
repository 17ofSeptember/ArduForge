import { Box, Braces, Minus, Plus, Tag } from 'lucide-react';
import { sanitiseIdentifier } from '@/codegen/names';
import type { LiteralValue, NodeDef, PortType } from '@/nodes/types';

const VAR_TYPES = [
  { value: 'int', label: 'whole number' },
  { value: 'float', label: 'decimal' },
  { value: 'bool', label: 'true / false' },
  { value: 'String', label: 'text' },
] as const;

/**
 * Where a declared variable lives.
 *
 * `static-local` exists as its own option rather than as a checkbox on `local`
 * because the two differ in lifetime, not in placement: a static keeps its
 * value between runs of the chain, which is exactly what a counter or a
 * last-seen timestamp needs and exactly what a plain local cannot do.
 */
const VAR_SCOPES = [
  { value: 'local', label: 'local to this chain' },
  { value: 'static-local', label: 'local, keeps its value' },
  { value: 'global', label: 'global' },
] as const;

/** The port type a declared variable exposes, from its C++ type. */
function portTypeFor(cppType: LiteralValue): PortType {
  switch (String(cppType)) {
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'String':
      return 'string';
    default:
      return 'int';
  }
}

/**
 * The initial value, as C++.
 *
 * This used to run every value through `Number()`, which quietly destroyed
 * anything that was not a plain decimal: `0x1A` became `26`, `0.05f` became
 * `0.0f`, and a reference to another constant became `0`. That made Declare
 * Variable the one node in the registry that did not follow the rule
 * `literalToCpp` applies everywhere else — a value on a typed port is source
 * text, and the port's type decides only how a *bare number* is formatted.
 *
 * Bare decimals are still formatted for their type, which is what keeps every
 * existing project generating byte-identical output: a float initialised to
 * `0.05` must still come out as `0.05f`. Everything else is passed through
 * exactly as written.
 */
function initialiserFor(cppType: string, raw: LiteralValue | null): string {
  const text = raw === null ? '' : String(raw).trim();

  if (cppType === 'String') {
    if (text === '') return '""';
    // Already a quoted literal: leave it, escapes and all.
    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return text;
    return JSON.stringify(text);
  }

  if (cppType === 'bool') {
    if (text === '' || text === '0') return 'false';
    if (text === '1') return 'true';
    // true, false, HIGH, LOW, or a named constant — all pass through.
    return text;
  }

  if (text === '') return cppType === 'float' ? '0.0f' : '0';

  // A bare decimal is the only thing reformatted, because that is the only
  // thing whose notation carries no information the user chose.
  if (/^-?\d+$/.test(text)) {
    return cppType === 'float' ? `${Number(text)}.0f` : text;
  }
  if (cppType === 'float' && /^-?\d*\.\d+$/.test(text)) return `${text}f`;

  return text;
}

export const variableNodes: readonly NodeDef[] = [
  {
    id: 'var.declare',
    category: 'variables',
    label: 'Declare Variable',
    description: 'Creates a named value the whole program can read and change.',
    icon: Tag,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myValue', placeholder: 'speed' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
      { kind: 'text', id: 'initial', label: 'Starting value', default: '0', placeholder: '0' },
      // A new node defaults to `local`, because most variables are working
      // values inside one chain and a global costs SRAM for the whole run — on
      // a 2KB Uno that is a real budget. Projects saved before this field
      // existed are migrated to `global` instead, which is what they were, so
      // their output does not move. The two defaults differ deliberately.
      { kind: 'select', id: 'scope', label: 'Scope', default: 'local', options: VAR_SCOPES },
      {
        kind: 'checkbox',
        id: 'expose',
        label: 'Expose to Dashboard',
        default: false,
      },
    ],
    dynamic: {
      // Optional: unconnected, the config field supplies the value, which is
      // what every existing project does. Connected, the wired expression is
      // the initializer — which is what Phase 3 produces.
      inputs: (config) => [
        { id: 'value', label: 'Initial value', type: portTypeFor(config['type'] ?? 'int'), optional: true },
      ],
    },
    summary: (v) => `${String(v['type'] ?? 'int')} ${String(v['name'] ?? 'myValue')}`,
    collect: (ctx) => {
      // Only a global reaches the top of the file. A local — plain or static —
      // is emitted as a statement where the node sits in the chain, so that its
      // lifetime and its position in the source both match what the graph says.
      if (String(ctx.config('scope') ?? 'local') !== 'global') return {};
      const name = sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue');
      const cppType = String(ctx.config('type') ?? 'int');
      // A wired initializer cannot be resolved at collect time — expressions are
      // emitted later — so a global with one is declared uninitialised here and
      // assigned in the chain instead. That keeps global initialisation order
      // well defined rather than depending on when the expression can be read.
      if (ctx.connected('value')) return { globals: [`${cppType} ${name};`] };
      const initial = initialiserFor(cppType, ctx.config('initial'));
      // The exposed flag is what Phase 6 reads to build the AwryLink table.
      return { globals: [`${cppType} ${name} = ${initial};`] };
    },
    emit: (ctx) => {
      const scope = String(ctx.config('scope') ?? 'local');
      const name = sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue');
      const cppType = String(ctx.config('type') ?? 'int');
      const wired = ctx.connected('value');

      if (scope === 'global') {
        // Declared above; only a wired initializer needs a statement.
        return { statements: wired ? `${name} = ${ctx.input('value')};` : '' };
      }

      const initial = wired ? ctx.input('value') : initialiserFor(cppType, ctx.config('initial'));
      const prefix = scope === 'static-local' ? 'static ' : '';
      return { statements: `${prefix}${cppType} ${name} = ${initial};` };
    },
  },
  {
    id: 'var.get',
    category: 'variables',
    label: 'Get Variable',
    description: 'Reads the current value of a variable.',
    icon: Box,
    kind: 'expression',
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myValue', placeholder: 'speed' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
    ],
    dynamic: {
      outputs: (config) => [{ id: 'out', label: 'Value', type: portTypeFor(config['type'] ?? 'int') }],
    },
    summary: (v) => String(v['name'] ?? 'myValue'),
    emit: (ctx) => ({
      expression: sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue'),
    }),
  },
  {
    id: 'var.set',
    category: 'variables',
    label: 'Set Variable',
    description: 'Stores a new value into a variable.',
    icon: Tag,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'myValue', placeholder: 'speed' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
    ],
    dynamic: {
      inputs: (config) => {
        const type = portTypeFor(config['type'] ?? 'int');
        return [
          {
            id: 'value',
            label: 'Value',
            type,
            literal:
              type === 'bool'
                ? { kind: 'boolean', default: false }
                : type === 'string'
                  ? { kind: 'string', default: '' }
                  : { kind: 'number', default: 0, integer: type === 'int' },
          },
        ];
      },
    },
    summary: (v) => `${String(v['name'] ?? 'myValue')} = ${String(v['value'] ?? '')}`,
    emit: (ctx) => ({
      statements: `${sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue')} = ${ctx.input('value')};`,
    }),
  },
  {
    id: 'var.increment',
    category: 'variables',
    label: 'Increment',
    description: 'Adds to a variable in place.',
    icon: Plus,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [{ kind: 'text', id: 'name', label: 'Name', default: 'myValue', placeholder: 'count' }],
    inputs: [{ id: 'by', label: 'By', type: 'float', literal: { kind: 'number', default: 1 } }],
    summary: (v) => `${String(v['name'] ?? 'myValue')} += ${v['by'] ?? 1}`,
    emit: (ctx) => ({
      statements: `${sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue')} += ${ctx.input('by')};`,
    }),
  },
  {
    id: 'var.decrement',
    category: 'variables',
    label: 'Decrement',
    description: 'Subtracts from a variable in place.',
    icon: Minus,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [{ kind: 'text', id: 'name', label: 'Name', default: 'myValue', placeholder: 'count' }],
    inputs: [{ id: 'by', label: 'By', type: 'float', literal: { kind: 'number', default: 1 } }],
    summary: (v) => `${String(v['name'] ?? 'myValue')} -= ${v['by'] ?? 1}`,
    emit: (ctx) => ({
      statements: `${sanitiseIdentifier(String(ctx.config('name') || 'myValue'), 'myValue')} -= ${ctx.input('by')};`,
    }),
  },
  {
    id: 'var.arrayDeclare',
    category: 'variables',
    label: 'Declare Array',
    description: 'Creates a fixed-size list of values.',
    icon: Braces,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'values', placeholder: 'values' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
      { kind: 'number', id: 'size', label: 'Size', default: 8, min: 1, max: 256 },
    ],
    summary: (v) => `${String(v['name'] ?? 'values')}[${v['size'] ?? 8}]`,
    collect: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'values'), 'values');
      const cppType = String(ctx.config('type') ?? 'int');
      const rawSize = ctx.config('size');
      const size = typeof rawSize === 'number' ? Math.max(1, Math.round(rawSize)) : 8;
      return { globals: [`${cppType} ${name}[${size}];`] };
    },
    emit: () => ({ statements: '' }),
  },
  {
    id: 'var.arrayGet',
    category: 'variables',
    label: 'Array Get',
    description: 'Reads one item out of an array.',
    icon: Braces,
    kind: 'expression',
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'values', placeholder: 'values' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
    ],
    inputs: [{ id: 'index', label: 'Index', type: 'int', literal: { kind: 'number', default: 0, integer: true } }],
    dynamic: {
      outputs: (config) => [{ id: 'out', label: 'Value', type: portTypeFor(config['type'] ?? 'int') }],
    },
    summary: (v) => `${String(v['name'] ?? 'values')}[${v['index'] ?? 0}]`,
    emit: (ctx) => ({
      expression: `${sanitiseIdentifier(String(ctx.config('name') || 'values'), 'values')}[${ctx.input('index')}]`,
    }),
  },
  {
    id: 'var.arraySet',
    category: 'variables',
    label: 'Array Set',
    description: 'Stores a value into one slot of an array.',
    icon: Braces,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Name', default: 'values', placeholder: 'values' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: VAR_TYPES },
    ],
    dynamic: {
      inputs: (config) => {
        const type = portTypeFor(config['type'] ?? 'int');
        return [
          { id: 'index', label: 'Index', type: 'int', literal: { kind: 'number', default: 0, integer: true } },
          {
            id: 'value',
            label: 'Value',
            type,
            literal:
              type === 'bool'
                ? { kind: 'boolean', default: false }
                : type === 'string'
                  ? { kind: 'string', default: '' }
                  : { kind: 'number', default: 0, integer: type === 'int' },
          },
        ];
      },
    },
    summary: (v) => `${String(v['name'] ?? 'values')}[${v['index'] ?? 0}] =`,
    emit: (ctx) => ({
      statements: `${sanitiseIdentifier(String(ctx.config('name') || 'values'), 'values')}[${ctx.input('index')}] = ${ctx.input('value')};`,
    }),
  },
  {
    id: 'var.arrayLength',
    category: 'variables',
    label: 'Array Length',
    description: 'How many slots an array has.',
    icon: Braces,
    kind: 'expression',
    config: [{ kind: 'text', id: 'name', label: 'Name', default: 'values', placeholder: 'values' }],
    outputs: [{ id: 'out', label: 'Length', type: 'int' }],
    summary: (v) => `length of ${String(v['name'] ?? 'values')}`,
    emit: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'values'), 'values');
      return { expression: `(int)(sizeof(${name}) / sizeof(${name}[0]))` };
    },
  },
];
