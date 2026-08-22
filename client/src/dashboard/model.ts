/**
 * Dashboard document model (BUILD_PLAN.md §Phase 6).
 * Persisted inside the .forge project, so changes need a migration.
 */

export type Binding =
  | { kind: 'pin'; pin: number; op: 'digitalWrite' | 'digitalRead' | 'analogWrite' | 'analogRead' }
  | { kind: 'var'; name: string; direction: 'read' | 'write' | 'both' }
  | { kind: 'command'; raw: string }
  | { kind: 'none' };

export type WidgetType =
  | 'button'
  | 'slider'
  | 'switch'
  | 'number'
  | 'led'
  | 'gauge'
  | 'chart'
  | 'readout'
  | 'bar'
  | 'xypad'
  | 'color'
  | 'terminal'
  | 'logTable'
  | 'statGrid';

export interface WidgetConfig {
  readonly label?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly decimals?: number;
  readonly onValue?: number;
  readonly offValue?: number;
  readonly momentary?: boolean;
  readonly liveSend?: boolean;
  readonly color?: string;
  readonly windowSeconds?: number;
  readonly zones?: readonly { readonly from: number; readonly color: string }[];
  readonly series?: readonly { readonly binding: Binding; readonly color: string; readonly label: string }[];
  readonly maxRows?: number;
  readonly vertical?: boolean;
  readonly threshold?: number;
  readonly springToCentre?: boolean;
  readonly bindingY?: Binding;
  readonly bindingsRgb?: readonly [Binding, Binding, Binding];
  readonly names?: readonly string[];
}

export interface Widget {
  readonly id: string;
  readonly type: WidgetType;
  readonly pageId: string;
  /** 12-column CSS Grid placement. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly binding: Binding;
  readonly config: WidgetConfig;
}

export interface DashboardPage {
  readonly id: string;
  readonly name: string;
}

export interface DashboardDoc {
  readonly pages: readonly DashboardPage[];
  readonly widgets: readonly Widget[];
}

export const GRID_COLUMNS = 12;
export const ROW_HEIGHT_PX = 56;

export interface WidgetSpec {
  readonly type: WidgetType;
  readonly label: string;
  readonly description: string;
  /** Default size in grid units. */
  readonly w: number;
  readonly h: number;
  readonly defaults: WidgetConfig;
  /** What this widget needs to be useful. */
  readonly accepts: 'write' | 'read' | 'both' | 'none';
}

/**
 * Default widget colours (THEME.md Phase 5).
 *
 * These are stored as literal hex in the project file, so they cannot be
 * theme-aware — a widget's colour is user data and follows the project, not the
 * app's palette. That makes the constraint unusual: each default has to be
 * legible on BOTH card surfaces at once, so they are chosen at the lightness
 * that maximises the worse of the two (~3.5:1 against #19303C and #F0F5F8).
 *
 * Changing these affects only NEW widgets. Existing projects keep their colours
 * exactly as saved — rewriting them would be silent data loss, and nothing in
 * persistence.ts or projectManager.ts touches a colour.
 */
export const WIDGET_SPECS: readonly WidgetSpec[] = [
  {
    type: 'button',
    label: 'Button',
    description: 'Sends a value when pressed.',
    w: 3,
    h: 2,
    accepts: 'write',
    defaults: { label: 'Button', onValue: 1, offValue: 0, momentary: true, color: '#3084D7' },
  },
  {
    type: 'slider',
    label: 'Slider',
    description: 'Drags through a range of values.',
    w: 6,
    h: 2,
    accepts: 'write',
    defaults: { label: 'Slider', min: 0, max: 180, step: 1, liveSend: true, unit: '' },
  },
  {
    type: 'switch',
    label: 'Switch',
    description: 'Toggles between on and off.',
    w: 3,
    h: 2,
    accepts: 'write',
    defaults: { label: 'Switch', onValue: 1, offValue: 0 },
  },
  {
    type: 'number',
    label: 'Number Input',
    description: 'Types an exact value.',
    w: 3,
    h: 2,
    accepts: 'write',
    defaults: { label: 'Value', min: 0, max: 1023, step: 1 },
  },
  {
    type: 'led',
    label: 'LED Indicator',
    description: 'Lights up when a value is true.',
    w: 2,
    h: 2,
    accepts: 'read',
    defaults: { label: 'LED', color: '#00945B' },
  },
  {
    type: 'gauge',
    label: 'Gauge',
    description: 'Shows a value on a dial with coloured zones.',
    w: 4,
    h: 4,
    accepts: 'read',
    defaults: {
      label: 'Gauge',
      min: 0,
      max: 1023,
      decimals: 0,
      zones: [
        { from: 0, color: '#00945B' },
        { from: 0.7, color: '#B27400' },
        { from: 0.9, color: '#D25C5B' },
      ],
    },
  },
  {
    type: 'chart',
    label: 'Line Chart',
    description: 'Plots up to four values over time.',
    w: 12,
    h: 5,
    accepts: 'read',
    defaults: { label: 'Chart', windowSeconds: 20, series: [] },
  },
  {
    type: 'readout',
    label: 'Value Readout',
    description: 'Shows one number, large.',
    w: 3,
    h: 2,
    accepts: 'read',
    defaults: { label: 'Value', decimals: 0, unit: '' },
  },
  {
    type: 'bar',
    label: 'Bar Meter',
    description: 'A filling bar with a threshold marker.',
    w: 4,
    h: 2,
    accepts: 'read',
    defaults: { label: 'Level', min: 0, max: 1023, vertical: false },
  },
  {
    type: 'xypad',
    label: 'XY Pad',
    description: 'Drives two values from one pad.',
    w: 4,
    h: 5,
    accepts: 'write',
    defaults: { label: 'XY', min: -255, max: 255, springToCentre: true },
  },
  {
    type: 'color',
    label: 'Colour Picker',
    description: 'Drives three values as red, green, and blue.',
    w: 4,
    h: 3,
    accepts: 'write',
    defaults: { label: 'Colour' },
  },
  {
    type: 'terminal',
    label: 'Serial Terminal',
    description: 'Shows the raw log stream from the board.',
    w: 6,
    h: 5,
    accepts: 'none',
    defaults: { label: 'Terminal', maxRows: 300 },
  },
  {
    type: 'logTable',
    label: 'Log Table',
    description: 'Shows log lines as timestamped rows.',
    w: 6,
    h: 5,
    accepts: 'none',
    defaults: { label: 'Log', maxRows: 200 },
  },
  {
    type: 'statGrid',
    label: 'Stat Cards',
    description: 'Compact tiles for several values at once.',
    w: 6,
    h: 3,
    accepts: 'read',
    defaults: { label: 'Stats', names: [], decimals: 0 },
  },
];

export function specFor(type: WidgetType): WidgetSpec {
  const found = WIDGET_SPECS.find((spec) => spec.type === type);
  if (found === undefined) throw new Error(`Unknown widget type: ${type}`);
  return found;
}

export function bindingLabel(binding: Binding): string {
  switch (binding.kind) {
    case 'var':
      return binding.name;
    case 'pin':
      return `pin ${binding.pin}`;
    case 'command':
      return 'command';
    case 'none':
      return 'unbound';
  }
}

/** True when this binding names a variable the sketch no longer exposes. */
export function isBrokenBinding(binding: Binding, exposedNames: ReadonlySet<string>): boolean {
  return binding.kind === 'var' && !exposedNames.has(binding.name);
}
