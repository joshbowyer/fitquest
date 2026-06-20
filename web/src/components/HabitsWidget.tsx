import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { classNames } from '@/lib/format';

type Habit = {
  id: string;
  name: string;
  direction: 'POSITIVE' | 'NEGATIVE';
  goldReward: number;
  xpReward: number;
  icon: string | null;
  archived: boolean;
  todayCount: number;
  todayGold: number;
  todayXp: number;
};

export function HabitsWidget() {
  const qc = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['habits', 'custom'],
    queryFn: () => api<{ items: Habit[] }>('/habits'),
    refetchInterval: 60_000,
  });

  const logM = useMutation({
    mutationFn: (id: string) => api(`/habits/${id}/log`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', 'custom'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setPendingId(null);
    },
  });

  const items = (data?.items ?? []).filter((h) => !h.archived);
  const positives = items.filter((h) => h.direction === 'POSITIVE');
  const negatives = items.filter((h) => h.direction === 'NEGATIVE');
  const positivesDone = positives.filter((h) => h.todayCount > 0).length;
  const negativesDone = negatives.filter((h) => h.todayCount > 0).length;
  const netGold = items.reduce((s, h) => s + h.todayGold, 0);

  return (
    <Panel variant="amber" title="Habits">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono text-ink-300">
            {items.length === 0 ? 'no habits yet' : `${items.length} active`}
          </div>
          <Link
            to="/habits"
            className="text-[10px] font-display tracking-widest neon-text-amber hover:underline"
          >
            → ALL
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="text-[10px] font-mono text-ink-400 italic text-center py-3 border border-dashed border-ink-700/30">
            Create user-defined +/- behaviors in the Habits tab.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-mono">
              <div className="border border-neon-lime/30 bg-neon-lime/5 p-1.5">
                <div className="neon-text-lime">+ {positivesDone}/{positives.length}</div>
                <div className="text-ink-400">positive</div>
              </div>
              <div className="border border-neon-magenta/30 bg-neon-magenta/5 p-1.5">
                <div className="neon-text-magenta">− {negativesDone}/{negatives.length}</div>
                <div className="text-ink-400">negative</div>
              </div>
              <div className="border border-ink-500/30 p-1.5">
                <div className={netGold >= 0 ? 'neon-text-amber' : 'neon-text-magenta'}>
                  {netGold >= 0 ? '+' : ''}{netGold}
                </div>
                <div className="text-ink-400">gold</div>
              </div>
            </div>
            <div className="space-y-1 pt-1">
              {items.slice(0, 5).map((h) => {
                const isPos = h.direction === 'POSITIVE';
                const accent = isPos ? '#9bff5c' : '#f55cc4';
                const isPending = pendingId === h.id && logM.isPending;
                return (
                  <div
                    key={h.id}
                    className={classNames(
                      'flex items-center justify-between text-xs font-mono py-1 px-1.5 border',
                      h.todayCount > 0
                        ? 'border-current bg-current/5'
                        : 'border-ink-500/30 hover:border-current/40',
                    )}
                    style={h.todayCount > 0 ? { color: accent, borderColor: `${accent}50`, background: `${accent}08` } : undefined}
                  >
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      <span className="text-sm shrink-0">{h.icon ?? (isPos ? '✦' : '✕')}</span>
                      <span className="truncate text-ink-100">{h.name}</span>
                      {h.todayCount > 0 && (
                        <span className="text-[9px] ml-auto" style={{ color: accent }}>
                          ×{h.todayCount}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setPendingId(h.id);
                        logM.mutate(h.id);
                      }}
                      disabled={logM.isPending}
                      className="ml-2 px-2 py-0.5 text-[10px] font-mono border"
                      style={{ borderColor: `${accent}66`, color: accent }}
                    >
                      {isPending ? '…' : isPos ? '+' : '−'}
                    </button>
                  </div>
                );
              })}
              {items.length > 5 && (
                <div className="text-[9px] font-mono text-ink-500 italic text-center pt-1">
                  +{items.length - 5} more in the Habits tab
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}