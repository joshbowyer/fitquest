import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { METRICS, type MetricType } from '@/lib/types';
import { classNames, formatMetricWithUnit, formatRelative } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

// Recovery-oriented metrics. Sleep (hours + quality) and HRV live here
// instead of on the generic measurements picker, so the page is
// focused on recovery rather than tracking every dimension.
const RECOVERY_METRICS: MetricType[] = [
  'SLEEP_HOURS',
  'SLEEP_QUALITY',
  'HRV',
  'RESTING_HR',
];

// Built-in recovery habits the user can opt into. "Complete" applies
// a small XP bonus; the focus is the practice, not the reward.
const RECOVERY_HABITS: Array<{
  id: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
}> = [
  { id: 'stretch',  name: 'Stretch / mobility 10m',  description: 'Ten minutes of stretching, foam rolling, or yoga.', icon: '◇', xp: 5 },
  { id: 'walk',     name: 'Walk (15+ min)',           description: 'Low-intensity movement. Aerobic base without training stress.', icon: '➤', xp: 5 },
  { id: 'hydrate',  name: 'Hydrated (2L+)',           description: 'Hit your daily water target.', icon: '◌', xp: 3 },
  { id: 'cold',     name: 'Cold exposure',            description: 'Cold shower, ice bath, or cold plunge.', icon: '✦', xp: 8 },
  { id: 'breath',   name: 'Box breathing 4-4-4-4',    description: 'One round of box breathing or breathwork.', icon: '◐', xp: 3 },
  { id: 'meditate', name: 'Meditate 10m',             description: 'Ten minutes of seated meditation.', icon: '☾', xp: 5 },
  { id: 'sunlight', name: 'Sunlight (10m)',           description: 'Outdoor sunlight within an hour of waking.', icon: '☀', xp: 3 },
  { id: 'nap',      name: 'Power nap (≤20m)',         description: 'Short restorative nap.', icon: '◍', xp: 3 },
];

const HABIT_LOG_KEY = 'fitquest:recovery:practiceLog';

function loadTodayLog(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HABIT_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { date: string; log: Record<string, boolean> };
    if (parsed.date !== new Date().toDateString()) return {};
    return parsed.log ?? {};
  } catch {
    return {};
  }
}

function saveTodayLog(log: Record<string, boolean>) {
  try {
    localStorage.setItem(
      HABIT_LOG_KEY,
      JSON.stringify({ date: new Date().toDateString(), log }),
    );
  } catch {
    /* ignore */
  }
}

export function RecoveryPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const qc = useQueryClient();
  const [practiceLog, setPracticeLog] = useState<Record<string, boolean>>(loadTodayLog);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const statusQ = useQuery({
    queryKey: ['recovery', 'today'],
    queryFn: () => api<{ status: Record<string, { logged: boolean; value: number | null; recordedAt: string | null }> }>(
      '/measurements/habits/today',
    ),
  });
  const allQ = useQuery({
    queryKey: ['recovery', 'all'],
    queryFn: () => api<{ items: Array<{ id: string; metric: MetricType; value: number; recordedAt: string }> }>(
      '/measurements?limit=200',
    ),
  });
  const status = statusQ.data?.status || {};

  // 7-day history per recovery metric for sparklines
  const sevenDayHistory = (metric: MetricType) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return (allQ.data?.items ?? [])
      .filter((m) => m.metric === metric && new Date(m.recordedAt) >= cutoff)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  };

  const batchM = useDelayedMutation<unknown, Array<{ metric: MetricType; value: number }>>({
    mutationFn: (items) => api('/measurements/batch', { method: 'POST', body: { items } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recovery'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      setDrafts({});
    },
  }, 600);

  function commit(metric: MetricType) {
    const raw = drafts[metric];
    if (raw === '' || raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    const meta = METRICS[metric];
    const stored = convertForStorage(value, displayUnit(meta.unit, system), system);
    batchM.run([{ metric, value: stored.value }]).then(() => {
      setDrafts((d) => ({ ...d, [metric]: '' }));
    });
  }

  function togglePractice(id: string, xp: number) {
    const next = { ...practiceLog };
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
      // Small XP bonus per practice (no gold; this is recovery, not raid).
      if (xp > 0) {
        batchM.run([]).catch(() => {});
        // XP bonus without a specific endpoint: piggyback on a measurement
        // would be wrong; for v0 just track the checkbox locally. Future:
        // POST /recovery/practice with xp grant.
      }
    }
    setPracticeLog(next);
    saveTodayLog(next);
  }

  const completedPractices = Object.values(practiceLog).filter(Boolean).length;
  const completedMetrics = RECOVERY_METRICS.filter((m) => status[m]?.logged).length;

  return (
    <Layout>
      <PageHeader
        title="// Recovery"
        subtitle="Sleep, HRV, restoration. The opposite of training stress — and the engine of adaptation."
        action={
          <div className="font-mono text-sm">
            <span className="text-ink-300 text-xs uppercase tracking-widest">Today: </span>
            <span className={`text-xl ml-1 ${completedMetrics === RECOVERY_METRICS.length && completedPractices > 0 ? 'neon-text-lime' : 'neon-text-cyan'}`}>
              {completedMetrics}/{RECOVERY_METRICS.length}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sleep + biometrics */}
        <Panel variant="violet" title="Sleep & biometrics">
          <div className="space-y-3">
            {RECOVERY_METRICS.map((m) => {
              const meta = METRICS[m];
              const s = status[m];
              const draft = drafts[m] ?? '';
              const history = sevenDayHistory(m);
              const last = history[history.length - 1];
              const isSubjective = meta.unit === '/10';
              return (
                <div key={m} className="border border-ink-500/30 p-3">
                  <div className="flex items-baseline justify-between mb-1">
                    <div>
                      <div className={classNames(
                        'font-display tracking-wider text-sm',
                        s?.logged ? 'text-neon-lime' : 'text-ink-50',
                      )}>
                        {meta.label}
                      </div>
                      <div className="text-[10px] font-mono text-ink-300">
                        {s?.logged && s.value != null
                          ? `✓ ${formatMetricWithUnit(s.value, meta.unit)} · ${s.recordedAt ? formatRelative(s.recordedAt) : ''}`
                          : 'not logged'}
                      </div>
                    </div>
                    {last && (
                      <div className="text-[10px] font-mono text-ink-400">
                        7-day avg:{' '}
                        <span className="text-ink-100">
                          {(() => {
                            const avg = history.reduce((s, h) => s + h.value, 0) / history.length;
                            return formatMetricWithUnit(avg, meta.unit);
                          })()}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Sparkline (simple bar chart from history) */}
                  {history.length > 0 && (
                    <div className="flex items-end gap-0.5 h-6 mb-2">
                      {history.slice(-7).map((h) => {
                        const max = Math.max(...history.map((x) => x.value));
                        const min = Math.min(...history.map((x) => x.value));
                        const range = Math.max(0.0001, max - min);
                        const norm = (h.value - min) / range;
                        return (
                          <div
                            key={h.id}
                            className="flex-1 bg-neon-violet/60"
                            style={{ height: `${Math.max(15, norm * 100)}%`, boxShadow: '0 0 3px currentColor' }}
                            title={`${formatMetricWithUnit(h.value, meta.unit)}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {isSubjective ? (
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={draft || (s?.value ? String(s.value) : '7')}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m]: e.target.value }))}
                        onMouseUp={() => commit(m)}
                        onTouchEnd={() => commit(m)}
                        className="flex-1 accent-current"
                        style={{ accentColor: 'currentcolor' }}
                      />
                    ) : (
                      <input
                        className="input-neon flex-1"
                        type="number"
                        step={0.1}
                        placeholder={s?.value ? String(s.value) : `e.g. ${meta.defaultMin}`}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft) commit(m);
                        }}
                      />
                    )}
                    <div className="text-[10px] font-mono text-ink-300 w-12 text-right">
                      {displayUnit(meta.unit, system)}
                    </div>
                    <NeonButton
                      onClick={() => commit(m)}
                      loading={batchM.isPending}
                      disabled={!draft}
                      variant="violet"
                      className="text-[10px] px-2 py-1"
                    >
                      ⚡
                    </NeonButton>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Recovery practices */}
        <Panel variant="cyan" title="Recovery practices">
          <div className="text-[10px] font-mono text-ink-300 mb-3">
            {completedPractices}/{RECOVERY_HABITS.length} practices completed today. Saved locally — pure signal, no penalty.
          </div>
          <div className="space-y-2">
            {RECOVERY_HABITS.map((p) => {
              const done = !!practiceLog[p.id];
              return (
                <button
                  key={p.id}
                  onClick={() => togglePractice(p.id, p.xp)}
                  className={classNames(
                    'w-full p-3 border text-left flex items-center gap-3 transition-all',
                    done
                      ? 'border-neon-lime/60 bg-neon-lime/10'
                      : 'border-ink-500/30 hover:border-neon-cyan/40',
                  )}
                >
                  <div
                    className={classNames(
                      'shrink-0 w-9 h-9 grid place-items-center font-display text-xl border',
                      done
                        ? 'border-neon-lime text-neon-lime'
                        : 'border-ink-700 text-ink-500',
                    )}
                    style={done ? { textShadow: '0 0 6px currentColor' } : undefined}
                  >
                    {done ? '✓' : p.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={classNames(
                      'font-display tracking-wider text-sm',
                      done ? 'text-neon-lime' : 'text-ink-100',
                    )}>
                      {p.name}
                    </div>
                    <div className="text-[10px] font-mono text-ink-400 mt-0.5 leading-snug">
                      {p.description}
                    </div>
                  </div>
                  <div className="text-[9px] font-mono text-ink-400">+{p.xp} XP</div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </Layout>
  );
}