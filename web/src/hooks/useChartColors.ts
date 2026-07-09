import { useEffect, useMemo, useState } from 'react';
import { currentTheme, subscribe } from '@/lib/themeBus';

/**
 * Theme-aware color palette for chart/gauge components.
 *
 * Recharts (and raw SVG props like `fill`/`stroke`, plus `style={{
 * filter: 'drop-shadow(...)' }}`) need a literal color STRING at
 * render time — they can't consume Tailwind classes, and `var(--x)`
 * is unreliable across SVG presentation attributes + filter strings
 * in older engines. So instead of hardcoding hex (the bug this hook
 * fixes — charts had ~130 hardcoded dark-theme hex values across 12
 * files that never adapted to light mode), we read the CURRENT
 * resolved value of each CSS custom property directly from
 * `document.documentElement` and hand back plain `rgb(r g b)`
 * strings that already match whatever theme + palette tuning is
 * active in index.css — so tuning the palette in one place (the CSS
 * vars) automatically flows through to every chart.
 *
 * Re-reads on every theme toggle via the themeBus subscription (the
 * same pattern as useTheme.ts). Values are re-read from the DOM
 * rather than duplicated here so this file never drifts out of sync
 * with index.css's palette.
 */

const NEON_VARS = {
  red: '--neon-red',
  orange: '--neon-orange',
  cyan: '--neon-cyan',
  magenta: '--neon-magenta',
  lime: '--neon-lime',
  amber: '--neon-amber',
  goldenrod: '--neon-goldenrod',
  periwinkle: '--neon-periwinkle',
  violet: '--neon-violet',
} as const;

export type NeonColorKey = keyof typeof NEON_VARS;

function readVar(name: string): string {
  if (typeof window === 'undefined') return '0 0 0';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '0 0 0';
}

export type ChartColors = {
  /** Neon accent colors (data series, highlights) — e.g. colors.cyan */
  [K in NeonColorKey]: string;
} & {
  /** Cartesian grid lines + axis tick lines — subtle, matches panel hairlines (--bg-700). */
  grid: string;
  /** Axis tick text + muted chart labels (--ink-300, matches the app's "muted text" convention). */
  axisText: string;
  /** Tooltip / floating-panel background (--bg-800, same surface as cards). */
  tooltipBg: string;
  /** Tooltip border (neon-cyan at low opacity, matches .panel's hairline convention). */
  tooltipBorder: string;
  /** Tooltip primary text (--ink-50). */
  tooltipText: string;
  /** Build a `drop-shadow(...)` filter string for a neon color, e.g. dropShadow('lime', 3). */
  dropShadow: (key: NeonColorKey, blurPx?: number) => string;
  /** A neon color at partial opacity, e.g. withAlpha('amber', 0.3) for a subtle tint/border. */
  withAlpha: (key: NeonColorKey, alpha: number) => string;
};

function computeColors(): ChartColors {
  const neon = Object.fromEntries(
    (Object.entries(NEON_VARS) as [NeonColorKey, string][]).map(([key, varName]) => [
      key,
      `rgb(${readVar(varName)})`,
    ]),
  ) as { [K in NeonColorKey]: string };

  const gridRgb = readVar('--bg-700');
  const axisTextRgb = readVar('--ink-300');
  const tooltipBgRgb = readVar('--bg-800');
  const tooltipTextRgb = readVar('--ink-50');
  const cyanRgb = readVar('--neon-cyan');

  return {
    ...neon,
    grid: `rgb(${gridRgb})`,
    axisText: `rgb(${axisTextRgb})`,
    tooltipBg: `rgb(${tooltipBgRgb})`,
    tooltipBorder: `rgb(${cyanRgb} / 0.3)`,
    tooltipText: `rgb(${tooltipTextRgb})`,
    dropShadow: (key: NeonColorKey, blurPx = 3) =>
      `drop-shadow(0 0 ${blurPx}px rgb(${readVar(NEON_VARS[key])}))`,
    withAlpha: (key: NeonColorKey, alpha: number) => `rgb(${readVar(NEON_VARS[key])} / ${alpha})`,
  };
}

/**
 * React hook returning theme-aware chart colors. Re-computes (and
 * triggers a re-render) on every theme change via themeBus, so charts
 * repaint correctly when the user toggles dark/light without needing
 * a page reload.
 */
export function useChartColors(): ChartColors {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  // currentTheme() isn't read directly — it's only here to make the
  // dependency on the theme explicit or eslint would flag `theme` as
  // an unused variable if we destructured it. useMemo recomputes each
  // render (cheap: a handful of getComputedStyle reads), and the
  // subscription above forces a re-render on toggle.
  return useMemo(() => computeColors(), [currentTheme()]);
}
