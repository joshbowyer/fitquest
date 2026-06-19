import { classNames } from '@/lib/format';

type Props = {
  value: number; // 0..1
  variant?: 'cyan' | 'magenta' | 'lime' | 'amber';
  showText?: boolean;
  label?: string;
};

const VARIANT: Record<NonNullable<Props['variant']>, string> = {
  cyan: 'bg-neon-cyan',
  magenta: 'bg-neon-magenta',
  lime: 'bg-neon-lime',
  amber: 'bg-neon-amber',
};

export function ProgressBar({ value, variant = 'cyan', showText, label }: Props) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="w-full">
      {(label || showText) && (
        <div className="flex justify-between text-[10px] font-mono mb-1 text-ink-300">
          {label && <span>{label}</span>}
          {showText && <span className={`text-neon-${variant}`}>{(pct * 100).toFixed(0)}%</span>}
        </div>
      )}
      <div className="h-2 bg-bg-700 border border-ink-500/40 overflow-hidden">
        <div
          className={classNames('h-full transition-all duration-500', VARIANT[variant])}
          style={{ width: `${pct * 100}%`, boxShadow: '0 0 8px currentColor' }}
        />
      </div>
    </div>
  );
}
