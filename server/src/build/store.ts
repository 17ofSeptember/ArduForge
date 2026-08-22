/**
 * Build registry and temp sketch directories (BUILD_PLAN.md §Phase 2).
 *
 * A build is a directory on disk, so it needs an owner that cleans up. Builds
 * are capped and evicted FIFO, and everything is removed on shutdown.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface SketchFile {
  readonly name: string;
  readonly content: string;
}

export interface Build {
  readonly id: string;
  readonly root: string;
  readonly sketchDir: string;
  readonly sketchName: string;
  readonly outputDir: string;
  readonly fqbn: string;
  readonly createdAt: number;
  hexPath: string | null;
  compiled: boolean;
}

const MAX_BUILDS = 10;
const ROOT = join(tmpdir(), 'arduforge-builds');

/**
 * Sketch file names come from the client and are written to disk, so they are
 * validated rather than sanitised: anything with a separator or a dot-segment
 * is rejected outright instead of being silently rewritten.
 */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const ALLOWED_EXT = ['.ino', '.h', '.hpp', '.c', '.cpp'];

export function validateFileName(name: string): string | null {
  if (!SAFE_NAME.test(name)) return `"${name}" is not a valid file name.`;
  if (name.includes('..')) return `"${name}" must not contain "..".`;
  if (!ALLOWED_EXT.some((ext) => name.toLowerCase().endsWith(ext))) {
    return `"${name}" must be one of: ${ALLOWED_EXT.join(', ')}`;
  }
  return null;
}

class BuildStore {
  private readonly builds = new Map<string, Build>();

  get(id: string): Build | null {
    return this.builds.get(id) ?? null;
  }

  /**
   * arduino-cli requires the primary .ino to share its name with the directory
   * containing it, so the sketch name drives the layout.
   */
  async create(files: readonly SketchFile[], fqbn: string): Promise<Build> {
    const primary = files.find((file) => file.name.toLowerCase().endsWith('.ino'));
    if (primary === undefined) {
      throw new Error('At least one .ino file is required.');
    }

    const id = randomUUID();
    const sketchName = primary.name.slice(0, -'.ino'.length);
    const rawRoot = join(ROOT, id);

    await mkdir(join(rawRoot, sketchName), { recursive: true });
    await mkdir(join(rawRoot, 'out'), { recursive: true });

    // On macOS, tmpdir() reports /var/... while arduino-cli reports the resolved
    // /private/var/... in diagnostics. Without resolving here, every path
    // comparison against compiler output silently fails.
    const root = await realpath(rawRoot);
    const sketchDir = join(root, sketchName);
    const outputDir = join(root, 'out');

    for (const file of files) {
      await writeFile(join(sketchDir, file.name), file.content, 'utf8');
    }

    const build: Build = {
      id,
      root,
      sketchDir,
      sketchName,
      outputDir,
      fqbn,
      createdAt: Date.now(),
      hexPath: null,
      compiled: false,
    };
    this.builds.set(id, build);
    await this.evict();
    return build;
  }

  private async evict(): Promise<void> {
    if (this.builds.size <= MAX_BUILDS) return;
    const ordered = [...this.builds.values()].sort((a, b) => a.createdAt - b.createdAt);
    const excess = ordered.slice(0, ordered.length - MAX_BUILDS);
    for (const build of excess) {
      this.builds.delete(build.id);
      await rm(build.root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async clear(): Promise<void> {
    this.builds.clear();
    await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const buildStore = new BuildStore();
