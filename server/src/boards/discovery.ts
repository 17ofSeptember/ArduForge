/**
 * Turns raw arduino-cli port enumeration into board candidates.
 *
 * Two filters matter here (BUILD_PLAN.md §1):
 *  - macOS exposes every Bluetooth audio device as a serial port. They are not boards.
 *  - Never surface /dev/tty.* on macOS: opening one blocks waiting for DCD assert
 *    and hangs.
 *
 * Both filters generalise to the other platforms, which is worth stating because
 * it is not obvious and a careless "tidy-up" would break it:
 *  - Linux boards are /dev/ttyACM* (genuine) and /dev/ttyUSB* (CH340 clones).
 *    Neither has the dot that the macOS rule matches on, so both survive it. The
 *    dot is load-bearing.
 *  - Windows boards are COMn, which no path rule touches.
 *  - Linux and Windows Bluetooth serial ports report no VID/PID either, so the
 *    same USB test that removes them on macOS removes them there too.
 */
import { listPorts, type DetectedPort } from '@/cli/arduinoCli.js';
import { matchProfile, type BoardProfile } from '@/boards/profiles.js';

export interface BoardCandidate {
  readonly port: string;
  readonly vid: string | null;
  readonly pid: string | null;
  readonly serialNumber: string | null;
  /** Profile matched from our own VID/PID table, if any. */
  readonly profile: BoardProfile | null;
  /** FQBN to use. Null means the user must choose one manually. */
  readonly fqbn: string | null;
  readonly displayName: string;
  /** How the FQBN was determined — surfaced in the UI so guesses are never invisible. */
  readonly identifiedBy: 'arduino-cli' | 'profile-table' | 'unidentified';
  readonly notes: string | null;
}

/**
 * macOS aliases every /dev/tty.* device to a /dev/cu.* twin. Only cu.* is safe.
 *
 * The trailing dot confines this to the macOS naming scheme. Linux's
 * /dev/ttyACM0 and /dev/ttyUSB0 are real, distinct devices with no twin, and
 * must not be filtered. See discovery.test.ts.
 */
function isSafeMacPort(address: string): boolean {
  return !address.startsWith('/dev/tty.');
}

/** Bluetooth and audio devices enumerate as serial ports but are never boards. */
function isPlausibleBoardPort(port: DetectedPort): boolean {
  if (!isSafeMacPort(port.address)) return false;
  // A real USB serial device always reports VID/PID. Bluetooth ports report none.
  if (port.vid !== null && port.pid !== null) return true;
  return (port.protocolLabel ?? '').toLowerCase().includes('usb');
}

export function toCandidate(port: DetectedPort): BoardCandidate {
  const profile = matchProfile(port.vid ?? undefined, port.pid ?? undefined);
  const cliMatch = port.cliMatches[0] ?? null;

  if (cliMatch !== null) {
    return {
      port: port.address,
      vid: port.vid,
      pid: port.pid,
      serialNumber: port.serialNumber,
      profile,
      fqbn: cliMatch.fqbn,
      displayName: cliMatch.name,
      identifiedBy: 'arduino-cli',
      notes: profile?.notes ?? null,
    };
  }

  if (profile !== null) {
    return {
      port: port.address,
      vid: port.vid,
      pid: port.pid,
      serialNumber: port.serialNumber,
      profile,
      fqbn: profile.fqbn,
      displayName: profile.displayName,
      identifiedBy: 'profile-table',
      notes: profile.notes ?? null,
    };
  }

  return {
    port: port.address,
    vid: port.vid,
    pid: port.pid,
    serialNumber: port.serialNumber,
    profile: null,
    fqbn: null,
    displayName: 'Unknown board',
    identifiedBy: 'unidentified',
    notes: 'No VID/PID match. Select a board type manually before compiling or uploading.',
  };
}

export async function discoverBoards(): Promise<BoardCandidate[]> {
  const ports = await listPorts();
  return ports
    .filter(isPlausibleBoardPort)
    .map(toCandidate)
    .sort((a, b) => a.port.localeCompare(b.port));
}
