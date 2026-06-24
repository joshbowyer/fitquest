import { type ReactNode } from 'react';
import { classNames } from '@/lib/format';

/**
 * Small rectangular tile for the /today quick-action grid. Each
 * tile shows a glyph, label, and a one-line summary (e.g. "1.3 L
 * · 50%"). Click opens a modal/handler passed by the parent.
 *
 * Visually: bordered rectangle, hover lift + accent glow. Sized to
 * fit 4 across on lg, 3 on md, 2 on sm.
 */
export function ActionTile({
  glyph,
  label,
  summary,
  accent = 'cyan',
  onClick,
  action,
  busy,
}: {
  /** Single character or short unicode string shown big at the top. */
  glyph: string;
  label: string;
  /** One-line current state (e.g. "1.3 L · 50%"). Optional. */
  summary?: ReactNode;
  accent?: 'cyan' | 'lime' | 'amber' | 'magenta' | 'violet' | 'periwinkle';
  onClick?: () => void;
  /** Optional right-aligned pill in the header (e.g. ✓ done). */
  action?: ReactNode;
  busy?: boolean;
}) {
  const tone = `neon-${accent}`;
  const border = `border-neon-${accent}/30 hover:border-neon-${accent}/70`;
  const glow = `hover:shadow-neon-${accent}/40`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={classNames(
        'group relative border bg-bg-800/50 backdrop-blur-sm',
        'p-3 text-left flex flex-col gap-1 transition-all',
        'hover:-translate-y-0.5 hover:shadow-lg',
        border,
        glow,
        busy && 'opacity-60 cursor-wait',
      )}
    >
      {/* Top row: glyph + action pill */}
      <div className="flex items-start justify-between">
        <span
          className={classNames(
            'font-display text-2xl leading-none select-none',
            `text-${tone}`,
          )}
        >
          {glyph}
        </span>
        {action && <span className="shrink-0">{action}</span>}
      </div>
      {/* Label */}
      <div
        className={classNames(
          'font-display tracking-widest text-[10px] uppercase truncate',
          `text-${tone}`,
        )}
      >
        {label}
      </div>
      {/* Summary line */}
      {summary != null && (
        <div className="text-[10px] font-mono text-ink-300 truncate">
          {summary}
        </div>
      )}
    </button>
  );
}

/**
 * Grid wrapper. responsive: 2 cols on sm, 3 on md, 4 on lg.
 * Tight gap so the dashboard feels dense (one-stop-shop vibe).
 */
export function QuickActionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {children}
    </div>
  );
}
