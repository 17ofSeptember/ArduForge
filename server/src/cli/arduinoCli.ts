/**
 * arduino-cli wrapper (BUILD_PLAN.md §2).
 *
 * Every shape crossing this boundary is validated with zod. arduino-cli's JSON
 * output has changed between majors, so schemas are deliberately permissive
 * about fields we don't consume, and strict about the ones we do.
 */
import { execa, type ExecaError } from 'execa';
import { z } from 'zod';

/** Verified against arduino-cli 1.5.1. */
export const SUPPORTED_CLI_MAJOR = 1;

const CLI_TIMEOUT_MS = 30_000;

/** Official install page. Preferred over pinning commands that go stale. */
export const CLI_INSTALL_URL = 'https://arduino.github.io/arduino-cli/latest/installation/';

/**
 * Install hint for the host platform. Homebrew is not on Windows and winget is
 * not on macOS, so a single instruction is wrong for two thirds of readers.
 */
export function installHint(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'Install it with `brew install arduino-cli`, or use the install script from';
    case 'win32':
      return 'Install it with `winget install ArduinoSA.CLI`, or download the archive from';
    default:
      return 'Install it with your distribution package manager, or use the install script from';
  }
}

export class ArduinoCliMissingError extends Error {
  override readonly name = 'ArduinoCliMissingError';
  constructor() {
    super(
      `arduino-cli was not found on PATH. ${installHint()} ${CLI_INSTALL_URL}, ` +
        'then run `arduino-cli core install arduino:avr`.',
    );
  }
}

export class ArduinoCliError extends Error {
  override readonly name = 'ArduinoCliError';
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | undefined,
  ) {
    super(message);
  }
}

function isExecaError(error: unknown): error is ExecaError {
  return typeof error === 'object' && error !== null && 'exitCode' in error;
}

async function runCli(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execa('arduino-cli', [...args], {
      timeout: CLI_TIMEOUT_MS,
      // arduino-cli writes progress to stderr; we only ever parse stdout.
      stripFinalNewline: true,
    });
    return stdout;
  } catch (error: unknown) {
    if (isExecaError(error) && error.code === 'ENOENT') {
      throw new ArduinoCliMissingError();
    }
    if (isExecaError(error)) {
      throw new ArduinoCliError(
        `arduino-cli ${args.join(' ')} failed`,
        typeof error.stderr === 'string' ? error.stderr : '',
        typeof error.exitCode === 'number' ? error.exitCode : undefined,
      );
    }
    throw error;
  }
}

// Input is `unknown` (raw JSON) and output is T, so schemas using .default()
// — where input and output types differ — still bind T to the parsed result.
async function runCliJson<T>(
  args: readonly string[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const stdout = await runCli([...args, '--format', 'json']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ArduinoCliError(
      `arduino-cli ${args.join(' ')} returned output that is not JSON`,
      stdout.slice(0, 500),
      0,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ArduinoCliError(
      `arduino-cli ${args.join(' ')} returned an unexpected JSON shape. ` +
        `This usually means an arduino-cli version newer than the one this build was verified against (1.5.1).`,
      result.error.message,
      0,
    );
  }
  return result.data;
}

// ── version ──────────────────────────────────────────────────────────────────

const versionSchema = z.object({
  Application: z.string(),
  VersionString: z.string(),
  Commit: z.string().optional(),
  Date: z.string().optional(),
});

export interface CliVersion {
  readonly application: string;
  readonly version: string;
  readonly commit: string | null;
  readonly date: string | null;
  /** False when the installed major differs from the one this build was verified against. */
  readonly supported: boolean;
}

export async function getVersion(): Promise<CliVersion> {
  const raw = await runCliJson(['version'], versionSchema);
  const major = Number.parseInt(raw.VersionString.split('.')[0] ?? '', 10);
  return {
    application: raw.Application,
    version: raw.VersionString,
    commit: raw.Commit ?? null,
    date: raw.Date ?? null,
    supported: major === SUPPORTED_CLI_MAJOR,
  };
}

// ── core list ────────────────────────────────────────────────────────────────

const coreListSchema = z.object({
  platforms: z
    .array(
      z.object({
        id: z.string(),
        maintainer: z.string().optional(),
        installed_version: z.string().optional(),
        latest_version: z.string().optional(),
      }),
    )
    .default([]),
});

export interface InstalledCore {
  readonly id: string;
  readonly maintainer: string | null;
  readonly installedVersion: string | null;
  readonly latestVersion: string | null;
}

export async function listCores(): Promise<InstalledCore[]> {
  const raw = await runCliJson(['core', 'list'], coreListSchema);
  return raw.platforms
    .map((platform) => ({
      id: platform.id,
      maintainer: platform.maintainer ?? null,
      installedVersion: platform.installed_version ?? null,
      latestVersion: platform.latest_version ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── board list ───────────────────────────────────────────────────────────────

const boardListSchema = z.object({
  detected_ports: z
    .array(
      z.object({
        port: z.object({
          address: z.string(),
          label: z.string().optional(),
          protocol: z.string().optional(),
          protocol_label: z.string().optional(),
          hardware_id: z.string().optional(),
          properties: z.record(z.string()).optional(),
        }),
        matching_boards: z
          .array(z.object({ name: z.string(), fqbn: z.string() }))
          .optional(),
      }),
    )
    .default([]),
});

export interface DetectedPort {
  readonly address: string;
  readonly protocol: string | null;
  readonly protocolLabel: string | null;
  readonly vid: string | null;
  readonly pid: string | null;
  readonly serialNumber: string | null;
  /** Board identification arduino-cli made on its own, if any. */
  readonly cliMatches: readonly { readonly name: string; readonly fqbn: string }[];
}

export async function listPorts(): Promise<DetectedPort[]> {
  const raw = await runCliJson(['board', 'list'], boardListSchema);
  return raw.detected_ports.map(({ port, matching_boards }) => {
    const properties = port.properties ?? {};
    return {
      address: port.address,
      protocol: port.protocol ?? null,
      protocolLabel: port.protocol_label ?? null,
      vid: properties['vid'] ?? null,
      pid: properties['pid'] ?? null,
      serialNumber: properties['serialNumber'] ?? port.hardware_id ?? null,
      cliMatches: matching_boards ?? [],
    };
  });
}

// ── directories ──────────────────────────────────────────────────────────────

const directoriesSchema = z.object({
  data: z.string().default(''),
  user: z.string().default(''),
  downloads: z.string().default(''),
});

export interface CliDirectories {
  /** Where cores and bundled libraries live (Arduino15 on macOS/Windows). */
  readonly data: string;
  /** The sketchbook. Libraries the user installed live under `<user>/libraries`. */
  readonly user: string;
}

/**
 * Resolved data and sketchbook directories, straight from the toolchain.
 *
 * These differ on every platform and the user can move either one, so asking is
 * the only correct answer. Note `config dump` reports only keys that were
 * explicitly set: on a default install it returns neither directory. `config get
 * directories` reports the resolved paths whether or not they were configured,
 * which is why this uses it.
 *
 * Returns null rather than throwing, so callers can fall back to platform
 * defaults on an arduino-cli too old to have the subcommand.
 */
export async function getDirectories(): Promise<CliDirectories | null> {
  try {
    const raw = await runCliJson(['config', 'get', 'directories'], directoriesSchema);
    if (raw.data === '' && raw.user === '') return null;
    return { data: raw.data, user: raw.user };
  } catch {
    return null;
  }
}

// ── libraries ────────────────────────────────────────────────────────────────

const libListSchema = z.object({
  installed_libraries: z
    .array(z.object({ library: z.object({ name: z.string(), version: z.string().optional() }) }))
    .default([]),
});

export interface InstalledLibrary {
  readonly name: string;
  readonly version: string | null;
}

export async function listLibraries(): Promise<InstalledLibrary[]> {
  const raw = await runCliJson(['lib', 'list'], libListSchema);
  return raw.installed_libraries
    .map((entry) => ({ name: entry.library.name, version: entry.library.version ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Installs a library by name. The name comes from a node definition, never from
 * free-form user input, but it is still validated here because it becomes a
 * process argument.
 */
export async function installLibrary(name: string): Promise<void> {
  if (!/^[A-Za-z0-9 _.-]{1,128}$/.test(name)) {
    throw new Error(`"${name}" is not a valid library name.`);
  }
  await runCli(['lib', 'install', name]);
}
