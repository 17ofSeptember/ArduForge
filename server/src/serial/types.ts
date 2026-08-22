/**
 * Serial layer contracts (BUILD_PLAN.md §3.1).
 *
 * The driver interface exists so the mock board (ARDUFORGE_MOCK=1) and a real
 * SerialPort are indistinguishable to the SerialManager. The manager holds all
 * the lease/ownership logic; drivers only move bytes.
 */

export type SerialMode = 'raw' | 'firmata' | 'awrylink';

/** Why a lease stopped being valid. Surfaced to the owner so the UI can explain itself. */
export type RevokeReason =
  | 'released' // normal client-initiated release
  | 'preempted' // an upload took the port (§3.1)
  | 'device-lost' // board unplugged or port errored (§3.6)
  | 'shutdown'; // process is exiting (§3.3)

export interface PortDriverEvents {
  data: (chunk: Buffer) => void;
  error: (error: Error) => void;
  /** Fired when the port closes for any reason, including unexpectedly. */
  close: () => void;
}

export interface PortDriver {
  readonly path: string;
  isOpen(): boolean;
  open(baud: number): Promise<void>;
  /** MUST resolve only after the underlying close has actually completed (§3.1). */
  close(): Promise<void>;
  write(data: Buffer): Promise<void>;
  on<E extends keyof PortDriverEvents>(event: E, listener: PortDriverEvents[E]): void;
  removeAllListeners(): void;
}

export interface Lease {
  readonly id: string;
  readonly ownerId: string;
  readonly port: string;
  readonly mode: SerialMode;
  readonly baud: number;
  /** False once revoked. Every write path checks this (§3.1). */
  isValid(): boolean;
  write(data: Buffer): Promise<void>;
  onData(listener: (chunk: Buffer) => void): () => void;
  onRevoked(listener: (reason: RevokeReason) => void): () => void;
}

export class LeaseRevokedError extends Error {
  override readonly name = 'LeaseRevokedError';
  constructor(readonly reason: RevokeReason) {
    super(`Lease is no longer valid (${reason}). Re-acquire before writing.`);
  }
}

export class DeviceLostError extends Error {
  override readonly name = 'DeviceLostError';
  constructor(readonly port: string) {
    super(`Device at ${port} is no longer available.`);
  }
}

/**
 * macOS aliases every serial device as both /dev/tty.* and /dev/cu.*.
 * Opening the tty. variant blocks waiting for DCD assert and hangs (§1).
 *
 * This matters in practice: SerialPort.list() reports the tty. path for the
 * board on this machine, so anything flowing from that API must pass through
 * here before being opened.
 */
export function preferCuPath(path: string): string {
  return path.startsWith('/dev/tty.') ? `/dev/cu.${path.slice('/dev/tty.'.length)}` : path;
}

/**
 * Turns a failed port open into something the user can act on.
 *
 * The single most common Linux Arduino problem is that /dev/ttyACM0 and
 * /dev/ttyUSB0 are owned by the `dialout` group (`uucp` on Arch and its
 * derivatives) and the user is not a member. The OS reports a bare EACCES, and
 * a message about the port being busy sends people looking in the wrong place
 * entirely. Group membership also does not apply to already-running sessions,
 * which is why people add themselves to the group and report it did not work.
 */
export function explainOpenFailure(
  path: string,
  baud: number,
  error: Error & { code?: string },
  platform: NodeJS.Platform = process.platform,
): Error {
  const head = `Could not open ${path} at ${baud} baud: ${error.message}.`;
  const denied =
    error.code === 'EACCES' ||
    /permission denied|access is denied/i.test(error.message);

  if (denied && platform === 'linux') {
    return new Error(
      `${head} The account cannot read the serial device. Add yourself to the ` +
        `group that owns it, then log out and back in for it to take effect ` +
        `(a new terminal is not enough):\n` +
        `  sudo usermod -a -G dialout $USER\n` +
        `On Arch and derivatives the group is uucp rather than dialout. ` +
        `Confirm with: ls -l ${path}`,
    );
  }

  if (denied) {
    return new Error(
      `${head} Permission was refused. Another program may hold the port, or ` +
        `the account may lack access to the device.`,
    );
  }

  if (error.code === 'ENOENT') {
    return new Error(`${head} The device is no longer present. Check the cable and replug the board.`);
  }

  return new Error(
    `${head} If the port is busy, another program (often the Arduino IDE's serial monitor) holds it.`,
  );
}
