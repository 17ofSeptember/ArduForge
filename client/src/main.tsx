import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
// Side-effect import: points the tree-sitter loader at the bundled wasm assets.
// Without it the importer asks Emscripten to guess, and the guess is wrong.
import '@/import/grammarBrowser';
import { initTheme } from '@/styles/theme';
import '@/styles/tokens.css';

/**
 * Dev-only theme audit page (THEME.md Phase 6.1). There is no router in this
 * app, so it hangs off the pathname.
 *
 * The lazy() call sits inside the DEV branch rather than at module scope: at
 * module scope Rollup cannot prove the dynamic import is unreachable and emits
 * the chunk into the production build anyway. Inside a statically-false branch
 * it is eliminated, so no audit-page JS ships.
 *
 * Its Tailwind classes do still reach the production stylesheet, because
 * Tailwind scans sources without knowing what the bundler will drop: measured
 * at +1.86 kB raw / +0.24 kB gzip. Excluding the file with `@source not` would
 * remove that, but would also leave the page unstyled in dev, which defeats it.
 */
const isThemeAudit = import.meta.env.DEV && window.location.pathname === '/__theme';
const ThemeAudit = isThemeAudit
  ? lazy(() => import('@/styles/ThemeAudit').then((module) => ({ default: module.ThemeAudit })))
  : null;

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root is missing from index.html');
}

// The inline script in index.html already set data-theme before first paint;
// this reconciles it and starts tracking the OS setting, which is what lets
// canvas consumers re-read their colours when the preference is "system".
initTheme();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {ThemeAudit === null ? (
        <App />
      ) : (
        <Suspense fallback={null}>
          <ThemeAudit />
        </Suspense>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
