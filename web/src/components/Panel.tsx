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
  variant = 'cyan',
  className,
  action,
  scanline,
}: {
  children: ReactNode;
  title?: ReactNode;
  variant?: Variant;
  className?: string;
  action?: ReactNode;
  scanline?: boolean;
}) {
  return (
    <section
      className={classNames(
        'panel relative p-4',
        variant === 'magenta' && 'panel-magenta',
        variant === 'lime' && 'panel-lime',
        VARIANT[variant],
        scanline && 'scanline',
        className
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between mb-3 pb-2 border-b border-current/10">
          {title && (
            <h2 className={`font-display tracking-widest text-xs uppercase text-neon-${variant}`}>
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
