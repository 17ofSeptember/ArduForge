# Contributing

Thanks for looking. Bug reports are as welcome as patches, especially on
Windows and Linux, where the hardware paths are not yet verified against a real
board.

## Getting set up

You need Node 22 and `arduino-cli` with the `arduino:avr` core installed. See
the README for platform-specific install commands.

```bash
npm install
npm run dev          # client on :5173, server on :5174
```

You do not need an Arduino to work on most of this. `npm run dev:server:mock`
adds an emulated board that prints a counter and echoes what you send it. It is
a development aid, never a stand-in for a real hardware failure.

## Before opening a pull request

```bash
npm run check
```

That is the whole gate: typecheck, lint, a colour contrast check, the test
suite, and seven importer gates including one that drives a real Chromium
against a production build. It is the same command CI runs, on all three platforms, so
a green run locally means what a green run on CI means. It takes about two
minutes.

The first run downloads a Chromium build for Playwright and compiles the corpus
with `arduino-cli`, so allow longer and expect network access.

## Things worth knowing before you change them

**`tokens.css` is generated.** Never hand-edit a hex. Change the inputs in
`scripts/generate-tokens.mjs` and run `npm run tokens`. CI fails if the file
drifts from the generator. See [docs/THEMING.md](docs/THEMING.md).

**The serial layer has a written contract.** `server/src/serial/` is the only
place allowed to construct a `SerialPort`, and closes must be awaited rather
than fired and forgotten. A leaked file descriptor means the user has to
physically replug the board, which is why the rules are strict.

**Never run the backend under a file watcher with hardware attached.** The
restart arrives while the port is open and the descriptor is not reclaimed.

**Board support is a table, not logic.** If a clone is not recognised, add a row
to `server/src/boards/profiles.ts` with its USB VID and PID rather than
special-casing detection anywhere.

**Node definitions drive the docs.** After adding or changing nodes, run
`npm run docs --workspace client` to regenerate
[docs/node-reference.md](docs/node-reference.md).

## Reporting a bug

Please include your OS and version, Node version, `arduino-cli` version, the
board, and whether it is genuine or a clone. The issue template asks for all of
this. Clone hardware behaves differently often enough that the answer changes
the diagnosis.

## Licence

By contributing you agree that your contributions are licensed under the MIT
Licence, the same as the rest of the project.
