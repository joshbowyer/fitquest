import type { ReactNode } from 'react';
import { classNames } from '@/lib/format';

type Variant = 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet';

const VARIANT: Record<Variant, string> = {
  cyan: 'border-neon-cyan/30',
  magenta: 'border-neon-magenta/30',
  lime: 'border-neon-lime/30',
  amber: 'border-neon-amber/30',
  violet: 'border-neon-violet/30',
};

export function Panel({
  children,
  title,
  subtitle,
  variant = 'cyan',
  className,
  action,
  scanline,
  id,
}: {
  children: ReactNode;
  title?: ReactNode;
  /** Small muted line under the title. Several pages were passing
   * this already — Panel silently dropped it (and `id`), so the
   * authored text never rendered and #anchor deep-links couldn't
   * find their scroll target. */
  subtitle?: ReactNode;
  variant?: Variant;
  className?: string;
  action?: ReactNode;
  scanline?: boolean;
  /** DOM id, for getElementById/scrollIntoView deep links. */
  id?: string;
}) {
  return (
    <section
      id={id}
      className={classNames(
        'panel relative p-4',
        variant === 'magenta' && 'panel-magenta',
        variant === 'lime' && 'panel-lime',
        VARIANT[variant],
        scanline && 'scanline',
        className
      )}
    >
      {(title || action || subtitle) && (
        <header className="mb-3 pb-2 border-b border-current/10">
          <div className="flex items-center justify-between">
            {title && (
              <h2 className={`font-display tracking-widest text-xs uppercase text-ink-50`}>
                {title}
              </h2>
            )}
            {action}
          </div>
          {subtitle && (
            <p className="mt-1 text-[10px] font-mono text-ink-300">{subtitle}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
