# Theming

How colour works in ArduForge, and how to change it without breaking it.

If you only read one thing: **`tokens.css` is generated. Never hand-edit a hex.** Change the inputs in `scripts/generate-tokens.mjs` and run `npm run tokens`.

```
npm run tokens      # regenerate client/src/styles/tokens.css
npm run contrast    # 316 pairings, both themes, plus the greyscale ladder
npm run check       # typecheck → lint → contrast → test
npm run dev         # then http://localhost:5173/__theme
```

---

## The two colour systems

This is the load-bearing idea, and everything else follows from it.

The palette is five colours — Crimson, Slate Blue, Electric Cyan, Ghost White, Rich Black — with roughly three usable hues. The app has **10 node category hues** and **7 port type colours** that carry *meaning*: a user identifies a node's role at a glance, and knows an edge is legal, without reading text. Flattening those into five colours would make every node cyan-on-slate and destroy the single most important property of the canvas.

So colour splits in two:

| | What it covers | Where it comes from | Exposed as |
|---|---|---|---|
| **Chrome** | app shell, panels, toolbars, buttons, inputs, typography, borders, modals | the five palette primitives | Tailwind utilities |
| **Semantic** | node categories, port types, chart series, syntax, connection status, pin state | full hue separation, **harmonized** to the palette | CSS custom properties only |

Semantic colours keep their hue and are re-derived at a lightness and chroma that matches the palette's envelope, so they read as one family rather than a rainbow pasted onto a new background. All of it happens in OKLCH, because that is the only space where changing lightness leaves hue alone.

**Semantic tokens are deliberately not Tailwind utilities.** They are consumed by React Flow, uPlot and CodeMirror through JS config and inline styles, never through `className`. Generating utilities for them would create a second reachable path to the same colour — the competing-systems problem this whole structure exists to avoid.

---

## Token taxonomy

`client/src/styles/tokens.css`, in order:

1. **Ramps** — `--ramp-{cyan,slate,crimson,ghost,ink}-{50…950}`. 55 steps, theme-independent. Generated in OKLCH at fixed lightness stops so steps are comparable across hues; the step nearest each primitive's own lightness is snapped back to the exact primitive. **Nothing in the app references a ramp step directly** — they exist so the tokens below have somewhere to come from.

2. **Themes** — `:root` (light), `:root[data-theme='dark']`, and a `prefers-color-scheme` block for when the user has expressed no preference. 85 tokens per scheme.

3. **Tailwind** — `@theme inline` mapping 43 chrome tokens to utilities, and `@theme { --color-*: initial }` removing Tailwind's default palette.

4. **Base** — focus ring, scrollbars, React Flow's `--xy-*` overrides.

### The chrome tokens

| Group | Tokens |
|---|---|
| Elevation (7 levels) | `--bg-app` → `--bg-panel` → `--bg-card` → `--bg-header` → `--bg-popover` → `--bg-modal`, plus `--bg-input` (recessed) |
| Structural | `--bg-structural` — full-saturation Slate Blue, **toolbar and sidebar only**, carries inverse text exclusively |
| Typography | `--text-primary`, `-secondary`, `-muted`, `--text-link`, `--text-on-structural`, `--text-on-semantic` |
| Interactive | `--bg-interactive{,-hover,-active}`, `--text-on-interactive`, `--bg-destructive{,-hover}`, `--text-on-destructive` |
| Feedback | `--feedback-{success,warning,info,destructive}` |
| Borders | `--border-{subtle,default,strong}` |
| State | `--focus-ring`, `--bg-selected`, `--border-selected`, `--bg-disabled`, `--text-disabled`, `--border-disabled` |
| Overlay | `--scrim`, `--shadow-{1,2,3}` |
| Scrollbar | `--scrollbar-{thumb,thumb-hover,track}` |

### The semantic tokens

`--cat-*` (10), `--port-*` (7), `--chart-series-{1..4}` + `--chart-grid` + `--chart-axis`, `--syntax-*` (10), `--conn-*` (6), `--pin-{high,low}`.

### Utility naming

Chrome tokens become Tailwind colours under shorter names, so `--bg-card` is `bg-card` and `--text-secondary` is `text-content-secondary`. The full map is in [TAILWIND-TOKENS.md](TAILWIND-TOKENS.md). Two names that catch people out:

- `border-edge` / `-edge-subtle` / `-edge-strong` — not `border-border-*`.
- `bg-destructive` is the button **fill**; `text-error` is the feedback **text**. Different values, so they cannot share a name.

---

## Adding a token

1. Add it to `scheme()` in `scripts/generate-tokens.mjs`, derived from a ramp step or an OKLCH expression — not a literal you picked by eye.
2. If chrome, map it in the `@theme inline` block so it becomes a utility. If semantic, leave it as a custom property.
3. Add its real pairing to `buildPairs()` in `scripts/contrast-check.ts`. **A token the gate does not check is a token that will silently drift** — this is how `--pin-high` shipped at 4.11:1 in Phase 5 and was only caught by the audit page in Phase 6.
4. Add a row to `GROUPS` in `client/src/styles/ThemeAudit.tsx` with the right role.
5. `npm run tokens && npm run check`.

### Picking a bar

| Kind | Bar | Examples |
|---|---|---|
| Body text | 4.5:1 | every `--text-*`, feedback text, syntax |
| UI component, icon, large text, affordance border | 3:1 | focus ring, port strokes, chart series, `--border-strong` |
| Divider, gridline, disabled | none | `--border-subtle`, `--chart-grid`, `--text-disabled` (WCAG 1.4.3 exempts disabled) |
| A fill | measure its **label** against it, not it against the surface | `--bg-interactive` carries `--text-on-interactive` |

Getting this wrong in the audit page produced a screen full of red badges for tokens that were fine, which is worse than no page at all.

---

## Adding a node category hue

The hard one. Ten categories already sit close together in greyscale; an eleventh makes every gap smaller.

1. Add the key to `CAT_SRC` in the generator with a **source hue** — the hue is all that survives; L and C are re-derived.
2. Insert it into `CAT_ORDER`. **This is the decision that matters.** The order sets each category's lightness, and it is chosen so that colour-vision-confusable pairs sit far apart:
   - red and green as far apart as possible (deuteranopia)
   - amber and green likewise
   - blue and cyan likewise
   - the two neutrals (`serial`, `custom`) slotted between hue-similar pairs to break them up
3. Run `npm run contrast` and read the greyscale ladder it prints. The floor is **1.015×** per adjacent step.
4. Look at `/__theme` — the category section has a desaturated strip.

### Why the ceiling is what it is

The usable luminance band for a node header is bounded by its label needing 4.5:1 and the header needing 3:1 from the node body. Across that band, ten categories cap out around **1.11× per step** even when spaced perfectly — and perfect spacing costs hue identity, because forcing amber down or cyan up gamut-clamps them into pale wash.

Steps below 1.10× print `(relies on the node icon)`. That is not a failure: `NodeView` renders `def.icon` in every header, and shape redundancy is the sanctioned fallback. But it does mean **you cannot keep adding categories indefinitely** — past a dozen or so, colour stops carrying the distinction and the icon is doing all the work.

Light and dark are bounded differently. In dark mode headers are light with dark labels; in light mode they are dark with light labels. `--text-on-semantic` flips accordingly. Holding it fixed squeezes the light band until the categories collapse, which shipped briefly before being caught by the `/__theme` audit page.

---

## Functional colour: what must never be themed

Some colour conveys physical, real-world instruction. Theming it makes the app **wrong**, not off-brand. The register lives in [FUNCTIONAL-COLOR.md](FUNCTIONAL-COLOR.md); the short version:

| What | Why |
|---|---|
| `WIRE_COLORS` | The user is holding a physical wire against a breadboard |
| `FRAME_COLORS` and the default | User-chosen, persisted per project |
| Widget colour defaults and fallbacks | Frozen into the project file as literal hex |
| Example project widget colours | Saved user data |
| `--pin-high` / `--pin-low` | Reports what the hardware is doing |
| `theme-color` meta literals | Browser chrome cannot resolve a custom property |

Saved colours are never rewritten. Nothing in `persistence.ts` or `projectManager.ts` references a colour at all, so they pass through by construction — and there is a round-trip test proving it.

Widget defaults are the one thing that may change, and they carry an unusual constraint: a widget colour cannot be theme-aware, so each default is placed at the lightness that maximises the *worse* of its two card surfaces (~3.5:1 on both).

---

## What enforces this

| Gate | What it catches |
|---|---|
| `npm run contrast` | Any pairing below its bar, in either theme; category greyscale regressions; the §3.7 stale-vs-connected separation |
| ESLint — default palette | `bg-slate-800` and friends. The palette is removed, so these generate **nothing** and fail silently; the rule makes it loud |
| ESLint — raw colour | Any `#hex`, `rgb()` or `hsl()` outside `tokens.css` and the exempt list |
| `functionalColor.test.ts` | Wire colours staying literal, the halo, defaults legible on both cards, saved colours round-tripping |
| `theme.test.tsx` | Preference storage, `data-theme`, 20 toggles with no stale token reads |
| CI — tokens drift | `tokens.css` no longer matching what the generator produces |

The exempt list is in `eslint.config.js` with a reason per entry. **Adding a file there without adding it to `FUNCTIONAL-COLOR.md` is how the list rots.**

---

## Gotchas

**Tailwind v4, not v3.** There is no `tailwind.config.ts` and v4 does not read one. `@theme` in CSS is the equivalent, and `inline` is required — a plain `@theme` snapshots the value at `:root` and utilities stop following `data-theme`.

**`--text-*` is Tailwind's font-size namespace.** Our text tokens are plain custom properties in `:root`, deliberately not inside `@theme`. Putting `--text-primary` in a `@theme` block would register it as a font size.

**Use a `var()` unless the target is a canvas.** React Flow renders SVG, and CodeMirror's `HighlightStyle` compiles to real CSS, so both take `var()` and follow a theme change with no subscription. uPlot paints to a 2D context and is the only consumer that needs `useThemeTokens`. A subscription where a `var()` would do is a thing that can go stale.

**`.gitignore` affects Tailwind.** v4 skips anything `.gitignore` matches when auto-detecting sources. An unanchored `build/` once hid `client/src/build/`, so `BuildPanel.tsx` never had its classes generated. `tokens.css` now declares `@source` explicitly so this cannot recur.

**Deriving colours against a threshold collapses them.** Walking each colour's lightness until it clears a ratio lands every one of them on the same luminance. This produced four identical chart series and ten identical node categories, in separate phases. Place related colours on a **luminance ladder** instead, keyed to target ratios, so the separations hold as ratios-of-ratios regardless of the ground.

---

## Reference

| Doc | Contents |
|---|---|
| [TAILWIND-TOKENS.md](TAILWIND-TOKENS.md) | The v4 utility mapping |
| [FUNCTIONAL-COLOR.md](FUNCTIONAL-COLOR.md) | The exemption register, and the source of the lint allowlist |

The per-phase records from the original theming work (the colour inventory, the
contrast before/after tables, the component sweep, the JS-configured surfaces,
and the `/__theme` audit) are not part of the repository. This file is the
maintained version of everything in them that still applies.
