import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { WorkoutLogger } from '@/components/WorkoutLogger';
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

/**
 * Filter UI for the history panel. Toggles between "All",
 * "Ambient" (random shield drops) and "Breach" (escaped from
 * the Breach world). The query refilters via the API endpoint
 * — no client-side filtering of an unfiltered list.
 */
function HistoryFilterToggle({
  value,
  onChange,
}: {
  value: 'ALL' | 'AMBIENT' | 'BREACH';
  onChange: (v: 'ALL' | 'AMBIENT' | 'BREACH') => void;
}) {
  const opts: Array<{ key: 'ALL' | 'AMBIENT' | 'BREACH'; label: string }> = [
    { key: 'ALL',     label: 'All' },
    { key: 'AMBIENT', label: 'Ambient' },
    { key: 'BREACH',  label: 'Breach' },
  ];
  return (
    <div className="flex gap-1 mb-2">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border ${
            value === o.key
              ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
              : 'border-ink-500/40 text-ink-300 hover:border-ink-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PortalLeakPage() {
  const qc = useQueryClient();
  const leakQ = useQuery({
    queryKey: ['portal-leak'],
    queryFn: () => api<PortalLeakResponse>('/portal-leak'),
    refetchInterval: 60_000,
  });

  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'AMBIENT' | 'BREACH'>('ALL');
  const historyQ = useQuery({
    queryKey: ['portal-leak', 'history', historyFilter],
    queryFn: () => api<{ items: PortalLeakData[] }>(
      historyFilter === 'ALL'
        ? '/portal-leak/history'
        : `/portal-leak/history?source=${historyFilter}`,
    ),
  });

  // Stacking — multiple leaks can be active at once. We render
  // them as a list, oldest-first. The user picks which to attack.
  const activeLeaks = leakQ.data?.leaks ?? [];
  const firstLeak = activeLeaks[0]?.leak ?? null;
  const [attackingLeakId, setAttackingLeakId] = useState<string | null>(null);

  return (
    <Layout>
      <PageHeader
        title={`// Portal Leaks${activeLeaks.length > 1 ? ` (× ${activeLeaks.length})` : ''}`}
        subtitle={
          activeLeaks.length > 1
            ? `You have ${activeLeaks.length} leaks stacked. Each shield-drop rolled the dice. Pick one to fight — the others queue behind it.`
            : '1-shot home-base encounters. Match the leak\'s preferred muscles in your workouts to deal damage and claim loot.'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Active leaks (stacking). Oldest first. */}
        <div className="space-y-3">
          {activeLeaks.length === 0 ? (
            <ActiveLeakCard
              leak={null}
              recent={[]}
              onChange={() => qc.invalidateQueries({ queryKey: ['portal-leak'] })}
              attackOpen={false}
              setAttackOpen={() => {}}
            />
          ) : (
            <>
              {activeLeaks.length > 1 && (
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 border-l-2 border-neon-magenta/40 pl-2">
                  Queue ({activeLeaks.length} stacked)
                </div>
              )}
              {activeLeaks.map((entry, idx) => (
                <ActiveLeakCard
                  key={entry.leak.id}
                  leak={entry.leak}
                  recent={entry.recent}
                  onChange={() => qc.invalidateQueries({ queryKey: ['portal-leak'] })}
                  attackOpen={attackingLeakId === entry.leak.id}
                  setAttackOpen={(b) => setAttackingLeakId(b ? entry.leak.id : null)}
                  queueIndex={idx + 1}
                  queueTotal={activeLeaks.length}
                />
              ))}
            </>
          )}
        </div>

        {/* History */}
        <Panel variant="cyan" title="Recent leaks">
          <HistoryFilterToggle value={historyFilter} onChange={setHistoryFilter} />
          {historyQ.isLoading && (
            <div className="text-[10px] font-mono text-ink-400">loading history…</div>
          )}
          {historyQ.data && historyQ.data.items.length === 0 && (
            <div className="text-[11px] font-mono text-ink-400 italic">
              {historyFilter === 'BREACH'
                ? 'No Breach leaks resolved yet. Defeat The Maw to spawn them.'
                : historyFilter === 'AMBIENT'
                ? 'No ambient leaks resolved yet.'
                : 'No resolved leaks yet. Once you seal one, it shows up here for posterity.'}
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

      {/* Attack-the-leak modal. Opens from the ActiveLeakCard's
          "Log a workout to attack" button. Auto-fires the leak
          damage endpoint on commit and closes. */}
      {attackingLeakId && (
        <AttackLeakModal
          open={!!attackingLeakId}
          onClose={() => setAttackingLeakId(null)}
          leakId={attackingLeakId}
          onDamage={() => {
            qc.invalidateQueries({ queryKey: ['portal-leak'] });
            setAttackingLeakId(null);
          }}
        />
      )}
    </Layout>
  );
}

function ActiveLeakCard({
  leak,
  recent,
  onChange,
  attackOpen,
  setAttackOpen,
  queueIndex,
  queueTotal,
}: {
  leak: PortalLeakData | null;
  recent: PortalLeakResponse['recent'];
  onChange: () => void;
  attackOpen: boolean;
  setAttackOpen: (b: boolean) => void;
  queueIndex?: number;
  queueTotal?: number;
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
          {queueIndex && queueTotal && queueTotal > 1 && (
            <span className="text-[9px] font-mono uppercase tracking-widest px-1 py-px border border-neon-cyan/40 text-neon-cyan/80">
              #{queueIndex} of {queueTotal}
            </span>
          )}
          {leak.worldSource === 'BREACH' && (
            <span
              className="text-[9px] font-mono uppercase tracking-widest px-1 py-px border border-violet-400/70 text-violet-300/90 bg-violet-500/10"
              title="Escaped from the Breach world when the Maw was defeated"
            >
              breach
            </span>
          )}
          <span className="text-[10px] font-mono text-ink-400 ml-2">
            [{leak.status}]
          </span>
        </div>
      }
    >
      <PortalLeakBody leak={leak} pct={pct} recent={recent} />
      <div className="border-t border-ink-700/30 mt-3 pt-3 flex flex-wrap gap-2">
        {leak.status === 'ACTIVE' && (
          <NeonButton variant="cyan" size="sm" onClick={() => setAttackOpen(true)}>
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

/**
 * AttackLeakModal — opens the WorkoutLogger inline. On commit, fire
 * the leak-damage endpoint (best-effort) and close. If the user
 * closes the modal without committing, the leak is untouched.
 */
function AttackLeakModal({
  open,
  onClose,
  leakId,
  onDamage,
}: {
  open: boolean;
  onClose: () => void;
  leakId: string;
  onDamage: (workoutId: string) => void;
}) {
  const { user } = useAuth();
  return (
    <Modal open={open} onClose={onClose} title="Log workout to attack leak" width="max-w-3xl" hideCloseButton>
      <WorkoutLogger
        user={user}
        units={user?.units ?? 'METRIC'}
        onCommit={(workoutId) => {
          // Apply leak damage now that the workout is committed.
          // Fire-and-forget — the leak-damage endpoint is best-effort
          // and the user already saved their workout regardless.
          api<{ skipped?: boolean; reason?: string }>(
            `/workouts/${workoutId}/leak-damage`,
            { method: 'POST' },
          )
            .then(() => onDamage(workoutId))
            .catch(() => onDamage(workoutId));
          onClose();
        }}
      />
    </Modal>
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
        {leak.worldSource === 'BREACH' && (
          <span className="text-[8px] font-mono uppercase tracking-widest px-1 py-px border border-violet-400/60 text-violet-300/80">
            breach
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
        <span className={color}>{leak.status}</span>
        <span className="text-ink-400">{date}</span>
        <span className="text-ink-500">hp {leak.hp}/{leak.maxHp}</span>
      </div>
    </div>
  );
}