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

export function SkillNode({ skill, onUnlock, unlockable, unlocking }: Props) {
  const baseClasses = 'w-full text-left p-3 border-2 transition-all cursor-pointer';
  const unlocked = skill.unlocked;
  // Render the Skill.effects JSON as a short, comma-joined line so
  // the user knows what each perk actually does. The format function
  // lives in Skills.tsx so the rendering rules stay in one place.
  const effectsSummary = formatEffectsInline(skill.effects);

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
        <span className="text-[10px] font-mono text-ink-200">{skill.tier.replace('_', ' ')}</span>
      </div>
      <div className={`font-display text-sm tracking-wider ${unlocked ? 'text-neon-lime' : 'text-ink-50'}`}>
        {skill.name}
      </div>
      <div className="text-[11px] text-ink-300 font-mono mt-1 leading-snug">
        {skill.description}
      </div>
      {effectsSummary && (
        <div className="text-[10px] font-mono text-neon-cyan mt-1.5 leading-snug">
          {effectsSummary}
        </div>
      )}
      {skill.prerequisites.length > 0 && (
        <div className="text-[9px] text-ink-400 font-mono mt-2">
          REQ: {skill.prerequisites.join(', ')}
        </div>
      )}
    </button>
  );
}

/**
 * Format the Skill.effects JSON as a short, comma-joined line. The
 * render-only version (no React/imports) so the same logic is
 * available inside the SkillNode component without a hooky chain.
 *
 * Examples:
 *   [{ type: gold_multiplier, value: 1.1, appliesTo: ALL }]
 *     → "+10% gold (all)"
 *   [{ type: xp_multiplier, value: 1.15, appliesTo: STRENGTH }]
 *     → "+15% xp (strength)"
 *   [{ type: measurement_bonus, value: 0.15, metric: PULLUP_1RM }]
 *     → "+0.15 pullup 1rm"
 *   [{ type: measurement_bonus, value: 1, metric: VO2_MAX }]
 *     → "+1 vo2 max"
 */
const EFFECT_LABEL = {
  gold_multiplier: 'gold',
  xp_multiplier: 'xp',
  measurement_bonus: 'PR',
  raid_damage_multiplier: 'raid dmg',
};

function formatEffectsInline(effects: unknown): string {
  if (!Array.isArray(effects) || effects.length === 0) return '';
  return effects
    .map((e: any) => {
      const type = String(e?.type ?? '');
      const value = Number(e?.value ?? 0);
      if (!type || !Number.isFinite(value) || value === 0) return '';
      if (type === 'measurement_bonus') {
        const metric = String(e?.metric ?? '?').toLowerCase().replace(/_/g, ' ');
        return `+${value} ${metric}`;
      }
      const label =
        EFFECT_LABEL[type as keyof typeof EFFECT_LABEL] ?? type.toLowerCase();
      const pct = Math.round((value - 1) * 100);
      const sign = pct >= 0 ? '+' : '';
      const scope = e?.appliesTo ? ` (${String(e.appliesTo).toLowerCase()})` : '';
      return `${sign}${pct}% ${label}${scope}`;
    })
    .filter(Boolean)
    .join(', ');
}
