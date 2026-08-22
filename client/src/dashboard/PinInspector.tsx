import { useCallback, useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import {
  firmataClient,
  pinLabel,
  uploadStandardFirmata,
  type FirmataMessage,
  type PinInfo,
  type PinMode,
} from '@/link/firmataClient';
import { telemetry } from '@/dashboard/telemetry';
import { toast } from '@/ui/toast';
import { StatusDot } from '@/ui/primitives';

/**
 * Mode A: poke pins with no user program (BUILD_PLAN.md §Phase 6).
 *
 * The pin list comes from Firmata's capability response, not a board table, so
 * whatever the board says it can do is what gets offered.
 */
export function PinInspector({
  port,
  fqbn,
}: {
  port: string;
  fqbn: string;
}) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'connect' | null>(null);
  const [firmware, setFirmware] = useState<string | null>(null);
  const [pins, setPins] = useState<readonly PinInfo[]>([]);
  const [values, setValues] = useState<Record<number, number>>({});
  const [sampling, setSampling] = useState(50);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = firmataClient.subscribe((message: FirmataMessage) => {
      switch (message.t) {
        case 'status':
          setConnected(message.connected);
          setBusy(null);
          if (message.firmware !== null) setFirmware(message.firmware);
          if (message.pins.length > 0) setPins(message.pins);
          if (!message.connected) setValues({});
          break;
        case 'pinValue':
          setValues((current) =>
            current[message.pin] === message.value
              ? current
              : { ...current, [message.pin]: message.value },
          );
          // Mirror into the telemetry bus so pin-bound widgets update too.
          telemetry.poke(`pin${message.pin}`, message.value);
          break;
        case 'revoked':
          setConnected(false);
          setError(
            message.reason === 'preempted'
              ? 'Port taken by an upload.'
              : message.reason === 'device-lost'
                ? 'Board disconnected.'
                : null,
          );
          break;
        case 'error':
          setError(message.message);
          setBusy(null);
          break;
      }
    });
    return unsubscribe;
  }, []);

  const flash = useCallback(async () => {
    if (port === '') return;
    setBusy('upload');
    setError(null);
    const result = await uploadStandardFirmata(port, fqbn);
    setBusy(null);
    if (result.ok) {
      toast.success('StandardFirmata uploaded', 'Connect to start poking pins.');
    } else {
      toast.error('Upload failed', result.error ?? 'Unknown error.');
      setError(result.error ?? null);
    }
  }, [port, fqbn]);

  const connect = useCallback(() => {
    if (port === '') return;
    setBusy('connect');
    setError(null);
    firmataClient.send({ t: 'open', port });
  }, [port]);

  const setMode = (pin: number, mode: PinMode) => {
    firmataClient.send({ t: 'pinMode', pin, mode });
    setPins((current) => current.map((info) => (info.pin === pin ? { ...info, mode } : info)));
  };

  const digital = pins.filter((info) => info.analogChannel === null && info.supportedModes.length > 0);
  const analog = pins.filter((info) => info.analogChannel !== null);

  const renderPin = (info: PinInfo) => {
    const value = values[info.pin];
    const isOutput = info.mode === 'output';
    const isPwm = info.mode === 'pwm';
    const isServo = info.mode === 'servo';

    return (
      <div
        key={info.pin}
        className="flex items-center gap-2 rounded border border-edge-subtle bg-card px-2 py-1.5"
      >
        <span className="w-8 shrink-0 font-mono text-xs">{pinLabel(info)}</span>

        <select
          value={info.mode}
          disabled={!connected}
          onChange={(event) => setMode(info.pin, event.target.value as PinMode)}
          className="rounded border border-edge bg-input px-1 py-0.5 text-[11px] disabled:opacity-40"
        >
          {info.mode === 'unknown' && <option value="unknown">—</option>}
          {info.supportedModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>

        {isOutput && (
          <button
            type="button"
            disabled={!connected}
            onClick={() => firmataClient.send({ t: 'digitalWrite', pin: info.pin, value: (value ?? 0) > 0 ? 0 : 1 })}
            /*
              Pin state is functional colour (THEME.md Phase 5): it reports what
              the hardware is actually doing. It deliberately does NOT reuse the
              feedback green, because a connection dot in that same green sits a
              few rows below — reading a HIGH pin as "connected" is exactly the
              collision Phase 5 rules out.
            */
            className="rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
            style={{
              backgroundColor: (value ?? 0) > 0 ? 'var(--pin-high)' : 'var(--pin-low)',
              color: (value ?? 0) > 0 ? 'var(--text-on-semantic)' : 'var(--text-secondary)',
            }}
          >
            {(value ?? 0) > 0 ? 'HIGH' : 'LOW'}
          </button>
        )}

        {(isPwm || isServo) && (
          <input
            type="range"
            min={0}
            max={isServo ? 180 : 255}
            value={value ?? 0}
            disabled={!connected}
            onChange={(event) => {
              const next = event.target.valueAsNumber;
              setValues((current) => ({ ...current, [info.pin]: next }));
              firmataClient.send(
                isServo
                  ? { t: 'servoWrite', pin: info.pin, angle: next }
                  : { t: 'analogWrite', pin: info.pin, value: next },
              );
            }}
            className="flex-1 accent-interactive disabled:opacity-40"
          />
        )}

        <span className="ml-auto w-10 shrink-0 text-right font-mono text-[11px] text-content-secondary">
          {value ?? '—'}
        </span>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-3 py-2">
        <Zap size={13} className="text-[var(--cat-events)]" />
        <span className="text-xs font-medium">Quick Prototype</span>
        <span className="text-[11px] text-content-muted">
          Poke pins directly — no program needed
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-content-muted">
            sample
            <select
              value={sampling}
              disabled={!connected}
              onChange={(event) => {
                const ms = Number(event.target.value);
                setSampling(ms);
                firmataClient.send({ t: 'sampling', intervalMs: ms });
              }}
              className="rounded border border-edge bg-card px-1 py-0.5 font-mono text-[11px]"
            >
              {[20, 50, 100, 250, 500].map((ms) => (
                <option key={ms} value={ms}>
                  {ms} ms
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void flash()}
            disabled={busy !== null || port === ''}
            className="rounded border border-edge bg-card px-2 py-1 text-[11px] hover:bg-header disabled:opacity-40"
          >
            {busy === 'upload' ? 'Uploading…' : 'Upload StandardFirmata'}
          </button>

          {connected ? (
            <button
              type="button"
              onClick={() => firmataClient.send({ t: 'close' })}
              className="rounded bg-destructive px-2 py-1 text-[11px] font-medium text-on-destructive"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy !== null || port === ''}
              className="rounded bg-interactive px-2 py-1 text-[11px] font-medium text-on-interactive disabled:opacity-40"
            >
              {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </button>
          )}

          <span className="flex items-center gap-1.5 font-mono text-[11px] text-content-secondary">
            <StatusDot tone={connected ? 'ok' : 'idle'} />
            {connected ? (firmware ?? 'connected') : 'offline'}
          </span>
        </div>
      </header>

      {error !== null && (
        <div className="shrink-0 border-b border-edge-subtle px-3 py-1.5 text-xs text-error">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {pins.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm text-content-secondary">Not connected.</p>
            <p className="max-w-sm text-xs text-content-muted">
              Upload StandardFirmata once, then connect. The pin list is read from the board itself,
              so whatever it reports is what you get.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                Digital ({digital.length})
              </p>
              <div className="space-y-1">{digital.map(renderPin)}</div>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] tracking-[0.12em] text-content-muted uppercase">
                Analog ({analog.length})
              </p>
              <div className="space-y-1">{analog.map(renderPin)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
