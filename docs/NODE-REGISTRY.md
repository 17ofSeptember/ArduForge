# Node registry — contract changes

Everything here was added while building the sketch importer (`IMPORT.md`
Phases 2–3), but none of it is about importing. The importer was the first
consumer strict enough to notice these gaps, and four of them were defects that
had already shipped to users.

This file exists because that history is invisible from the code. Several
choices below look wrong at a glance — a numeric type that defaults to `float`,
a migration that disagrees with a node's own default — and each one is holding a
compatibility guarantee in place. Anyone tidying them will silently change the
compiled output of every project their users have already saved.

**If you read nothing else, read [Load-bearing defaults](#load-bearing-defaults)
and [Known defects](#known-defects).**

---

## The compatibility contract

One rule governs every change in this file:

> A project saved before a change must generate **byte-identical** C++ after it.

Not "equivalent". Not "compiles the same". Byte-identical. The check is
mechanical:

```bash
npm run import:build-corpus
git diff --stat corpus/          # no .ino may change
```

`corpus/tierA/` is regenerated from the bundled examples on every run, so any
drift in codegen shows up as a diff in a committed file. This gate has caught
three separate silent-corruption bugs — see
[Why the byte-identical gate exists](#why-the-byte-identical-gate-exists).

The `.forge` files *are* allowed to change: they gain new config keys at their
defaults. The `.ino` files are the contract.

---

## Load-bearing defaults

These four look arbitrary. They are not. Each is chosen so existing projects do
not move, and each will be "corrected" by someone who does not know that.

| Default | Looks wrong because | Actually holds |
|---|---|---|
| `numericType` defaults to **`float`** on `math.add`/`subtract`/`multiply`/`divide`, `min`/`max`/`abs`/`constrain`, `power` | Integer arithmetic is the common case on an 8-bit board, so `int` looks like the sane default | Every one of these nodes *was* float-typed. Defaulting to `int` retypes their ports, removes the `(float)` casts codegen used to insert, and changes the compiled output of every saved project that does arithmetic. |
| `numericType` defaults to **`int`** on the bitwise family | Inconsistent with the table above, which looks like an oversight | Those nodes were *already* int-typed. Defaulting them to `float` would insert casts, and validation rejects float on bitwise — so every saved project containing a Bitwise And would become invalid. The inconsistency is the point. |
| `var.declare` **migrates** old nodes to `scope: 'global'`, while a **new** node defaults to `scope: 'local'` | Two different defaults for one field reads like a bug | Before the field existed, every declared variable was a global. `ctx.config()` falls back to the *def's* default, so without the migration every saved project would move its variables onto the stack — changing lifetime, initialisation order, and output. New nodes default to `local` because a global costs SRAM for the whole run, which matters on a 2KB Uno. |
| `control.for`'s `index` defaults to **`''`** (blank) | An empty name field looks unfinished; `i` looks like the obvious default | Blank means "generate `_af_i_<hash>`", which is what every existing graph emits. Defaulting to `i` changes the emitted loop variable in every saved project, and collides with any user variable called `i`. |

There is a fifth, smaller one: `math.ternary`'s ports are all typed `any`. That
is deliberate — `applyCast` never wraps a value crossing an `any` port, so the
node composes with `int`, `long`, `float` and `String` subtrees without altering
any of them. Typing it "properly" would make it cast.

---

## Changes

### `control.if` — continuation output

**Was** `execOut: ['true', 'false']`. **Now** `execOut: ['true', 'false', 'then']`.

`then` runs after the branches rejoin. `generate.ts` continues along the first
exec output the node's `emit` did not consume itself, which is why `then` is
listed **last** — reorder the array and the generator will follow `true` instead
and emit the continuation inside the if.

**Why:** without it, "do X, branch, then do Y" could only be expressed by
duplicating Y into both branches. That is a maintenance trap on the canvas and
diverges the moment someone edits one copy. This was a product defect, not an
import limitation.

**Compatibility:** additive. Existing graphs have no edge on `then`, so the
chain ends exactly where it did.

---

### `control.for` — configurable index name

**Added** config `index` (text, default `''`).

Blank generates `_af_i_<stableSuffix(nodeId)>`, the historical form. A name is
only needed when something outside the node refers to the counter.

**Validation:** a named index is rejected when it shadows a **global** variable,
or when it duplicates the index of a For loop this one **sits inside**.

Containment is resolved by walking the `body` output only — not by canvas
position, and not by "is this name used anywhere". Two *sequential*
`for (int i = 0; …)` loops are ordinary C++, because their scopes never overlap.
An earlier version rejected them and made a very common sketch unimportable.

---

### `var.declare` — scope, and an initializer port

**Added** config `scope`: `local` | `static-local` | `global`.

- `global` — declared above `setup()` via `collect`, exactly as before.
- `local` — emitted as a statement where the node sits in the chain.
- `static-local` — same, prefixed `static`, so the value survives between runs
  of the chain. It is a separate option rather than a checkbox on `local`
  because the two differ in *lifetime*, not placement.

**Added** an optional data input `value`, typed from the declared type.
Unconnected, the `initial` config field is used. Connected, the wired expression
is the initializer and the field is ignored.

A wired **global** is declared bare and assigned in the chain, because a global's
initializer cannot depend on an expression emitted later.

**Validation:** `expose: true` requires `global` or `static-local`. `AWRY_VARS`
holds a raw `void *` taken once at startup; a stack local's address is only
valid while its chain is running, and writing through that pointer afterwards
corrupts whatever occupies the slot next. This is an **error**, not a silent
coercion to global — quietly relocating a variable changes both its SRAM cost
and how long its value survives, and the user chose both.

**The `initial` field stopped coercing.** It used to run every value through
`Number()`, which destroyed anything that was not a plain decimal:

| Written | Emitted (before) | Emitted (now) |
|---|---|---|
| `0x1A` | `26` | `0x1A` |
| `0.05f` | `0.0f` — `Number()` returns NaN on the suffix | `0.05f` |
| `LOW_THRESHOLD` | `0` | `LOW_THRESHOLD` |
| `'A'` | `0` | `'A'` |

It is now source text on a typed port, which is the rule `literalToCpp` already
followed everywhere else — `var.declare` was the outlier.

**One exception is load-bearing:** a *bare decimal* is still reformatted for its
type, so a float initialised to `0.05` still emits `0.05f`. That is the only
value whose notation carries nothing the user chose, and it is what keeps saved
projects byte-identical. Remove the exception and every float-typed declaration
in every saved project changes.

Validation rejects a free-form expression in the field and names the port
instead. Every literal notation is accepted: hex, binary, octal, decimal,
exponent, suffixes, char literals, and bare identifiers.

---

### `PortDef.optional`

**Added** `optional?: boolean`. An input the node can do without: no literal
spec, no connection, no validation error.

**Why:** `var.declare`'s initializer port. A literal spec would put the same
value in two places on the inspector (the port editor and the `initial` field);
no spec at all would make every unconnected Declare Variable an error.

Validation skips the "needs a connection" check only when `optional === true`.
Do not make this the default for ports without a literal — that check is what
catches a genuinely unwired input.

---

### `EmitContext.connected` / `CollectContext.connected`

**Added** `connected(portId): boolean` to both contexts.

**Why:** `CollectContext.literal(portId)` returns `null` for **two different
reasons** — a wire supplies the value, or no literal was ever set. On a required
port those coincide. On an *optional* port they do not, and reading `null` as
"a wire supplies this" emitted every saved global without its initializer.

Use `connected()` whenever the distinction matters. `literal()` remains correct
for reading a value; it is only ambiguous as a presence test.

---

### `numericType` on the math and bitwise families

**Added** config `numericType`: `int` | `long` | `float` to
`math.add`/`subtract`/`multiply`/`divide`, `math.min`/`max`/`abs`/`constrain`,
`math.power`, and `logic.bitAnd`/`bitOr`/`bitXor`/`shiftLeft`/`shiftRight`.

The mode retypes the node's own ports through `dynamic.inputs`/`outputs`. Ports
are `int` for both integer modes and `float` only for `float`, because
`applyCast` wraps a value only when it crosses into a `float` or `string` port.

**`long` widens the left operand only** — `((long)(a) * (b))`. C++ promotion
carries the rest of the expression. Casting the *result* instead would truncate
to 16 bits first and then widen an already-wrong answer. `long` exists because
`int` is 16-bit on AVR: `dev1 * dev1` overflows above 181.

**Bitwise and modulo reject `float`** in validation — C++ has no such operation
on floating point, and without the check the sketch reaches `arduino-cli` and
fails with `invalid operands of types float and float to binary operator&`
pointing at a line the user never wrote.

**`power` refuses the integer modes entirely.** It emits `pow()`, which returns
a double and drags roughly a kilobyte of floating-point support into the sketch.
Offering an integer mode that emitted `pow()` anyway would be a lie about the
cost; writing an integer power helper would invent overflow behaviour that
diverges from `pow()` at exactly the boundary nobody tests. The error says to
multiply in a loop instead.

**`min`, `max` and `abs` use typed C++ forms in the integer modes**, not the
Arduino macros. See [the defects](#defects-this-fixed-that-had-nothing-to-do-with-import).

**Port ids are passed explicitly** to the shared factory. `math.constrain` uses
`value`/`low`/`high`, not a generic set — see
[Why the byte-identical gate exists](#why-the-byte-identical-gate-exists).

---

### `math.ternary`

**New expression node.** Inputs `cond` (bool), `then` and `else` (`any`); output
`any`. Emits `(cond ? then : else)`.

There was previously **no way to express a conditional value on the canvas at
all** — only a conditional *statement*. Every port is `any` so the node never
casts, and the real type is whatever is wired in.

---

### `func.call`

**New expression node**, alongside the existing statement-kind
`event.callFunction`. Config `name`, `args` (text), `returns` (`int` | `float` |
`bool` | `String`); output typed from `returns`.

A user function used for its value had no representation. `event.callFunction`
is `kind: 'statement'` and produces no output, so `x = twice(3)` could only ever
be a Raw node.

---

## Defects this fixed that had nothing to do with import

All four shipped. The importer is what found them, because it is the first
consumer that compares generated output against a known-correct original
byte-for-byte.

### 1. Float arithmetic on integer operands

Every arithmetic node was typed `float`. A graph computing `a + b` from two
`int` inputs emitted:

```cpp
delay(((float)(a) + (float)(b)));
```

On an AVR with no FPU that is wrong for every user: it links in soft-float, costs
flash and cycles, and removes the 16-bit overflow behaviour a sketch may depend
on. Fixed by `numericType`.

### 2. `abs()` double-evaluating its argument

Arduino's `abs`, `min` and `max` are **macros**. `abs(x++)` increments twice;
`min(analogRead(A0), 100)` reads the pin twice. The nodes inherited that.

The integer modes now emit a form that evaluates once. The float mode keeps the
macro, because changing it would move existing output. Covered by tests in
`client/src/nodes/registryChanges.test.ts`.

### 3. No way to express a conditional value

Fixed by `math.ternary`.

### 4. No way to continue after a branch

Fixed by `control.if`'s `then` output. Before it, the only way to run something
after an if/else was to duplicate it into both branches.

---

## Why the byte-identical gate exists

Three separate silent-corruption bugs, none of which any other check caught.

### The `connected`/`literal` ambiguity

Adding `var.declare`'s optional initializer port, the first implementation asked
`ctx.literal('value') === null` to mean "a wire supplies this". On an optional
port `null` also means "no literal was ever set", which is true of **every node
saved before the port existed**.

Result: every global in every saved project lost its initializer — `int speed;`
instead of `int speed = 5;`. Ten corpus files changed. Nothing else would have
noticed: the graphs were valid, the sketches compiled, and the variables were
merely uninitialised at boot.

Fixed by adding `connected()` to both contexts.

### The `constrain` port rename

Refactoring `min`/`max`/`abs`/`constrain` onto a shared factory, the ports were
given generic ids (`value`, `b`, `c`). `math.constrain` had always used
`value`/`low`/`high`, and a saved graph stores its literals under those ids.

Result: `constrain(angle, 0, 180)` regenerated as
`constrain((float)(angle), 0.0f, 0.0f)` — the upper limit silently became zero.
One corpus file changed, and the sketch still compiled.

Port ids are now passed explicitly to the factory, with a comment saying why.

### A corpus golden that had been overwritten

Less a code defect than a process one, but the gate is what surfaced it.
`corpus/tierA/Blink/Blink.ino` had been replaced in the working tree by an
unrelated sketch and swept into a commit by `git add -A`. Regeneration restored
it and the diff made the substitution obvious. Two sessions of Tier A coverage
numbers had been measured against the wrong file.

Stage explicitly. `git add -A` in a repo with unrelated working-tree churn is
how that happened.

---

## Approved but deferred

### `control.everyMs` timing mode

**Approved, not built.** One config field rather than two booleans:

```
timing: 'resample' | 'hoisted' | 'catch-up'      default 'resample'
```

| Mode | Emits | Unlocks |
|---|---|---|
| `resample` (default) | `if (millis() - last >= n) { last = millis(); … }` | current behaviour, unchanged |
| `hoisted` | one `unsigned long now = millis();` used for both the test and the restamp | the `currentMillis` variant — the shape `BlinkWithoutDelay` uses, and the most-copied timing sketch there is |
| `catch-up` | `last += n` instead of `last = millis()` | the drift-free variant, where a late tick is caught up rather than pushing every later tick out |

**Cost:** small-to-medium. Additive, and `resample` keeps every saved project
byte-identical. The two non-default modes are a handful of lines in `emit`.

**Why it matters:** the importer refuses both variants today, because lifting
them into the resampling form changes the program. `hoisted` samples the clock
once where the node samples twice; `catch-up` schedules from the previous
deadline where the node schedules from now. Gate 1 caught both — see
`client/src/import/everyMs.test.ts`, which asserts the refusals.

The third gap in that set — no continuation output — **is closed**:
`control.everyMs` now has `execOut: ['then', 'after']`, where `after` runs on
every pass. Listed second so `generate.ts` picks it as the output `emit` did not
consume, exactly as `control.if`'s `then` works.

---

## Component node names are hashed, and imports must account for it

Every component node derives its C++ object from a hash of its `name` config —
`servo_<stableSuffix(name)>` for Servo, and the same shape for the others. A
component lift therefore always renames the user's object, which is fine for
codegen and a trap for the importer.

Storing the user's own name is **not** idempotent:

```
Servo myservo;        import ->  name: 'myservo'
                      emit   ->  Servo servo_yservo;
                      import ->  name: 'servo_yservo'      <- different graph
```

Store the *emitted* form instead — `servo_${stableSuffix(userName)}` — which is
a fixed point, because `stableSuffix('servo_yservo')` is `'yservo'` again. Both
forms generate identical C++; only the idempotence gate tells them apart, and it
did.

The import report still shows the user's original name, so nothing is lost where
the user reads it.

**This is a known step for every remaining component**, not something to
rediscover: LCD, NeoPixel and DHT all name their objects the same way.

---

## Known defects

Both found while writing this file, by checking the registry's actual defaults
rather than trusting the change descriptions. **Neither is fixed.**

### A saved graph containing a bitwise node emits code that will not compile

`dynamic.inputs(config)` receives the node's raw `data.config`. A graph saved
before `numericType` existed has no such key, so `numericMode({})` falls through
to `'float'` and the ports are typed float — while `emit` uses `ctx.config()`,
which *does* fall back to the def default of `'int'`. Ports and emit disagree.

```
saved logic.bitAnd, no numericType in config
  emits:      ((float)(a) & (float)(b))
  validation: no errors reported
  arduino-cli: invalid operands of types float and float to binary operator&
```

Validation misses it for the same reason: it reads `config['numericType'] ?? ''`
and skips when the key is absent.

This escaped the corpus gate only because no example or corpus sketch uses a
bitwise node. The fix is to have dynamic port functions see the def's config
defaults merged in, rather than the raw stored config — which would also make
`inputPorts(def, {})` report the truth for every node with a dynamic shape.

### `math.modulo` never received the `numericType` field

It is in the approved list and in the float-rejection validation set, but the
config field was not added. The validation is therefore unreachable through the
UI, and the mode can only be set by the importer writing the key directly.

---

## Adding a node, or changing one

1. **Never rename a port id** on an existing node. Saved graphs store literals
   under those ids and a rename drops the value silently.
2. **Never change an existing default.** Add a new option and default to the old
   behaviour. If the new default is genuinely better for new nodes, use a
   migration to pin old ones — as `var.declare` does.
3. **Run the gate**: `npm run import:build-corpus && git diff --stat corpus/`.
   No `.ino` may change.
4. **Add a negative control** to any comparison-based test. A guard that only
   asserts "these match" will pass when both sides are empty; the precedence
   suite passed for three sessions while testing nothing, because every case was
   wrapped in a construct that was never lowered.
