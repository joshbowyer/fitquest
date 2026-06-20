import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { METRICS, type MetricType } from '@/lib/types';
import { formatRelative, formatMetricWithUnit } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

type Measurement = {
  id: string;
  metric: MetricType;
  value: number;
  unit: string;
  notes: string | null;
  recordedAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  metric: MetricType | null;
};

// Notes / helpful info per metric. Kept short.
const METRIC_HELP: Record<string, { about: string; tips: string[] }> = {
  BODY_FAT_PCT: {
    about:
      'Healthy body-fat range depends on age and sex. We treat 10–14% as the ideal band — below 6% is risky territory regardless of how it looks on stage.',
    tips: [
      'Track trends over weeks, not daily fluctuations (water, glycogen, food volume all move it 1-2%).',
      'Use the same time of day, ideally fasted morning, for consistent measurements.',
    ],
  },
  HRV: {
    about:
      'Heart-rate variability (RMSSD) trends up with aerobic fitness and recovery. Higher isn\'t always better — acutely it dips under stress, chronically it trends upward over months of training.',
    tips: [
      'Measure same time daily (morning, before caffeine).',
      'Look at the 7-day rolling average, not individual readings.',
    ],
  },
  VO2_MAX: {
    about:
      'Maximal oxygen uptake — gold-standard fitness marker. 45–60 ml/kg/min is the typical "very fit" range; elite endurance athletes exceed 70.',
    tips: [
      'VO2 max improves with zone-2 endurance and interval work.',
      'Garmin / Apple Watch / chest strap give reasonable estimates; lab testing is the gold standard.',
    ],
  },
  BICEP: { about: 'Genetic ceiling based on Casey Butt wrist-derived formulas.', tips: [] },
  CHEST: { about: 'Genetic ceiling based on wrist + height.', tips: [] },
  SHOULDER: { about: 'Shoulder width (biacromial breadth) — bone structure + muscle.', tips: [] },
  QUAD: { about: 'Genetic ceiling ~2.85× ankle (Casey Butt).', tips: [] },
  CALF: { about: 'Genetic ceiling ~1.9× ankle.', tips: [] },
  FOREARM: { about: 'Genetic ceiling ~2.3× wrist.', tips: [] },
  NECK: { about: 'Genetic ceiling ~2.9× wrist.', tips: [] },
  LEAN_MASS: {
    about:
      'Estimated from weight × (1 − body fat %). If you take creatine, we subtract ~1.5 kg of intracellular water so the number reflects contractile tissue.',
    tips: [],
  },
  FFMI: {
    about:
      'Fat-Free Mass Index = lean mass (kg) / height² (m²). 25 is the natural ceiling for most men; 22+ is considered "built".',
    tips: [],
  },
  SHOULDER_WAIST_RATIO: {
    about:
      'Shoulder width ÷ waist circumference. Higher ratio = more V-taper. Elite 1.6+, healthy 1.4+. Driven mostly by skeletal shoulder width and lat/deltoid development on the high side; waist reduction via body-fat loss on the low side.',
    tips: [
      'Waist moves with body fat — drop waist and the ratio climbs without changing frame.',
      'Side delts respond to overhead press; lats respond to vertical pulls.',
    ],
  },
  BENCH_1RM: { about: 'Estimated 1-rep max bench press.', tips: [] },
  SQUAT_1RM: { about: 'Estimated 1-rep max back squat.', tips: [] },
  DEADLIFT_1RM: { about: 'Estimated 1-rep max conventional deadlift.', tips: [] },
  OHP_1RM: { about: 'Estimated 1-rep max overhead press.', tips: [] },
  PULLUP_1RM: { about: 'Heaviest weighted pull-up you\'ve done.', tips: [] },
  POWERLIFT_TOTAL: {
    about: 'Sum of best squat + bench + deadlift (the powerlifting total).',
    tips: [],
  },
  FIVE_K_TIME: { about: 'Best 5K run time, in seconds.', tips: [] },
  ONE_MILE_TIME: { about: 'Best 1-mile run time, in seconds.', tips: [] },
  PLANK_HOLD: { about: 'Longest plank hold, in seconds.', tips: [] },
  L_SIT_HOLD: { about: 'Longest L-sit hold, in seconds.', tips: [] },
  PUSHUP_MAX: { about: 'Max unbroken push-ups in a single set.', tips: [] },
  PULLUP_MAX: { about: 'Max unbroken pull-ups in a single set.', tips: [] },
  RESTING_HR: { about: 'Resting heart rate in bpm. Lower generally indicates better cardiovascular fitness.', tips: [] },
  WEIGHT: { about: 'Total body weight.', tips: [] },
  WAIST: { about: 'Waist circumference at navel.', tips: [] },
};

export function MetricDetailModal({ open, onClose, metric }: Props) {
  const { user } = useAuth();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const meta = metric ? METRICS[metric] : null;

  const q = useQuery({
    queryKey: ['metric-history', metric],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=${metric}&limit=200`),
    enabled: !!metric,
  });

  // Build a simple sparkline series from oldest → newest.
  const series = useMemo(() => {
    const items = (q.data?.items ?? []).slice().sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
    return items.map((m) => ({ ts: new Date(m.recordedAt).getTime(), v: m.value }));
  }, [q.data]);

  const latest = (q.data?.items ?? [])[0];
  const oldest = series[0];
  const newest = series[series.length - 1];
  const trend = oldest && newest && oldest !== newest
    ? (newest.v - oldest.v) / Math.max(1, oldest.v) * 100
    : 0;

  if (!metric || !meta) return null;

  const help = METRIC_HELP[metric];

  return (
    <Modal open={open} onClose={onClose} title={meta.label}>
      <div className="space-y-4">
        {/* Current value */}
        <div className="grid grid-cols-3 gap-3">
          <div className="border border-ink-500/30 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Latest</div>
            <div className="font-display text-2xl neon-text-cyan mt-1">
              {latest ? formatMetricWithUnit(latest.value, latest.unit) : '—'}
            </div>
            {latest && (
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                {formatRelative(latest.recordedAt)}
              </div>
            )}
          </div>
          <div className="border border-ink-500/30 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Range</div>
            {series.length > 0 ? (
              <div className="font-display text-base text-ink-100 mt-1">
                {(() => {
                  const disp = convertForDisplay(Math.min(...series.map((s) => s.v)), meta.unit, system);
                  return `${disp.value.toFixed(0)} ${disp.unit}`;
                })()}
                {' – '}
                {(() => {
                  const disp = convertForDisplay(Math.max(...series.map((s) => s.v)), meta.unit, system);
                  return `${disp.value.toFixed(0)} ${disp.unit}`;
                })()}
              </div>
            ) : (
              <div className="text-ink-500 mt-1">—</div>
            )}
            <div className="text-[10px] font-mono text-ink-400 mt-1">
              {series.length} log{series.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="border border-ink-500/30 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Trend</div>
            <div
              className="font-display text-2xl mt-1"
              style={{
                color: trend > 1 ? '#9bff5c' : trend < -1 ? '#ff2bd6' : '#cbd5e1',
                textShadow: trend > 1 ? '0 0 6px #9bff5c' : trend < -1 ? '0 0 6px #ff2bd6' : 'none',
              }}
            >
              {trend > 0 ? '+' : ''}{trend.toFixed(1)}%
            </div>
            <div className="text-[10px] font-mono text-ink-400 mt-1">
              over {series.length} log{series.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        {/* Sparkline */}
        {series.length > 1 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
              History
            </div>
            <Sparkline series={series} unit={meta.unit} system={system} />
          </div>
        )}

        {/* Recent logs */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Recent logs
          </div>
          {q.isLoading ? (
            <div className="text-[10px] font-mono text-ink-300">loading…</div>
          ) : (q.data?.items ?? []).length === 0 ? (
            <div className="text-[10px] font-mono text-ink-400 italic">
              No logs yet. Visit the {meta.shortLabel} tab to log some.
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(q.data?.items ?? []).slice(0, 10).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between border-b border-ink-500/20 py-1 text-[11px] font-mono"
                >
                  <span className="text-ink-300">{formatRelative(m.recordedAt)}</span>
                  <span className="text-ink-100">{formatMetricWithUnit(m.value, m.unit)}</span>
                  {m.notes && (
                    <span className="text-ink-500 italic truncate ml-2 max-w-[40%]">{m.notes}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* About */}
        {help && (
          <div className="border-t border-ink-500/30 pt-3 text-[11px] font-mono text-ink-300 space-y-2 leading-relaxed">
            <div>{help.about}</div>
            {help.tips.length > 0 && (
              <ul className="space-y-0.5">
                {help.tips.map((t, i) => (
                  <li key={i} className="text-ink-400">· {t}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Sparkline({
  series,
  unit,
  system,
}: {
  series: Array<{ ts: number; v: number }>;
  unit: string;
  system: UnitSystem;
}) {
  const W = 460;
  const H = 80;
  const PAD = 4;
  if (series.length < 2) return null;
  const min = Math.min(...series.map((s) => s.v));
  const max = Math.max(...series.map((s) => s.v));
  const range = max - min || 1;
  const xStep = (W - PAD * 2) / Math.max(1, series.length - 1);
  const points = series.map((p, i) => {
    const x = PAD + i * xStep;
    const y = H - PAD - ((p.v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="border border-ink-500/30 bg-bg-700/40">
      <polyline
        points={points}
        fill="none"
        stroke="#14d6e8"
        strokeWidth="1.5"
        style={{ filter: 'drop-shadow(0 0 2px #14d6e8)' }}
      />
      {series.map((p, i) => {
        const x = PAD + i * xStep;
        const y = H - PAD - ((p.v - min) / range) * (H - PAD * 2);
        return <circle key={i} cx={x} cy={y} r="2" fill="#14d6e8" />;
      })}
    </svg>
  );
}