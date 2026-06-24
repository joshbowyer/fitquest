import { useEffect, useState } from 'react';

/**
 * Returns the current Date, refreshed on a setInterval. Defaults to
 * 60s which is enough resolution for a wall-clock / sidebar readout
 * and saves battery vs. per-second updates on a propped phone.
 *
 * Internally a monotonic counter (`tick`) drives the re-render so
 * the consumer always sees a fresh `new Date()` on render. We bump
 * the counter on:
 *   - mount (so the first render has a non-zero tick)
 *   - setInterval(intervalMs) — the regular heartbeat
 *   - visibilitychange → visible (foreground after background)
 *   - window focus / pageshow (extra safety for browser back/forward
 *     cache restores)
 *
 * The counter is a plain number so React always sees a changed
 * value and re-renders. Returning `new Date()` from the hook on
 * every render keeps the displayed time accurate to the moment of
 * render — not the moment of the last tick.
 */
export function useLiveClock(intervalMs = 60_000): Date {
  const [, setTick] = useState(0);
  // The bump function is stable across renders (useState's setter
  // is stable) so it can sit directly in the dep array of multiple
  // event listeners without re-binding them.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const bump = () => setTick((t) => t + 1);
    const start = () => {
      bump();
      id = setInterval(bump, intervalMs);
    };
    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        stop();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', bump);
    window.addEventListener('pageshow', bump);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', bump);
      window.removeEventListener('pageshow', bump);
    };
  }, [intervalMs]);
  return new Date();
}
