import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { PortalLeakBody } from '@/components/PortalLeakCard';
import type {
  PortalLeak as PortalLeakData,
  PortalLeakResponse,
} from '@/lib/types';

// =============================================================================
// /portal-leak — full leak management page. Same body component the
// dashboard uses, plus the recent damage feed + history of resolved
// leaks + dismiss controls for cleared encounters.
// =============================================================================

export function PortalLeakPage() {
  const qc = useQueryClient();
  const leakQ = useQuery({
    queryKey: ['portal-leak'],
    queryFn: () => api<PortalLeakResponse>('/portal-leak'),
    refetchInterval: 60_000,
  });

  const historyQ = useQuery({
    queryKey: ['portal-leak', 'history'],
    queryFn: () => api<{ items: PortalLeakData[] }>('/portal-leak/history'),
  });

  const leak = leakQ.data?.leak ?? null;
  const recent = leakQ.data?.recent ?? [];

  return (
    <Layout>
      <PageHeader
        title="// Portal Leaks"
        subtitle="1-shot home-base encounters. Match the leak's preferred muscles in your workouts to deal damage and claim loot."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Current leak */}
        <ActiveLeakCard leak={leak} recent={recent} onChange={() => qc.invalidateQueries({ queryKey: ['portal-leak'] })} />

        {/* History */}
        <Panel variant="cyan" title="Recent leaks">
          {historyQ.isLoading && (
            <div className="text-[10px] font-mono text-ink-400">loading history…</div>
          )}
          {historyQ.data && historyQ.data.items.length === 0 && (
            <div className="text-[11px] font-mono text-ink-400 italic">
              No resolved leaks yet. Once you seal one, it shows up here for posterity.
            </div>
          )}
          {historyQ.data && historyQ.data.items.length > 0 && (
            <div className="space-y-2">
              {historyQ.data.items.map((l) => (
                <HistoryRow key={l.id} leak={l} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Layout>
  );
}

function ActiveLeakCard({
  leak,
  recent,
  onChange,
}: {
  leak: PortalLeakData | null;
  recent: PortalLeakResponse['recent'];
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const dismissM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (leakId) => api(`/portal-leak/${leakId}/dismiss`, { method: 'POST', body: {} }),
    onSuccess: () => onChange(),
  }, 400);

  if (!leak) {
    return (
      <Panel variant="magenta" title="No active leak">
        <div className="space-y-2">
          <div className="text-[11px] font-mono text-ink-200">
            Your home base is quiet. Leaks spawn automatically when the shield drops below COMPROMISED (&lt;60).
          </div>
          <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
            Push the shield down by skipping dailies, missing workouts, or logging too many espressos. Each breach event rolls the spawn dice per tier (FORTIFIED=0, STABLE=5%, COMPROMISED=20%, BREACHED=50%).
          </div>
        </div>
      </Panel>
    );
  }

  const pct = Math.max(0, Math.min(100, (leak.hp / leak.maxHp) * 100));

  return (
    <Panel
      variant={leak.status === 'DEFEATED' ? 'cyan' : 'magenta'}
      title={
        <div className="flex items-center gap-2">
          <span style={{ color: leak.monsterColor }}>{leak.monsterEmoji}</span>
          <span>{leak.monsterName}</span>
          <span className="text-[10px] font-mono text-ink-400 ml-2">
            [{leak.status}]
          </span>
        </div>
      }
    >
      <PortalLeakBody leak={leak} pct={pct} recent={recent} />
      <div className="border-t border-ink-700/30 mt-3 pt-3 flex flex-wrap gap-2">
        {leak.status === 'ACTIVE' && (
          <NeonButton variant="cyan" size="sm" onClick={() => navigate('/activities')}>
            ← Log a workout to attack
          </NeonButton>
        )}
        {leak.status === 'DEFEATED' && (
          <>
            {leak.itemDrop && (
              <ClaimLootButton leakId={leak.id} onClaimed={onChange} />
            )}
            <NeonButton
              variant="magenta"
              size="sm"
              onClick={() => dismissM.run(leak.id)}
              disabled={dismissM.isPending}
              loading={dismissM.isPending}
            >
              Dismiss
            </NeonButton>
          </>
        )}
        {(leak.status === 'OVERWHELMED' || leak.status === 'EXPIRED') && (
          <NeonButton variant="magenta" size="sm" onClick={() => dismissM.run(leak.id)}>
            Dismiss
          </NeonButton>
        )}
      </div>
    </Panel>
  );
}

function ClaimLootButton({
  leakId,
  onClaimed,
}: {
  leakId: string;
  onClaimed: () => void;
}) {
  const claimM = useDelayedMutation<{ item: { name: string; rarity: string } }, string>({
    mutationFn: (id) => api(`/portal-leak/${id}/claim`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      onClaimed();
      // Toast via simple DOM — the loot name surfaces inline below.
      const root = document.getElementById('claim-toast');
      if (root) {
        root.textContent = `✓ Claimed: ${r.item?.name ?? 'item'}`;
        root.classList.remove('text-rose-300');
        root.classList.add('text-neon-lime');
      }
    },
    onError: (e: any) => {
      const root = document.getElementById('claim-toast');
      if (root) {
        root.textContent = e?.message ?? 'Claim failed';
        root.classList.remove('text-neon-lime');
        root.classList.add('text-rose-300');
      }
    },
  }, 500);

  return (
    <NeonButton
      variant="amber"
      size="sm"
      loading={claimM.isPending}
      onClick={() => claimM.run(leakId)}
    >
      Claim loot
    </NeonButton>
  );
}

function HistoryRow({ leak }: { leak: PortalLeakData }) {
  const date = new Date(leak.spawnedAt).toLocaleDateString();
  const color =
    leak.status === 'DEFEATED' ? 'text-neon-lime'
    : leak.status === 'OVERWHELMED' ? 'text-rose-400'
    : leak.status === 'EXPIRED' ? 'text-ink-400'
    : 'text-neon-magenta';
  return (
    <div className="flex items-center justify-between border border-ink-700/30 p-2 rounded">
      <div className="flex items-center gap-2 min-w-0">
        <span style={{ color: leak.monsterColor }}>{leak.monsterEmoji}</span>
        <span className="text-sm truncate">{leak.monsterName}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
        <span className={color}>{leak.status}</span>
        <span className="text-ink-400">{date}</span>
        <span className="text-ink-500">hp {leak.hp}/{leak.maxHp}</span>
      </div>
    </div>
  );
}