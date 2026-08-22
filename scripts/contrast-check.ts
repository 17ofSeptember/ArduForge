/**
 * Contrast gate (THEME.md Phase 1).
 *
 * Parses client/src/styles/tokens.css and computes the WCAG 2.1 ratio for every
 * foreground/background pairing the app actually renders, in both themes. Fails
 * the build on any pair below 4.5:1 for body text or 3:1 for UI components and
 * large text.
 *
 * This reads the token file rather than re-deriving colours, so it catches a
 * hand-edited hex — which is the failure mode it exists to prevent. Every
 * pairing below cites the source location that produces it; if a pairing has no
 * `where`, it does not belong here.
 *
 * Run: npm run contrast
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HERE, '../client/src/styles/tokens.css');

// ── colour ───────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function parseColor(value: string): Rgb | null {
  const text = value.trim();

  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
  if (hex !== null) {
    const body = hex[1] as string;
    const full =
      body.length === 3
        ? body
            .split('')
            .map((c) => c + c)
            .join('')
        : body;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as unknown as Rgb;
  }

  // rgb(4 15 22 / 0.70) — the scrim form. Alpha is handled by `composite`, so
  // the bare channels are what we return here.
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:\/\s*[\d.]+\s*)?\)$/.exec(text);
  if (rgb !== null) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255] as const;
  }

  return null;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over compositing, for the `text-black/90`-style utilities. */
function composite(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => (fg[i] as number) * alpha + (bg[i] as number) * (1 - alpha)) as unknown as Rgb;
}

const BLACK: Rgb = [0, 0, 0];

// ── token parsing ────────────────────────────────────────────────────────────

type Tokens = ReadonlyMap<string, string>;

/**
 * Pulls the declarations out of one top-level rule. Written against the shape
 * this file is generated in — a flat block of `--name: value;` — rather than as
 * a general CSS parser.
 */
function readBlock(css: string, selector: string, skip = 0): Map<string, string> {
  let index = -1;
  for (let n = 0; n <= skip; n += 1) {
    index = css.indexOf(selector, index + 1);
    if (index === -1) throw new Error(`tokens.css: block not found: ${selector} (#${skip})`);
  }
  const open = css.indexOf('{', index);
  const close = css.indexOf('\n}', open);
  if (open === -1 || close === -1) throw new Error(`tokens.css: unterminated block: ${selector}`);

  const out = new Map<string, string>();
  for (const line of css.slice(open + 1, close).split('\n')) {
    const declaration = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
    if (declaration !== null) out.set(declaration[1] as string, (declaration[2] as string).trim());
  }
  return out;
}

function loadThemes(): { light: Tokens; dark: Tokens } {
  const css = readFileSync(TOKENS, 'utf8');

  // Block 0 is the theme-independent ramps; block 1 is the light scheme.
  const ramps = readBlock(css, '\n:root {', 0);
  const light = readBlock(css, '\n:root {', 1);
  const dark = readBlock(css, "\n:root[data-theme='dark'] {");

  if (!ramps.has('--ramp-cyan-400')) throw new Error('tokens.css: ramp block did not parse');
  if (light.get('--color-scheme') === undefined && !light.has('--bg-app')) {
    throw new Error('tokens.css: light scheme block did not parse');
  }
  if (!dark.has('--bg-app')) throw new Error('tokens.css: dark scheme block did not parse');

  return {
    light: new Map([...ramps, ...light]),
    dark: new Map([...ramps, ...dark]),
  };
}

function colorOf(tokens: Tokens, name: string): Rgb {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`unknown token: ${name}`);
  const parsed = parseColor(value);
  if (parsed === null) throw new Error(`token ${name} is not a colour: ${value}`);
  return parsed;
}

// ── the pairings the app actually renders ────────────────────────────────────

/** 4.5:1 — body text. 3:1 — UI components, icons, borders, large text. */
type Bar = 4.5 | 3;

interface Pair {
  readonly group: string;
  readonly fg: string;
  readonly bg: string;
  /** Foreground alpha, for the `text-black/NN` utilities. */
  readonly alpha?: number;
  readonly bar: Bar;
  readonly where: string;
  /** Restrict to one theme where the pairing only exists there. */
  readonly only?: 'light' | 'dark';
}

const SURFACES = [
  '--bg-app',
  '--bg-panel',
  '--bg-card',
  '--bg-header',
  '--bg-input',
  '--bg-popover',
  '--bg-modal',
] as const;

const CATEGORIES = [
  'events',
  'io',
  'control',
  'math',
  'logic',
  'variables',
  'time',
  'serial',
  'components',
  'custom',
] as const;

const PORTS = ['exec', 'bool', 'int', 'float', 'string', 'pin', 'any'] as const;

const SYNTAX = [
  'keyword',
  'type',
  'string',
  'number',
  'function',
  'preprocessor',
  'operator',
  'punctuation',
  'comment',
  'error',
] as const;

const CONNECTION = ['idle', 'connecting', 'connected', 'streaming', 'stale', 'error'] as const;

const FEEDBACK = ['success', 'warning', 'info', 'destructive'] as const;

function buildPairs(): Pair[] {
  const pairs: Pair[] = [];

  // Body text on every elevation level. The whole point of checking all seven
  // is that a token tuned against the app background quietly fails on popovers.
  for (const fg of ['--text-primary', '--text-secondary', '--text-muted', '--text-link']) {
    for (const bg of SURFACES) {
      pairs.push({ group: 'text', fg, bg, bar: 4.5, where: 'ui/primitives.tsx, App.tsx, panels' });
    }
  }

  // Inverse text on structural chrome (toolbar, sidebar).
  pairs.push({
    group: 'text',
    fg: '--text-on-structural',
    bg: '--bg-structural',
    bar: 4.5,
    where: 'App.tsx toolbar',
  });

  // Filled controls.
  for (const bg of ['--bg-interactive', '--bg-interactive-hover', '--bg-interactive-active']) {
    pairs.push({
      group: 'fill',
      fg: '--text-on-interactive',
      bg,
      bar: 4.5,
      where: 'ui/primitives.tsx:67 Button variant=primary',
    });
  }
  for (const bg of ['--bg-destructive', '--bg-destructive-hover']) {
    pairs.push({
      group: 'fill',
      fg: '--text-on-destructive',
      bg,
      bar: 4.5,
      where: 'ui/primitives.tsx:68 Button variant=danger',
    });
  }

  // Feedback text: toasts, inline errors, the build panel's diagnostic rows.
  for (const name of FEEDBACK) {
    for (const bg of ['--bg-app', '--bg-panel', '--bg-card']) {
      pairs.push({
        group: 'feedback',
        fg: `--feedback-${name}`,
        bg,
        bar: 4.5,
        where: 'ui/Toasts.tsx:4-8, build/BuildPanel.tsx, canvas/ProblemsPanel.tsx',
      });
    }
  }

  // Node header labels. The header is filled with the category hue and carries
  // dark text at 70-90% alpha — the alpha is the reason this needs compositing
  // rather than a plain black-on-hue check.
  for (const name of CATEGORIES) {
    pairs.push({
      group: 'node-header',
      fg: '--text-on-semantic',
      bg: `--cat-${name}`,
      alpha: 0.9,
      bar: 4.5,
      where: 'canvas/NodeView.tsx:116 label (text-on-semantic/90)',
    });
    pairs.push({
      group: 'node-header',
      fg: '--text-on-semantic',
      bg: `--cat-${name}`,
      alpha: 0.8,
      bar: 3,
      where: 'canvas/NodeView.tsx:115,120 icons (text-on-semantic/80)',
    });
    pairs.push({
      group: 'node-header',
      fg: '--text-on-semantic',
      bg: `--cat-${name}`,
      alpha: 0.7,
      bar: 3,
      where: 'canvas/NodeView.tsx:126 collapse chevron (text-on-semantic/70)',
    });
    // The header sits on the node body, which sits on the canvas.
    pairs.push({
      group: 'node-header',
      fg: `--cat-${name}`,
      bg: '--bg-card',
      bar: 3,
      where: 'canvas/NodeView.tsx:108-113 header vs node body',
    });
  }

  // Port colours are edge strokes and handles on the canvas: UI components.
  for (const name of PORTS) {
    pairs.push({
      group: 'port',
      fg: `--port-${name}`,
      bg: '--bg-app',
      bar: 3,
      where: 'canvas/ForgeEdgeView.tsx:37 edge stroke on canvas',
    });
    pairs.push({
      group: 'port',
      fg: `--port-${name}`,
      bg: '--bg-card',
      bar: 3,
      where: 'canvas/NodeView.tsx:169,202 handle on node body',
    });
  }

  // Syntax runs on the code panel, which is a panel-level surface.
  for (const name of SYNTAX) {
    pairs.push({
      group: 'syntax',
      fg: `--syntax-${name}`,
      bg: '--bg-panel',
      bar: 4.5,
      where: 'codegen/CodePanel.tsx:40-47 HighlightStyle',
    });
  }

  // Connection status: the dot is a UI component, the adjacent label is text.
  for (const name of CONNECTION) {
    pairs.push({
      group: 'connection',
      fg: `--conn-${name}`,
      bg: '--bg-panel',
      bar: 3,
      where: 'ui/primitives.tsx:12 StatusDot on the status bar',
    });
  }
  pairs.push({
    group: 'connection',
    fg: '--conn-stale',
    bg: '--bg-panel',
    bar: 4.5,
    where: 'ui/StatusBar.tsx:63 "stale" label text',
  });

  // Live pin state. The label sits ON the chip, so the chip is the background —
  // this pairing is what the /__theme page caught as failing at 4.11:1 while
  // the gate was silent, because pin tokens were not listed here at all.
  pairs.push({
    group: 'pin',
    fg: '--text-on-semantic',
    bg: '--pin-high',
    bar: 4.5,
    where: 'dashboard/PinInspector.tsx:136 HIGH chip label',
  });
  pairs.push({
    group: 'pin',
    fg: '--text-secondary',
    bg: '--pin-low',
    bar: 4.5,
    where: 'dashboard/PinInspector.tsx:136 LOW chip label',
  });
  for (const bg of ['--bg-card', '--bg-panel']) {
    pairs.push({
      group: 'pin',
      fg: '--pin-high',
      bg,
      bar: 3,
      where: 'dashboard/PinInspector.tsx:136 chip against the pin table',
    });
  }

  // Chart series against their plot ground and against the gridlines.
  for (const index of [1, 2, 3, 4]) {
    pairs.push({
      group: 'chart',
      fg: `--chart-series-${index}`,
      bg: '--bg-panel',
      bar: 3,
      where: 'dashboard/widgets/Chart.tsx:76-79 series stroke',
    });
    pairs.push({
      group: 'chart',
      fg: `--chart-series-${index}`,
      bg: '--chart-grid',
      bar: 3,
      where: 'dashboard/widgets/Chart.tsx:69-70 series vs gridline',
    });
  }
  pairs.push({
    group: 'chart',
    fg: '--chart-axis',
    bg: '--bg-panel',
    bar: 4.5,
    where: 'dashboard/widgets/Chart.tsx:69-70 axis labels',
  });

  // Focus must survive on every surface — this is where rings get lost.
  for (const bg of SURFACES) {
    pairs.push({
      group: 'focus',
      fg: '--focus-ring',
      bg,
      bar: 3,
      where: 'Phase 3 form controls, all elevation levels',
    });
  }

  // Borders that carry an affordance boundary rather than decoration.
  for (const bg of ['--bg-card', '--bg-panel', '--bg-input']) {
    pairs.push({
      group: 'border',
      fg: '--border-strong',
      bg,
      bar: 3,
      where: 'ui/primitives.tsx Select/Button outline',
    });
  }
  pairs.push({
    group: 'border',
    fg: '--border-selected',
    bg: '--bg-card',
    bar: 3,
    where: 'canvas selection ring, dashboard/Dashboard.tsx:60',
  });

  return pairs;
}

// ── separation checks (not WCAG — BUILD_PLAN §3.7) ───────────────────────────

interface Separation {
  readonly a: string;
  readonly b: string;
  readonly min: number;
  readonly why: string;
}

const SEPARATIONS: readonly Separation[] = [
  {
    a: '--conn-stale',
    b: '--conn-connected',
    min: 1.5,
    why: '§3.7 — a frozen value must never be mistaken for a live one',
  },
  {
    a: '--conn-connected',
    b: '--conn-streaming',
    min: 1.2,
    why: 'streaming must be distinguishable from merely connected',
  },
  { a: '--chart-series-1', b: '--chart-series-2', min: 1.2, why: 'greyscale separation' },
  { a: '--chart-series-1', b: '--chart-series-3', min: 1.2, why: 'greyscale separation' },
  { a: '--chart-series-1', b: '--chart-series-4', min: 1.2, why: 'greyscale separation' },
  { a: '--chart-series-2', b: '--chart-series-3', min: 1.2, why: 'greyscale separation' },
  { a: '--chart-series-2', b: '--chart-series-4', min: 1.2, why: 'greyscale separation' },
  { a: '--chart-series-3', b: '--chart-series-4', min: 1.2, why: 'greyscale separation' },
];

// ── run ──────────────────────────────────────────────────────────────────────

interface Failure {
  readonly theme: string;
  readonly label: string;
  readonly got: number;
  readonly want: number;
  readonly where: string;
}

const round = (n: number): string => n.toFixed(2);

function main(): void {
  const themes = loadThemes();
  const pairs = buildPairs();
  const failures: Failure[] = [];
  let checked = 0;

  for (const [themeName, tokens] of Object.entries(themes)) {
    const groups = new Map<string, string[]>();

    for (const pair of pairs) {
      if (pair.only !== undefined && pair.only !== themeName) continue;

      const bg = colorOf(tokens, pair.bg);
      const base = pair.fg === 'black' ? BLACK : colorOf(tokens, pair.fg);
      const fg = pair.alpha === undefined ? base : composite(base, bg, pair.alpha);
      const ratio = contrast(fg, bg);
      const ok = ratio >= pair.bar;
      checked += 1;

      const alphaSuffix = pair.alpha === undefined ? '' : `/${Math.round(pair.alpha * 100)}`;
      const label = `${pair.fg}${alphaSuffix} on ${pair.bg}`;

      if (!ok) {
        failures.push({ theme: themeName, label, got: ratio, want: pair.bar, where: pair.where });
      }

      const line = `  ${ok ? 'PASS' : 'FAIL'}  ${round(ratio).padStart(6)}:1  (need ${pair.bar}:1)  ${label}`;
      const existing = groups.get(pair.group);
      if (existing === undefined) groups.set(pair.group, [line]);
      else existing.push(line);
    }

    console.log(`\n━━ ${themeName.toUpperCase()} ━━`);
    for (const [group, lines] of groups) {
      const bad = lines.filter((l) => l.includes('FAIL')).length;
      console.log(`\n${group}  (${lines.length} pairs${bad > 0 ? `, ${bad} failing` : ''})`);
      for (const line of lines) if (bad > 0 || process.env['VERBOSE'] === '1') console.log(line);
      if (bad === 0 && process.env['VERBOSE'] !== '1') {
        const ratios = lines.map((l) => Number(/(\d+\.\d+):1/.exec(l)?.[1] ?? 0));
        console.log(`  all pass — worst ${round(Math.min(...ratios))}:1`);
      }
    }

    console.log('\nseparation');
    for (const sep of SEPARATIONS) {
      const ratio = contrast(colorOf(tokens, sep.a), colorOf(tokens, sep.b));
      const ok = ratio >= sep.min;
      checked += 1;
      if (!ok) {
        failures.push({
          theme: themeName,
          label: `${sep.a} vs ${sep.b}`,
          got: ratio,
          want: sep.min,
          where: sep.why,
        });
      }
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  ${round(ratio).padStart(6)}:1  (need ${sep.min}:1)  ${sep.a} vs ${sep.b}`,
      );
    }
  }

  // Greyscale ladder (THEME.md Phase 6.2). Desaturating collapses hue, so this
  // is what a viewer with a colour vision deficiency is left with. Ten
  // categories cannot all clear a comfortable margin — the arithmetic ceiling
  // across the usable band is ~1.11x per step — so this is a regression guard
  // at the documented floor, not an aspiration. Below it, something got worse.
  const GREYSCALE_FLOOR = 1.015;
  for (const [themeName, tokens] of Object.entries(themes)) {
    const ladder = CATEGORIES.map((name) => ({
      name,
      y: luminance(colorOf(tokens, `--cat-${name}`)),
    })).sort((a, b) => a.y - b.y);

    console.log(`\n${themeName} — node category greyscale ladder`);
    let worst = Infinity;
    for (let i = 1; i < ladder.length; i += 1) {
      const previous = ladder[i - 1] as { name: string; y: number };
      const current = ladder[i] as { name: string; y: number };
      const step = (current.y + 0.05) / (previous.y + 0.05);
      worst = Math.min(worst, step);
      checked += 1;
      if (step < GREYSCALE_FLOOR) {
        failures.push({
          theme: themeName,
          label: `greyscale ${previous.name} -> ${current.name}`,
          got: step,
          want: GREYSCALE_FLOOR,
          where: 'THEME.md Phase 6.2 desaturation test',
        });
      }
      const flag = step < 1.1 ? '  (relies on the node icon)' : '';
      console.log(`  ${previous.name.padEnd(11)} -> ${current.name.padEnd(11)} ${step.toFixed(3)}x${flag}`);
    }
    console.log(`  worst adjacent step: ${worst.toFixed(3)}x  (floor ${GREYSCALE_FLOOR})`);
  }

  console.log(`\n${'─'.repeat(72)}`);
  if (failures.length === 0) {
    console.log(`✓ ${checked} pairings checked across both themes — no failures.`);
    return;
  }

  console.log(`✗ ${failures.length} of ${checked} pairings below the required ratio:\n`);
  for (const f of failures) {
    console.log(`  [${f.theme}] ${f.label}`);
    console.log(`      ${round(f.got)}:1, needs ${f.want}:1 — ${f.where}`);
  }
  process.exitCode = 1;
}

main();
