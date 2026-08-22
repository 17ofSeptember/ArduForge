/**
 * Last line of defence for a render-time throw.
 *
 * React 18 unmounts the entire root when a render error reaches the top, which
 * leaves the user staring at an empty page with no way back and no idea what
 * happened. A boundary turns that into a readable panel that still offers a
 * way out. It is not a substitute for validating input — it is what catches
 * the case nobody predicted.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** Shown instead of the default panel, if the caller wants its own copy. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The operator needs the component stack; the panel only shows the message.
    console.error('[arduforge] render error:', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <h2 className="text-sm font-semibold text-error">
          Something in this view stopped working
        </h2>
        <p className="max-w-md font-mono text-xs text-content-muted">
          {error.message}
        </p>
        <p className="max-w-md text-xs text-content-muted">
          Your project is still saved. Try switching tabs, or reload the page.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded border border-edge-subtle px-3 py-1 text-xs hover:bg-card"
        >
          Try again
        </button>
      </div>
    );
  }
}
