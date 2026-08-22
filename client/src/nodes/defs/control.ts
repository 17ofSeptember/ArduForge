import {
  CornerDownLeft,
  GitBranch,
  Hourglass,
  ListOrdered,
  Repeat,
  RotateCw,
  SkipForward,
  StopCircle,
  Timer,
  ToggleRight,
  Workflow,
} from 'lucide-react';
import { stableSuffix } from '@/codegen/names';
import { sanitiseIdentifier } from '@/codegen/names';
import type { LiteralValue, NodeDef } from '@/nodes/types';

/** Splits a comma-separated config field into clean, unique names. */
export function parseNameList(raw: LiteralValue | undefined, fallback: string[]): string[] {
  if (typeof raw !== 'string') return fallback;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length === 0 ? fallback : [...new Set(parts)];
}

export const controlNodes: readonly NodeDef[] = [
  {
    id: 'control.delay',
    category: 'control',
    label: 'Delay',
    description: 'Stops everything for a number of milliseconds. Blocking.',
    icon: Timer,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'ms', label: 'Milliseconds', type: 'int', literal: { kind: 'number', default: 500, min: 0, integer: true } },
    ],
    summary: (v) => `wait ${v['ms'] ?? 0} ms`,
    emit: (ctx) => ({ statements: `delay(${ctx.input('ms')});` }),
  },
  {
    id: 'control.delayMicroseconds',
    category: 'control',
    label: 'Delay Microseconds',
    description: 'Stops everything for a number of microseconds. Blocking.',
    icon: Hourglass,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    inputs: [
      { id: 'us', label: 'Microseconds', type: 'int', literal: { kind: 'number', default: 100, min: 0, integer: true } },
    ],
    summary: (v) => `wait ${v['us'] ?? 0} µs`,
    emit: (ctx) => ({ statements: `delayMicroseconds(${ctx.input('us')});` }),
  },
  {
    id: 'control.if',
    category: 'control',
    label: 'If / Else',
    description: 'Runs one branch or the other depending on a condition.',
    icon: GitBranch,
    kind: 'statement',
    execIn: true,
    // `then` continues after the branches rejoin. Without it "do X, branch,
    // then do Y" can only be expressed by duplicating Y into both branches,
    // which is a maintenance trap on the canvas and diverges the moment
    // someone edits one copy. It is listed last so that generate.ts, which
    // continues along the first output emit did not consume, picks it.
    execOut: ['true', 'false', 'then'],
    inputs: [
      { id: 'condition', label: 'Condition', type: 'bool', literal: { kind: 'boolean', default: true } },
    ],
    summary: () => 'if condition',
    emit: (ctx) => ({
      statements: `if (${ctx.input('condition')}) {\n${ctx.branch('true')}\n} else {\n${ctx.branch('false')}\n}`,
    }),
  },
  {
    id: 'control.sequence',
    category: 'control',
    label: 'Sequence',
    description: 'Runs several chains one after another, in order.',
    icon: ListOrdered,
    kind: 'statement',
    execIn: true,
    config: [{ kind: 'number', id: 'steps', label: 'Steps', default: 2, min: 2, max: 8 }],
    dynamic: {
      execOut: (config) => {
        const raw = config['steps'];
        const count = typeof raw === 'number' ? Math.min(Math.max(Math.round(raw), 2), 8) : 2;
        return Array.from({ length: count }, (_, index) => `${index + 1}`);
      },
    },
    summary: (v) => `${v['steps'] ?? 2} steps`,
    emit: (ctx) => {
      const raw = ctx.config('steps');
      const count = typeof raw === 'number' ? Math.min(Math.max(Math.round(raw), 2), 8) : 2;
      const parts: string[] = [];
      for (let index = 1; index <= count; index += 1) {
        parts.push(`// step ${index}\n${ctx.branch(String(index))}`);
      }
      return { statements: parts.join('\n') };
    },
  },
  {
    id: 'control.for',
    category: 'control',
    label: 'For (count)',
    description: 'Repeats a chain a fixed number of times.',
    icon: Repeat,
    kind: 'statement',
    execIn: true,
    execOut: ['body', 'done'],
    inputs: [
      { id: 'count', label: 'Count', type: 'int', literal: { kind: 'number', default: 10, min: 0, integer: true } },
    ],
    // Blank means "generate one", which is what every existing graph gets and
    // what keeps their output byte-identical. A name is only needed when
    // something outside the node has to refer to the counter — importing a
    // hand-written `for (int i = ...)` being the case that forced this.
    config: [
      { kind: 'text', id: 'index', label: 'Index name', default: '', placeholder: 'auto' },
    ],
    outputs: [{ id: 'index', label: 'Index', type: 'int' }],
    summary: (v) => `repeat ${v['count'] ?? 0}x`,
    emit: (ctx) => {
      const chosen = String(ctx.config('index') ?? '').trim();
      const index = chosen === '' ? `_af_i_${stableSuffix(ctx.nodeId)}` : sanitiseIdentifier(chosen, 'i');
      return {
        statements: `for (int ${index} = 0; ${index} < ${ctx.input('count')}; ${index}++) {\n${ctx.branch('body')}\n}\n${ctx.branch('done')}`,
        expression: index,
      };
    },
  },
  {
    id: 'control.while',
    category: 'control',
    label: 'While',
    description: 'Repeats a chain for as long as a condition stays true.',
    icon: RotateCw,
    kind: 'statement',
    execIn: true,
    execOut: ['body', 'done'],
    inputs: [
      { id: 'condition', label: 'While', type: 'bool', literal: { kind: 'boolean', default: true } },
    ],
    summary: () => 'while condition',
    emit: (ctx) => ({
      statements: `while (${ctx.input('condition')}) {\n${ctx.branch('body')}\n}\n${ctx.branch('done')}`,
    }),
  },
  {
    id: 'control.doWhile',
    category: 'control',
    label: 'Do-While',
    description: 'Runs a chain once, then repeats it while a condition holds.',
    icon: RotateCw,
    kind: 'statement',
    execIn: true,
    execOut: ['body', 'done'],
    inputs: [
      { id: 'condition', label: 'While', type: 'bool', literal: { kind: 'boolean', default: true } },
    ],
    summary: () => 'do … while',
    emit: (ctx) => ({
      statements: `do {\n${ctx.branch('body')}\n} while (${ctx.input('condition')});\n${ctx.branch('done')}`,
    }),
  },
  {
    id: 'control.break',
    category: 'control',
    label: 'Break',
    description: 'Leaves the surrounding loop immediately.',
    icon: StopCircle,
    kind: 'statement',
    execIn: true,
    summary: () => 'break',
    emit: () => ({ statements: 'break;' }),
  },
  {
    id: 'control.continue',
    category: 'control',
    label: 'Continue',
    description: 'Skips to the next pass of the surrounding loop.',
    icon: SkipForward,
    kind: 'statement',
    execIn: true,
    summary: () => 'continue',
    emit: () => ({ statements: 'continue;' }),
  },
  {
    id: 'control.return',
    category: 'control',
    label: 'Return',
    description: 'Leaves the current function, optionally with a value.',
    icon: CornerDownLeft,
    kind: 'statement',
    execIn: true,
    inputs: [
      { id: 'value', label: 'Value', type: 'string', literal: { kind: 'string', default: '', placeholder: 'blank for none' } },
    ],
    summary: (v) => (String(v['value'] ?? '') === '' ? 'return' : `return ${String(v['value'])}`),
    emit: (ctx) => {
      const raw = ctx.input('value');
      // An empty text literal means a bare `return;` in a void function.
      return { statements: raw === '""' || raw === '' ? 'return;' : `return ${raw};` };
    },
  },
  {
    id: 'control.everyMs',
    category: 'control',
    label: 'Every N Milliseconds',
    description: 'Runs a chain on a repeating interval without blocking the rest of the program.',
    icon: Timer,
    kind: 'statement',
    execIn: true,
    // `after` runs on every pass, not just when the interval elapses, and is
    // listed second so generate.ts picks it as the output emit did not consume.
    // Without it a timer had to be the last thing in its chain, which is not how
    // loop() is usually written.
    execOut: ['then', 'after'],
    inputs: [
      { id: 'ms', label: 'Interval', type: 'int', literal: { kind: 'number', default: 500, min: 1, integer: true } },
    ],
    summary: (v) => `every ${v['ms'] ?? 0} ms`,
    emit: (ctx) => {
      // The non-blocking millis() pattern. This is the node that lets people
      // write real programs instead of delay() chains, so the generated form
      // has to be the idiomatic one a human would write by hand.
      const last = `_af_last_${stableSuffix(ctx.nodeId)}`;
      return {
        statements: [
          `static unsigned long ${last} = 0;`,
          `if (millis() - ${last} >= (unsigned long)(${ctx.input('ms')})) {`,
          `  ${last} = millis();`,
          ctx.branch('then'),
          `}`,
        ].join('\n'),
      };
    },
  },
  {
    id: 'control.debounce',
    category: 'control',
    label: 'Debounce',
    description: 'Passes a signal through only after it has been stable for a while.',
    icon: ToggleRight,
    kind: 'expression',
    inputs: [
      { id: 'signal', label: 'Signal', type: 'bool', literal: { kind: 'boolean', default: false } },
      { id: 'ms', label: 'Settle (ms)', type: 'int', literal: { kind: 'number', default: 50, min: 1, integer: true } },
    ],
    outputs: [{ id: 'out', label: 'Stable', type: 'bool' }],
    summary: (v) => `debounce ${v['ms'] ?? 50} ms`,
    collect: (ctx) => {
      const suffix = ctx.slug;
      return {
        functions: [
          {
            signature: `bool _af_debounce_${suffix}(bool raw, unsigned long settleMs)`,
            body: [
              `static bool stable = false;`,
              `static bool last = false;`,
              `static unsigned long changedAt = 0;`,
              ``,
              `if (raw != last) {`,
              `  last = raw;`,
              `  changedAt = millis();`,
              `}`,
              `if (millis() - changedAt >= settleMs) {`,
              `  stable = raw;`,
              `}`,
              `return stable;`,
            ].join('\n'),
          },
        ],
      };
    },
    emit: (ctx) => ({
      expression: `_af_debounce_${stableSuffix(ctx.nodeId)}(${ctx.input('signal')}, ${ctx.input('ms')})`,
    }),
  },
  {
    id: 'control.stateMachine',
    category: 'control',
    label: 'State Machine',
    description: 'Runs one branch per state. Use Go To State to move between them.',
    icon: Workflow,
    kind: 'statement',
    execIn: true,
    config: [
      { kind: 'text', id: 'name', label: 'Machine name', default: 'mode', placeholder: 'mode' },
      { kind: 'text', id: 'states', label: 'States (comma separated)', default: 'Idle, Running', placeholder: 'Idle, Running' },
    ],
    dynamic: {
      execOut: (config) => parseNameList(config['states'], ['Idle', 'Running']),
    },
    summary: (v) => `${String(v['name'] ?? 'mode')}: ${parseNameList(v['states'], []).length} states`,
    collect: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'mode'), 'mode');
      const states = parseNameList(ctx.config('states'), ['Idle', 'Running']);
      return {
        globals: [
          `// State machine "${name}": ${states.join(', ')}`,
          ...states.map((state, index) => `#define ${name.toUpperCase()}_${sanitiseIdentifier(state).toUpperCase()} ${index}`),
          `uint8_t ${name} = 0;`,
        ],
      };
    },
    emit: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'mode'), 'mode');
      const states = parseNameList(ctx.config('states'), ['Idle', 'Running']);
      const cases = states
        .map(
          (state, index) =>
            `  case ${index}: // ${state}\n${ctx.branch(state)}\n    break;`,
        )
        .join('\n');
      return { statements: `switch (${name}) {\n${cases}\n}` };
    },
  },
  {
    id: 'control.goToState',
    category: 'control',
    label: 'Go To State',
    description: 'Moves a state machine into a different state.',
    icon: GitBranch,
    kind: 'statement',
    execIn: true,
    execOut: ['then'],
    config: [
      { kind: 'text', id: 'name', label: 'Machine name', default: 'mode', placeholder: 'mode' },
      { kind: 'text', id: 'state', label: 'State', default: 'Idle', placeholder: 'Idle' },
    ],
    summary: (v) => `${String(v['name'] ?? 'mode')} -> ${String(v['state'] ?? '')}`,
    emit: (ctx) => {
      const name = sanitiseIdentifier(String(ctx.config('name') || 'mode'), 'mode');
      const state = sanitiseIdentifier(String(ctx.config('state') || 'Idle'), 'Idle');
      return { statements: `${name} = ${name.toUpperCase()}_${state.toUpperCase()};` };
    },
  },
];
