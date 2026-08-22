import { ChevronLeft } from 'lucide-react';
import { specFor, type Binding, type Widget } from '@/dashboard/model';
import { useDashboard } from '@/dashboard/store';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-28 rounded border border-edge bg-input px-2 py-1 font-mono text-xs';

/**
 * The binding dropdown is built from the variables the graph actually exposes,
 * so it cannot drift out of sync with the sketch (§Phase 6).
 */
function BindingPicker({
  value,
  onChange,
  label = 'Bind to',
}: {
  value: Binding;
  onChange: (binding: Binding) => void;
  label?: string;
}) {
  const exposed = useDashboard((state) => state.exposedNames);

  const current =
    value.kind === 'var' ? `var:${value.name}` : value.kind === 'pin' ? `pin:${value.pin}` : 'none';

  return (
    <Field label={label}>
      <select
        value={current}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === 'none') {
            onChange({ kind: 'none' });
            return;
          }
          const [kind, rest] = raw.split(':');
          if (kind === 'var' && rest !== undefined) {
            onChange({ kind: 'var', name: rest, direction: 'both' });
          } else if (kind === 'pin' && rest !== undefined) {
            onChange({ kind: 'pin', pin: Number(rest), op: 'analogWrite' });
          }
        }}
        className={inputClass}
      >
        <option value="none">unbound</option>
        {exposed.length > 0 && (
          <optgroup label="Exposed variables">
            {exposed.map((name) => (
              <option key={name} value={`var:${name}`}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Pins">
          {Array.from({ length: 14 }, (_, pin) => (
            <option key={pin} value={`pin:${pin}`}>
              D{pin}
            </option>
          ))}
        </optgroup>
      </select>
    </Field>
  );
}

export function WidgetInspector({ widget }: { widget: Widget }) {
  const store = useDashboard();
  const spec = specFor(widget.type);
  const config = widget.config;

  const num = (id: keyof typeof config, fallback: number) => {
    const value = config[id];
    return typeof value === 'number' ? value : fallback;
  };

  return (
    <div className="p-3">
      <button
        type="button"
        onClick={() => store.select(null)}
        className="mb-3 flex items-center gap-1 text-[11px] text-content-secondary hover:text-content"
      >
        <ChevronLeft size={12} /> Back to widgets
      </button>

      <p className="text-sm font-medium">{spec.label}</p>
      <p className="mt-0.5 mb-3 text-[11px] text-content-muted">{spec.description}</p>

      <Field label="Label">
        <input
          value={config.label ?? ''}
          onChange={(event) => store.setConfig(widget.id, { label: event.target.value })}
          className={inputClass}
        />
      </Field>

      {spec.accepts !== 'none' && (
        <BindingPicker
          value={widget.binding}
          onChange={(binding) => store.setBinding(widget.id, binding)}
        />
      )}

      {widget.type === 'xypad' && (
        <BindingPicker
          label="Y axis"
          value={config.bindingY ?? { kind: 'none' }}
          onChange={(binding) => store.setConfig(widget.id, { bindingY: binding })}
        />
      )}

      {widget.type === 'color' && (
        <>
          {(['Red', 'Green', 'Blue'] as const).map((channel, index) => (
            <BindingPicker
              key={channel}
              label={channel}
              value={config.bindingsRgb?.[index] ?? { kind: 'none' }}
              onChange={(binding) => {
                const current: [Binding, Binding, Binding] = [
                  config.bindingsRgb?.[0] ?? { kind: 'none' },
                  config.bindingsRgb?.[1] ?? { kind: 'none' },
                  config.bindingsRgb?.[2] ?? { kind: 'none' },
                ];
                current[index] = binding;
                store.setConfig(widget.id, { bindingsRgb: current });
              }}
            />
          ))}
        </>
      )}

      {(['slider', 'gauge', 'bar', 'number', 'xypad'] as const).includes(
        widget.type as 'slider',
      ) && (
        <>
          <Field label="Min">
            <input
              type="number"
              value={num('min', 0)}
              onChange={(event) => store.setConfig(widget.id, { min: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
          <Field label="Max">
            <input
              type="number"
              value={num('max', 1023)}
              onChange={(event) => store.setConfig(widget.id, { max: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {widget.type === 'slider' && (
        <>
          <Field label="Step">
            <input
              type="number"
              value={num('step', 1)}
              onChange={(event) => store.setConfig(widget.id, { step: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
          <Field label="Send while dragging">
            <input
              type="checkbox"
              checked={config.liveSend !== false}
              onChange={(event) => store.setConfig(widget.id, { liveSend: event.target.checked })}
              className="size-3.5 accent-interactive"
            />
          </Field>
        </>
      )}

      {(['readout', 'gauge', 'bar', 'statGrid'] as const).includes(widget.type as 'readout') && (
        <>
          <Field label="Decimals">
            <input
              type="number"
              min={0}
              max={4}
              value={num('decimals', 0)}
              onChange={(event) => store.setConfig(widget.id, { decimals: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
          <Field label="Unit">
            <input
              value={config.unit ?? ''}
              onChange={(event) => store.setConfig(widget.id, { unit: event.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {widget.type === 'button' && (
        <Field label="Momentary">
          <input
            type="checkbox"
            checked={config.momentary !== false}
            onChange={(event) => store.setConfig(widget.id, { momentary: event.target.checked })}
            className="size-3.5 accent-interactive"
          />
        </Field>
      )}

      {(['button', 'switch'] as const).includes(widget.type as 'button') && (
        <>
          <Field label="On value">
            <input
              type="number"
              value={num('onValue', 1)}
              onChange={(event) => store.setConfig(widget.id, { onValue: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
          <Field label="Off value">
            <input
              type="number"
              value={num('offValue', 0)}
              onChange={(event) => store.setConfig(widget.id, { offValue: event.target.valueAsNumber })}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {widget.type === 'chart' && (
        <>
          <Field label="Window (s)">
            <input
              type="number"
              min={2}
              max={120}
              value={num('windowSeconds', 20)}
              onChange={(event) =>
                store.setConfig(widget.id, { windowSeconds: event.target.valueAsNumber })
              }
              className={inputClass}
            />
          </Field>
          <p className="mt-2 text-[10px] text-content-muted">
            Bind the chart to a variable above to plot one series. Multi-series charts read the
            series list from the project file.
          </p>
        </>
      )}

      {widget.type === 'statGrid' && (
        <Field label="Values">
          <input
            value={(config.names ?? []).join(', ')}
            placeholder="a, b, c"
            onChange={(event) =>
              store.setConfig(widget.id, {
                names: event.target.value
                  .split(',')
                  .map((name) => name.trim())
                  .filter((name) => name !== ''),
              })
            }
            className={inputClass}
          />
        </Field>
      )}

      {(['led', 'button'] as const).includes(widget.type as 'led') && (
        <Field label="Colour">
          <input
            type="color"
            value={config.color ?? '#00945B'}
            onChange={(event) => store.setConfig(widget.id, { color: event.target.value })}
            className="h-7 w-28 cursor-pointer rounded border border-edge bg-transparent"
          />
        </Field>
      )}

      <button
        type="button"
        onClick={() => store.removeWidget(widget.id)}
        className="mt-4 w-full rounded border border-error px-2 py-1 text-xs text-error hover:bg-destructive/10"
      >
        Remove widget
      </button>
    </div>
  );
}
