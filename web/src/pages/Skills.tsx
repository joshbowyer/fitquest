import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { SkillNode } from '@/components/SkillNode';
import { useAuth } from '@/lib/auth';
import { CLASS_META, type Skill } from '@/lib/types';

export function SkillsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const treeQ = useQuery({
    queryKey: ['skills', 'tree'],
    queryFn: () => api<{ className: string; skillPoints: number; items: Skill[] }>('/skills/tree'),
  });

  const unlockM = useMutation({
    mutationFn: (skillId: string) =>
      api('/skills/unlock', { method: 'POST', body: { skillId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      setErr(null);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to unlock'),
  });

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

  return (
    <Layout>
      <PageHeader
        title="// Skill Tree"
        subtitle={`${cls.label} — ${cls.tagline}`}
        action={
          <div className="font-mono text-sm">
            <span className="text-ink-300 text-xs uppercase tracking-widest">SP Available: </span>
            <span className={`neon-text-${cls.color} text-xl ml-1`}>{tree?.skillPoints ?? 0}</span>
          </div>
        }
      />

      {err && (
        <div className="mb-4 text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
          ! {err}
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
              title={tier.replace('_', ' ')}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((s) => {
                  const prereqMet = s.prerequisites.every((p) => myNames.has(p));
                  return (
                    <SkillNode
                      key={s.id}
                      skill={s}
                      onUnlock={() => unlockM.mutate(s.id)}
                      affordable={(tree?.skillPoints ?? 0) >= s.cost}
                      unlockable={prereqMet && !s.unlocked}
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
