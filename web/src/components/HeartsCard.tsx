import { classNames } from '@/lib/format';
import { useAuth } from '@/lib/auth';

// Max hearts. Mirrors MAX_HEARTS in api/src/lib/mode.ts. The api
// defaults new users to this number; we cap the local display at
// the same value so a "10 of 10" reading is possible. If the api
// ever bumps the cap, we'd update this constant.
const MAX_HEARTS = 10;

// Lime-green fill colour for the HP bar — kept in sync with the
// hero-bar HP pill in Layout.tsx (bg-neon-lime / #9bff5c) so the
// dashboard's HeartsCard reads as the same visual element rather
// than a separate "hearts" widget.
const BAR_FILL = '#9bff5c';
const BAR_TRACK_BORDER = 'border-neon-lime/30';

/**
 * Hearts indicator. Always rendered (in both Casual and Hardcore
 * mode) so the top-hero row stays a consistent 4-column layout.
 * Contents differ by mode:
 *
 *   - Casual: full HP bar (no penalty, no regen) + a "switch to
 *     Hardcore" hint so the user knows the toggle exists.
 *   - Hardcore: 0-10 HP bar with status message + regen explainer.
 *
 * Bar pulses red at ≤3 to signal "you're getting low" — same
 * `animate-heart-warn` class the hero bar in Layout.tsx uses so
 * the two never disagree about urgency.
 */
export function HeartsCard() {
  const { user } = useAuth();
  if (!user) return null;

  const isHardcore = user.mode === 'HARDCORE';
  const hearts = Math.max(0, Math.min(MAX_HEARTS, user.hearts ?? MAX_HEARTS));
  const mult = user.heartMultiplier ?? 1;
  const pct = (hearts / MAX_HEARTS) * 100;

  if (!isHardcore) {
    // Casual mode: simplified display. No penalty, no regen —
    // the block exists so the row stays balanced and so a user
    // who doesn't know about the Hardcore toggle can discover
    // it. Bar renders full since casual hearts never deplete.
    return (
      <div className="panel relative p-4 border border-rose-500/30 bg-rose-500/5">
        <header className="flex items-center justify-between mb-2">
          <span className="font-display tracking-widest text-[10px] uppercase text-rose-300">
            ◆ Casual · HP
          </span>
          <span className="text-[10px] font-mono tabular-nums text-rose-300">
            ×{mult.toFixed(2)}
          </span>
        </header>

        {/* Full HP bar — casual hearts never deplete. Mirrors the
            hero-bar style in Layout.tsx (bg-neon-lime fill, ink
            track) so the two read as the same element. */}
        <div className="h-2 bg-bg-900 border border-neon-lime/30 rounded mb-2">
          <div
            className="h-full bg-neon-lime rounded transition-all"
            style={{ width: '100%', boxShadow: `0 0 4px ${BAR_FILL}` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono text-ink-400 mb-2 tabular-nums">
          <span className="text-neon-lime">{MAX_HEARTS}/{MAX_HEARTS}</span>
          <span className="text-ink-500 uppercase tracking-widest">HP</span>
        </div>

        <div className="text-[10px] font-mono text-ink-400">
          Casual mode — no heart penalty, full rewards. HP shown for
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

  // Hardcore mode: 0-10 HP bar. Same fill / track treatment as
  // the hero bar in Layout.tsx so the two never disagree about
  // the player's current HP state. Pulses red at ≤3 via the
  // shared animate-heart-warn keyframes.
  const message =
    hearts === 0 ? '⚠ Zero HP — ×0.00, no rewards. Regen Sunday.' :
    hearts <= 2 ? 'HP low — penalty is heavy. Try to log a workout before Sunday.' :
    hearts <= 4 ? 'HP dropping — penalty escalating. One missed day and you drop another.' :
    'Full HP. No penalty.';

  return (
    <div className="panel relative p-4 border border-rose-500/30 bg-rose-500/5">
      <header className="flex items-center justify-between mb-2">
        <span className="font-display tracking-widest text-[10px] uppercase text-rose-300">
          ◆ Hardcore · HP
        </span>
        <span className="text-[10px] font-mono tabular-nums text-rose-300">
          ×{mult.toFixed(2)}
        </span>
      </header>

      <div className={classNames(
        hearts <= 3 && 'animate-heart-warn',
      )}>
        {/* HP bar — same lime fill / ink track as the hero bar. */}
        <div className={`h-2 bg-bg-900 border ${BAR_TRACK_BORDER} rounded`}>
          <div
            className="h-full bg-neon-lime rounded transition-all"
            style={{ width: `${pct}%`, boxShadow: `0 0 4px ${BAR_FILL}` }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-rose-300 mt-1 mb-2 tabular-nums">
        <span className="text-neon-lime">{hearts}/{MAX_HEARTS}</span>
        <span className="text-ink-500 uppercase tracking-widest">HP</span>
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