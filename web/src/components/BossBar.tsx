import { ProgressBar } from './ProgressBar';

type Props = { bossName: string; hp: number; maxHp: number; status: 'ACTIVE' | 'VICTORY' | 'DEFEAT' };

export function BossBar({ bossName, hp, maxHp, status }: Props) {
  const variant = status === 'VICTORY' ? 'lime' : status === 'DEFEAT' ? 'magenta' : 'magenta';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-display tracking-widest">
        <span className={status === 'VICTORY' ? 'neon-text-lime' : 'neon-text-magenta'}>
          {status === 'VICTORY' ? '✓ ' : ''}{bossName}
        </span>
        <span className="font-mono text-ink-200">
          {Math.max(0, hp)} / {maxHp}
        </span>
      </div>
      <ProgressBar value={hp / maxHp} variant={variant} />
    </div>
  );
}
