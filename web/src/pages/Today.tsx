import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';

// /today — Dailies view (Habitica-style):
// - Built-in WORKOUT (auto-completes when a workout is logged today; flips on schedule)
// - Built-in SPIRITUAL (prayers the user committed to daily via /spiritual config)
// - User-defined dailies (recurring tasks with per-day schedule)
//
// Sleep/wellness quick-check has moved to /recovery (its own page). For
// the bare-bones "did I sleep / mood / etc" logging without leaving the
// dailies page, use the small "Quick log" entry points here.

type Daily = {
  id: string;
  name: string;
  category: 'USER' | 'WORKOUT' | 'SPIRITUAL';
  days: string[];
  notes: string | null;
  goldReward: number;
  xpReward: number;
  todayDone: boolean;
  prayerType?: string;
};

type TodayResponse = {
  today: string;
  userDailies: Daily[];
  builtins: Daily[];
  spiritualDailies: Daily[];
  counts: {
    total: number;
    completed: number;
    isWorkoutDay: boolean;
  };
};

const PRAYER_LABELS: Record<string, string> = {
  ROSARY: 'Rosary',
  MASS: 'Mass',
  SCRIPTURE: 'Scripture Reading',
  CONTEMPLATION: 'Contemplation',
  LITURGY_HOURS: 'Liturgy of the Hours',
  CONFESSION: 'Confession',
  OTHER: 'Other Prayer',
};

export function TodayPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Daily | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dailies', 'today'],
    queryFn: () => api<TodayResponse>('/dailies/today'),
    refetchInterval: 60_000,
  });

  const completeM = useDelayedMutation<{ goldDelta: number; xpDelta: number }, string>({
    mutationFn: (id) => api(`/dailies/${encodeURIComponent(id)}/complete`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dailies'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setPendingId(null);
    },
  }, 350);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const deleteM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/dailies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dailies'] }),
  }, 400);

  const { counts } = data ?? { counts: { total: 0, completed: 0, isWorkoutDay: false } };
  const isWorkoutDay = counts.isWorkoutDay;

  return (
    <Layout>
      <PageHeader
        title="// Today"
        subtitle={`Dailies for ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} — built-in + yours.`}
        action={
          <div className="flex items-center gap-3">
            <div className="font-mono text-sm">
              <span className="text-ink-300 text-xs uppercase tracking-widest">Done: </span>
              <span className={`text-xl ml-1 ${counts.completed === counts.total && counts.total > 0 ? 'neon-text-lime' : 'neon-text-cyan'}`}>
                {counts.completed}/{counts.total}
              </span>
            </div>
            <NeonButton onClick={() => setCreating(true)} icon="+" variant="cyan">
              New Daily
            </NeonButton>
          </div>
        }
      />

      {/* Workout day banner */}
      {data && (
        <div className={classNames(
          'mb-4 border p-3 text-xs font-mono flex items-center justify-between',
          isWorkoutDay
            ? 'border-neon-magenta/60 bg-neon-magenta/5'
            : 'border-ink-700/40 bg-bg-700/40',
        )}>
          <div>
            <span className={isWorkoutDay ? 'neon-text-magenta' : 'text-ink-300'}>
              {isWorkoutDay ? '⚔ Today is a workout day' : '☕ Rest day'}
            </span>
            <span className="text-ink-400 ml-2">
              — configure your weekly schedule in <Link to="/routine" className="neon-text-cyan hover:underline">Routine</Link>.
            </span>
          </div>
        </div>
      )}

      {isLoading ? (
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      ) : (
        <>
          {/* Built-in WORKOUT daily */}
          {data && data.builtins.length > 0 && (
            <div className="mb-4">
              <SectionHeader label="Built-in" count={data.builtins.length} />
              <div className="space-y-2">
                {data.builtins.map((d) => (
                  <DailyRow
                    key={d.id}
                    daily={d}
                    onToggle={() => {
                      setPendingId(d.id);
                      completeM.run(d.id);
                    }}
                    isPending={completeM.isPending}
                    pendingId={pendingId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Built-in SPIRITUAL dailies */}
          {data && data.spiritualDailies.length > 0 && (
            <div className="mb-4">
              <SectionHeader label="Spiritual" count={data.spiritualDailies.length} accent="#cba6ff" />
              <div className="space-y-2">
                {data.spiritualDailies.map((d) => (
                  <DailyRow
                    key={d.id}
                    daily={d}
                    isPending={completeM.isPending}
                    onToggle={() => {
                      setPendingId(d.id);
                      completeM.run(d.id);
                    }}
                    pendingId={pendingId}
                  />
                ))}
              </div>
              <div className="text-[10px] font-mono text-ink-400 italic mt-2">
                Configure which prayers are daily obligations in <Link to="/spiritual" className="neon-text-cyan hover:underline">Spiritual →</Link>.
              </div>
            </div>
          )}

          {/* User-defined dailies */}
          {data && data.userDailies.length > 0 && (
            <div className="mb-4">
              <SectionHeader label="Your dailies" count={data.userDailies.length} accent="#9bff5c" />
              <div className="space-y-2">
                {data.userDailies.map((d) => (
                  <DailyRow
                    key={d.id}
                    daily={d}
                    onToggle={() => {
                      setPendingId(d.id);
                      completeM.run(d.id);
                    }}
                    onEdit={() => setEditing(d)}
                    onArchive={() => deleteM.run(d.id)}
                    isPending={completeM.isPending}
                    pendingId={pendingId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {data && counts.total === 0 && (
            <Panel>
              <div className="text-center py-6 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">No dailies yet</div>
                <div className="text-xs text-ink-400 font-mono max-w-md mx-auto">
                  Add user-defined dailies (e.g. "Stretch 10m", "Read 30m"), or set up your
                  spiritual practices on the Spiritual tab. Built-in WORKOUT appears once
                  you mark a workout day in <Link to="/routine" className="neon-text-cyan hover:underline">Routine</Link>.
                </div>
                <NeonButton onClick={() => setCreating(true)} icon="+" variant="cyan">
                  New Daily
                </NeonButton>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* Daily editor (create / edit) */}
      {(creating || editing) && (
        <DailyEditor
          mode={editing ? 'edit' : 'create'}
          daily={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['dailies'] });
          }}
        />
      )}
    </Layout>
  );
}

function SectionHeader({ label, count, accent = '#14d6e8' }: { label: string; count: number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-[10px] font-display tracking-[0.2em] uppercase" style={{ color: accent }}>
        {label}
      </div>
      <div className="flex-1 border-t border-ink-700/30" />
      <div className="text-[10px] font-mono text-ink-400">{count}</div>
    </div>
  );
}

function DailyRow({
  daily,
  onToggle,
  onEdit,
  onArchive,
  isPending,
  pendingId,
}: {
  daily: Daily;
  onToggle: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  isPending: boolean;
  pendingId: string | null;
}) {
  const isBuiltin = daily.category !== 'USER';
  const accent = isBuiltin ? '#14d6e8' : '#9bff5c';
  const isPendingThis = isPending && pendingId === daily.id;

  return (
    <div
      className={classNames(
        'border p-3 flex items-center gap-3 transition-all',
        daily.todayDone
          ? 'border-neon-lime/50 bg-neon-lime/5'
          : 'border-ink-500/30',
      )}
    >
      <button
        onClick={onToggle}
        disabled={isPendingThis}
        className={classNames(
          'shrink-0 w-10 h-10 grid place-items-center font-display text-lg border-2 transition-all',
          daily.todayDone
            ? 'border-neon-lime text-neon-lime'
            : 'border-ink-700 text-ink-400 hover:border-current',
        )}
        style={daily.todayDone ? { textShadow: '0 0 6px currentColor' } : undefined}
        aria-label={daily.todayDone ? 'Mark incomplete' : 'Mark complete'}
      >
        {daily.todayDone ? '✓' : '○'}
      </button>
      <div className="flex-1 min-w-0">
        <div className={classNames(
          'font-display tracking-wider text-sm truncate',
          daily.todayDone ? 'text-neon-lime' : 'text-ink-100',
        )}>
          {daily.name}
        </div>
        <div className="text-[10px] font-mono text-ink-400 flex items-center gap-2 flex-wrap">
          <span className="uppercase tracking-widest" style={{ color: accent }}>
            {daily.category}
          </span>
          {daily.days.length > 0 && (
            <span>
              · {daily.days.map((d) => d.slice(0, 3)).join(' ')}
            </span>
          )}
          {daily.days.length === 0 && <span>· every day</span>}
          {(daily.goldReward > 0 || daily.xpReward > 0) && (
            <span className="text-ink-500">· +{daily.goldReward}g / +{daily.xpReward}xp</span>
          )}
        </div>
        {daily.notes && (
          <div className="text-[10px] font-mono text-ink-400 italic mt-0.5 truncate">
            "{daily.notes}"
          </div>
        )}
      </div>
      {!isBuiltin && (
        <div className="flex items-center gap-1 shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/30 text-ink-300 hover:border-ink-300"
              title="Edit"
            >
              ✎
            </button>
          )}
          {onArchive && (
            <button
              onClick={onArchive}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/30 text-ink-400 hover:border-neon-magenta hover:text-neon-magenta"
              title="Archive"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DailyEditor({
  mode,
  daily,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  daily?: Daily;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(daily?.name ?? '');
  const [days, setDays] = useState<string[]>(daily?.days ?? []);
  const [notes, setNotes] = useState(daily?.notes ?? '');
  const [goldReward, setGoldReward] = useState<number>(daily?.goldReward ?? 5);
  const [xpReward, setXpReward] = useState<number>(daily?.xpReward ?? 2);

  const allDays: Array<{ code: string; label: string }> = [
    { code: 'SUN', label: 'Sun' },
    { code: 'MON', label: 'Mon' },
    { code: 'TUE', label: 'Tue' },
    { code: 'WED', label: 'Wed' },
    { code: 'THU', label: 'Thu' },
    { code: 'FRI', label: 'Fri' },
    { code: 'SAT', label: 'Sat' },
  ];

  function toggleDay(code: string) {
    setDays((d) =>
      d.includes(code) ? d.filter((x) => x !== code) : [...d, code],
    );
  }

  const saveM = useDelayedMutation<unknown, void>({
    mutationFn: () => {
      const body =
        mode === 'create'
          ? { name, days, notes: notes || undefined, goldReward, xpReward }
          : { name, days, notes: notes || null, goldReward, xpReward };
      return mode === 'create'
        ? api('/dailies', { method: 'POST', body })
        : api(`/dailies/${daily!.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => onSaved(),
  }, 400);

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Daily' : 'Edit Daily'}>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Name
          </label>
          <input
            className="input-neon w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g., Stretch 10m, Read 30m"
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Days (leave empty for every day)
          </label>
          <div className="flex flex-wrap gap-1">
            {allDays.map((d) => (
              <button
                key={d.code}
                onClick={() => toggleDay(d.code)}
                className={classNames(
                  'px-3 py-1.5 text-xs font-mono uppercase border',
                  days.includes(d.code)
                    ? 'border-neon-cyan/80 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
              Gold reward
            </label>
            <input
              className="input-neon w-full"
              type="number"
              min={0}
              max={1000}
              value={goldReward}
              onChange={(e) => setGoldReward(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
              XP reward
            </label>
            <input
              className="input-neon w-full"
              type="number"
              min={0}
              max={1000}
              value={xpReward}
              onChange={(e) => setXpReward(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
          <NeonButton
            onClick={() => saveM.run()}
            disabled={!name.trim()}
            loading={saveM.isPending}
            icon="⚡"
            loadingText="Saving…"
            variant="lime"
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}