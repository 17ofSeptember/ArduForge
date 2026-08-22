# Firmware

`AwryLink/` is the runtime that lets a sketch report variables to the ArduForge
dashboard while it runs. Roughly 350 lines of C++ across a header and one
source file.

This directory is the canonical copy. `client/scripts/embed-firmware.mjs` reads
both files and generates `client/src/codegen/awrylinkSource.ts`, so the client
can emit the firmware alongside a generated sketch without reading the disk.
Edit the files here, then regenerate:

```bash
npm run embed:firmware --workspace client
```

The firmware travels with any sketch that exposes a variable to the dashboard.
It is compiled into the user's sketch rather than uploaded separately.

## API

```c
void awrylink_begin(const AwryVar *table, uint8_t count, const char *sketchHash);
void awrylink_poll();
void awrylink_log(const char *text);
```

The generated sketch calls `awrylink_begin` once in `setup()` and `awrylink_poll`
every pass through `loop()`.

## Constraints

An Uno has 2KB of SRAM, and a program that fragments the heap dies after hours
rather than failing cleanly. The implementation is bound by these rules:

- Never block. No `delay()` anywhere in the link handler.
- No dynamic allocation and no `String` in the hot path.
- Frames are built in a fixed buffer with `snprintf` and truncated rather than
  overflowed. `AWRYLINK_MAX_LINE` is 128 bytes.
- Telemetry is rate limited by `AWRYLINK_MIN_INTERVAL_MS`, currently 50ms.

This is also why `String` variables are deliberately excluded from telemetry:
putting them in a fixed-size hot path is exactly what fragments the heap.

The wire format is documented in
[`docs/awrylink-protocol.md`](../docs/awrylink-protocol.md).
