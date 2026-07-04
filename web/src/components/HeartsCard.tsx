import { classNames } from '@/lib/format';
import { useAuth } from '@/lib/auth';

// Max hearts. Mirrors MAX_HEARTS in api/src/lib/mode.ts. The api
// defaults new users to this number; we cap the local display at
// the same value so a "10 of 10" reading is possible. If the api
// ever bumps the cap, we'd update this constant.
const MAX_HEARTS = 10;

/**
 * Hearts indicator. Always rendered (in both Casual and Hardcore
 * mode) so the top-hero row stays a consistent 4-column layout.
 * Contents differ by mode:
 *
 *   - Casual: full hearts (no penalty, no regen) + a "switch to
 *     Hardcore" hint so the user knows the toggle exists. Tone is
 *     lime/cyan to signal "no risk."
 *   - Hardcore: the existing 0-10 heart visualization with
 *     magenta/amber/cyan tone ladder, status message, and regen
 *     explainer.
 *
 * Tone ladder (Hardcore only):
 *   0 hearts  → magenta + pulse  (0.0x multiplier)
 *   1-4 hearts → amber              (≤ 0.7x multiplier)
 *   5+ hearts  → cyan               (≥ 0.8x multiplier, full at 10)
 */
export function HeartsCard() {
  const { user } = useAuth();
  if (!user) return null;

  const isHardcore = user.mode === 'HARDCORE';
  const hearts = Math.max(0, Math.min(MAX_HEARTS, user.hearts ?? MAX_HEARTS));
  const mult = user.heartMultiplier ?? 1;

  if (!isHardcore) {
    // Casual mode: simplified display. No penalty, no regen — the
    // block exists so the row stays balanced and so a user who
    // doesn't know about the Hardcore toggle can discover it.
    return (
      <div className="panel relative p-4 border border-rose-500/30 bg-rose-500/5">
        <header className="flex items-center justify-between mb-2">
          <span className="font-display tracking-widest text-[10px] uppercase text-rose-300">
            ◆ Casual · Hearts
          </span>
          <span className="text-[10px] font-mono tabular-nums text-rose-300">
            ×{mult.toFixed(2)}
          </span>
        </header>

        {/* Filled row — casual hearts never deplete, so render all
            MAX_HEARTS filled in red. Same unicode chars as
            Hardcore so the row visually parallels the other column. */}
        <div className="flex items-center gap-1 text-2xl mb-2 select-none">
          {Array.from({ length: MAX_HEARTS }, (_, i) => (
            <span
              key={i}
              className="text-rose-400"
              style={{ textShadow: '0 0 4px #fb7185' }}
              aria-label="heart filled"
            >
              ♥
            </span>
          ))}
        </div>

        <div className="text-[10px] font-mono text-ink-400">
          Casual mode — no heart penalty, full rewards. Hearts shown for
          parity with the other columns.
          <div className="mt-0.5 text-ink-500">
            Want the penalty loop? Switch to Hardcore in Settings →
            Difficulty. (6 reasons — missed workout, all-dailies miss,
            caffeine/alcohol/nicotine overuse, zero spiritual.)
          </div>
        </div>
      </div>
    );
  }

  // Hardcore mode: existing 0-10 heart visualization. Hearts are
  // always red regardless of count — the count is conveyed by
  // the gap between filled and empty slots, not by the color.
  // The message below carries the urgency.
  const message =
    hearts === 0 ? '⚠ Zero hearts — ×0.00, no rewards. Regen Sunday.' :
    hearts <= 2 ? 'Hearts low — penalty is heavy. Try to log a workout before Sunday.' :
    hearts <= 4 ? 'Hearts dropping — penalty escalating. One missed day and you drop another.' :
    'Full hearts. No penalty.';

  return (
    <div className="panel relative p-4 border border-rose-500/30 bg-rose-500/5">
      <header className="flex items-center justify-between mb-2">
        <span className="font-display tracking-widest text-[10px] uppercase text-rose-300">
          ◆ Hardcore · Hearts
        </span>
        <span className="text-[10px] font-mono tabular-nums text-rose-300">
          ×{mult.toFixed(2)}
        </span>
      </header>

      {/* Hearts in a row. Filled = current count (red), empty =
          depleted (dark gray, not merely faded). At ≤3 hearts the
          whole row gets the heart-warn pulse so even a glance
          catches the "you're low" state. */}
      <div className={classNames(
        'flex items-center gap-1 text-2xl mb-2 select-none',
        hearts <= 3 && 'animate-heart-warn',
      )}>
        {Array.from({ length: MAX_HEARTS }, (_, i) => {
          const filled = i < hearts;
          return (
            <span
              key={i}
              className={filled
                ? 'text-rose-400'
                : 'text-ink-600'
              }
              style={filled
                ? { textShadow: '0 0 4px #fb7185' }
                : undefined
              }
              aria-label={filled ? 'heart filled' : 'heart empty'}
            >
              ♥
            </span>
          );
        })}
      </div>

      <div className="text-[10px] font-mono text-rose-300">
        {message}
        <div className="mt-0.5 text-ink-500">
          Regen: 1 heart per Sunday (week-anchored). Loss: missed workout,
          all-dailies miss, caffeine/alcohol/nicotine overuse, zero spiritual.
        </div>
      </div>
    </div>
  );
}