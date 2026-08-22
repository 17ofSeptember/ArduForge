import type { LiteralSpec, LiteralValue } from '@/nodes/types';

/**
 * Inline editor for an unconnected data input. The `nodrag`/`nowheel` classes
 * are required: without them React Flow treats a click as the start of a node
 * drag and the control never receives the interaction.
 */
export function LiteralEditor({
  spec,
  value,
  onChange,
  compact = false,
}: {
  spec: LiteralSpec;
  value: LiteralValue | undefined;
  onChange: (value: LiteralValue) => void;
  compact?: boolean;
}) {
  const base = `nodrag nowheel rounded border border-edge bg-input px-1.5 py-0.5 font-mono text-[11px] text-content focus:border-interactive`;

  switch (spec.kind) {
    case 'number': {
      const current = typeof value === 'number' ? value : spec.default;
      return (
        <input
          type="number"
          value={current}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? (spec.integer === true ? 1 : 'any')}
          onChange={(event) => {
            const raw = event.target.valueAsNumber;
            if (Number.isNaN(raw)) return;
            onChange(spec.integer === true ? Math.round(raw) : raw);
          }}
          className={`${base} ${compact ? 'w-14' : 'w-20'} text-right`}
        />
      );
    }

    case 'boolean': {
      const current = typeof value === 'boolean' ? value : spec.default;
      const onLabel = spec.trueLabel ?? 'true';
      const offLabel = spec.falseLabel ?? 'false';
      return (
        <button
          type="button"
          onClick={() => onChange(!current)}
          className={`${base} min-w-14 cursor-pointer text-center font-semibold`}
          style={{ color: current ? 'var(--feedback-success)' : 'var(--text-muted)' }}
        >
          {current ? onLabel : offLabel}
        </button>
      );
    }

    case 'string': {
      const current = typeof value === 'string' ? value : spec.default;
      return (
        <input
          type="text"
          value={current}
          placeholder={spec.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`${base} ${compact ? 'w-24' : 'w-32'}`}
        />
      );
    }

    case 'select': {
      const current = typeof value === 'string' ? value : spec.default;
      return (
        <select
          value={current}
          onChange={(event) => onChange(event.target.value)}
          className={`${base} cursor-pointer`}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
  }
}
