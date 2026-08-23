

The codebase is being retheme to a new 5-color palette. The source file `theme.css` is a **starting point, not the final token set**. It contains real problems that must be fixed during migration, documented in Phase 1. Do not apply it verbatim.

**The palette:**

| Name | Hex | Role |
|---|---|---|
| Crimson | `#B80C09` | destructive / error |
| Slate Blue | `#0B4F6C` | structural / secondary |
| Electric Cyan | `#01BAEF` | primary interactive |
| Ghost White | `#FBFBFF` | light background / inverse text |
| Rich Black | `#040F16` | dark background / primary text |

**Take only the `:root` and `@media (prefers-color-scheme: dark)` token blocks from `theme.css`. Discard the example utility classes at the bottom** (`.card`, `.btn-primary`, `.btn-danger`, `.text-link`, `.header`, `.sidebar`). This project styles with Tailwind. Importing those classes creates a second, competing styling system that will drift out of sync within a week.

---

## THE CENTRAL CONSTRAINT — read before anything else

`BUILD_PLAN.md` defines two functional color systems that carry **meaning**, not decoration:

- **10 node category hues** (violet / amber / crimson / blue / cyan / green / yellow / slate / pink / gunmetal) — the user must identify a node's role at a glance without reading text.
- **7 port type colors** (exec white, bool crimson, int blue, float green, string magenta, pin amber, any grey) — these are how the user knows an edge is legal.

**A 5-color palette with roughly 3 usable hues cannot express either system.** If you flatten node categories and port types into this palette, every node becomes cyan-on-slate and the canvas becomes unreadable. That would destroy the single most important usability property of the tool.

**Resolution:** split the color system in two.

1. **Chrome tokens** — app shell, panels, toolbars, buttons, inputs, typography, borders, modals. These come from the new palette. This is what "retheming" means.
2. **Semantic tokens** — node categories, port types, chart series, wire colors, status states. These keep full hue separation but are **harmonized** to the new palette: re-derive each hue at a chroma and lightness that matches the palette's envelope, so they read as one family rather than a rainbow pasted onto a new background.

Do this in OKLCH, not HSL. Sample the OKLCH lightness and chroma of the five primitives, take the median, then regenerate the 10 category hues at that L/C holding only hue constant. The result feels like it belongs to the palette while staying fully distinguishable. Cyan and crimson are already in the palette, so anchor those two and fit the rest around them.

---

## Phase 0 — Inventory & token foundation

**No visual changes in this phase.**

### 0.1 Color inventory

Produce `docs/COLOR-INVENTORY.md` listing **every** place a color is defined in the repo. Search exhaustively — this is where retheming jobs go wrong, because most of the color in this app isn't in CSS:

- Raw hex literals (`#[0-9a-fA-F]{3,8}`) in `.ts`, `.tsx`, `.css`, `.svg`, `.json`
- `rgb()`, `rgba()`, `hsl()`, `oklch()` literals
- Tailwind color utilities with hardcoded palette names (`bg-slate-800`, `text-zinc-400`, `border-neutral-700`)
- **React Flow**: edge stroke colors, marker/arrowhead fills, handle colors, selection box, minimap node colors, background dot/grid color — these are set via props and inline styles, not CSS
- **uPlot**: series stroke/fill, axis, grid, tick, cursor, and legend colors — all JS config objects
- **CodeMirror 6**: the entire C++ syntax highlight theme is a JS object (`EditorView.theme` + `HighlightStyle`), invisible to any CSS sweep
- **Inline SVGs** in the 24 example wiring diagrams — hardcoded strokes and fills
- **Icons**: `lucide-react` color props
- Canvas 2D / WebGL draw calls, if any
- `<meta name="theme-color">`, favicon, manifest, loading splash, any `index.html` inline styles
- Toast, badge, and status-pill color maps
- Anything computed at runtime (`interpolateColor`, gradient stops, heatmaps)

For each entry record: file:line, current value, what it colors, and which of the four buckets it belongs to — **chrome**, **semantic**, **functional-exempt** (see Phase 5), or **dead**.

### 0.2 Build the real token system

The uploaded file has ~12 tokens. This app needs roughly 60. Create `client/src/styles/tokens.css` with:

**Ramps.** Generate a 50–900 scale for each of the five primitives (11 steps each) in OKLCH. Five flat colors cannot express hover, active, pressed, disabled, focus, selected, and five levels of elevation. Everything downstream references ramp steps, never the raw primitives.

**Elevation — at least 6 levels.** The uploaded file gives 3 (`bg-app`, `bg-surface`, `bg-structural`); this UI needs: app background → panel → card/node body → node header → input field → popover/menu/tooltip → modal. Each step must be distinguishable at a glance without relying on borders alone.

**Missing token categories to add** (none of these exist in the source file, and every one of them appears in the UI):

| Category | Tokens needed |
|---|---|
| Focus | `--focus-ring`, `--focus-ring-offset` — must be visible on *every* surface level |
| Disabled | `--bg-disabled`, `--text-disabled`, `--border-disabled` |
| Selection | `--bg-selected`, `--border-selected`, `--text-selected` |
| Feedback | `--feedback-success`, `--feedback-warning`, `--feedback-info` (only `destructive` exists today — the app needs success for "upload complete" and warning for "PWM pin conflict") |
| Overlay | `--scrim`, `--shadow-color`, shadow definitions at 3 elevations |
| Scrollbar | thumb, thumb-hover, track |
| Connection status | idle / connecting / connected / streaming / stale / error — six distinct, and `stale` must be visually distinct from `connected`, because §3.7 of the build plan requires the user to never mistake frozen values for live ones |
| Code editor | ~10 syntax tokens for C++ (keyword, type, string, number, comment, preprocessor, function, operator, punctuation, error squiggle) |
| Charts | ≥4 series colors distinguishable from each other *and* from the gridlines *and* from each other in grayscale |

### 0.3 Theme switching mechanism

The uploaded file gates dark mode behind `@media (prefers-color-scheme: dark)` only. That means a user on a light-mode OS has **no way to reach dark mode**, and the build plan specifies dark as the default. Replace with:

```css
:root { /* light tokens */ }
:root[data-theme="dark"] { /* dark tokens */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark tokens */ }
}
```

Persist the choice, default to dark, offer System / Light / Dark in settings, and set `data-theme` **before first paint** via an inline script in `index.html` — otherwise every load flashes the wrong theme.

**Deliverable:** inventory doc + `tokens.css` + switching mechanism. No components touched yet.

---

## Phase 1 — Fix the contrast failures

These are computed WCAG 2.1 contrast ratios for combinations the uploaded file actually specifies. They are not hypothetical; they are what the file produces as written.

| Combination | Where | Ratio | Required | Verdict |
|---|---|---|---|---|
| Crimson `#B80C09` on Slate Blue `#0B4F6C` | destructive text on a **dark-mode card** (`--bg-surface` is slate blue in dark mode) | **≈1.3:1** | 4.5:1 | Effectively invisible |
| Crimson `#B80C09` on Rich Black `#040F16` | error text on dark app background | **≈2.8:1** | 4.5:1 | Fails |
| Electric Cyan `#01BAEF` on Ghost White `#FBFBFF` | `.text-link` and any primary-colored text in **light mode** | **≈2.2:1** | 4.5:1 | Fails badly |
| `--text-secondary` `#90B3C4` on Slate Blue `#0B4F6C` | secondary text on dark-mode cards | **≈4.0:1** | 4.5:1 | Marginal fail |
| Electric Cyan on Slate Blue | links/primary text on dark-mode cards | **≈3.9:1** | 4.5:1 | Marginal fail |
| Rich Black on Electric Cyan | `.btn-primary` label | ≈8.4:1 | 4.5:1 | Passes — keep |
| Ghost White on Slate Blue | inverse text on structural chrome | ≈8.7:1 | 4.5:1 | Passes |
| Slate Blue on Ghost White | secondary text, light mode | ≈8.7:1 | 4.5:1 | Passes |

**The pattern:** cyan and crimson work as **fills** (with dark text on top) but fail as **text or borders**. Both need lightened variants for use on dark surfaces and a darkened cyan for use as text on light surfaces.

Fixes required:

1. Derive `--feedback-destructive-on-dark` — lighten crimson in OKLCH until it clears 4.5:1 against *both* the dark app background and the dark card surface. Expect to land somewhere around `#FF5C52`. Keep the original `#B80C09` for light-mode text and for fills that carry white text.
2. Derive `--interactive-primary-text-light` — darken cyan until it clears 4.5:1 on ghost white. Expect around `#0177A0`. Keep `#01BAEF` for fills, focus rings, active borders, and chart strokes, where 3:1 against adjacent color is the applicable bar.
3. **Reconsider slate blue as the dark-mode card surface.** A fully saturated `#0B4F6C` card sitting on a near-black `#040F16` background is a large, saturated jump that makes text on cards hard to tune and eats most of the available contrast headroom before you've placed anything on it. Use a desaturated slate-blue tint (roughly ramp step 900–950 — same hue, much lower chroma and lightness) as the card surface, and reserve full-saturation slate blue for structural chrome like the toolbar and sidebar, which carry only high-contrast inverse text. Show me both options in the Phase 6 audit page before committing.
4. Raise `--text-secondary` in dark mode until it clears 4.5:1 against whatever surface you land on in (3).

**Every fix must be verified by computed ratio, not by eye.** Add a script at `scripts/contrast-check.ts` that parses `tokens.css`, computes every foreground/background pairing the app actually uses, and fails the build on any pair below 4.5:1 for body text or 3:1 for UI components and large text. Run it in CI.

---

## Phase 2 — Wire tokens into Tailwind

Extend `tailwind.config.ts` so every token is a real utility:

```ts
colors: {
  app:        'var(--bg-app)',
  surface:    'var(--bg-surface)',
  elevated:   'var(--bg-elevated)',
  structural: 'var(--bg-structural)',
  // …
}
```

Then **remove Tailwind's default palette** from the config, or at minimum add an ESLint rule banning `bg-slate-*`, `text-zinc-*`, `border-gray-*` and friends. If the default palette stays reachable, hardcoded utilities will creep back in and the theme will rot. The token file must be the only source of color.

---

## Phase 3 — Sweep chrome

Work file by file, in this order. Commit per area.

1. App shell: layout, toolbar, sidebar, status bar, tabs
2. Panels: inspector, problems, build output, project browser
3. Form controls: inputs, selects, checkboxes, sliders, number steppers — **check focus rings on every surface level**, this is where they get lost
4. Buttons: every variant × every state (default / hover / active / focus / disabled / loading)
5. Modals, popovers, dropdowns, context menus, tooltips, command palette
6. Toasts and badges — map to the new success/warning/info/destructive tokens
7. Empty states, skeletons, spinners
8. Scrollbars, resize handles, drag affordances, splitter bars

---

## Phase 4 — The JS-configured color (where retheming jobs fail)

None of this is reachable by a CSS sweep. Each needs code changes that read from tokens at runtime.

**Pattern:** create `client/src/styles/useThemeTokens.ts` that reads computed CSS custom property values via `getComputedStyle(document.documentElement)` and re-reads on theme change. JS consumers subscribe to it. **Do not duplicate hex values into TypeScript constants** — that guarantees drift the first time a token is tweaked.

- **React Flow** — edge strokes, arrowhead markers, connection line preview, selection rectangle, handle fill/border, minimap node + mask colors, background pattern color. Verify edges are still visible against the new canvas background at every zoom level.
- **uPlot** — series strokes and fills, axis, grid, ticks, cursor crosshair, legend. Grid must be clearly subordinate to series lines; if gridlines compete visually the charts become unreadable at 20Hz.
- **CodeMirror 6** — rebuild the C++ theme as an `EditorView.theme` + `HighlightStyle` driven by tokens. Include: gutter, active line, selection, matching brackets, search highlight, and the error squiggle. Generated code is a primary surface in this app; it can't look like an afterthought.
- **Node canvas components** — category header hues and port type colors from the harmonized semantic set built in Phase 0.
- **Dashboard widgets** — gauge zones, LED indicator on/off, bar meters, XY pad, chart series, terminal text. Note the carve-out in Phase 5.
- **Icons** — `lucide-react` `color` props and `stroke` values.
- **Static assets** — favicon, `<meta name="theme-color">`, web manifest, any pre-hydration loading splash in `index.html`.

---

## Phase 5 — Functional color that must NOT be themed

Some color in this app conveys physical, real-world instruction. Retheming it makes the app actively wrong. Explicitly exempt and document each:

- **Wiring diagram wire colors.** The examples establish a convention — red = 5V/VCC, black = GND, yellow/green = signal, blue = SDA, white = SCL, orange = PWM — and the user is following it with physical wires on a physical breadboard. **These stay literal.** Only the diagram's *chrome* (background, board outline, labels, callout lines, dimension marks) is themed. Add a comment at the top of every diagram SVG saying so, or a future sweep will "fix" them.
  - Consequence: black and white wires must remain visible in **both** themes. Give wire strokes a thin contrasting outline (a 1px halo in the surface color) so a black wire reads on a dark diagram background and a white wire reads on a light one.
- **Component polarity markers** in diagrams — red/black for anode/cathode is convention, not decoration.
- **User-configured widget colors.** LED indicator on/off colors, gauge zone thresholds, chart series colors, and button colors are all per-widget settings in the plan. Migrate existing saved projects' colors as-is; only change the *defaults* offered to new widgets. Silently rewriting a user's saved dashboard colors is data loss.
- **Live pin state indicators** — HIGH/LOW must stay unambiguous and must not collide with the connection-status colors sitting next to them.

---

## Phase 6 — Verification

### 6.1 The theme audit page

Add a dev-only route `/__theme` that renders, in one scrollable page:

- Every token as a labeled swatch with its hex, its OKLCH value, and its computed contrast ratio against the surface it sits on — **pass/fail badge on each**
- Every button variant × every state
- Every form control, focused and unfocused, on every surface level
- All 10 node categories side by side, at 100% and 50% zoom
- All 7 port types, and every legal edge type rendered on the canvas background
- Every dashboard widget, populated with live-looking data
- All 6 connection states
- A code editor sample with every C++ syntax token exercised
- A chart with 4 series
- Every toast and badge variant

This page is how "everything looks perfect" gets verified. Reviewing screenshots of individual features will miss the combinations.

### 6.2 Checks

- Run `scripts/contrast-check.ts` — zero failures.
- Render `/__theme` in light and dark, side by side. Nothing invisible, nothing vibrating, no element that disappears against its background.
- **Grayscale test:** screenshot `/__theme`, desaturate it, and confirm the 10 node categories and 4 chart series are still distinguishable by lightness alone. Roughly 8% of men have a color vision deficiency, and the plan's category set leans hard on red/green/amber. Where lightness alone isn't enough, lean on the icon and shape redundancy the node design already provides.
- Load 5 example projects and confirm the wiring diagrams read correctly in both themes, with black and white wires visible in each.
- Toggle themes 20× with the dashboard live-streaming. Assert no flash, no dropped frames, no stale colors in the JS-configured surfaces (React Flow, uPlot, CodeMirror all need to actually re-read tokens, not just the CSS-driven parts).
- Confirm no theme flash on cold load.
- Re-run the full test suite — snapshot tests will have churn; review each diff rather than blanket-updating.

---

## Phase 7 — Lock it in

1. Add a lint rule failing the build on any raw hex, `rgb()`, or `hsl()` literal outside `tokens.css` and the Phase 5 exempt files. Maintain the exempt list explicitly, with a comment on each entry explaining why.
2. Add `scripts/contrast-check.ts` to CI.
3. Write `docs/THEMING.md`: the token taxonomy, the chrome-vs-semantic split, the Phase 5 exemptions and their rationale, how to add a new token, and how to add a new node category hue without breaking harmony.
4. Delete the uploaded `theme.css` once its tokens are absorbed, so nobody edits the wrong file.

---

## Rules

- **No visual change without a token.** If a color is needed and no token fits, add the token — never inline a value.
- **Report every contrast fix with before/after ratios.** I want the numbers, not "improved contrast."
- **Do not silently drop node category or port type distinctions to fit the palette.** If a harmonized hue can't be made to work, stop and tell me — that's a `NEEDS-DECISION`, not something to quietly resolve by making two categories similar.
- **Screenshot `/__theme` in both modes at the end of every phase** so regressions surface immediately rather than at the end.
