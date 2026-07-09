import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { MetricTrendChart } from '@/components/MetricTrendChart';
import { BodyBatteryChart } from '@/components/BodyBatteryChart';
import { SleepOverviewChart } from '@/components/SleepOverviewChart';
import { METRICS, type MetricType } from '@/lib/types';
import { classNames, formatMetricWithUnit, formatRelative } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

// Recovery-oriented metrics. Sleep (hours + quality) and HRV live here
// instead of on the generic measurements picker, so the page is
// focused on recovery rather than tracking every dimension.
const RECOVERY_METRICS: MetricType[] = [
  'SLEEP_HOURS',
  'SLEEP_QUALITY',
  'HRV',
  'RESTING_HR',
];

export function RecoveryPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const qc = useQueryClient();
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

  const completedMetrics = RECOVERY_METRICS.filter((m) => status[m]?.logged).length;

  // Pull-to-refresh: invalidate the recovery tree so today's
  // status checkmark + the 200-row 7-day history used by the
  // sparklines both reload. Prefix match catches the two
  // variants (`['recovery', 'today']` and `['recovery', 'all']`)
  // without enumerating them.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      qc.invalidateQueries({ queryKey: ['recovery'] });
    },
  });

  return (
    <Layout>
      <PageHeader
        title="// Recovery"
        subtitle="Sleep, HRV, restoration. The opposite of training stress — and the engine of adaptation."
        action={
          <div className="flex items-center gap-3">
            {pulledPx > 4 && (
              <span
                aria-hidden
                className="text-[10px] font-mono uppercase tracking-widest text-ink-300"
              >
                {refreshing
                  ? 'Refreshing…'
                  : pulledPx > 0
                    ? `Release to refresh (${Math.round(pulledPx)}px)`
                    : 'Pull to refresh'}
              </span>
            )}
            <div className="font-mono text-sm">
              <span className="text-ink-300 text-xs uppercase tracking-widest">Today: </span>
              <span className={`text-xl ml-1 ${completedMetrics === RECOVERY_METRICS.length ? 'neon-text-lime' : 'neon-text-cyan'}`}>
                {completedMetrics}/{RECOVERY_METRICS.length}
              </span>
            </div>
          </div>
        }
      />

      {/* Sleep trend (top, full width) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Panel variant="lime" title="Sleep — last 30 days">
          <MetricTrendChart metric="SLEEP_HOURS" days={30} system={system} color="#9bff5c" />
        </Panel>
        <Panel variant="amber" title="Sleep quality — last 30 days">
          <MetricTrendChart metric="SLEEP_QUALITY" days={30} system={system} color="#ffc34d" />
        </Panel>
      </div>

      {/* Sleep overview: hours + onset + quality on one chart */}
      <Panel
        variant="cyan"
        title="Sleep overview — onset + hours + quality"
        className="border-neon-cyan/30 mb-4"
      >
        <SleepOverviewChart days={30} />
      </Panel>

      {/* Body battery — 4 overlays (overview/onset/duration/quality) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Panel variant="lime" title="Body battery + sleep onset" className="border-neon-lime/30">
          <BodyBatteryChart days={30} variant="onset" />
        </Panel>
        <Panel variant="amber" title="Body battery + sleep hours" className="border-neon-amber/30">
          <BodyBatteryChart days={30} variant="duration" />
        </Panel>
        <Panel variant="cyan" title="Body battery + sleep quality" className="border-neon-cyan/30">
          <BodyBatteryChart days={30} variant="quality" />
        </Panel>
        <Panel variant="magenta" title="Body battery + substances" className="border-neon-magenta/30">
          <BodyBatteryChart days={30} variant="substances" />
        </Panel>
      </div>

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

        {/* Recovery practices panel moved to Today page — see RecoveryPracticesPanel */}
      </div>
    </Layout>
  );
}