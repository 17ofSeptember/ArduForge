import { useCallback, useState } from 'react';
import { CircleCheck, Upload as UploadIcon } from 'lucide-react';
import { generate } from '@/codegen/generate';
import { sketchFilesFor } from '@/codegen/sketchFiles';
import { useGraphStore } from '@/store/graphStore';
import { checkLibraries, compile, installLibrary, upload } from '@/link/buildLink';
import { toast } from '@/ui/toast';
import { reportBuildSizes } from '@/ui/StatusBar';
import type { UploadTarget } from '@/build/BuildPanel';

/**
 * Verify / Upload driven by the graph rather than a pasted sketch.
 * Codegen always runs immediately before the request, so what reaches the board
 * is what is on the canvas right now.
 */
export function GraphBuildActions({ targets }: { targets: readonly UploadTarget[] }) {
  const [busy, setBusy] = useState<'verify' | 'upload' | null>(null);
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);
  const target = targets[0] ?? null;

  const install = useCallback(async (name: string) => {
    setInstalling(name);
    try {
      const result = await installLibrary(name);
      if (result.ok) {
        setMissing((current) => current.filter((entry) => entry !== name));
        toast.success('Library installed', name);
      } else {
        toast.error('Install failed', result.error ?? name);
      }
    } finally {
      setInstalling(null);
    }
  }, []);

  const build = useCallback(async (): Promise<string | null> => {
    const state = useGraphStore.getState();
    const result = generate(state.nodes, state.edges, {
      projectName: state.project.meta.name,
      fqbn: state.project.board.fqbn,
    });

    if (!result.ok) {
      const first = result.problems.find((problem) => problem.severity === 'error');
      toast.error('Graph has errors', first?.message ?? 'Fix the problems panel first.');
      return null;
    }

    // Missing libraries produce a "no such file" error that says nothing about
    // how to fix it, so catch them before the compiler does (§Phase 5).
    if (result.libraries.length > 0) {
      const check = await checkLibraries(result.libraries);
      if (check.missing.length > 0) {
        setMissing(check.missing);
        toast.warning(
          `${check.missing.length} librar${check.missing.length === 1 ? 'y is' : 'ies are'} missing`,
          `${check.missing.join(', ')} — install from the banner above the canvas.`,
        );
        return null;
      }
      setMissing([]);
    }

    const compiled = await compile(
      sketchFilesFor(result),
      target?.fqbn ?? 'arduino:avr:uno',
      result.libraries,
    );

    if (!compiled.ok) {
      const diagnostic = compiled.diagnostics[0];
      toast.error(
        'Compile failed',
        diagnostic === undefined
          ? (compiled.error ?? 'Unknown compile error.')
          : `${diagnostic.file}:${diagnostic.line ?? '?'} ${diagnostic.message}`,
      );
      return null;
    }

    const program = compiled.program;
    // Feeds the status bar's flash and free-SRAM readout (§Phase 8).
    if (program !== null && compiled.data !== null) {
      reportBuildSizes({
        programUsed: program.used,
        programMax: program.max,
        dataUsed: compiled.data.used,
        dataMax: compiled.data.max,
      });
    }
    toast.success(
      'Compiled',
      program === null
        ? 'Sketch built successfully.'
        : `${program.used.toLocaleString()} B of ${program.max.toLocaleString()} B flash (${program.percent}%).`,
    );
    return compiled.buildId;
  }, [target]);

  const onVerify = useCallback(async () => {
    setBusy('verify');
    try {
      await build();
    } finally {
      setBusy(null);
    }
  }, [build]);

  const onUpload = useCallback(async () => {
    if (target === null) {
      toast.warning('No board connected', 'Plug in an Arduino and try again.');
      return;
    }
    setBusy('upload');
    try {
      const buildId = await build();
      if (buildId === null) return;
      const result = await upload(buildId, target.port);
      if (result.ok) toast.success('Uploaded', `Running on ${target.port}.`);
      else toast.error('Upload failed', result.error ?? 'Unknown error.');
    } finally {
      setBusy(null);
    }
  }, [build, target]);

  return (
    <>
      {missing.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => void install(name)}
          disabled={installing !== null}
          className="pointer-events-auto flex items-center gap-1 rounded bg-warning px-2.5 py-1 text-[11px] font-medium text-on-interactive hover:opacity-90 disabled:opacity-40"
        >
          {installing === name ? `Installing ${name}…` : `Install ${name}`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => void onVerify()}
        disabled={busy !== null}
        className="pointer-events-auto flex items-center gap-1 rounded border border-edge bg-card/90 px-2.5 py-1 text-[11px] backdrop-blur hover:bg-header disabled:opacity-40"
      >
        <CircleCheck size={12} />
        {busy === 'verify' ? 'Verifying…' : 'Verify'}
      </button>
      <button
        type="button"
        onClick={() => void onUpload()}
        disabled={busy !== null || target === null}
        title={target === null ? 'No board detected' : `Upload to ${target.port}`}
        className="pointer-events-auto flex items-center gap-1 rounded bg-interactive px-2.5 py-1 text-[11px] font-medium text-on-interactive hover:opacity-90 disabled:opacity-40"
      >
        <UploadIcon size={12} />
        {busy === 'upload' ? 'Uploading…' : 'Upload'}
      </button>
    </>
  );
}
