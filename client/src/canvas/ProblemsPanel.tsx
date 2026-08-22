import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useGraphStore } from '@/store/graphStore';
import type { Problem } from '@/graph/validate';

export function ProblemsPanel({ onFocusNode }: { onFocusNode: (nodeId: string) => void }) {
  const problems = useGraphStore((state) => state.problems);

  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.length - errors;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-edge-subtle px-3 py-2">
        <span className="text-[10px] tracking-[0.12em] text-content-secondary uppercase">
          Problems
        </span>
        {problems.length > 0 && (
          <span className="flex items-center gap-2 text-[11px]">
            {errors > 0 && (
              <span className="text-error">{errors} error{errors === 1 ? '' : 's'}</span>
            )}
            {warnings > 0 && (
              <span className="text-warning">
                {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {problems.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-content-muted">
            <CheckCircle2 size={14} className="text-success" />
            No problems. This graph is ready to generate.
          </div>
        ) : (
          <ul>
            {problems.map((problem: Problem, index) => {
              const isError = problem.severity === 'error';
              const Icon = isError ? XCircle : AlertTriangle;
              const color = isError ? 'var(--feedback-destructive)' : 'var(--feedback-warning)';
              const clickable = problem.nodeId !== null;
              return (
                <li key={`${problem.nodeId ?? 'graph'}-${index}`}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => {
                      if (problem.nodeId !== null) onFocusNode(problem.nodeId);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs ${
                      clickable ? 'hover:bg-card' : 'cursor-default'
                    }`}
                  >
                    <Icon size={13} style={{ color }} className="mt-0.5 shrink-0" />
                    <span className="text-content-secondary">{problem.message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
