import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * Tiny error boundary. Catches render errors in its subtree and
 * shows them inline instead of letting React unmount the whole
 * tree (which produces a blank page). Used to wrap sections that
 * pull in CDN-loaded libs (Leaflet) where a network failure could
 * otherwise blank the screen.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="border border-neon-red/40 bg-neon-red/5 p-3 text-[11px] font-mono text-neon-red">
          <div className="font-display tracking-widest text-xs uppercase mb-1">Render error</div>
          <div className="text-ink-300">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}