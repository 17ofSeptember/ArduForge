/**
 * Custom C++ escape hatches (BUILD_PLAN.md §Phase 5k).
 *
 * These exist so the tool never becomes a dead end: anything the node library
 * cannot express can still be written by hand and dropped into the graph.
 * Their contents are inserted verbatim and are the user's responsibility.
 */
import { Braces, Code2, SquareCode } from 'lucide-react';
import type { NodeDef, PortType } from '@/nodes/types';

const RETURN_TYPES = [
  { value: 'int', label: 'whole number' },
  { value: 'float', label: 'decimal' },
  { value: 'bool', label: 'true / false' },
  { value: 'String', label: 'text' },
] as const;

function portTypeFor(raw: unknown): PortType {
  switch (String(raw)) {
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

export const customNodes: readonly NodeDef[] = [
  {
    id: 'custom.statement',
    category: 'custom',
    label: 'Raw Statement',
    description: 'Inserts C++ statements exactly as written, inside the current chain.',
    icon: Code2,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      {
        kind: 'text',
        id: 'code',
        label: 'C++',
        default: '// your code here',
        placeholder: 'Serial.println("hi");',
      },
    ],
    summary: (v) => String(v['code'] ?? '').slice(0, 28),
    emit: (ctx) => ({ statements: String(ctx.config('code') ?? '') }),
  },
  {
    id: 'custom.expression',
    category: 'custom',
    label: 'Raw Expression',
    description: 'A C++ expression you write yourself, with a type you choose.',
    icon: SquareCode,
    kind: 'expression',
    config: [
      { kind: 'text', id: 'code', label: 'C++', default: '0', placeholder: 'analogRead(A0) * 2' },
      { kind: 'select', id: 'type', label: 'Type', default: 'int', options: RETURN_TYPES },
    ],
    dynamic: {
      outputs: (config) => [{ id: 'out', label: 'Value', type: portTypeFor(config['type']) }],
    },
    summary: (v) => String(v['code'] ?? '').slice(0, 28),
    emit: (ctx) => {
      const code = String(ctx.config('code') ?? '').trim();
      // Parenthesised so it composes safely inside a larger expression.
      return { expression: code === '' ? '0' : `(${code})` };
    },
  },
  {
    id: 'custom.global',
    category: 'custom',
    label: 'Raw Global',
    description: 'Top-level C++: functions, structs, #defines. Emitted above setup().',
    icon: Braces,
    // An entry, not an expression: it produces no value and belongs to no exec
    // chain. It contributes declarations and nothing else.
    kind: 'entry',
    config: [
      {
        kind: 'text',
        id: 'code',
        label: 'C++',
        default: '#define MY_CONSTANT 42',
        placeholder: '#define PIN_LED 13',
      },
    ],
    summary: (v) => String(v['code'] ?? '').slice(0, 28),
    collect: (ctx) => {
      const code = String(ctx.config('code') ?? '').trim();
      return code === '' ? {} : { globals: [code] };
    },
    // Contributes only globals; it has no value and no statements of its own.
    emit: () => ({ expression: '0' }),
  },
];
