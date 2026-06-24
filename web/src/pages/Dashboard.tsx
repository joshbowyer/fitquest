import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Gauge } from '@/components/Gauge';
import { IdealGauge } from '@/components/IdealGauge';
import { MetricDetailModal } from '@/components/MetricDetailModal';
import { Panel } from '@/components/Panel';
import { ProgressBar } from '@/components/ProgressBar';
import { BossBar } from '@/components/BossBar';
import { WeighInPanel } from '@/components/WeighInPanel';
import { TodayHabitsPanel } from '@/components/TodayHabitsPanel';
import { RecoveryPanel } from '@/components/RecoveryPanel';
import { MorningReportCard } from '@/components/MorningReportCard';
import { CheckInsPanel } from '@/components/CheckInsPanel';
import { InsightsPanel } from '@/components/InsightsPanel';
import { FramePanel } from '@/components/FramePanel';
import { RoutinePanel } from '@/components/RoutinePanel';
import { HeartsCard } from '@/components/HeartsCard';
import { NutritionWidget } from '@/components/NutritionWidget';
import { HabitsWidget } from '@/components/HabitsWidget';
import { useAuth } from '@/lib/auth';
import {
  CLASS_META,
  METRICS,
  METRICS_BY_CATEGORY,
  type GeneticMax,
  type Measurement,
  type Achievement,
  type Raid,
  type Skill,
} from '@/lib/types';
import { formatRelative, formatSeconds } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { WORLD_COLOR_HEX as CLASS_COLOR_HEX } from '@/lib/quest';
import { idealBandsFor, monotonicBandsFor, SHO_WAIST_RATIO } from '@/lib/metricBands';
import { BetterGauge } from '@/components/BetterGauge';
import { MetricTrendChart } from '@/components/MetricTrendChart';
import { Link } from 'react-router-dom';

// Metrics that use the IdealGauge (top-center = elite, fan-out bands).
// Body fat / HRV are "ideal in the middle"; 1mi / 5K are threshold-mode
// (less is better) — both supported by IdealGauge.
const idealMetricKeys = new Set([
  'BODY_FAT_PCT',
  'HRV',
  'ONE_MILE_TIME',
  'FIVE_K_TIME',
]);

// Metrics that use the BetterGauge (monotonic, more is better).
const monotonicMetricKeys = new Set([
  'VO2_MAX',
  'PLANK_HOLD',
  'PUSHUP_MAX',
  'PULLUP_MAX',
  'SHOULDER_WAIST_RATIO',
]);

// Categories displayed as gauges on the stat sheet. New habit categories
// (SLEEP/NUTRITION/WELLNESS) are surfaced in TodayHabitsPanel instead.
const STAT_SHEET_CATEGORIES: Array<keyof typeof METRICS_BY_CATEGORY> = [
  'HYPERTROPHY', 'STRENGTH', 'BODY_COMP', 'CARDIO', 'CALISTHENICS',
];

const CATEGORY_LABELS: Record<string, { label: string; variant: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet'; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }> = {
  HYPERTROPHY: { label: 'HYPERTROPHY', variant: 'magenta', color: 'magenta' },
  STRENGTH: { label: 'STRENGTH', variant: 'cyan', color: 'cyan' },
  BODY_COMP: { label: 'BODY COMP', variant: 'lime', color: 'lime' },
  CARDIO: { label: 'CARDIO', variant: 'amber', color: 'amber' },
  CALISTHENICS: { label: 'CALISTHENICS', variant: 'violet', color: 'violet' },
};

export function DashboardPage() {
  const { user } = useAuth();
  const system = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
  const qc = useQueryClient();

  const measurementsQ = useQuery({
    queryKey: ['measurements', 'latest'],
    queryFn: () => api<{ items: Measurement[] }>('/measurements/latest'),
  });
  const geneticQ = useQuery({
    queryKey: ['genetic-max'],
    queryFn: () => api<{ items: GeneticMax[] }>('/genetic-max'),
  });
  const prsQ = useQuery({
    queryKey: ['prs', 'best'],
    queryFn: () => api<{ items: any[] }>('/prs/best'),
  });
  const achievementsQ = useQuery({
    queryKey: ['achievements'],
    queryFn: () => api<{ items: Achievement[] }>('/achievements'),
  });
  const raidQ = useQuery({
    queryKey: ['raid', 'active'],
    queryFn: () => api<{ raid: Raid | null }>('/raids/active'),
  });
  const [recomputeToast, setRecomputeToast] = useState<string | null>(null);
  const [detailMetric, setDetailMetric] = useState<import('@/lib/types').MetricType | null>(null);

  if (!user) return null;

  const cls = user.class ? CLASS_META[user.class] : null;
  const latestByMetric = new Map<string, Measurement>();
  for (const m of measurementsQ.data?.items || []) latestByMetric.set(m.metric, m);
  // Inject computed values for derived metrics so the gauges populate
  // even though the user never logs them directly. LEAN_MASS and FFMI
  // are auto-derived from weight + body fat + height; their values
  // aren't persisted in the Measurement table.
  if (user.weightKg != null && user.bodyFatPct != null) {
    // Creatine water subtraction only applies when the user has logged
    // Creatine on ≥3 of the last 7 days. The flag is server-derived so
    // we trust it; creatine the boolean is just legacy.
    const creatineActive = user.creatineActive ?? false;
    const lbm = Math.max(
      0,
      user.weightKg * (1 - user.bodyFatPct / 100) - (creatineActive ? 1.5 : 0),
    );
    if (!latestByMetric.has('LEAN_MASS')) {
      latestByMetric.set('LEAN_MASS', {
        id: 'derived:lean_mass',
        metric: 'LEAN_MASS',
        value: lbm,
        unit: 'kg',
        notes: creatineActive ? `auto: weight × (1 − BF%) − 1.5 kg creatine water` : null,
        recordedAt: new Date().toISOString(),
      } as Measurement);
    }
    if (user.heightCm != null && !latestByMetric.has('FFMI')) {
      const ffmi = lbm / Math.pow(user.heightCm / 100, 2);
      latestByMetric.set('FFMI', {
        id: 'derived:ffmi',
        metric: 'FFMI',
        value: ffmi,
        unit: '',
        notes: null,
        recordedAt: new Date().toISOString(),
      } as Measurement);
    }
  }

  // Shoulder:Waist ratio (V-taper indicator). Derived from the latest
  // SHOULDER and WAIST measurements. Display in user units so the
  // ratio is unitless regardless of which system.
  const shoulder = latestByMetric.get('SHOULDER')?.value ?? null;
  const waist = latestByMetric.get('WAIST')?.value ?? null;
  if (shoulder != null && waist != null && waist > 0) {
    // SHOULDER is stored in cm; waist can be in cm (waist circumference
    // uses cm). They cancel out so the ratio is unitless.
    const ratio = shoulder / waist;
    if (!latestByMetric.has('SHOULDER_WAIST_RATIO')) {
      latestByMetric.set('SHOULDER_WAIST_RATIO', {
        id: 'derived:sho_waist',
        metric: 'SHOULDER_WAIST_RATIO' as any,
        value: ratio,
        unit: '',
        notes: 'auto: shoulder ÷ waist',
        recordedAt: new Date().toISOString(),
      } as any);
    }
  }
  const maxByMetric = new Map<string, GeneticMax>();
  for (const g of geneticQ.data?.items || []) maxByMetric.set(g.metric, g);

  const unlocked = (achievementsQ.data?.items || []).filter((a) => a.unlocked);

  return (
    <Layout>
      <PageHeader
        title="// Stat Sheet"
        subtitle={`${user.classDisplay ?? cls?.label ?? 'Unclassed'} // ${user.username}`}
        action={
          <Link to="/settings" className="btn-ghost text-[10px]">
            ⚙ Settings
          </Link>
        }
      />

      {/* Top hero: character + raid + hearts. All same row, same
          height. HeartsCard returns null in Casual mode so the
          right-hand slot just collapses to whatever's there. */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4 md:mb-6">
        <Panel variant="cyan" className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/70">Character</div>
              <div className="font-display text-2xl md:text-3xl tracking-widest neon-text-cyan mt-1 truncate">
                {user.username}
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className="font-display text-lg md:text-xl tracking-wider"
                  style={
                    cls
                      ? {
                          color:
                            CLASS_COLOR_HEX[cls.color as keyof typeof CLASS_COLOR_HEX] ?? '#9bff5c',
                          textShadow: `0 0 10px ${
                            CLASS_COLOR_HEX[cls.color as keyof typeof CLASS_COLOR_HEX] ?? '#9bff5c'
                          }cc, 0 0 2px ${
                            CLASS_COLOR_HEX[cls.color as keyof typeof CLASS_COLOR_HEX] ?? '#9bff5c'
                          }`,
                        }
                      : { color: '#cbd5e1' }
                  }
                >
                  {user.classDisplay ?? cls?.label ?? 'Unclassed'}
                </span>
                {cls?.tagline && (
                  <span className="text-[10px] font-mono italic text-neon-lime/80">
                    — {cls.tagline}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Level</div>
              <div className="font-display text-4xl md:text-5xl neon-text-cyan leading-none">{user.level}</div>
              <div className="text-xs font-mono text-ink-300 mt-2">{user.xp} XP</div>
            </div>
          </div>
          <div className="mt-3">
            <ProgressBar
              value={user.progress?.pct ?? 0}
              variant="cyan"
              showText
              label={`XP to L${user.level + 1}`}
            />
          </div>
        </Panel>

        <Panel variant="magenta" title="Raid" scanline>
          {raidQ.data?.raid ? (
            <>
              <BossBar
                bossName={raidQ.data.raid.bossName}
                hp={raidQ.data.raid.bossHp}
                maxHp={raidQ.data.raid.bossMaxHp}
                status={raidQ.data.raid.status}
              />
              <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
                {raidQ.data.raid.contributions.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex justify-between text-[11px] font-mono">
                    <span className="text-ink-200">{c.user.username}</span>
                    <span className="neon-text-magenta">−{c.damage}</span>
                  </div>
                ))}
              </div>
              <Link to="/party" className="block mt-2 text-center text-[10px] font-display tracking-widest neon-text-cyan hover:underline">
                → MANAGE RAID
              </Link>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="text-xs font-mono text-ink-300">No active raid</div>
              <Link to="/party" className="inline-block mt-2 text-[10px] font-display tracking-widest neon-text-cyan hover:underline">
                → ASSEMBLE PARTY
              </Link>
            </div>
          )}
        </Panel>

        <HeartsCard />
      </div>

      {/* Morning briefing (LLM-generated, per-user per-day).
          Renders general advice at the top, plus a small grid of
          per-metric insights that ALSO appear inline in the
          relevant dashboard panel below. The same data row is
          consumed twice (top card + per-metric), which is by
          design — the per-metric slot is a quick read, the top
          card is the full briefing. */}
      <div className="mb-4 md:mb-6">
        <MorningReportCard withMetricInsights />
      </div>

      {/* Daily weigh-in + today + nutrition + habits — quick indicators. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-4 md:mb-6">
        <WeighInPanel />
        <TodayHabitsPanel />
        <NutritionWidget />
        <HabitsWidget />
      </div>

      {/* Recovery trends — HRV + Sleep */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 md:mb-6">
        <Panel variant="magenta" title="HRV — 30 days">
          <MetricTrendChart metric="HRV" days={30} system={system} color="#c45cff" />
        </Panel>
        <Panel variant="cyan" title="Sleep — 30 days">
          <MetricTrendChart metric="SLEEP_HOURS" days={30} system={system} color="#9bff5c" />
        </Panel>
        <Panel variant="amber" title="Sleep quality — 30 days">
          <MetricTrendChart metric="SLEEP_QUALITY" days={30} system={system} color="#ffc34d" />
        </Panel>
      </div>

      {/* Routine (weekly training goal + streak) */}
      <div className="mb-4 md:mb-6">
        <CheckInsPanel />
      </div>

      {/* Routine + Recovery + Frame — three side-by-side panels.
          Replaces the old "HeartsCard + RoutinePanel + How streaks work"
          row; HeartsCard now lives in the top hero, and "How streaks
          work" moves below as a full-width explainer. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
        <RoutinePanel />
        <RecoveryPanel />
        <FramePanel />
      </div>

      {/* How streaks work — full-width explainer below the
          routine/recovery/frame row. Three columns on desktop so
          each clause gets its own column instead of stacking. */}
      <div className="mb-4 md:mb-6 text-[10px] font-mono text-ink-400 leading-relaxed">
        <div className="border border-ink-700/30 p-4">
          <div className="text-ink-300 text-[11px] mb-2 font-display tracking-widest uppercase">
            How streaks work
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
            <p>
              Pick a weekly workout target (1–7). Each week you hit
              your target, your streak extends and you earn a bonus
              applied to XP, gold, and raid damage.
            </p>
            <p>
              <span className="text-neon-lime">No penalty for missing a week.</span>{' '}
              If you skip, the streak resets but you keep your
              longest streak badge. Come back whenever — there are
              no dailies to maintain.
            </p>
            <p className="text-ink-400">
              Bonus scales linearly: streak 1 = ×1.05, streak 5 =
              ×1.25, streak 10+ = ×1.50 (cap).
            </p>
          </div>
        </div>
      </div>

      {/* Insights — full width. Was previously 1/3 Recovery + 2/3 Insights;
          Recovery now lives in the row above, so Insights gets the
          full canvas. */}
      <div className="mb-4 md:mb-6">
        <InsightsPanel />
      </div>

      {/* Stat sheet by category */}
      {STAT_SHEET_CATEGORIES.map((cat) => {
        const metrics = METRICS_BY_CATEGORY[cat];
        const cfg = CATEGORY_LABELS[cat];
        if (!cfg) return null;
        const isBodyComp = cat === 'BODY_COMP';
        const gaugeMetrics = isBodyComp ? metrics.filter((m) => m !== 'WAIST') : metrics;
        return (
          <Panel
            key={cat}
            title={cfg.label}
            variant={cfg.variant}
            className="mb-6"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4 justify-items-center">
              {gaugeMetrics.map((m) => {
                const meta = METRICS[m];
                const latest = latestByMetric.get(m);
                const max = maxByMetric.get(m);
                const min = meta.defaultMin;
                const value = latest?.value ?? null;
                const idealBands = idealBandsFor(m);
                const monoBands = monotonicMetricKeys.has(m)
                  ? m === 'SHOULDER_WAIST_RATIO'
                    ? SHO_WAIST_RATIO
                    : monotonicBandsFor(m)
                  : null;
                // Ideal-radial metrics (body fat, HRV, 1mi, 5K).
                if (idealMetricKeys.has(m) && idealBands) {
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDetailMetric(m)}
                      className="cursor-pointer hover:brightness-125 transition-all"
                      title="Click for details"
                    >
                      <IdealGauge
                        metric={m}
                        value={value}
                        min={idealBands.min}
                        eliteMin={idealBands.eliteMin}
                        eliteMax={idealBands.eliteMax}
                        healthyMin={idealBands.healthyMin}
                        healthyMax={idealBands.healthyMax}
                        max={idealBands.max}
                        subtitle={idealBands.subtitle}
                        color="lime"
                        size={170}
                        midpoint={idealBands.midpoint}
                        leftSpan={idealBands.leftSpan}
                        rightSpan={idealBands.rightSpan}
                      />
                    </button>
                  );
                }
                // Monotonic "more is better" metrics (VO2, plank,
                // pushups, pullups, shoulder:waist).
                if (monotonicMetricKeys.has(m) && monoBands) {
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDetailMetric(m)}
                      className="cursor-pointer hover:brightness-125 transition-all"
                      title="Click for details"
                    >
                      <BetterGauge
                        metric={m}
                        value={value}
                        min={monoBands.min}
                        max={monoBands.max}
                        eliteMin={monoBands.eliteMin}
                        healthyMin={monoBands.healthyMin}
                        subtitle={monoBands.subtitle}
                        color="cyan"
                        size={170}
                      />
                    </button>
                  );
                }
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDetailMetric(m)}
                    className="cursor-pointer hover:brightness-125 transition-all"
                    title="Click for details"
                  >
                    <Gauge
                      metric={m}
                      subtitle={
                        m === 'POWERLIFT_TOTAL' ? 'Squat + Bench + Deadlift' :
                        m === 'BENCH_1RM' ? 'Bench press 1-rep max' :
                        m === 'SQUAT_1RM' ? 'Back squat 1-rep max' :
                        m === 'DEADLIFT_1RM' ? 'Conventional deadlift 1RM' :
                        m === 'OHP_1RM' ? 'Standing overhead press 1RM' :
                        m === 'PULLUP_1RM' ? 'Heaviest weighted pull-up' :
                        undefined
                      }
                      value={value}
                      min={min}
                      max={max?.value ?? meta.defaultMin * 1.5}
                      color={cfg.color}
                      size={170}
                    />
                  </button>
                );
              })}
            </div>
          </Panel>
        );
      })}

      {/* Recent PRs + Achievements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel variant="lime" title="Recent PRs">
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(prsQ.data?.items || []).slice(0, 10).map((p) => {
              // PR weight is stored in kg; convert at the edge for
              // imperial users. Plank / l-sit are time-based (seconds).
              // Value is the Epley 1RM estimate (weight × (1 + reps/30)),
              // so we label it "1RM est" so it doesn't get confused
              // with the actual weight the user lifted — which is
              // smaller for multi-rep sets.
              const isTime = p.exercise.toLowerCase().includes('plank') || p.exercise.toLowerCase().includes('l-sit');
              const system: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
              const weightDisplay = isTime
                ? formatSeconds(p.value)
                : (() => {
                    const d = convertForDisplay(p.value, 'kg', system);
                    return `${d.value.toFixed(d.value >= 100 ? 0 : 1)} ${d.unit}`;
                  })();
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-sm font-mono border-b border-neon-lime/10 pb-1"
                >
                  <span className="text-ink-100 truncate">{p.exercise}</span>
                  <span className="neon-text-lime text-right whitespace-nowrap">
                    {weightDisplay}
                    {!isTime && (
                      <span
                        className="text-[9px] text-ink-400 ml-1 normal-case"
                        title="Estimated 1RM (Epley): weight × (1 + reps/30)"
                      >
                        1RM
                      </span>
                    )}
                  </span>
                  <span className="text-ink-400 text-[10px] whitespace-nowrap text-right">
                    {formatRelative(p.achievedAt)}
                  </span>
                </div>
              );
            })}
            {(prsQ.data?.items || []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-4">No PRs logged yet.</div>
            )}
          </div>
        </Panel>

        <Panel variant="amber" title="Achievements">
          <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
            {unlocked.slice(0, 12).map((a) => (
              <div key={a.id} className="border border-neon-amber/30 p-2 bg-neon-amber/5">
                <div className="font-display text-xs tracking-wider neon-text-amber">{a.name}</div>
                <div className="text-[10px] text-ink-300 font-mono mt-0.5">{a.description}</div>
                <div className="text-[9px] text-ink-400 font-mono mt-1">+{a.points} pts</div>
              </div>
            ))}
            {unlocked.length === 0 && (
              <div className="col-span-2 text-xs text-ink-300 font-mono text-center py-4">
                Complete a workout to unlock your first achievement.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <MetricDetailModal
        open={!!detailMetric}
        onClose={() => setDetailMetric(null)}
        metric={detailMetric}
      />
    </Layout>
  );
}
