import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';

type RoutineResponse = {
  weeklyGoal: number;
  thisWeekCount: number;
  thisWeekCleared: boolean;
  weekStart: string;
  weekEnd: string;
  currentStreak: number;
  longestStreak: number;
  lastCompletedWeek: string | null;
  streakBonus: number;
  progress: number;
};

type RoutineDay = {
  day: 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';
  workout: boolean;
  notes: string | null;
};

const GOAL_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

const DAY_META: Array<{ code: RoutineDay['day']; short: string; long: string }> = [
  { code: 'SUN', short: 'Sun', long: 'Sunday' },
  { code: 'MON', short: 'Mon', long: 'Monday' },
  { code: 'TUE', short: 'Tue', long: 'Tuesday' },
  { code: 'WED', short: 'Wed', long: 'Wednesday' },
  { code: 'THU', short: 'Thu', long: 'Thursday' },
  { code: 'FRI', short: 'Fri', long: 'Friday' },
  { code: 'SAT', short: 'Sat', long: 'Saturday' },
];

export function RoutinePanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['routine'],
    queryFn: () => api<RoutineResponse>('/routine'),
  });
  const daysQ = useQuery({
    queryKey: ['routine', 'days'],
    queryFn: () => api<{ days: RoutineDay[] }>('/routine/days'),
  });
  const [draft, setDraft] = useState<Record<string, RoutineDay>>({});

  // Initialize draft when days load
  useEffect(() => {
    if (daysQ.data) {
      const m: Record<string, RoutineDay> = {};
      for (const d of daysQ.data.days) m[d.day] = d;
      setDraft(m);
    }
  }, [daysQ.data]);

  const setGoal = useDelayedMutation<{ weeklyGoal: number }, number>({
    mutationFn: (g) =>
      api('/routine', { method: 'PATCH', body: { weeklyGoal: g } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routine'] }),
  }, 400);

  const saveDays = useDelayedMutation<{ ok: boolean }, Array<{ day: string; workout: boolean; notes: string | null }>>({
    mutationFn: (days) => api('/routine/days', { method: 'PUT', body: { days } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routine', 'days'] });
      qc.invalidateQueries({ queryKey: ['dailies'] });
    },
  }, 600);

  if (isLoading || !data) {
    return (
      <Panel title="Routine" variant="cyan">
        <div className="text-[10px] font-mono text-ink-300">loading…</div>
      </Panel>
    );
  }

  const goalOptions: readonly number[] = GOAL_OPTIONS.includes(data.weeklyGoal as 1 | 2 | 3 | 4 | 5 | 6 | 7)
    ? [...GOAL_OPTIONS]
    : [...GOAL_OPTIONS, data.weeklyGoal as number].sort((a, b) => a - b);

  // Count days marked as workout in draft (unsaved)
  const draftWorkoutCount = Object.values(draft).filter((d) => d.workout).length;
  const savedWorkoutCount = daysQ.data?.days.filter((d) => d.workout).length ?? 0;
  const dirty =
    JSON.stringify(Object.values(draft).sort((a, b) => a.day.localeCompare(b.day))) !==
    JSON.stringify((daysQ.data?.days ?? []).slice().sort((a, b) => a.day.localeCompare(b.day)));

  function toggleDay(code: RoutineDay['day']) {
    setDraft((d) => ({
      ...d,
      [code]: { ...d[code], workout: !d[code]?.workout, day: code, notes: d[code]?.notes ?? null },
    }));
  }

  function setNote(code: RoutineDay['day'], notes: string) {
    setDraft((d) => ({
      ...d,
      [code]: { ...d[code], workout: d[code]?.workout ?? false, day: code, notes: notes || null },
    }));
  }

  function commitDays() {
    const days = DAY_META.map((m) => draft[m.code]).filter(Boolean);
    saveDays.run(days);
  }

  return (
    <Panel
      title="Routine"
      variant={data.thisWeekCleared ? 'lime' : 'cyan'}
      action={
        data.currentStreak > 0 ? (
          <span
            className="font-display tracking-widest text-base neon-text-amber"
            style={{ textShadow: '0 0 8px #ffaa3a' }}
          >
            🔥 {data.currentStreak}w
          </span>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* Day-of-week schedule */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Weekly schedule ({draftWorkoutCount} workout days)
          </div>
          <div className="space-y-1.5">
            {DAY_META.map((m) => {
              const d = draft[m.code];
              return (
                <div
                  key={m.code}
                  className={classNames(
                    'flex items-center gap-2 border p-1.5 transition-all',
                    d?.workout
                      ? 'border-neon-magenta/50 bg-neon-magenta/5'
                      : 'border-ink-500/30',
                  )}
                >
                  <button
                    onClick={() => toggleDay(m.code)}
                    className={classNames(
                      'shrink-0 w-14 h-9 text-xs font-mono uppercase border transition-all',
                      d?.workout
                        ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/10'
                        : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
                    )}
                  >
                    {m.short}
                  </button>
                  <input
                    className="input-neon flex-1 text-xs"
                    placeholder={d?.workout ? 'e.g., Upper, Push, Heavy' : 'rest day'}
                    value={d?.notes ?? ''}
                    onChange={(e) => setNote(m.code, e.target.value)}
                    maxLength={120}
                  />
                </div>
              );
            })}
          </div>
          {dirty && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="text-[10px] font-mono text-ink-400">
                {draftWorkoutCount} days · unsaved
              </span>
              <NeonButton
                onClick={commitDays}
                loading={saveDays.isPending}
                variant="magenta"
                icon="⚡"
                loadingText="Saving…"
              >
                Save schedule
              </NeonButton>
            </div>
          )}
          {!dirty && savedWorkoutCount > 0 && (
            <div className="mt-2 text-[10px] font-mono text-ink-400">
              {savedWorkoutCount} workout days configured. These become built-in "Workout" dailies on /today.
            </div>
          )}
        </div>

        {/* Weekly goal (auto-derived from schedule count) */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Streak threshold (workouts needed / wk)
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {goalOptions.map((g) => (
              <button
                key={g}
                onClick={() => setGoal.run(g)}
                disabled={setGoal.isPending}
                className={
                  'min-w-[36px] h-9 px-2 text-xs font-mono border transition-all ' +
                  (g === data.weeklyGoal
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-500/40 text-ink-300 hover:border-ink-300')
                }
              >
                {g}
              </button>
            ))}
            <span className="text-[10px] font-mono text-ink-400 ml-2">workouts / wk</span>
          </div>
        </div>

        {/* Progress this week */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
              This week
            </span>
            <span className="text-xs font-mono">
              <span
                className={data.thisWeekCleared ? 'text-neon-lime' : 'text-ink-50'}
                style={{ textShadow: data.thisWeekCleared ? '0 0 6px #56e88e' : 'none' }}
              >
                {data.thisWeekCount}
              </span>
              <span className="text-ink-400">/{data.weeklyGoal}</span>
              {data.thisWeekCleared && (
                <span className="ml-2 text-neon-lime">✓</span>
              )}
            </span>
          </div>
          <div className="h-2 bg-bg-700 border border-ink-500/30">
            <div
              className="h-full transition-all"
              style={{
                width: `${data.progress * 100}%`,
                background: data.thisWeekCleared
                  ? '#56e88e'
                  : data.progress > 0.5
                  ? '#14d6e8'
                  : '#585868',
                boxShadow: data.thisWeekCleared ? '0 0 8px #56e88e' : 'none',
              }}
            />
          </div>
          <div className="mt-1 text-[10px] font-mono text-ink-400">
            Week of {data.weekStart} → {data.weekEnd}
          </div>
        </div>

        {/* Streak */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-ink-700/30">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Streak</div>
            <div className="font-display text-2xl text-neon-amber" style={{ textShadow: data.currentStreak > 0 ? '0 0 8px #ffaa3a' : 'none' }}>
              {data.currentStreak}<span className="text-sm text-ink-400 ml-1">wk</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Longest</div>
            <div className="font-display text-2xl text-ink-200">
              {data.longestStreak}<span className="text-sm text-ink-400 ml-1">wk</span>
            </div>
          </div>
        </div>

        {/* Streak bonus */}
        <div className="text-[10px] font-mono text-ink-400 leading-relaxed border-t border-ink-700/30 pt-2">
          <span className="text-neon-cyan">Streak bonus:</span>{' '}
          ×{data.streakBonus.toFixed(2)} XP / gold / raid damage right now.
          {' '}
          {data.currentStreak === 0
            ? 'Hit your weekly goal to start a streak.'
            : `At week ${data.currentStreak}, your bonus is +${Math.round((data.streakBonus - 1) * 100)}%. Caps at 50% bonus at week 10.`}
        </div>
      </div>
    </Panel>
  );
}