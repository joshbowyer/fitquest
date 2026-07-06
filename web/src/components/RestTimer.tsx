import { useState, useEffect, useRef } from 'react';
import { playSoundAndNotify } from '@/lib/soundBus';
import { useDopamineTap } from '@/hooks/useDopamineTap';

type Props = {
  onTick?: (secondsRemaining: number) => void;
  onComplete?: () => void;
};

/**
 * Rest timer with preset durations. Counts down from the selected
 * preset, plays a beep when it hits 0, and can be paused/reset.
 *
 * Presets can be set externally via the `set-rest` window event:
 *   window.dispatchEvent(new CustomEvent('set-rest', { detail: 60 }));
 * This lets the page's preset buttons drive the timer without
 * having to thread a ref down through the DOM.
 */
export function RestTimer({ onTick, onComplete }: Props) {
  const [seconds, setSeconds] = useState(90);
  const [running, setRunning] = useState(false);
  const [initial, setInitial] = useState(90);
  const intervalRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Haptic feedback on the rest-timer-end signal. Uses the same
  // shared `useDopamineTap` helper as the check-in save button —
  // `navigator.vibrate` is best-effort and no-ops on desktop
  // Safari / iOS Safari (which doesn't expose it). Distinctive
  // 3-pulse pattern ("success") rather than a single tap so the
  // user feels the timer ended even with the phone in a pocket.
  const { onSuccess: hapticOnSuccess } = useDopamineTap();

  // Listen for external preset events
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<number>;
      if (typeof ce.detail === 'number' && ce.detail > 0) {
        setRunning(false);
        setSeconds(ce.detail);
        setInitial(ce.detail);
      }
    }
    window.addEventListener('set-rest', handler);
    return () => window.removeEventListener('set-rest', handler);
  }, []);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = window.setInterval(() => {
setSeconds((s) => {
            const next = s - 1;
            if (next <= 0) {
              setRunning(false);
              // Audio cue when the timer hits zero — same shared
              // bus as the rest of the app's SFX. Honors the
              // user's mute toggle from Settings → Sound.
              playSoundAndNotify('restTimerDone');
              // Haptic — short 3-pulse pattern, only fires on
              // platforms that expose `navigator.vibrate`
              // (Android Chrome, iOS Chrome via Capacitor, etc.).
              // Best-effort: silently no-op on desktop.
              hapticOnSuccess();
              onCompleteRef.current?.();
              return 0;
            }
            onTick?.(next);
            return next;
          });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running]);

  function start() {
    if (seconds === 0) setSeconds(initial);
    setRunning(true);
  }
  function reset(s = initial) {
    setRunning(false);
    setSeconds(s);
    setInitial(s);
  }

  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  const pct = initial > 0 ? 1 - seconds / initial : 0;

  return (
    <div
      className="flex items-center gap-2 p-2 border border-neon-cyan/30 bg-bg-900/40"
      role="group"
      aria-label="Rest timer"
    >
      <div
        className="font-display tracking-widest text-base min-w-[60px] text-center"
        style={{
          color: running ? '#9bff5c' : seconds === 0 ? '#ffc34d' : '#14d6e8',
          textShadow: running ? '0 0 6px #56e88e' : 'none',
        }}
        aria-live="polite"
      >
        {mm}:{ss}
      </div>

      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-bg-700 border border-ink-500/30">
        <div
          className="h-full transition-all"
          style={{
            width: `${pct * 100}%`,
            background: running ? '#9bff5c' : '#14d6e8',
            boxShadow: running ? '0 0 4px #56e88e' : 'none',
          }}
        />
      </div>

      {!running ? (
        <button
          type="button"
          onClick={start}
          className="px-2 h-8 text-xs font-mono border border-neon-lime/60 text-neon-lime bg-neon-lime/5 hover:bg-neon-lime/10"
          aria-label="Start timer"
        >
          ▶
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setRunning(false)}
          className="px-2 h-8 text-xs font-mono border border-neon-amber/60 text-neon-amber bg-neon-amber/5 hover:bg-neon-amber/10"
          aria-label="Pause timer"
        >
          ❚❚
        </button>
      )}
      <button
        type="button"
        onClick={() => reset()}
        className="px-2 h-8 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
        aria-label="Reset timer"
      >
        ⟲
      </button>
    </div>
  );
}

function beep() {
  // Replaced by playSoundAndNotify('restTimerDone') from the shared
  // soundBus — see the timer body above. Kept as a no-op export
  // for any future direct callers (e.g. dev tools).
  try { playSoundAndNotify('restTimerDone'); } catch { /* silent */ }
}

// Preset durations in seconds. Used by the dashboard tab to let the
// user pick a default rest time.
export const REST_PRESETS = [
  { label: '30s', seconds: 30 },
  { label: '60s', seconds: 60 },
  { label: '90s', seconds: 90 },
  { label: '2m',  seconds: 120 },
  { label: '3m',  seconds: 180 },
  { label: '5m',  seconds: 300 },
];