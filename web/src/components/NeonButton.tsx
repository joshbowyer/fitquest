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
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
  className?: string;
  fullWidth?: boolean;
};

const SIZE_CLASS = {
  sm: 'text-xs px-2 py-1 whitespace-nowrap',
  md: 'whitespace-nowrap',
};

const LOADING_CLASSES: Record<Variant, string> = {
  cyan: 'animate-neon-charge border-neon-cyan text-neon-cyan',
  magenta: 'animate-neon-charge border-neon-magenta text-neon-magenta',
  lime: 'animate-neon-charge border-neon-lime text-neon-lime',
  amber: 'animate-neon-charge border-neon-amber text-neon-amber',
  violet: 'animate-neon-charge border-neon-violet text-neon-violet',
};

export function NeonButton({
  children,
  onClick,
  type = 'button',
  variant = 'cyan',
  size = 'md',
  disabled,
  loading,
  loadingText,
  icon,
  className,
  fullWidth,
}: Props) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={classNames(
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && 'w-full',
        loading && LOADING_CLASSES[variant],
        className
      )}
    >
      {icon != null && (
        <span
          className={classNames(
            'inline-block align-baseline',
            loading ? 'animate-spin mr-2' : 'mr-2'
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
