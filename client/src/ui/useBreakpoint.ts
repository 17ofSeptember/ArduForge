import { useEffect, useState } from 'react';

/**
 * Layout tiers (BUILD_PLAN.md §Phase 8).
 *
 * The plan is blunt about this and it is worth restating: node-graph editing on
 * a phone is a bad experience however much effort goes into it. So the small
 * tiers do not shrink the editor — they remove it, and ship the dashboard as
 * the mobile product.
 */
export type Breakpoint = 'desktop' | 'compact' | 'tablet' | 'phone';

export interface Layout {
  readonly breakpoint: Breakpoint;
  /** Full IDE: canvas + code panel + inspector side by side. */
  readonly showCodePanel: boolean;
  readonly showInspector: boolean;
  /** Below this the canvas is view-only: pan and zoom, no editing. */
  readonly canEditGraph: boolean;
  /** Phone: Run Mode dashboard only, as a remote control. */
  readonly dashboardOnly: boolean;
}

function layoutFor(width: number): Layout {
  if (width >= 1280) {
    return {
      breakpoint: 'desktop',
      showCodePanel: true,
      showInspector: true,
      canEditGraph: true,
      dashboardOnly: false,
    };
  }
  if (width >= 1024) {
    return {
      breakpoint: 'compact',
      showCodePanel: false,
      showInspector: true,
      canEditGraph: true,
      dashboardOnly: false,
    };
  }
  if (width >= 768) {
    return {
      breakpoint: 'tablet',
      showCodePanel: false,
      showInspector: false,
      canEditGraph: false,
      dashboardOnly: false,
    };
  }
  return {
    breakpoint: 'phone',
    showCodePanel: false,
    showInspector: false,
    canEditGraph: false,
    dashboardOnly: true,
  };
}

export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() =>
    layoutFor(typeof window === 'undefined' ? 1440 : window.innerWidth),
  );

  useEffect(() => {
    let frame: number | null = null;
    const onResize = () => {
      // Coalesced onto an animation frame: a drag-resize fires continuously and
      // re-rendering the whole app on every pixel is exactly the stutter
      // §Phase 8 is trying to avoid.
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setLayout((current) => {
          const next = layoutFor(window.innerWidth);
          return next.breakpoint === current.breakpoint ? current : next;
        });
      });
    };

    window.addEventListener('resize', onResize);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return layout;
}

export { layoutFor };
