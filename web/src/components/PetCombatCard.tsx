import { classNames } from '@/lib/format';

// =============================================================
// PetCombatCard — shown in combat UIs (Breach, Raid) to visualize
// the user's deployed pet. Renders sprite + name + HP bar + attack.
//
// Renders nothing for a null pet. Renders a KO badge when the pet is
// fainted. HP bar is green (matching the user's HP bar / pet page).
// =============================================================
type PetForCombat = {
  id: string;
  name: string;
  spritePath: string;
  level: number;
  stage: string;
  currentHp: number;
  maxHp: number;
  attack: number;
  faintedAt: string | null;
  injuredAt: string | null;
};

export function PetCombatCard({ pet }: { pet: PetForCombat | null }) {
  if (!pet) return null;
  const hpPct = pet.maxHp > 0 ? (pet.currentHp / pet.maxHp) * 100 : 0;
  const isKo = !!pet.faintedAt;
  return (
    <div
      className={classNames(
        'rounded border p-2 flex items-center gap-2 bg-bg-900/40',
        isKo
          ? 'border-neon-magenta/40 opacity-70'
          : 'border-neon-lime/30',
      )}
    >
      <img
        src={pet.spritePath}
        alt={pet.name}
        width={48}
        height={48}
        className={classNames(
          'pixelated w-12 h-12',
          isKo && 'grayscale',
        )}
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
          <span className="text-neon-lime truncate">{pet.name}</span>
          <span className="text-ink-300 tabular-nums">
            {pet.currentHp} / {pet.maxHp}
          </span>
        </div>
        <div className="h-2 bg-bg-900 border border-neon-lime/30 rounded">
          <div
            className={classNames(
              'h-full rounded transition-all',
              isKo ? 'bg-neon-magenta' : 'bg-neon-lime',
            )}
            style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
          <span className="text-ink-400">Lv {pet.level} · {pet.stage}</span>
          {!isKo && (
            <span className="text-neon-cyan">⚔ {pet.attack}</span>
          )}
          {isKo && (
            <span className="text-neon-magenta">✗ KO</span>
          )}
        </div>
      </div>
    </div>
  );
}