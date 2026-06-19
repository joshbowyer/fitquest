import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Gauge } from '@/components/Gauge';
import { Panel } from '@/components/Panel';
import { ProgressBar } from '@/components/ProgressBar';
import { BossBar } from '@/components/BossBar';
import { useState } from 'react';
import { WeighInPanel } from '@/components/WeighInPanel';
import { TodayHabitsPanel } from '@/components/TodayHabitsPanel';
import { RecoveryPanel } from '@/components/RecoveryPanel';
import { InsightsPanel } from '@/components/InsightsPanel';
import { FramePanel } from '@/components/FramePanel';
import { WaistDisplay } from '@/components/WaistDisplay';
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
import { Link } from 'react-router-dom';

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
  const recomputeM = useMutation({
    mutationFn: () => api<{ ok: true; updated: string[]; skipped: string[] }>(
      '/genetic-max/recompute',
      { method: 'POST' }
    ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      setRecomputeToast(`Recomputed ${r.updated.length} maxes from formulas${r.skipped.length > 0 ? ` · ${r.skipped.length} manual kept` : ''}`);
      setTimeout(() => setRecomputeToast(null), 4000);
    },
  });
  const [recomputeToast, setRecomputeToast] = useState<string | null>(null);

  if (!user) return null;

  const cls = user.class ? CLASS_META[user.class] : null;
  const latestByMetric = new Map<string, Measurement>();
  for (const m of measurementsQ.data?.items || []) latestByMetric.set(m.metric, m);
  const maxByMetric = new Map<string, GeneticMax>();
  for (const g of geneticQ.data?.items || []) maxByMetric.set(g.metric, g);

  const unlocked = (achievementsQ.data?.items || []).filter((a) => a.unlocked);

  return (
    <Layout>
      <PageHeader
        title="// Stat Sheet"
        subtitle={`${cls?.label ?? 'Unclassed'} // ${user.username}`}
        action={
          <div className="flex items-center gap-3">
            {recomputeToast && (
              <span className="text-xs font-mono neon-text-cyan border border-neon-cyan/30 bg-neon-cyan/5 px-2 py-1">
                ✓ {recomputeToast}
              </span>
            )}
            <button
              onClick={() => recomputeM.mutate()}
              disabled={recomputeM.isPending}
              className="btn-ghost"
            >
              {recomputeM.isPending ? '⟳ Recomputing…' : '⟳ Recompute Maxes'}
            </button>
          </div>
        }
      />

      {/* Top hero: level + raid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Panel variant="cyan" className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/70">Character</div>
              <div className="font-display text-3xl tracking-widest neon-text-cyan mt-1">
                {user.username}
              </div>
              <div className={`text-xs font-mono mt-1 ${cls ? `neon-text-${cls.color}` : 'text-ink-300'}`}>
                {cls?.label ?? 'Unclassed'} — {cls?.tagline ?? 'pick a class in profile'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Level</div>
              <div className="font-display text-5xl neon-text-cyan leading-none">{user.level}</div>
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
      </div>

      {/* Daily weigh-in + habits */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-6">
        <WeighInPanel />
        <TodayHabitsPanel />
      </div>

      {/* Recovery + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4 mb-6">
        <RecoveryPanel />
        <InsightsPanel />
      </div>

      {/* Frame + Recovery (or body comp) — Frame shows wrist/ankle/height
          classification that drives all genetic-max formulas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <FramePanel />
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
                return (
                  <Gauge
                    key={m}
                    metric={m}
                    value={latest?.value ?? null}
                    min={min}
                    max={max?.value ?? meta.defaultMin * 1.5}
                    color={cfg.color}
                    size={170}
                  />
                );
              })}
            </div>
            {isBodyComp && <WaistDisplay />}
          </Panel>
        );
      })}

      {/* Recent PRs + Achievements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel variant="lime" title="Recent PRs">
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(prsQ.data?.items || []).slice(0, 10).map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm font-mono border-b border-neon-lime/10 pb-1">
                <span className="text-ink-100">{p.exercise}</span>
                <span className="neon-text-lime">
                  {p.exercise.toLowerCase().includes('plank') || p.exercise.toLowerCase().includes('l-sit')
                    ? formatSeconds(p.value)
                    : `${p.value.toFixed(1)} kg`}
                </span>
                <span className="text-ink-400 text-[10px]">{formatRelative(p.achievedAt)}</span>
              </div>
            ))}
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
    </Layout>
  );
}
