import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'error' | 'idle';

const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--feedback-success)',
  warn: 'var(--feedback-warning)',
  error: 'var(--feedback-destructive)',
  idle: 'var(--text-muted)',
};

/**
 * Link state, which is not the same thing as a generic status tone — StatusDot
 * also reports build results, serial state, and board discovery, and those
 * should not move when the link colours do.
 *
 * `stale` is deliberately the odd one out: it is desaturated and separated from
 * `connected` by a verified 1.57:1 (dark) / 2.23:1 (light), because §3.7 says a
 * user must never read frozen values as live ones.
 *
 * Only idle/connected/stale are reachable today; the store does not yet
 * distinguish connecting from streaming, or surface a link error separately.
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'stale'
  | 'error';

const CONNECTION_VAR: Record<ConnectionState, string> = {
  idle: 'var(--conn-idle)',
  connecting: 'var(--conn-connecting)',
  connected: 'var(--conn-connected)',
  streaming: 'var(--conn-streaming)',
  stale: 'var(--conn-stale)',
  error: 'var(--conn-error)',
};

export function ConnectionDot({
  state,
  pulse = false,
}: {
  state: ConnectionState;
  pulse?: boolean;
}) {
  const color = CONNECTION_VAR[state];
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{
        backgroundColor: color,
        // No glow on idle or stale: a halo reads as "live", which is the exact
        // confusion §3.7 rules out.
        boxShadow: state === 'idle' || state === 'stale' ? undefined : `0 0 8px ${color}`,
      }}
    />
  );
}

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  const color = TONE_VAR[tone];
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{
        backgroundColor: color,
        boxShadow: tone === 'idle' ? undefined : `0 0 8px ${color}`,
      }}
    />
  );
}

export function Panel({
  title,
  actions,
  children,
  bodyClassName = 'p-4',
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-edge-subtle bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-edge-subtle px-4 py-2.5">
        <h2 className="text-xs font-semibold tracking-[0.12em] text-content-secondary uppercase">
          {title}
        </h2>
        {actions}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  title?: string;
}) {
  // Every variant covers default / hover / active / disabled (THEME.md Phase 3
  // item 4). Focus comes from the global :focus-visible ring in tokens.css, so
  // it is identical on every surface level rather than per-variant guesswork.
  //
  // Disabled uses real tokens rather than opacity: a translucent button picks up
  // whatever is behind it, so the same class looked different on a card than in
  // a modal, and neither was contrast-checked.
  const base =
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:border-disabled-edge ' +
    'disabled:bg-disabled disabled:text-disabled-content';
  const variants = {
    default:
      'border border-edge bg-card hover:bg-header active:bg-popover',
    primary:
      'bg-interactive text-on-interactive hover:bg-interactive-hover active:bg-interactive-active',
    danger:
      'bg-destructive text-on-destructive hover:bg-destructive-hover active:bg-destructive',
  } as const;

  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  label,
}: {
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-content-muted">
      {label}
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((option) => String(option.value) === event.target.value);
          if (next !== undefined) onChange(next.value);
        }}
        className="rounded border border-edge bg-card px-2 py-1 font-mono text-xs text-content disabled:opacity-40"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-muted select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-interactive"
      />
      {label}
    </label>
  );
}
