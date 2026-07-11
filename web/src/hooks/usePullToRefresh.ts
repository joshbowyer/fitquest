import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * usePullToRefresh — light-touch pull-to-refresh gesture
 * detector for the Dashboard. Doesn't use a library or a Capacitor
 * plugin — just listens to native touch events on the passed ref
 * and fires `onRefresh` when the user pulls past a threshold
 * while scrolled to the top of the page.
 *
 * The pull direction is configurable (default: down). The hook
 * tracks touchstart Y + scrollTop, then on touchmove computes
 * the overscroll delta. When the user lets go past the threshold,
 * it calls onRefresh. Below the threshold, it resets.
 *
 * Visual feedback is left to the caller — typically the
 * <PullToRefreshIndicator> component, which renders a rotating
 * refresh icon that fades in / rotates as the user pulls and
 * spins continuously while `onRefresh` is in flight.
 * This hook just fires the callback.
 */

const DEFAULT_THRESHOLD_PX = 80;
const DEFAULT_MAX_PULL_PX = 200;
// Default gesture-start zone: the sticky app top-bar (branding +
// hamburger) and the per-page title header (PageHeader — see
// data-page-header in Layout.tsx). Restricting the trigger to
// where a touch STARTS (not the whole scrollable body) is what
// keeps ordinary scrolling of page content from accidentally
// registering as a pull — previously any touch anywhere on the
// page, as long as it was already scrolled to the top, would start
// tracking, so a single stray vertical swipe on any card/list item
// near the top of a page fired the gesture.
const DEFAULT_TRIGGER_ZONE_SELECTOR = '.app-topbar, [data-page-header]';

export function usePullToRefresh<T extends HTMLElement>(opts: {
  onRefresh: () => void | Promise<void>;
  /** Pass either a ref to the scrollable element OR a CSS selector
   * (e.g. "main") — the hook resolves the element from `document`
   * after first render. The ref path is preferred when the
   * caller already has the ref; the selector path is convenient
   * when the scrollable lives inside a shared wrapper (Layout). */
  scrollRef?: React.RefObject<T | null>;
  scrollSelector?: string;
  thresholdPx?: number;
  /** Cap on the visual pull distance. Default: 200px. */
  maxPullPx?: number;
  /** Direction the user pulls. Default: 'down'. */
  direction?: 'down' | 'up';
  /** CSS selector for the region a touch must START inside to be
   * considered a pull-to-refresh gesture at all. Default: the app
   * top-bar + PageHeader (see DEFAULT_TRIGGER_ZONE_SELECTOR). Pass
   * `null` to disable this gating entirely (old any-touch-at-top
   * behavior) if a specific page genuinely needs that. */
  triggerZoneSelector?: string | null;
}) {
  const thresholdPx = opts.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  const maxPullPx = opts.maxPullPx ?? DEFAULT_MAX_PULL_PX;
  const direction = opts.direction ?? 'down';
  const triggerZoneSelector = opts.triggerZoneSelector === undefined
    ? DEFAULT_TRIGGER_ZONE_SELECTOR
    : opts.triggerZoneSelector;

  const stateRef = useRef<{
    startY: number;
    tracking: boolean;
    pulledPx: number;
  }>({ startY: 0, tracking: false, pulledPx: 0 });
  // Pull distance is exposed as state for the caller's visual
  // indicator. The hook itself only mutates the ref + calls
  // onRefresh on release; the state is the "I'm pulling"
  // progress for any UI.
  const [pulledPx, setPulledPx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const updatePulled = useCallback((px: number) => {
    setPulledPx(px);
  }, []);

  useEffect(() => {
    // Resolve the element: ref first, then selector, then bail.
    const el = (opts.scrollRef?.current
      ?? (opts.scrollSelector ? document.querySelector(opts.scrollSelector) : null)
    ) as T | HTMLElement | null;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // Gate: the touch must have STARTED inside the trigger zone
      // (top-bar / page-title area), not just anywhere on the page.
      // This is checked on the actual DOM touch target, so it
      // correctly ignores touches that start on ordinary content
      // (cards, lists, buttons) even when the page is scrolled to
      // the very top.
      if (triggerZoneSelector) {
        const target = e.target as HTMLElement | null;
        if (!target || !target.closest(triggerZoneSelector)) return;
      }
      const scrollTop = el.scrollTop;
      const isAtTop = direction === 'down' ? scrollTop <= 0 : (el.scrollHeight - el.clientHeight - scrollTop) <= 0;
      if (!isAtTop) return;
      stateRef.current.startY = touch.clientY;
      stateRef.current.tracking = true;
      stateRef.current.pulledPx = 0;
      updatePulled(0);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!stateRef.current.tracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const delta = touch.clientY - stateRef.current.startY;
      // Negative delta = user is scrolling UP (opposite of pull
      // direction). Cancel in that case.
      const correctSign = direction === 'down' ? 1 : -1;
      if (delta * correctSign < 0) {
        stateRef.current.tracking = false;
        updatePulled(0);
        return;
      }
      // Cap the visual pull at maxPullPx — the page should
      // resist being stretched further even if the user keeps
      // dragging. A future gesture library can add rubber-banding.
      const px = Math.min(Math.abs(delta), maxPullPx);
      stateRef.current.pulledPx = px;
      updatePulled(px);
    };

    const onTouchEnd = () => {
      if (!stateRef.current.tracking) return;
      const fired = stateRef.current.pulledPx >= thresholdPx;
      stateRef.current.tracking = false;
      const px = stateRef.current.pulledPx;
      stateRef.current.pulledPx = 0;
      updatePulled(0);
      if (fired && !refreshing) {
        setRefreshing(true);
        Promise.resolve(opts.onRefresh()).finally(() => setRefreshing(false));
      } else if (px > 0) {
        // Under-threshold release — just reset, no refresh.
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [opts, opts.scrollRef, thresholdPx, maxPullPx, direction, triggerZoneSelector, updatePulled, refreshing]);

  return { pulledPx, refreshing, thresholdPx };
}
