import type { Skill } from '@/lib/types';
import { classNames } from '@/lib/format';

type Props = {
  skill: Skill;
  onUnlock: () => void;
  affordable: boolean;
  unlockable: boolean;
  unlocking?: boolean;
};

const TIER_BORDER: Record<string, string> = {
  TIER_1: 'border-neon-cyan/40',
  TIER_2: 'border-neon-magenta/40',
  TIER_3: 'border-neon-amber/40',
};

const TIER_GLOW: Record<string, string> = {
  TIER_1: 'shadow-neon-cyan/40',
  TIER_2: 'shadow-neon-magenta/40',
  TIER_3: 'shadow-neon-amber/40',
};

export function SkillNode({ skill, onUnlock, affordable, unlockable, unlocking }: Props) {
  const cost = skill.cost;
  const baseClasses = 'w-full text-left p-3 border-2 transition-all cursor-pointer';
  const unlocked = skill.unlocked;

  return (
    <button
      onClick={unlockable && !unlocking ? onUnlock : undefined}
      disabled={!unlockable || unlocking}
      className={classNames(
        baseClasses,
        TIER_BORDER[skill.tier],
        unlocked
          ? 'bg-neon-lime/10 border-neon-lime shadow-neon-lime cursor-default'
          : !unlockable
          ? 'border-ink-500/30 bg-bg-800/40 opacity-50 cursor-not-allowed'
          : unlocking
          ? `bg-bg-800/80 animate-neon-charge ${TIER_GLOW[skill.tier]} border-current`
          : affordable
          ? `bg-bg-800/80 hover:scale-[1.02] hover:shadow-lg ${TIER_GLOW[skill.tier]}`
          : 'bg-bg-800/40 opacity-70'
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[9px] font-display tracking-widest uppercase ${
          unlocked ? 'text-neon-lime' : `text-neon-${skill.tier === 'TIER_1' ? 'cyan' : skill.tier === 'TIER_2' ? 'magenta' : 'amber'}`
        }`}>
          {skill.tier.replace('_', ' ')}
        </span>
        <span className="text-[10px] font-mono text-ink-200">SP {cost}</span>
      </div>
      <div className={`font-display text-sm tracking-wider ${unlocked ? 'text-neon-lime' : 'text-ink-50'}`}>
        {skill.name}
      </div>
      <div className="text-[11px] text-ink-300 font-mono mt-1 leading-snug">
        {skill.description}
      </div>
      {skill.prerequisites.length > 0 && (
        <div className="text-[9px] text-ink-400 font-mono mt-2">
          REQ: {skill.prerequisites.join(', ')}
        </div>
      )}
    </button>
  );
}
