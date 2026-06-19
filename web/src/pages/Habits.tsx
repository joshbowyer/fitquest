import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { classNames, formatDate, formatMetricWithUnit, formatNumber, formatRelative } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

const CATEGORY_VARIANT: Record<string, 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'> = {
  SLEEP: 'violet',
  NUTRITION: 'lime',
  WELLNESS: 'magenta',
};

const CATEGORY_TITLES: Record<string, string> = {
  SLEEP: 'Sleep',
  NUTRITION: 'Nutrition',
  WELLNESS: 'Wellness',
};

type HabitStatus = Record<string, { logged: boolean; value: number | null; recordedAt: string | null }>;

const SUBJECTIVE = new Set<MetricType>([
  'SLEEP_QUALITY', 'MOOD', 'ENERGY', 'SORENESS', 'STRESS',
]);

export function HabitsPage() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [unlockedToast, setUnlockedToast] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<MetricType>('SLEEP_HOURS');

  const statusQ = useQuery({
    queryKey: ['habits', 'today'],
    queryFn: () => api<{ status: HabitStatus }>('/measurements/habits/today'),
  });
  const allQ = useQuery({
    queryKey: ['measurements', 'all'],
    queryFn: () => api<{ items: Array<{ id: string; metric: MetricType; value: number; recordedAt: string }> }>(
      '/measurements?limit=200'
    ),
  });

  const batchM = useDelayedMutation({
    mutationFn: (items: Array<{ metric: MetricType; value: number }>) =>
      api<{ items: any[]; unlocked: string[] }>('/measurements/batch', {
        method: 'POST',
        body: { items },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['habits'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      if (r.unlocked && r.unlocked.length > 0) {
        setUnlockedToast(r.unlocked);
        setTimeout(() => setUnlockedToast(null), 4000);
      }
    },
  }, 1200);

  const status = statusQ.data?.status || {};

  function setDraft(metric: string, v: string) {
    setDrafts((d) => ({ ...d, [metric]: v }));
  }

  function commitOne(metric: MetricType) {
    const raw = drafts[metric];
    if (!raw) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    batchM.run([{ metric, value }]).then(() => setDraft(metric, ''));
  }

  function commitAll() {
    const items: Array<{ metric: MetricType; value: number }> = [];
    for (const [metric, raw] of Object.entries(drafts)) {
      if (raw === '' || raw == null) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) continue;
      items.push({ metric: metric as MetricType, value: v });
    }
    if (items.length === 0) return;
    batchM.run(items).then(() => setDrafts({}));
  }

  const dirtyCount = Object.values(drafts).filter((v) => v !== '' && v != null).length;
  const allHabitMetrics: MetricType[] = useMemo(
    () => [...METRICS_BY_CATEGORY.SLEEP, ...METRICS_BY_CATEGORY.NUTRITION, ...METRICS_BY_CATEGORY.WELLNESS],
    []
  );
  const completedToday = allHabitMetrics.filter((m) => status[m]?.logged).length;

  // History chart for selected metric
  const filteredHistory = (allQ.data?.items || [])
    .filter((m) => m.metric === selected)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const chartData = filteredHistory.map((m) => ({
    date: new Date(m.recordedAt).getTime(),
    value: m.value,
  })).slice(-30);
  const meta = METRICS[selected];
  const avg =
    chartData.length > 0
      ? chartData.reduce((a, b) => a + b.value, 0) / chartData.length
      : null;

  return (
    <Layout>
      <PageHeader
        title="// Habits"
        subtitle="Daily check-in for sleep, nutrition, and wellness."
        action={
          <div className="font-mono text-sm">
            <span className="text-ink-300 text-xs uppercase tracking-widest">Today: </span>
            <span className={`text-xl ml-1 ${completedToday === allHabitMetrics.length ? 'neon-text-lime' : 'neon-text-cyan'}`}>
              {completedToday}/{allHabitMetrics.length}
            </span>
          </div>
        }
      />

      {unlockedToast && (
        <div className="mb-4 text-xs font-mono neon-text-amber border border-neon-amber/30 bg-neon-amber/5 p-2">
          ✦ Unlocked: {unlockedToast.join(', ')}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(['SLEEP', 'NUTRITION', 'WELLNESS'] as const).map((cat) => (
          <Panel
            key={cat}
            variant={CATEGORY_VARIANT[cat]}
            title={CATEGORY_TITLES[cat]}
            className={cat === 'WELLNESS' ? 'lg:col-span-2' : undefined}
          >
            <div className="space-y-3">
              {METRICS_BY_CATEGORY[cat].map((m) => {
                const meta = METRICS[m];
                const s = status[m];
                const draft = drafts[m] ?? '';
                const isSubjective = SUBJECTIVE.has(m);
                return (
                  <div key={m} className="grid grid-cols-[140px_1fr_80px_auto] gap-2 items-center">
                    <div>
                      <div className="font-display tracking-wider text-sm text-ink-50">
                        {meta.shortLabel}
                      </div>
                      <div className="text-[10px] font-mono text-ink-300">
                        {s?.logged && s.value != null
                          ? `✓ ${formatMetricWithUnit(s.value, meta.unit)} · ${s.recordedAt ? formatRelative(s.recordedAt) : ''}`
                          : 'not logged'}
                      </div>
                    </div>
                    {isSubjective ? (
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={draft || (s?.value ? String(s.value) : '5')}
                        onChange={(e) => setDraft(m, e.target.value)}
                        onMouseUp={() => {
                          if (draft) commitOne(m);
                        }}
                        onTouchEnd={() => {
                          if (draft) commitOne(m);
                        }}
                        className="w-full accent-current"
                        style={{ accentColor: 'currentcolor' }}
                      />
                    ) : (
                      <input
                        className="input-neon"
                        type="number"
                        step={meta.unit === 'kcal' || meta.unit === 'ml' || meta.unit === 'g' ? 1 : 0.1}
                        placeholder={s?.value ? String(s.value) : `e.g. ${meta.defaultMin}`}
                        value={draft}
                        onChange={(e) => setDraft(m, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft) commitOne(m);
                        }}
                      />
                    )}
                    <div className="text-[10px] font-mono text-ink-300 text-right">
                      {meta.unit}
                    </div>
                    {isSubjective ? (
                      <div className="text-sm font-display neon-text-cyan w-10 text-center">
                        {draft || (s?.value ? String(s.value) : '—')}
                      </div>
                    ) : (
                      <NeonButton
                        variant={CATEGORY_VARIANT[cat]}
                        onClick={() => commitOne(m)}
                        loading={batchM.isPending}
                        disabled={!draft}
                        className="text-[10px] px-2 py-1"
                      >
                        ⚡
                      </NeonButton>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      {/* Save all bar */}
      <div className="mt-4 flex items-center justify-end gap-3">
        {dirtyCount > 0 && (
          <div className="text-xs font-mono text-ink-300">
            {dirtyCount} unsaved
          </div>
        )}
        <NeonButton
          onClick={commitAll}
          loading={batchM.isPending}
          disabled={dirtyCount === 0}
          icon="⚡"
          loadingText="Saving…"
        >
          {`Save ${dirtyCount || ''}`.trim()}
        </NeonButton>
      </div>

      {/* History viewer */}
      <Panel variant="cyan" title="History" className="mt-4">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {allHabitMetrics.map((m) => (
              <button
                key={m}
                onClick={() => setSelected(m)}
                className={classNames(
                  'w-full text-left px-2 py-1.5 text-xs font-mono border transition-all',
                  selected === m
                    ? 'border-neon-cyan/80 bg-neon-cyan/10 text-neon-cyan'
                    : 'border-transparent text-ink-200 hover:bg-bg-700'
                )}
              >
                {METRICS[m].shortLabel}
                <span className="text-ink-400 text-[10px] ml-1">({METRICS[m].unit})</span>
              </button>
            ))}
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="font-display tracking-wider text-ink-50">{meta.label}</div>
                    {avg != null && (
                  <div className="text-[10px] font-mono text-ink-300">
                    30-day avg: <span className="neon-text-cyan">{formatMetricWithUnit(avg, meta.unit)}</span>
                  </div>
                )}
            </div>
            <div className="h-48">
              {chartData.length > 0 ? (
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <XAxis
                      dataKey="date"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      tick={{ fill: '#8080a8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                      stroke="#3a3a55"
                    />
                    <YAxis tick={{ fill: '#8080a8', fontSize: 10, fontFamily: 'JetBrains Mono' }} stroke="#3a3a55" domain={['auto', 'auto']} />
                    {avg != null && <ReferenceLine y={avg} stroke="#00f0ff" strokeOpacity="0.3" strokeDasharray="3 3" />}
                    <Tooltip
                      contentStyle={{ background: '#0a0a14', border: '1px solid rgba(0,240,255,0.3)', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                      labelStyle={{ color: '#00f0ff' }}
                      labelFormatter={(d) => new Date(d as number).toLocaleString()}
                      formatter={(v: number) => [formatMetricWithUnit(v, meta.unit), meta.shortLabel]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#00f0ff"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#00f0ff' }}
                      style={{ filter: 'drop-shadow(0 0 4px #00f0ff)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-ink-300 font-mono">
                  No history yet.
                </div>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto mt-3">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-ink-300 text-[10px] uppercase tracking-widest">
                    <th className="text-left py-1">When</th>
                    <th className="text-right py-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                    {filteredHistory.slice().reverse().slice(0, 12).map((m) => (
                    <tr key={m.id} className="border-b border-ink-500/20">
                      <td className="py-1">{formatDate(m.recordedAt)}</td>
                      <td className="text-right neon-text-cyan">{formatMetricWithUnit(m.value, meta.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Panel>
    </Layout>
  );
}
