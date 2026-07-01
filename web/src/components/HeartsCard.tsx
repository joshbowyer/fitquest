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
      <div className="panel relative p-4 border border-neon-lime/30 bg-neon-lime/5">
        <header className="flex items-center justify-between mb-2">
          <span className="font-display tracking-widest text-[10px] uppercase text-neon-lime">
            ◆ Casual · Hearts
          </span>
          <span className="text-[10px] font-mono tabular-nums text-neon-lime/80">
            ×{mult.toFixed(2)}
          </span>
        </header>

        {/* Filled row — casual hearts never deplete, so render all
            MAX_HEARTS filled in the lime tone. Same unicode chars as
            Hardcore so the row visually parallels the other column. */}
        <div className="flex items-center gap-1 text-2xl mb-2 select-none">
          {Array.from({ length: MAX_HEARTS }, (_, i) => (
            <span
              key={i}
              style={{ color: '#9bff5c', textShadow: '0 0 4px currentColor' }}
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

  // Hardcore mode: existing 0-10 heart visualization.
  const tone =
    hearts === 0 ? 'magenta' :
    hearts <= 4 ? 'amber' :
    'cyan';

  const message =
    hearts === 0 ? '⚠ Zero hearts — ×0.00, no rewards. Regen Sunday.' :
    hearts <= 2 ? 'Hearts low — penalty is heavy. Try to log a workout before Sunday.' :
    hearts <= 4 ? 'Hearts dropping — penalty escalating. One missed day and you drop another.' :
    'Full hearts. No penalty.';

  return (
    <div className={classNames(
      'panel relative p-4 border',
      tone === 'magenta' && 'border-neon-magenta/50 bg-neon-magenta/10',
      tone === 'amber' && 'border-neon-amber/40 bg-neon-amber/5',
      tone === 'cyan' && 'border-neon-cyan/30 bg-neon-cyan/5',
    )}>
      <header className="flex items-center justify-between mb-2">
        <span className={classNames(
          'font-display tracking-widest text-[10px] uppercase',
          tone === 'magenta' && 'text-neon-magenta',
          tone === 'amber' && 'text-neon-amber',
          tone === 'cyan' && 'text-neon-cyan',
        )}>
          ◆ Hardcore · Hearts
        </span>
        <span className={classNames(
          'text-[10px] font-mono tabular-nums',
          tone === 'magenta' && 'text-rose-300',
          tone === 'amber' && 'text-amber-300',
          tone === 'cyan' && 'text-cyan-300',
        )}>
          ×{mult.toFixed(2)}
        </span>
      </header>

      {/* Hearts in a row. Filled = current count. Empty = depleted.
          Uses unicode hearts so it renders without an icon library.
          At ≤3 hearts the whole row gets the heart-warn pulse so
          even a glance catches the "you're low" state. */}
      <div className={classNames(
        'flex items-center gap-1 text-2xl mb-2 select-none',
        hearts <= 3 && 'animate-heart-warn',
      )}>
        {Array.from({ length: MAX_HEARTS }, (_, i) => (
          <span
            key={i}
            className={classNames(
              i < hearts ? '' : 'opacity-20 grayscale',
              tone === 'magenta' && i < hearts && 'animate-pulse',
            )}
            style={{
              color: tone === 'magenta' ? '#ff5cff' :
                     tone === 'amber' ? '#ffc34d' :
                     '#9bff5c',
              textShadow: tone === 'magenta' && i < hearts
                ? '0 0 8px #ff5cff'
                : '0 0 4px currentColor',
            }}
            aria-label={i < hearts ? 'heart filled' : 'heart empty'}
          >
            ♥
          </span>
        ))}
      </div>

      <div className={classNames(
        'text-[10px] font-mono',
        tone === 'magenta' && 'text-rose-300',
        tone === 'amber' && 'text-amber-300',
        tone === 'cyan' && 'text-ink-400',
      )}>
        {message}
        <div className="mt-0.5 text-ink-500">
          Regen: 1 heart per Sunday (week-anchored). Loss: missed workout,
          all-dailies miss, caffeine/alcohol/nicotine overuse, zero spiritual.
        </div>
      </div>
    </div>
  );
}