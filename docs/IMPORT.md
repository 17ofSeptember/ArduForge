# Sketch import — decisions record

Companion to `IMPORT.md` at the repo root, which holds the plan. This file
holds what was *measured* and what was *decided*, so a later phase does not
rediscover a dead end or quietly relitigate a settled call.

Start each session with: `Read IMPORT.md and docs/IMPORT.md. Execute Phase N
only. Report the corpus pass rate at the end.`

**Status: Phase 3 complete.** Expression lowering. Gate 1, Gate 2 and Gate 3 all
at 40/40. Statement coverage 31% / 41% / 34%; **expression coverage 75%** (186
native expression nodes against 63 Raw Expression) — that is the metric this
phase moves, since expression lowering changes what is *inside* statements
rather than how many of them lower.

Tier A structural is 0/11. The whole remaining tail is Phase 4 pattern lifting:
`control.everyMs` in 9 sketches, plus `button.onPress` and `event.interrupt`.

The governing rule from Phase 3 applies to the rest of the importer: **lower to
a native node only when no edge in the resulting subtree introduces a cast.**
`applyCast` wraps a value only when it crosses into a `float` or `string` port,
so this is mechanically checkable rather than a judgement call, and it is what
kept integer arithmetic from silently becoming floating-point.

---

Registry contract changes made during these phases are documented separately in
[NODE-REGISTRY.md](NODE-REGISTRY.md), including which defaults exist solely to
keep saved projects byte-identical and what breaks if they are "tidied".

## Commands

| Command | What it does |
|---|---|
| `npm run import:grammar` | Verifies tree-sitter-cpp loads, parses, and recovers (§0.3) |
| `npm run import:selftest` | Proves the harness gates discriminate in both directions |
| `npm run import:frontend` | Phase 1 gate: preprocess, parse, source-map round-trip, comment accounting |
| `npm run import:idempotence` | Non-negotiable #5: `import(generate(import(x))) == import(x)` |
| `npm run import:build-corpus` | Regenerates Tier A, re-copies Tier B, compiles everything, writes the manifest |
| `npm run import:corpus` | The fidelity table across all three tiers |
| `npm run import:fidelity -- <path>` | One sketch, with a unified diff |

`npm run check` runs grammar → selftest → frontend → idempotence → corpus, in
that order. A broken harness invalidates every corpus number, so it is checked
first.

---

## Phase 0 baseline (the number to beat)

40 corpus sketches. All 40 compile from source. With no importer, every gate
fails:

| Tier | Sketches | Gate 1 | Gate 2 | Gate 3 | Structural |
|---|---|---|---|---|---|
| A — ArduForge examples | 11 | 0/11 | 0/11 | 0/11 | 0/11 |
| B — Arduino bundled | 17 | 0/17 | 0/17 | 0/17 | n/a |
| C — the wild | 12 | 0/12 | 0/12 | 0/12 | n/a |

**Structural** is a fourth check beyond the three gates, and it applies to Tier A
only. Each Tier A folder carries the `.forge` its `.ino` was generated from, so
the import must land back on *that graph* — not merely on something that
compiles to the same bytes. It compares a canonical serialization walked from
the entry nodes, ignoring node ids and positions, since ids are hashes of source
position and layout is Phase 5's job. §0.2 calls this the tightest possible
test, and it is the reason a Tier A failure is always an importer bug rather
than an unsupported construct.

Thresholds live in `corpus/expectations.json` and are enforced by the corpus
runner, which fails on any drop below them. Re-record at each phase exit:
`npm run import:corpus -- --record`.

### The metrics are floors plus one ratchet

Gate 1 and Gate 3 are **floors**, marked ▲ in the totals table. Once Phase 1's
whole-file fallback lands, every sketch imports to a valid graph whose
regenerated source is byte-identical, so both sit at 40/40 permanently. The
runner labels a drop below a floor `[HARD STOP]` rather than `[regression]`,
because it means a sketch became unimportable or stopped compiling — not that a
threshold was set too optimistically.

**Coverage** — imported nodes on native rather than Custom C++ nodes, pooled
across each tier so a five-node sketch cannot outweigh a two-hundred-node one —
is the only ratcheting metric. It is what statement lowering, expression
lowering, and pattern lifting actually move. Gate 2 and the Tier A structural
check are per-tier counts that climb alongside it.

---

## Phase 2 results

| Tier | Sketches | Gate 1 ▲ | Gate 2 | Gate 3 ▲ | Coverage | Structural |
|---|---|---|---|---|---|---|
| A | 11 | 11/11 | 11/11 | 11/11 | 21% | 0/11 |
| B | 17 | 17/17 | 17/17 | 17/17 | 24% | n/a |
| C | 12 | 12/12 | 12/12 | 12/12 | 16% | n/a |

Comments: 322/322 attached **and** 322/322 surviving lowering and re-emission.
Idempotence 40/40. Source map 800/800.

### The argument rule: literal, or Raw Expression — never a placeholder

A statement lowers when its *shape* is recognized. Its arguments then go one of
exactly two ways:

- **A literal** — a number in the notation the user wrote, or a constant like
  `HIGH`, `A0`, `LED_BUILTIN` — becomes an inline literal on the input port.
  `literalToCpp` emits a string on a non-string port *bare*, which is what makes
  `0x1A` come back as `0x1A` rather than `26`.
- **Anything else** becomes a Raw Expression node wired to that port, which is
  what §Fallback granularity prescribes.

There is no placeholder, and there is no "statement stays Raw until Phase 3".
A placeholder would emit code that differs from the source, which breaks Gate 1;
deferring whole statements would make coverage a measure of how much Phase 3 is
missing rather than of how much Phase 2 lowered.

### What deliberately does not lower, and why it is the node model's fault

Each of these is a property of the *registry*, not the parser. Forcing them
produces a wrong graph rather than a missing one:

| Construct | Blocker |
|---|---|
| Declarations | `var.declare` emits at **global scope** (`variables.ts` `collect`). Lowering a local would hoist it, changing lifetime and initialization order. |
| `for` loops | `control.for` generates its own index `_af_i_<hash>`; a body using the user's loop variable would not compile. |
| `if` with anything after it | `control.if` has `true`/`false` and **no continuation output**. An `if` lowers only when last in its block. |
| `break` / `continue` / `return` mid-block | None of the three has an exec output. Lowering one that is not last orphans everything after it. |
| `Serial.print(x)`, `return x` | Both ports are typed `string`, so a non-string argument is wrapped in `String(...)` — a different overload, different machine code. |
| `switch` | Phase 4 chooses between State Machine, If-chain, and Raw. |

The first four are worth a registry change before Phase 4: a continuation output
on If, a configurable index name on For, and a scope option on Declare Variable
would each unlock a large slice of coverage.

### Tier A structural: 0/11, and every failure names its phase

All eleven pass Gate 1 while failing structurally, which is exactly the case
that metric exists to catch — the graph means the same thing but is not the
graph the `.ino` came from.

| Divergence | Sketches | Unlocked by |
|---|---|---|
| `awrylink_poll();` imported as a Raw Statement | 9 | AwryLink round-trip — the injected block must map back to `expose: true` |
| `control.everyMs` expected, got raw `millis()` handling | 8 | Phase 4 §4.2 |
| `io.analogRead{pin="A0"}` expected | 1 (Blink) | Phase 3 |
| `button.onPress` expected | 1 (ButtonLED) | Phase 4 §4.3 |
| `event.interrupt` expected | 1 (TrafficLight) | Phase 4 |

### Gate 2 gained three normalizations, each with a guard

Codegen produces shapes that are semantically identical to the source but
structurally different, so the normalizer now unwraps redundant parentheses,
drops an empty `else`, and treats `if (c) stmt;` as `if (c) { stmt; }`. Every
one is paired with a self-test that the *meaningful* version still compares
unequal — precedence, operators, real else branches, and branches trading
places. Without those guards each normalization is a step toward a rubber stamp.

### Four bugs, and which gate caught each

Worth recording because the gates caught different classes and no single one
would have caught them all:

| Bug | Caught by |
|---|---|
| `break`/`continue`/`return` lowered mid-block orphaned every following statement | **Gate 1 + token loss** — the floor did its job on its first load-bearing phase |
| Multi-line Raw Statements re-indented on every round trip | Idempotence |
| `condition_clause` text includes its parentheses, so conditions nested one level deeper per round | Idempotence |
| Argument Raw Expressions not unwrapped before wiring, same accumulation | Idempotence |
| Comments in an empty block (`void setup(){ // … }`) had no node to live on | Comment survival |
| Codegen's `// nothing connected` re-imported as a real `else` branch | Idempotence |

Gate 1 caught the one that changed the program. Idempotence caught three that
were invisible to it. Comment survival caught the one both were blind to.

---

## Phase 1 results

| Tier | Sketches | Gate 1 ▲ | Gate 2 | Gate 3 ▲ | Coverage | Structural |
|---|---|---|---|---|---|---|
| A | 11 | 11/11 | 11/11 | 11/11 | 0% | 0/11 |
| B | 17 | 17/17 | 17/17 | 17/17 | 0% | n/a |
| C | 12 | 12/12 | 12/12 | 12/12 | 0% | n/a |

Source map: 800 nodes resolved and verified against the original text, 20 per
sketch, seeded so a failure replays. Comments: 367/367 attached. Idempotence:
40/40.

Gate 1 and Gate 3 floors are now recorded at tier size and armed — a later
phase that breaks one gets `[HARD STOP]`, not a threshold miss. Tier A
structural is 0/11 and stays there until Phase 2: fallback lowering produces a
Raw graph, not the graph the `.ino` was generated from.

### Why coverage is 0% and that is correct

Phase 1 deliberately implements the *fallback* end of the lowering spectrum.
Everything becomes a Raw node, so the regenerated sketch is the user's own text
and Gate 1 is trivially satisfied. That is the point: it establishes the floors
before any lowering rule exists that could break them. Coverage is the ratchet
Phases 2–4 move.

### setup() and loop() are split out, and they have to be

Codegen emits `void setup()` and `void loop()` unconditionally
(`generate.ts:538,548`), so a single Raw Global holding the whole file defines
both twice and fails to compile. Codegen also *sorts* globals
(`generate.ts:507`), so emitting one Raw Global per declaration would scramble
initialization order and violate non-negotiable #10.

Both constraints point the same way: one Raw Global holding everything except
the two entry functions, in source order, plus a Raw Statement for each entry
body. That is the minimum structure that is valid, order-preserving, and where
Phase 2 starts lowering.

### Two idempotence bugs no fidelity gate could catch

Both were invisible to Gate 1, because both were whitespace or comments and
neither changes compiled output:

- Codegen re-indents a Raw node's body when emitting it back inside
  `void loop() {`. Every round trip added two more spaces. Fixed by dedenting
  captured text to a baseline, preserving relative nesting.
- Re-importing a generated sketch captured ArduForge's own banner as user code,
  stacking another copy each round. Fixed by an exact match on the banner — the
  box rule, the byline, the closing rule — so a user's own header comment is
  never mistaken for ours.

This is the argument for `npm run import:idempotence` existing as a standing
gate rather than a one-off check: it is the only thing watching the class of
defect the fidelity gates are blind to by construction.

---

## Decisions

### Parser: `tree-sitter-cpp`'s own wasm, not `tree-sitter-wasms`

`tree-sitter-wasms@0.1.13` is the package a search turns up first and it does
not work: its prebuilt `tree-sitter-cpp.wasm` is compiled against an older
runtime, and `web-tree-sitter@0.26` rejects it with a bare `Error` from
`getDylinkMetadata` that names neither the file nor the cause.

The grammar wasm ships **inside `tree-sitter-cpp@0.23.4`** at the package root.
That one loads cleanly, reports ABI 14, and parses correctly. Verified pairing:

```
web-tree-sitter  0.26.12
tree-sitter-cpp  0.23.4   (require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm'))
```

Also note `web-tree-sitter` changed its module shape: 0.24 and earlier are
CommonJS with no named `Language` export. Do not downgrade below 0.25 without
rewriting `scripts/import/grammar.ts`.

### Gate 1 is trustworthy: hex output is deterministic

Measured before building anything on it. For `arduino:avr:uno`, the emitted
`.hex` is byte-identical across different sketch folder names, different file
names, and different build paths given identical source. Comparison uses the
plain `.hex`, never `.with_bootloader.hex` — the latter is dominated by the
bootloader image and would compare equal across sketches that differ in small
ways.

The self-test re-verifies this on every run, so a toolchain upgrade that breaks
determinism surfaces as a harness failure rather than as mysterious Gate 1
regressions.

### Gate 2 normalizes in two passes, and what that costs

Numbering identifiers by first appearance is itself order-sensitive: sorting
declarations after numbering them can never make a reordered file match,
because every downstream reference has already been numbered differently.

So pass one renders each top-level declaration with declared identifiers masked
to a bare `$`, giving a sort key independent of both order and naming. Pass two
walks the sorted sequence and numbers symbols by first appearance within it.

Two guards keep Gate 2 from becoming a rubber stamp, both covered by the
self-test:

- **Only user-declared identifiers are canonicalized.** Renaming every
  identifier would make `pinMode(13, OUTPUT)` and `digitalWrite(13, OUTPUT)`
  normalize identically.
- **`setup` and `loop` are pinned.** Canonicalizing them consistently would let
  their bodies trade places unnoticed.

**Known cost:** Gate 2 no longer detects a global reordering that changes
initialization order. Gate 1 does, it is the primary gate, and §0.1 asks for
declaration-order normalization here specifically. Accepted deliberately.

### Error recovery is real, but not uniform

Measured on tree-sitter-cpp 0.23.4. This matters for §Fallback granularity —
Phase 1 must not assume an `ERROR` span stops at a line boundary.

| Broken input | ERROR span | Code recovered around it |
|---|---|---|
| Garbage statement inside a function body | exactly the bad line | both `setup` and `loop` ✓ |
| Exotic template at top level | just the `...` token | both ✓ |
| Unbalanced brace | zero-width `MISSING` node | both ✓ |
| Garbage at **top level** | **bleeds into the next line** | only the function *before* it |
| **Unterminated string** | **swallows the whole region** | **nothing** |

The first three are the cases fallback granularity depends on, and they are
asserted in `npm run import:grammar`. The last two are measured and printed, not
asserted — the correct response to them is Phase 7's whole-file fallback (import
as a single Raw Global with a clear message), not a stricter parser.

Practical consequence for Phase 1: an unterminated string or block comment can
cost the *entire* parse. Detect these before lowering, and fall back at file
scope rather than trying to salvage the tree.

**Phase 1 addendum — bleed is not exclusive to top level.** Phase 0 measured it
only at file scope, but it happens inside function bodies too. Given

```cpp
int x = 1 + @@@;
delay(1);
```

tree-sitter returns *one* `declaration` node covering both lines. The enclosing
statement is still the right boundary; it simply happens to have absorbed its
neighbour. Splitting a node tree-sitter says is one thing would be a guess, and
a wrong guess emits broken code.

**Two errors in one body collapse into one outer ERROR node**, so that shape
yields a single region. Distinct regions require errors in distinct containers.

### Amendment C, as implemented: cut on type, not well-formedness

Amendment C says "cut at the next well-formed sibling declaration". Taken
strictly, two malformed functions in a row merge into a single Raw node spanning
both, which contradicts the smallest-unit principle the amendment exists to
serve. The cut is therefore on *sibling type* — is this a declaration where
declarations belong? — and not on whether the sibling is error-free.

This costs nothing in fidelity: adjacent regions are emitted in source order and
reproduce the same bytes as one merged region would, while each failure keeps
its own node. A malformed sibling gets its own region from its own error.

**Punctuation is never absorbed.** A bled ERROR's next sibling is often the
enclosing block's `}`. Swallowing it emits a Raw node with an unbalanced brace —
broken code that still looks plausible. Absorption stops at any unnamed node.

### The importer seam

`client/src/import/importSketch.ts` publishes the contract — `ImportInputFile`,
`ImportResult`, `ImportReport`, `SemanticDivergence`, `ImportWarning` — and
throws `ImporterNotImplementedError`. It exists in Phase 0 so the harness is
written against the real signature rather than a hypothetical one. Phase 1
replaces the body; the §Phase 6 import report renders directly from
`ImportReport`.

---

## Corpus notes

### Tier A is 11 sketches

`IMPORT.md` §0.2 originally said "your own 24 examples". The repo ships **11**
(`client/src/examples/index.ts`, described there as "The 11 bundled examples"),
and the corpus uses all 11. Nothing was dropped — the plan's number was stale,
and §0.2 has been corrected to 11.

### Tier A carries the AwryLink firmware

Ten of the eleven examples expose variables for their dashboards, so codegen
emits `#include "AwryLink.h"`. The corpus therefore writes the full
`sketchFilesFor()` output, not just the `.ino` — without it those ten fail to
compile on a missing header and Gate 1 has nothing to anchor to.

This makes Tier A round-tripping harder than it first looks: a faithful import
has to recognize the generated AwryLink block and map it back to `expose: true`
on the Declare Variable nodes. That block is fixed and generated, so it can be
matched exactly rather than guessed at.

### Tier B is 17 sketches; three notes on provenance

`arduino-cli` does **not** ship the built-in examples — its core install only
carries library examples. The bundled ones come from the Arduino IDE app:

```
/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/Examples
```

- `Sweep` and `Knob` are Servo library examples, sourced from
  `~/Documents/Arduino/libraries/Servo/examples`.
- `ShiftOut` is **not bundled in Arduino IDE 2.x**. It is transcribed from the
  Arduino tutorial and lives in `scripts/build-corpus.ts`, labelled as such in
  the manifest. Flagged because it is the one Tier B sketch that is not a
  verbatim copy of a file on disk.
- `toneMelody` ships a companion `pitches.h`, which makes it a live test of the
  ".h beside the .ino" case in Tier B rather than only Tier C.

A missing Tier B source prints a warning naming the expected path; it never
silently shrinks the corpus.

### Companion files are compiled but not imported

`loadSketch` returns `.ino` files as importer input and `.h`/`.cpp`/`.hpp`/`.c`
separately as `companions`. Companions travel to `arduino-cli` so the sketch
compiles, but are never handed to the importer — that is the hard-case register
line "sketch with a `.h`/`.cpp` beside it: out of scope for v1, detect, warn
clearly, import the `.ino` only".

### Token loss is a byte-level backstop

Non-negotiable #1 is implemented as multiset containment over tree-sitter
leaves, comments excluded. Additions are allowed (prototypes, hoisted
temporaries, parentheses codegen inserts); drops are not.

Consequence worth stating plainly: **it flags renamed identifiers as loss.**
That is intended. It means the importer must carry the user's own variable and
function names through to regenerated output, which is part of fidelity — a
graph that renames `ledPin` to `pin1` has lost something the user wrote.

---

## Hard-case register — status

Every row below has a Tier C sketch exercising it. Handling is decided in
`IMPORT.md`; the column here records where it is tested.

| Case | Tier C sketch |
|---|---|
| Pointers, references, `new`/`delete` | `PointersAndMemory` |
| Structs, classes, enums, typedefs, templates | `TypesAndTemplates` |
| Arrays — declaration, subscript, `sizeof` | `ArraysEverywhere` |
| Multi-dimensional arrays | `ArraysEverywhere` |
| `PROGMEM` / `F()` | `ProgmemAndF` |
| `volatile` + ISR + `attachInterrupt` | `InterruptsAndVolatile` |
| Function overloads | `OverloadsAndDefaults` |
| Default arguments | `OverloadsAndDefaults` |
| `static` locals | `OverloadsAndDefaults` |
| Recursive functions | `OverloadsAndDefaults` |
| `goto` / labels | `GotoAndAsm` |
| Inline assembly | `GotoAndAsm` |
| Preprocessor conditionals | `PreprocessorMaze` |
| Object-like and function-like `#define` | `PreprocessorMaze` |
| A second `.ino` in the folder | `MultiFileSketch` |
| Sketch with a `.h`/`.cpp` beside it | `SketchWithHeader`, `toneMelody` (Tier B) |
| Global initialization order | `TypesAndTemplates`, `MessyRealWorld` |
| Rollover-unsafe `millis()` | `TimingTraps` |
| Duplicated impure expression (divergence bait) | `TimingTraps` |
| Precedence-sensitive expressions | `MessyRealWorld` |

One deliberate authoring note: `OverloadsAndDefaults` calls `blend(1.5f, 2.5f)`
with the `f` suffix. Bare `1.5` is a `double`, and `double → int` and
`double → float` are equally ranked conversions, so the overloaded call is
ambiguous and the sketch does not compile. The suffix is load-bearing, not
style.
