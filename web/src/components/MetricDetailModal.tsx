import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { METRICS, type GeneticMax, type MetricType } from '@/lib/types';
import { formatDate, formatRelative, formatMetricWithUnit } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, displayValue, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { NeonButton } from './NeonButton';
import { BodyfatMethodPicker } from './BodyfatMethodPicker';

// Metrics that are derived from other data — not user-enterable.
// LEAN_MASS / FFMI live in the API schema's DERIVED_METRICS guard.
// SHOULDER_WAIST_RATIO is web-only (computed from shoulder+waist).
const DERIVED_METRICS: MetricType[] = ['LEAN_MASS', 'FFMI', 'SHOULDER_WAIST_RATIO'];

function stepForUnit(unit: string, system: UnitSystem): number {
  if (unit === 's' || unit === 'ms') return 1;
  if (unit === 'h') return 0.25;
  if (unit === 'kg' || unit === 'lb') return system === 'IMPERIAL' ? 1 : 0.1;
  if (unit === 'cm' || unit === 'in') return system === 'IMPERIAL' ? 0.25 : 0.1;
  if (unit === 'ml' || unit === 'fl oz') return system === 'IMPERIAL' ? 1 : 10;
  if (unit === 'g') return 1;
  if (unit === 'kcal') return 10;
  if (unit === '/10') return 1;
  if (unit === 'bpm') return 1;
  if (unit === '%') return 0.1;
  return 0.1;
}

// Placeholder hints per metric so the empty input feels guided.
const PLACEHOLDERS: Partial<Record<MetricType, string>> = {
  WEIGHT: 'e.g. 134.0',
  BODY_FAT_PCT: 'e.g. 14.5',
  WAIST: 'e.g. 81',
  BICEP: 'e.g. 38.0 (legacy)',
  BICEP_FLEXED: 'e.g. 38.0',
  BICEP_RELAXED: 'e.g. 36.0',
  CHEST: 'e.g. 102',
  SHOULDER: 'e.g. 122',
  QUAD: 'e.g. 58',
  CALF: 'e.g. 39',
  FOREARM: 'e.g. 30',
  NECK: 'e.g. 38',
  HRV: 'e.g. 62',
  RESTING_HR: 'e.g. 58',
  VO2_MAX: 'e.g. 48',
  BENCH_1RM: 'e.g. 102.5',
  SQUAT_1RM: 'e.g. 145',
  DEADLIFT_1RM: 'e.g. 180',
  OHP_1RM: 'e.g. 65',
  PULLUP_1RM: 'e.g. 25',
  POWERLIFT_TOTAL: 'e.g. 425',
  ONE_MILE_TIME: 'e.g. 437 (seconds)',
  FIVE_K_TIME: 'e.g. 1320 (seconds)',
  PLANK_HOLD: 'e.g. 120 (seconds)',
  L_SIT_HOLD: 'e.g. 45 (seconds)',
  DEAD_HANG: 'e.g. 95 (seconds)',
  PUSHUP_MAX: 'e.g. 35',
  PULLUP_MAX: 'e.g. 12',
  SLEEP_HOURS: 'e.g. 7.5',
  SLEEP_QUALITY: 'e.g. 7',
  CALORIES: 'e.g. 2400',
  PROTEIN_G: 'e.g. 165',
  WATER_ML: 'e.g. 2800',
  MOOD: 'e.g. 7',
  ENERGY: 'e.g. 6',
  SORENESS: 'e.g. 3',
  STRESS: 'e.g. 4',
};

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
  BICEP: { about: 'Deprecated alias — use BICEP_FLEXED or BICEP_RELAXED explicitly.', tips: [] },
  BICEP_FLEXED: { about: 'Bicep circumference at peak contraction (flexed). Genetic ceiling ~2.7× wrist per Casey Butt (16.2" for a 6" frame).', tips: ['Measure at the largest point of the bicep with arm flexed and elbow pinned.', 'Same time of day as other measurements — pump / hydration swings the reading.'] },
  BICEP_RELAXED: { about: 'Bicep circumference with arm hanging at side, no contraction. Tracks arm size without pump effects — typically 1.5-2cm smaller than flexed for the same arm.', tips: ['Use RELAXED if you want to see real arm growth without pump noise.', 'Genetic ceiling ~0.92× the flexed formula (2.7 × 0.92 × wrist).'] },
  CHEST: { about: 'Genetic ceiling based on wrist + height.', tips: [] },
  SHOULDER: { about: 'Shoulder width (biacromial breadth, distance between the two shoulders) — bone structure + muscle.', tips: [] },
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
  DEAD_HANG: { about: 'Longest dead hang from a pull-up bar, in seconds.', tips: ['Active shoulders (don\'t shrug) — passive hang is harder on the joint.', 'Warm up shoulders + grip before max attempts.'] },
  PUSHUP_MAX: { about: 'Max unbroken push-ups in a single set.', tips: [] },
  PULLUP_MAX: { about: 'Max unbroken pull-ups in a single set.', tips: [] },
  RESTING_HR: { about: 'Resting heart rate in bpm. Lower generally indicates better cardiovascular fitness.', tips: [] },
  WEIGHT: { about: 'Total body weight.', tips: [] },
  WAIST: { about: 'Waist circumference at navel.', tips: [] },
};

export function MetricDetailModal({ open, onClose, metric }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const meta = metric ? METRICS[metric] : null;

  const q = useQuery({
    queryKey: ['metric-history', metric],
    queryFn: () =>
      api<{ items: Measurement[] }>(`/measurements?metric=${metric}&limit=200`),
    enabled: !!metric,
  });

  // Genetic-max table for the current metric. The /genetic-max
  // endpoint returns ALL of the user's maxes (small set, ~10
  // rows); filtering client-side is fine. Same queryKey as
  // /measurements' page so an override here invalidates the
  // dashboard gauges + /measurements page alike.
  const maxQ = useQuery({
    queryKey: ['genetic-max'],
    queryFn: () => api<{ items: GeneticMax[] }>('/genetic-max'),
    enabled: !!metric,
  });
  const currentMax = (maxQ.data?.items ?? []).find((g) => g.metric === metric);

  const [draftValue, setDraftValue] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [maxDraft, setMaxDraft] = useState('');
  const [logError, setLogError] = useState<string | null>(null);
  // BODY_FAT_PCT logs route through BodyfatMethodPicker so the user
  // can pick the actual method (DEXA / BIA / calipers / Navy) — the
  // source then flows to the api and the morning report weights it
  // by confidence. Other metrics use the inline form below.
  const [showBodyfatPicker, setShowBodyfatPicker] = useState(false);

  const isLoggable = metric != null && !DERIVED_METRICS.includes(metric);

  const logM = useDelayedMutation({
    mutationFn: () => {
      const inputValue = Number(draftValue);
      if (!Number.isFinite(inputValue) || inputValue <= 0) {
        throw new Error('Enter a positive number.');
      }
      const storageUnit = displayUnit(meta!.unit, system);
      const stored = convertForStorage(inputValue, storageUnit, system);
      return api('/measurements', {
        method: 'POST',
        body: {
          metric,
          value: stored.value,
          notes: draftNotes || undefined,
        },
      });
    },
    onSuccess: () => {
      setDraftValue('');
      setDraftNotes('');
      setLogError(null);
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['metric-history', metric] });
      qc.invalidateQueries({ queryKey: ['weigh-in'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      qc.invalidateQueries({ queryKey: ['frame'] });
      qc.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (err: Error) => setLogError(err.message ?? 'Could not save.'),
  }, 800);

  // Genetic-max overrides. Lifted from the old /measurements page
  // so the modal owns the full "log + history + override" stack
  // and the page can be a flat grid of metric tiles (no per-metric
  // detail panel). Set-from-current shortcuts (+10/20/50%) buffer
  // the latest measurement so the user can set a sensible ceiling
  // without doing the math themselves.
  const setMaxM = useDelayedMutation({
    mutationFn: (value: number) =>
      api('/genetic-max', {
        method: 'PUT',
        body: { items: [{ metric: metric!, value, source: 'MANUAL' }] },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  }, 800);

  const setMaxFromLatestM = useDelayedMutation({
    mutationFn: (bufferPct: number) => {
      const items = q.data?.items ?? [];
      const sorted = items.slice().sort(
        (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
      );
      const latest = sorted[sorted.length - 1];
      if (!latest) throw new Error('No measurements to base max on');
      const buffered = latest.value * (1 + bufferPct / 100);
      return api('/genetic-max', {
        method: 'PUT',
        body: {
          items: [{ metric: metric!, value: Number(buffered.toFixed(2)), source: 'MANUAL' }],
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
    },
  }, 800);

  const delMaxM = useDelayedMutation({
    mutationFn: () => api(`/genetic-max/${metric}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['genetic-max'] }),
  }, 800);

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

  // Reset the inline log form when the modal closes or switches metrics
  // so reopening doesn't show stale input from a different metric.
  useEffect(() => {
    if (!open) {
      setDraftValue('');
      setDraftNotes('');
      setMaxDraft('');
      setLogError(null);
      setShowBodyfatPicker(false);
    }
  }, [open, metric]);

  if (!metric || !meta) return null;

  const help = METRIC_HELP[metric];

  return (
    // max-w-lg gives room for the log + history + override blocks
    // side-by-side-ish on wide modals without forcing horizontal
    // scroll on smaller viewports. The internal scroll (Modal
    // already does overflow-y-auto) keeps everything reachable.
    <Modal open={open} onClose={onClose} title={meta.label} width="max-w-lg" hideCloseButton>
      <div className="space-y-4">
        {/* Top stats: latest / range / trend. Three small cards
            in a row — gives the user a one-glance summary before
            they start logging or scrolling history. */}
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

        {/* ── 1. LOG (first, per user spec) ────────────────────────────
            Inline log — only for metrics the user can actually enter.
            DERIVED_METRICS (LEAN_MASS / FFMI / V-TAPER) are computed
            from other data and rejected by the server. BODY_FAT_PCT
            routes through the method picker instead of a single
            number input — the source tag then flows through to the
            morning report's confidence weighting. */}
        {isLoggable && metric !== 'BODY_FAT_PCT' && (
          <div className="border border-neon-lime/40 bg-neon-lime/5 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neon-lime mb-2">
              Log new {meta.shortLabel}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                step={stepForUnit(meta.unit, system)}
                value={draftValue}
                onChange={(e) => {
                  setDraftValue(e.target.value);
                  setLogError(null);
                }}
                placeholder={PLACEHOLDERS[metric!] ?? 'value'}
                className="flex-1 min-w-[100px] bg-bg-700/60 border border-ink-500/40 focus:border-neon-lime focus:outline-none px-2 py-1.5 text-sm font-mono text-ink-100 placeholder:text-ink-500 placeholder:italic"
              />
              <span className="text-[10px] font-mono text-ink-300 shrink-0">
                {displayUnit(meta.unit, system)}
              </span>
              <input
                type="text"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="notes (optional)"
                className="flex-1 min-w-[140px] bg-bg-700/60 border border-ink-500/40 focus:border-neon-lime focus:outline-none px-2 py-1.5 text-sm font-mono text-ink-100 placeholder:text-ink-500 placeholder:italic"
              />
              <NeonButton
                size="sm"
                variant="lime"
                loading={logM.isPending}
                onClick={() => logM.run()}
                disabled={!draftValue.trim()}
              >
                Log
              </NeonButton>
            </div>
            {logError && (
              <div className="text-[10px] font-mono mt-1" style={{ color: '#ff2bd6' }}>
                {logError}
              </div>
            )}
            <div className="text-[9px] font-mono text-ink-500 mt-1.5">
              Stored in metric units ({meta.unit}); displayed in your preferred system.
            </div>
          </div>
        )}

        {/* BODY_FAT_PCT-specific block: the picker handles input,
            computation, AND submits the source so the morning report
            can weight by confidence. The Mutation below wraps the
            picker callback so the rest of the modal can keep its
            invalidation behaviour identical to other metrics. */}
        {isLoggable && metric === 'BODY_FAT_PCT' && (
          <div className="border-t border-ink-500/30 pt-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
              Log new body fat
            </div>
            <button
              type="button"
              onClick={() => setShowBodyfatPicker(true)}
              className="w-full border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 text-left transition-all hover:bg-neon-cyan/20"
            >
              <div className="font-display tracking-widest text-xs uppercase text-neon-cyan">
                ⚡ Log via method (DEXA / BIA / Calipers / Navy)
              </div>
              <div className="text-[10px] font-mono text-ink-300 mt-1">
                Pick the method you actually used — body-fat % is computed and stored with the
                right confidence tag so the morning report knows how much to weight it.
              </div>
            </button>
            <BodyfatMethodPicker
              open={showBodyfatPicker}
              onClose={() => setShowBodyfatPicker(false)}
              onSubmit={async ({ bfPct, source }) => {
                await api('/measurements', {
                  method: 'POST',
                  body: {
                    metric: 'BODY_FAT_PCT',
                    value: bfPct,
                    notes: undefined,
                    source,
                  },
                });
                qc.invalidateQueries({ queryKey: ['measurements'] });
                qc.invalidateQueries({ queryKey: ['metric-history', metric] });
                qc.invalidateQueries({ queryKey: ['weigh-in'] });
                qc.invalidateQueries({ queryKey: ['achievements'] });
                qc.invalidateQueries({ queryKey: ['frame'] });
                qc.invalidateQueries({ queryKey: ['status'] });
              }}
            />
          </div>
        )}

        {/* ── 2. HISTORY ─────────────────────────────────────────────── */}
        {series.length > 1 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
              History
            </div>
            <Sparkline series={series} unit={meta.unit} system={system} />
          </div>
        )}

        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            All logs
          </div>
          {q.isLoading ? (
            <div className="text-[10px] font-mono text-ink-300">loading…</div>
          ) : (q.data?.items ?? []).length === 0 ? (
            <div className="text-[10px] font-mono text-ink-400 italic">
              No logs yet — log a value above.
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
              {(q.data?.items ?? []).length > 10 && (
                <div className="text-[9px] font-mono text-ink-500 italic text-center pt-1">
                  +{(q.data?.items ?? []).length - 10} older — visit /measurements for full history
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 3. OVERRIDE GENETIC MAX ──────────────────────────────────
            Manual override of the formula-derived genetic max. Lifted
            from the old /measurements page so the modal owns the
            full stack. "Quick set from current" shortcuts (+10/20/50%)
            buffer the latest measurement so the user can set a
            sensible ceiling without doing the math themselves. The
            Clear button only appears when an override is currently
            in effect. Same call site as /measurements used to use,
            with the same queryKey (['genetic-max']) so a single
            invalidateUpdates both the dashboard gauges and the
            modal. */}
        <div className="border border-neon-amber/40 bg-neon-amber/5 p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-amber mb-2">
            Override Genetic Max
          </div>
          {currentMax && (
            <div className="flex items-center justify-between text-[11px] font-mono mb-3 pb-2 border-b border-neon-amber/20">
              <span className="text-ink-300">Current:</span>
              <span className="text-neon-amber font-display text-base">
                {displayValue(currentMax.value, meta.unit, system)}
              </span>
              <span className="text-[9px] text-ink-500 uppercase tracking-widest">
                {currentMax.source}
              </span>
            </div>
          )}
          {series.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] font-mono text-ink-400 mb-1">
                Quick set from latest + buffer:
              </div>
              <div className="flex flex-wrap gap-2">
                {[10, 20, 50].map((pct) => {
                  const sorted = (q.data?.items ?? []).slice().sort(
                    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
                  );
                  const latest = sorted[sorted.length - 1];
                  if (!latest) return null;
                  const buffered = latest.value * (1 + pct / 100);
                  return (
                    <button
                      key={pct}
                      onClick={() => setMaxFromLatestM.run(pct)}
                      disabled={setMaxFromLatestM.isPending}
                      className="btn-ghost"
                    >
                      {setMaxFromLatestM.isPending ? '…' : `${displayValue(buffered, meta.unit, system)} (+${pct}%)`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[120px]">
              <label className="text-[10px] font-mono uppercase tracking-widest text-neon-amber/80 block mb-1">
                Manual max ({displayUnit(meta.unit, system)})
              </label>
              <input
                type="number"
                inputMode="decimal"
                step={stepForUnit(meta.unit, system)}
                value={maxDraft}
                onChange={(e) => setMaxDraft(e.target.value)}
                placeholder={currentMax ? displayValue(currentMax.value, meta.unit, system) : 'auto'}
                className="w-full bg-bg-700/60 border border-ink-500/40 focus:border-neon-amber focus:outline-none px-2 py-1.5 text-sm font-mono text-ink-100 placeholder:text-ink-500 placeholder:italic"
              />
            </div>
            <NeonButton
              size="sm"
              variant="amber"
              onClick={() => {
                if (!maxDraft) return;
                const n = Number(maxDraft);
                if (!Number.isFinite(n)) return;
                const stored = convertForStorage(n, displayUnit(meta.unit, system), system);
                setMaxM.run(stored.value);
                setMaxDraft('');
              }}
              loading={setMaxM.isPending}
              disabled={!maxDraft}
              icon="⚡"
              loadingText="…"
            >
              Set
            </NeonButton>
            {currentMax?.source === 'MANUAL' && (
              <button
                onClick={() => delMaxM.run()}
                disabled={delMaxM.isPending}
                className="btn-ghost"
              >
                {delMaxM.isPending ? '…' : 'Clear'}
              </button>
            )}
          </div>
          <div className="text-[9px] font-mono text-ink-500 mt-1.5">
            A manual override takes priority over the formula-derived value (shown on the dashboard).
          </div>
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