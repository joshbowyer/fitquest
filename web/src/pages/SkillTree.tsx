import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { classNames } from '@/lib/format';
import { NeonButton } from '@/components/NeonButton';
import { branchIcon, calitreeIconFor } from '@/lib/skillIcons';
import { CLASS_META } from '@/lib/types';

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

type Skill = {
  id: string;
  name: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  // Branch label (e.g. JUGGERNAUT "Squat", PHANTOM "Pull") as
  // stored on the Skill row. The page groups skills by this field.
  // Pre-v1 leftover skills have null and fall into the "Other"
  // column at the end.
  branch: string | null;
  blurb: string | null;
  description: string;
  position: number;
  cost: number;
  prerequisites: string[];
  test: SkillTest | null;
  effects: unknown;
  unlocked: boolean;
};

type TreeResponse = {
  className: string;
  skillPoints: number;
  items: Skill[];
};

// ---- Branch grouping ----
// The Skill model carries an explicit `branch` field set by the
// seed (one of the canonical labels per class). Group skills by
// that field directly — no name-prefix inference needed. Skills
// with a null branch (pre-v1 leftovers) go to "Other".

type Branch = {
  branchName: string;
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  skills: Skill[];
};

// Canonical branch order per class. Used to sort columns in the
// correct left-to-right order. Any new branch label returned from
// the server that isn't in this list gets appended after the known
// ones.
const BRANCH_ORDER_BY_CLASS: Record<string, string[]> = {
  JUGGERNAUT: ['Squat', 'Press', 'Deadlift', 'Overhead Press', 'Strongman', 'Sled'],
  PHANTOM: ['Push', 'Pull', 'Holds', 'Rings', 'Handstand', 'Planche'],
  SCOUT: ['Run', 'Ruck', 'Triathlon'],
  BERSERKER: ['Sled', 'Kettlebell', 'Hero WODs', 'Boxing', 'Capacity', 'Mace / Indian Club'],
  TRACER: ['Sprint', 'Plyo', 'Parkour', 'Agility', 'Throws'],
  ORACLE: ['Mobility', 'Breath', 'Balance', 'Mindfulness', 'Yoga', 'Pilates'],
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
  return sortedBranches.map((b) => ({ ...b, tier: b.skills[0]?.tier ?? 'TIER_1' }));
}

// ---- Result-input component for each metric type ----

function ResultInput({
  metric,
  onChange,
}: {
  metric: string;
  onChange: (v: Record<string, number>) => void;
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
  onClose,
  onUnlock,
  isPending,
}: {
  skill: Skill;
  onClose: () => void;
  onUnlock: (result: Record<string, number>) => void;
  isPending: boolean;
}) {
  const [result, setResult] = useState<Record<string, number>>({});
  const test = skill.test;

  if (!test) {
    // Pre-v1 skill (no test). No validation; just unlock.
    return (
      <Modal open onClose={onClose} title={`Unlock: ${skill.name}`} width="max-w-lg">
        <p className="text-sm text-ink-200 mb-4">
          This is a legacy skill (pre-SkillTree v1) without a defined
          test. The unlock costs {skill.cost} SP.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <NeonButton variant="cyan" onClick={onClose}>Cancel</NeonButton>
          <NeonButton
            variant="lime"
            loading={isPending}
            onClick={() => onUnlock({})}
          >
            Unlock for {skill.cost} SP
          </NeonButton>
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
            onChange={(v) => setResult((p) => typeof v === 'function' ? (v as (p: typeof p) => typeof p)(p) : { ...p, ...v } as typeof p)}
          />
        </div>
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
  const icon = branchIcon(skill.branch, className);
  // Calitree.app-style icon for branches that have a direct
  // calisthenics analog. null → fall through to the hand-coded
  // SVG above (covers heavy barbell / sled / boxing / mace / etc.
  // where calitree.app doesn't have a node).
  const calitreeFile = calitreeIconFor(skill.branch);
  const tierShort = skill.tier.replace('TIER_', 'T');
  return (
    <button
      onClick={onClick}
      aria-label={`${skill.name} (${skill.tier}${isGodTier ? ' god-tier' : ''})`}
      className={classNames(
        'group flex flex-col items-center gap-1.5 outline-none',
        'focus-visible:ring-2 focus-visible:ring-neon-cyan/60 rounded-lg',
      )}
    >
      {/* Tier label */}
      <div
        className={classNames(
          'text-[8px] font-display tracking-widest uppercase',
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
          'text-2xl transition-all duration-200',
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
              'block w-9 h-9 select-none transition-all duration-200',
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
      {/* Skill name */}
      <div
        className={classNames(
          'text-[9px] font-display tracking-wide text-center max-w-[110px]',
          'leading-tight line-clamp-2',
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
  const icon = branchIcon(branch.branchName, className);
  const calitreeFile = calitreeIconFor(branch.branchName);
  const unlockedCount = branch.skills.filter((s) => s.unlocked).length;
  const total = branch.skills.length;
  const allDone = unlockedCount === total;
  return (
    <div className="flex flex-col gap-3 min-w-[140px] flex-1">
      {/* Branch header — centered icon + name + progress */}
      <div className="flex flex-col items-center gap-1 pb-2 border-b border-ink-700/30">
        {calitreeFile ? (
          // Same mask-image approach as the per-skill nodes. The
          // column header icon picks up the user's class color
          // (lime for PHANTOM, magenta for BERSERKER, etc.) so each
          // class's tree has a distinct header palette.
          <i
            aria-hidden
            className={classNames(
              'block w-8 h-8 select-none',
              allDone
                ? 'text-neon-lime'
                : classColorForClass(className),
            )}
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
          <div className="text-3xl leading-none">{icon}</div>
        )}
        <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
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
      {/* Vertical chain — circles connected by short gradient lines */}
      <div className="flex flex-col items-center gap-0">
        {branch.skills.map((s, idx) => {
          const isLast = idx === branch.skills.length - 1;
          const isGodTier = isLast && s.tier === 'TIER_3';
          return (
            <div key={s.id} className="flex flex-col items-center">
              <SkillNode
                skill={s}
                className={className}
                onClick={() => onSkillClick(s)}
                isUnlocked={s.unlocked}
                isGodTier={isGodTier}
              />
              {/* Connector line — short gradient bar between nodes */}
              {!isLast && (
                <div
                  className={classNames(
                    'w-0.5 h-5 my-0.5',
                    s.unlocked && branch.skills[idx + 1].unlocked
                      ? 'bg-gradient-to-b from-neon-lime/60 to-neon-lime/30'
                      : 'bg-gradient-to-b from-ink-500/40 to-ink-500/10',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SkillTreePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Skill | null>(null);

  const treeQ = useQuery({
    queryKey: ['skills', 'tree'],
    queryFn: () => api<TreeResponse>('/skills/tree'),
  });

  const branches = useMemo(
    () => (treeQ.data ? buildBranches(treeQ.data.items, treeQ.data.className) : []),
    [treeQ.data],
  );

  const unlockM = useMutation({
    mutationFn: (vars: { skillId: string; result: Record<string, number> }) =>
      api<{ ok: boolean; reason?: string }>('/skills/unlock', {
        method: 'POST',
        body: vars,
      }),
    onSuccess: (res, vars) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['skills', 'tree'] });
        setSelected(null);
      }
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        // Toast via the parent's setError or surface inline
        console.error('Unlock failed:', e.message);
      }
    },
  });

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
        subtitle={`${user.class} class · ${branches.length} branches · ${treeQ.data.items.length} skills · ${treeQ.data.skillPoints} SP available`}
        action={
          <div className="font-mono text-sm flex items-baseline gap-3">
            <span className="text-ink-300 text-xs uppercase tracking-widest">SP</span>
            <span className="text-neon-cyan text-2xl">{treeQ.data.skillPoints}</span>
          </div>
        }
      />

      {/* Tree view — branches as columns, each skill a circular flow node */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4 min-w-fit px-2">
          {branches.map((b) => (
            <BranchColumn key={b.branchName} branch={b} className={treeQ.data.className} onSkillClick={setSelected} />
          ))}
        </div>
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
          onClose={() => setSelected(null)}
          onUnlock={(result) =>
            unlockM.mutate({ skillId: selected.id, result })
          }
          isPending={unlockM.isPending}
        />
      )}
    </Layout>
  );
}
