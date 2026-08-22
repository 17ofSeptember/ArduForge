# Tailwind token utilities — Phase 2

_THEME.md Phase 2. No visual change: the built CSS is semantically identical before and after._

## The v3/v4 divergence

THEME.md Phase 2 says to extend `tailwind.config.ts` and remove the default palette from it. **That file does not exist in this project and Tailwind v4 does not read one.** This was flagged as NEEDS-DECISION #2 in the Phase 0 inventory; the v4 equivalent is implemented here.

| THEME.md (v3) | Implemented (v4) |
|---|---|
| `colors: { app: 'var(--bg-app)' }` in `tailwind.config.ts` | `@theme inline { --color-app: var(--bg-app); }` in `tokens.css` |
| Remove the default palette from the config | `@theme { --color-*: initial; }` |
| ESLint rule banning `bg-slate-*` as the fallback | Both — the palette is removed *and* the rule is in place |

THEME.md offered the palette removal and the lint rule as alternatives ("or at minimum"). Both are implemented, because removing the palette fails **silently** — `bg-slate-800` stops generating a rule and the element simply renders unstyled. The lint rule converts that into an author-time error with a message pointing at the right token.

### Why `inline` is load-bearing

`@theme inline` substitutes the token reference into the generated utility:

```css
.bg-card { background-color: var(--bg-card); }
```

A plain `@theme` would instead emit `--color-card` into `:root` and generate `background-color: var(--color-card)`, snapshotting the value at `:root` scope. Utilities would then not follow `data-theme`. Verified against the built output — every generated utility resolves to the token, not to a copied value.

### Why the semantic tokens are *not* exposed as utilities

Only **chrome** is mapped. Node categories, port types, chart series, C++ syntax, and connection status are deliberately left as plain custom properties.

They are consumed by React Flow, uPlot, and CodeMirror through JS config objects and inline styles — not through `className`. Phase 4 wires those to the custom properties via `useThemeTokens`. Generating utilities for them would produce a second way to reach the same colour, which is the competing-systems problem THEME.md warns about in its opening constraint.

It also avoids a name collision: the legacy block already defines `--color-cat-*` and `--color-port-*`, and redefining those names would change what existing components resolve to — a visual change, which Phase 2 must not make.

## The utilities

41 mappings. Names deliberately avoid every name in the legacy block, so both can be live during the migration.

### Surfaces

| Utility root | Token | Notes |
|---|---|---|
| `app` | `--bg-app` | |
| `panel` | `--bg-panel` | |
| `card` | `--bg-card` | |
| `header` | `--bg-header` | |
| `input` | `--bg-input` | recessed, not elevated |
| `popover` | `--bg-popover` | |
| `modal` | `--bg-modal` | |
| `structural` | `--bg-structural` | full-saturation Slate Blue; inverse text only |

### Typography

| Utility root | Token |
|---|---|
| `content` | `--text-primary` |
| `content-secondary` | `--text-secondary` |
| `content-muted` | `--text-muted` |
| `link` | `--text-link` |
| `inverse` | `--text-inverse` |
| `on-structural` | `--text-on-structural` |

### Borders

`edge` → `--border-default`, `edge-subtle` → `--border-subtle`, `edge-strong` → `--border-strong`.

Named `edge` rather than `border` because `border-border-strong` would be the alternative, and because `border-default` collides conceptually with Tailwind's bare `border`.

### Interactive and feedback

| Utility root | Token |
|---|---|
| `interactive` / `-hover` / `-active` | `--bg-interactive*` |
| `on-interactive` | `--text-on-interactive` |
| `destructive` / `-hover` | `--bg-destructive*` |
| `on-destructive` | `--text-on-destructive` |
| `success` / `warning` / `info` | `--feedback-*` |
| `error` | `--feedback-destructive` |

`destructive` and `error` are separate on purpose: `bg-destructive` is the button fill (`#B80C09`, carrying white at 6.57:1) and `text-error` is the feedback text colour (`#FF9081` on dark, lifted to clear 4.5:1). One Tailwind colour name cannot serve both, because the two have different values.

### State, overlay, elevation

`selected`, `selected-edge`, `disabled`, `disabled-content`, `disabled-edge`, `focus`, `focus-offset`, `scrim`, `scroll-thumb`, `scroll-thumb-hover`.

Shadows are `shadow-e1` / `-e2` / `-e3`, not `shadow-sm/md/lg`. Overriding Tailwind's defaults would silently restyle the `shadow-lg`, `shadow-xl` and `shadow-2xl` already in use across 9 sites.

## Verification

### No visual change

Built CSS captured before and after, split into rule chunks and compared as sets:

```
rule chunks before: 562    after: 562
removed: none
added:   none
```

One chunk differs — Tailwind's `@layer theme` block — and its 61 declarations are **identical as a set**, differing only in emission order because `--color-black` / `--color-white` are re-declared after the reset. No selector gained, lost, or changed a declaration.

The legacy `@theme` block still emits all 30 of its variables, so every existing `bg-[var(--color-surface-1)]` resolves exactly as before.

### The palette is genuinely unreachable

A probe component using `bg-slate-800 text-zinc-400 border-gray-700` was built and the output searched:

```
blocked: bg-slate-800
blocked: text-zinc-400
blocked: border-gray-700
```

No rule is generated for any of them.

### The utilities resolve to tokens

From the same probe build:

```css
.bg-card          { background-color: var(--bg-card) }
.text-content     { color: var(--text-primary) }
.border-edge-strong { border-color: var(--border-strong) }
.ring-focus       { --tw-ring-color: var(--focus-ring) }
.bg-scrim         { background-color: var(--scrim) }
.text-error       { color: var(--feedback-destructive) }
.shadow-e2        { --tw-shadow: var(--shadow-2); … }
```

Each points at the custom property, so all of them follow `data-theme` with no rebuild.

### The lint rule fires

Probe with three forms — a plain string, a nested string inside a template literal, and a variant-prefixed class:

```
1:45  error  ...  no-restricted-syntax   (bg-slate-800)
2:78  error  ...  no-restricted-syntax   (text-zinc-400/50)
2:99  error  ...  no-restricted-syntax   (hover:border-gray-700)
✖ 3 problems
```

`bg-card`, `text-content` and `border-edge` in the same file produce no error. Lint on the real tree is clean.

## Still permitted, until Phase 3

`--color-white` and `--color-black` survive the reset. 26 sites still use `text-black`, `text-white`, `bg-white` and `bg-black/60` for node header labels, destructive button text, the toggle knob, and modal scrims.

Phase 3 replaces them with `--text-inverse`, `--text-on-destructive` and `--scrim`. At that point both lines come out of `tokens.css` and `black|white` joins the lint rule — the rule already has a comment marking the spot.

## Regeneration

`tokens.css` is generated. The Tailwind blocks live in `scripts/generate-tokens.mjs` alongside the token derivation:

```
npm run tokens && npm run contrast
```
