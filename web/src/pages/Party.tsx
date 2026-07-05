import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { BossBar } from '@/components/BossBar';
import { PetCombatCard } from '@/components/PetCombatCard';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type { Raid } from '@/lib/types';
import { formatRelative } from '@/lib/format';

// Raid bosses are loaded from the API via /raids/bosses.

type RaidBoss = {
  id: string;
  name: string;
  hp: number;
  difficulty: string;
  icon: string;
  description: string;
};

export function PartyPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newPartyName, setNewPartyName] = useState('');
  const [bossId, setBossId] = useState<string>('iron_colossus');
  const [err, setErr] = useState<string | null>(null);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  /// Team-workout launcher state. When the user clicks "Start
  /// team workout" we open the modal; the modal lets them pick
  /// 1-4 participants + an optional routine name.
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamParticipantIds, setTeamParticipantIds] = useState<string[]>([]);
  const [teamRoutineName, setTeamRoutineName] = useState('');

  // Always poll for active team workouts so the banner can show
  // when the user has an invite waiting or a session in progress.
  const teamActiveQ = useQuery({
    queryKey: ['team-workouts', 'active'],
    queryFn: () => api<{ items: any[] }>('/team-workouts/active'),
    refetchInterval: 5000,
  });

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
  // Pet roster — show the deployed companion under the boss bar.
  const petQ = useQuery({
    queryKey: ['pet'],
    queryFn: () =>
      api<{ pets: Array<{
        id: string;
        name: string;
        spritePath: string;
        level: number;
        stage: string;
        currentHp: number;
        maxHp: number;
        attack: number;
        deployed: boolean;
        faintedAt: string | null;
        injuredAt: string | null;
      }> }>('/pet'),
    refetchInterval: 5000,
  });
  const deployedPet = petQ.data?.pets.find((p) => p.deployed) ?? null;

  // Pending invites sent TO me. Always polled so I see them quickly
  // when someone adds me.
  const invitesQ = useQuery({
    queryKey: ['party-invites'],
    queryFn: () => api<{
      invites: Array<{
        id: string;
        partyId: string;
        party: { id: string; name: string };
        inviter: { id: string; username: string; class: string | null; level: number };
        message: string | null;
        createdAt: string;
        expiresAt: string;
      }>;
    }>('/parties/invites'),
    refetchInterval: 5000,
  });

  // Predefined raid bosses
  const bossesQ = useQuery({
    queryKey: ['raid-bosses'],
    queryFn: () => api<{ bosses: RaidBoss[] }>('/raids/bosses'),
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
    mutationFn: () => api('/raids/start', { method: 'POST', body: { bossId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['raid'] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed'),
  }, 1000);

  const sendInviteM = useDelayedMutation<{ invite: unknown }, { username: string; message?: string }>({
    mutationFn: ({ username, message }) =>
      api(`/parties/${party?.id}/invite`, {
        method: 'POST',
        body: { username, message },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['party-invites-sent'] });
      setInviteUsername('');
      setInviteMessage('');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to send invite'),
  }, 800);

  // Team workout launcher: leader-only, picks 1-4 party members
  // and an optional routine name. The session page lives at
  // /team-workout/:id so we navigate after creation.
  const startTeamM = useDelayedMutation<{ id: string }, void>({
    mutationFn: () =>
      api('/team-workouts', {
        method: 'POST',
        body: {
          participantIds: teamParticipantIds,
          routineName: teamRoutineName.trim() || null,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['team-workouts'] });
      setTeamModalOpen(false);
      setTeamParticipantIds([]);
      setTeamRoutineName('');
      // Bounce to the session page so the leader can see the
      // invitation status and the share link.
      window.location.href = `/team-workout/${r.id}`;
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to start'),
  }, 800);

  const toggleParticipant = (id: string) => {
    setTeamParticipantIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 4 ? [...cur, id] : cur,
    );
  };

  const acceptInviteM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/parties/invites/${id}/accept`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['party-invites'] });
      qc.invalidateQueries({ queryKey: ['party'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to accept'),
  }, 600);

  const declineInviteM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/parties/invites/${id}/decline`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['party-invites'] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Failed to decline'),
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

      {/* Active team-workout banner — surfaces at the top so a
          leader who's mid-session can return to it, and invitees
          can see their pending invites at a glance. */}
      {(teamActiveQ.data?.items ?? []).length > 0 && (
        <div className="mb-4 space-y-2">
          {(teamActiveQ.data?.items ?? []).map((tw) => {
            const meP = (tw.participants ?? []).find((p: any) => p.userId === user?.id);
            const myStatus = meP?.status ?? 'NOT_INVITED';
            const isLeader = tw.leaderId === user?.id;
            const invited = (tw.participants ?? []).filter((p: any) => p.status === 'INVITED').length;
            const accepted = (tw.participants ?? []).filter((p: any) => p.status === 'ACCEPTED' || p.status === 'JOINED' || p.status === 'CONFIRMED').length;
            return (
              <Link
                key={tw.id}
                to={`/team-workout/${tw.id}`}
                className="block border border-neon-lime/40 bg-neon-lime/5 p-3 hover:border-neon-lime"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-display tracking-widest text-sm text-neon-lime uppercase">
                    🏋️🤝 Team Workout · {tw.status}
                  </span>
                  {tw.routineName && (
                    <span className="text-[10px] font-mono text-ink-300">· {tw.routineName}</span>
                  )}
                  <span className="text-[10px] font-mono text-ink-400 ml-auto">
                    {accepted}/{tw.participants.length} ready · {invited} pending
                  </span>
                </div>
                {isLeader ? (
                  <div className="text-[10px] font-mono text-ink-300 mt-1">
                    You started this. Open to manage invites and confirmations.
                  </div>
                ) : myStatus === 'INVITED' ? (
                  <div className="text-[10px] font-mono text-neon-amber mt-1 animate-pulse">
                    ! {tw.leader.username} wants to start a team workout with you. Tap to respond.
                  </div>
                ) : (
                  <div className="text-[10px] font-mono text-ink-300 mt-1">
                    You're in this one. Tap to view your pane.
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Pending invitations received — shown at the top so the user
          always sees them, even if they're already in a party. */}
      {(invitesQ.data?.invites ?? []).length > 0 && (
        <div className="mb-4 space-y-2">
          {(invitesQ.data?.invites ?? []).map((inv) => (
            <div
              key={inv.id}
              className="border border-neon-cyan/50 bg-neon-cyan/5 p-3 flex items-center gap-3 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="font-display tracking-widest text-sm neon-text-cyan uppercase">
                  ⚑ {inv.inviter.username} invited you to <span className="text-neon-amber">{inv.party.name}</span>
                </div>
                {inv.message && (
                  <div className="text-[10px] font-mono text-ink-300 mt-1 italic">"{inv.message}"</div>
                )}
                <div className="text-[10px] font-mono text-ink-500 mt-1">
                  Lvl {inv.inviter.level} {inv.inviter.class ? `· ${inv.inviter.class}` : ''} ·{' '}
                  expires {new Date(inv.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-2">
                <NeonButton
                  variant="lime"
                  loading={acceptInviteM.isPending}
                  onClick={() => acceptInviteM.run(inv.id)}
                >
                  Accept
                </NeonButton>
                <button
                  onClick={() => declineInviteM.run(inv.id)}
                  disabled={declineInviteM.isPending}
                  className="px-3 h-10 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-neon-magenta"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
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
                {deployedPet && (
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                      Companion · {deployedPet.name}
                    </div>
                    <PetCombatCard pet={deployedPet} />
                  </div>
                )}
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
                  <div className="border-t border-ink-500/30 pt-3 text-[10px] font-mono text-ink-300 italic space-y-1">
                    <div>
                      ⚔ Damage auto-dealt from your workouts.
                    </div>
                    <div className="text-ink-400">
                      Log a workout in <Link to="/workouts" className="neon-text-cyan hover:underline">Workouts</Link> to strike this boss.
                      Damage scales with your sets × class ability (Phantom: +EVA proc chance).
                    </div>
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
                {(role === 'LEADER' || role === 'OFFICER') ? (
                  <>
                    <select
                      className="input-neon"
                      value={bossId}
                      onChange={(e) => setBossId(e.target.value)}
                    >
                      {(bossesQ.data?.bosses ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.icon} {b.name} · {b.hp.toLocaleString()} HP · {b.difficulty}
                        </option>
                      ))}
                    </select>
                    {(bossesQ.data?.bosses ?? []).find((b) => b.id === bossId)?.description && (
                      <div className="text-[10px] font-mono text-ink-400 italic leading-relaxed border-l-2 border-ink-500/40 pl-2">
                        {(bossesQ.data?.bosses ?? []).find((b) => b.id === bossId)?.description}
                      </div>
                    )}
                    <NeonButton
                      fullWidth
                      onClick={() => startRaidM.run()}
                      loading={startRaidM.isPending}
                      icon="⚔"
                      loadingText="Starting…"
                    >
                      Start
                    </NeonButton>
                  </>
                ) : (
                  <div className="text-[10px] text-ink-400 font-mono text-center py-2 border border-ink-700/30">
                    Only leaders/officers can start a raid
                  </div>
                )}
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

            {/* Invite by username — type the user's handle to send an
                invite. They see it in their Party tab pending-invites
                section and can accept/decline. */}
            <div className="mt-4 pt-3 border-t border-ink-700/30 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                Invite a friend
              </div>
              <div className="flex gap-2">
                <input
                  className="input-neon flex-1 text-xs"
                  placeholder="username"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => sendInviteM.run({ username: inviteUsername.trim(), message: inviteMessage.trim() || undefined })}
                  disabled={sendInviteM.isPending || inviteUsername.trim().length === 0}
                  className="px-3 h-11 text-xs font-mono border border-neon-cyan/60 text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/10 disabled:opacity-40"
                >
                  {sendInviteM.isPending ? '…' : 'Send'}
                </button>
              </div>
              <input
                className="input-neon w-full text-xs"
                placeholder="Optional message"
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                maxLength={200}
              />
            </div>

            <button
              onClick={() => leaveM.run()}
              disabled={leaveM.isPending}
              className="btn-ghost mt-3 w-full"
            >
              {leaveM.isPending ? '…' : 'Leave Party'}
            </button>

            {/* Team-workout launcher — leader-only. Opens a modal
                that lets the leader pick 1-4 party members + an
                optional routine name. The session lives at
                /team-workout/<id> after creation. */}
            {(role === 'LEADER' || role === 'OFFICER') && (party?.members ?? []).length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  setTeamParticipantIds([]);
                  setTeamRoutineName('');
                  setTeamModalOpen(true);
                }}
                className="mt-3 w-full px-3 py-2 text-xs font-display tracking-widest uppercase border border-neon-lime/60 text-neon-lime bg-neon-lime/5 hover:bg-neon-lime/10"
                title="Start a co-op workout with up to 4 party members. +5 camaraderie, +10% raid damage (24h) on completion."
              >
                🏋️🤝 Start Team Workout
              </button>
            )}
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

      {/* Team workout launcher modal — picks participants and an
          optional routine name. The leader implicit-accepts; the
          other picks become INVITED and get a banner on /party. */}
      {teamModalOpen && party && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-bg-900/80 backdrop-blur-sm p-4"
          onClick={() => !startTeamM.isPending && setTeamModalOpen(false)}
        >
          <div
            className="border border-neon-lime/40 bg-bg-800 max-w-md w-full p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display tracking-widest text-neon-lime uppercase">
              🏋️🤝 Start Team Workout
            </div>
            <div className="text-[10px] font-mono text-ink-300">
              Pick 1-4 party members to train alongside. You auto-accept;
              they'll get an in-app invite. On completion: +5 party
              camaraderie, +10% raid damage (24h), and the "Side by Side"
              achievement for everyone who finishes.
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                Participants ({teamParticipantIds.length}/4)
              </div>
              <div className="space-y-1">
                {(party.members ?? [])
                  .filter((m: any) => m.userId !== user?.id)
                  .map((m: any) => {
                    const checked = teamParticipantIds.includes(m.userId);
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => toggleParticipant(m.userId)}
                        className={`w-full text-left px-2 py-1.5 text-xs font-mono border ${
                          checked
                            ? 'border-neon-lime text-neon-lime bg-neon-lime/10'
                            : 'border-ink-500/40 text-ink-200 hover:border-ink-300'
                        }`}
                      >
                        {checked ? '✓' : '·'} {m.user.username} · L{m.user.level} · {m.user.class ?? 'unclassed'}
                      </button>
                    );
                  })}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                Routine (optional)
              </div>
              <input
                className="input-neon w-full text-xs"
                placeholder="e.g. Push Day A, 5/3/1 Squat"
                value={teamRoutineName}
                onChange={(e) => setTeamRoutineName(e.target.value)}
                maxLength={80}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTeamModalOpen(false)}
                disabled={startTeamM.isPending}
                className="flex-1 px-3 py-2 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => startTeamM.run()}
                disabled={startTeamM.isPending || teamParticipantIds.length === 0}
                className="flex-1 px-3 py-2 text-xs font-display tracking-widest uppercase border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20 disabled:opacity-40"
              >
                {startTeamM.isPending ? 'Starting…' : '⚡ Start'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
