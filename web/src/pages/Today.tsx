import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { METRICS, METRICS_BY_CATEGORY, type MetricType } from '@/lib/types';
import { classNames, formatRelative, formatMetricWithUnit } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

type HabitStatus = Record<string, { logged: boolean; value: number | null; recordedAt: string | null }>;

// /today = daily subjective check-in (sleep, mood, energy, soreness, stress).
// Nutrition (calories/macros/water) lives on its own /nutrition page.
const SUBJECTIVE = new Set<MetricType>([
  'SLEEP_HOURS', 'SLEEP_QUALITY', 'MOOD', 'ENERGY', 'SORENESS', 'STRESS',
]);
const CATEGORIES: Array<{ key: 'SLEEP' | 'WELLNESS'; title: string; variant: 'violet' | 'magenta' }> = [
  { key: 'SLEEP', title: 'Sleep', variant: 'violet' },
  { key: 'WELLNESS', title: 'Wellness', variant: 'magenta' },
];

export function TodayPage() {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ['today', 'status'],
    queryFn: () => api<{ status: HabitStatus }>('/measurements/habits/today'),
  });
  const status = statusQ.data?.status || {};
  const metrics = CATEGORIES.flatMap((c) => METRICS_BY_CATEGORY[c.key]);
  const completed = metrics.filter((m) => status[m]?.logged).length;

  // Clear drafts once they're persisted
  useEffect(() => {
    if (Object.values(status).some((s) => s.logged)) {
      // Keep drafts for any unlogged items
    }
  }, [status]);

  const batchM = useDelayedMutation<
    { unlocked: string[] },
    Array<{ metric: MetricType; value: number }>
  >({
    mutationFn: (items) =>
      api('/measurements/batch', { method: 'POST', body: { items } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['today'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      if (r.unlocked && r.unlocked.length > 0) {
        setToast(`✦ Unlocked: ${r.unlocked.join(', ')}`);
        setTimeout(() => setToast(null), 4000);
      }
    },
  }, 800);

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

  function commitAll() {
    const items: Array<{ metric: MetricType; value: number }> = [];
    for (const metric of metrics) {
      const raw = drafts[metric];
      if (raw === '' || raw == null) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) continue;
      const meta = METRICS[metric];
      const stored = convertForStorage(v, displayUnit(meta.unit, system), system);
      items.push({ metric, value: stored.value });
    }
    if (items.length === 0) return;
    batchM.run(items).then(() => setDrafts({}));
  }

  const dirtyCount = metrics.filter((m) => drafts[m] && drafts[m] !== '').length;

  return (
    <Layout>
      <PageHeader
        title="// Today"
        subtitle="Daily subjective check-in. Sleep + wellness. Nutrition lives on its own tab."
        action={
          <div className="font-mono text-sm">
            <span className="text-ink-300 text-xs uppercase tracking-widest">Done: </span>
            <span className={`text-xl ml-1 ${completed === metrics.length ? 'neon-text-lime' : 'neon-text-cyan'}`}>
              {completed}/{metrics.length}
            </span>
          </div>
        }
      />

      {toast && (
        <div className="mb-4 text-xs font-mono neon-text-amber border border-neon-amber/30 bg-neon-amber/5 p-2">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {CATEGORIES.map((cat) => (
          <Panel key={cat.key} variant={cat.variant} title={cat.title}>
            <div className="space-y-3">
              {METRICS_BY_CATEGORY[cat.key].map((m) => {
                const meta = METRICS[m];
                const s = status[m];
                const draft = drafts[m] ?? '';
                const isSubjective = SUBJECTIVE.has(m);
                return (
                  <div key={m} className="grid grid-cols-[140px_1fr_80px_auto] gap-2 items-center">
                    <div>
                      <div className={classNames(
                        'font-display tracking-wider text-sm',
                        s?.logged ? 'text-neon-lime' : 'text-ink-50',
                      )}>
                        {meta.shortLabel}
                      </div>
                      <div className="text-[10px] font-mono text-ink-300">
                        {s?.logged && s.value != null
                          ? `✓ ${formatMetricWithUnit(s.value, meta.unit)} · ${s.recordedAt ? formatRelative(s.recordedAt) : ''}`
                          : 'not logged'}
                      </div>
                    </div>
                    {isSubjective && meta.unit === '/10' ? (
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={draft || (s?.value ? String(s.value) : '5')}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m]: e.target.value }))}
                        onMouseUp={() => {
                          if (draft) commit(m);
                        }}
                        onTouchEnd={() => {
                          if (draft) commit(m);
                        }}
                        className="w-full accent-current"
                        style={{ accentColor: 'currentcolor' }}
                      />
                    ) : (
                      <input
                        className="input-neon"
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
                    <div className="text-[10px] font-mono text-ink-300 text-right">
                      {displayUnit(meta.unit, system)}
                    </div>
                    {meta.unit === '/10' ? (
                      <div className={classNames(
                        'text-sm font-display w-10 text-center',
                        draft ? 'neon-text-cyan' : s?.value ? 'text-ink-100' : 'text-ink-500',
                      )}>
                        {draft || (s?.value ? String(s.value) : '—')}
                      </div>
                    ) : (
                      <NeonButton
                        variant={cat.variant}
                        onClick={() => commit(m)}
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
    </Layout>
  );
}