# Functional colour — Phase 5

_THEME.md Phase 5. The colour in this app that carries physical, real-world instruction. Theming it makes the app **actively wrong**, not merely off-brand._

This is the exemption register. Phase 7's raw-hex lint rule takes its allowlist from here.

## The register

| # | What | Where | Why it is exempt |
|---|---|---|---|
| E1 | Wiring diagram wire colours | [`builder.ts`](../client/src/examples/builder.ts) `WIRE_COLORS` | The user is holding a physical wire against a breadboard and matching it to the diagram |
| E2 | Frame colour palette + default | [`graph/model.ts`](../client/src/graph/model.ts) `FRAME_COLORS`, [`graphStore.ts`](../client/src/store/graphStore.ts) | User-chosen, persisted per project |
| E3 | Widget colour defaults | [`dashboard/model.ts`](../client/src/dashboard/model.ts) `WIDGET_SPECS` | Per-widget setting; only *defaults for new widgets* may change |
| E4 | Example project widget colours | [`examples/index.ts`](../client/src/examples/index.ts) | Saved project data |
| E5 | Live pin state | [`PinInspector.tsx`](../client/src/dashboard/PinInspector.tsx) | Reports what the hardware is doing |
| E6 | LED on/off | [`widgets/index.tsx`](../client/src/dashboard/widgets/index.tsx) | User-configured |
| E8 | RGB colour-picker initial value | [`widgets/index.tsx`](../client/src/dashboard/widgets/index.tsx) `ColorWidget` | The starting colour a user sees before picking; Phase 0 misfiled it as dead code |
| E7 | `theme-color` meta literals | [`theme.ts`](../client/src/styles/theme.ts), [`index.html`](../client/index.html) | Browser chrome cannot resolve a custom property |

Seven of these are enforced by [`functionalColor.test.ts`](../client/src/examples/functionalColor.test.ts), because the failure mode is silent: a future sweep sees literal hex and "fixes" it, and nothing breaks loudly.

---

## E1 — Wire colours now follow the convention

Phase 0 flagged this as NEEDS-DECISION #4 and it was never resolved, so I implemented what THEME.md itself describes rather than leaving the diagrams contradicting the spec.

THEME.md states the convention as "red = 5V/VCC, black = GND, yellow/green = signal, blue = SDA, white = SCL, orange = PWM". The implementation had four kinds and **ground was slate grey**, which is not a colour any ground wire has ever been.

| Kind | Before | Now | |
|---|---|---|---|
| `power` | `#E5484D` | `#E5484D` | red — unchanged, already correct |
| `ground` | `#64748B` slate | **`#1A1A1A`** black | corrected |
| `signal` | `#3E9EFF` blue | **`#EFC544`** yellow | blue is reserved for SDA |
| `data` | `#30A46C` | `#30A46C` | green — unchanged |
| `sda` | — | `#2C7BE5` blue | added |
| `scl` | — | `#F5F5F5` white | added |
| `pwm` | — | `#F08519` orange | added |

**This changes how the 14 example diagrams look** — `signal` appears 24 times and `ground` 11 times. That is the point: the diagrams now match the wires in the box. The three new kinds are unused so far; an I²C example should move from `data` to `sda`/`scl`, which is a content change rather than a theming one.

### The halo

Making the colours literal is what forces the halo THEME.md requires: the set now contains both near-black (`ground`) and near-white (`scl`), and each is invisible against one of the two plate colours.

Measured, not assumed:

| | vs dark plate `#19303C` | vs light plate `#F0F5F8` |
|---|---|---|
| `ground` `#1A1A1A` | **1.27:1** | 15.85:1 |
| `scl` `#F5F5F5` | 12.59:1 | **1.01:1** |

So each wire is drawn twice — a 4px stroke in `var(--bg-card)` underneath, then the 2px literal wire on top — with the same treatment on the endpoint dots. Neither wire relies on contrast against the background any more, and the wire colour itself is untouched.

`WIRE_COLORS` carries a comment saying not to theme it, as THEME.md asks. There is one generator rather than 24 separate SVG files, so one comment covers every diagram.

## E5 — Pin state was colliding with connection status

THEME.md: *"Live pin state indicators — HIGH/LOW must stay unambiguous and must not collide with the connection-status colors sitting next to them."*

It was colliding. `PinInspector` painted HIGH pins in `--feedback-success` (green) at line 136 and rendered a connection dot in that same green at line 228 — in the same panel. A HIGH pin and a live connection were the same colour.

Added `--pin-high` / `--pin-low`. The connection set already owns green (connected), amber (connecting), cyan (streaming), grey (idle) and crimson (error), which leaves violet as the only family that cannot be confused with any of them:

| Token | Dark | Light |
|---|---|---|
| `--pin-high` | `#A486FD` | `#6C4CBD` |
| `--pin-low` | `#233640` | `#CBDAE3` |
| `--conn-connected` | `#1BCB81` | `#008954` |

The button also carries the literal text `HIGH` / `LOW`, so colour is redundancy here rather than the only signal — which is the right way round.

## E3 — Widget defaults: the one thing Phase 5 permits changing

THEME.md allows changing *"only the defaults offered to new widgets"*. Saved projects are untouched, and **nothing in `persistence.ts` or `projectManager.ts` references a colour at all**, so saved values pass through by construction rather than by care. There is a round-trip test asserting a user's `#FF00AA` survives migrate → serialize → migrate.

The defaults have an unusual constraint. A widget colour is frozen into the project file as literal hex, so it *cannot* be theme-aware — the same value renders on the dark card and the light card. Each default is therefore placed at the lightness that maximises the worse of the two:

| Default | Before | Now | vs dark card | vs light card |
|---|---|---|---|---|
| Button | `#3E9EFF` | `#3084D7` | 3.54:1 | 3.54:1 |
| LED | `#30A46C` | `#00945B` | 3.52:1 | 3.55:1 |
| Gauge zone — ok | `#30A46C` | `#00945B` | 3.52:1 | 3.55:1 |
| Gauge zone — warn | `#F5A524` | `#B27400` | 3.53:1 | 3.55:1 |
| Gauge zone — critical | `#E5484D` | `#D25C5B` | 3.55:1 | 3.53:1 |

~3.5:1 on both is the ceiling for a single literal serving two themes; the old values sat below 3:1 on one side or the other. Render-time fallbacks in `WidgetInspector` and `widgets/index.tsx` were aligned to match, so an unset colour and a defaulted one agree.

## E2 / E4 — Frame and example colours

Unchanged and untouched. `FRAME_COLORS` is a user-facing palette picker and the example projects are shipped saved data. Both are quoted in the Phase 3 sweep's "left deliberately" list.

## Component polarity markers

THEME.md exempts red/black anode/cathode markers. **The diagrams do not draw components** — they are pin-to-pin schematic rows, so there is nothing to exempt yet. Recorded here so that whoever adds pictorial components knows the rule applies before they pick a colour.

## Verification

```
lint      ✓
contrast  ✓  290 pairings, both themes, 0 failures
test      ✓  457 passed (381 client + 76 server)
build     ✓
```

7 new tests in `functionalColor.test.ts`:

- wire colours are literal hex, never a token
- the convention holds — red 5V, black GND, blue SDA, white SCL
- the set really does contain a near-black and a near-white wire, and each is measurably unreadable on one plate (which is what justifies the halo)
- every wire is drawn halo-first, then wire — order asserted, because reversing it paints over the wire
- diagram chrome is themed while wires are not, in the same SVG
- widget defaults clear 3:1 on **both** card surfaces
- a user's saved colour round-trips unchanged

## Open

**The three new wire kinds are unused.** `sda`, `scl` and `pwm` exist and are correct, but no example uses them — the I²C examples still say `data`. Reassigning them is a content edit to `examples/index.ts` and wants someone who knows which example wires which bus. Flagged rather than guessed at.
