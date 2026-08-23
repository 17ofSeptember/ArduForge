/**
 * Capture the three README screenshots from the real app, production build.
 *
 * Run: npm run build --workspace client && node scripts/screenshots.mjs
 * The backend must be running (npm run dev:server) or the app renders its
 * "backend unreachable" state.
 */
/*
 * The addInitScript callbacks below are serialised and run inside the browser,
 * not in Node, so `window` is defined there and nowhere in this file's own
 * scope. ESLint lints this as Node (globals.node), and unlike the .ts scripts
 * it has no TypeScript pass to turn no-undef off, so the global is declared.
 */
/* global window */
import { chromium } from 'playwright';
import { preview } from 'vite';
import { resolve } from 'node:path';

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const OUT = resolve('docs/images');
const TOAST_MS = 3600; // success toasts auto-dismiss at 3000ms

const SKETCH = `const int ledPin = 13;
const int buttonPin = 2;
unsigned long lastBlink = 0;
int brightness = 0;

void setup() {
  pinMode(ledPin, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);
  Serial.begin(9600);
}

void loop() {
  if (millis() - lastBlink >= 500) {
    lastBlink = millis();
    digitalWrite(ledPin, !digitalRead(ledPin));
  }
  brightness = map(analogRead(A0), 0, 1023, 0, 255);
  analogWrite(6, brightness);
  Serial.println(brightness);
}`;

const server = await preview({
  root: resolve('client'),
  preview: { port: PORT, strictPort: true },
});
const browser = await chromium.launch();

async function openExample(page, name) {
  await page.getByTitle('Projects and examples').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Open this example' }).click();
  await page.waitForTimeout(TOAST_MS);
}

try {
  // ── import.png, from a fresh profile so nothing is already open ───────────
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => window.localStorage.setItem('arduforge.tour.seen', '1'));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.getByTitle('Paste Arduino code').click();
    await page.waitForTimeout(400);
    await page.getByPlaceholder('void setup').fill(SKETCH);
    // The report does not render until this is clicked. Pasting alone shows
    // only the empty dialog.
    await page.getByText('Preview import').click();
    await page.getByText(/statements/i).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/import.png` });
    console.log('  import.png');
    await page.close();
  }

  // ── canvas.png ────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => window.localStorage.setItem('arduforge.tour.seen', '1'));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await openExample(page, /Traffic Light/i);
    await page.screenshot({ path: `${OUT}/canvas.png` });
    console.log('  canvas.png');
    await page.close();
  }

  // ── dashboard.png. Shorter viewport: the example dashboards are small and a
  //    tall shot is mostly empty grid. ───────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 600 } });
    await page.addInitScript(() => window.localStorage.setItem('arduforge.tour.seen', '1'));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await openExample(page, /Light-Seeking Servo/i);
    await page.getByRole('button', { name: 'Dashboard' }).first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/dashboard.png` });
    console.log('  dashboard.png');
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
