import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { BossBar } from '@/components/BossBar';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { Raid } from '@/lib/types';
import { formatRelative } from '@/lib/format';

const BOSSES = [
  { name: 'Iron Colossus', hp: 5000, emoji: '🗿' },
  { name: 'Cardio Wyrm', hp: 8000, emoji: '🐉' },
  { name: 'The Plateau', hp: 3000, emoji: '⛰' },
  { name: 'Skeletal Minion', hp: 1500, emoji: '💀' },
  { name: 'BPM Demon', hp: 6000, emoji: '👹' },
];

export function PartyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newPartyName, setNewPartyName] = useState('');
  const [bossName, setBossName] = useState('Iron Colossus');
  const [bossHp, setBossHp] = useState(5000);
  const [damage, setDamage] = useState(100);
  const [err, setErr] = useState<string | null>(null);

  const partyQ = useQuery({
    queryKey: ['party', 'me'],
    queryFn: () => api<{ party: any; role: string | null }>('/parties/me'),
  });
  const listQ = useQuery({
    queryKey: ['party', 'list'],
    queryFn: () => api<{ items: any[] }>('/parties/list'),
    enabled: !partyQ.data?.party,
  });
  const raidQ = useQuery({
    queryKey: ['raid', 'active'],
    queryFn: () => api<{ raid: Raid | null }>('/raids/active'),
    refetchInterval: 5000,
  });
  const historyQ = useQuery({
    queryKey: ['raid', 'history'],
    queryFn: () => api<{ items: any[] }>('/raids/history'),
  });

  const createM = useDelayedMutation({
    mutationFn: () => api('/parties', { method: 'POST', body: { name: newPartyName } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['party'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setNewPartyName('');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  }, 1000);
  const joinM = useDelayedMutation({
    mutationFn: (id: string) => api(`/parties/${id}/join`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['party'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  }, 800);
  const leaveM = useDelayedMutation({
    mutationFn: () => api('/parties/leave', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['party'] }),
  }, 800);
  const startRaidM = useDelayedMutation({
    mutationFn: () => api('/raids/start', { method: 'POST', body: { bossName, bossHp } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['raid'] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  }, 1000);
  const contributeM = useDelayedMutation({
    mutationFn: () => {
      const raid = raidQ.data?.raid;
      if (!raid) throw new Error('No active raid');
      return api(`/raids/${raid.id}/contribute`, {
        method: 'POST',
        body: { damage, source: 'workout' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['raid'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  }, 600);

  const party = partyQ.data?.party;
  const role = partyQ.data?.role;
  const raid = raidQ.data?.raid;

  return (
    <Layout>
      <PageHeader title="// Party" subtitle="Co-op raids. Pool your gains." />

      {err && (
        <div className="mb-4 text-xs font-mono text-neon-magenta border border-neon-magenta/30 bg-neon-magenta/5 p-2">
          ! {err}
        </div>
      )}

      {!party ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel variant="cyan" title="Form a Party">
            <div className="space-y-3">
              <input
                className="input-neon"
                placeholder="Party name"
                value={newPartyName}
                onChange={(e) => setNewPartyName(e.target.value)}
              />
                <NeonButton
                  onClick={() => createM.run()}
                  loading={createM.isPending}
                  disabled={newPartyName.length < 2}
                  fullWidth
                  icon="⚑"
                  loadingText="Creating…"
                >
                  Create
                </NeonButton>
            </div>
          </Panel>

          <Panel variant="magenta" title="Available Parties">
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(listQ.data?.items || []).map((p) => (
                <div key={p.id} className="flex items-center justify-between border border-ink-500/30 p-2">
                  <div>
                    <div className="font-display tracking-wider text-neon-cyan">{p.name}</div>
                    <div className="text-[10px] font-mono text-ink-300">{p.memberCount} member{p.memberCount !== 1 ? 's' : ''}</div>
                  </div>
                    <NeonButton
                      variant="magenta"
                      onClick={() => joinM.run(p.id)}
                      loading={joinM.isPending}
                      icon="→"
                      loadingText="Joining…"
                    >
                      Join
                    </NeonButton>
                </div>
              ))}
              {(listQ.data?.items || []).length === 0 && (
                <div className="text-xs text-ink-300 font-mono text-center py-4">
                  No public parties. Be the first.
                </div>
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          {/* Active raid */}
          <Panel variant="magenta" title={`Active Raid`} scanline>
            {raid ? (
              <div className="space-y-4">
                <BossBar
                  bossName={raid.bossName}
                  hp={raid.bossHp}
                  maxHp={raid.bossMaxHp}
                  status={raid.status}
                />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">Damage Log</div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {raid.contributions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs font-mono border-b border-ink-500/20 pb-1">
                        <span className="text-ink-200">{c.user.username} <span className="text-ink-400 text-[10px]">L{c.user.level}</span></span>
                        <span className="neon-text-magenta">−{c.damage}</span>
                        <span className="text-ink-400 text-[10px]">{formatRelative(c.contributedAt)}</span>
                      </div>
                    ))}
                    {raid.contributions.length === 0 && (
                      <div className="text-xs text-ink-300 font-mono text-center py-2">No damage yet.</div>
                    )}
                  </div>
                </div>
                {raid.status === 'ACTIVE' && (
                  <div className="flex items-center gap-2">
                    <input
                      className="input-neon w-32"
                      type="number"
                      value={damage}
                      onChange={(e) => setDamage(Number(e.target.value))}
                      min={1}
                    />
                    <NeonButton
                      variant="magenta"
                      onClick={() => contributeM.run()}
                      loading={contributeM.isPending}
                      icon="⚔"
                      loadingText="Striking…"
                    >
                      Strike
                    </NeonButton>
                  </div>
                )}
                {raid.status === 'VICTORY' && (
                  <div className="text-center text-neon-lime font-display tracking-widest text-lg">
                    ✓ BOSS DEFEATED
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-ink-300 font-mono">No active raid. Start one:</div>
                <div className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">Boss</label>
                    <select
                      className="input-neon"
                      value={bossName}
                      onChange={(e) => {
                        setBossName(e.target.value);
                        const b = BOSSES.find((b) => b.name === e.target.value);
                        if (b) setBossHp(b.hp);
                      }}
                    >
                      {BOSSES.map((b) => (
                        <option key={b.name} value={b.name}>{b.emoji} {b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">HP</label>
                    <input
                      className="input-neon"
                      type="number"
                      value={bossHp}
                      onChange={(e) => setBossHp(Number(e.target.value))}
                    />
                  </div>
                  {(role === 'LEADER' || role === 'OFFICER') ? (
                    <NeonButton
                      onClick={() => startRaidM.run()}
                      loading={startRaidM.isPending}
                      icon="⚔"
                      loadingText="Starting…"
                    >
                      Start
                    </NeonButton>
                  ) : (
                    <span className="text-[10px] text-ink-400 font-mono">leader starts</span>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Party info */}
          <Panel variant="cyan" title={party.name}>
            <div className="space-y-2">
              {party.members.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between border border-ink-500/30 p-2">
                  <div>
                    <div className="font-display tracking-wider text-neon-cyan">
                      {m.user.username}
                    </div>
                    <div className="text-[10px] font-mono text-ink-300">
                      {m.user.class ?? 'unclassed'} · L{m.user.level} · {m.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => leaveM.run()}
              disabled={leaveM.isPending}
              className="btn-ghost mt-3 w-full"
            >
              {leaveM.isPending ? '…' : 'Leave Party'}
            </button>
          </Panel>

          {historyQ.data?.items && historyQ.data.items.length > 0 && (
            <Panel variant="lime" title="Past Raids" className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {historyQ.data.items.map((r) => (
                  <div key={r.id} className="border border-neon-lime/30 p-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="font-display tracking-wider neon-text-lime">{r.bossName}</span>
                      <span className={r.status === 'VICTORY' ? 'neon-text-lime' : 'neon-text-magenta'}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-ink-300 text-[10px] mt-1">
                      {formatRelative(r.startedAt)} · {r.bossMaxHp} HP
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
    </Layout>
  );
}
