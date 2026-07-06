import { useCallback, useEffect, useRef } from 'react';

/**
 * useLongPress — fires `onLongPress` after the user holds a touch
 * or mouse press for `thresholdMs` without moving more than
 * `moveTolerancePx` (so accidental finger drift during the press
 * doesn't cancel it). Used by the mobile-polish "long-press to
 * multi-select" affordance on the Activities history list.
 *
 * Returns event handlers (onMouseDown / onTouchStart / etc.) that
 * the caller spreads on the target element. The listeners self-
 * clean on unmount or on the next pointer down so multiple
 * overlapping presses don't leak timers.
 *
 * On the touch path: relies on the browser's native
 * `touchstart → touchend → touchmove` sequence. We register
 * `touchmove` to detect the cancel threshold and `touchend` to
 * clean up. The mouse path mirrors that with mousedown /
 * mousemove / mouseup + mouseleave as a safety.
 *
 * Both paths also fire `onPressStart` immediately (so callers can
 * show a visual "you're holding this" indicator before the long
 * press fires) and `onPressEnd` on any cleanup. These are optional.
 */

const DEFAULT_THRESHOLD_MS = 500;
const DEFAULT_MOVE_TOLERANCE_PX = 10;

export function useLongPress<T extends HTMLElement>(opts: {
  onLongPress: (e: React.MouseEvent | React.TouchEvent) => void;
  onPressStart?: (e: React.MouseEvent | React.TouchEvent) => void;
  onPressEnd?: (e: React.MouseEvent | React.TouchEvent) => void;
  thresholdMs?: number;
  moveTolerancePx?: number;
}) {
  const stateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    startX: number;
    startY: number;
    fired: boolean;
  }>({ timer: null, startX: 0, startY: 0, fired: false });

  const thresholdMs = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const moveTolerancePx = opts.moveTolerancePx ?? DEFAULT_MOVE_TOLERANCE_PX;

  const clear = useCallback(() => {
    if (stateRef.current.timer !== null) {
      clearTimeout(stateRef.current.timer);
      stateRef.current.timer = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const start = useCallback(
    (clientX: number, clientY: number, e: React.MouseEvent | React.TouchEvent) => {
      clear();
      stateRef.current.startX = clientX;
      stateRef.current.startY = clientY;
      stateRef.current.fired = false;
      stateRef.current.timer = setTimeout(() => {
        stateRef.current.fired = true;
        opts.onLongPress(e);
      }, thresholdMs);
      opts.onPressStart?.(e);
    },
    [clear, opts, thresholdMs],
  );

  const move = useCallback(
    (clientX: number, clientY: number) => {
      if (stateRef.current.timer === null) return;
      const dx = clientX - stateRef.current.startX;
      const dy = clientY - stateRef.current.startY;
      if (Math.hypot(dx, dy) > moveTolerancePx) {
        // Press moved too far — cancel.
        opts.onPressEnd?.({} as React.MouseEvent);
        clear();
      }
    },
    [clear, opts, moveTolerancePx],
  );

  const end = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (stateRef.current.fired) {
        // Long press fired — don't re-fire on release. The caller
        // already got their callback.
        stateRef.current.fired = false;
        clear();
        return;
      }
      clear();
      opts.onPressEnd?.(e);
    },
    [clear, opts],
  );

  // Touch handlers — preferred on mobile.
  const onTouchStart = useCallback(
    (e: React.TouchEvent<T>) => {
      const t = e.touches[0];
      if (!t) return;
      start(t.clientX, t.clientY, e);
    },
    [start],
  );
  const onTouchMove = useCallback(
    (e: React.TouchEvent<T>) => {
      const t = e.touches[0];
      if (!t) return;
      move(t.clientX, t.clientY);
    },
    [move],
  );
  const onTouchEnd = useCallback(
    (e: React.TouchEvent<T>) => {
      end(e);
    },
    [end],
  );

  // Mouse handlers — desktop fallback (long-press to multi-select
  // also works on the web with a mouse, which is useful for testing).
  const onMouseDown = useCallback(
    (e: React.MouseEvent<T>) => {
      start(e.clientX, e.clientY, e);
    },
    [start],
  );
  const onMouseMove = useCallback(
    (e: React.MouseEvent<T>) => {
      move(e.clientX, e.clientY);
    },
    [move],
  );
  const onMouseUp = useCallback(
    (e: React.MouseEvent<T>) => {
      end(e);
    },
    [end],
  );
  const onMouseLeave = useCallback(
    (e: React.MouseEvent<T>) => {
      // Safety: if the user drags the cursor off the element
      // before the timer fires, cancel so we don't accidentally
      // trigger a long press from a stray mouseup elsewhere.
      if (stateRef.current.timer !== null) {
        opts.onPressEnd?.(e);
        clear();
      }
    },
    [clear, opts],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  };
}
