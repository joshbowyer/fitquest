import { useState, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, YAxis, ReferenceLine } from 'recharts';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { formatRelative, classNames } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

type Status = {
  today: { logged: boolean; value: number | null; recordedAt: string | null; unit: string };
  streak: { current: number; longest: number; lastDate: string | null };
};
type Trend = {
  series: Array<{ date: string; value: number | null }>;
  delta7d: number | null;
};

export function WeighInPanel() {
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [unlockedToast, setUnlockedToast] = useState<string[] | null>(null);
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const inImperial = system === 'IMPERIAL';

  const statusQ = useQuery({
    queryKey: ['weigh-in', 'status'],
    queryFn: () => api<Status>('/measurements/weigh-in/status'),
    refetchOnMount: 'always',
  });
  const trendQ = useQuery({
    queryKey: ['weigh-in', 'trend'],
    queryFn: () => api<Trend>('/measurements/weigh-in/trend?days=7'),
  });

  const logM = useMutation({
    mutationFn: () => {
      // Convert input from display unit back to kg for storage
      const inputValue = Number(draft);
      const stored = convertForStorage(inputValue, displayUnit('kg', system), system);
      return api<any>('/measurements/weigh-in', { method: 'POST', body: { value: stored.value } });
    },
    onSuccess: (r) => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['weigh-in'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      // Refresh the Morning / Evening / Weekly checkin cards so the
      // WEIGHT row clears once today's log lands. Without this, the
      // dashboard's checkin tile keeps showing weight as due even
      // after the user just weighed in.
      qc.invalidateQueries({ queryKey: ['check-ins'] });
      if (r.unlocked && r.unlocked.length > 0) {
        setUnlockedToast(r.unlocked);
        setTimeout(() => setUnlockedToast(null), 4000);
      }
    },
  });

  const status = statusQ.data;
  const trend = trendQ.data;
  const today = status?.today;
  const streak = status?.streak;
  const logged = !!today?.logged;

  // For chart, fill nulls with a smoothed value so the line doesn't break.
  // If imperial, convert each value to lb so the chart axis shows pounds.
  const chartData = (trend?.series || []).map((p, i, arr) => {
    let v: number | null = null;
    if (p.value != null) v = p.value;
    else for (let j = i - 1; j >= 0; j--) {
      if (arr[j]!.value != null) { v = arr[j]!.value; break; }
    }
    if (v == null) return { ...p, _v: null };
    const disp = convertForDisplay(v, 'kg', system);
    return { ...p, _v: disp.value };
  });
  const values = chartData.map((d) => d._v).filter((v): v is number => v != null);
  const yMin = values.length ? Math.floor(Math.min(...values) - 1) : 70;
  const yMax = values.length ? Math.ceil(Math.max(...values) + 1) : 100;
  const deltaRaw = trend?.delta7d;
  const delta = deltaRaw != null ? convertForDisplay(deltaRaw, 'kg', system).value : null;
  const dayLabels = chartData.map((p) =>
    new Date(p.date).toLocaleDateString(undefined, { weekday: 'narrow' })
  );
  const weightUnit = displayUnit('kg', system);

  return (
    <Panel variant="amber" title="Daily Weigh-In" scanline>
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
        {/* Left: today + streak */}
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Today</div>
            {logged && today ? (
              <div>
                <div className="font-display text-3xl neon-text-amber leading-none">
                  {(() => {
                    const disp = convertForDisplay(today.value ?? 0, today.unit, system);
                    return disp.value.toFixed(1);
                  })()}
                  <span className="text-sm text-ink-300 ml-1.5 font-mono">
                    {convertForDisplay(0, today.unit, system).unit}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-ink-300 mt-1">
                  ✓ logged {today.recordedAt ? formatRelative(today.recordedAt) : ''}
                </div>
              </div>
            ) : (
              <div>
                <div className="font-display text-3xl text-ink-300 leading-none">—</div>
                <div className="text-[10px] font-mono text-neon-magenta mt-1 animate-pulse">
                  ! not logged today
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Streak</div>
            <div className="flex items-baseline gap-2">
              <span
                className={classNames(
                  'font-display text-3xl leading-none',
                  (streak?.current ?? 0) > 0 ? 'neon-text-amber' : 'text-ink-300'
                )}
                style={
                  (streak?.current ?? 0) > 0
                    ? { textShadow: '0 0 8px rgba(255,184,0,0.7), 0 0 16px rgba(255,184,0,0.4)' }
                    : undefined
                }
              >
                {(streak?.current ?? 0)}
                <span className="text-sm text-ink-300 ml-1.5 font-mono">days</span>
              </span>
              {(streak?.longest ?? 0) > (streak?.current ?? 0) && (
                <span className="text-[10px] font-mono text-ink-300">
                  best {streak?.longest}
                </span>
              )}
            </div>
            {delta != null && Math.abs(delta) >= 0.05 && (
              <div
                className={classNames(
                  'text-[10px] font-mono mt-1',
                  delta < 0 ? 'neon-text-lime' : 'neon-text-magenta'
                )}
              >
                {delta > 0 ? '+' : ''}
                {delta.toFixed(2)} {weightUnit} · 7d
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <input
              id={`wi-${id}`}
              className="input-neon border-neon-amber/40 text-neon-amber"
              type="number"
              step="0.1"
              placeholder={(() => {
                const u = displayUnit('kg', system);
                if (logged && today?.value) {
                  const disp = convertForDisplay(today.value, 'kg', system);
                  return `update: ${disp.value.toFixed(1)} ${u}`;
                }
                return u;
              })()}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft && !logM.isPending) {
                  logM.mutate();
                }
              }}
            />
            <NeonButton
              variant="amber"
              fullWidth
              disabled={!draft || logM.isPending}
              onClick={() => logM.mutate()}
            >
              {logM.isPending ? 'Logging…' : logged ? '⚡ Log Another' : '⚡ Log Today'}
            </NeonButton>
            {unlockedToast && (
              <div className="text-[10px] font-mono neon-text-amber text-center border border-neon-amber/30 bg-neon-amber/5 p-1.5">
                ✦ Unlocked: {unlockedToast.join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Right: 7-day sparkline */}
        <div className="flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            7-Day Trend
          </div>
          <div className="flex-1 min-h-[100px]">
            {chartData.some((d) => d.value != null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
                  <YAxis domain={[yMin, yMax]} hide />
                  {values.length > 0 && (
                    <ReferenceLine y={values[0]} stroke="rgba(255,184,0,0.3)" strokeDasharray="3 3" />
                  )}
                  <Line
                    type="monotone"
                    dataKey="_v"
                    stroke="#ffb800"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, index, payload } = props;
                      if (payload.value == null) return <g key={index} />;
                      return (
                        <g key={index}>
                          <circle cx={cx} cy={cy} r={6} fill="#ffb800" opacity={0.25} />
                          <circle cx={cx} cy={cy} r={3} fill="#ffb800" />
                        </g>
                      );
                    }}
                    connectNulls
                    isAnimationActive
                    style={{ filter: 'drop-shadow(0 0 4px #ffb800)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-ink-300 font-mono">
                Log your first weigh-in to see the trend.
              </div>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-mono text-ink-300 mt-1">
            {dayLabels.map((d, i) => (
              <div key={i} className={i === chartData.length - 1 ? 'neon-text-amber' : ''}>{d}</div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
