/**
 * Browser gate — the one that would have caught the wasm bug.
 *
 * Every other import test runs in Node or jsdom, where `grammar.ts` falls back
 * to reading both wasm files off disk. That path is not the path the app uses,
 * so `import:grammar` passed 8/8 while the feature was broken in the browser
 * with `WebAssembly.Module doesn't parse at byte 0`.
 *
 * Two properties are checked, and both need a **production build** rather than
 * the dev server, because that is where the failure lives:
 *
 *  1. Both wasm assets are emitted and served as `application/wasm`. A missing
 *     asset does not 404 — the SPA fallback answers with `index.html`, HTTP 200,
 *     `text/html`, which is exactly why the symptom was a WebAssembly parse
 *     error naming no file. The negative case is asserted too, so the check
 *     cannot pass by accident on a server that 200s everything.
 *
 *  2. A real Chromium loads the built app, pastes a real sketch through the real
 *     dialog, and native nodes appear. That exercises Parser.init, Language.load,
 *     the fetch, the parse and the lowering in the environment users actually
 *     have.
 *
 * Run: npm run import:browser
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview, type PreviewServer } from 'vite';

const DIST = resolve('client/dist');
const PORT = 4188;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : `  — ${detail}`}`);
  if (!ok) failures += 1;
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const SKETCH = [
  'const int ledPin = 13;',
  'unsigned long last = 0;',
  'void setup() {',
  '  pinMode(ledPin, OUTPUT);',
  '}',
  'void loop() {',
  '  if (millis() - last >= 500) {',
  '    last = millis();',
  '    digitalWrite(ledPin, HIGH);',
  '  }',
  '}',
].join('\n');

console.log('\nBrowser gate — production build\n');

let assets: string[] = [];
try {
  assets = (await readdir(resolve(DIST, 'assets'))).filter((name) => name.endsWith('.wasm'));
} catch {
  console.log('  No client/dist. Run `npm run build --workspace client` first.\n');
  process.exit(1);
}

// ── 1. the build output ──

check(
  'both wasm files are emitted',
  assets.some((name) => name.startsWith('web-tree-sitter')) &&
    assets.some((name) => name.startsWith('tree-sitter-cpp')),
  assets.join(', '),
);

// Vite's own API rather than a subprocess. `spawn('npx', ...)` throws ENOENT on
// Windows, where the real file is npx.cmd and Node will not resolve PATHEXT for
// a non-shell spawn. Calling preview() directly sidesteps the whole class of
// problem and makes shutdown deterministic instead of signal-dependent.
// Playwright keeps browser binaries in a shared per-user cache, not in
// node_modules, and the `playwright` package has no postinstall hook. So a
// fresh clone installs the library with no browser behind it and the launch
// fails with a stack trace. `npm run import:browser` installs it first; this
// guard covers anyone invoking the script directly, or running offline.
if (!existsSync(chromium.executablePath())) {
  console.log('\n  Chromium is not installed for Playwright.');
  console.log('  Run: npx playwright install chromium\n');
  process.exit(1);
}

let server: PreviewServer | null = null;
try {
  server = await preview({
    root: resolve('client'),
    // preview inherits server.proxy, which points /api at the backend. The
    // backend is not running here and does not need to be: this gate is about
    // wasm and the importer. Left inherited, every page load emits ECONNREFUSED
    // proxy errors that look like failures in CI output. An empty map overrides it.
    preview: { port: PORT, strictPort: true, proxy: {} },
  });

  if (!(await waitForServer(30_000))) {
    console.log('  preview server did not start\n');
    process.exit(1);
  }

  for (const name of assets) {
    const response = await fetch(`${BASE}/assets/${name}`);
    const type = response.headers.get('content-type') ?? '';
    const bytes = new Uint8Array((await response.arrayBuffer()).slice(0, 4));
    // \0asm — the check that actually distinguishes wasm from an HTML fallback.
    const magic = bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
    check(`${name} serves as wasm`, response.ok && type.includes('wasm') && magic, `${response.status} ${type}`);
  }

  // The negative control. A server that answers everything with index.html would
  // pass the checks above if they only looked at the status code.
  const missing = await fetch(`${BASE}/tree-sitter.wasm`);
  const missingType = missing.headers.get('content-type') ?? '';
  check(
    'an unresolved wasm path is HTML, not wasm — the shape of the original bug',
    missingType.includes('html'),
    `${missing.status} ${missingType}`,
  );

  // ── 2. the real browser, the real dialog ──

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const wasmRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.wasm')) wasmRequests.push(`${response.status()} ${response.url().split('/').pop() ?? ''}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    // The first-run tour renders a full-screen scrim that intercepts clicks, so
    // a fresh profile cannot reach the toolbar at all. Marking it seen before
    // the app boots is the same thing a returning user has.
    await page.addInitScript(() => {
      window.localStorage.setItem('arduforge.tour.seen', '1');
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await page.getByTitle('Paste Arduino code').click();
    await page.getByPlaceholder('void setup').fill(SKETCH);
    await page.getByText('Preview import').click();

    // The report only renders once the sketch has been parsed and lowered, so
    // reaching it proves both wasm files loaded and the grammar ran.
    //
    // Caught rather than thrown: this is the assertion that fails when the wasm
    // wiring is wrong, and a raw TimeoutError buries the one thing worth
    // printing — the page error that actually explains it.
    let reported = true;
    try {
      await page.getByText(/statements/i).waitFor({ timeout: 30_000 });
    } catch {
      reported = false;
    }
    check(
      'the sketch parses in the browser',
      reported,
      reported ? '' : (consoleErrors[0] ?? 'no report rendered; wasm probably did not load'),
    );
    if (!reported) {
      check('wasm fetches', wasmRequests.length >= 2, wasmRequests.join(', ') || 'none requested');
      await browser.close();
      await server?.close();
      console.log('\n  BROWSER GATE FAILED\n');
      process.exit(1);
    }

    const reportText = (await page.locator('[role="dialog"]').innerText()).replace(/\s+/g, ' ');
    check('the import report renders in a real browser', reportText.includes('statements'), reportText.slice(0, 90));

    // Native nodes, not a whole-file fallback: a failed parse would still show a
    // report, and it would say every statement was Custom C++.
    const nativeMatch = /(\d+) native/.exec(reportText);
    const native = nativeMatch === null ? 0 : Number(nativeMatch[1]);
    check('native nodes were produced', native > 0, `${native} native`);
    check('the millis pattern lifted', reportText.includes('Every 500ms'), reportText.includes('Every 500ms') ? '' : reportText.slice(0, 90));

    await page.getByText('Import into a new project').click();
    await page.getByText(/Imported/i).waitFor({ timeout: 15_000 });
    check('the import commits to the canvas', true);

    check('both wasm files were fetched by the page', wasmRequests.length >= 2, wasmRequests.join(', '));
    check('no uncaught page errors', consoleErrors.length === 0, consoleErrors[0] ?? '');
  } finally {
    await browser.close();
  }
} finally {
  await server?.close();
}

console.log(`\n  ${failures === 0 ? 'Import works against a production build.' : 'BROWSER GATE FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
