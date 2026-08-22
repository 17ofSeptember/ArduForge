import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildLink,
  compile,
  upload,
  type BuildEvent,
  type CompileResult,
  type Diagnostic,
  type SectionSize,
} from '@/link/buildLink';
import { Button, Panel, Select, StatusDot, type Tone } from '@/ui/primitives';

const DEFAULT_SKETCH = `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

/** §Phase 8: no unbounded arrays anywhere. */
const MAX_CONSOLE_LINES = 1_000;

type Status =
  | { kind: 'idle' }
  | { kind: 'compiling' }
  | { kind: 'uploading'; step: string }
  | { kind: 'compiled'; result: CompileResult }
  | { kind: 'uploaded' }
  | { kind: 'failed'; message: string };

interface ConsoleLine {
  readonly id: number;
  readonly stream: 'out' | 'err' | 'step';
  readonly text: string;
}

export interface UploadTarget {
  readonly port: string;
  readonly fqbn: string | null;
  readonly displayName: string;
}

function SizeBar({ size, label }: { size: SectionSize; label: string }) {
  const tone = size.percent > 90 ? 'error' : size.percent > 75 ? 'warn' : 'ok';
  const color =
    tone === 'error'
      ? 'var(--feedback-destructive)'
      : tone === 'warn'
        ? 'var(--feedback-warning)'
        : 'var(--feedback-success)';
  return (
    <div className="flex-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-content-secondary">{label}</span>
        <span className="font-mono">
          {size.used.toLocaleString()} / {size.max.toLocaleString()} B ({size.percent}%)
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-header">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.min(size.percent, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  const tone =
    diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warn' : 'idle';
  const color =
    tone === 'error'
      ? 'var(--feedback-destructive)'
      : tone === 'warn'
        ? 'var(--feedback-warning)'
        : 'var(--text-muted)';

  return (
    <li className="rounded border border-edge-subtle bg-card p-2.5">
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-semibold uppercase" style={{ color }}>
          {diagnostic.severity}
        </span>
        <span className="font-mono text-content-secondary">
          {diagnostic.file}
          {diagnostic.line !== null && `:${diagnostic.line}`}
          {diagnostic.column !== null && `:${diagnostic.column}`}
        </span>
      </div>
      <p className="mt-1 text-sm">{diagnostic.message}</p>
      {diagnostic.snippet !== null && (
        <pre className="mt-2 overflow-x-auto rounded bg-input p-2 font-mono text-xs text-content-secondary">
          {diagnostic.snippet}
        </pre>
      )}
    </li>
  );
}

export function BuildPanel({ targets }: { targets: readonly UploadTarget[] }) {
  const [source, setSource] = useState(DEFAULT_SKETCH);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [lines, setLines] = useState<readonly ConsoleLine[]>([]);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (targets.length === 0) {
      setPort('');
      return;
    }
    if (!targets.some((target) => target.port === port)) setPort(targets[0]?.port ?? '');
  }, [targets, port]);

  const pushLine = useCallback((stream: ConsoleLine['stream'], text: string) => {
    setLines((previous) => {
      const next = [...previous, { id: nextId.current, stream, text }];
      nextId.current += 1;
      return next.length > MAX_CONSOLE_LINES ? next.slice(next.length - MAX_CONSOLE_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = buildLink.subscribe((event: BuildEvent) => {
      switch (event.t) {
        case 'build:start':
          pushLine('step', `── ${event.phase} started ──`);
          break;
        case 'build:log':
          pushLine(event.stream, event.line);
          break;
        case 'build:step':
          pushLine('step', event.message);
          setStatus((current) =>
            current.kind === 'uploading' ? { kind: 'uploading', step: event.message } : current,
          );
          break;
        case 'build:done':
          pushLine('step', `── ${event.phase} ${event.ok ? 'succeeded' : 'failed'} ──`);
          break;
      }
    });
    return unsubscribe;
  }, [pushLine]);

  useEffect(() => {
    const element = consoleRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const selectedTarget = targets.find((target) => target.port === port) ?? null;
  const fqbn = selectedTarget?.fqbn ?? 'arduino:avr:uno';

  const runVerify = useCallback(async (): Promise<CompileResult | null> => {
    setBusy(true);
    setStatus({ kind: 'compiling' });
    try {
      const result = await compile([{ name: 'Sketch.ino', content: source }], fqbn);
      setStatus(
        result.ok
          ? { kind: 'compiled', result }
          : { kind: 'failed', message: result.error ?? 'Compilation failed.' },
      );
      return result;
    } catch (error: unknown) {
      setStatus({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Compile request failed.',
      });
      return null;
    } finally {
      setBusy(false);
    }
  }, [source, fqbn]);

  const runUpload = useCallback(async () => {
    // Always compile immediately before uploading, so what lands on the board
    // is what is currently in the editor — never a stale build id.
    const result = await runVerify();
    if (result === null || !result.ok || port === '') return;

    setBusy(true);
    setStatus({ kind: 'uploading', step: 'Starting…' });
    try {
      const uploadResult = await upload(result.buildId, port);
      setStatus(
        uploadResult.ok
          ? { kind: 'uploaded' }
          : { kind: 'failed', message: uploadResult.error ?? 'Upload failed.' },
      );
    } catch (error: unknown) {
      setStatus({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Upload request failed.',
      });
    } finally {
      setBusy(false);
    }
  }, [runVerify, port]);

  const pill: { tone: Tone; text: string } =
    status.kind === 'compiling'
      ? { tone: 'warn', text: 'Compiling…' }
      : status.kind === 'uploading'
        ? { tone: 'warn', text: 'Uploading…' }
        : status.kind === 'compiled'
          ? { tone: 'ok', text: 'Compiled' }
          : status.kind === 'uploaded'
            ? { tone: 'ok', text: 'Uploaded' }
            : status.kind === 'failed'
              ? { tone: 'error', text: 'Failed' }
              : { tone: 'idle', text: 'Idle' };

  const diagnostics =
    status.kind === 'compiled'
      ? status.result.diagnostics
      : status.kind === 'failed'
        ? []
        : [];
  const lastResult = status.kind === 'compiled' ? status.result : null;

  return (
    <Panel
      title="Sketch"
      bodyClassName=""
      actions={
        <div className="flex items-center gap-2 text-xs">
          <StatusDot tone={pill.tone} pulse={busy} />
          <span className="text-content-secondary">{pill.text}</span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-edge-subtle px-4 py-2.5">
        <Select
          label="target"
          value={port}
          options={
            targets.length === 0
              ? [{ value: '', label: 'No boards detected' }]
              : targets.map((target) => ({
                  value: target.port,
                  label: `${target.displayName} — ${target.port}`,
                }))
          }
          onChange={setPort}
          disabled={busy || targets.length === 0}
        />
        <span className="font-mono text-xs text-content-muted">{fqbn}</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void runVerify()} disabled={busy}>
            Verify
          </Button>
          <Button onClick={() => void runUpload()} disabled={busy || port === ''} variant="primary">
            Upload
          </Button>
        </div>
      </div>

      <textarea
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
        rows={12}
        className="w-full resize-y border-b border-edge-subtle bg-input px-4 py-3 font-mono text-xs leading-relaxed"
      />

      {lastResult !== null && (lastResult.program !== null || lastResult.data !== null) && (
        <div className="flex flex-wrap gap-6 border-b border-edge-subtle px-4 py-3">
          {lastResult.program !== null && <SizeBar size={lastResult.program} label="Program (flash)" />}
          {lastResult.data !== null && <SizeBar size={lastResult.data} label="Global variables (SRAM)" />}
        </div>
      )}

      {status.kind === 'failed' && (
        <div className="border-b border-edge-subtle px-4 py-2.5 text-sm text-error">
          {status.message}
        </div>
      )}

      {status.kind === 'uploading' && (
        <div className="border-b border-edge-subtle px-4 py-2.5 text-sm text-content-secondary">
          {status.step}
        </div>
      )}

      {diagnostics.length > 0 && (
        <ul className="space-y-2 border-b border-edge-subtle px-4 py-3">
          {diagnostics.map((diagnostic, index) => (
            <DiagnosticRow key={`${diagnostic.file}:${diagnostic.line}:${index}`} diagnostic={diagnostic} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-b border-edge-subtle px-4 py-1.5">
        <span className="text-xs tracking-[0.12em] text-content-muted uppercase">
          Build output
        </span>
        <Button onClick={() => setLines([])}>Clear</Button>
      </div>

      <div
        ref={consoleRef}
        className="h-48 overflow-auto bg-input px-4 py-3 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-content-muted">
            Nothing built yet. Hit Verify to compile, or Upload to compile and flash.
          </p>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={
                line.stream === 'err'
                  ? 'text-warning'
                  : line.stream === 'step'
                    ? 'text-info'
                    : 'text-content-secondary'
              }
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
