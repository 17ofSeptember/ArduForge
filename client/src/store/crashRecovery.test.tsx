/**
 * AUDIT Pass 1 item 4 — "never white-screen".
 *
 * The requirement is not that a bad project file throws somewhere; it is that
 * the editor stays on screen. Two things have to hold: the malformed document
 * must not reach a render, and if anything else ever does throw during render,
 * the whole tree must not go blank. This tests the second half, because
 * without a boundary React 18 unmounts the entire root on an uncaught render
 * error and the user is left with a literally empty <body>.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

function Boom(): never {
  throw new Error('render exploded');
}

describe('render crash containment', () => {
  afterEach(cleanup);

  it('keeps the app on screen when a child throws during render', () => {
    // React logs the caught error; silence it so the run stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(container.innerHTML).not.toBe('');
      expect(screen.getByRole('alert')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('shows the underlying message so the failure is diagnosable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert').textContent).toContain('render exploded');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
