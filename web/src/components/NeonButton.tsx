import type { ReactNode } from 'react';
import { classNames } from '@/lib/format';

type Variant = 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet';

const VARIANT_CLASS: Record<Variant, string> = {
  cyan: 'btn-neon',
  magenta: 'btn-neon-magenta',
  lime: 'btn-neon border-neon-lime/40 text-neon-lime bg-neon-lime/5 hover:bg-neon-lime/10 hover:border-neon-lime',
  amber: 'btn-neon border-neon-amber/40 text-neon-amber bg-neon-amber/5 hover:bg-neon-amber/10 hover:border-neon-amber',
  violet: 'btn-neon border-neon-violet/40 text-neon-violet bg-neon-violet/5 hover:bg-neon-violet/10 hover:border-neon-violet',
};

type Props = {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: Variant;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
};

export function NeonButton({
  children,
  onClick,
  type = 'button',
  variant = 'cyan',
  disabled,
  className,
  fullWidth,
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={classNames(VARIANT_CLASS[variant], fullWidth && 'w-full', className)}
    >
      {children}
    </button>
  );
}
