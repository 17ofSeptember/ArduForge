/**
 * Theme switching and token resolution (THEME.md Phase 0.3 and Phase 4).
 *
 * The regression this guards against is the one THEME.md calls out as where
 * retheming jobs fail: a JS consumer holds the colours it was constructed with
 * and never re-reads them, so the canvas stays on the old theme while the CSS
 * around it switches.
 *
 * jsdom does not resolve custom properties from stylesheets, so the tests set
 * them inline on documentElement. That is enough to prove the read-and-resubscribe
 * path, which is the part that can actually break.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  DEFAULT_PREFERENCE,
  STORAGE_KEY,
  getThemePreference,
  initTheme,
  onThemeChange,
  resolveTheme,
  setThemePreference,
} from '@/styles/theme';
import { readToken, useThemeTokens, useThemeVersion } from '@/styles/useThemeTokens';

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    dispatch: () => listeners.forEach((fn) => fn()),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return mql;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  mockMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme preference', () => {
  it('defaults to dark, which is what the build plan specifies', () => {
    expect(getThemePreference()).toBe('dark');
    expect(DEFAULT_PREFERENCE).toBe('dark');
  });

  it('falls back to the default when storage holds something unrecognised', () => {
    window.localStorage.setItem(STORAGE_KEY, 'chartreuse');
    expect(getThemePreference()).toBe('dark');
  });

  it('survives storage throwing, rather than taking the app down', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(getThemePreference()).toBe('dark');
    getItem.mockRestore();
  });

  it('pins the attribute for an explicit choice and persists it', () => {
    setThemePreference('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('removes the attribute for "system" so the media query decides', () => {
    setThemePreference('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    setThemePreference('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('resolves "system" from the OS in both directions', () => {
    mockMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    mockMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
    // An explicit choice ignores the OS entirely.
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: string[] = [];
    const off = onThemeChange((theme) => seen.push(theme));

    setThemePreference('light');
    setThemePreference('dark');
    expect(seen).toEqual(['light', 'dark']);

    off();
    setThemePreference('light');
    expect(seen).toEqual(['light', 'dark']);
  });

  it('notifies on an OS change only while the preference is "system"', () => {
    const mql = mockMatchMedia(false);
    const stop = initTheme();
    const seen: string[] = [];
    const off = onThemeChange((theme) => seen.push(theme));

    // Pinned to dark: the OS flipping is not our business.
    setThemePreference('dark');
    seen.length = 0;
    mql.matches = true;
    mql.dispatch();
    expect(seen).toEqual([]);

    setThemePreference('system');
    seen.length = 0;
    mql.dispatch();
    expect(seen).toEqual(['dark']);

    off();
    stop();
  });
});

describe('token resolution', () => {
  it('reads a custom property off the root and trims it', () => {
    document.documentElement.style.setProperty('--bg-app', '  #040F16 ');
    expect(readToken('--bg-app')).toBe('#040F16');
  });

  it('returns empty string for a token that is not defined', () => {
    expect(readToken('--not-a-token')).toBe('');
  });

  it('re-reads every token when the theme changes', () => {
    document.documentElement.style.setProperty('--chart-series-1', '#00C0F7');
    document.documentElement.style.setProperty('--chart-grid', '#1C2E38');

    function Probe() {
      const tokens = useThemeTokens(['--chart-series-1', '--chart-grid'] as const);
      return (
        <span data-testid="out">{`${tokens['--chart-series-1']}|${tokens['--chart-grid']}`}</span>
      );
    }

    render(<Probe />);
    expect(screen.getByTestId('out').textContent).toBe('#00C0F7|#1C2E38');

    // A theme switch swaps what the properties resolve to.
    act(() => {
      document.documentElement.style.setProperty('--chart-series-1', '#006D8E');
      document.documentElement.style.setProperty('--chart-grid', '#D1DBE1');
      setThemePreference('light');
    });

    expect(screen.getByTestId('out').textContent).toBe('#006D8E|#D1DBE1');
  });

  it('does not resubscribe when the caller passes a fresh array each render', () => {
    // An inline array is the natural way to call this, and if it were keyed by
    // identity it would tear down and rebuild the consumer on every render.
    let renders = 0;

    function Probe() {
      renders += 1;
      useThemeTokens(['--bg-app']);
      return <span data-testid="n">{String(renders)}</span>;
    }

    const { rerender } = render(<Probe />);
    const afterMount = renders;
    rerender(<Probe />);
    rerender(<Probe />);

    // Two extra renders, and no additional render caused by the effect refiring.
    expect(renders).toBe(afterMount + 2);
  });

  it('bumps a version counter for consumers that rebuild imperatively', () => {
    function Probe() {
      return <span data-testid="v">{String(useThemeVersion())}</span>;
    }

    render(<Probe />);
    expect(screen.getByTestId('v').textContent).toBe('0');

    act(() => setThemePreference('light'));
    expect(screen.getByTestId('v').textContent).toBe('1');

    act(() => setThemePreference('dark'));
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('survives 20 theme toggles without dropping the subscription', () => {
    // Phase 6.2 requires exactly this: no stale colours after repeated toggling.
    function Probe() {
      const tokens = useThemeTokens(['--bg-app']);
      return <span data-testid="bg">{tokens['--bg-app']}</span>;
    }

    render(<Probe />);

    for (let index = 0; index < 20; index += 1) {
      const dark = index % 2 === 0;
      act(() => {
        document.documentElement.style.setProperty('--bg-app', dark ? '#040F16' : '#D5E2EA');
        setThemePreference(dark ? 'dark' : 'light');
      });
      expect(screen.getByTestId('bg').textContent).toBe(dark ? '#040F16' : '#D5E2EA');
    }
  });
});
