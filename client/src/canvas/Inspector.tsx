import { getNodeDef, inputPorts, outputPorts } from '@/nodes/registry';
import { typeLabel } from '@/nodes/typeSystem';
import { CATEGORY, PORT_COLOR } from '@/nodes/types';
import { FRAME_COLORS, isForgeNode, isFrameNode, type AnyNode } from '@/graph/model';
import { useGraphStore } from '@/store/graphStore';
import { LiteralEditor } from '@/canvas/LiteralEditor';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

export function Inspector({ selected }: { selected: readonly AnyNode[] }) {
  const setConfig = useGraphStore((state) => state.setConfig);
  const setLiteral = useGraphStore((state) => state.setLiteral);
  const setFrameColor = useGraphStore((state) => state.setFrameColor);
  const setFrameTitle = useGraphStore((state) => state.setFrameTitle);
  const align = useGraphStore((state) => state.alignSelection);
  const distribute = useGraphStore((state) => state.distributeSelection);

  if (selected.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-content-muted">
          Select a node to edit its settings.
        </p>
        <p className="mt-2 text-[11px] text-content-muted">
          Press <kbd className="font-mono">⌘K</kbd> to add one.
        </p>
      </div>
    );
  }

  if (selected.length > 1) {
    const buttons = [
      { label: 'Left', axis: 'left' as const },
      { label: 'Center', axis: 'centerX' as const },
      { label: 'Right', axis: 'right' as const },
      { label: 'Top', axis: 'top' as const },
      { label: 'Middle', axis: 'centerY' as const },
      { label: 'Bottom', axis: 'bottom' as const },
    ];
    return (
      <div className="p-4">
        <p className="text-xs text-content-secondary">
          {selected.length} nodes selected
        </p>
        <p className="mt-4 mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
          Align
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {buttons.map((button) => (
            <button
              key={button.axis}
              type="button"
              onClick={() => align(button.axis)}
              className="rounded border border-edge bg-card px-2 py-1 text-xs hover:bg-header"
            >
              {button.label}
            </button>
          ))}
        </div>
        <p className="mt-4 mb-2 text-[10px] tracking-[0.12em] text-content-muted uppercase">
          Distribute
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => distribute('horizontal')}
            disabled={selected.length < 3}
            className="rounded border border-edge bg-card px-2 py-1 text-xs hover:bg-header disabled:opacity-40"
          >
            Horizontally
          </button>
          <button
            type="button"
            onClick={() => distribute('vertical')}
            disabled={selected.length < 3}
            className="rounded border border-edge bg-card px-2 py-1 text-xs hover:bg-header disabled:opacity-40"
          >
            Vertically
          </button>
        </div>
      </div>
    );
  }

  const node = selected[0];
  if (node === undefined) return null;

  if (isFrameNode(node)) {
    return (
      <div className="p-4">
        <p className="mb-3 text-[10px] tracking-[0.12em] text-content-muted uppercase">
          Group frame
        </p>
        <Field label="Title">
          <input
            value={node.data.title}
            onChange={(event) => setFrameTitle(node.id, event.target.value)}
            className="w-40 rounded border border-edge bg-input px-2 py-1 text-xs"
          />
        </Field>
        <Field label="Colour">
          <select
            value={node.data.color}
            onChange={(event) => setFrameColor(node.id, event.target.value)}
            className="rounded border border-edge bg-input px-2 py-1 text-xs"
          >
            {FRAME_COLORS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    );
  }

  if (!isForgeNode(node)) {
    return <div className="p-4 text-xs text-content-muted">Reroute point.</div>;
  }

  const def = getNodeDef(node.data.defId);
  if (def === null) {
    return (
      <div className="p-4 text-xs text-error">
        Unknown node type: {node.data.defId}
      </div>
    );
  }

  const category = CATEGORY[def.category];
  const Icon = def.icon;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded"
          style={{ backgroundColor: category.color }}
        >
          <Icon size={13} className="text-on-semantic/80" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{def.label}</p>
          <p className="truncate text-[10px] text-content-muted">{category.label}</p>
        </div>
      </div>
      <p className="mt-2.5 text-xs text-content-secondary">{def.description}</p>

      {(def.config?.length ?? 0) > 0 && (
        <>
          <p className="mt-4 mb-1 text-[10px] tracking-[0.12em] text-content-muted uppercase">
            Settings
          </p>
          {(def.config ?? []).map((field) => {
            const value = node.data.config[field.id] ?? field.default;
            return (
              <Field key={field.id} label={field.label}>
                {field.kind === 'select' ? (
                  <select
                    value={String(value)}
                    onChange={(event) => setConfig(node.id, field.id, event.target.value)}
                    className="rounded border border-edge bg-input px-2 py-1 font-mono text-xs"
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => setConfig(node.id, field.id, event.target.checked)}
                    className="size-3.5 accent-interactive"
                  />
                ) : field.kind === 'number' ? (
                  <input
                    type="number"
                    value={typeof value === 'number' ? value : field.default}
                    min={field.min}
                    max={field.max}
                    onChange={(event) => setConfig(node.id, field.id, event.target.valueAsNumber)}
                    className="w-24 rounded border border-edge bg-input px-2 py-1 text-right font-mono text-xs"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value)}
                    placeholder={field.placeholder}
                    onChange={(event) => setConfig(node.id, field.id, event.target.value)}
                    className="w-32 rounded border border-edge bg-input px-2 py-1 font-mono text-xs"
                  />
                )}
              </Field>
            );
          })}
        </>
      )}

      {inputPorts(def, node.data.config).length > 0 && (
        <>
          <p className="mt-4 mb-1 text-[10px] tracking-[0.12em] text-content-muted uppercase">
            Inputs
          </p>
          {inputPorts(def, node.data.config).map((port) => (
            <div key={port.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex items-center gap-2 text-xs">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PORT_COLOR[port.type] }}
                />
                <span className="text-content-secondary">{port.label}</span>
                <span className="text-[10px] text-content-muted">
                  {typeLabel(port.type)}
                </span>
              </span>
              {port.literal !== undefined && (
                <LiteralEditor
                  spec={port.literal}
                  value={node.data.literals[port.id]}
                  onChange={(value) => setLiteral(node.id, port.id, value)}
                />
              )}
            </div>
          ))}
        </>
      )}

      {outputPorts(def, node.data.config).length > 0 && (
        <>
          <p className="mt-4 mb-1 text-[10px] tracking-[0.12em] text-content-muted uppercase">
            Outputs
          </p>
          {outputPorts(def, node.data.config).map((port) => (
            <div key={port.id} className="flex items-center gap-2 py-1 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: PORT_COLOR[port.type] }}
              />
              <span className="text-content-secondary">{port.label}</span>
              <span className="text-[10px] text-content-muted">
                {typeLabel(port.type)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
