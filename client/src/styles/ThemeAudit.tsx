/**
 * Dev-only theme audit page (THEME.md Phase 6.1), mounted at /__theme.
 *
 * Everything the theme touches, on one scrollable page, so that combinations
 * are reviewed together. Screenshotting individual features misses the cases
 * that actually break: a focus ring that vanishes on one surface level, two
 * node categories that collapse in greyscale, a chart series that disappears
 * into the gridline.
 *
 * Every value here is read out of the live document with getComputedStyle, so
 * the page reports what the app is actually rendering rather than a copy that
 * can drift.
 */
import { useMemo, useState } from 'react';
import { Panel, Button, Select, Toggle, StatusDot, ConnectionDot } from '@/ui/primitives';
import type { ConnectionState } from '@/ui/primitives';
import { CATEGORY, PORT_COLOR } from '@/nodes/types';
import type { NodeCategory, PortType } from '@/nodes/types';
import { wiringDiagram, WIRE_COLORS } from '@/examples/builder';
import type { WireKind } from '@/examples/builder';
import {
  contrast,
  formatOklch,
  parseColor,
  toGrayHex,
  toHex,
  toOklch,
} from '@/styles/color';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/styles/theme';
import { useThemeVersion } from '@/styles/useThemeTokens';

const SURFACES = [
  '--bg-app',
  '--bg-panel',
  '--bg-card',
  '--bg-header',
  '--bg-input',
  '--bg-popover',
  '--bg-modal',
] as const;

const CATEGORY_KEYS = Object.keys(CATEGORY) as NodeCategory[];
const PORT_KEYS = Object.keys(PORT_COLOR) as PortType[];
const CONNECTION_STATES: ConnectionState[] = [
  'idle',
  'connecting',
  'connected',
  'streaming',
  'stale',
  'error',
];

/**
 * Every token, paired with the thing it is actually measured against.
 *
 * The pairing matters more than the list. An earlier version applied one bar
 * per group and lit up red for --chart-grid (subordinate by design),
 * --text-inverse (never sits on a card) and --text-disabled (WCAG 1.4.3 exempts
 * disabled controls). A page full of false failures is worse than no page, so
 * each token now declares its own role:
 *
 *   text  — 4.5:1 against the selected surface
 *   ui    — 3:1 against the selected surface
 *   on    — a foreground measured against THIS token, for fills
 *   info  — shown with its value, no pass/fail, because no bar applies
 */
type Role = 'text' | 'ui' | 'info' | 'on';

interface TokenRow {
  readonly token: string;
  readonly role: Role;
  /** For role 'on': the foreground measured against `token`. */
  readonly fg?: string;
  /** Overrides the selected surface, where a token only ever sits on one thing. */
  readonly against?: string;
  readonly note?: string;
}

const group = (title: string, rows: readonly TokenRow[]) => ({ title, rows });

const GROUPS = [
  group(
    'Elevation',
    [...SURFACES, '--bg-structural'].map((token) => ({
      token,
      role: 'info' as const,
      note: 'surface',
    })),
  ),
  group('Typography', [
    { token: '--text-primary', role: 'text' },
    { token: '--text-secondary', role: 'text' },
    { token: '--text-muted', role: 'text' },
    { token: '--text-link', role: 'text' },
    { token: '--text-on-structural', role: 'text', against: '--bg-structural' },
    { token: '--text-on-semantic', role: 'text', against: '--cat-io', note: 'on a node header' },
  ]),
  group('Interactive fills — label contrast', [
    { token: '--bg-interactive', role: 'on', fg: '--text-on-interactive' },
    { token: '--bg-interactive-hover', role: 'on', fg: '--text-on-interactive' },
    { token: '--bg-interactive-active', role: 'on', fg: '--text-on-interactive' },
    { token: '--bg-destructive', role: 'on', fg: '--text-on-destructive' },
    { token: '--bg-destructive-hover', role: 'on', fg: '--text-on-destructive' },
  ]),
  group('Feedback', [
    { token: '--feedback-success', role: 'text' },
    { token: '--feedback-warning', role: 'text' },
    { token: '--feedback-info', role: 'text' },
    { token: '--feedback-destructive', role: 'text' },
  ]),
  group('Borders, focus, state', [
    { token: '--border-subtle', role: 'info', note: 'divider, not an affordance' },
    { token: '--border-default', role: 'info', note: 'divider' },
    { token: '--border-strong', role: 'ui', note: 'affordance boundary' },
    { token: '--focus-ring', role: 'ui' },
    { token: '--border-selected', role: 'ui' },
    { token: '--bg-selected', role: 'on', fg: '--text-primary' },
    { token: '--bg-disabled', role: 'info', note: 'surface' },
    { token: '--text-disabled', role: 'info', note: 'WCAG 1.4.3 exempts disabled' },
    { token: '--border-disabled', role: 'info', note: 'disabled' },
  ]),
  group(
    'Connection status',
    CONNECTION_STATES.map((state) => ({ token: `--conn-${state}`, role: 'ui' as const })),
  ),
  group('Live pin state', [
    { token: '--pin-high', role: 'on', fg: '--text-on-semantic' },
    { token: '--pin-low', role: 'on', fg: '--text-secondary' },
  ]),
  group(
    'Node categories — header on the node body',
    CATEGORY_KEYS.map((key) => ({
      token: `--cat-${key}`,
      role: 'on' as const,
      fg: '--text-on-semantic',
    })),
  ),
  group(
    'Port types — on the canvas',
    PORT_KEYS.map((key) => ({ token: `--port-${key}`, role: 'ui' as const, against: '--bg-app' })),
  ),
  group('Chart', [
    { token: '--chart-series-1', role: 'ui', against: '--bg-panel' },
    { token: '--chart-series-2', role: 'ui', against: '--bg-panel' },
    { token: '--chart-series-3', role: 'ui', against: '--bg-panel' },
    { token: '--chart-series-4', role: 'ui', against: '--bg-panel' },
    { token: '--chart-grid', role: 'info', note: 'subordinate to every series by design' },
    { token: '--chart-axis', role: 'text', against: '--bg-panel' },
  ]),
  group(
    'C++ syntax — on the editor ground',
    [
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
    ].map((name) => ({ token: `--syntax-${name}`, role: 'text' as const, against: '--bg-panel' })),
  ),
] as const satisfies readonly { title: string; rows: readonly TokenRow[] }[];

function read(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── swatches ─────────────────────────────────────────────────────────────────

function Badge({ pass, children }: { pass: boolean; children: React.ReactNode }) {
  return (
    <span
      className="rounded px-1 py-px text-[10px] font-semibold"
      style={{
        backgroundColor: pass ? 'var(--feedback-success)' : 'var(--feedback-destructive)',
        color: 'var(--text-on-semantic)',
      }}
    >
      {children}
    </span>
  );
}

function Swatch({ row, surface }: { row: TokenRow; surface: string }) {
  const raw = read(row.token);
  const rgb = parseColor(raw);

  const bar = row.role === 'text' ? 4.5 : row.role === 'ui' ? 3 : row.role === 'on' ? 4.5 : 0;

  // 'on' inverts the pairing: the token IS the background, and the badge
  // reports whether its label is readable.
  const otherName = row.role === 'on' ? (row.fg ?? '--text-primary') : (row.against ?? surface);
  const other = parseColor(read(otherName));

  const ratio = rgb !== null && other !== null ? contrast(rgb, other) : null;
  const pass = ratio === null || bar === 0 ? true : ratio >= bar;

  return (
    <div className="flex items-center gap-2 rounded border border-edge-subtle bg-card p-2">
      <span
        className="size-9 shrink-0 rounded border border-edge"
        style={{ backgroundColor: raw }}
        aria-hidden
      />
      <span
        className="size-9 shrink-0 rounded border border-edge"
        style={{ backgroundColor: rgb === null ? raw : toGrayHex(rgb) }}
        title="Greyscale — the Phase 6.2 desaturation test"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[11px] text-content">{row.token}</p>
        <p className="truncate font-mono text-[10px] text-content-muted">
          {rgb === null ? raw : `${toHex(rgb)} · ${formatOklch(toOklch(rgb))}`}
        </p>
        {(row.note !== undefined || bar > 0) && (
          <p className="truncate text-[9px] text-content-muted">
            {row.note ?? (row.role === 'on' ? `${otherName} on this` : `vs ${otherName}`)}
          </p>
        )}
      </div>
      {bar > 0 && ratio !== null && (
        <div className="shrink-0 text-right">
          <Badge pass={pass}>{ratio.toFixed(2)}:1</Badge>
          <p className="mt-0.5 font-mono text-[9px] text-content-muted">need {bar}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-content-secondary uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export function ThemeAudit() {
  // Re-render on every theme change so the computed values below are re-read.
  const version = useThemeVersion();
  const [preference, setPreference] = useState<ThemePreference>(() => {
    // ?theme=light|dark lets the page be captured in either mode without a
    // click, which is what makes the Phase 6.2 side-by-side comparison a
    // scripted check rather than a manual one.
    const requested = new URLSearchParams(window.location.search).get('theme');
    if (requested === 'light' || requested === 'dark' || requested === 'system') {
      setThemePreference(requested);
      return requested;
    }
    return getThemePreference();
  });
  const [surface, setSurface] = useState<string>('--bg-card');
  const [toggled, setToggled] = useState(true);

  const choose = (next: ThemePreference) => {
    setThemePreference(next);
    setPreference(next);
  };

  // Phase 1 item 3 asked to see both dark-card options side by side before
  // committing. The desaturated one shipped; the saturated one is what the
  // uploaded palette implied.
  const cardOptions = useMemo(
    () => [
      { label: 'Shipped — desaturated slate tint', value: read('--bg-card') },
      { label: 'Rejected — full-saturation slate', value: read('--bg-structural') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on theme change
    [version],
  );

  const textTokens = ['--text-primary', '--text-secondary', '--text-muted', '--text-link'];

  return (
    <div className="h-full overflow-auto bg-app px-6 py-5 text-content" key={version}>
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Theme audit</h1>
        <span className="font-mono text-[11px] text-content-muted">/__theme · dev only</span>
        <div className="ml-auto flex items-center gap-2">
          {(['system', 'light', 'dark'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => choose(option)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                preference === option
                  ? 'bg-interactive text-on-interactive'
                  : 'border border-edge bg-card text-content-secondary hover:bg-header'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      <Section title="Phase 1 item 3 — dark card surface, both options">
        <div className="grid gap-3 sm:grid-cols-2">
          {cardOptions.map((option) => {
            const bg = parseColor(option.value);
            return (
              <div
                key={option.label}
                className="rounded-lg border border-edge p-4"
                style={{ backgroundColor: option.value }}
              >
                <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {option.label}
                </p>
                {textTokens.map((token) => {
                  const fg = parseColor(read(token));
                  const ratio = fg !== null && bg !== null ? contrast(fg, bg) : null;
                  return (
                    <p
                      key={token}
                      className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px]"
                      style={{ color: read(token) }}
                    >
                      <span>{token}</span>
                      {ratio !== null && (
                        <Badge pass={ratio >= 4.5}>{ratio.toFixed(2)}:1</Badge>
                      )}
                    </p>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Tokens — colour, greyscale, OKLCH, contrast">
        <label className="mb-3 flex items-center gap-2 text-xs text-content-muted">
          Measured against
          <select
            value={surface}
            onChange={(event) => setSurface(event.target.value)}
            className="rounded border border-edge bg-input px-2 py-1 font-mono text-xs text-content"
          >
            {SURFACES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {GROUPS.map((entry) => (
          <div key={entry.title} className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-semibold text-content-secondary">
              {entry.title}
            </h3>
            <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
              {entry.rows.map((row) => (
                <Swatch key={row.token} row={row} surface={surface} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Buttons — every variant × every state">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SURFACES.slice(0, 4).map((level) => (
            <div
              key={level}
              className="rounded-lg border border-edge-subtle p-3"
              style={{ backgroundColor: read(level) }}
            >
              <p className="mb-2 font-mono text-[10px] text-content-muted">{level}</p>
              <div className="flex flex-col gap-2">
                {(['default', 'primary', 'danger'] as const).map((variant) => (
                  <div key={variant} className="flex flex-wrap gap-1.5">
                    <Button variant={variant} onClick={() => undefined}>
                      {variant}
                    </Button>
                    <Button variant={variant} disabled onClick={() => undefined}>
                      disabled
                    </Button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-content-muted">
                Tab through to check the focus ring on this surface.
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Form controls — on every surface level">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {SURFACES.map((level) => (
            <div
              key={level}
              className="rounded-lg border border-edge-subtle p-3"
              style={{ backgroundColor: read(level) }}
            >
              <p className="mb-2 font-mono text-[10px] text-content-muted">{level}</p>
              <div className="flex flex-col gap-2">
                <input
                  defaultValue="text input"
                  className="w-full rounded border border-edge bg-input px-2 py-1 text-xs text-content"
                />
                <input
                  type="number"
                  defaultValue={42}
                  className="w-full rounded border border-edge bg-input px-2 py-1 font-mono text-xs text-content"
                />
                <Select
                  label="select"
                  value="a"
                  options={[
                    { value: 'a', label: 'Option A' },
                    { value: 'b', label: 'Option B' },
                  ]}
                  onChange={() => undefined}
                />
                <Toggle checked={toggled} onChange={setToggled} label="checkbox" />
                <input type="range" className="w-full accent-interactive" defaultValue={60} />
                <input
                  disabled
                  defaultValue="disabled"
                  className="w-full rounded border border-disabled-edge bg-disabled px-2 py-1 text-xs text-disabled-content"
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Node categories — 100% and 50%, colour and greyscale">
        {[1, 0.5].map((zoom) => (
          <div key={zoom} className="mb-3">
            <p className="mb-1 font-mono text-[10px] text-content-muted">{zoom * 100}%</p>
            <div
              className="flex flex-wrap items-start gap-2 rounded-lg border border-edge-subtle bg-app p-3"
              style={{ zoom }}
            >
              {CATEGORY_KEYS.map((key) => (
                <div
                  key={key}
                  className="w-[150px] overflow-hidden rounded-lg border border-edge bg-card"
                >
                  <div
                    className="px-2 py-1.5 text-[12px] font-semibold text-on-semantic/90"
                    style={{ backgroundColor: `var(--cat-${key})` }}
                  >
                    {CATEGORY[key].label}
                  </div>
                  <p className="px-2 py-1 text-[10px] text-content-muted">node body</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="mb-1 font-mono text-[10px] text-content-muted">
          desaturated — categories must stay separable by lightness alone
        </p>
        <div className="flex flex-wrap gap-1 rounded-lg border border-edge-subtle bg-app p-3 grayscale">
          {CATEGORY_KEYS.map((key) => (
            <div
              key={key}
              className="flex h-10 w-[92px] items-end p-1 text-[9px] font-semibold text-on-semantic/90"
              style={{ backgroundColor: `var(--cat-${key})` }}
            >
              {key}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Port types and edges — on the canvas background">
        <div className="rounded-lg border border-edge-subtle bg-app p-4">
          <div className="mb-3 flex flex-wrap gap-3">
            {PORT_KEYS.map((key) => (
              <span key={key} className="flex items-center gap-1.5 text-[11px] text-content-secondary">
                <span
                  className="size-3 rounded-full border border-edge"
                  style={{ backgroundColor: PORT_COLOR[key] }}
                />
                {key}
              </span>
            ))}
          </div>
          <svg viewBox="0 0 640 130" className="w-full" role="img" aria-label="Edge types">
            {PORT_KEYS.map((key, index) => {
              const y = 12 + index * 16;
              return (
                <g key={key}>
                  <path
                    d={`M12 ${y} C 160 ${y}, 200 ${y + 8}, 340 ${y + 8}`}
                    stroke={PORT_COLOR[key]}
                    strokeWidth={key === 'exec' ? 2.5 : 1.5}
                    fill="none"
                  />
                  <text x="352" y={y + 12} fill="var(--text-muted)" fontSize="10" fontFamily="ui-monospace, monospace">
                    {key}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </Section>

      <Section title="Connection states — all six">
        <div className="flex flex-wrap gap-3 rounded-lg border border-edge-subtle bg-panel p-3">
          {CONNECTION_STATES.map((state) => (
            <span key={state} className="flex items-center gap-1.5 font-mono text-[11px] text-content-secondary">
              <ConnectionDot state={state} pulse={state === 'stale' || state === 'connecting'} />
              {state}
            </span>
          ))}
          <span className="ml-4 flex items-center gap-1.5 font-mono text-[11px] text-content-muted">
            generic tones:
            {(['ok', 'warn', 'error', 'idle'] as const).map((tone) => (
              <StatusDot key={tone} tone={tone} />
            ))}
          </span>
        </div>
      </Section>

      <Section title="Live pin state — must not read as connection status">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge-subtle bg-card p-3">
          {[1, 0].map((value) => (
            <span
              key={value}
              className="rounded px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: value > 0 ? 'var(--pin-high)' : 'var(--pin-low)',
                color: value > 0 ? 'var(--text-on-semantic)' : 'var(--text-secondary)',
              }}
            >
              {value > 0 ? 'HIGH' : 'LOW'}
            </span>
          ))}
          <span className="text-[11px] text-content-muted">next to</span>
          <ConnectionDot state="connected" />
          <span className="font-mono text-[11px] text-content-secondary">connected</span>
        </div>
      </Section>

      <Section title="C++ syntax — every token exercised">
        <pre className="overflow-x-auto rounded-lg border border-edge-subtle bg-panel p-3 font-mono text-[12px] leading-relaxed">
          <code>
            <span style={{ color: 'var(--syntax-preprocessor)' }}>#include</span>{' '}
            <span style={{ color: 'var(--syntax-string)' }}>&lt;Servo.h&gt;</span>
            {'\n'}
            <span style={{ color: 'var(--syntax-comment)' }}>
              {'// Generated by ArduForge — every syntax token below.'}
            </span>
            {'\n'}
            <span style={{ color: 'var(--syntax-type)' }}>Servo</span>{' '}
            <span style={{ color: 'var(--syntax-function)' }}>tilt</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>;</span>
            {'\n'}
            <span style={{ color: 'var(--syntax-keyword)' }}>const</span>{' '}
            <span style={{ color: 'var(--syntax-type)' }}>int</span> PIN{' '}
            <span style={{ color: 'var(--syntax-operator)' }}>=</span>{' '}
            <span style={{ color: 'var(--syntax-number)' }}>9</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>;</span>
            {'\n\n'}
            <span style={{ color: 'var(--syntax-type)' }}>void</span>{' '}
            <span style={{ color: 'var(--syntax-function)' }}>loop</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>() {'{'}</span>
            {'\n  '}
            <span style={{ color: 'var(--syntax-keyword)' }}>if</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>(</span>
            <span style={{ color: 'var(--syntax-function)' }}>digitalRead</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>(</span>PIN
            <span style={{ color: 'var(--syntax-punctuation)' }}>)</span>{' '}
            <span style={{ color: 'var(--syntax-operator)' }}>==</span>{' '}
            <span style={{ color: 'var(--syntax-number)' }}>HIGH</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>) {'{'}</span>
            {'\n    '}
            <span style={{ color: 'var(--syntax-function)' }}>Serial</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>.</span>
            <span style={{ color: 'var(--syntax-function)' }}>println</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>(</span>
            <span style={{ color: 'var(--syntax-string)' }}>&quot;pressed&quot;</span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>);</span>
            {'\n  '}
            <span style={{ color: 'var(--syntax-punctuation)' }}>{'}'}</span>
            {'\n  '}
            <span
              style={{
                color: 'var(--syntax-error)',
                textDecoration: 'underline wavy var(--feedback-destructive)',
                textUnderlineOffset: '3px',
              }}
            >
              undeclared_symbol
            </span>
            <span style={{ color: 'var(--syntax-punctuation)' }}>;</span>
            {'\n'}
            <span style={{ color: 'var(--syntax-punctuation)' }}>{'}'}</span>
          </code>
        </pre>
      </Section>

      <Section title="Wiring diagram — literal wires on a themed plate">
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className="rounded-lg border border-edge-subtle p-2"
            // Generated by our own wiringDiagram(); no external input reaches it.
            dangerouslySetInnerHTML={{
              __html: wiringDiagram(
                (Object.keys(WIRE_COLORS) as WireKind[]).map((kind) => ({
                  from: kind.toUpperCase(),
                  to: `pin (${kind})`,
                  kind,
                })),
              ),
            }}
          />
          <div className="rounded-lg border border-edge-subtle bg-card p-3 text-[11px] text-content-secondary">
            <p className="mb-2 font-semibold text-content">Black and white must both read.</p>
            <p>
              GND is near-black and SCL near-white, so each is invisible against one of the two
              plate colours. Every stroke is drawn twice — a wider halo in the surface colour,
              then the literal wire — so neither depends on the background.
            </p>
            <p className="mt-2">Wire colours are exempt from theming (Phase 5).</p>
          </div>
        </div>
      </Section>

      <Section title="Panels, toasts and badges">
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Panel" actions={<Button onClick={() => undefined}>action</Button>}>
            <p className="text-xs text-content-secondary">
              Panel body on <span className="font-mono">--bg-panel</span>.
            </p>
          </Panel>
          <div className="flex flex-col gap-2">
            {(
              [
                ['info', '--feedback-info'],
                ['success', '--feedback-success'],
                ['warning', '--feedback-warning'],
                ['error', '--feedback-destructive'],
              ] as const
            ).map(([level, token]) => (
              <div
                key={level}
                className="flex items-start gap-2.5 rounded-lg border bg-card p-3 shadow-e2"
                style={{ borderColor: `var(${token})` }}
              >
                <span className="mt-1 size-2.5 rounded-full" style={{ backgroundColor: `var(${token})` }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: `var(${token})` }}>
                    {level}
                  </p>
                  <p className="mt-0.5 text-xs text-content-secondary">
                    Toast body copy on the card surface.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Overlay — scrim, popover, modal">
        <div className="relative h-40 overflow-hidden rounded-lg border border-edge-subtle bg-app p-3">
          <p className="text-xs text-content-muted">Content behind the scrim.</p>
          <div className="absolute inset-0 bg-scrim" />
          <div className="absolute inset-x-6 top-6 rounded-lg border border-edge bg-modal p-4 shadow-e3">
            <p className="text-sm font-semibold text-content">Modal on --bg-modal</p>
            <p className="mt-1 text-xs text-content-secondary">
              Elevated over the scrim, with --shadow-e3.
            </p>
          </div>
          <div className="absolute right-6 bottom-4 rounded-lg border border-edge bg-popover px-3 py-2 shadow-e2">
            <p className="text-xs text-content">Popover on --bg-popover</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
