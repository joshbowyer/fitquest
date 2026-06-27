import { useCallback } from 'react';

/**
 * Tiny helper for the "tap → save → celebrate" feel on check-in
 * buttons. Three pieces:
 *
 *   - `onTap()` — call from a button's `onClick`. Fires a short
 *     vibration when supported and returns a function the caller
 *     can use to mark "I'm saving" (the button can swap to a
 *     spinner). The button itself scales on `:active` via the
 *     `dopa-tap` class so visual feedback is instant even without
 *     JS.
 *   - `onSuccess()` — call after the server confirms. Fires a
 *     success-pulse vibration and returns a timestamp the caller
 *     can store in state to drive a CSS keyframe (`dopa-success`
 *     class) on the row/container.
 *   - `onError()` — light vibration to signal failure.
 *
 * Haptics are best-effort — silently no-op on platforms that
 * don't expose `navigator.vibrate` (desktop Safari, etc.).
 */
export function useDopamineTap() {
  const vibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch { /* ignore */ }
    }
  }, []);
  const onTap = useCallback(() => {
    vibrate(8);
  }, [vibrate]);
  const onSuccess = useCallback(() => {
    vibrate([12, 30, 18]);
    return Date.now();
  }, [vibrate]);
  const onError = useCallback(() => {
    vibrate([40]);
  }, [vibrate]);
  return { onTap, onSuccess, onError };
}

/**
 * Class name fragments for the visual feedback. Apply `dopa-tap`
 * to anything you want to scale on press; apply `dopa-success`
 * to a container that should pulse once when a child successfully
 * logs. The actual keyframes live in `index.css`.
 */
export const DOPA_TAP_CLASS = 'dopa-tap';
export const DOPA_SUCCESS_CLASS = 'dopa-success';