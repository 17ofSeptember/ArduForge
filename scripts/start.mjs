#!/usr/bin/env node
/**
 * One-click launcher.
 *
 * A first-time user with a fresh clone should be able to double-click
 * something and end up looking at the app. This is that something. The thin
 * wrappers (start.command, start.bat, start.sh) do nothing but invoke this
 * file, so there is one implementation rather than three shell scripts
 * drifting apart.
 *
 * Two things here are deliberate and easy to "tidy" into bugs:
 *
 *  1. The backend is never started under a file watcher. A restart delivers a
 *     signal while the serial port is open, the descriptor is not reclaimed,
 *     and the board needs a physical replug (BUILD_PLAN.md §3.3).
 *
 *  2. Children are killed as a process tree, not by their immediate pid. `npm
 *     run` is a shell wrapping tsx wrapping node, and killing the wrapper
 *     leaves the process that actually holds the port running. A launcher that
 *     orphans that process recreates the exact bug this project is careful
 *     about everywhere else.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

// ── 1. repo root, from this file's own location ──────────────────────────────
// Not process.cwd(): Finder launches a .command from the user's home directory,
// and a desktop shortcut can launch from anywhere at all.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SERVER_PORT = Number.parseInt(process.env.ARDUFORGE_PORT ?? '5174', 10);
const CLIENT_PORT = 5173;
const HEALTH = `http://localhost:${SERVER_PORT}/api/health`;
const APP_URL = `http://localhost:${CLIENT_PORT}`;
const REQUIRED_CORE = 'arduino:avr';
const IS_WINDOWS = process.platform === 'win32';

const CLI_INSTALL_URL = 'https://arduino.github.io/arduino-cli/latest/installation/';

let step = 0;
const say = (message) => console.log(`  ${message}`);
const heading = (message) => console.log(`\n[${++step}] ${message}`);
const fail = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

console.log('\nArduForge');
console.log('─'.repeat(56));

// ── 2. Node version ──────────────────────────────────────────────────────────
heading('Checking Node');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const wanted = Number.parseInt((pkg.engines?.node ?? '>=22').replace(/[^\d]/, '').split('.')[0], 10);
const running = Number.parseInt(process.versions.node.split('.')[0], 10);
if (Number.isFinite(wanted) && running < wanted) {
  fail(
    `Node ${wanted} or newer is required. This is Node ${process.versions.node}.\n` +
      `  Install a current version from https://nodejs.org and run this again.`,
  );
}
say(`Node ${process.versions.node}`);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Windows has no `npm`, only `npm.cmd`, and since the CVE-2024-27980 mitigation
 * Node refuses to spawn a .cmd without a shell. POSIX needs neither.
 */
function spawnTool(command, args, options = {}) {
  return spawn(command, args, {
    cwd: ROOT,
    shell: IS_WINDOWS,
    ...options,
  });
}

const npmBin = IS_WINDOWS ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  return new Promise((done) => {
    const child = spawnTool(command, args, { stdio: 'pipe', ...options });
    let out = '';
    let err = '';
    child.stdout?.on('data', (b) => (out += b));
    child.stderr?.on('data', (b) => (err += b));
    child.on('error', (error) => done({ code: null, out, err, error }));
    child.on('close', (code) => done({ code, out, err, error: null }));
  });
}

function installHint() {
  if (process.platform === 'darwin') return 'brew install arduino-cli';
  if (IS_WINDOWS) return 'winget install ArduinoSA.CLI';
  return 'your distribution package manager, or the official install script';
}

function portInUse(port) {
  return new Promise((done) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const settle = (value) => {
      socket.destroy();
      done(value);
    };
    socket.setTimeout(800);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

function ask(question) {
  // Nothing can answer on a non-interactive stdin, and blocking there would
  // hang a CI run or a double-click that inherited no console.
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((done) =>
    rl.question(`  ${question} [y/N] `, (answer) => {
      rl.close();
      done(/^y(es)?$/i.test(answer.trim()));
    }),
  );
}

// ── 3. arduino-cli ───────────────────────────────────────────────────────────
heading('Checking arduino-cli');
const version = await run('arduino-cli', ['version', '--format', 'json']);
if (version.error?.code === 'ENOENT' || version.code === null) {
  fail(
    `arduino-cli was not found on PATH.\n` +
      `  Install it with: ${installHint()}\n` +
      `  Full instructions: ${CLI_INSTALL_URL}\n` +
      `  Then run this again.`,
  );
}
if (version.code !== 0) {
  fail(`arduino-cli failed to run:\n  ${(version.err || version.out).trim()}`);
}
let cliVersion = 'unknown';
try {
  cliVersion = JSON.parse(version.out).VersionString ?? 'unknown';
} catch {
  // A version we cannot parse is not a reason to refuse to start.
}
say(`arduino-cli ${cliVersion}`);

// ── 4. the AVR core ──────────────────────────────────────────────────────────
heading(`Checking the ${REQUIRED_CORE} core`);
const cores = await run('arduino-cli', ['core', 'list', '--format', 'json']);
let hasCore = false;
try {
  const parsed = JSON.parse(cores.out || '{}');
  hasCore = (parsed.platforms ?? []).some((p) => p.id === REQUIRED_CORE);
} catch {
  hasCore = false;
}

if (!hasCore) {
  say(`${REQUIRED_CORE} is not installed. It is required to compile anything.`);
  const yes = await ask(`Install it now?`);
  if (!yes) {
    fail(`Install it yourself with:\n    arduino-cli core install ${REQUIRED_CORE}`);
  }
  say('Installing, this takes a minute the first time...');
  await run('arduino-cli', ['core', 'update-index'], { stdio: 'inherit' });
  const install = await run('arduino-cli', ['core', 'install', REQUIRED_CORE], { stdio: 'inherit' });
  if (install.code !== 0) fail(`Installing ${REQUIRED_CORE} failed.`);
  say(`${REQUIRED_CORE} installed`);
} else {
  say(`${REQUIRED_CORE} present`);
}

// ── 5. dependencies ──────────────────────────────────────────────────────────
heading('Checking dependencies');
const modules = join(ROOT, 'node_modules');
const lockfile = join(ROOT, 'package-lock.json');
// npm maintains this file, and its mtime is the honest record of the last
// install. Comparing against the node_modules directory itself is wrong,
// because anything writing inside it touches the directory.
const stamp = join(modules, '.package-lock.json');

let needsInstall = false;
let why = '';
if (!existsSync(modules)) {
  needsInstall = true;
  why = 'node_modules is missing';
} else if (existsSync(lockfile) && existsSync(stamp) && statSync(lockfile).mtimeMs > statSync(stamp).mtimeMs) {
  needsInstall = true;
  why = 'package-lock.json is newer than the last install';
}

if (needsInstall) {
  say(`${why}. Running npm install, which may take a couple of minutes...`);
  const install = await run(npmBin, ['install'], { stdio: 'inherit' });
  if (install.code !== 0) {
    fail(`npm install failed with exit code ${install.code}.\n  The output above is the real error.`);
  }
  say('Dependencies installed');
} else {
  say('Dependencies up to date');
}

// ── 6. ports ─────────────────────────────────────────────────────────────────
// Checked before anything starts. Vite would otherwise walk to the next free
// port, and the next port up is the backend's.
heading('Checking ports');
if (await portInUse(SERVER_PORT)) {
  fail(
    `Port ${SERVER_PORT} is already in use, and that is the backend's port.\n` +
      `  Another ArduForge is probably already running. Close it, or start this one\n` +
      `  on a different port:  ARDUFORGE_PORT=5180 npm start`,
  );
}
if (await portInUse(CLIENT_PORT)) {
  fail(
    `Port ${CLIENT_PORT} is already in use, and that is the app's port.\n` +
      `  Close whatever is holding it and run this again. ArduForge will not\n` +
      `  quietly move to another port, because the app would then be talking to\n` +
      `  the wrong backend.`,
  );
}
say(`${SERVER_PORT} and ${CLIENT_PORT} are free`);

// ── process management ───────────────────────────────────────────────────────

const children = [];

function start(name, args) {
  const child = spawnTool(npmBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: its own process group, so the whole tree can be signalled at once.
    // Windows has no process groups; taskkill /T handles the tree there.
    detached: !IS_WINDOWS,
  });
  const record = { name, child, output: '', exited: false, code: null };
  const capture = (buffer) => {
    const text = buffer.toString();
    record.output += text;
    if (record.output.length > 64_000) record.output = record.output.slice(-64_000);
    if (streaming) process.stdout.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('close', (code) => {
    record.exited = true;
    record.code = code;
  });
  children.push(record);
  return record;
}

let streaming = false;

function killTree(record) {
  if (record.exited || record.child.pid === undefined) return;
  try {
    if (IS_WINDOWS) {
      spawn('taskkill', ['/pid', String(record.child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Negative pid targets the whole process group. npm run is a shell
      // wrapping tsx wrapping node; the immediate pid is not the one holding
      // the serial port.
      process.kill(-record.child.pid, 'SIGINT');
    }
  } catch {
    // Already gone, which is the outcome we wanted.
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n\n${signal} received. Stopping...`);
  for (const record of children) killTree(record);

  // Give the backend a moment to release the serial port before exiting. This
  // wait is the difference between a clean stop and a board that needs
  // replugging.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && children.some((r) => !r.exited)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('Stopped.\n');
  process.exit(0);
}

for (const signal of IS_WINDOWS ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => void shutdown(signal));
}

async function waitFor(check, { timeoutMs, dying }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dying()) return 'died';
    if (await check()) return 'ready';
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'timeout';
}

function diagnose(record, what) {
  const output = record.output.trim();
  console.error(`\n  The ${record.name} ${what}.`);
  if (output === '') {
    console.error('  It produced no output at all.\n');
  } else {
    console.error(`  Its output follows.\n`);
    console.error(output.split('\n').map((l) => `    ${l}`).join('\n'));
    console.error('');
  }
  for (const other of children) killTree(other);
  process.exit(1);
}

// ── 7. backend, then wait for it to actually answer ──────────────────────────
heading('Starting the backend');
const backend = start('backend', ['run', 'dev:server']);

const backendReady = await waitFor(
  async () => {
    try {
      const response = await fetch(HEALTH, { signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  },
  { timeoutMs: 45_000, dying: () => backend.exited },
);

if (backendReady === 'died') diagnose(backend, `exited with code ${backend.code} before it was ready`);
if (backendReady === 'timeout') diagnose(backend, 'did not answer /api/health within 45 seconds');
say(`Backend answering on ${HEALTH}`);

// ── 8. client ────────────────────────────────────────────────────────────────
heading('Starting the app');
const client = start('app', ['run', 'dev:client']);

const clientReady = await waitFor(
  async () => {
    try {
      const response = await fetch(APP_URL, { signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  },
  { timeoutMs: 45_000, dying: () => client.exited },
);

if (clientReady === 'died') diagnose(client, `exited with code ${client.code} before it was ready`);
if (clientReady === 'timeout') diagnose(client, 'did not serve a page within 45 seconds');
say(`App serving on ${APP_URL}`);

// ── 9. browser ───────────────────────────────────────────────────────────────
heading('Opening the browser');
const opener = process.platform === 'darwin' ? ['open', [APP_URL]]
  : IS_WINDOWS ? ['cmd', ['/c', 'start', '', APP_URL]]
  : ['xdg-open', [APP_URL]];
const opened = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true, shell: false });
opened.on('error', () => say(`Could not open a browser automatically. Go to ${APP_URL}`));
opened.unref();
say(APP_URL);

// ── 10. stay in the foreground ───────────────────────────────────────────────
console.log('\n' + '─'.repeat(56));
console.log('ArduForge is running. Press Ctrl-C to stop.');
console.log('─'.repeat(56) + '\n');

// From here on, both processes stream to this terminal.
streaming = true;

for (const record of children) {
  record.child.on('close', (code) => {
    if (shuttingDown) return;
    console.error(`\n  The ${record.name} stopped unexpectedly (exit code ${code}).`);
    void shutdown('child exit');
  });
}

// Hold the event loop open until a signal arrives.
await new Promise(() => {});
