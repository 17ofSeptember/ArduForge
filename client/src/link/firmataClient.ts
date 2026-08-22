/**
 * /ws/firmata client — Mode A transport (BUILD_PLAN.md §Phase 6).
 */
import { createSocketClient } from '@/link/socketClient';

export type PinMode = 'input' | 'output' | 'analog' | 'pwm' | 'servo' | 'pullup';

export interface PinInfo {
  readonly pin: number;
  readonly supportedModes: readonly PinMode[];
  readonly mode: PinMode | 'unknown';
  readonly analogChannel: number | null;
  readonly value: number;
}

export type FirmataMessage =
  | { t: 'status'; connected: boolean; firmware: string | null; pins: readonly PinInfo[] }
  | { t: 'pinValue'; pin: number; value: number }
  | { t: 'revoked'; reason: string }
  | { t: 'error'; message: string };

export type FirmataCommand =
  | { t: 'open'; port: string }
  | { t: 'close' }
  | { t: 'pinMode'; pin: number; mode: PinMode }
  | { t: 'digitalWrite'; pin: number; value: 0 | 1 }
  | { t: 'analogWrite'; pin: number; value: number }
  | { t: 'servoWrite'; pin: number; angle: number }
  | { t: 'sampling'; intervalMs: number }
  | { t: 'pins' };

export const firmataClient = createSocketClient<FirmataMessage, FirmataCommand>('/ws/firmata');

if (import.meta.hot) {
  import.meta.hot.dispose(() => firmataClient.destroy());
}

export async function uploadStandardFirmata(
  port: string,
  fqbn: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch('/api/firmata/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port, fqbn }),
  });
  return (await response.json()) as { ok: boolean; error?: string };
}

/** A pin's label, using its analog name when it has one. */
export function pinLabel(info: PinInfo): string {
  return info.analogChannel !== null ? `A${info.analogChannel}` : `D${info.pin}`;
}
