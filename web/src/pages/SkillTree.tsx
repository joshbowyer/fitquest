import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { classNames } from '@/lib/format';
import { NeonButton } from '@/components/NeonButton';

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

function SkillNode({
  skill,
  onClick,
  isUnlocked,
  isLastTier,
  isOnly,
}: {
  skill: Skill;
  onClick: () => void;
  isUnlocked: boolean;
  isLastTier: boolean;
  isOnly: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'w-full text-left p-2.5 border-2 transition-all',
        isUnlocked
          ? 'bg-neon-lime/10 border-neon-lime shadow-neon-lime cursor-default'
          : 'border-ink-500/30 bg-bg-800/40 hover:border-neon-cyan/40 hover:bg-neon-cyan/5 cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={classNames(
            'text-[9px] font-display tracking-widest uppercase',
            isUnlocked ? 'text-neon-lime' : 'text-ink-400',
          )}
        >
          {skill.tier.replace('_', ' ')}
        </span>
        {isUnlocked ? (
          <span className="text-[10px] font-mono text-neon-lime">✓</span>
        ) : (
          <span className="text-[10px] font-mono text-ink-500">?</span>
        )}
      </div>
      <div
        className={classNames(
          'text-[11px] font-display tracking-wide mt-0.5',
          isUnlocked ? 'text-neon-lime' : 'text-ink-100',
        )}
      >
        {skill.name}
      </div>
      {!isUnlocked && !isOnly && (
        <div className="text-[9px] font-mono text-ink-500 mt-1">
          ↓ {skill.tier === 'TIER_1' ? 'T2' : skill.tier === 'TIER_2' ? 'T3' : 'T1→'}
        </div>
      )}
      {isLastTier && !isUnlocked && (
        <div className="text-[9px] font-mono text-neon-amber mt-1 uppercase tracking-widest">
          ★ god-tier
        </div>
      )}
    </button>
  );
}

function BranchColumn({
  branch,
  onSkillClick,
}: {
  branch: Branch;
  onSkillClick: (skill: Skill) => void;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-[180px] flex-1">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 px-2 py-1 border-b border-ink-700/30">
        {branch.branchName}
      </div>
      <div className="flex flex-col gap-1.5">
        {branch.skills.map((s) => (
          <SkillNode
            key={s.id}
            skill={s}
            onClick={() => onSkillClick(s)}
            isUnlocked={s.unlocked}
            isLastTier={s.tier === 'TIER_3'}
            isOnly={branch.skills.length === 1}
          />
        ))}
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

      {/* Tree view — branches as columns, each skill a vertical node */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-fit">
          {branches.map((b) => (
            <BranchColumn key={b.branchName} branch={b} onSkillClick={setSelected} />
          ))}
        </div>
      </div>

      {/* Legend */}
      <Panel variant="cyan" className="mt-4">
        <div className="text-[10px] font-mono text-ink-300 flex flex-wrap gap-4">
          <span><span className="text-neon-lime">■</span> Unlocked</span>
          <span><span className="text-ink-400">■</span> Locked</span>
          <span><span className="text-neon-amber">★</span> God-tier (final T3 milestone of a branch)</span>
          <span className="text-ink-400">
            Click any skill node to see the test (blurb + how-to + safety)
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
