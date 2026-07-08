import { useEffect, useState } from 'react';
import { currentTheme, subscribe, type Theme } from '@/lib/themeBus';

/**
 * React hook bridging the themeBus pub-sub to a component re-render.
 * Returns the current Theme so the Settings page can highlight the
 * active option; subscribers re-render on every theme change.
 *
 * Kept tiny (no context) so any component can call it without
 * wiring a provider — the bus is the single source of truth.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  useEffect(() => {
    return subscribe(() => setTheme(currentTheme()));
  }, []);
  return theme;
}