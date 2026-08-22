# ArduForge — Sketch Import

> **How to run:** Save as `IMPORT.md` at the repo root. Fresh Claude Code session:
>
> `Read IMPORT.md in full. Do not write the importer yet. Execute Phase 0 only — build the fidelity harness and the corpus — then stop.`
>
> One phase per session. Phase 0 builds the thing that judges every later phase, so it comes first even though it produces no user-facing feature.

---

## Mission

Accept an existing Arduino sketch — pasted as text, or dropped as one or more `.ino` files — and produce a node graph that is **semantically identical** to it. Constructs with a native node become native nodes. Everything else lands in a Custom C++ node. Nothing is ever silently dropped.

---

## The fidelity definition

"Matches the code perfectly" is not a judgement call. It is this, in descending order of strength:

**Gate 1 — binary equivalence (the primary gate).**
Compile the original sketch with `arduino-cli`. Import it, regenerate with the existing codegen, compile that. Compare the `.hex` files.

```
original.ino ──compile──> original.hex
     │
   import
     ↓
   graph ──codegen──> regenerated.ino ──compile──> regenerated.hex

PASS ⟺ original.hex == regenerated.hex
```

Identifier renaming, whitespace, comments, and declaration formatting do not affect compiled output, so this tolerates everything that shouldn't matter and catches everything that should. It is the strongest available definition of "identical" and it runs unattended.

**Gate 2 — AST equivalence.** Where Gate 1 legitimately fails (see below), reparse both sketches and compare normalized ASTs — identifiers canonicalized, comments and whitespace stripped, declaration order normalized. A pass here means the difference is cosmetic.

**Gate 3 — compiles and is valid.** The regenerated sketch compiles, and the graph passes ArduForge's own validation. This is the floor. An import that produces a graph which won't generate is a bug regardless of how good it looks on the canvas.

**Where Gate 1 legitimately fails:** if the original evaluates an impure expression twice (`analogRead(A0) + analogRead(A0)`) and codegen's hoisting rule collapses it, machine code differs and the *original* was the buggy one. Log these as `SEMANTIC-DIVERGENCE`, don't auto-fix, surface them to the user as a warning. They are rare and interesting.

Build the harness in Phase 0. Every subsequent phase reports its corpus pass rate against it.

---

## Architecture (decided — do not relitigate)

### Parser: `web-tree-sitter` + `tree-sitter-cpp`

Do not hand-roll a C++ parser. Do not use regex. Do not shell out to clang.

Tree-sitter is chosen for one property above all others: **it is error-tolerant.** When it hits something it can't parse, it emits an `ERROR` node covering that span and keeps going, rather than throwing. That maps exactly onto the fallback requirement — an `ERROR` node's source text becomes a Custom C++ node, and the rest of the file still imports. A parser that throws on unfamiliar C++ would fail the entire import on one template.

It also runs in the browser as WASM, so import stays client-side with no round trip.

**Phase 0 must verify the grammar actually loads before anything else is built.** Confirm `tree-sitter-cpp.wasm` is obtainable, loads under `web-tree-sitter`, and parses a real sketch. If it can't be sourced, stop and report — do not fall back to a hand-written parser.

### `.ino` is not valid C++

The Arduino build system preprocesses before compiling, and the importer must replicate it or the parse will be wrong:

1. Multiple `.ino` files in a sketch folder are concatenated — the one matching the folder name first, then the rest alphabetically.
2. `#include <Arduino.h>` is prepended.
3. **Function prototypes are auto-generated and inserted**, which is why sketches can call functions defined later in the file. Without this, ordering assumptions break.

Replicate this in a preprocessing step, and keep a source map from the concatenated buffer back to `(file, line, column)` so every error and every node can point at the user's original file.

### Fallback granularity — the rule that determines whether this feels good or mechanical

**Always fall back at the smallest unit that fails.** Three Custom node kinds already exist in the node registry (BUILD_PLAN §5k) and each has its own scope:

| Unmappable thing | Becomes | Example |
|---|---|---|
| A statement | **Raw Statement** node (exec in/out) | `Wire.beginTransmission(0x27);` |
| An expression | **Raw Expression** node (typed output) | `(x >> 3) & 0b1010` |
| A top-level declaration | **Raw Global** node | a struct, a class, a template, an `#ifdef` block |

A `for` loop containing one unrecognized call becomes a real **For** node whose body contains one **Raw Statement** — not one giant Raw Statement swallowing the whole loop. Coarse fallback is the difference between an import that's useful and one that's a text editor with extra steps.

---

## Phase 0 — Fidelity harness and corpus

No importer code. Build the judge first.

### 0.1 The harness

`scripts/import-fidelity.ts`:

```
importFidelity(sketchPath) -> {
  gate1: 'pass' | 'fail' | 'n/a',   // hex comparison
  gate2: 'pass' | 'fail',            // normalized AST equivalence
  gate3: 'pass' | 'fail',            // compiles + graph valid
  coverage: { native: n, raw: n, pct: n },
  divergences: SemanticDivergence[],
  diff: string                       // unified diff, original vs regenerated
}
```

Runs headless. `npm run import:corpus` reports a table across the whole corpus with a total pass rate. Wire it into `npm run check`.

### 0.2 The corpus, in three tiers

**Tier A — your own 11 examples (target: 100% Gate 1).**
Free and high quality: generate each example's `.ino` from its `.forge` file, import it back, and require the graph to match the original graph structurally, not just semantically. This is the tightest possible test because you know the ground truth. Any Tier A failure is an importer bug, never an unsupported construct.

**Tier B — Arduino's bundled examples (target: 100% Gate 3, ≥90% Gate 1).**
These are on disk in the arduino-cli install. At minimum: `BareMinimum`, `Blink`, `DigitalReadSerial`, `AnalogReadSerial`, `Fade`, `Button`, `Debounce`, `StateChangeDetection`, `BlinkWithoutDelay`, `AnalogInOutSerial`, `Calibration`, `Smoothing`, `toneMelody`, `Sweep`, `Knob`, `ShiftOut`, `RowColumnScanning`. These are what a beginner actually pastes in.

**Tier C — the wild (target: 100% Gate 3).**
Hand-written messy sketches exercising the hard-case register below. Tier C sketches are *allowed* to be mostly Custom C++ nodes. What they are not allowed to do is fail to import, produce an invalid graph, or lose a single line of code.

### 0.3 Verify the grammar

Load `tree-sitter-cpp.wasm`, parse `Blink.ino` after preprocessing, and dump the AST. Confirm error recovery works by parsing a deliberately broken sketch and checking you get an `ERROR` node plus a valid parse of everything around it.

**Gate:** harness runs, corpus is assembled and committed, grammar parses and recovers. Report the baseline — with no importer, everything fails, and that's the number to beat.

---

## Phase 1 — Preprocessing and the C++ frontend

> **Amendments from Phase 0's findings.** These override the general rules below
> where they conflict. Rationale and measurements are in `docs/IMPORT.md`.
>
> **A. The metrics are restructured.** Gate 1 and Gate 3 are *floors*, not
> climbing numbers. By the end of Phase 1, whole-file fallback means every
> sketch imports to a valid graph whose regenerated source is byte-identical,
> so both hit 100% (40/40) and never drop again. A later drop is a **hard stop**,
> not a threshold miss. **Coverage** — the percentage of imported nodes on
> native rather than Custom C++ nodes — becomes the only ratcheting metric.
> `corpus/expectations.json` and the corpus runner already implement this;
> Phase 1's exit re-records the floors at tier size (11/17/12).
>
> **B. Lexical pre-flight, before tree-sitter sees anything.** An unterminated
> string swallows the entire file, so the parser cannot be the first line of
> defense. Scan first for unterminated string literals, unterminated char
> literals, and unterminated block comments. If any is found, do **not** hand
> the file to tree-sitter expecting useful recovery — go straight to whole-file
> fallback with a message naming the file, the line, and which construct is
> unterminated.
>
> **C. Fallback boundaries are structural, never span-based.** The
> smallest-unit rule below assumed `ERROR` spans are well-scoped; Phase 0 proved
> they bleed at top level. So given an `ERROR` node, walk **up** to the smallest
> enclosing node that is itself well-formed and is a legal fallback boundary —
> a statement, a declaration, or a translation-unit item — and take *that*
> node's extent, never the `ERROR`'s own. At top level, where bleed occurs, cut
> at the next well-formed sibling declaration.
>
> Write the test for C **first**, using the three cases Phase 0 characterized:
> garbage in a function body (exact scoping — must stay tight), garbage at top
> level (bleed — must not swallow the following declaration), and unterminated
> string (must route to whole-file fallback via the pre-flight in B, not to a
> salvaged tree).

- Multi-file concatenation in Arduino's order.
- Prototype generation.
- Source map back to original `(file, line, col)`.
- Parse to AST; collect `ERROR` node spans.
- **Comment attachment.** Comments are not in the AST as first-class nodes. Attach each to the statement or declaration that follows it (or the same line for trailing comments) and carry it as node metadata, so codegen can re-emit it. Losing every comment on import is a silent data loss the fidelity gates won't catch, because comments don't affect compiled output.
- **`#define` handling.** Do not expand macros. An object-like `#define` of a numeric or string literal becomes a Declare Variable node flagged `emitAsDefine`. A function-like macro becomes a Raw Global. Expansion would make the regenerated code diverge visibly from the original even where it compiles identically.
- **`#ifdef` / `#if` blocks.** Do not evaluate. The entire block, directives included, becomes one Raw Global. Conditional compilation cannot be resolved without knowing the full build configuration, and guessing produces a sketch that behaves differently on another board.

**Gate:** every Tier A and Tier B sketch preprocesses and parses without exception. Source map round-trips: pick 20 random AST nodes, resolve to original file/line, verify against the source text.

---

## Phase 2 — Statement lowering

Walk `setup()`, `loop()`, and every user function; emit exec chains.

| C++ | Node |
|---|---|
| `pinMode(p, m)` | Pin Mode |
| `digitalWrite(p, v)` | Digital Write |
| `analogWrite(p, v)` | Analog Write |
| `delay(n)` / `delayMicroseconds(n)` | Delay |
| `tone(...)` / `noTone(p)` | Tone / No Tone |
| `Serial.begin/print/println/...` | the Serial nodes |
| `if` / `if-else` | If |
| `for` (canonical counted form) | For |
| `while` / `do-while` | While / Do-While |
| `break` / `continue` / `return` | matching nodes |
| `switch` | State Machine if it matches the pattern, else If-chain, else Raw |
| assignment / compound assignment | Set Variable / Increment / Decrement |
| declaration with initializer | Declare Variable (scope from position) |
| call to a user function | Function Call |
| a user function definition | Function Define + its own exec chain |
| anything else | **Raw Statement** |

Rules:

- A `for` loop that isn't the canonical `init; cond; step` counted form is a Raw Statement wrapping the whole loop — a While node with a hand-built counter would be a lie about the source.
- Empty `setup()` or `loop()` still emits the entry node.
- Statement order within a chain is preserved exactly. This is non-negotiable; reordering is a semantic change.

**Gate:** Tier A at 100% Gate 1. Tier B Gate 3 at 100%. Report Tier B Gate 1 — expect it to be low here, since components and patterns aren't lifted yet.

---

## Phase 3 — Expression lowering

Build the data subgraph feeding each statement's inputs.

- Literals → Number / Boolean / String literal nodes, **preserving the original notation**: `0x1A`, `0b1010`, `1e3`, `'A'`, `HIGH`, `A0`, `LED_BUILTIN`. Emitting `26` where the user wrote `0x1A` is a fidelity failure even though it compiles the same.
- Binary and unary operators → Math / Logic / Compare / Bitwise nodes.
- `analogRead` / `digitalRead` / `millis` / `micros` / `map` / `constrain` / `min` / `max` / `abs` / `random` / `pulseIn` → their nodes.
- Identifier → Get Variable.
- Ternary → If-expression if one exists, otherwise Raw Expression.
- Function call returning a value → Function Call node with output.
- Casts, pointer ops, member access, array subscript, anything else → **Raw Expression**, typed by inference where possible and `any` where not.

**Operator precedence and associativity must be preserved.** The graph is a tree; when codegen flattens it back to text it must parenthesize to preserve the original grouping. Test with deliberately precedence-sensitive expressions: `a + b * c`, `(a + b) * c`, `a - b - c`, `a << 1 + 2`.

**Do not deduplicate.** If the original calls `analogRead(A0)` twice, emit two nodes. Collapsing them changes behavior. If codegen's hoisting rule then merges them, that's a `SEMANTIC-DIVERGENCE` to report, not to silently apply.

**Gate:** Tier B Gate 1 ≥ 60%. Every precedence test passes.

---

## Phase 4 — Pattern lifting

This is what separates an import that feels intelligent from one that feels mechanical. Each pattern below is currently *distributed* across the sketch and must be collapsed into one node.

### 4.1 Component objects — three locations, one node

```cpp
Servo myServo;              // global declaration
void setup() { myServo.attach(9); }
void loop()  { myServo.write(angle); }
```

That is one **Servo** component node in ArduForge, with pin 9 as config. The importer must correlate the global declaration, the `setup()` initialization, and every method call in the body. Same shape for `LiquidCrystal_I2C lcd(0x27,16,2)`, `Adafruit_NeoPixel`, `DHT`, `SoftwareSerial`, `Stepper`, `RTC_DS3231`, `IRrecv`.

If the correlation is ambiguous — two objects of the same type, a method called on a pointer, initialization outside `setup()` — **do not guess.** Fall back to Raw Global plus Raw Statements and flag it in the report. A wrong lift is worse than no lift, because the user won't notice.

### 4.2 The non-blocking timing pattern

```cpp
static unsigned long last = 0;
if (millis() - last >= 500) {
  last = millis();
  // body
}
```

→ **Every N Milliseconds** node with interval 500 and the body as its exec chain.

Recognize the variants: `unsigned long previousMillis` at global scope; `last += interval` instead of `last = millis()`; `currentMillis` hoisted to a local at the top of `loop()`. **Do not** match the rollover-unsafe form `millis() >= last + interval` — that form is a latent bug, and lifting it into a node that generates the safe form would silently change behavior. Import it as raw and flag it as a warning: the user should know their sketch has a 49.7-day bug.

### 4.3 Button debounce

The canonical `lastDebounceTime` / `reading != lastButtonState` shape from Arduino's `Debounce` example → **Push Button** component node. This one is high value because that example is the single most-copied Arduino snippet in existence.

### 4.4 Pin constant folding

`const int ledPin = 13;` used only as a pin argument becomes the pin config on the consuming nodes, with the variable retained if it's referenced elsewhere. Getting this wrong produces a graph cluttered with Get Variable nodes feeding every pin input.

### 4.5 State machines

A `switch` on an enum or `const int` state variable, where cases assign to that same variable, → **State Machine** node. Anything less regular → If-chain or Raw.

**Every lift must be reversible and verified.** For each pattern, a test that imports the canonical form, regenerates, and passes Gate 1. A lift that doesn't survive round-trip is not a lift, it's a corruption.

**Gate:** Tier B Gate 1 ≥ 90%. Every Arduino built-in example that uses Servo, `BlinkWithoutDelay`, or `Debounce` lifts correctly.

---

## Phase 5 — Layout

A correct graph dumped at the origin is unusable. Use **elkjs** with the `layered` algorithm.

- Exec flow is the primary axis, left to right.
- Data nodes sit left of and above their consumer, close enough that the dependency reads at a glance.
- `setup()` and `loop()` chains are separated vertically, each in a labeled comment frame.
- User functions each get their own frame.
- Deterministic: same input produces the same layout every time.
- No overlapping nodes, no edges crossing through node bodies.
- After layout, fit-to-view.

Sanity check: import `AnalogInOutSerial` and confirm a person can read the flow without dragging anything.

---

## Phase 6 — The user-facing feature

**Entry points:** an Import button in the toolbar; drag-and-drop `.ino` onto the canvas; paste C++ into a dialog; `⌘V` on an empty canvas when the clipboard contains something that parses as C++.

**Flow: parse → preview → confirm.** Never replace the current project without a preview step, and always offer "import into a new project."

**The import report** — shown in the preview and kept in a panel afterward:

```
Imported Sweep.ino

  71 statements   62 native (87%)   9 Custom C++
  Components lifted:  Servo (pin 9)
  Patterns lifted:    Every 15ms

  ⚠ 2 warnings
     line 34  rollover-unsafe millis() comparison — imported as-is
     line 51  Wire.beginTransmission — no native node, kept as Custom C++

  Fidelity: regenerated sketch compiles to identical machine code ✓
```

That last line is the trust anchor. Run the Gate 1 check on import when a backend is available and show the result. A user who can see that the regenerated binary is byte-identical will trust the graph; one who can't is guessing.

Every warning and every Custom C++ node is click-through: selects and centers the node on the canvas.

**Also add "Copy as sketch → re-import" as a visible round-trip button in dev builds.** It's the fastest possible manual smoke test.

---

## Phase 7 — Hardening

Work the Tier C corpus. Every one must reach Gate 3.

**Fuzz the parser** with: an empty file; only comments; unterminated string; unterminated block comment; unbalanced braces; 10,000-line sketch; deeply nested `if` (50 levels); a 2MB file; non-UTF-8 bytes; CRLF line endings; a file with no `setup()`; a file with two `loop()` definitions; `#include` of a library that isn't installed.

None may hang, crash, or produce an invalid graph. A sketch that can't be parsed at all should import as a single Raw Global containing the whole file, with a clear message — that is still a valid, generatable, compiling graph, and it loses nothing.

**Performance:** a 1,000-line sketch imports in under 2 seconds, layout included.

---

## Non-negotiables

1. **Nothing is ever lost.** Every byte of the original either maps to a node or lives inside a Raw node. Test it directly: strip comments and whitespace from the original and from the regenerated output, and assert the regenerated contains every token of the original.
2. **Never guess at a lift.** Ambiguous correlation falls back and reports. A silently wrong Servo pin is a hardware failure the user will blame on their wiring.
3. **Never "fix" the user's code on import.** Not the rollover bug, not a missing `pinMode`, not a redundant `analogRead`. Flag it, import it faithfully. The problems panel is where fixes get suggested; the importer's only job is fidelity.
4. **Deterministic.** Same input → same graph, same node IDs, same layout. Derive IDs from a hash of the AST node's normalized position, not a counter and never `uuid`.
5. **Idempotent after one round.** `import(generate(import(x)))` must equal `import(x)`. Test it on all of Tier A and Tier B.
6. **Report the corpus pass rate at every phase gate.** A phase that doesn't move the number needs an explanation.

---

## Hard-case register

Work these into Tier C. Each needs a decision recorded in `docs/IMPORT.md`, not a silent behavior.

| Case | Expected handling |
|---|---|
| Pointers, references, `new`/`delete` | Raw |
| Structs, classes, enums, typedefs, templates | Raw Global |
| Arrays — declaration, subscript, `sizeof` | Array nodes where the existing set covers it, else Raw |
| Multi-dimensional arrays | Raw |
| `PROGMEM` / `F()` | preserved verbatim, never rewritten |
| `volatile` + ISR + `attachInterrupt` | On Interrupt node + Raw for the ISR body if unmappable; `volatile` must survive |
| Function overloads | Raw Global |
| Default arguments | Raw Global |
| `static` locals | Declare Variable with static scope |
| Global initialization order | preserved exactly |
| Recursive functions | Function Define; recursion is fine, the graph just has a call cycle in the *call* graph, not the exec graph |
| `goto` / labels | Raw |
| Inline assembly | Raw Global, never touched |
| Preprocessor conditionals | Raw Global, entire block |
| A second `.ino` in the folder | concatenated per Arduino rules, frames labeled by source file |
| Sketch with a `.h`/`.cpp` beside it | out of scope for v1 — detect, warn clearly, import the `.ino` only |

---

## Session plan

| Session | Phase |
|---|---|
| 1 | 0 — harness, corpus, grammar verification |
| 2 | 1 — preprocessing and parse |
| 3 | 2 — statement lowering |
| 4 | 3 — expression lowering |
| 5 | 4 — pattern lifting (expect this to be the longest) |
| 6 | 5 + 6 — layout and UX |
| 7 | 7 — hardening and the wild corpus |

Start each with: `Read IMPORT.md and docs/IMPORT.md. Execute Phase N only. Report the corpus pass rate at the end.`
