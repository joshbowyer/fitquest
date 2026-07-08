import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Gauge } from '@/components/Gauge';
import { IdealGauge } from '@/components/IdealGauge';
import { MetricDetailModal } from '@/components/MetricDetailModal';
import { Panel } from '@/components/Panel';
import { ProgressBar } from '@/components/ProgressBar';
import { BossBar } from '@/components/BossBar';
import { WeighInPanel } from '@/components/WeighInPanel';
import { RecoveryPanel } from '@/components/RecoveryPanel';
import { MorningReportCard } from '@/components/MorningReportCard';
import { HomeBaseCard } from '@/components/HomeBaseCard';
import { PortalLeakCard } from '@/components/PortalLeakCard';
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
  type MetricType,
} from '@/lib/types';
import { formatRelative, formatSeconds } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { WORLD_COLOR_HEX as CLASS_COLOR_HEX } from '@/lib/quest';
import { idealBandsFor, monotonicBandsFor, SHO_WAIST_RATIO } from '@/lib/metricBands';
import { BetterGauge } from '@/components/BetterGauge';
import { MetricTrendChart } from '@/components/MetricTrendChart';
import { previewMax } from '@/lib/geneticMax';
import { Link } from 'react-router-dom';

// Metrics that use the IdealGauge (top-center = elite, fan-out bands).
// Body fat / HRV / RHR are "ideal in the middle"; 1mi / 5K are
// threshold-mode (less is better) — both supported by IdealGauge.
const idealMetricKeys = new Set([
  'BODY_FAT_PCT',
  'HRV',
  'RESTING_HR',
  'ONE_MILE_TIME',
  'FIVE_K_TIME',
]);

// Metrics that use the BetterGauge (monotonic, more is better).
const monotonicMetricKeys = new Set([
  'VO2_MAX',
  'PLANK_HOLD',
  'L_SIT_HOLD',
  'DEAD_HANG',
  'PUSHUP_MAX',
  'PULLUP_MAX',
  'SHOULDER_WAIST_RATIO',
]);

// Categories displayed as gauges on the stat sheet. New habit categories
// (SLEEP/NUTRITION/WELLNESS) are surfaced in CheckInsPanel instead.
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

/**
 * CalisthenicsRadial — circular progress ring for the CALISTHENICS
 * stat-sheet panel. Shows the user's PHANTOM tree mastery as a
 * fraction of the 42 v1 calisthenics skills. The ring fills with
 * neon-violet; the center text shows X/42 and the % underneath.
 *
 * For non-PHANTOM users the radial still populates (it counts
 * PHANTOM skills unlocked regardless of the user's class), but
 * the caption hints they could pick PHANTOM to grow this number
 * via the calisthenics test unlocks.
 *
 * Sizing: 140px diameter ring; the outer text stays readable at
 * the dashboard's typical 1/4-row width (≥360px).
 */
function formatHoldDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function CalisthenicsRadial({
  unlocked,
  total,
  pct,
  className,
  recentName,
  deadHangPr,
  bestHoldPr,
}: {
  unlocked: number;
  total: number;
  pct: number;
  className: string | null;
  recentName?: string | null;
  // Best Dead Hang HOLD PR — the headline "how long can you hang"
  // stat. Value is duration in seconds; null if no Dead Hang
  // sets have been logged yet.
  deadHangPr: { valueSec: number; achievedAt: string } | null;
  // Fallback: longest static-hold PR across any calisthenics
  // exercise (Plank, L-Sit, Side Plank, etc). Used when the
  // user hasn't logged a Dead Hang yet so the chip doesn't
  // look empty.
  bestHoldPr: { exercise: string; valueSec: number; achievedAt: string } | null;
}) {
  const size = 140;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Clamp + floor at 0; the visual gap at pct=0 is fine (no ring fill).
  const safePct = Math.max(0, Math.min(1, pct));
  const dash = c * safePct;
  // Tailwind safelist (already in tailwind.config.js) ensures these
  // dynamic class strings survive purge.
  const strokeClass = 'stroke-neon-violet';
  const trackClass = 'stroke-neon-violet/15';
  const labelClass = 'text-neon-violet';
  const dimClass = 'text-ink-400';
  const isPhatom = className === 'PHANTOM';
  return (
    <div className="flex flex-col items-center gap-1.5" title={recentName ? `Latest unlock: ${recentName}` : 'No calisthenics skills unlocked yet'}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className={trackClass}
          />
          {/* Fill — uses stroke-dasharray for the arc effect */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            className={strokeClass}
          />
        </svg>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`text-2xl font-display tracking-tight ${labelClass}`}>
            {unlocked}
            <span className={`text-sm ${dimClass}`}>/{total}</span>
          </div>
          <div className={`text-[10px] font-mono uppercase tracking-widest ${dimClass}`}>
            {Math.round(safePct * 100)}%
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className={`text-[10px] font-mono uppercase tracking-widest ${labelClass}`}>
          Calisthenics mastery
        </div>
        {!isPhatom && (
          <div className={`text-[9px] font-mono ${dimClass} text-center max-w-[180px]`}>
            Pick PHANTOM to grow this via test unlocks
          </div>
        )}
        {isPhatom && recentName && (
          <div className={`text-[9px] font-mono ${dimClass} text-center max-w-[180px] truncate`}>
            Latest: {recentName}
          </div>
        )}
        {/* Hold PR chip — headline "how long can you hang" stat.
            Dead Hang takes priority; falls back to the longest
            static hold across any calisthenics exercise if the
            user hasn't logged Dead Hang yet. Hidden entirely when
            no hold PR exists. */}
        {(deadHangPr || bestHoldPr) && (
          <div
            className={`mt-1 px-2 py-1 border border-neon-violet/40 bg-neon-violet/5 text-[10px] font-mono ${labelClass}`}
            title={
              deadHangPr
                ? `Dead Hang PR achieved ${formatRelative(deadHangPr.achievedAt)}`
                : `Best hold (${bestHoldPr!.exercise}) achieved ${formatRelative(bestHoldPr!.achievedAt)}`
            }
          >
            {deadHangPr
              ? <>Dead Hang PR: <span className="text-ink-100">{formatHoldDuration(deadHangPr.valueSec)}</span></>
              : <>Best Hold ({bestHoldPr!.exercise}): <span className="text-ink-100">{formatHoldDuration(bestHoldPr!.valueSec)}</span></>}
          </div>
        )}
      </div>
    </div>
  );
}

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
    queryKey: ['prs', 'recent'],
    queryFn: () => api<{ items: any[] }>('/prs'),
  });
  const achievementsQ = useQuery({
    queryKey: ['achievements'],
    queryFn: () => api<{ items: Achievement[] }>('/achievements'),
  });
  const raidQ = useQuery({
    queryKey: ['raid', 'active'],
    queryFn: () => api<{ raid: Raid | null }>('/raids/active'),
  });
  // Pet roster — render the primary pet in the dashboard's pet card.
  // Refreshed alongside the other dashboard queries.
  const petQ = useQuery({
    queryKey: ['pet'],
    queryFn: () =>
      api<{
        pets: Array<{
          id: string;
          name: string;
          spritePath: string;
          level: number;
          stage: string;
          currentHp: number;
          maxHp: number;
          deployed: boolean;
          faintedAt: string | null;
        }>;
        primaryPetId: string | null;
      }>('/pet'),
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

  // Fallbacks for the four body-comp metrics that have a static
  // User.* field. The new-user flow sets these on Profile (or
  // carries them through from registration) without ever creating
  // a Measurement row, so the dashboard gauges would otherwise
  // show blank until the user logs a measurement. Inject from the
  // User row when no Measurement is present, marked with an
  // `auto:` note so the source is obvious on the InsightsMetrics
  // drill-down.
  const userFallback: Array<[string, number | null | undefined, string, string]> = [
    ['WEIGHT', user.weightKg, 'kg', 'auto: from Profile'],
    ['BODY_FAT_PCT', user.bodyFatPct, '%', 'auto: from Profile'],
    ['WAIST', user.waistCm, 'cm', 'auto: from Profile'],
    ['SHOULDER', user.shoulderCm, 'cm', 'auto: from Profile'],
  ];
  for (const [metric, value, unit, note] of userFallback) {
    if (value == null || !Number.isFinite(value)) continue;
    if (latestByMetric.has(metric as any)) continue;
    latestByMetric.set(metric as any, {
      id: `user:${metric.toLowerCase()}`,
      metric: metric as any,
      value,
      unit,
      notes: note,
      recordedAt: new Date(0).toISOString(), // epoch — sorts to the bottom, signals "not a real measurement"
    } as Measurement);
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

  // Reset a manual override back to the formula value. Same pattern
  // as the Profile page (PUT /genetic-max with source='FORMULA' and
  // the locally-computed previewMax() result), kept inline rather
  // than factored into a shared hook because the call site here and
  // on Profile both invalidate ['genetic-max'] — coalescing into
  // one helper would save a few lines but obscure the per-page
  // mutation wiring. Inlined once keeps the dashboard self-contained.
  const resetMaxM = useMutation<{ ok: boolean }, Error, MetricType>({
    mutationFn: async (metric: MetricType) => {
      const formulaValue = previewMax(
        metric,
        user?.wristCm ?? null,
        user?.ankleCm ?? null,
        user?.heightCm ?? null,
        user?.weightKg ?? null,
      );
      if (formulaValue == null) {
        throw new Error('Formula requires height + wrist + ankle (and weight for strength).');
      }
      return api('/genetic-max', {
        method: 'PUT',
        body: { items: [{ metric, value: formulaValue, source: 'FORMULA' }] },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
    },
  });

  // Calisthenics skill-tree progress for the dashboard radial.
  // Reports against the PHANTOM tree (the calisthenics class) —
  // meaningful even for non-PHANTOM users as a "calisthenics
  // mastery" metric. The radial in the CALISTHENICS panel reads
  // unlocked / total from this query.
  const calisthenicsQ = useQuery({
    queryKey: ['skills', 'calisthenics-progress'],
    queryFn: () =>
      api<{
        className: string | null;
        totalSkills: number;
        unlocked: number;
        pct: number;
        recentUnlocks: Array<{
          skillId: string;
          name: string;
          branch: string | null;
          tier: string;
          achievedAt: string;
        }>;
        bestHoldPr: { exercise: string; valueSec: number; achievedAt: string } | null;
        deadHangPr: { valueSec: number; achievedAt: string } | null;
      }>('/skills/calisthenics-progress'),
  });

  const unlocked = (achievementsQ.data?.items || []).filter((a) => a.unlocked);

  // Pull-to-refresh: tap the top of the page and drag down past
  // the threshold to invalidate all the dashboard's queries in
  // parallel. Mobile-friendly on Capacitor (touch events fire
  // through the WebView); no-op on desktop (the touch listeners
  // never fire). The threshold is generous (80px) so a casual
  // scroll-at-the-top doesn't trigger a refresh.
  // The scrollable element lives inside the shared <Layout> — we
  // resolve it via selector ("main") rather than threading a ref
  // through Layout.
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      // Invalidate every query the dashboard reads so all
      // tiles reload in parallel. We don't fire individual
      // refetch() calls — invalidate is sufficient because the
      // useQuery hooks re-fetch on mount + on stale.
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['prs'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['home-base'] });
      qc.invalidateQueries({ queryKey: ['meals'] });
    },
  });

  return (
    <Layout>
      <PageHeader
        title="// Stat Sheet"
        subtitle={`${user.classDisplay ?? cls?.label ?? 'Unclassed'} // ${user.username}`}
        action={(
          <>
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
            <div className="flex items-center gap-2">
              <Link to="/calendar" className="btn-ghost text-[10px]">
                ◷ Calendar
              </Link>
            </div>
          </>
        )}
      />

        {/* Top hero: character + raid + hearts + home-base. All same
          row, same height, at lg breakpoint. On smaller screens they
          stack. HeartsCard always renders (both Casual and Hardcore)
          with mode-appropriate content — see HeartsCard.tsx. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4 md:mb-6">
        <Panel variant="cyan" className="lg:col-span-1">
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
                  {cls?.label ?? 'Unclassed'}
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
              <div className="font-display text-3xl md:text-4xl neon-text-cyan leading-none">{user.level}</div>
              <div className="text-[10px] font-mono text-ink-300 mt-1">{user.xp.toLocaleString()} XP</div>
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

        <Panel
          variant="lime"
          title={petQ.data?.pets?.length ? 'Pet' : 'Adopt a pet'}
          className="flex flex-col"
        >
          {petQ.data?.pets?.length ? (
            <>
              {(() => {
                const primary = petQ.data.pets[0];
                const deployedPet = petQ.data.pets.find((p) => p.deployed) ?? primary;
                const hpPct = deployedPet.maxHp > 0 ? (deployedPet.currentHp / deployedPet.maxHp) * 100 : 0;
                return (
                  <div className="flex items-center gap-3">
                    <Link to="/pet" className="shrink-0">
                      <img
                        src={deployedPet.spritePath}
                        alt={deployedPet.name}
                        width={64}
                        height={64}
                        className={`pixelated w-16 h-16 ${deployedPet.faintedAt ? 'grayscale opacity-60' : ''}`}
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
                        <Link to="/pet" className="text-neon-lime truncate hover:underline">
                          {deployedPet.name}
                        </Link>
                        <span className="text-ink-300 tabular-nums shrink-0">
                          {deployedPet.currentHp}/{deployedPet.maxHp}
                        </span>
                      </div>
                      <div className="h-2 bg-bg-900 border border-neon-lime/30 rounded">
                        <div
                          className={`h-full rounded transition-all ${deployedPet.faintedAt ? 'bg-neon-magenta' : 'bg-neon-lime'}`}
                          style={{ width: `${Math.max(0, Math.min(100, hpPct))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                        <span className="text-ink-400">Lv {deployedPet.level} · {deployedPet.stage}</span>
                        {deployedPet.faintedAt ? (
                          <span className="text-neon-magenta">✗ KO</span>
                        ) : deployedPet.deployed ? (
                          <span className="text-neon-lime">⚔ DEPLOYED</span>
                        ) : (
                          <span className="text-ink-400">on the bench</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <Link
                to="/pet"
                className="block mt-2 text-center text-[10px] font-display tracking-widest neon-text-cyan hover:underline"
              >
                {petQ.data.pets.length > 1
                  ? `→ MANAGE ROSTER (${petQ.data.pets.length} PETS)`
                  : '→ VIEW PET'}
              </Link>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="text-xs font-mono text-ink-300 mb-3">No companion yet</div>
              <Link
                to="/shop"
                className="inline-block px-3 py-1 rounded text-[10px] font-display tracking-widest neon-text-cyan border border-neon-cyan/30 hover:border-neon-cyan hover:bg-neon-cyan/10"
              >
                → ADOPT AT SHOP
              </Link>
            </div>
          )}
        </Panel>

        <HeartsCard />
        <HomeBaseCard />
      </div>

      {/* Raid + Portal leak — share a row at lg, stack on smaller
          screens. Raid is the active multiplayer boss; Portal leak
          is the solo monster roster. Each is ~half width on lg. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
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
        <PortalLeakCard />
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

      {/* Daily weigh-in + nutrition + habits — quick indicators. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
        <WeighInPanel />
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
        const isCalisthenics = cat === 'CALISTHENICS';
        const gaugeMetrics = isBodyComp ? metrics.filter((m) => m !== 'WAIST') : metrics;
        return (
          <Panel
            key={cat}
            title={cfg.label}
            variant={cfg.variant}
            className="mb-6"
          >
            {isCalisthenics && (
              <div className="mb-4 flex items-center justify-center">
                <CalisthenicsRadial
                  unlocked={calisthenicsQ.data?.unlocked ?? 0}
                  total={calisthenicsQ.data?.totalSkills ?? 42}
                  pct={calisthenicsQ.data?.pct ?? 0}
                  className={user.class}
                  recentName={calisthenicsQ.data?.recentUnlocks?.[0]?.name}
                  deadHangPr={calisthenicsQ.data?.deadHangPr ?? null}
                  bestHoldPr={calisthenicsQ.data?.bestHoldPr ?? null}
                />
              </div>
            )}
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
                  <div key={m} className="flex flex-col items-center">
                    <button
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
                        // Fallback max grows with the user's actual logged
                        // performance: at minimum defaultMin × 1.5, but
                        // bumped to value × 1.5 when the user has logged
                        // anything higher. Stops L-Sit (defaultMin=5,
                        // defaultMax=7.5) from clamping every realistic
                        // value into the "X% OVER" zone.
                        max={max?.value ?? Math.max(value != null ? value * 1.5 : 0, meta.defaultMin * 1.5)}
                        color={cfg.color}
                        size={170}
                      />
                    </button>
                    {/* Genetic-max override annotation. Only shown when
                        there's a stored row AND it diverges from the
                        formula. The override is what the gauge scales
                        against, so labelling it with the formula value
                        tells the user "your ceiling is X, the natural
                        ceiling would be Y" — important for "why is my
                        gauge so generous / harsh?". Reset button writes
                        source='FORMULA' with the computed formula
                        value, so the stored row flips back to the
                        formula without losing the gauge's max
                        reference. */}
                    {(() => {
                      if (!max) return null;
                      const formulaValue = previewMax(
                        m,
                        user?.wristCm ?? null,
                        user?.ankleCm ?? null,
                        user?.heightCm ?? null,
                        user?.weightKg ?? null,
                      );
                      if (formulaValue == null) return null;
                      const diverges =
                        max.source === 'MANUAL' &&
                        Math.abs(max.value - formulaValue) > 0.05;
                      if (!diverges) return null;
                      const conv = convertForDisplay(formulaValue, meta.unit, system);
                      return (
                        <div className="mt-1 text-center">
                          <div className="text-[9px] font-mono leading-tight">
                            <span className="neon-text-amber">manual</span>
                            <span className="text-ink-400"> · formula </span>
                            <span className="text-ink-100">
                              {conv.value.toFixed(1)}
                              <span className="text-ink-400 ml-0.5">{conv.unit}</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetMaxM.mutate(m);
                            }}
                            disabled={resetMaxM.isPending}
                            className="mt-1 text-[9px] font-mono uppercase tracking-widest border border-neon-amber/40 text-neon-amber hover:bg-neon-amber/10 disabled:opacity-50 px-1.5 py-0.5"
                            title="Discard your manual override and use the formula value"
                          >
                            {resetMaxM.isPending && resetMaxM.variables === m
                              ? '…'
                              : 'Reset to formula'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}

      {/* Recent PRs + Achievements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel variant="lime" title="Estimated 1RM peaks">
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
              <div className="text-xs text-ink-300 font-mono text-center py-4">No 1RM peaks yet — log a workout to start.</div>
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
