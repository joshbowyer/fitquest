import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { useAuth } from '@/lib/auth';
import { classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { WorkoutLogger } from '@/components/WorkoutLogger';
import { LiveWorkoutLogger } from '@/components/LiveWorkoutLogger';
import type { UnitSystem } from '@/lib/units';

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
  JOINED: 'in progress',
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
  const navigate = useNavigate();

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-workout', id] });
      // Prefix invalidation — Party.tsx polls `['team-workouts','active']`
      // every 5s, but a fresh invalidate shortens the window where a
      // returning leader sees a stale "session exists" banner after
      // the join flips the session into ACTIVE state.
      qc.invalidateQueries({ queryKey: ['team-workouts'] });
    },
  }, 600);

  /// Confirm path: the user already has a workout id (either
  /// from the in-pane WorkoutLogger they just used, or from a
  /// workout they logged earlier via /workouts that they now
  /// want to attach). The server validates that the workout
  /// belongs to the user.
  const confirmM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (workoutId) => api(`/team-workouts/${id}/confirm`, { method: 'POST', body: { workoutId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-workout', id] });
      qc.invalidateQueries({ queryKey: ['team-workouts', 'active'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Failed to confirm'),
  }, 800);

  const abandonM = useDelayedMutation<{ ok: boolean }, void>({
    mutationFn: () => api(`/team-workouts/${id}/abandon`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-workout', id] });
      // Prefix invalidation — without this the launcher's
      // `['team-workouts','active']` cache stays warm after abandon
      // and the leader can't start a new session until the 5s poll
      // refreshes it. Prefix covers both the active list and any
      // future list-style keys without us hard-coding each one.
      qc.invalidateQueries({ queryKey: ['team-workouts'] });
      // Bounce back to the launcher (Party.tsx surfaces the active
      // banner + the "Start Team Workout" modal) — matches the
      // existing ← /party navigation pattern in the page header.
      navigate('/party');
    },
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
  const meUnits: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  const sessionOver = tw.status === 'COMPLETED' || tw.status === 'ABANDONED';

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

        {/* Split-pane: one column per participant. On lg+ screens
            the panes are evenly sized; below the lg breakpoint they
            stack vertically. Each pane is independently scrollable
            on small screens so a long exercise list in one pane
            doesn't push the others off. */}
        <div
          className="grid gap-3 items-start"
          style={{ gridTemplateColumns: `repeat(${tw.participants.length}, minmax(0, 1fr))` }}
        >
          {tw.participants.map((p) => {
            const isMe = p.userId === user?.id;
            return (
              <ParticipantPane
                key={p.id}
                p={p}
                isMe={isMe}
                meUnits={meUnits}
                sessionOver={sessionOver}
                teamWorkoutId={id}
                onRespond={(accept) => respondM.run(accept)}
                respondPending={respondM.isPending}
                onJoin={() => joinM.run()}
                joinPending={joinM.isPending}
                onConfirm={(wid) => confirmM.run(wid)}
                confirmPending={confirmM.isPending}
              />
            );
          })}
        </div>

        {/* Leader controls */}
        {isLeader && !sessionOver && (
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

/**
 * One per participant. Renders different UI based on (a) whether
 * the viewer is this participant (only they see actions) and
 * (b) their current status. Statuses that surface a real
 * WorkoutLogger pane: ACCEPTED + JOINED (and the participant
 * hasn't confirmed yet). Confirmed/DECLINED/NO_SHOW get a
 * compact read-only pane.
 */
function ParticipantPane({
  p, isMe, meUnits, sessionOver, teamWorkoutId,
  onRespond, respondPending,
  onJoin, joinPending,
  onConfirm, confirmPending,
}: {
  p: Participant;
  isMe: boolean;
  meUnits: UnitSystem;
  sessionOver: boolean;
  teamWorkoutId: string;
  onRespond: (accept: boolean) => void;
  respondPending: boolean;
  onJoin: () => void;
  joinPending: boolean;
  onConfirm: (workoutId: string) => void;
  confirmPending: boolean;
}) {
  const color = STATUS_COLOR[p.status];
  const showLogger = isMe && !sessionOver && (p.status === 'ACCEPTED' || p.status === 'JOINED');
  // Pane-local toggle: which logger variant to render. Defaults to Live
  // — the team pane's existing bulk logger stays in place when the
  // user opts back into it. Switching modes unmounts the inactive
  // logger entirely, so no stale captured-sets or form state leaks
  // between the two.
  const [loggerMode, setLoggerMode] = useState<'live' | 'bulk'>('live');

  return (
    <div
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

      {/* Read-only view of other participants' workout, once
          confirmed. Their pane doesn't get a logger; they have
          their own browser. */}
      {!isMe && p.workoutId && (
        <Link to={`/activities/${p.workoutId}`} className="text-[10px] font-mono text-neon-cyan hover:underline block">
          view workout →
        </Link>
      )}

      {/* Self-action area: invitee accept/decline, join prompt,
          or the workout logger. Always renders for self; never
          for others. Hidden once the session is finalized. */}
      {isMe && !sessionOver && (
        <div className="pt-2 border-t border-ink-500/20 space-y-2">
          {p.status === 'INVITED' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onRespond(true)}
                disabled={respondPending}
                className="flex-1 px-2 py-1 text-[10px] font-mono border border-neon-lime text-neon-lime bg-neon-lime/10 hover:bg-neon-lime/20 disabled:opacity-40"
              >
                ✓ Accept
              </button>
              <button
                type="button"
                onClick={() => onRespond(false)}
                disabled={respondPending}
                className="flex-1 px-2 py-1 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-neon-magenta disabled:opacity-40"
              >
                ✕ Decline
              </button>
            </div>
          )}

          {/* ACCEPTED but not yet JOINED: a single "I'm starting"
              button. The server moves them to JOINED, after which
              the logger below renders. */}
          {p.status === 'ACCEPTED' && (
            <button
              type="button"
              onClick={onJoin}
              disabled={joinPending}
              className="w-full px-2 py-1.5 text-[10px] font-display tracking-widest uppercase border border-neon-cyan text-neon-cyan bg-neon-cyan/10 hover:bg-neon-cyan/20 disabled:opacity-40"
            >
              🏋️ I'm starting →
            </button>
          )}

          {/* The split-pane logger: a compact WorkoutLogger for
              the self participant. onCommit returns the new
              workout id, which we immediately POST to
              /team-workouts/:id/confirm. Once that succeeds the
              pane flips to the "done ✓" state and the rest of
              the app unfreezes (other participants see the
              confirmation in their polls).

              Participants can pick between Live (interactive
              set-by-set walk) and Bulk (predefined routine) entry
              via the segmented toggle above. Default is Live. */}
          {showLogger && (
            <>
              {/* Live / Bulk segmented toggle. Inline-flex row,
                  1px themed border, pane-accent (neon-cyan) for
                  the active segment — matches the existing
                  status-pill / "I'm starting" button styling
                  used elsewhere in this pane. text-xs + tight
                  padding so it sits comfortably in the split-
                  pane. Reuses theme CSS vars (no hardcoded
                  hex) so it renders correctly in both dark and
                  light themes. */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                  Mode
                </span>
                <div
                  role="tablist"
                  aria-label="Logger mode"
                  className="inline-flex rounded border border-neon-cyan/40 overflow-hidden"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={loggerMode === 'live'}
                    onClick={() => setLoggerMode('live')}
                    className={classNames(
                      'px-3 py-1 text-xs font-mono uppercase tracking-widest transition-colors',
                      loggerMode === 'live'
                        ? 'bg-neon-cyan/15 text-neon-cyan'
                        : 'text-ink-300 hover:text-ink-100 hover:bg-neon-cyan/5',
                    )}
                  >
                    Live
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={loggerMode === 'bulk'}
                    onClick={() => setLoggerMode('bulk')}
                    className={classNames(
                      'px-3 py-1 text-xs font-mono uppercase tracking-widest border-l border-neon-cyan/40 transition-colors',
                      loggerMode === 'bulk'
                        ? 'bg-neon-cyan/15 text-neon-cyan'
                        : 'text-ink-300 hover:text-ink-100 hover:bg-neon-cyan/5',
                    )}
                  >
                    Bulk
                  </button>
                </div>
              </div>

              {loggerMode === 'live' ? (
                <LiveWorkoutLogger
                  user={userForLogger()}
                  units={meUnits}
                  title="Your sets"
                  initialType={p.status === 'JOINED' ? undefined : 'STRENGTH'}
                  compact
                  onCommit={(workoutId) => {
                    if (workoutId) onConfirm(workoutId);
                  }}
                />
              ) : (
                <WorkoutLogger
                  user={userForLogger()}
                  units={meUnits}
                  title="Your sets"
                  initialType={p.status === 'JOINED' ? undefined : 'STRENGTH'}
                  compact
                  onCommit={(workoutId) => {
                    if (workoutId) onConfirm(workoutId);
                  }}
                />
              )}

              {/* Show a tiny ⏳ indicator while we're POSTing confirm.
                  The poll will pick up the new CONFIRMED status on
                  the next 4s tick; no need for a manual refresh. */}
              {confirmPending && (
                <div className="text-[10px] font-mono text-neon-amber animate-pulse">
                  ⏳ registering "I'm done"…
                </div>
              )}
            </>
          )}

          {(p.status === 'DECLINED' || p.status === 'NO_SHOW') && (
            <div className="text-[10px] font-mono text-ink-500 italic">
              You're out of this session.
            </div>
          )}
        </div>
      )}

      {/* The leader's pane is also interactive: they too need to
          log sets (and accept their own implicit invite). The
          same logger shows up. The CONFIRMED state hides both the
          logger and the join prompt. */}
      {!isMe && !sessionOver && (
        <div className="pt-2 border-t border-ink-500/20 text-[10px] font-mono text-ink-400 italic">
          {p.status === 'INVITED' && 'waiting for them to accept'}
          {p.status === 'ACCEPTED' && 'waiting for them to start'}
          {p.status === 'JOINED' && 'they are logging sets'}
          {p.status === 'DECLINED' && 'declined'}
          {p.status === 'NO_SHOW' && 'no-show'}
        </div>
      )}
    </div>
  );

  /// The WorkoutLogger takes a `user` prop for bodyweight-derived
  /// set weights. We don't have the leader's full User object
  /// here, but we can hand it the viewer's weight from useAuth
  /// (a sibling pane uses the same hook). If the participant
  /// has a different bodyweight from the viewer, set weights
  /// will be slightly off — acceptable for v1; we'll fix this
  /// by passing the per-participant bodyweight when the leader
  /// query surfaces it.
  function userForLogger() {
    return { id: p.userId, weightKg: undefined as number | null | undefined };
  }
}