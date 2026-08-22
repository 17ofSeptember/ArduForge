import { describe, expect, it } from 'vitest';
import { layoutFor } from '@/ui/useBreakpoint';

describe('layout tiers', () => {
  it('gives the full IDE at 1280 and above', () => {
    const layout = layoutFor(1440);
    expect(layout.breakpoint).toBe('desktop');
    expect(layout.showCodePanel).toBe(true);
    expect(layout.showInspector).toBe(true);
    expect(layout.canEditGraph).toBe(true);
  });

  it('drops the code panel but keeps editing between 1024 and 1279', () => {
    const layout = layoutFor(1100);
    expect(layout.breakpoint).toBe('compact');
    expect(layout.showCodePanel).toBe(false);
    expect(layout.canEditGraph).toBe(true);
  });

  it('makes the canvas view-only on a tablet', () => {
    const layout = layoutFor(900);
    expect(layout.breakpoint).toBe('tablet');
    expect(layout.canEditGraph).toBe(false);
    expect(layout.dashboardOnly).toBe(false);
  });

  it('ships the dashboard alone on a phone', () => {
    // §Phase 8 is explicit: do not fake graph editing on a phone.
    const layout = layoutFor(420);
    expect(layout.breakpoint).toBe('phone');
    expect(layout.dashboardOnly).toBe(true);
    expect(layout.canEditGraph).toBe(false);
  });

  it('switches exactly on the documented boundaries', () => {
    expect(layoutFor(1280).breakpoint).toBe('desktop');
    expect(layoutFor(1279).breakpoint).toBe('compact');
    expect(layoutFor(1024).breakpoint).toBe('compact');
    expect(layoutFor(1023).breakpoint).toBe('tablet');
    expect(layoutFor(768).breakpoint).toBe('tablet');
    expect(layoutFor(767).breakpoint).toBe('phone');
  });

  it('never offers editing without an inspector to edit in', () => {
    for (const width of [320, 500, 768, 900, 1024, 1279, 1280, 1920]) {
      const layout = layoutFor(width);
      if (layout.canEditGraph) expect(layout.showInspector).toBe(true);
    }
  });
});
