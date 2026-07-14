/**
 * For a day-bucketed chart series where missing days are represented
 * by `null` in `valueKey`, computes the "bridge" point-pairs that
 * connect the last known value before a gap directly to the first
 * known value after it.
 *
 * Recharts' `connectNulls` is all-or-nothing for a given `<Line>`:
 * `false` breaks the line at every gap (the default we use, so a
 * single missing day doesn't silently interpolate real trend data),
 * `true` would connect straight through EVERY gap indistinguishably
 * from real consecutive days. Neither alone gives "connect across
 * the gap, but make it visually obvious it's a gap".
 *
 * The fix: keep the main `<Line connectNulls={false}>` for the real
 * data, and render one extra small `<Line data={[a, b]} dataKey={...}
 * strokeDasharray="...">` per gap using the two bridge points
 * returned here (recharts lets a `<Line>` use its own `data` prop
 * independent of the parent chart's `data`). That draws a dashed
 * connector spanning exactly the missing day(s), and only the
 * missing day(s) — real, back-to-back days are left untouched.
 *
 * Only returns a bridge when BOTH a prior and a following non-null
 * point exist. A gap at the very start/end of the window (e.g.
 * "today" hasn't been logged yet) is intentionally left alone —
 * there's nothing on the other side to bridge to.
 */
export function computeGapBridges<T extends Record<string, unknown>>(
  series: T[],
  valueKey: keyof T,
): Array<[T, T]> {
  const bridges: Array<[T, T]> = [];
  let lastNonNull: T | null = null;
  let sawGapSinceLast = false;

  for (const point of series) {
    const v = point[valueKey];
    if (v == null) {
      if (lastNonNull) sawGapSinceLast = true;
      continue;
    }
    if (lastNonNull && sawGapSinceLast) {
      bridges.push([lastNonNull, point]);
    }
    lastNonNull = point;
    sawGapSinceLast = false;
  }

  return bridges;
}
