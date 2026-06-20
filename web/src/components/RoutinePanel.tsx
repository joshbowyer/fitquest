import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

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

const GOAL_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export function RoutinePanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['routine'],
    queryFn: () => api<RoutineResponse>('/routine'),
  });

  const setGoal = useDelayedMutation<{ weeklyGoal: number }, number>({
    mutationFn: (g) =>
      api('/routine', { method: 'PATCH', body: { weeklyGoal: g } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routine'] }),
  }, 400);

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
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Weekly goal
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