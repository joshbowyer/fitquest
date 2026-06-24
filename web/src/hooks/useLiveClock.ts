import { useEffect, useState } from 'react';

/**
 * Returns the current Date, refreshed on a setInterval. Defaults to
 * 60s which is enough resolution for a wall-clock / sidebar readout
 * and saves battery vs. per-second updates on a propped phone.
 *
 * The interval is created on mount, cleared on unmount, and re-set
 * on tab visibility change so a backgrounded tab picks up the
 * correct time the moment it comes back (rather than waiting up
 * to `intervalMs` for the next tick).
 */
export function useLiveClock(intervalMs = 60_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setNow(new Date());
      id = setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        stop();
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
  return now;
}
