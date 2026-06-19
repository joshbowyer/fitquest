import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { METRICS, METRICS_BY_CATEGORY, type GeneticMax, type Measurement, type MetricType } from '@/lib/types';
import { formatDate, formatMetricWithUnit, formatRelative, formatSeconds } from '@/lib/format';

const CATS = Object.keys(METRICS_BY_CATEGORY) as Array<keyof typeof METRICS_BY_CATEGORY>;

export function MeasurementsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<MetricType>('BICEP');
  const [draftValue, setDraftValue] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const allQ = useQuery({
    queryKey: ['measurements', 'all'],
    queryFn: () => api<{ items: Measurement[] }>('/measurements?limit=200'),
  });
  const maxesQ = useQuery({
    queryKey: ['genetic-max'],
    queryFn: () => api<{ items: GeneticMax[] }>('/genetic-max'),
  });

  const createM = useMutation({
    mutationFn: () =>
      api('/measurements', {
        method: 'POST',
        body: {
          metric: selected,
          value: Number(draftValue),
          notes: draftNotes || undefined,
        },
      }),
    onSuccess: () => {
      setDraftValue('');
      setDraftNotes('');
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
  });

  const setMaxM = useMutation({
    mutationFn: (value: number) =>
      api('/genetic-max', {
        method: 'PUT',
        body: { items: [{ metric: selected, value, source: 'MANUAL' }] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  });

  const setMaxFromLatestM = useMutation({
    mutationFn: (bufferPct: number) => {
      if (filtered.length === 0) throw new Error('No measurements to base max on');
      const latestVal = filtered[filtered.length - 1]!.value;
      const buffered = latestVal * (1 + bufferPct / 100);
      return api('/genetic-max', {
        method: 'PUT',
        body: { items: [{ metric: selected, value: Number(buffered.toFixed(2)), source: 'MANUAL' }] },
      });
    },
    onSuccess: (_r, bufferPct) => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  });

  const delMaxM = useMutation({
    mutationFn: () => api(`/genetic-max/${selected}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['genetic-max'] }),
  });

  const all = allQ.data?.items || [];
  const filtered = all
    .filter((m) => m.metric === selected)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const chartData = filtered.map((m) => ({
    date: new Date(m.recordedAt).getTime(),
    value: m.value,
  }));
  const meta = METRICS[selected];
  const currentMax = (maxesQ.data?.items || []).find((g) => g.metric === selected);

  return (
    <Layout>
      <PageHeader
        title="// Measurements"
        subtitle="Log metrics. Adjust genetic maxes (overrides formulas)."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar: metric picker */}
        <Panel variant="cyan" title="Metrics">
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {CATS.map((cat) => (
              <div key={cat}>
                <div className="text-[10px] font-display tracking-widest text-ink-300 uppercase mb-1">
                  {cat.replace('_', ' ')}
                </div>
                <div className="space-y-0.5">
                  {METRICS_BY_CATEGORY[cat].map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelected(m)}
                      className={`w-full text-left px-2 py-1.5 text-xs font-mono border transition-all ${
                        selected === m
                          ? 'border-neon-cyan/80 bg-neon-cyan/10 text-neon-cyan'
                          : 'border-transparent text-ink-200 hover:bg-bg-700'
                      }`}
                    >
                      {METRICS[m].shortLabel}
                      <span className="text-ink-400 text-[10px] ml-1">({METRICS[m].unit})</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          {/* Detail panel */}
          <Panel variant="cyan" title={meta.label}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="md:col-span-2 text-xs font-mono text-ink-300">
                {meta.description}
              </div>
              <div className="border border-neon-cyan/30 p-2 bg-neon-cyan/5">
                <div className="text-[10px] uppercase font-mono text-neon-cyan tracking-widest">Genetic Max</div>
                <div className="font-display text-2xl neon-text-cyan">
                  {currentMax ? currentMax.value.toFixed(1) : '—'}
                  <span className="text-xs text-ink-300 ml-1">{meta.unit}</span>
                </div>
                <div className="text-[10px] text-ink-400 font-mono mt-1">
                  source: {currentMax?.source ?? 'none'}
                </div>
              </div>
            </div>

            <div className="h-48 -mx-2">
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
                    <YAxis
                      tick={{ fill: '#8080a8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                      stroke="#3a3a55"
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0a0a14', border: '1px solid rgba(0,240,255,0.3)', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                      labelStyle={{ color: '#00f0ff' }}
                      labelFormatter={(d) => new Date(d as number).toLocaleString()}
                      formatter={(v: number) => [`${v.toFixed(2)} ${meta.unit}`, meta.shortLabel]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#00f0ff"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#00f0ff' }}
                      activeDot={{ r: 5, fill: '#00f0ff' }}
                      style={{ filter: 'drop-shadow(0 0 4px #00f0ff)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-ink-300 font-mono">
                  No history yet — log a value below.
                </div>
              )}
            </div>
          </Panel>

          {/* Log new */}
          <Panel variant="lime" title="Log Measurement">
            <div className="grid grid-cols-[120px_1fr_auto] gap-3 items-end">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-lime/80 block mb-1">
                  Value ({meta.unit})
                </label>
                <input
                  className="input-neon"
                  type="number"
                  step="0.1"
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  placeholder={meta.unit === 's' ? '60' : '38.5'}
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-neon-lime/80 block mb-1">
                  Notes
                </label>
                <input
                  className="input-neon"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <NeonButton
                variant="lime"
                onClick={() => createM.mutate()}
                disabled={!draftValue || createM.isPending}
              >
                ⚡ Log
              </NeonButton>
            </div>
          </Panel>

          {/* Set max */}
          <Panel variant="amber" title="Override Genetic Max">
            <div className="space-y-3">
              {filtered.length > 0 && (
                <div className="border border-neon-amber/30 p-3 bg-neon-amber/5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-neon-amber mb-1">
                    Quick set from current
                  </div>
                  <div className="text-xs text-ink-300 font-mono mb-2">
                    Latest {meta.shortLabel} value:{' '}
                    <span className="neon-text-cyan">{formatMetricWithUnit(filtered[filtered.length - 1]!.value, meta.unit)}</span>.
                    Set max to current + a buffer:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[10, 20, 50].map((pct) => {
                      const latest = filtered[filtered.length - 1]!.value;
                      const buffered = (latest * (1 + pct / 100)).toFixed(2);
                      return (
                        <button
                          key={pct}
                          onClick={() => setMaxFromLatestM.mutate(pct)}
                          disabled={setMaxFromLatestM.isPending}
                          className="btn-ghost"
                        >
                          {formatMetricWithUnit(Number(buffered), meta.unit)} (+{pct}%)
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-[120px_1fr_auto_auto] gap-3 items-end">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-neon-amber/80 block mb-1">
                    New max ({meta.unit})
                  </label>
                  <input
                    id="max-input"
                    className="input-neon"
                    type="number"
                    step="0.1"
                    placeholder={currentMax ? currentMax.value.toString() : 'auto'}
                  />
                </div>
                <div className="text-[10px] text-ink-300 font-mono self-center">
                  Set a manual max that takes priority over the formula-derived value.
                </div>
                <NeonButton
                  variant="amber"
                  onClick={() => {
                    const el = document.getElementById('max-input') as HTMLInputElement | null;
                    if (el && el.value) setMaxM.mutate(Number(el.value));
                  }}
                >
                  Set Max
                </NeonButton>
                {currentMax?.source === 'MANUAL' && (
                  <button
                    onClick={() => delMaxM.mutate()}
                    className="btn-ghost"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </Panel>

          {/* History list */}
          <Panel title="History">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-ink-300 text-[10px] uppercase tracking-widest">
                    <th className="text-left py-1">When</th>
                    <th className="text-right py-1">Value</th>
                    <th className="text-left py-1 pl-4">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice()
                    .reverse()
                    .map((m) => (
                      <tr key={m.id} className="border-b border-ink-500/20">
                        <td className="py-1">{formatDate(m.recordedAt)}</td>
                        <td className="text-right neon-text-cyan">
                          {m.value.toFixed(2)} {m.unit}
                        </td>
                        <td className="pl-4 text-ink-300">{m.notes || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-xs text-ink-300 font-mono text-center py-4">No data.</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}
