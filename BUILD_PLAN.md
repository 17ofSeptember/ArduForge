# ArduForge — Build Plan / Master Spec

> **How to use this file:** Save it to the root of an empty repo as `BUILD_PLAN.md`. Open the repo in VS Code, start Claude Code, and say:
>
> `Read BUILD_PLAN.md in full. Do not write any code yet. Summarize the architecture back to me in 10 bullets, list anything ambiguous, then execute Phase 0 only and stop.`
>
> Then advance one phase at a time. Never let it skip a phase gate.

---

## 0. Mission

Build **ArduForge**: a local-first, browser-based visual programming environment for Arduino. Two capabilities must be excellent; everything else is secondary.

1. **Canvas Programming** — A node-graph editor (Unreal Blueprint style: execution flow + data flow) that generates clean, human-readable Arduino C++ (`.ino`), compiles it, and uploads it to a connected board. The generated sketch must also be copy-pasteable into the official Arduino IDE with zero modification.
2. **Live Prototyping Dashboard** — A drag-and-drop GUI builder (sliders, buttons, gauges, charts, terminals) whose widgets bind to real pins and real program variables on the running board, over a live serial link, with sub-100ms round trip.

Target hardware for v1: **Arduino Uno R3** (`arduino:avr:uno`), genuine and CH340 clones. Architecture must not hard-code Uno — board profiles are data, not logic — but only Uno is validated in v1.

Target user: someone who can build most common Arduino projects (blink, buttons, sensors, servos, motors, displays, LEDs, state machines, serial telemetry) without typing C++, and who can then throw a control panel on top of it in two minutes.

---

## 1. Environment & Hard Constraints

**Dev machine:** 2019 Intel MacBook Pro, macOS. Node 20 LTS. VS Code. Claude Code.

**Non-negotiable environment facts — do not design around assumptions that contradict these:**

- **You cannot compile Arduino C++ in a browser.** AVR compilation requires `avr-gcc`. WASM ports exist and are fragile. **This project uses a local Node backend that shells out to `arduino-cli`.** Do not attempt in-browser compilation. Do not attempt to use the Arduino Cloud API.
- **Serial ownership is exclusive.** Exactly one process can hold `/dev/cu.usbmodem*` at a time. The backend owns the port. The browser never touches Web Serial. This eliminates an entire class of "two readers on one device" corruption bugs.
- **On macOS, use `/dev/cu.*`, never `/dev/tty.*`.** Opening a `tty.` device blocks waiting for DCD assert and will hang.
- **Uploading resets the board.** The Optiboot bootloader on the Uno is triggered by a DTR toggle. Any live serial session must be fully torn down and awaited before an upload begins, and re-established after.
- Genuine Uno enumerates as VID `0x2341` PID `0x0043` (or `0x0001`). Clones use CH340: VID `0x1a86` PID `0x7523`, and appear as `/dev/cu.wchusbserial*`. Detect both.
- Upload baud for Uno is **115200**. Runtime serial baud is **115200** for this project.

**Prerequisites Claude Code must verify in Phase 0 before writing app code:**

```bash
brew install arduino-cli
arduino-cli config init
arduino-cli core update-index
arduino-cli core install arduino:avr
arduino-cli board list --format json
```

If `arduino-cli` is missing or `arduino:avr` is not installed, halt and tell the user. Do not silently stub it.

---

## 2. Stack (decided — do not relitigate)

**Frontend**
- Vite + React 18 + TypeScript (strict)
- Tailwind CSS
- `@xyflow/react` v12 — node canvas
- `zustand` — app state (graph, dashboard, connection, project)
- `zundo` or hand-rolled command stack — undo/redo
- CodeMirror 6 (`@codemirror/lang-cpp`) — generated code viewer
- `uplot` — live charting (chosen for performance at high sample rates; do not use Chart.js for the live plots)
- `lucide-react` — icon set for node headers

**Backend** (`server/`, Node 20 + TypeScript)
- Express — REST for compile/upload/board discovery/library management
- `ws` — WebSocket for serial stream and telemetry
- `serialport` v12 — port I/O
- `firmata` — Firmata client for Live Pin Mode
- `execa` — `arduino-cli` invocation
- `zod` — validate every inbound payload at the boundary

**Repo layout**

```
arduforge/
├── BUILD_PLAN.md
├── package.json                 # workspaces: client, server
├── client/
│   ├── src/
│   │   ├── canvas/              # React Flow editor, node components
│   │   ├── nodes/               # node definitions (registry + codegen fragments)
│   │   ├── codegen/             # graph -> C++
│   │   ├── dashboard/           # widget builder + widgets
│   │   ├── link/                # WS client singleton, protocol codec
│   │   ├── store/               # zustand slices
│   │   ├── ui/                  # shared primitives
│   │   └── examples/            # bundled example projects (.forge json)
├── server/
│   ├── src/
│   │   ├── serial/              # SerialManager singleton + lease queue
│   │   ├── cli/                 # arduino-cli wrapper
│   │   ├── firmata/             # Firmata session
│   │   ├── routes/
│   │   └── ws/
├── firmware/
│   └── AwryLink/                # AwryLink.h / .cpp injected into generated sketches
└── docs/
```

---

## 3. THE STABILITY CONTRACT (read this twice)

The single most common failure mode in hardware-attached web apps is **two things holding the device at once**. The following rules are architectural law. Violating any of them is a bug even if the app appears to work.

### 3.1 One SerialManager singleton with a lease queue

There is exactly **one** `SerialManager` instance in the backend process. It is the only code in the entire project that constructs a `SerialPort`. It exposes:

```ts
acquire(ownerId: string, mode: 'raw' | 'firmata' | 'awrylink', opts): Promise<Lease>
release(leaseId: string): Promise<void>   // MUST await actual port close
withExclusive<T>(fn: () => Promise<T>): Promise<T>  // for uploads
```

- Leases are queued, not rejected, when the port is busy — except uploads, which **preempt** (they cancel the current lease, await its teardown, then run).
- `release()` resolves only after `port.close()` has actually fired its callback. Never fire-and-forget a close.
- A lease that has been released can never write. Guard every write with a lease-validity check.

### 3.2 Hardware first, then state

Never optimistically update UI state and then perform the hardware action. Order is always:

1. Issue the hardware command
2. Await acknowledgment or a definite failure
3. Then update the store

A slider that snaps to a position the board never reached is a lie, and it will cost hours of debugging later.

### 3.3 No auto-restart while the port is open

Do **not** run the backend under `nodemon`, `tsx watch`, or `node --watch` during hardware sessions. Auto-restart leaks device handles because SIGTERM arrives while the port is open and the OS descriptor is not reclaimed cleanly.

- Provide two scripts: `dev:server` (no watch) and `dev:server:watch` (watch, prints a loud warning that it is unsafe with hardware attached).
- Register `process.on('SIGINT' | 'SIGTERM' | 'beforeExit')` handlers that synchronously close all ports.

### 3.4 Frontend WebSocket must survive HMR and StrictMode

- The WS client is a module-level singleton with a refcount, living **outside** React. React components subscribe and unsubscribe; they never construct sockets.
- React 18 StrictMode double-mounts effects in dev. Every `useEffect` that subscribes must have a cleanup that unsubscribes, and the singleton must tolerate `subscribe → unsubscribe → subscribe` without dropping the underlying connection.
- Register `import.meta.hot.dispose(() => client.destroy())` so Vite HMR does not accumulate sockets.

### 3.5 Upload sequencing (exact order, no shortcuts)

```
1. Freeze dashboard UI, show "Uploading…"
2. Stop telemetry (send !X if AwryLink active)
3. Release live lease — AWAIT full close
4. Wait 250ms settle
5. arduino-cli compile → .hex
6. arduino-cli upload (exclusive)
7. Wait 2000ms for bootloader handoff + sketch start
8. Re-acquire live lease
9. Handshake (!H) — retry 3× at 500ms
10. Resume telemetry, unfreeze UI
```

If any step fails, the app returns to a clean disconnected state with a specific error. It never lands in a half-open state.

### 3.6 Device-gone handling

If the board is unplugged mid-session: catch the port error, tear down the lease, emit `device:lost` over WS, mark disconnected in UI, and **do not crash the backend**. Poll `arduino-cli board list` every 2s while disconnected to offer reconnect.

### 3.7 Watchdog

If AwryLink telemetry has not arrived in 2× the configured interval (min 1000ms), mark the link as stale in the UI. Do not silently show frozen values as if they were live.

---

## 4. Phase Plan

Each phase ends with a **gate**. Do not begin the next phase until the gate passes and the user confirms. Commit at every gate.

---

### Phase 0 — Environment verification & scaffold

- Verify `arduino-cli`, `arduino:avr` core, Node 20.
- Scaffold the monorepo, both packages, Tailwind, TS strict, path aliases.
- Backend: `GET /api/health` returns arduino-cli version, core list, and detected boards.
- Frontend: a single page that renders that health payload.

**Gate:** With the Uno plugged in, the browser shows the real port path (e.g. `/dev/cu.usbmodem14201`), FQBN `arduino:avr:uno`, and the arduino-cli version. Unplug it, click refresh, it shows zero boards without erroring.

---

### Phase 1 — SerialManager + raw terminal

Build the singleton and lease queue described in §3.1 **before** anything else touches serial.

- `GET /api/boards` — enumerate, resolve VID/PID → board profile, prefer `cu.*`.
- WS `/ws/serial` — raw bidirectional bridge under a lease.
- Frontend: a serial monitor panel (baud selector, line-ending selector, autoscroll, timestamp toggle, clear, pause, copy).
- Include a **Mock Board** driver behind an env flag (`ARDUFORGE_MOCK=1`) that emulates a serial device in-process, so all further development and tests can run with no hardware attached.

**Gate:** Upload StandardFirmata *by hand* via the official Arduino IDE, then open ArduForge's monitor at 57600 and see Firmata's version bytes. Then: open the monitor, open a second browser tab, confirm the second tab queues rather than corrupting the stream. Close tab 1, tab 2 takes over cleanly.

---

### Phase 2 — Compile & upload pipeline

- `POST /api/compile` — body `{ files: {name, content}[], fqbn, libraries[] }`. Write to a temp sketch dir, run `arduino-cli compile --format json`, return `{ ok, hexPath, stdout, diagnostics[] }`.
- Parse gcc diagnostics into structured `{ file, line, column, severity, message }`.
- `POST /api/upload` — takes a build id, runs under `withExclusive()`, streams progress over WS.
- Frontend: Verify and Upload buttons, a build output console, a compile-status pill.

**Gate:** Paste a raw Blink sketch into a temp text box, hit Verify (see sizes reported), hit Upload, watch the on-board LED blink. Then introduce a syntax error and confirm the diagnostic renders with the correct line number.

---

### Phase 3 — Node canvas

This is the centerpiece. Get the model right before adding node count.

**Graph model — dual edge types (this is the key design decision):**

Arduino code is imperative and ordered. A pure dataflow graph (Node-RED style) cannot express `setup()` vs `loop()`, ordering, or control flow. So use the Blueprint model:

- **Exec edges** (white, thick, arrow) define *when* things happen. They flow left→right through statement nodes.
- **Data edges** (thin, colored by type) define *what values* feed a node's inputs. They are pulled, not pushed — a data node emits an expression, not a statement.

Every node declares:

```ts
interface NodeDef {
  id: string;              // 'io.digitalWrite'
  category: NodeCategory;
  label: string;
  icon: LucideIcon;
  kind: 'entry' | 'statement' | 'expression';
  execIn?: boolean;
  execOut?: string[];      // e.g. ['then'] or ['true','false'] or ['body','done']
  inputs: PortDef[];       // data inputs, each with a type + inline literal fallback
  outputs: PortDef[];      // data outputs
  config?: FieldDef[];     // inspector-panel fields (dropdowns, checkboxes)
  requires?: { includes?: string[]; libraries?: string[]; globals?: string[]; setup?: string[] };
  emit: (ctx: EmitContext) => EmitResult;
}
```

**Port type system + colors (enforce compatibility at connect time):**

| Type | Color | Notes |
|---|---|---|
| `exec` | `#F5F5F5` | white, thick line |
| `bool` | `#E5484D` | crimson |
| `int` | `#3E9EFF` | blue |
| `float` | `#30A46C` | green |
| `string` | `#C86EDD` | magenta |
| `pin` | `#F5A524` | amber, int subtype |
| `any` | `#8B8D98` | grey, resolved at connect |

Implicit casts allowed: `int→float`, `bool→int`, `int→bool` (non-zero), anything→`string` via `String()`. Everything else is rejected at connect time with a toast explaining why.

**Node visual design — distinct, glanceable identity per category.** The user should identify a node's role from across the room without reading text. Requirements:

- Each category gets a **fixed hue** and a **fixed icon glyph** in the header, and the header bar is solid-filled with that hue.
- Icon choices must be semantically distinct, not decorative: I/O uses a plug/pin glyph, Control uses a branching arrow, Math uses operator symbols, Time uses a clock, Serial uses a terminal caret, Components use a literal miniature of the part (servo horn, ultrasonic eye pair, LED bulb, LCD rectangle).
- Node body shows the **resolved inline values** for unconnected inputs, so a `digitalWrite` node reads visually as `PIN 13 ← HIGH` without opening an inspector.
- Category hues:

| Category | Hue | Icon direction |
|---|---|---|
| Events / Entry | `#8B5CF6` violet | lightning / flag |
| I/O | `#F5A524` amber | pin header / plug |
| Control Flow | `#E5484D` crimson | git-branch / repeat |
| Math | `#3E9EFF` blue | sigma / calculator |
| Logic | `#0EA5E9` cyan | toggle / boolean gate |
| Variables | `#30A46C` green | box / tag |
| Time | `#EAB308` yellow | clock / timer |
| Serial | `#94A3B8` slate | terminal |
| Components | `#EC4899` pink | part silhouette |
| Custom C++ | `#64748B` gunmetal | code brackets |

**Editor features (all required):**

- Pan/zoom, minimap, snap-to-grid toggle, fit-to-view
- Multi-select (marquee + shift-click), group move, align/distribute
- Copy/paste/duplicate (`⌘C/⌘V/⌘D`), delete
- Undo/redo (`⌘Z/⇧⌘Z`) — full command stack, 100 deep
- **Command palette (`⌘K`)** — fuzzy search all nodes, insert at cursor
- **Drag-from-port to empty canvas** → opens filtered node picker showing only type-compatible nodes
- Right-click context menu on node, edge, and canvas
- Comment/group frames (colored, resizable, titled, drag children with frame)
- Reroute nodes on edges (double-click an edge)
- Node search/highlight (`⌘F`)
- Collapsible node bodies
- Inspector panel (right side) for selected node config
- Live error overlay: nodes with problems get a red halo + badge; clicking an error in the problems panel focuses and centers that node

**Gate:** Build a graph with `On Loop → Digital Write(13, HIGH) → Delay(500) → Digital Write(13, LOW) → Delay(500)`. Undo/redo it. Save it, reload the page, it restores exactly. Try to connect a `string` output to an `int` input and get a clear rejection.

---

### Phase 4 — Code generator

**Requirements:**

- Output must be **clean, idiomatic, commented Arduino C++** that a human would be happy to read. This is a hard requirement, not a nice-to-have — the user will paste it into the official IDE.
- Deterministic: same graph → byte-identical output. Sort collections; never iterate object key order.
- Emit a **source map**: `Map<lineNumber, nodeId>`, so compiler errors resolve back to the offending node.

**Generation algorithm:**

1. **Validate** — exactly one `On Setup` and one `On Loop` (both optional but at most one each); no cycles in exec edges except via loop nodes; no cycles in data edges at all; every required input is connected or has a literal.
2. **Collect** — walk all reachable nodes, union their `requires.includes`, `requires.libraries`, `requires.globals`, `requires.setup`.
3. **Emit expressions** — data subgraphs are evaluated depth-first into C++ expressions. If a data node's output feeds >1 consumer *and* is non-trivial (a function call, not a literal), hoist it to a temp local to avoid double evaluation. This matters: `analogRead()` called twice returns different values.
4. **Emit statements** — walk exec chains, emitting statements with proper indentation and brace scoping.
5. **Assemble** in this order: header comment block → includes → library objects → global variables → forward declarations → `setup()` → `loop()` → user functions.

**Naming:** user-facing variable names are sanitized to valid C++ identifiers; collisions get numeric suffixes; internal temps are prefixed `_af_`.

**Reference output for the Blink graph — match this quality bar:**

```cpp
// ─────────────────────────────────────────────
//  Generated by ArduForge
//  Project: Blink
//  Board:   Arduino Uno (arduino:avr:uno)
// ─────────────────────────────────────────────

const uint8_t PIN_LED = 13;

void setup() {
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  digitalWrite(PIN_LED, HIGH);
  delay(500);
  digitalWrite(PIN_LED, LOW);
  delay(500);
}
```

**Frontend:** split view — canvas left, generated code right (CodeMirror, read-only, C++ highlighting). Code updates live as the graph changes, debounced 200ms. Buttons: Copy Sketch, Download `.ino`, Verify, Upload. Highlighting a node highlights its generated lines and vice versa.

**Tests:** golden-file snapshot tests. At minimum one per node in the library plus one per bundled example project. `npm test` must pass with no hardware attached.

**Gate:** Generate, copy the output, paste it into the official Arduino IDE, and confirm it compiles there unmodified. Then upload from ArduForge and see the LED blink.

---

### Phase 5 — Node library

Build in this order. Each node needs: definition, React component, emit function, and a golden test.

**5a — Events:** On Setup, On Loop, On Interrupt (pin 2/3, RISING/FALLING/CHANGE), Custom Function (define + call, with typed params and return).

**5b — Control Flow:** If / If-Else, Sequence (n exec outs), For (count), While, Do-While, Break, Continue, Return, Delay (ms), Delay Microseconds, **Every N Milliseconds** (non-blocking millis-based — emits the `static unsigned long` pattern; this is the node that lets users write real programs instead of `delay()` spaghetti), Debounce (ms), State Machine (enum states + transitions, emits a `switch`).

**5c — I/O:** Pin Mode, Digital Write, Digital Read, Analog Read, Analog Write (PWM — validate the pin is PWM-capable for the selected board profile), Tone, No Tone, Pulse In, Shift Out, Analog Reference.

**5d — Math:** Number literal, Float literal, Add, Subtract, Multiply, Divide, Modulo, Power, Sqrt, Abs, Min, Max, Constrain, **Map**, Round/Floor/Ceil, Random, Random Seed, Sin/Cos/Tan.

**5e — Logic:** Boolean literal, AND, OR, NOT, XOR, Compare (`== != < > <= >=`), Bitwise AND/OR/XOR/NOT, Shift Left/Right, Bit Read/Write/Set/Clear.

**5f — Variables:** Declare Variable (name, type, scope global/local, initial value, **`Expose to Dashboard` checkbox**), Get Variable, Set Variable, Increment, Decrement, Array Declare, Array Get, Array Set, Array Length.

**5g — Time:** Millis, Micros, Elapsed Since (stores a timestamp var, returns delta), Stopwatch (start/stop/read).

**5h — Serial:** Serial Begin, Print, Println, Print Value (labeled), Available, Read, Read String Until, Parse Int, Parse Float, Flush.

**5i — Text:** String literal, Concat, Length, Substring, Index Of, To Int, To Float, To String, Compare.

**5j — Components** (composite nodes — each pulls its own `#include` and library, and registers its own `setup()` lines automatically):

| Component | Nodes | Library |
|---|---|---|
| LED | On, Off, Toggle, Fade To | — |
| Push Button | Is Pressed, On Press (edge), On Release, Is Held (ms) — debounced internally | — |
| Potentiometer | Read Raw, Read Mapped, Read Smoothed (EMA) | — |
| Servo | Attach, Write Angle, Write Microseconds, Read, Detach | `Servo` |
| Ultrasonic HC-SR04 | Read Distance (cm/inch) | none — emit raw `pulseIn` |
| DHT11 / DHT22 | Read Temperature, Read Humidity | `DHT sensor library` |
| LCD 16x2 I2C | Init, Print At, Clear, Backlight, Create Char | `LiquidCrystal_I2C` |
| NeoPixel | Init, Set Pixel RGB, Set All, Brightness, Show | `Adafruit NeoPixel` |
| Buzzer | Beep, Play Note, Play Melody, Stop | — |
| Relay | On, Off, Toggle | — |
| L298N Motor | Set Speed, Forward, Reverse, Stop, Brake | — |
| Stepper | Set Speed, Step, Rotate Degrees | `Stepper` |
| 74HC595 Shift Register | Write Byte, Set Bit | — |
| IR Receiver | Read Code, On Code Match | `IRremote` |
| SoftwareSerial | Begin, Print, Available, Read | `SoftwareSerial` |
| RTC DS3231 | Read Time, Read Date | `RTClib` |
| SD Card | Init, Write Line, Read File | `SD` |

**5k — Custom C++ escape hatch:** three node variants — Raw Statement (exec in/out, arbitrary C++ inserted verbatim), Raw Expression (typed output, arbitrary expression), Raw Global (top-level code: functions, structs, `#define`s). These guarantee the tool never becomes a dead end.

Library management: `POST /api/libraries/install` wrapping `arduino-cli lib install`. On Verify, auto-detect missing libraries from the graph and offer one-click install.

**Gate:** Build a project using a servo, a potentiometer, and an ultrasonic sensor with an `Every 50ms` timer, and have it run correctly on hardware.

---

### Phase 6 — Live Dashboard

Two modes. Build **Mode A first** — it's simpler and proves the whole widget/binding layer without needing codegen changes.

#### Mode A — Firmata Pin Mode ("Quick Prototype")

One click uploads `StandardFirmata` (bundled as a prebuilt hex to avoid a compile round-trip). The backend runs `firmata.js` against the port and exposes pin-level control over WS. Widgets bind directly to pins. No user program required — this is for poking at hardware and wiring-checking.

- Auto pin capability discovery from Firmata's capability response
- Pin inspector: per-pin mode dropdown + live value
- Sampling interval control (default 50ms)

#### Mode B — AwryLink ("Instrument My Program")

The user's *own generated program* becomes controllable. When any variable has `Expose to Dashboard` checked, or the project has any dashboard bindings, codegen injects the AwryLink runtime.

**AwryLink protocol — line-delimited ASCII, 115200 baud, max 128 bytes per line.**

Host → Board (each line starts `!`):

| Command | Meaning |
|---|---|
| `!H` | Handshake |
| `!S<name>=<value>` | Set exposed variable |
| `!G<name>` | Get exposed variable once |
| `!D<pin>,<0\|1>` | digitalWrite |
| `!A<pin>,<0-255>` | analogWrite |
| `!R<pin>` | digitalRead → replies `R\|<pin>,<v>` |
| `!N<pin>` | analogRead → replies `N\|<pin>,<v>` |
| `!M<pin>,<0\|1\|2>` | pinMode (INPUT/OUTPUT/INPUT_PULLUP) |
| `!T<ms>` | Start telemetry at interval (min 50ms) |
| `!X` | Stop telemetry |
| `!P` | Ping → `P\|<millis>` |

Board → Host:

| Frame | Meaning |
|---|---|
| `H\|awrylink,1,uno,<sketchHash>` | Handshake reply |
| `T\|<millis>,<name>=<val>,<name>=<val>` | Telemetry frame |
| `L\|<text>` | User log line |
| `E\|<code>,<detail>` | Error |
| `R\|<pin>,<v>` / `N\|<pin>,<v>` | Pin read replies |

**Firmware rules (`firmware/AwryLink/`):**

- **Never block.** No `delay()` in the link handler. Parse incrementally from `Serial.available()` in a fixed-size ring buffer.
- Variable table is a static array of `{ const char* name; void* ptr; VarType type; bool writable; }` generated by codegen. No dynamic allocation, no `String` in the hot path — the Uno has 2KB of SRAM and heap fragmentation will kill long runs.
- Telemetry frames are built into a fixed `char[128]` with `snprintf`. Truncate rather than overflow.
- If a telemetry frame would exceed 128 bytes, split across frames round-robin.
- `awrylink_poll()` is emitted as the **first statement of `loop()`** automatically.

**Dashboard builder:**

- Grid canvas (12 columns, snap, resize handles, drag reorder) — use CSS Grid, not absolute positioning, so it reflows responsively
- Widget palette, per-widget inspector, multiple dashboard pages/tabs
- Edit Mode / Run Mode toggle. Run Mode hides all builder chrome and is what the user actually operates.

**Widgets (all required):**

| Widget | Binds to | Config |
|---|---|---|
| Button | pin write / var set / command | momentary or toggle, on/off values, label, color |
| Slider | pin PWM / var set | min, max, step, live-send vs on-release, unit suffix |
| Switch | pin write / bool var | on/off labels |
| Number Input | var set | min, max, step |
| LED Indicator | pin read / bool var | on color, off color, blink-on-true |
| Gauge | analog read / numeric var | min, max, zones (green/amber/red), unit |
| Line Chart | 1–4 numeric sources | window seconds, y-auto or fixed, per-series color, pause, CSV export |
| Value Readout | any var | label, unit, decimals, big/small |
| Bar Meter | numeric | horizontal/vertical, threshold |
| XY Pad | 2 vars | ranges, spring-to-center toggle |
| Color Picker | 3 vars (R/G/B) | live send |
| Serial Terminal | raw stream | filter, autoscroll, send box |
| Log Table | `L\|` frames | max rows, filter, clear |
| Stat Card Grid | n vars | compact multi-value display |

**Binding model:**

```ts
type Binding =
  | { kind: 'pin'; pin: number; op: 'digitalWrite'|'digitalRead'|'analogWrite'|'analogRead' }
  | { kind: 'var'; name: string; direction: 'read'|'write'|'both' }
  | { kind: 'command'; raw: string };
```

The inspector's binding dropdown is populated from the actual exposed-variable list derived from the graph, so it can't drift out of sync. If a bound variable is deleted from the graph, the widget shows a broken-binding badge rather than failing silently.

**Performance:** telemetry arrives up to 20Hz. Do not put telemetry in React state — that will re-render the tree 20× per second and stutter. Use a ref-based ring buffer + `requestAnimationFrame` flush, and let `uplot` consume typed arrays directly. Only widget *values* that changed get pushed to their subscribed components.

**Gate:** With a potentiometer on A0 and a servo on D9, build a graph that reads the pot and drives the servo, expose both values, and build a dashboard with a slider that overrides the servo, a gauge showing pot position, and a rolling chart of both. Operate it for 10 minutes with no drift, freeze, or disconnect. Then upload a modified sketch without restarting anything and confirm the dashboard recovers automatically per §3.5.

---

### Phase 7 — Projects, examples, persistence

**Project file format** — single `.forge` JSON: `{ version, meta, board, graph: {nodes, edges}, dashboard: {pages, widgets}, settings }`. Versioned with a migration function from day one.

- Autosave to IndexedDB every 5s + on blur
- Project browser (new / open / duplicate / rename / delete)
- Import / export `.forge` file
- Export `.ino` file
- Recovery: if the app crashed, offer to restore the last autosave

**Bundled examples** — each opens with a wired graph, a working dashboard, and a `README` panel with a wiring diagram (inline SVG) and parts list:

1. **Blink** — hello world, `Every 500ms` instead of `delay()`
2. **Button + LED** — debounce, edge detection, toggle state
3. **Potentiometer Fade** — analogRead → map → analogWrite, with live chart
4. **Servo Control Panel** — slider-driven servo, angle readout, sweep mode toggle
5. **Ultrasonic Parking Sensor** — HC-SR04 → distance gauge + buzzer whose tone frequency scales with proximity
6. **Traffic Light State Machine** — demonstrates the State Machine node + pedestrian button interrupt
7. **Temperature Logger** — DHT22 → dual-series chart (temp + humidity) + CSV export + LCD display
8. **NeoPixel Studio** — color picker + brightness slider + pattern selector (solid/chase/rainbow/breathe)
9. **Motor Speed Controller** — L298N + XY pad for differential drive + speed telemetry
10. **Data Dashboard** — 4 analog channels streaming to charts at 20Hz, demonstrating the telemetry ceiling
11. **Light-Seeking Servo** — two LDRs, proportional control loop, tunable gain slider (shows live-tuning a control system, which is the killer use case for this tool)

Each example must be a golden test: load it, generate code, compare to a committed snapshot.

**Gate:** All 11 examples load, generate, and compile. At least 5 verified on real hardware.

---

### Phase 8 — Responsiveness, polish, performance

**Breakpoints — be realistic about what works on each:**

| Width | Layout |
|---|---|
| ≥1280px | Full IDE: node canvas + code panel + inspector, dashboard as a tab |
| 1024–1279px | Canvas + collapsible right panel (code/inspector as tabs) |
| 768–1023px | Tablet: dashboard-first. Canvas is view/pan/zoom only, editing disabled with a notice. |
| <768px | Phone: **Run Mode dashboard only** — a remote control for an already-uploaded project. No graph editing. |

Node-graph editing on a phone is a bad experience no matter how much effort goes into it. Don't fake it; ship the dashboard as the mobile product.

**Performance targets (measure, don't assume):**

- 200-node graph pans and zooms at 60fps → memoize node components, virtualize offscreen nodes, never re-render the whole graph on a single node's state change
- Codegen for a 200-node graph < 50ms
- Telemetry at 20Hz with 4 chart series holds 60fps
- Initial load < 2s on the dev machine
- Zero unbounded arrays: chart buffers, terminal lines, and log rows all have hard caps with FIFO eviction

**Polish:**

- Full keyboard map, with a `?` shortcut overlay
- Toast system: distinct treatments for info / success / warning / error, errors persist until dismissed
- Connection status bar: port, board, mode (Idle / Firmata / AwryLink), link latency in ms, free SRAM estimate after compile
- Dark theme default. Ship design tokens in one CSS variable file so the palette is swappable in one place.
- Empty states everywhere with a next action, never a blank panel
- First-run guided tour (5 steps, skippable, never shown again)
- `docs/` with a node reference, protocol spec, and troubleshooting page covering: board not detected, CH340 driver on macOS, permission errors, "port busy", upload timeouts, and the `cu.` vs `tty.` trap

---

## 5. Definition of Done

- [ ] `npm run dev` starts client + server; app is usable at `localhost:5173`
- [ ] All 11 examples load, generate, compile, and 5+ run on real hardware
- [ ] Generated `.ino` compiles unmodified in the official Arduino IDE
- [ ] `npm test` passes with zero hardware attached (mock driver + golden files)
- [ ] Upload → live session → edit → re-upload cycle repeats 20 times with no leaked handles (verify with `lsof | grep usbmodem` returning nothing after teardown)
- [ ] Unplugging the board mid-session degrades gracefully and reconnects on replug
- [ ] Two browser tabs cannot corrupt one serial stream
- [ ] `README.md` covers install, prerequisites, first project, and troubleshooting

---

## 6. Working Instructions for Claude Code

- **Work one phase at a time.** Stop at each gate and report. Do not run ahead.
- **Ask before deviating.** If a chosen library is broken or a design decision here proves wrong on contact with reality, say so explicitly and propose an alternative — do not silently substitute.
- **Never mock hardware behavior in production paths.** The mock driver lives behind `ARDUFORGE_MOCK=1` and is for tests only. If something doesn't work with real hardware, fix it; don't fake a success response.
- **Write the test with the node.** Every node definition ships with its golden codegen test in the same commit.
- **No `any`.** TypeScript strict, `noUncheckedIndexedAccess` on. The port/type system is the thing that makes this tool trustworthy; weaken the types and it becomes a toy.
- **Commit at every gate** with a message naming the phase.
- **When a bug involves the serial port, re-read §3 before proposing a fix.** Most hardware bugs in this project will be lease/ownership bugs wearing a costume.
