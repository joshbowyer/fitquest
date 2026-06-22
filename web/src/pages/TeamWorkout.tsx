import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { useAuth } from '@/lib/auth';
import { classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

type Participant = {
  id: string;
  userId: string;
  status: 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'JOINED' | 'CONFIRMED' | 'NO_SHOW';
  workoutId: string | null;
  respondedAt: string | null;
  confirmedAt: string | null;
  user: { id: string; username: string; level: number; class: string | null; units: string };
};
type TeamWorkout = {
  id: string;
  partyId: string;
  leaderId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  routineName: string | null;
  completedAt: string | null;
  participants: Participant[];
  leader: { id: string; username: string; level: number; class: string | null; units: string };
};

const STATUS_LABEL: Record<Participant['status'], string> = {
  INVITED: 'invited',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  JOINED: 'joined',
  CONFIRMED: 'done ✓',
  NO_SHOW: 'no-show',
};

const STATUS_COLOR: Record<Participant['status'], string> = {
  INVITED: 'text-neon-amber',
  ACCEPTED: 'text-neon-cyan',
  DECLINED: 'text-ink-500',
  JOINED: 'text-neon-lime',
  CONFIRMED: 'text-neon-lime',
  NO_SHOW: 'text-neon-magenta',
};

export function TeamWorkoutPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Poll every 4s so the leader sees invites flip to accepted in
  // real time and confirmations roll in as members wrap up.
  const twQ = useQuery({
    queryKey: ['team-workout', id],
    queryFn: () => api<TeamWorkout>(`/team-workouts/${id}`),
    enabled: !!id,
    refetchInterval: 4000,
  });

  const respondM = useDelayedMutation<{ ok: boolean }, boolean>({
    mutationFn: (accept) => api(`/team-workouts/${id}/respond`, { method: 'POST', body: { accept } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-workout', id] }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Failed to respond'),
  }, 600);

  const joinM = useDelayedMutation<{ ok: boolean }, void>({
    mutationFn: () => api(`/team-workouts/${id}/join`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-workout', id] }),
  }, 600);

  // Confirm: in v1 the user creates their workout via /workouts
  // then taps "I'm done" with the workout id. For the basic flow
  // we let the user paste in a workout id from /workouts.
  const confirmM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (workoutId) => api(`/team-workouts/${id}/confirm`, { method: 'POST', body: { workoutId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-workout', id] }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Failed to confirm'),
  }, 800);

  const abandonM = useDelayedMutation<{ ok: boolean }, void>({
    mutationFn: () => api(`/team-workouts/${id}/abandon`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-workout', id] }),
  }, 800);

  // Promote the page title once data arrives.
  useEffect(() => {
    if (twQ.data?.routineName) document.title = `Team · ${twQ.data.routineName}`;
    else document.title = 'Team Workout · FitQuest';
    return () => { document.title = 'FitQuest'; };
  }, [twQ.data?.routineName]);

  if (!id) return <Layout>Missing session id</Layout>;
  if (twQ.isLoading) {
    return <Layout><PageHeader title="// Team Workout" /><div className="text-ink-300 font-mono text-xs">loading…</div></Layout>;
  }
  if (twQ.error) {
    return (
      <Layout>
        <PageHeader title="// Team Workout" />
        <Panel variant="magenta" title="Error">
          <div className="text-xs font-mono text-neon-magenta">
            Could not load session: {(twQ.error as Error).message}
          </div>
          <Link to="/party" className="text-xs font-mono text-neon-cyan hover:underline mt-2 block">
            ← back to /party
          </Link>
        </Panel>
      </Layout>
    );
  }
  const tw = twQ.data!;
  const meP = tw.participants.find((p) => p.userId === user?.id);
  const isLeader = tw.leaderId === user?.id;
  const invited = tw.participants.filter((p) => p.status === 'INVITED');
  const ready = tw.participants.filter((p) => p.status === 'ACCEPTED' || p.status === 'JOINED' || p.status === 'CONFIRMED');
  const declined = tw.participants.filter((p) => p.status === 'DECLINED');

  return (
    <Layout>
      <PageHeader
        title="// Team Workout"
        subtitle={
          tw.routineName
            ? `${tw.routineName} · led by ${tw.leader.username}`
            : `Led by ${tw.leader.username}`
        }
        action={
          <Link to="/party" className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:underline">
            ← /party
          </Link>
        }
      />

      <div className="space-y-4">
        {/* Status banner */}
        <Panel
          variant={tw.status === 'COMPLETED' ? 'lime' : tw.status === 'ABANDONED' ? 'magenta' : 'cyan'}
          title={`Status: ${tw.status}`}
          scanline={tw.status === 'ACTIVE'}
        >
          <div className="text-xs font-mono text-ink-300 leading-relaxed">
            {tw.status === 'PENDING' && (
              <>Waiting for invitees to accept. {invited.length} pending, {ready.length} ready.</>
            )}
            {tw.status === 'ACTIVE' && (
              <>In progress. Once everyone taps "I'm done", the session wraps and grants the camaraderie + raid-damage bonus.</>
            )}
            {tw.status === 'COMPLETED' && (
              <>✓ Completed {tw.completedAt ? new Date(tw.completedAt).toLocaleString() : ''}. +5 party camaraderie, +10% raid damage (24h), "Side by Side" achievement granted to those who confirmed.</>
            )}
            {tw.status === 'ABANDONED' && (
              <>Cancelled by the leader. No camaraderie change beyond the -1 leader-abandoned penalty.</>
            )}
          </div>
        </Panel>

        {/* Per-participant panes */}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${tw.participants.length}, minmax(0, 1fr))` }}
        >
          {tw.participants.map((p) => {
            const color = STATUS_COLOR[p.status];
            const isMe = p.userId === user?.id;
            return (
              <div
                key={p.id}
                className={classNames(
                  'border p-3 space-y-2',
                  isMe ? 'border-neon-cyan/60 bg-neon-cyan/5' : 'border-ink-500/30 bg-bg-700/40',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-display tracking-wider text-sm truncate">
                    {p.user.username}{isMe && <span className="text-ink-400 text-[10px] ml-1">(you)</span>}
                  </div>
                  <div className="text-[10px] font-mono text-ink-400 shrink-0">
                    L{p.user.level} · {p.user.class ?? 'unclassed'}
                  </div>
                </div>
                <div className={`text-[10px] font-mono uppercase tracking-widest ${color}`}>
                  {STATUS_LABEL[p.status]}
                </div>
                {p.respondedAt && (
                  <div className="text-[10px] font-mono text-ink-500">
                    {p.status === 'INVITED' ? 'sent' : 'responded'} {new Date(p.respondedAt).toLocaleTimeString()}
                  </div>
                )}
                {p.confirmedAt && (
                  <div className="text-[10px] font-mono text-ink-500">
                    confirmed {new Date(p.confirmedAt).toLocaleTimeString()}
                  </div>
                )}
                {p.workoutId && (
                  <Link to={`/activities/${p.workoutId}`} className="text-[10px] font-mono text-neon-cyan hover:underline block">
                    view workout →
                  </Link>
                )}

                {/* Action area — only the user themselves sees their actions. */}
                {isMe && tw.status !== 'COMPLETED' && tw.status !== 'ABANDONED' && (
                  <div className="pt-2 border-t border-ink-500/20 space-y-2">
                    {p.status === 'INVITED' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => respondM.run(true)}
                          disabled={respondM.isPending}
                          className="flex-1 px-2 py-1 text-[10px] font-mono border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20 disabled:opacity-40"
                        >
                          ✓ Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => respondM.run(false)}
                          disabled={respondM.isPending}
                          className="flex-1 px-2 py-1 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-neon-magenta disabled:opacity-40"
                        >
                          ✕ Decline
                        </button>
                      </div>
                    )}
                    {(p.status === 'ACCEPTED') && (
                      <button
                        type="button"
                        onClick={() => joinM.run()}
                        disabled={joinM.isPending}
                        className="w-full px-2 py-1 text-[10px] font-mono border border-neon-cyan text-neon-cyan bg-neon-cyan/10 hover:bg-neon-cyan/20 disabled:opacity-40"
                      >
                        🏋️ I'm starting →
                      </button>
                    )}
                    {(p.status === 'JOINED' || p.status === 'ACCEPTED') && (
                      <ConfirmInline onConfirm={(wid) => confirmM.run(wid)} loading={confirmM.isPending} />
                    )}
                    {(p.status === 'DECLINED' || p.status === 'NO_SHOW') && (
                      <div className="text-[10px] font-mono text-ink-500 italic">
                        You're out of this session.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Leader controls */}
        {isLeader && tw.status !== 'COMPLETED' && tw.status !== 'ABANDONED' && (
          <Panel variant="magenta" title="Leader Controls">
            <div className="text-[10px] font-mono text-ink-300 mb-2">
              Cancel the session if something comes up. A small penalty (-1 camaraderie) applies if anyone already joined.
            </div>
            <button
              type="button"
              onClick={() => abandonM.run()}
              disabled={abandonM.isPending}
              className="px-3 py-1.5 text-xs font-mono border border-neon-magenta text-neon-magenta hover:bg-neon-magenta/10 disabled:opacity-40"
            >
              {abandonM.isPending ? '…' : '✕ Abandon Session'}
            </button>
          </Panel>
        )}

        {/* Post-session recap — visible after completion */}
        {tw.status === 'COMPLETED' && (
          <Panel variant="lime" title="Recap">
            <div className="space-y-2 text-xs font-mono">
              {tw.participants.filter((p) => p.workoutId).map((p) => (
                <div key={p.id} className="flex items-center gap-2 border border-neon-lime/20 p-2">
                  <span className="text-neon-lime">{p.user.username}</span>
                  <span className="text-ink-400">·</span>
                  {p.workoutId ? (
                    <Link to={`/activities/${p.workoutId}`} className="text-neon-cyan hover:underline">
                      view workout
                    </Link>
                  ) : (
                    <span className="text-ink-500 italic">no workout</span>
                  )}
                </div>
              ))}
              {declined.length > 0 && (
                <div className="text-[10px] font-mono text-ink-500 mt-2">
                  Declined: {declined.map((d) => d.user.username).join(', ')}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
    </Layout>
  );
}

function ConfirmInline({ onConfirm, loading }: { onConfirm: (workoutId: string) => void; loading: boolean }) {
  const { user } = useAuth();
  // The user needs to have a workout to attach. For v1 we let them
  // paste the id from /workouts. A future iteration can link the
  // existing /workouts/new flow here with a "this is for the team
  // session" toggle.
  const myLatest = useQuery({
    queryKey: ['my-latest-workout'],
    queryFn: () => api<{ items: Array<{ id: string; performedAt: string; name: string | null }> }>('/workouts?limit=1'),
    enabled: !!user,
  });
  const latest = myLatest.data?.items?.[0];

  if (latest) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-mono text-ink-400">
          Latest: {latest.name ?? 'session'} · {new Date(latest.performedAt).toLocaleString()}
        </div>
        <button
          type="button"
          onClick={() => onConfirm(latest.id)}
          disabled={loading}
          className="w-full px-2 py-1 text-[10px] font-display tracking-widest uppercase border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20 disabled:opacity-40"
        >
          ✓ I'm done
        </button>
      </div>
    );
  }
  return (
    <div className="text-[10px] font-mono text-ink-500 italic">
      Log a workout first, then return here.
    </div>
  );
}