import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { classNames } from '@/lib/format';
import { NeonButton } from '@/components/NeonButton';
import { branchIcon, calitreeIconFor, skillCalitreeIconFor, SKILL_ICONS } from '@/lib/skillIcons';
import { CLASS_META } from '@/lib/types';
import { emitReward, nextRewardId } from '@/components/RewardOverlay';
import { playSoundAndNotify } from '@/lib/soundBus';

// Tailwind text-neon-* class for the user's class accent. Used by
// the calitree PNG icons (via mask-image + background-color:
// currentColor) to color each silhouette per the user's class.
// PHANTOM → lime, JUGGERNAUT → red, BERSERKER → magenta, etc.
// Mirrors the same color scheme as primaryColorForClass() in
// web/src/lib/quest.ts but returns a Tailwind class directly.
function classColorForClass(c: string | null): string {
  if (!c) return 'text-neon-lime';
  const meta = CLASS_META[c];
  if (!meta) return 'text-neon-lime';
  switch (meta.color) {
    case 'red':        return 'text-neon-red';
    case 'magenta':    return 'text-neon-magenta';
    case 'lime':       return 'text-neon-lime';
    case 'orange':     return 'text-neon-orange';
    case 'goldenrod':  return 'text-neon-goldenrod';
    case 'periwinkle': return 'text-neon-periwinkle';
    default:           return 'text-neon-lime';
  }
}

/**
 * SkillTree v1 — replaces the old /skills page.
 *
 * Renders the calitree.app-style vertical-chain tree for the user's
 * current class. Each branch is a column; each column is a vertical
 * chain of 4-9 nodes (the tier progression). Unlocked nodes are lit;
 * locked nodes are faded with a "?" symbol. Click a node for the
 * unlock modal which has:
 *   - blurb (what is this skill / why)
 *   - description (how to do the test)
 *   - safety (equipment / form warnings)
 *   - a "Mark complete" form that takes the user's test result
 *
 * The tree data is fetched once and held in cache (the api caches
 * nothing because the user can change class). On a successful
 * unlock, we invalidate the query so the new unlocked state renders.
 */

type SkillTest = {
  description: string;
  safety: string;
  metric: string;
  threshold: Record<string, number>;
};

// Pending unlock payload returned by /skills/pending-unlocks.
// The matchedSet is a snapshot of the workout set that satisfied
// the skill's test threshold — the modal renders these values
// so the user can verify "ah, my 5-rep pull-up set on Oct 12
// was the trigger" before clicking Unlock.
type PendingUnlock = {
  id: string;
  skillId: string;
  skillName: string;
  branch: string | null;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';
  blurb: string | null;
  test: SkillTest | null;
  matchedSet: {
    workoutId: string;
    workoutDate: string;
    exerciseName: string;
    setId: string;
    reps: number | null;
    weight: number | null;
    duration: number | null;
  };
  createdAt: string;
};

type Skill = {
  id: string;
  name: string;
  // Branch label (e.g. JUGGERNAUT "Squat", PHANTOM "Pull") as
  // stored on the Skill row. The page groups skills by this field.
  // Pre-v1 leftover skills have null and fall into the "Other"
  // column at the end.
  branch: string | null;
  blurb: string | null;
  description: string;
  position: number;
  prerequisites: string[];
  test: SkillTest | null;
  effects: unknown;
  unlocked: boolean;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';
};

type TreeResponse = {
  className: string;
  items: Skill[];
};

// ---- Branch grouping ----
// The Skill model carries an explicit `branch` field set by the
// seed (one of the canonical labels per class). Group skills by
// that field directly — no name-prefix inference needed. Skills
// with a null branch (pre-v1 leftovers) go to "Other".

type Branch = {
  branchName: string;
  tier: Skill['tier'];
  skills: Skill[];
};

// Per-branch max tier override (mirrors api/src/lib/seedSkills.ts
// BRANCH_MAX_TIER). Every branch's hardest skill sits well past the
// rest of its progression, so each branch tops out at its own
// super-tier (T4-T6) rather than the historical T3 cap. The SkillTree
// page uses this map to decide which nodes get the god-tier glow — a
// skill whose `tier` matches its branch's `maxTier` (and is last in
// the chain) is rendered with the god-tier styling, regardless of
// what number that tier is.
//
// IMPORTANT: keep this map in sync with BRANCH_MAX_TIER in
// api/src/lib/seedSkills.ts — they must agree or the glow misfires.
const BRANCH_MAX_TIER: Record<string, Skill['tier']> = {
  // JUGGERNAUT
  Squat: 'TIER_5',
  Press: 'TIER_4',
  Deadlift: 'TIER_4',
  Strongman: 'TIER_4',
  Sled: 'TIER_5',
  // PHANTOM (calisthenics)
  Push: 'TIER_6',
  Pull: 'TIER_5',
  Holds: 'TIER_5',
  Rings: 'TIER_5',
  Handstand: 'TIER_5',
  Planche: 'TIER_6',
  Legs: 'TIER_5',
  // SCOUT
  Run: 'TIER_6',
  Ruck: 'TIER_5',
  Triathlon: 'TIER_5',
  // BERSERKER
  Kettlebell: 'TIER_4',
  Capacity: 'TIER_4',
  Boxing: 'TIER_4',
  'Mace / Indian Club': 'TIER_4',
  Sandbag: 'TIER_4',
  // TRACER
  Sprint: 'TIER_5',
  Plyo: 'TIER_5',
  Parkour: 'TIER_5',
  Agility: 'TIER_4',
  // ORACLE
  Mobility: 'TIER_5',
  Breath: 'TIER_4',
  Balance: 'TIER_5',
  'Ignatian Meditation': 'TIER_4',
  Yoga: 'TIER_4',
};
function maxTierFor(branchName: string): Skill['tier'] {
  return BRANCH_MAX_TIER[branchName] ?? 'TIER_3';
}

// Canonical branch order per class. Used to sort columns in the
// correct left-to-right order. Any new branch label returned from
// the server that isn't in this list gets appended after the known
// ones.
const BRANCH_ORDER_BY_CLASS: Record<string, string[]> = {
  JUGGERNAUT: ['Squat', 'Press', 'Deadlift', 'Overhead Press', 'Strongman', 'Sled'],
  PHANTOM: ['Push', 'Pull', 'Holds', 'Rings', 'Handstand', 'Planche'],
  SCOUT: ['Run', 'Ruck', 'Triathlon'],
  BERSERKER: ['Sled', 'Kettlebell', 'Boxing', 'Capacity', 'Mace / Indian Club', 'Sandbag', 'Medicine Ball'],
  TRACER: ['Sprint', 'Plyo', 'Parkour', 'Agility', 'Throws'],
  ORACLE: ['Mobility', 'Breath', 'Balance', 'Ignatian Meditation', 'Yoga', 'Pilates'],
};

function buildBranches(items: Skill[], className: string): Branch[] {
  const order = BRANCH_ORDER_BY_CLASS[className] ?? [];
  // Group by skill.branch. Order: tier ASC, position ASC within a branch.
  const groups = new Map<string, Skill[]>();
  for (const s of items) {
    const branch = s.branch ?? 'Other';
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch)!.push(s);
  }
  // Sort branches: known order first, then any unknowns alphabetically,
  // "Other" always last.
  const sortKey = (name: string): [number, string] => {
    if (name === 'Other') return [2, ''];
    const idx = order.indexOf(name);
    if (idx === -1) return [1, name];
    return [0, order[idx]];
  };
  const sortedBranches = Array.from(groups.entries())
    .map(([branchName, skills]) => ({ branchName, skills }))
    .sort((a, b) => {
      const [oa, sa] = sortKey(a.branchName);
      const [ob, sb] = sortKey(b.branchName);
      if (oa !== ob) return oa - ob;
      return sa.localeCompare(sb);
    });
  return sortedBranches.map((b) => ({ ...b, tier: maxTierFor(b.branchName) }));
}

// ---- Result-input component for each metric type ----

function ResultInput({
  metric,
  onChange,
}: {
  metric: string;
  // Accepts a value or a functional updater — two-field metrics
  // (weight:reps etc.) merge into the previous result via updater.
  onChange: (
    v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>),
  ) => void;
}) {
  // Render the appropriate input(s) per metric. Single field for
  // most metrics; two for weighted.
  switch (metric) {
    case 'reps':
    case 'rounds':
      return (
        <input
          type="number"
          min={0}
          className="input-neon"
          placeholder="reps / rounds"
          onChange={(e) => onChange({ [metric]: Number(e.target.value) })}
        />
      );
    case 'duration':
      return (
        <input
          type="number"
          min={0}
          className="input-neon"
          placeholder="seconds"
          onChange={(e) => onChange({ duration_sec: Number(e.target.value) })}
        />
      );
    case 'distance':
      return (
        <input
          type="number"
          min={0}
          className="input-neon"
          placeholder="meters"
          onChange={(e) => onChange({ distance_m: Number(e.target.value) })}
        />
      );
    case 'weight:reps':
      return (
        <div className="flex gap-2">
          <input type="number" min={0} className="input-neon flex-1" placeholder="reps" onChange={(e) => onChange((p) => ({ ...p, reps: Number(e.target.value) }))} />
          <input type="number" min={0} className="input-neon flex-1" placeholder="weight (kg)" onChange={(e) => onChange((p) => ({ ...p, weight_kg: Number(e.target.value) }))} />
        </div>
      );
    case 'reps:each':
      return (
        <input
          type="number"
          min={0}
          className="input-neon"
          placeholder="reps each side"
          onChange={(e) => onChange({ reps: Number(e.target.value) })}
        />
      );
    case 'weighted:reps:each':
      return (
        <div className="flex gap-2">
          <input type="number" min={0} className="input-neon flex-1" placeholder="reps each side" onChange={(e) => onChange((p) => ({ ...p, reps: Number(e.target.value) }))} />
          <input type="number" min={0} className="input-neon flex-1" placeholder="added weight (kg)" onChange={(e) => onChange((p) => ({ ...p, weight_kg: Number(e.target.value) }))} />
        </div>
      );
    default:
      return (
        <input
          type="number"
          min={0}
          className="input-neon"
          placeholder="value"
          onChange={(e) => onChange({ value: Number(e.target.value) })}
        />
      );
  }
}

function UnlockModal({
  skill,
  unlockedNames,
  unlockError,
  onClose,
  onUnlock,
  isPending,
}: {
  skill: Skill;
  /**
   * Set of skill NAMES the user has already unlocked. Used to gate
   * the test form: if `skill.prerequisites` includes names not in
   * this set, we show a "Locked" view instead of the form so the
   * user isn't tempted to enter a result the server will reject.
   */
  unlockedNames: Set<string>;
  /** Server-side error from the unlock attempt (prereq missing,
   *  prereq missing, test not met, etc.). Surfaced inline so the
   *  user knows why the modal didn't close + their input was
   *  rejected. Null when no error. */
  unlockError: string | null;
  onClose: () => void;
  onUnlock: (result: Record<string, number>) => void;
  isPending: boolean;
}) {
  const [result, setResult] = useState<Record<string, number>>({});
  const test = skill.test;

  // Already-unlocked — show a read-only view so the user can see
  // what the test was without re-doing it. Saves a click and
  // avoids the "what does Mark Complete do?" moment on an
  // already-completed skill.
  if (skill.unlocked) {
    return (
      <Modal open onClose={onClose} title={skill.name} width="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✓</span>
            <span className="text-sm font-display tracking-widest uppercase text-neon-lime">
              Unlocked · {skill.tier.replace('TIER_', 'Tier ')}
            </span>
          </div>
          {skill.blurb && (
            <div className="text-sm text-ink-200 italic">{skill.blurb}</div>
          )}
          {test && (
            <div className="text-sm text-ink-100">{test.description}</div>
          )}
          {test?.safety && (
            <div className="border border-amber-500/40 bg-amber-500/5 p-2 text-xs font-mono text-amber-200">
              <span className="uppercase tracking-widest mr-2 text-amber-300">SAFETY</span>
              {test.safety}
            </div>
          )}
          {test && (
            <div className="text-xs font-mono text-ink-400">
              Threshold: <span className="text-ink-200">{JSON.stringify(test.threshold)}</span>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <NeonButton variant="cyan" onClick={onClose}>Close</NeonButton>
          </div>
        </div>
      </Modal>
    );
  }

  // Pre-v1 skill (no test) — legacy unlock with no cost. The
  // SP economy is gone, so a legacy skill with no test is just
  // a one-click unlock (provided the prereqs are met).
  if (!test) {
    return (
      <Modal open onClose={onClose} title={`Unlock: ${skill.name}`} width="max-w-lg">
            <p className="text-sm text-ink-200 mb-4">
              This is a legacy skill (pre-SkillTree v1) without a defined
              test. Confirm to unlock.
            </p>
        <div className="flex justify-end gap-2 pt-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="lime"
            loading={isPending}
            onClick={() => onUnlock({})}
          >
            Unlock
          </NeonButton>
        </div>
      </Modal>
    );
  }

  // v1 skill: gate on prerequisites. If any are missing, show a
  // "Locked" view listing what's needed. The user shouldn't be
  // able to enter a result here — the server would reject it with
  // 400, but better to not even tempt them.
  const missing = (skill.prerequisites ?? []).filter((p) => !unlockedNames.has(p));
  if (missing.length > 0) {
    return (
      <Modal open onClose={onClose} title={`Locked: ${skill.name}`} width="max-w-lg">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔒</span>
            <span className="text-sm font-display tracking-widest uppercase text-ink-300">
              Locked
            </span>
          </div>
          {skill.blurb && (
            <div className="text-sm text-ink-200 italic">{skill.blurb}</div>
          )}
          <p className="text-sm text-ink-200">
            This skill unlocks once you've completed the following
            prerequisite{missing.length === 1 ? '' : 's'}:
          </p>
          <ul className="text-sm font-mono text-neon-amber list-disc list-inside space-y-0.5">
            {missing.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs font-mono text-ink-400">
            Come back after each prerequisite is unlocked.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <NeonButton variant="cyan" onClick={onClose}>Close</NeonButton>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Unlock: ${skill.name}`} width="max-w-lg">
      <div className="space-y-3">
        {skill.blurb && (
          <div className="text-sm text-ink-200 italic">{skill.blurb}</div>
        )}
        <div className="text-sm text-ink-100">{test.description}</div>
        {test.safety && (
          <div className="border border-amber-500/40 bg-amber-500/5 p-2 text-xs font-mono text-amber-200">
            <span className="uppercase tracking-widest mr-2 text-amber-300">SAFETY</span>
            {test.safety}
          </div>
        )}
        <div className="text-xs font-mono text-ink-400">
          Threshold: <span className="text-ink-200">{JSON.stringify(test.threshold)}</span>
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
            Your result
          </label>
          <ResultInput
            metric={test.metric}
            onChange={(v) => setResult((p) => (typeof v === 'function' ? v(p) : { ...p, ...v }))}
          />
        </div>
        {unlockError && (
          <div className="text-xs font-mono text-neon-magenta border border-neon-magenta/30 rounded p-2 bg-neon-magenta/5">
            ✗ {unlockError}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="lime"
            loading={isPending}
            disabled={Object.keys(result).length === 0}
            onClick={() => onUnlock(result)}
          >
            Mark complete
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}

// ---- Branch icons ----
// Hand-coded SVG icons live in @/lib/skillIcons (32 variants, one
// per branch label across all 6 classes). See that file for the
// visual-language notes. branchIcon() returns a React element so it
// can be rendered inline. Each class gets its own variant for shared
// labels (e.g. JUGGERNAUT.Sled vs BERSERKER.Sled).

function SkillNode({
  skill,
  className,
  onClick,
  isUnlocked,
  isGodTier,
}: {
  skill: Skill;
  className: string;
  onClick: () => void;
  isUnlocked: boolean;
  isGodTier: boolean;
}) {
  // Per-skill icons override the branch icon for specific skills
  // whose silhouette is more recognizable than the branch label
  // (e.g. '3 Muscle-Ups' gets its own muscle-up icon instead of
  // the generic 'Pull' pull-ups.png). Fall through to branchIcon
  // when the skill name isn't in the SKILL_ICONS map.
  const icon = SKILL_ICONS[skill.name] ?? branchIcon(skill.branch, className);
  // Calitree.app-style icon for branches that have a direct
  // calisthenics analog. Per-skill lookup wins over the branch
  // lookup (so e.g. 'L-Sit' gets the l-sit.png, not the
  // generic plank.png). null → fall through to the hand-coded
  // SVG above (covers heavy barbell / sled / boxing / mace / etc.
  // where calitree.app doesn't have a node).
  const calitreeFile = skillCalitreeIconFor(skill.name) ?? calitreeIconFor(skill.branch);
  const tierShort = skill.tier.replace('TIER_', 'T');
  return (
    <button
      onClick={onClick}
      aria-label={`${skill.name} (${skill.tier}${isGodTier ? ' god-tier' : ''})`}
      // w-[110px] forces every SkillNode to the same width so the
      // connector-to-connector spacing is identical across all
      // branches (short vs long skill names). Without this, the
      // button width tracks the skill name's intrinsic width, and
      // branches end up looking stretched or compressed relative
      // to each other.
      // Every vertical segment of this button has a FIXED height:
      // tier label h-2.5 (10px) + gap 6px + circle h-14 (56px) +
      // gap 6px + name h-[22px] = 100px, for every node. Combined
      // with `items-start` on the chain wrapper, the circle top is
      // at a constant y=16 in every node, so all icons share the
      // same Y. (The old min-h-[92px] + items-center approach
      // failed because 2-line names made those buttons ~100px tall
      // while 1-line ones were floored at 92px; centering the
      // shorter buttons inside the stretched row pushed their
      // circles ~4px lower than their 2-line-name neighbors.)
      className={classNames(
        'group flex flex-col items-center gap-1.5 outline-none w-[110px] shrink-0',
        'focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-lg',
      )}
    >
      {/* Tier label — fixed 10px height so the icon's vertical
          position below it is constant across all buttons. */}
      <div
        className={classNames(
          'text-[8px] font-display tracking-widest uppercase h-2.5 leading-none',
          isGodTier
            ? 'text-neon-amber'
            : isUnlocked
              ? 'text-neon-lime'
              : 'text-ink-400',
        )}
      >
        {tierShort}
      </div>
      {/* The circle — calitree-style flow-chart node. Renders a
          calitree PNG (with synthwave CSS filter) when one exists,
          otherwise the hand-coded SVG via `icon`. */}
      <div
        className={classNames(
          'relative w-14 h-14 rounded-full border-2 flex items-center justify-center',
          // text-[28px]: the hand-coded SVGs render at 1em, so this
          // makes them exactly 28px — the same size as the w-7 h-7
          // calitree PNG masks. (text-2xl was 24px, which left the
          // SVG icons visibly smaller than the PNG ones.)
          'text-[28px] transition-all duration-200',
          isGodTier
            ? 'border-neon-amber bg-neon-amber/10 shadow-neon-amber'
            : isUnlocked
              ? 'border-neon-lime bg-neon-lime/10 shadow-neon-lime'
              : 'border-ink-500/40 bg-bg-800/60 group-hover:border-neon-cyan/60 group-hover:bg-neon-cyan/5',
        )}
      >
        {calitreeFile ? (
          // PNG from /icons/calitree/ used as a CSS mask. The PNG
          // itself is just a flat silhouette on transparent
          // background; `background-color: currentColor` paints
          // it the parent's text color, and the drop-shadow filter
          // adds the neon glow. This way the same PNG can be
          // neon-lime for PHANTOM, neon-magenta for BERSERKER,
          // neon-amber for god-tier, dim for locked — all without
          // regenerating the PNG. See scripts/gen-planche-nano.py
          // for how the stroke-free PNG is generated.
            <i
              aria-hidden
              className={classNames(
                // w-7 h-7 = 28px. Same size the hand-coded SVG
                // ends up at via the `text-[28px]` → `1em` flow on
                // the circle above. Both icon kinds are flex-
                // centered in the same 56px circle, so their
                // centers — and sizes — now match exactly.
                'block w-7 h-7 select-none transition-all duration-200',
                isGodTier
                ? 'text-neon-amber'
                : isUnlocked
                  ? classColorForClass(className)
                  : 'text-ink-500',
              isUnlocked ? 'opacity-100' : 'opacity-40',
            )}
            style={{
              WebkitMaskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              maskImage: `url(/icons/calitree/${calitreeFile}.png)`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              backgroundColor: 'currentColor',
              filter: isGodTier
                ? 'drop-shadow(0 0 3px #ffaa3a)'
                : isUnlocked
                  ? 'drop-shadow(0 0 2.5px currentColor)'
                  : 'none',
            }}
          />
        ) : (
          <span
            className={classNames(
              'leading-none select-none',
              isUnlocked ? '' : 'opacity-40 grayscale',
            )}
          >
            {icon}
          </span>
        )}
        {/* Lock badge for locked nodes */}
        {!isUnlocked && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-900 border border-ink-500/60 flex items-center justify-center text-[8px] leading-none">
            🔒
          </span>
        )}
        {/* Check mark for unlocked nodes */}
        {isUnlocked && !isGodTier && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-neon-lime text-bg-900 flex items-center justify-center text-[8px] font-bold leading-none">
            ✓
          </span>
        )}
        {/* Star for god-tier */}
        {isGodTier && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-neon-amber text-bg-900 flex items-center justify-center text-[8px] leading-none">
            ★
          </span>
        )}
      </div>
      {/* Skill name — fixed two-line box (h-[22px] = 2 × 11px
          lines) so the button height is identical whether the
          name wraps to 1 or 2 lines. This is what keeps every
          button exactly 100px tall (see the className comment on
          the button above). */}
      <div
        className={classNames(
          'text-[9px] font-display tracking-wide text-center max-w-[110px]',
          'leading-[11px] h-[22px] line-clamp-2',
          isUnlocked ? 'text-neon-lime' : 'text-ink-200',
        )}
        title={skill.name}
      >
        {skill.name}
      </div>
    </button>
  );
}

function BranchColumn({
  branch,
  className,
  onSkillClick,
}: {
  branch: Branch;
  className: string;
  onSkillClick: (skill: Skill) => void;
}) {
  // Mobile layout: this is one ROW in a vertical stack of branches.
  // Inside the row, skills flow HORIZONTALLY (left to right). The
  // row scrolls horizontally to reveal the T3 god-tier skills that
  // don't fit in the viewport width. `overflow-x-auto` on the inner
  // flex parent + `data-branch` on the row so the parent knows
  // what this is. Each row is its own scroll region — swiping
  // right on a branch row scrolls the skills, NOT the page.
  const icon = branchIcon(branch.branchName, className);
  const calitreeFile = calitreeIconFor(branch.branchName);
  const unlockedCount = branch.skills.filter((s) => s.unlocked).length;
  const total = branch.skills.length;
  const allDone = unlockedCount === total;
  return (
    <div
      data-branch={branch.branchName}
      className="flex flex-row items-center gap-2 min-w-fit"
    >
      {/* Branch label column — fixed-width on the LEFT of the row.
          Holds the icon + name + progress, all stacked vertically.
          On mobile and desktop this label has the same size so the
          rows align vertically and feel like a list. */}
      <div
        className="shrink-0 w-20 flex flex-col items-center gap-1 py-2 pr-2 border-r border-ink-700/30"
        style={{ minHeight: '64px' }}
      >
        <div
          className={classNames(
            // text-[28px] so the hand-coded SVG label icons (1em)
            // match the 28px (w-7) calitree PNG label icons.
            'text-[28px] leading-none',
            allDone ? 'text-neon-lime' : classColorForClass(className),
            'transition-colors duration-200',
          )}
        >
          {calitreeFile ? (
            <i
              aria-hidden
              className="block w-7 h-7 select-none"
              style={{
                WebkitMaskImage: `url(/icons/calitree/${calitreeFile}.png)`,
                maskImage: `url(/icons/calitree/${calitreeFile}.png)`,
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                backgroundColor: 'currentColor',
                filter: allDone
                  ? 'drop-shadow(0 0 4px #56e88e)'
                  : 'drop-shadow(0 0 3px currentColor)',
              }}
            />
          ) : (
            <span className="block">{icon}</span>
          )}
        </div>
        <div className="text-[9px] font-mono uppercase tracking-widest text-neon-cyan/80 truncate w-full text-center">
          {branch.branchName}
        </div>
        <div
          className={classNames(
            'text-[9px] font-mono',
            allDone ? 'text-neon-lime' : 'text-ink-400',
          )}
        >
          {unlockedCount}/{total}
        </div>
      </div>
      {/* HORIZONTAL scroll region for the skills. The chain
          flows left-to-right. `overflow-x-auto` lets the user
          swipe right to reveal the T3 god-tier skills that
          overflow on narrow viewports. Each branch has its own
          scroll region, so a horizontal swipe on one branch
          doesn't move its siblings. Right-edge gradient hint at
          the end shows there's more to scroll to. */}
      <div
        className="relative flex-1 overflow-x-auto overflow-y-hidden"
        data-branch-chain={branch.branchName}
      >
        <div className="flex flex-row items-stretch gap-1.5 px-2 py-2 min-w-fit">
          {branch.skills.map((s, idx) => {
            const isLast = idx === branch.skills.length - 1;
            // "God-tier" means the skill is at the highest tier in
            // its branch. For most branches that's TIER_3 (the
            // default) but for Holds / Strongman / Sandbag /
            // Mobility the max tier is TIER_4 or TIER_5 (see
            // BRANCH_MAX_TIER). The branch.tier field carries the
            // max for that branch, computed by buildBranches.
            const isGodTier = isLast && s.tier === branch.tier;
            return (
              <div
                key={s.id}
                // items-start (NOT items-center): top-align the node
                // and its connector so the icon's Y position depends
                // only on the fixed-height segments ABOVE it (tier
                // label + gap), never on the total button height.
                // items-center re-introduced per-node vertical drift
                // whenever button heights differed.
                className="flex flex-row items-start"
              >
                <SkillNode
                  skill={s}
                  className={className}
                  onClick={() => onSkillClick(s)}
                  isUnlocked={s.unlocked}
                  isGodTier={isGodTier}
                />
                {/* Connector line — short horizontal bar between
                    nodes. The chain wrapper is top-aligned
                    (items-start), so the icon center sits at a
                    constant y=44 from the top of every node: tier
                    label 10 + gap 6 + half the 56px circle 28 =
                    44. mt-[43px] puts this 2px bar's center
                    exactly there (43 + 1 = 44). Measured from the
                    TOP, so — unlike the old center-then-translate
                    approach — it holds no matter how tall the
                    button is or how the skill name wraps. */}
                {!isLast && (
                  <div
                    className={classNames(
                      'h-0.5 w-5 mx-0.5 mt-[43px]',
                      s.unlocked && branch.skills[idx + 1].unlocked
                        ? 'bg-gradient-to-r from-neon-lime/60 to-neon-lime/30'
                        : 'bg-gradient-to-r from-ink-500/40 to-ink-500/10',
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Right-edge fade — hint at "more to the right" */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-bg-900/60 to-transparent" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Layout hint — small "→ scroll right for god-tier" line that
 * appears above the tree on narrow viewports where the T3
 * god-tier skills would otherwise be clipped. Hidden on desktop
 * where the per-branch chain usually fits. The hint is purely
 * a one-time visible affordance — there's no active state or
 * scroll listener; once the user starts scrolling each branch's
 * own overflow-x-auto region, the right-edge gradient inside
 * the branch takes over.
 */
function TreeScrollHint() {
  return (
    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 text-center py-1">
      scroll right inside a branch for god-tier skills →
    </div>
  );
}

export function SkillTreePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Skill | null>(null);
  // Ref to the horizontal-scroll container so the dot indicator
  // (BranchScrollIndicator below) can compute which branch is
  // currently scrolled into view. Using a ref (not state) so the
  // scroll handler doesn't cause the whole tree to re-render on
  // every pixel of touch movement.
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  // Pending-unlock queue — populated on mount from /skills/pending-unlocks
  // and consumed one modal at a time. FIFO so the user sees their
  // oldest eligibility first.
  const [pendingQueue, setPendingQueue] = useState<PendingUnlock[] | null>(null);
  const [activePending, setActivePending] = useState<PendingUnlock | null>(null);

  const treeQ = useQuery({
    queryKey: ['skills', 'tree'],
    queryFn: () => api<TreeResponse>('/skills/tree'),
  });

  // Fetch the pending-unlock inbox on mount. The matching pass
  // runs on the server (workout commit + manual /check-eligible
  // button), so this is a pure read. After consuming an item we
  // re-fetch to keep the queue in sync.
  const pendingQ = useQuery({
    queryKey: ['skills', 'pending-unlocks'],
    queryFn: () => api<{ items: PendingUnlock[] }>('/skills/pending-unlocks'),
    enabled: !!user?.class,
  });

  // Once the query resolves, seed the local queue and surface the
  // first item. We intentionally only set state on the first
  // transition from null → populated so the user's in-flight modal
  // doesn't get yanked out from under them when the query
  // re-fetches after a resolve / dismiss.
  useEffect(() => {
    if (pendingQ.data && pendingQueue === null) {
      const items = pendingQ.data.items;
      setPendingQueue(items);
      setActivePending(items[0] ?? null);
    }
  }, [pendingQ.data, pendingQueue]);

  const branches = useMemo(
    () => (treeQ.data ? buildBranches(treeQ.data.items, treeQ.data.className) : []),
    [treeQ.data],
  );

  // Helper: advance the queue after the user resolves the active
  // modal (either unlock or dismiss). The new head of the queue
  // becomes the next modal.
  function advanceQueue() {
    setActivePending(null);
    setPendingQueue((q) => {
      if (!q || q.length === 0) return q;
      const [, ...rest] = q;
      setActivePending(rest[0] ?? null);
      return rest;
    });
  }

  const unlockM = useMutation({
    mutationFn: (vars: { skillId: string; result?: Record<string, number>; pendingUnlockId?: string }) =>
      api<{
        ok: boolean;
        reason?: string;
        reward?: { xp: number; gold: number };
        newXp?: number;
        newGold?: number;
        newLevel?: number;
        leveledUp?: boolean;
      }>('/skills/unlock', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['skills', 'tree'] });
        qc.invalidateQueries({ queryKey: ['skills', 'pending-unlocks'] });
        // Surface the XP + level-up rewards via the global overlay
        // so the user actually sees the payoff of unlocking a
        // skill. The server already returns the numbers — we just
        // have to wire them through. Without this the unlock modal
        // closed silently and the only feedback was the tree node
        // lighting up a second later, which felt like nothing
        // happened.
        const xp = res.reward?.xp ?? 0;
        const gold = res.reward?.gold ?? 0;
        if (xp > 0 || gold > 0) {
          emitReward({
            kind: 'xp',
            id: nextRewardId('skill-xp'),
            amount: xp,
            source: `skill unlock · +${gold}g`,
          });
        }
        if (res.leveledUp && res.newLevel != null) {
          emitReward({
            kind: 'levelUp',
            id: nextRewardId('skill-lvl'),
            level: res.newLevel,
            previousLevel: res.newLevel - 1,
          });
          playSoundAndNotify('levelUp');
        }
        // Skill-unlock sound — the meme. Fires on every successful
        // unlock (manual or auto). Mute state from Settings →
        // Sound applies. playSound() is fire-and-forget so we
        // don't block the modal close.
        playSoundAndNotify('skillUnlock');
        setSelected(null);
        setUnlockError(null);
      } else {
        // Server returned ok: false (e.g. test not met). Surface
        // the reason in the modal so the user can fix the input.
        setUnlockError(res.reason ?? 'Unlock failed');
      }
    },
    onError: (e: Error) => {
      // Real network / 400 (prereq missing, test not met, etc.).
      // Previously this was console.error only — the modal closed
      // and the user assumed the request hung. Surface the
      // message inline.
      if (e instanceof ApiError) {
        setUnlockError(e.message);
      } else {
        setUnlockError('Network error — try again');
      }
    },
  });
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Clear the unlock error whenever the user opens a different
  // skill modal — otherwise a stale "Needs ≥3 reps" from the
  // previous skill would carry over.
  useEffect(() => {
    setUnlockError(null);
  }, [selected?.id]);

  if (!user) return null;
  if (!user.class) {
    return (
      <Layout>
        <PageHeader title="// Skill Tree" subtitle="Pick a class to unlock your tree." />
        <Panel>
          <div className="text-sm font-mono text-ink-200 py-4">
            Go to <a href="/profile" className="text-neon-cyan">/profile</a> and pick a class to unlock your skill tree.
          </div>
        </Panel>
      </Layout>
    );
  }

  if (treeQ.isLoading) {
    return (
      <Layout>
        <PageHeader title="// Skill Tree" subtitle={`${user.class} class`} />
        <Panel>
          <div className="text-sm text-ink-400 font-mono py-4">Loading skill tree…</div>
        </Panel>
      </Layout>
    );
  }

  if (treeQ.isError || !treeQ.data) {
    return (
      <Layout>
        <PageHeader title="// Skill Tree" subtitle={`${user.class} class`} />
        <Panel>
          <div className="text-sm text-rose-300 font-mono py-4">Failed to load skill tree.</div>
        </Panel>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageHeader
        title="// Skill Tree"
        subtitle={`${user.class} class · ${branches.length} branches · ${treeQ.data.items.length} skills · pass the test to unlock`}
      />

      {/* Tree view — all 7 branches visible AT ONCE on the left,
          stacked top-to-bottom. Each branch row scrolls
          HORIZONTALLY within itself to reveal its T3 god-tier
          skills. This is the calitree.app-style layout:
            ┌───────────────────────────────────────────┐
            │ BRANCH LABEL │  T1  ─  T2  ─  T3  ─  T3   │
            │              └──────────────────────────→
            └───────────────────────────────────────────┘
            All 7 rows visible on the screen at once; only the
            horizontal direction scrolls. */}
      <div
        ref={treeScrollRef}
        className={classNames(
          'relative flex flex-col gap-2 px-2 pb-2',
        )}
      >
        <TreeScrollHint />
        {branches.map((b) => (
          <BranchColumn key={b.branchName} branch={b} className={treeQ.data.className} onSkillClick={setSelected} />
        ))}
      </div>

      {/* Legend */}
      <Panel variant="cyan" className="mt-4">
        <div className="text-[10px] font-mono text-ink-300 flex flex-wrap gap-x-5 gap-y-2 items-center">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-neon-lime bg-neon-lime/10" />
            Unlocked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-ink-500/40 bg-bg-800/60" />
            Locked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-neon-amber bg-neon-amber/10" />
            ★ God-tier (final T3 milestone of a branch)
          </span>
          <span className="text-ink-400">
            Click any node to see the test (blurb + how-to + safety)
            and submit your result.
          </span>
        </div>
      </Panel>

      {/* Unlock modal */}
      {selected && (
        <UnlockModal
          skill={selected}
          unlockedNames={new Set(
            (treeQ.data?.items ?? []).filter((s) => s.unlocked).map((s) => s.name),
          )}
          unlockError={unlockError}
          onClose={() => setSelected(null)}
          onUnlock={(result) =>
            unlockM.mutate({ skillId: selected.id, result })
          }
          isPending={unlockM.isPending}
        />
      )}

      {/* Pending-unlock queue — one modal at a time, FIFO. The
          active modal renders on top of the tree; the rest of
          the UI stays interactive underneath so the user can
          dismiss the modal without losing scroll position on
          the page. After resolve/dismiss, the next item in the
          queue surfaces automatically. */}
      {activePending && (
        <PendingUnlockModal
          pending={activePending}
          totalInQueue={pendingQueue?.length ?? 0}
          onClose={() => {
            setActivePending(null);
            // If the user dismisses without resolving, drop
            // the item server-side too — otherwise it'd re-queue
            // on every page load.
            if (activePending) {
              api(`/skills/pending-unlocks/${activePending.id}/dismiss`, {
                method: 'POST',
              }).catch(() => { /* swallow — non-critical */ });
            }
            advanceQueue();
          }}
          onUnlock={async () => {
            await unlockM.mutateAsync({
              skillId: activePending.skillId,
              pendingUnlockId: activePending.id,
            });
            advanceQueue();
          }}
          isPending={unlockM.isPending}
        />
      )}
    </Layout>
  );
}

/**
 * Pending-unlock confirmation modal. Renders when the user has
 * at least one PENDING PendingSkillUnlock in their inbox. Shows
 * the matched set details (reps × weight, exercise name, date)
 * so the user can verify the match before clicking Unlock.
 *
 * Close (X) dismisses server-side. Unlock calls /skills/unlock
 * with the pendingUnlockId — the server uses the snapshotted
 * set as the unlock result and marks the row UNLOCKED.
 */
function PendingUnlockModal({
  pending,
  totalInQueue,
  onClose,
  onUnlock,
  isPending,
}: {
  pending: PendingUnlock;
  totalInQueue: number;
  onClose: () => void;
  onUnlock: () => Promise<void> | void;
  isPending: boolean;
}) {
  const tierShort = pending.tier.replace('TIER_', 'T');
  const test = pending.test;
  // Format the set details for display. Default to '-' when the
  // matched set has no value for the metric (e.g. duration for a
  // reps-based test).
  const setDetails: string[] = [];
  if (pending.matchedSet.reps != null) setDetails.push(`${pending.matchedSet.reps} reps`);
  if (pending.matchedSet.weight != null && pending.matchedSet.weight > 0) {
    setDetails.push(`${pending.matchedSet.weight.toFixed(1)} kg`);
  }
  if (pending.matchedSet.duration != null) {
    setDetails.push(`${pending.matchedSet.duration}s`);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Skill ready to unlock!"
      width="max-w-lg"
    >
      <div className="space-y-3">
        {/* Skill header */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl neon-text-lime">
            {pending.skillName}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
            {tierShort}{pending.branch ? ` · ${pending.branch}` : ''}
          </span>
        </div>
        {pending.blurb && (
          <div className="text-sm text-ink-200 italic">{pending.blurb}</div>
        )}

        {/* Matched set details — the "this is what you did" callout.
            Same idea as the Locked view's prerequisite list:
            show enough info for the user to verify the match
            without re-doing the test. */}
        <div className="border border-neon-lime/30 bg-neon-lime/5 p-2 text-xs font-mono text-ink-100">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-neon-lime uppercase tracking-widest text-[10px]">Matched set</span>
            <span className="text-ink-400 text-[10px]">
              {new Date(pending.matchedSet.workoutDate).toLocaleDateString()}
            </span>
          </div>
          <div className="mt-1">
            <span className="text-ink-200">{pending.matchedSet.exerciseName}</span>
            {setDetails.length > 0 && (
              <span className="text-ink-300 ml-2">
                · {setDetails.join(' · ')}
              </span>
            )}
          </div>
        </div>

        {/* Test description — same shape as the manual UnlockModal
            so the user sees the full context. */}
        {test && (
          <div className="text-sm text-ink-100">{test.description}</div>
        )}
        {test?.safety && (
          <div className="border border-amber-500/40 bg-amber-500/5 p-2 text-xs font-mono text-amber-200">
            <span className="uppercase tracking-widest mr-2 text-amber-300">SAFETY</span>
            {test.safety}
          </div>
        )}
        {test && (
          <div className="text-xs font-mono text-ink-400">
            Threshold: <span className="text-ink-200">{JSON.stringify(test.threshold)}</span>
          </div>
        )}

        {/* Queue position — lets the user know whether more
            modals are coming after this one. */}
        {totalInQueue > 1 && (
          <div className="text-[10px] font-mono text-ink-400">
            1 of {totalInQueue} eligible unlocks in your queue.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <NeonButton variant="cyan" onClick={onClose} disabled={isPending}>
            Not yet
          </NeonButton>
          <NeonButton
            variant="lime"
            loading={isPending}
            onClick={() => onUnlock()}
          >
            Unlock
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
