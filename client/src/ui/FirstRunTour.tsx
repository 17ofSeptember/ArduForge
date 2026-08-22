import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

/**
 * First-run tour (BUILD_PLAN.md §Phase 8): five steps, skippable, never shown
 * again once dismissed.
 */
const SEEN_KEY = 'arduforge.tour.seen';

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'Welcome to ArduForge',
    body: 'Build Arduino programs by wiring nodes together. It generates real C++ you can read, compile, and paste into the official Arduino IDE unchanged.',
  },
  {
    title: 'Two kinds of wire',
    body: 'White square ports carry execution — when things happen, in order. Coloured round ports carry values, and only connect where the types match. If a connection is refused, the toast tells you why.',
  },
  {
    title: 'Press ⌘K to add anything',
    body: 'The command palette searches every node. You can also drag from any port onto empty canvas, and it will offer only nodes that actually fit that connection.',
  },
  {
    title: 'Watch the code as you build',
    body: 'The panel on the right updates as you edit. Select a node and its generated lines highlight, so you can always see what a change actually produced.',
  },
  {
    title: 'Then put a dashboard on it',
    body: 'Tick "Expose to Dashboard" on a variable and it becomes live: sliders write to it, gauges and charts read it back off the running board. Or use Quick Pins to poke hardware with no program at all.',
  },
];

export function FirstRunTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === null) setStep(0);
    } catch {
      // Storage unavailable: just skip the tour rather than blocking startup.
    }
  }, []);

  const dismiss = () => {
    setStep(null);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // ignore
    }
  };

  if (step === null) return null;
  const current = STEPS[step];
  if (current === undefined) return null;
  const last = step === STEPS.length - 1;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-scrim" onClick={dismiss} role="presentation" />
      <div className="fixed bottom-8 left-1/2 z-50 w-[min(30rem,92vw)] -translate-x-1/2 rounded-xl border border-edge bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold">{current.title}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip tour"
            className="rounded p-1 text-content-muted hover:bg-card"
          >
            <X size={14} />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-content-secondary">
          {current.body}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex gap-1.5">
            {STEPS.map((item, index) => (
              <span
                key={item.title}
                className="size-1.5 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    index === step ? 'var(--bg-interactive)' : 'var(--bg-header)',
                }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="ml-auto text-[11px] text-content-muted hover:text-content"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => (last ? dismiss() : setStep(step + 1))}
            className="flex items-center gap-1 rounded bg-interactive px-2.5 py-1 text-[11px] font-medium text-on-interactive"
          >
            {last ? 'Start building' : 'Next'}
            {!last && <ArrowRight size={11} />}
          </button>
        </div>
      </div>
    </>
  );
}
