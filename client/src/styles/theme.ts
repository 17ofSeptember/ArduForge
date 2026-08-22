/**
 * Theme preference: storage, resolution, and the `data-theme` attribute
 * (THEME.md Phase 0.3).
 *
 * Three preference values, not two. `system` follows the OS; `light` and
 * `dark` pin it. The uploaded theme.css gated dark mode behind
 * `@media (prefers-color-scheme: dark)` alone, which left a user on a
 * light-mode OS with no way to reach dark at all — and the build plan
 * specifies dark as the default.
 *
 * The resolution rule is mirrored by an inline script in index.html that runs
 * before first paint. That duplication is deliberate: a module import cannot
 * run early enough to prevent a flash of the wrong theme, and the two must
 * agree. If you change STORAGE_KEY or the resolution order here, change the
 * inline script in index.html in the same commit.
 *
 * Phase 0 ships the mechanism only. The Settings UI that calls
 * `setThemePreference` is wired up in Phase 3.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the key used by the pre-paint script in index.html. */
export const STORAGE_KEY = 'arduforge.theme';

/** The build plan specifies dark as the default (BUILD_PLAN.md §Phase 8). */
export const DEFAULT_PREFERENCE: ThemePreference = 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Reads the stored preference. Private-mode Safari throws on localStorage
 * access rather than returning null, and a theme lookup must never be able to
 * take down the app, so failures fall back to the default.
 */
export function getThemePreference(): ThemePreference {
  try {
    const stored: unknown = window.localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * `system` deliberately leaves `data-theme` off: the media query in tokens.css
 * then decides, so a running app tracks an OS theme change with no JS at all.
 */
function applyToDocument(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
  syncThemeColor();
}

/**
 * Keeps `<meta name="theme-color">` on the resolved theme, for the address bar
 * and the OS task switcher. The inline script in index.html sets it for the
 * first paint; this keeps it right for every switch after that.
 *
 * The two literals are the only duplication of `--bg-app` outside index.html,
 * and they exist for the same reason: the meta tag is read by the browser
 * chrome, which cannot resolve a custom property.
 */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  meta.setAttribute('content', resolveTheme(getThemePreference()) === 'dark' ? '#040F16' : '#D5E2EA');
}

type Listener = (theme: ResolvedTheme) => void;
const listeners = new Set<Listener>();

function notify(): void {
  const theme = resolveTheme(getThemePreference());
  for (const listener of listeners) listener(theme);
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Preference is not persistable in this context; still apply it for the
    // rest of the session.
  }
  applyToDocument(preference);
  notify();
}

/**
 * Subscribe to the effective theme. Phase 4's `useThemeTokens` builds on this
 * so React Flow, uPlot, and CodeMirror re-read their colours on a theme change
 * instead of holding the values they were constructed with.
 */
export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-applies the stored preference and starts tracking the OS setting. The
 * attribute is already correct by the time this runs — the inline script set
 * it — so this is a reconciliation, not the initial paint.
 */
export function initTheme(): () => void {
  applyToDocument(getThemePreference());
  const media = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (getThemePreference() !== 'system') return;
    syncThemeColor();
    notify();
  };
  media.addEventListener('change', onSystemChange);
  return () => {
    media.removeEventListener('change', onSystemChange);
  };
}
