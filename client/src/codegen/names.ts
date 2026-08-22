/**
 * C++ identifier handling (BUILD_PLAN.md §Phase 4).
 * User-facing names are sanitised; collisions get numeric suffixes; internal
 * temporaries are prefixed _af_ so they can never collide with user names.
 */

export const TEMP_PREFIX = '_af_';

/**
 * A short suffix derived from a node's id, stable across regenerations and
 * distinct between nodes. Nodes that own a static or global — a millis timer,
 * a Servo object — build their name from this so output stays deterministic
 * even though emit() may run more than once per generation.
 */
export function stableSuffix(nodeId: string): string {
  const cleaned = nodeId.replace(/[^A-Za-z0-9]/g, '');
  return cleaned.slice(-6) || 'n';
}

const CPP_KEYWORDS = new Set([
  'alignas', 'alignof', 'and', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class',
  'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit',
  'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable',
  'namespace', 'new', 'not', 'nullptr', 'operator', 'or', 'private', 'protected', 'public',
  'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template',
  'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual',
  'void', 'volatile', 'while', 'xor',
  // Arduino identifiers worth protecting too.
  'setup', 'loop', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'Serial',
]);

export function sanitiseIdentifier(raw: string, fallback = 'value'): string {
  let cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_');
  if (cleaned === '' || /^[0-9]/.test(cleaned)) cleaned = `_${cleaned}`;
  cleaned = cleaned.replace(/_{2,}/g, '_');
  if (cleaned === '' || cleaned === '_') cleaned = fallback;
  if (CPP_KEYWORDS.has(cleaned)) cleaned = `${cleaned}_`;
  return cleaned;
}

/** Hands out unique identifiers, appending numeric suffixes on collision. */
export class NameAllocator {
  private readonly taken = new Set<string>();

  reserve(name: string): void {
    this.taken.add(name);
  }

  allocate(preferred: string, fallback = 'value'): string {
    const base = sanitiseIdentifier(preferred, fallback);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    let index = 2;
    while (this.taken.has(`${base}${index}`)) index += 1;
    const chosen = `${base}${index}`;
    this.taken.add(chosen);
    return chosen;
  }

  allocateTemp(base: string): string {
    return this.allocate(`${TEMP_PREFIX}${sanitiseIdentifier(base)}`, `${TEMP_PREFIX}tmp`);
  }
}
