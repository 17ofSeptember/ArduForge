/**
 * AwryLink frame codec (BUILD_PLAN.md §Phase 6).
 *
 * Line-delimited ASCII, 115200 baud, 128 bytes per line. Parsing is total: a
 * malformed frame becomes a typed 'unknown' rather than throwing, because a
 * board mid-reset emits partial lines and that must never take the link down.
 */

export type BoardFrame =
  | { kind: 'handshake'; protocol: string; version: number; board: string; sketchHash: string }
  | { kind: 'telemetry'; millis: number; values: ReadonlyMap<string, number> }
  | { kind: 'log'; text: string }
  | { kind: 'error'; code: string; detail: string }
  | { kind: 'digital'; pin: number; value: number }
  | { kind: 'analog'; pin: number; value: number }
  | { kind: 'pong'; millis: number }
  | { kind: 'unknown'; raw: string };

export function parseFrame(line: string): BoardFrame {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed[1] !== '|') return { kind: 'unknown', raw: trimmed };

  const tag = trimmed[0];
  const body = trimmed.slice(2);

  switch (tag) {
    case 'H': {
      const [protocol, version, board, sketchHash] = body.split(',');
      return {
        kind: 'handshake',
        protocol: protocol ?? '',
        version: Number.parseInt(version ?? '0', 10) || 0,
        board: board ?? '',
        sketchHash: sketchHash ?? '',
      };
    }

    case 'T': {
      const parts = body.split(',');
      const millis = Number.parseInt(parts[0] ?? '0', 10) || 0;
      const values = new Map<string, number>();
      for (const pair of parts.slice(1)) {
        const equals = pair.indexOf('=');
        if (equals <= 0) continue;
        const name = pair.slice(0, equals);
        const parsed = Number.parseFloat(pair.slice(equals + 1));
        if (Number.isFinite(parsed)) values.set(name, parsed);
      }
      return { kind: 'telemetry', millis, values };
    }

    case 'L':
      return { kind: 'log', text: body };

    case 'E': {
      const comma = body.indexOf(',');
      return comma === -1
        ? { kind: 'error', code: body, detail: '' }
        : { kind: 'error', code: body.slice(0, comma), detail: body.slice(comma + 1) };
    }

    case 'R':
    case 'N': {
      const [pin, value] = body.split(',');
      return {
        kind: tag === 'R' ? 'digital' : 'analog',
        pin: Number.parseInt(pin ?? '', 10) || 0,
        value: Number.parseInt(value ?? '', 10) || 0,
      };
    }

    case 'P':
      return { kind: 'pong', millis: Number.parseInt(body, 10) || 0 };

    default:
      return { kind: 'unknown', raw: trimmed };
  }
}

// ── host -> board commands ───────────────────────────────────────────────────

export const MIN_TELEMETRY_MS = 50;

/** Values are rejected rather than escaped: the protocol has no escaping. */
function assertClean(value: string): string {
  if (/[\r\n,=|]/.test(value)) {
    throw new Error(`"${value}" contains a character the AwryLink protocol cannot carry.`);
  }
  return value;
}

export const command = {
  handshake: (): string => '!H\n',
  ping: (): string => '!P\n',
  startTelemetry: (ms: number): string =>
    `!T${Math.max(MIN_TELEMETRY_MS, Math.round(ms))}\n`,
  stopTelemetry: (): string => '!X\n',
  setVar: (name: string, value: string | number): string =>
    `!S${assertClean(name)}=${assertClean(String(value))}\n`,
  getVar: (name: string): string => `!G${assertClean(name)}\n`,
  digitalWrite: (pin: number, value: 0 | 1): string => `!D${Math.round(pin)},${value}\n`,
  analogWrite: (pin: number, value: number): string =>
    `!A${Math.round(pin)},${Math.min(255, Math.max(0, Math.round(value)))}\n`,
  digitalRead: (pin: number): string => `!R${Math.round(pin)}\n`,
  analogRead: (pin: number): string => `!N${Math.round(pin)}\n`,
  pinMode: (pin: number, mode: 0 | 1 | 2): string => `!M${Math.round(pin)},${mode}\n`,
};
