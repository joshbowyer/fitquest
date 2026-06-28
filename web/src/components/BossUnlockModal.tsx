import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { classNames } from '@/lib/format';

const STORAGE_PREFIX = 'fitquest.bossUnlock.seen.v1';

function markSeen(worldId: string) {
  try { localStorage.setItem(`${STORAGE_PREFIX}.${worldId}`, '1'); } catch { /* ignore */ }
}
function hasSeen(worldId: string): boolean {
  try { return localStorage.getItem(`${STORAGE_PREFIX}.${worldId}`) === '1'; } catch { return false; }
}

type Props = {
  worldId: string;
  bossName: string;
  bossGlyph: string;
  lore: string;
  /** Color of the world (red/orange/lime/cyan/etc) — drives the glow. */
  color: string;
  /** Path (under /sprites) to a 256×256 transparent boss portrait. */
  portraitSrc: string;
  /** When false, the modal hides itself. */
  open: boolean;
  onClose: () => void;
};

/**
 * "System detected: BOSS UNLOCKED" modal. Shows the first time the
 * user clears all 5 levels in a world. State is tracked in
 * localStorage keyed by worldId so re-visits don't re-trigger.
 *
 * Animation:
 *   0.0s — scanline sweeps top→bottom (matrix boot)
 *   0.4s — glyph scales in with overshoot + blur-decay
 *   0.6s — "BOSS UNLOCKED" text flickers like a CRT powering up
 *   1.1s — boss name rises
 *   1.4s — lore rises
 *   1.7s — "BEGIN THE FIGHT" CTA rises
 *
 * Background uses the world's accent color for the bloom so each
 * world feels distinct (red for Spire, orange for The Gap, etc).
 */
export function BossUnlockModal({ worldId, bossName, bossGlyph, lore, color, portraitSrc, open, onClose }: Props) {
  // Hide on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-900/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* Scanline sweep — single-pass top→bottom */}
      <div
        className="absolute inset-x-0 top-0 h-24 pointer-events-none unlock-scan"
        style={{ background: `linear-gradient(to bottom, transparent, ${color}55, transparent)` }}
      />

      <div
        className="relative w-full max-w-md panel p-6 text-center"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: `${color}88`, boxShadow: `0 0 40px ${color}33` }}
      >
        {/* Boss portrait — fades in ahead of the glyph, behind the text */}
        {portraitSrc && (
          <div
            className="unlock-rise unlock-rise-0 mx-auto mb-3"
            style={{
              width: 192,
              height: 192,
              filter: `drop-shadow(0 0 16px ${color}88)`,
            }}
          >
            <img
              src={portraitSrc}
              alt={bossName}
              width={192}
              height={192}
              className="block mx-auto unlock-bloom"
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
          </div>
        )}

        {/* Big glyph */}
        <div
          className="unlock-glyph unlock-bloom text-8xl leading-none"
          style={{ color }}
        >
          {bossGlyph}
        </div>

        {/* "BOSS UNLOCKED" label */}
        <div
          className="unlock-flicker mt-4 font-display tracking-[0.3em] text-xs uppercase"
          style={{ color }}
        >
          ⚠ Boss Unlocked
        </div>

        {/* Name */}
        <h2
          className="unlock-rise unlock-rise-1 mt-2 font-display tracking-widest text-2xl text-ink-50"
        >
          {bossName}
        </h2>

        {/* Lore */}
        <p
          className="unlock-rise unlock-rise-2 mt-3 text-sm text-ink-300 italic font-serif leading-relaxed"
        >
          "{lore}"
        </p>

        {/* CTA */}
        <div className="unlock-rise unlock-rise-3 mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => { markSeen(worldId); onClose(); }}
            className={classNames(
              'px-6 py-2.5 font-display tracking-widest uppercase text-sm border-2 transition-all',
              'hover:scale-105 active:scale-95',
            )}
            style={{
              borderColor: color,
              color,
              boxShadow: `0 0 12px ${color}55`,
            }}
          >
            ⚔ Begin the fight
          </button>
          <button
            type="button"
            onClick={() => { markSeen(worldId); onClose(); }}
            className="text-[10px] font-mono text-ink-500 hover:text-ink-300 mt-1"
          >
            dismiss
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hook: returns whether the unlock modal should show right now.
 * Returns true exactly once per (user, worldId). The caller is
 * responsible for rendering the modal and calling onClose() which
 * we hook to mark the world as "seen" in localStorage.
 */
export function useBossUnlock(worldId: string, allCleared: boolean): { shouldShow: boolean; ack: () => void } {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (allCleared && !hasSeen(worldId)) {
      setShouldShow(true);
    }
  }, [worldId, allCleared]);

  const ack = () => {
    markSeen(worldId);
    setShouldShow(false);
  };

  return { shouldShow, ack };
}
