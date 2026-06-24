import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { SkillNode } from '@/components/SkillNode';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { CLASS_META, type Skill } from '@/lib/types';

const TIER_LABEL: Record<string, string> = {
  TIER_1: 'Tier 1 — Initiate',
  TIER_2: 'Tier 2 — Adept',
  TIER_3: 'Tier 3 — Master',
};

const TIER_BLURB: Record<string, string> = {
  TIER_1: 'Foundational perks. Always affordable, no prerequisites. Pick these first.',
  TIER_2: 'Build-specific bonuses. Requires one Tier 1 unlocked in the same branch.',
  TIER_3: 'Class-defining ultimates. Requires both Tier 2 nodes to unlock.',
};

export function SkillsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const treeQ = useQuery({
    queryKey: ['skills', 'tree'],
    queryFn: () => api<{ className: string; skillPoints: number; items: Skill[] }>('/skills/tree'),
  });

  const unlockM = useDelayedMutation({
    mutationFn: (skillId: string) =>
      api('/skills/unlock', { method: 'POST', body: { skillId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      setErr(null);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to unlock'),
  }, 1000);

  if (!user) return null;
  if (!user.class) {
    return (
      <Layout>
        <PageHeader title="// Skills" />
        <Panel variant="amber" title="No class selected">
          <div className="text-sm font-mono text-ink-200 py-4">
            Pick a class in your profile to unlock a skill tree.
          </div>
        </Panel>
      </Layout>
    );
  }

  const cls = CLASS_META[user.class];
  const tree = treeQ.data;
  const myNames = new Set((tree?.items || []).filter((s) => s.unlocked).map((s) => s.name));
  const sp = tree?.skillPoints ?? 0;
  const unlockedCount = (tree?.items || []).filter((s) => s.unlocked).length;
  const totalSkills = (tree?.items || []).length;
  const nextAvailable = (tree?.items || []).find(
    (s) => !s.unlocked && s.prerequisites.every((p) => myNames.has(p)) && sp >= s.cost,
  );

  return (
    <Layout>
      <PageHeader
        title="// Skill Tree"
        subtitle={`${cls.label} — ${cls.tagline}`}
        action={
          <div className="font-mono text-sm flex items-baseline gap-3">
            <span className="text-ink-300 text-xs uppercase tracking-widest">SP</span>
            <span className={`neon-text-${cls.color} text-2xl`}>{sp}</span>
            <span className="text-ink-500 text-[10px]">
              · {unlockedCount}/{totalSkills} unlocked
            </span>
          </div>
        }
      />

      {err && (
        <div className="mb-4 text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
          ! {err}
        </div>
      )}

      {/* Class identity banner — explains what this tree is about
          so the user understands the perks before reading details. */}
      <Panel
        variant="cyan"
        title={`${cls.label} path`}
        className="mb-4 border-neon-cyan/40"
      >
        <div className="text-[11px] font-mono text-ink-200 leading-relaxed">
          {cls.description || cls.tagline}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono">
          <span className={`px-2 py-0.5 border border-neon-${cls.color}/50 text-neon-${cls.color} uppercase tracking-widest`}>
            {cls.energySystem}
          </span>
          <span className="px-2 py-0.5 border border-ink-700/40 text-ink-300">
            {cls.fitnessType}
          </span>
          {cls.ability && (
            <span className="px-2 py-0.5 border border-ink-700/40 text-ink-300">
              {cls.ability.tag} · {cls.ability.label}
            </span>
          )}
        </div>
      </Panel>

      {/* Next-up hint — call out the next skill the user can
          afford and has prereqs for. Removes the "where do I
          start?" friction. */}
      {nextAvailable && (
        <div className="mb-4 text-[11px] font-mono text-neon-lime border border-neon-lime/30 bg-neon-lime/5 p-2 flex items-center justify-between gap-2">
          <span>
            ✦ Next unlock available:{' '}
            <span className="font-bold">{nextAvailable.name}</span>{' '}
            <span className="text-ink-400">({nextAvailable.tier.replace('_', ' ')} · SP {nextAvailable.cost})</span>
          </span>
          <button
            type="button"
            onClick={() => unlockM.run(nextAvailable.id)}
            disabled={unlockM.isPending}
            className="px-2 py-0.5 border border-neon-lime text-neon-lime hover:bg-neon-lime/10 text-[10px] uppercase tracking-widest disabled:opacity-50"
          >
            {unlockM.isPending ? '…' : 'Unlock'}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {(['TIER_1', 'TIER_2', 'TIER_3'] as const).map((tier) => {
          const items = (tree?.items || []).filter((s) => s.tier === tier);
          if (!items.length) return null;
          return (
            <Panel
              key={tier}
              variant={tier === 'TIER_1' ? 'cyan' : tier === 'TIER_2' ? 'magenta' : 'amber'}
              title={TIER_LABEL[tier]}
            >
              <div className="text-[10px] font-mono text-ink-400 mb-3 italic">
                {TIER_BLURB[tier]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((s) => {
                  const prereqMet = s.prerequisites.every((p) => myNames.has(p));
                  return (
                  <SkillNode
                    key={s.id}
                    skill={s}
                    onUnlock={() => unlockM.run(s.id)}
                    affordable={sp >= s.cost}
                    unlockable={prereqMet && !s.unlocked}
                    unlocking={unlockM.isPending}
                  />
                  );
                })}
              </div>
            </Panel>
          );
        })}

        {tree && tree.items.length === 0 && (
          <Panel title="Empty">
            <div className="text-xs text-ink-300 font-mono">No skills in this class yet.</div>
          </Panel>
        )}
      </div>
    </Layout>
  );
}
