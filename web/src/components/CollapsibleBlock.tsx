import { useState, type ReactNode } from 'react';
import { classNames } from '@/lib/format';

/**
 * One collapsible block for the /today one-stop-shop panel.
 *
 * Collapsed by default: shows the title on the left, a one-line
 * summary on the right, and a chevron that flips on click.
 * Expanded: shows whatever `children` the parent passes (typically
 * a small inline log form).
 *
 * Used to keep the daily dashboard tidy. The user opens only the
 * block they want to update; everything else stays collapsed.
 */
export function CollapsibleBlock({
  title,
  summary,
  defaultOpen = false,
  accent = 'cyan',
  children,
  action,
}: {
  title: string;
  /** One-line summary shown collapsed (e.g. "1.3 L · 50% of target"). */
  summary?: ReactNode;
  /** Initial open state. Defaults to closed. */
  defaultOpen?: boolean;
  /** Neon accent color for the title + chevron. */
  accent?: 'cyan' | 'lime' | 'amber' | 'magenta' | 'violet' | 'periwinkle';
  /** Body content shown when expanded. Typically a quick-log form. */
  children: ReactNode;
  /** Optional right-aligned action (e.g. +N pill). Shown in BOTH
   *  collapsed + expanded states. */
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = `neon-${accent}`;
  const border = `border-neon-${accent}/30`;
  const borderOpen = `border-neon-${accent}/60`;
  return (
    <section
      className={classNames(
        'border bg-bg-800/40',
        open ? borderOpen : border,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2 text-left"
      >
        <span
          className={classNames(
            'font-display tracking-widest text-[10px] uppercase shrink-0',
            `text-${tone}`,
          )}
        >
          {title}
        </span>
        {summary && !open && (
          <span className="text-[10px] font-mono text-ink-300 truncate flex-1">
            {summary}
          </span>
        )}
        {!summary && <span className="flex-1" />}
        {action && <div className="shrink-0">{action}</div>}
        <span
          aria-hidden="true"
          className={classNames(
            'shrink-0 text-[10px] font-mono text-ink-400 transition-transform select-none w-3 inline-block text-center',
            open && 'rotate-90',
          )}
        >
          ▶
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-current/10">
          {children}
        </div>
      )}
    </section>
  );
}
