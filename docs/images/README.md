# Screenshots

The three images the top-level README references. All are captured from the
real app against a production build, at 1600px wide.

| File | Shows |
|---|---|
| `canvas.png` | The Traffic Light State Machine example. Graph on the left, generated C++ on the right, problems panel bottom right. |
| `dashboard.png` | The Light-Seeking Servo example's dashboard in edit mode, with the widget palette. |
| `import.png` | The import preview for a pasted sketch: 13 statements, 6 native, 7 Custom C++, and the lifted `Every 500ms` pattern. |

## Regenerating

```bash
npm run dev:server                      # in one terminal
npm run build --workspace client
node scripts/screenshots.mjs            # or: npm run screenshots
```

The backend must be running or the app renders its "backend unreachable" state.
The script uses Playwright and the same production build the browser gate uses,
so what you see is what a user sees.

## The dashboard image is honest about being offline

`dashboard.png` shows the dashboard with no board connected: the header reads
`offline`, the value readouts show a dash, and the chart is empty. That is
deliberate rather than an oversight.

The dashboard's whole point is live data from a running board, and there is no
way to capture that without hardware attached. The mock board
(`npm run dev:server:mock`) emits a plain counter rather than AwryLink telemetry
frames, so connecting to it would not populate the widgets either, and dressing
up emulated output as a real board would be misleading.

If you capture a replacement with a real Uno attached and streaming, it will be
a better image than this one. Keep the filename and the 1600px width.
