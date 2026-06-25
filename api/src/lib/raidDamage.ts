import type { ClassName } from './prisma.js';

/**
 * Compute raid damage dealt by a workout, given the user's class.
 * Each class has a unique damage profile that ties to its class ability:
 *
 *   JUGGERNAUT  +DMG   — raw, consistent damage. Reliable.
 *   BERSERKER   +CRIT  — 15% per completed set to crit for 1.75x that
 *                        set's contribution. Lower base, swingy.
 *   PHANTOM     +EVA   — 12% per completed set to "evade" (no damage but
 *                        counts toward the EVA proc for raid defense).
 *                        Slightly lower base.
 *   SCOUT       +DISC  — duration-weighted discovery bonus on top of base.
 *   ORACLE      +HEAL  — 60% base damage, but contributes 25% of damage
 *                        dealt as party-wide healing (shield).
 *
 * Damage is integer-rounded and capped per-workout to keep the boss HP
 * economy sane.
 */

export type SetInput = {
  reps: number;
  weight?: number | null;
  duration?: number | null;
  rpe?: number | null;
  completed: boolean;
};

export type WorkoutInput = {
  type: 'STRENGTH' | 'HYPERTROPHY' | 'CALISTHENICS' | 'CARDIO' | 'MOBILITY' | 'OTHER';
  durationMin: number;
  exercises: Array<{
    name: string;
    sets: SetInput[];
  }>;
};

export type RaidDamageResult = {
  total: number;        // actual damage dealt to the boss
  evade: number;        // count of sets that evaded (no damage, EVA proc)
  crit: number;         // count of sets that crit
  base: number;         // raw base damage before class multiplier
  classMult: number;    // class damage multiplier (0.5 - 1.0)
  shield: number;       // healing/shield generated (ORACLE)
  ability: string;      // '+DMG' / '+CRIT' / '+EVA' / '+DISC' / '+HEAL'
};

const PER_WORKOUT_CAP = 5000;

function setContribution(set: SetInput): number {
  if (!set.completed) return 0;
  const reps = set.reps;
  const weight = set.weight ?? 0;
  const dur = set.duration ?? 0;
  // Strength-style: weight * reps is the main signal.
  // Calisthenics / cardio: reps + duration.
  if (weight > 0 && reps > 0) return Math.round(reps * 1 + weight * reps * 0.08);
  if (reps > 0) return Math.round(reps * 2);
  if (dur > 0) return Math.round(dur / 3); // seconds → ~1 per 3s of work
  return 0;
}

function classMeta(cls: ClassName | null) {
  if (cls === 'JUGGERNAUT') return { mult: 1.0,  ability: '+DMG',   critChance: 0,    evadeChance: 0,    discBonus: 0,    shieldFrac: 0 };
  if (cls === 'BERSERKER')  return { mult: 0.8,  ability: '+CRIT',  critChance: 0.15, evadeChance: 0,    discBonus: 0,    shieldFrac: 0 };
  if (cls === 'PHANTOM')    return { mult: 0.85, ability: '+EVA',   critChance: 0,    evadeChance: 0.12, discBonus: 0,    shieldFrac: 0 };
  if (cls === 'SCOUT')      return { mult: 0.9,  ability: '+DISC',  critChance: 0,    evadeChance: 0,    discBonus: 0.5,  shieldFrac: 0 };
  if (cls === 'TRACER')     return { mult: 1.1,  ability: '+BURST', critChance: 0.10, evadeChance: 0,    discBonus: 0,    shieldFrac: 0 };
  if (cls === 'ORACLE')     return { mult: 0.6,  ability: '+HEAL',  critChance: 0,    evadeChance: 0,    discBonus: 0,    shieldFrac: 0.25 };
  return { mult: 0.75, ability: '+DMG', critChance: 0, evadeChance: 0, discBonus: 0, shieldFrac: 0 };
}

export function computeRaidDamage(workout: WorkoutInput, cls: ClassName | null): RaidDamageResult {
  const meta = classMeta(cls);

  // Flatten all completed sets; we'll run crit/evade per set.
  const allSets: SetInput[] = workout.exercises.flatMap((ex) => ex.sets);
  const completed = allSets.filter((s) => s.completed);

  let base = 0;
  let crit = 0;
  let evade = 0;
  let damage = 0;

  for (const set of completed) {
    const contrib = setContribution(set);
    if (contrib <= 0) continue;
    const isCrit = Math.random() < meta.critChance;
    const isEvade = Math.random() < meta.evadeChance;
    base += contrib;
    if (isEvade) {
      evade += 1;
      continue;
    }
    const setDamage = isCrit ? Math.round(contrib * 1.75) : contrib;
    crit += isCrit ? 1 : 0;
    damage += setDamage;
  }

  // SCOUT gets a discovery bonus from duration (long runs/hikes = more
  // chance to find items / scout routes).
  const discoveryBonus = Math.round(workout.durationMin * meta.discBonus);
  damage += discoveryBonus;

  // Apply class multiplier to the whole damage pool.
  damage = Math.round(damage * meta.mult);

  // ORACLE generates party shield (25% of damage dealt, rounded).
  const shield = Math.round(damage * meta.shieldFrac);

  // Cap per-workout to keep boss economy sane.
  const total = Math.min(PER_WORKOUT_CAP, Math.max(0, damage));

  return {
    total,
    evade,
    crit,
    base,
    classMult: meta.mult,
    shield,
    ability: meta.ability,
  };
}
