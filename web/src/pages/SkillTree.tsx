import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { buildBranches } from '@/lib/skillTreeLayout';
import { SkillTreeCanvas } from '@/components/SkillTreeCanvas';
import { emitReward, nextRewardId } from '@/components/RewardOverlay';
import { playSoundAndNotify } from '@/lib/soundBus';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
/**
 * SkillTree v1 — replaces the old /skills page.
 *
 * Renders the calitree.app-style vertical-chain tree for the user's
 * current class. The page used to render each branch as its own
 * horizontally-scrolling row; that has been replaced by a single
 * shared-coordinate-space canvas (see @/components/SkillTreeCanvas)
 * so cross-branch prerequisite connectors can be drawn cleanly,
 * plus an isolated zoom control.
 *
 * Unlocked nodes are lit; locked nodes are faded with a "?" symbol.
 * Click a node for the unlock modal which has:
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
        {test?.safety && (
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

export function SkillTreePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Skill | null>(null);
  // Pending-unlock queue — populated on mount from /skills/pending-unlocks
  // and consumed one modal at a time. FIFO so the user sees their
  // oldest eligibility first.
  const [pendingQueue, setPendingQueue] = useState<PendingUnlock[] | null>(null);
  const [activePending, setActivePending] = useState<PendingUnlock | null>(null);

  // Pull-to-refresh: invalidate the tree + the pending-unlock
  // inbox so newly-eligible skills (which the matching pass adds
  // server-side after each workout commit) show up without a
  // full page reload. Declared before the early-return state
  // branches (no class / loading / error) so hook ordering is
  // stable across renders; the visual indicator only renders on
  // the main return branch where the PageHeader actually appears.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['skills', 'tree'] });
      qc.invalidateQueries({ queryKey: ['skills', 'pending-unlocks'] });
    },
  });

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

  // Build branches for the subtitle count. SkillTreeCanvas re-runs
  // buildBranches internally via computeLayout, so this is a cheap
  // duplicate pass — but it lets the PageHeader show "N branches"
  // without coupling to the canvas's internal data flow.
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

  // Snapshot the unlocked skill names — consumed by both the
  // canvas (for connector coloring) and the UnlockModal (for the
  // "Locked" prereq gating). Computed once per tree-data update.
  const unlockedNames = new Set(
    treeQ.data.items.filter((s) => s.unlocked).map((s) => s.name),
  );

  return (
    <Layout>
      <PageHeader
        title="// Skill Tree"
        subtitle={`${user.class} class · ${branches.length} branches · ${treeQ.data.items.length} skills · pass the test to unlock`}
        action={<PullToRefreshIndicator
          pulledPx={pulledPx}
          refreshing={refreshing}
        />}
      />

      {/* Shared-coordinate-space tree canvas. All branches render
          in one absolutely-positioned coordinate system; cross-
          branch prerequisite connectors are drawn as SVG bezier
          curves on top of the node layer. The zoom controls are
          scoped to this canvas only — nothing else in the app
          exposes zoom. */}
      <div className="px-2 pb-2">
        <SkillTreeCanvas
          items={treeQ.data.items}
          className={treeQ.data.className}
          onSkillClick={setSelected}
          unlockedNames={unlockedNames}
        />
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
            ★ God-tier (final god-tier milestone of a branch)
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
          unlockedNames={unlockedNames}
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
