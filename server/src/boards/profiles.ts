/**
 * Board profiles are DATA, not logic (BUILD_PLAN.md §1).
 *
 * Adding a new board means adding a row here — never adding a branch elsewhere.
 * Only `arduino:avr:uno` is validated in v1.
 */

export interface BoardProfile {
  /** Stable internal id. */
  readonly id: string;
  /** Fully-qualified board name passed to arduino-cli. */
  readonly fqbn: string;
  readonly displayName: string;
  /** USB VID/PID pairs, lowercase hex with 0x prefix, that identify this board. */
  readonly usbIds: readonly { readonly vid: string; readonly pid: string }[];
  /** Baud rate the bootloader expects during upload. */
  readonly uploadBaud: number;
  /** Baud rate the generated sketch uses at runtime. */
  readonly runtimeBaud: number;
  /** Pins capable of analogWrite() — validated by the Analog Write node in Phase 5c. */
  readonly pwmPins: readonly number[];
  /** Pins usable with attachInterrupt() — Phase 5a. */
  readonly interruptPins: readonly number[];
  readonly analogPins: readonly string[];
  readonly digitalPinCount: number;
  /** Bytes of SRAM, used for the free-SRAM estimate in the status bar (Phase 8). */
  readonly sramBytes: number;
  readonly flashBytes: number;
  readonly notes?: string;
}

const UNO_SHAPE = {
  uploadBaud: 115200,
  runtimeBaud: 115200,
  pwmPins: [3, 5, 6, 9, 10, 11],
  interruptPins: [2, 3],
  analogPins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
  digitalPinCount: 14,
  sramBytes: 2048,
  flashBytes: 32256,
} as const;

export const BOARD_PROFILES: readonly BoardProfile[] = [
  {
    id: 'uno-genuine',
    fqbn: 'arduino:avr:uno',
    displayName: 'Arduino Uno R3',
    usbIds: [
      { vid: '0x2341', pid: '0x0043' },
      { vid: '0x2341', pid: '0x0001' },
      { vid: '0x2a03', pid: '0x0043' }, // arduino.org era boards
    ],
    ...UNO_SHAPE,
  },
  {
    id: 'uno-ch340',
    fqbn: 'arduino:avr:uno',
    displayName: 'Arduino Uno R3 (CH340 clone)',
    usbIds: [{ vid: '0x1a86', pid: '0x7523' }],
    ...UNO_SHAPE,
    notes: 'Enumerates as /dev/cu.wchusbserial*. Requires the CH340 driver on older macOS.',
  },
  {
    id: 'uno-dfrobot',
    fqbn: 'arduino:avr:uno',
    displayName: 'DFRobot DFRduino Uno R3',
    usbIds: [{ vid: '0x3343', pid: '0x0043' }],
    ...UNO_SHAPE,
    notes:
      'DFRobot VID with the genuine Uno PID. arduino-cli 1.5.1 does not resolve this to an FQBN ' +
      'on its own, so the profile match here is what supplies arduino:avr:uno.',
  },
];

/** Normalise arduino-cli's VID/PID strings for comparison. */
function normaliseUsbId(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

/**
 * Resolve a USB VID/PID pair to a board profile.
 * Returns null when unknown — callers must fall back to a manual FQBN choice
 * rather than guessing, so an unrecognised board is never silently mis-flashed.
 */
export function matchProfile(
  vid: string | undefined,
  pid: string | undefined,
): BoardProfile | null {
  const v = normaliseUsbId(vid);
  const p = normaliseUsbId(pid);
  if (v === null || p === null) return null;

  for (const profile of BOARD_PROFILES) {
    for (const usbId of profile.usbIds) {
      if (usbId.vid === v && usbId.pid === p) return profile;
    }
  }
  return null;
}

export function profileById(id: string): BoardProfile | null {
  return BOARD_PROFILES.find((profile) => profile.id === id) ?? null;
}
