import { classNames } from '@/lib/format';
import { useAuth } from '@/lib/auth';

/**
 * Hearts indicator for Hardcore mode. Shows 5 hearts (or fewer if
 * depleted), with a status line that explains the current penalty.
 * Hidden entirely in Casual mode so it doesn't add visual noise.
 *
 * At 0 hearts the card switches to magenta + scolds the user so the
 * consequence is unmissable. At 1-2 hearts the card shifts to amber.
 * 3+ hearts = neutral cyan.
 */
export function HeartsCard() {
  const { user } = useAuth();
  if (!user || user.mode !== 'HARDCORE') return null;

  const hearts = Math.max(0, Math.min(5, user.hearts ?? 5));
  const mult = user.heartMultiplier ?? 1;
  const tone =
    hearts === 0 ? 'magenta' :
    hearts <= 2 ? 'amber' :
    'cyan';

  const message =
    hearts === 0 ? '⚠ Half rewards until a heart regenerates (~8h).' :
    hearts <= 2 ? 'Hearts low — try to log a workout soon.' :
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

      {/* 5 hearts in a row. Filled = current count. Empty = depleted.
          Uses unicode hearts so it renders without an icon library. */}
      <div className="flex items-center gap-1 text-2xl mb-2 select-none">
        {Array.from({ length: 5 }, (_, i) => (
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
          Regen: 1 heart per 8h. Lose: 1 heart per missed planned workout.
        </div>
      </div>
    </div>
  );
}