import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  decodeBase64,
  encodeBase64,
  serialLink,
  type ServerMessage,
  type SocketPhase,
} from '@/link/serialLink';
import {
  BAUD_RATES,
  formatTimestamp,
  isBinary,
  LINE_ENDINGS,
  MonitorBuffer,
  toHex,
  toText,
  type LineEnding,
} from '@/serial/monitorBuffer';
import { Button, Panel, Select, StatusDot, Toggle, type Tone } from '@/ui/primitives';

/** Outside React, so incoming bytes never touch component state directly (§3.4). */
const buffer = new MonitorBuffer();

type LinkState =
  | { kind: 'idle' }
  | { kind: 'queued'; position: number }
  | { kind: 'open'; port: string; baud: number };

export interface BoardOption {
  readonly port: string;
  readonly displayName: string;
}

export function SerialMonitor({
  boards,
  onDeviceLost,
}: {
  boards: readonly BoardOption[];
  onDeviceLost: () => void;
}) {
  const [phase, setPhase] = useState<SocketPhase>('disconnected');
  const [link, setLink] = useState<LinkState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [port, setPort] = useState<string>('');
  const [baud, setBaud] = useState<number>(115200);
  const [lineEnding, setLineEnding] = useState<LineEnding>('lf');
  const [autoscroll, setAutoscroll] = useState(true);
  const [timestamps, setTimestamps] = useState(false);
  const [hexView, setHexView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lines = useSyncExternalStore(
    useCallback((listener: () => void) => buffer.subscribe(listener), []),
    useCallback(() => buffer.snapshot(), []),
  );

  // Keep a valid port selected as boards come and go.
  useEffect(() => {
    if (boards.length === 0) {
      setPort('');
      return;
    }
    const stillPresent = boards.some((board) => board.port === port);
    if (!stillPresent) setPort(boards[0]?.port ?? '');
  }, [boards, port]);

  useEffect(() => {
    // Cleanup unsubscribes; the singleton tolerates the StrictMode
    // subscribe → unsubscribe → subscribe cycle without dropping the socket (§3.4).
    const unsubscribe = serialLink.subscribe(
      (message: ServerMessage) => {
        switch (message.t) {
          case 'status':
            if (message.state === 'open' && message.port !== null && message.baud !== null) {
              setLink({ kind: 'open', port: message.port, baud: message.baud });
              setError(null);
            } else if (message.state === 'queued') {
              setLink({ kind: 'queued', position: message.queuePosition ?? 1 });
            } else {
              setLink({ kind: 'idle' });
            }
            break;
          case 'data':
            buffer.append(decodeBase64(message.b64), message.ts);
            break;
          case 'revoked':
            setLink({ kind: 'idle' });
            setNotice(
              message.reason === 'preempted'
                ? 'Port taken by an upload. Reconnect when it finishes.'
                : message.reason === 'device-lost'
                  ? 'Board disconnected.'
                  : null,
            );
            break;
          case 'device-lost':
            onDeviceLost();
            break;
          case 'error':
            setError(message.message);
            break;
          case 'pong':
            break;
        }
      },
      (next) => setPhase(next),
    );
    return unsubscribe;
  }, [onDeviceLost]);

  useEffect(() => {
    if (!autoscroll) return;
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines, autoscroll]);

  const connect = useCallback(() => {
    if (port === '') return;
    setError(null);
    setNotice(null);
    serialLink.send({ t: 'open', port, baud });
  }, [port, baud]);

  const disconnect = useCallback(() => {
    serialLink.send({ t: 'close' });
  }, []);

  const send = useCallback(() => {
    if (link.kind !== 'open') return;
    serialLink.send({ t: 'write', b64: encodeBase64(input + LINE_ENDINGS[lineEnding]) });
    setInput('');
  }, [input, lineEnding, link.kind]);

  const copyAll = useCallback(() => {
    const text = buffer
      .snapshot()
      .map((line) => (hexView ? toHex(line.bytes) : toText(line.bytes)))
      .join('\n');
    void navigator.clipboard.writeText(text).then(
      () => setNotice('Copied to clipboard.'),
      () => setError('Clipboard write was blocked by the browser.'),
    );
  }, [hexView]);

  const togglePause = useCallback(() => {
    const next = !paused;
    setPaused(next);
    buffer.setPaused(next);
  }, [paused]);

  const connected = link.kind === 'open';
  const tone: Tone =
    phase !== 'connected' ? 'error' : connected ? 'ok' : link.kind === 'queued' ? 'warn' : 'idle';

  const statusText =
    phase !== 'connected'
      ? 'Backend socket down'
      : link.kind === 'open'
        ? `${link.port} @ ${link.baud}`
        : link.kind === 'queued'
          ? `Queued (position ${link.position}) — another client holds the port`
          : 'Not connected';

  const boardOptions = useMemo(
    () =>
      boards.length === 0
        ? [{ value: '', label: 'No boards detected' }]
        : boards.map((board) => ({ value: board.port, label: `${board.displayName} — ${board.port}` })),
    [boards],
  );

  return (
    <Panel
      title="Serial Monitor"
      bodyClassName=""
      actions={
        <div className="flex items-center gap-2 text-xs">
          <StatusDot tone={tone} pulse={link.kind === 'queued'} />
          <span className="font-mono text-content-secondary">{statusText}</span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-2.5">
        <Select
          label="board"
          value={port}
          options={boardOptions}
          onChange={setPort}
          disabled={connected || boards.length === 0}
        />
        <Select
          label="baud"
          value={baud}
          options={BAUD_RATES.map((rate) => ({ value: rate, label: String(rate) }))}
          onChange={setBaud}
          disabled={connected}
        />
        {connected ? (
          <Button onClick={disconnect} variant="danger">
            Disconnect
          </Button>
        ) : (
          <Button onClick={connect} variant="primary" disabled={port === '' || phase !== 'connected'}>
            {link.kind === 'queued' ? 'Cancel queue' : 'Connect'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-edge-subtle px-4 py-2">
        <Toggle checked={autoscroll} onChange={setAutoscroll} label="autoscroll" />
        <Toggle checked={timestamps} onChange={setTimestamps} label="timestamps" />
        <Toggle checked={hexView} onChange={setHexView} label="hex" />
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={togglePause} title="Stop appending new lines">
            {paused ? `Resume${buffer.droppedCount > 0 ? ` (${buffer.droppedCount}B dropped)` : ''}` : 'Pause'}
          </Button>
          <Button onClick={copyAll}>Copy</Button>
          <Button onClick={() => buffer.clear()}>Clear</Button>
        </div>
      </div>

      {(error !== null || notice !== null) && (
        <div
          className={`border-b border-edge-subtle px-4 py-2 text-xs ${
            error !== null ? 'text-error' : 'text-content-secondary'
          }`}
        >
          {error ?? notice}
        </div>
      )}

      <div
        ref={scrollRef}
        className="h-80 overflow-auto bg-input px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-content-muted">
            {connected
              ? 'Connected. Waiting for data from the board…'
              : 'Not connected. Pick a board and baud rate, then hit Connect.'}
          </p>
        ) : (
          lines.map((line) => {
            const binary = isBinary(line.bytes);
            return (
              <div key={line.id} className="flex gap-3 whitespace-pre-wrap">
                {timestamps && (
                  <span className="shrink-0 text-content-muted">
                    {formatTimestamp(line.ts)}
                  </span>
                )}
                <span
                  className={
                    hexView || binary
                      ? 'text-[var(--port-pin)]'
                      : 'text-content'
                  }
                >
                  {hexView || binary ? toHex(line.bytes) : toText(line.bytes)}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-edge-subtle px-4 py-2.5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send();
          }}
          disabled={!connected}
          placeholder={connected ? 'Type a message and press Enter' : 'Connect to send'}
          className="flex-1 rounded border border-edge bg-card px-2.5 py-1.5 font-mono text-xs disabled:opacity-40"
        />
        <Select
          label="ending"
          value={lineEnding}
          options={[
            { value: 'none', label: 'none' },
            { value: 'lf', label: '\\n' },
            { value: 'cr', label: '\\r' },
            { value: 'crlf', label: '\\r\\n' },
          ]}
          onChange={setLineEnding}
        />
        <Button onClick={send} disabled={!connected}>
          Send
        </Button>
      </div>
    </Panel>
  );
}
