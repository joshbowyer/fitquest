import { useMemo } from 'react';

/**
 * PullToRefreshIndicator — replaces the old text-based
 * "Release to refresh (NNpx)" / "Refreshing…" hint with a
 * rotating circular-arrow icon. Same input contract as the
 * text version: just plug in `pulledPx`, `refreshing`, and
 * `thresholdPx` from `usePullToRefresh` and drop it in.
 *
 * Behavior:
 *   • pulledPx <= 0: nothing rendered.
 *   • 0 < pulledPx < thresholdPx && !refreshing: icon fades
 *     in (opacity = pulledPx / thresholdPx) and rotates from
 *     0 → 180° as the user pulls — visual "how close am I"
 *     feedback.
 *   • pulledPx >= thresholdPx && !refreshing: icon at 100%
 *     opacity, rotated to 360° as the "release!" cue.
 *   • refreshing: icon at full opacity, full continuous
 *     `animate-spin` rotation.
 *
 * The icon is positioned fixed just below the .app-topbar
 * (the sticky 60px header), centered horizontally, and uses
 * `pointer-events-none` so it never blocks taps on the page
 * underneath. Sits above page content via z-40.
 */
// Matches the default in usePullToRefresh so callers that only destructure
// { pulledPx, refreshing } from the hook can still use this component.
const DEFAULT_THRESHOLD_PX = 80;

export function PullToRefreshIndicator({
  pulledPx,
  refreshing,
  thresholdPx = DEFAULT_THRESHOLD_PX,
}: {
  pulledPx: number;
  refreshing: boolean;
  /** Pull distance at which a release triggers the refresh. Defaults to
   *  the usePullToRefresh default (80px). Only override if your page
   *  customizes the hook's `thresholdPx` option. */
  thresholdPx?: number;
}) {
  // Visible at all once the user has actually started pulling
  // (past the tiny 4px dead-zone the text version used to avoid
  // flicker), or once a refresh is in flight.
  const visible = refreshing || pulledPx > 4;

  // Opacity ramps linearly from 0 → 1 as the user pulls toward
  // the threshold; pinned at 1 past threshold and during refresh.
  const opacity = useMemo(() => {
    if (!visible) return 0;
    if (refreshing) return 1;
    return Math.min(pulledPx / thresholdPx, 1);
  }, [visible, refreshing, pulledPx, thresholdPx]);

  // Rotation: 0° → 180° while pulling below threshold, snap to
  // 360° past threshold (the "release!" cue), and let
  // animate-spin take over during refresh.
  const rotation = useMemo(() => {
    if (refreshing) return 0;
    if (pulledPx >= thresholdPx) return 360;
    return Math.min(pulledPx / thresholdPx, 1) * 180;
  }, [refreshing, pulledPx, thresholdPx]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        // Sit just below the sticky .app-topbar (60px tall
        // inner flex row) and respect the device safe-area
        // notch so we don't crowd the status bar on phones.
        top: 'calc(60px + env(safe-area-inset-top, 0px))',
        opacity,
      }}
      className="fixed left-1/2 -translate-x-1/2 z-40 pointer-events-none
                 text-neon-cyan drop-shadow-[0_0_6px_rgba(34,211,238,0.55)]
                 transition-opacity duration-150"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: refreshing ? 'none' : 'transform 100ms linear',
        }}
        className={refreshing ? 'animate-spin' : undefined}
      >
        {/* Partial-circle arc + arrowhead — the standard
            "refresh" glyph. Drawn as a single path for the arc
            plus a polyline for the arrowhead so we don't depend
            on any icon library. */}
        <path d="M21 12a9 9 0 1 1-3.51-7.12" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
    </div>
  );
}