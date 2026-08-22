# Import fidelity corpus

The sketches every phase of the importer is judged against. See `IMPORT.md` §0.2
for the tier definitions and `docs/IMPORT.md` for what was decided and measured.

```
npm run import:build-corpus   # regenerate Tier A, re-copy Tier B, compile all, write manifest.json
npm run import:corpus         # the fidelity table
```

## Layout

| Path | Tier | Contents |
|---|---|---|
| `tierA/` | A | Generated from the bundled examples. Each folder holds the `.ino`, its ground-truth `.forge`, and the AwryLink firmware when the example exposes variables. |
| `tierB/` | B | Copied verbatim from the Arduino IDE and Servo library installs. |
| `tierC/` | C | Hand-written, one per row of the hard-case register. |
| `manifest.json` | — | Provenance, line count, and the compiled hex hash of every sketch. Generated. |
| `expectations.json` | — | Minimum passes per gate per tier. Hand-edited or `--record`ed. |
| `.hexcache/` | — | Compile cache keyed by source hash. Gitignored. |

## Targets

| Tier | Target | By |
|---|---|---|
| A | 100% Gate 1 | Phase 2 |
| B | 100% Gate 3, ≥90% Gate 1 | Phase 2 / Phase 4 |
| C | 100% Gate 3 | Phase 7 |

Tier C sketches are *allowed* to import as mostly Custom C++ nodes. They are not
allowed to fail to import, produce an invalid graph, or lose a line of code.

## Editing

**Tier A and Tier B are generated.** Editing them by hand is pointless —
`import:build-corpus` overwrites both directories. Change the example or the
Tier B source table in `scripts/build-corpus.ts` instead.

**Tier C is hand-written and is the one you extend.** Add a folder with a
`.ino` matching its name, then rerun `import:build-corpus` to index and compile
it. A new Tier C sketch must compile — the harness cannot anchor Gate 1 to a
sketch that does not, and it will report `n/a` rather than a verdict.
