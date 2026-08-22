/**
 * Discovery filters across all three platforms.
 *
 * The macOS tty./cu. rule is a string prefix with a trailing dot, and Linux's
 * device names sit one character away from matching it. Nothing else in the
 * suite would notice if that dot were dropped, so it is pinned here.
 *
 * listPorts is mocked because the filter is the thing under test and it only
 * runs inside discoverBoards. Testing toCandidate alone would prove nothing:
 * it never sees the filter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedPort } from '@/cli/arduinoCli.js';

const listPorts = vi.hoisted(() => vi.fn<() => Promise<DetectedPort[]>>());
vi.mock('@/cli/arduinoCli.js', () => ({ listPorts }));

const { discoverBoards, toCandidate } = await import('@/boards/discovery.js');

function port(address: string, over: Partial<DetectedPort> = {}): DetectedPort {
  return {
    address,
    protocol: 'serial',
    protocolLabel: 'USB Serial',
    vid: '0x2341',
    pid: '0x0043',
    serialNumber: null,
    cliMatches: [],
    ...over,
  };
}

const addresses = async (ports: DetectedPort[]): Promise<string[]> => {
  listPorts.mockResolvedValue(ports);
  return (await discoverBoards()).map((candidate) => candidate.port);
};

beforeEach(() => listPorts.mockReset());

describe('port naming survives discovery on every platform', () => {
  it('keeps a macOS callout device', async () => {
    expect(await addresses([port('/dev/cu.usbmodem14201')])).toEqual(['/dev/cu.usbmodem14201']);
  });

  it('keeps a genuine Uno on Linux', async () => {
    expect(await addresses([port('/dev/ttyACM0')])).toEqual(['/dev/ttyACM0']);
  });

  it('keeps a CH340 clone on Linux', async () => {
    expect(await addresses([port('/dev/ttyUSB0')])).toEqual(['/dev/ttyUSB0']);
  });

  it('keeps a Windows COM port', async () => {
    expect(await addresses([port('COM3')])).toEqual(['COM3']);
  });

  it('still drops the macOS dial-in twin, which is the point of the dot', async () => {
    expect(await addresses([port('/dev/tty.usbmodem14201')])).toEqual([]);
  });
});

describe('non-board serial devices are dropped on every platform', () => {
  it('drops Bluetooth ports, which report no VID/PID anywhere', async () => {
    const bluetooth = { vid: null, pid: null, protocolLabel: 'Serial Port' };
    expect(
      await addresses([
        port('/dev/cu.Bluetooth-Incoming-Port', bluetooth),
        port('/dev/rfcomm0', bluetooth),
        port('COM4', bluetooth),
      ]),
    ).toEqual([]);
  });

  it('keeps a VID/PID-less port that the CLI still labels USB', async () => {
    expect(
      await addresses([port('/dev/ttyUSB0', { vid: null, pid: null, protocolLabel: 'USB Serial' })]),
    ).toEqual(['/dev/ttyUSB0']);
  });
});

describe('profile matching is independent of path shape', () => {
  it('resolves the DFRobot clone VID/PID whatever the OS calls the port', () => {
    for (const address of ['/dev/cu.usbmodem142101', '/dev/ttyACM0', 'COM7']) {
      const candidate = toCandidate(port(address, { vid: '0x3343', pid: '0x0043' }));
      expect(candidate.fqbn).toBe('arduino:avr:uno');
      expect(candidate.identifiedBy).toBe('profile-table');
    }
  });

  it('reports unidentified rather than guessing', () => {
    const candidate = toCandidate(port('/dev/ttyACM0', { vid: null, pid: null }));
    expect(candidate.identifiedBy).toBe('unidentified');
    expect(candidate.fqbn).toBeNull();
  });
});
