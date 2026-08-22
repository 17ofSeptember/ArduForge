import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { telemetry } from '@/dashboard/telemetry';
import { bindingKey } from '@/dashboard/useBoundValue';
import { useThemeTokens } from '@/styles/useThemeTokens';
import type { Widget } from '@/dashboard/model';

/**
 * uPlot paints to a 2D canvas, so it is the one consumer in the app that cannot
 * take a var() — `ctx.strokeStyle = 'var(--chart-series-1)'` silently paints
 * black. These are resolved through useThemeTokens and the plot is rebuilt when
 * they change (THEME.md Phase 4).
 */
const CHART_TOKENS = [
  '--chart-series-1',
  '--chart-series-2',
  '--chart-series-3',
  '--chart-series-4',
  '--chart-grid',
  '--chart-axis',
] as const;

/** Shared empty so an unconfigured chart keeps a stable `series` identity. */
const NO_SERIES: NonNullable<Widget['config']['series']> = [];

/**
 * Live line chart. uPlot consumes the typed arrays from the telemetry ring
 * directly, and redraws on an animation frame rather than on React state, so a
 * 20Hz stream never re-renders the component tree (§Phase 6).
 */
export function ChartWidget({ widget, running }: { widget: Widget; running: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const frameRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  // `?? []` would mint a new array on every render and retrigger the effect
  // below, tearing down and rebuilding uPlot each time. The widget object
  // itself is stable while unedited, so a shared empty keeps it that way.
  const configured = widget.config.series ?? NO_SERIES;
  const binding = widget.binding;

  const theme = useThemeTokens(CHART_TOKENS);
  const palette = useMemo(
    () => [
      theme['--chart-series-1'],
      theme['--chart-series-2'],
      theme['--chart-series-3'],
      theme['--chart-series-4'],
    ],
    [theme],
  );

  /**
   * The plot is rebuilt from these, so they have to be referentially stable.
   * Colour and label matter as much as the binding key here: they feed the
   * series options, and a chart built without them ignored an inspector
   * colour change until something unrelated forced a rebuild.
   */
  const sources = useMemo(
    () =>
      configured.length > 0
        ? configured
        : bindingKey(binding) !== null
          ? [{ binding, color: '', label: 'value' }]
          : [],
    [configured, binding],
  );

  const keys = useMemo(
    () =>
      sources
        .map((source) => bindingKey(source.binding))
        .filter((key): key is string => key !== null),
    [sources],
  );

  const windowSeconds = widget.config.windowSeconds ?? 20;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || keys.length === 0) return;

    const plot = new uPlot(
      {
        width: host.clientWidth || 400,
        height: host.clientHeight || 200,
        padding: [8, 8, 0, 0],
        legend: { show: keys.length > 1 },
        cursor: { show: false },
        scales: { x: { time: false } },
        axes: [
          {
            stroke: theme['--chart-axis'],
            grid: { stroke: theme['--chart-grid'] },
            ticks: { stroke: theme['--chart-grid'] },
          },
          {
            stroke: theme['--chart-axis'],
            grid: { stroke: theme['--chart-grid'] },
            ticks: { stroke: theme['--chart-grid'] },
          },
        ],
        series: [
          {},
          ...sources.map((source, index) => ({
            label: source.label,
            // A configured colour is the user's, kept as-is (Phase 5 carve-out);
            // an unset one falls back to the harmonized palette.
            stroke:
              source.color !== '' && source.color !== undefined
                ? source.color
                : (palette[index % palette.length] ?? theme['--chart-series-1']),
            width: 1.5,
            points: { show: false },
          })),
        ],
      },
      [new Float64Array(0), ...sources.map(() => new Float64Array(0))] as uPlot.AlignedData,
      host,
    );
    plotRef.current = plot;

    const resize = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    resize.observe(host);

    const tick = () => {
      frameRef.current = requestAnimationFrame(tick);
      if (pausedRef.current) return;

      // Every series is resampled onto the first series' timebase, because
      // uPlot requires one shared x array.
      const windows = keys.map((key) => telemetry.window(key, windowSeconds));
      const base = windows[0];
      if (base === undefined || base[0].length === 0) return;

      const xs = base[0];
      const columns: Float64Array[] = [];
      for (const [times, values] of windows) {
        if (times === base[0]) {
          columns.push(values);
          continue;
        }
        // Nearest-previous sample; series arrive at slightly different times.
        const aligned = new Float64Array(xs.length);
        let cursor = 0;
        for (let index = 0; index < xs.length; index += 1) {
          const target = xs[index] ?? 0;
          while (cursor + 1 < times.length && (times[cursor + 1] ?? 0) <= target) cursor += 1;
          aligned[index] = values[cursor] ?? 0;
        }
        columns.push(aligned);
      }

      plot.setData([xs, ...columns] as uPlot.AlignedData, true);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Rebuilt when the bound series change, and on a theme switch — uPlot bakes
    // its colours in at construction, so re-reading them means rebuilding.
  }, [keys, sources, windowSeconds, running, theme, palette]);

  const exportCsv = () => {
    const windows = keys.map((key) => telemetry.window(key, windowSeconds));
    const base = windows[0];
    if (base === undefined) return;
    const header = ['time_s', ...sources.map((source) => source.label)].join(',');
    const rows: string[] = [header];
    for (let index = 0; index < base[0].length; index += 1) {
      rows.push(
        [
          (base[0][index] ?? 0).toFixed(3),
          ...windows.map(([, values]) => String(values[index] ?? '')),
        ].join(','),
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${widget.config.label ?? 'chart'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (keys.length === 0) {
    return (
      <p className="p-3 text-xs text-content-muted">
        Bind this chart to a variable to plot it.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 pb-1">
        <button
          type="button"
          onClick={() => {
            pausedRef.current = !pausedRef.current;
          }}
          className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-content-secondary hover:bg-header"
        >
          pause
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-content-secondary hover:bg-header"
        >
          CSV
        </button>
        <span className="ml-auto text-[10px] text-content-muted">
          {windowSeconds}s window
        </span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1" />
    </div>
  );
}
