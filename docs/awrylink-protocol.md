# AwryLink protocol

The live link between a running sketch and the ArduForge dashboard.
Line-delimited ASCII, **115200 baud**, **128 bytes maximum per line**.

The firmware is in [`firmware/AwryLink/`](../firmware/AwryLink/). It is injected
into a sketch automatically whenever a variable is marked **Expose to Dashboard**.

## Design constraints

An Uno has 2KB of SRAM, and a program that fragments its heap will die after
hours of running. The firmware is therefore bound by four rules:

1. **Never block.** No `delay()` in the link handler. Input is parsed
   incrementally from whatever `Serial.available()` already has.
2. **No dynamic allocation and no `String`** in the hot path.
3. Frames are built into a fixed `char[128]` with `snprintf` and **truncated
   rather than overflowed**.
4. A telemetry frame that would exceed the line budget **resumes at the same
   variable next frame**, so a large variable table starves nobody.

`awrylink_poll()` is emitted as the **first statement of `loop()`**, so a long
user chain cannot starve the link.

## Host → board

Every command starts with `!` and ends with a newline.

| Command | Meaning |
|---|---|
| `!H` | Handshake |
| `!S<name>=<value>` | Set an exposed variable |
| `!G<name>` | Read one exposed variable |
| `!D<pin>,<0\|1>` | `digitalWrite` |
| `!A<pin>,<0-255>` | `analogWrite` |
| `!R<pin>` | `digitalRead` → replies `R\|<pin>,<v>` |
| `!N<pin>` | `analogRead` → replies `N\|<pin>,<v>` |
| `!M<pin>,<0\|1\|2>` | `pinMode` (INPUT / OUTPUT / INPUT_PULLUP) |
| `!T<ms>` | Start telemetry at an interval (minimum 50ms) |
| `!X` | Stop telemetry |
| `!P` | Ping → replies `P\|<millis>` |

The protocol has **no escaping**. A name or value containing `\r`, `\n`, `,`,
`=`, or `|` is rejected by the host before it is sent, rather than being
silently mangled into two frames.

## Board → host

| Frame | Meaning |
|---|---|
| `H\|awrylink,1,uno,<sketchHash>` | Handshake reply |
| `T\|<millis>,<name>=<val>,…` | Telemetry frame |
| `L\|<text>` | User log line |
| `E\|<code>,<detail>` | Error |
| `R\|<pin>,<v>` | Digital read reply |
| `N\|<pin>,<v>` | Analog read reply |
| `P\|<millis>` | Ping reply |

### Error codes

| Code | Meaning |
|---|---|
| `NOVAR` | No exposed variable by that name |
| `READONLY` | The variable exists but is not writable |
| `BADSET` | A `!S` command with no `=` |
| `BADCMD` | Unrecognised command letter |
| `LONGLINE` | An input line exceeded the buffer and was discarded |

## The sketch hash

`<sketchHash>` is a short fingerprint of the exposed variable list. It changes
whenever the exposed surface changes, which lets the dashboard notice it has
reconnected to a *different* build rather than the one it handshook with.

## Parsing rules for hosts

A board that is mid-reset emits partial lines, and a host that throws on those
will drop the link exactly when it matters. The parser must be **total**: any
unrecognised or malformed line becomes an `unknown` frame, never an exception.

## Staleness

Telemetry that stops arriving for longer than **2× the configured interval**
(never less than one second) marks the link **stale**. Frozen values are never
shown as if they were live.

A link that goes quiet because telemetry was *deliberately stopped* is not
stale — that would be crying wolf.

## Cost

Including AwryLink costs roughly **3.6 KB of flash and 226 bytes of SRAM**
over the same sketch without it.
