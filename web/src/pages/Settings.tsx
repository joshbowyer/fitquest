import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { ProgressBar } from '@/components/ProgressBar';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, displayUnit, displayValue, type UnitSystem } from '@/lib/units';
import { classNames, formatDate, formatRelative } from '@/lib/format';
import { getFrameSize, frameDescription } from '@/lib/frame';
import type { GeneticMax, Measurement, MetricType } from '@/lib/types';
import { METRICS, METRICS_BY_CATEGORY } from '@/lib/types';

type Change = { metric: string; from: number | null; to: number };

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const [units, setUnits] = useState<UnitSystem>(user?.units ?? 'METRIC');
  const [recomputeResult, setRecomputeResult] = useState<Change[] | null>(null);
  const [recomputeSummary, setRecomputeSummary] = useState<string | null>(null);

  const unitsM = useMutation({
    mutationFn: (next: UnitSystem) =>
      api('/users/me', { method: 'PATCH', body: { units: next } }),
    onSuccess: async (_data, next) => {
      await refresh();
      qc.invalidateQueries();
      setUnits(next); // local sync — use the variable, not the stale closure
    },
  });

  // Goal + baseline PATCH. Conservative ±250 cal adjustment.
  const goalM = useMutation({
    mutationFn: (body: { goal: 'CUT' | 'MAINTAIN' | 'BULK'; calorieBaseline?: number }) =>
      api('/users/me', { method: 'PATCH', body }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ['morning-report'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  });

  const [isRecomputing, setIsRecomputing] = useState(false);
  const recomputeM = useMutation({
    mutationFn: () =>
      api<{ ok: true; updated: string[]; skipped: string[]; removed: string[]; changes: Change[] }>(
        '/genetic-max/recompute',
        { method: 'POST' }
      ),
  });

  async function handleRecompute() {
    if (isRecomputing) return;
    setIsRecomputing(true);
    setRecomputeResult(null);
    setRecomputeSummary(null);
    try {
      const r = await recomputeM.mutateAsync();
      // Explicitly hold the loading state for at least 2s so the user
      // actually sees the animation + spinner (API returns in <100ms
      // locally).
      await new Promise((res) => setTimeout(res, 2000));
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
      if (r.changes.length === 0) {
        setRecomputeSummary('No changes — formulas already up to date.');
        setRecomputeResult([]);
      } else {
        const updatedCount = r.changes.length - r.removed.length;
        const removedCount = r.removed.length;
        const parts: string[] = [];
        if (updatedCount > 0) parts.push(`${updatedCount} maxes updated`);
        if (removedCount > 0) parts.push(`${removedCount} removed (no formula)`);
        if (r.skipped.length > 0) parts.push(`${r.skipped.length} manual kept`);
        setRecomputeSummary(parts.join(' · '));
        setRecomputeResult(r.changes);
      }
    } catch (e) {
      setRecomputeSummary(`Error: ${e instanceof Error ? e.message : 'recompute failed'}`);
    } finally {
      setIsRecomputing(false);
    }
  }

  const maxesQ = useQuery({
    queryKey: ['genetic-max'],
    queryFn: () => api<{ items: GeneticMax[] }>('/genetic-max'),
  });

  const measurementsQ = useQuery({
    queryKey: ['measurements', 'latest'],
    queryFn: () => api<{ items: Measurement[] }>('/measurements/latest'),
  });

  if (!user) return null;
  const system: UnitSystem = user.units ?? 'METRIC';
  const frameSize = getFrameSize(user.wristCm, user.ankleCm);
  const missing: string[] = [];
  if (!user.heightCm) missing.push('height');
  if (!user.wristCm) missing.push('wrist');
  if (!user.ankleCm) missing.push('ankle');

  return (
    <Layout>
      <PageHeader
        title="// Settings"
        subtitle="Display, data, account — all the dials in one place."
      />

      <div className="space-y-4 max-w-3xl">
        {/* DISPLAY */}
        <Panel title="Display" variant="cyan">
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 mb-2">
                Unit System
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <UnitOption
                  current={user.units}
                  value="METRIC"
                  label="Metric"
                  detail="cm · kg · ml · °C"
                  onSelect={() => unitsM.mutate('METRIC')}
                  disabled={unitsM.isPending}
                />
                <UnitOption
                  current={user.units}
                  value="IMPERIAL"
                  label="Imperial"
                  detail="in · lb · fl oz · °F"
                  onSelect={() => unitsM.mutate('IMPERIAL')}
                  disabled={unitsM.isPending}
                />
              </div>
            </div>
          </div>
        </Panel>

        {/* GOAL & TARGETS — drives the calorie / protein / water
            numbers on the Nutrition page. Conservative ±250 cal
            offset. User can override the baseline. */}
        <Panel
          title="Goal & Targets"
          variant="lime"
          action={
            <span className="text-[10px] font-mono text-ink-400">
              {user.targets
                ? `${user.targets.calorieGoal} cal · ${user.targets.proteinGoalG}g protein · ${user.targets.waterGoalMl} ml water`
                : '…'}
            </span>
          }
        >
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-lime/80 mb-2">
                Calorie Goal
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <GoalOption
                  current={user.goal}
                  value="CUT"
                  label="Cut"
                  delta={-250}
                  onSelect={() => goalM.mutate({ goal: 'CUT' })}
                  disabled={goalM.isPending}
                />
                <GoalOption
                  current={user.goal}
                  value="MAINTAIN"
                  label="Maintain"
                  delta={0}
                  onSelect={() => goalM.mutate({ goal: 'MAINTAIN' })}
                  disabled={goalM.isPending}
                />
                <GoalOption
                  current={user.goal}
                  value="BULK"
                  label="Bulk"
                  delta={+250}
                  onSelect={() => goalM.mutate({ goal: 'BULK' })}
                  disabled={goalM.isPending}
                />
              </div>
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                Cut / Bulk apply a conservative ±250 cal/day offset from
                your baseline. Protein target tracks with the goal
                (errs high; cut = 0.077 g/kcal, maintain = 0.064, bulk = 0.068).
              </div>
            </div>

            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-neon-lime/80 mb-2">
                Calorie Baseline (
                {user.calorieSource === 'BMR'
                  ? 'BMR only'
                  : user.calorieSource === 'BMR_NEAT'
                  ? 'BMR + NEAT'
                  : 'maintenance'}
                )
              </div>
              <BaselineEditor
                value={user.calorieBaseline ?? 2200}
                disabled={goalM.isPending}
                onSave={(v) =>
                  goalM.mutate({
                    goal: user.goal ?? 'MAINTAIN',
                    calorieBaseline: v,
                    calorieSource: user.calorieSource ?? 'BASELINE',
                  })
                }
              />
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                Your maintenance calories. The actual daily target is
                baseline + goal offset (cut -250, maintain 0, bulk +250).
                Default 2200 — set this to your real maintenance once
                you have 2-3 weeks of weight-stable data.
              </div>
              {/* Source picker: lets power users tell us whether the
                  baseline is a full TDEE, a BMR alone, or a BMR+NEAT
                  estimate. Math is the same; only the label changes. */}
              <div className="mt-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 mb-1">
                  Baseline source
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <SourceOption
                    current={user.calorieSource}
                    value="BASELINE"
                    label="Maintenance"
                    hint="TDEE estimate. Use if you have 2-3 weeks of weight-stable data."
                    onSelect={() =>
                      goalM.mutate({
                        goal: user.goal ?? 'MAINTAIN',
                        calorieBaseline: user.calorieBaseline ?? 2200,
                        calorieSource: 'BASELINE',
                      })
                    }
                    disabled={goalM.isPending}
                  />
                  <SourceOption
                    current={user.calorieSource}
                    value="BMR_NEAT"
                    label="BMR + NEAT"
                    hint="Basal metabolic rate + daily movement, no workouts. Common for lightly active people."
                    onSelect={() =>
                      goalM.mutate({
                        goal: user.goal ?? 'MAINTAIN',
                        calorieBaseline: user.calorieBaseline ?? 2200,
                        calorieSource: 'BMR_NEAT',
                      })
                    }
                    disabled={goalM.isPending}
                  />
                  <SourceOption
                    current={user.calorieSource}
                    value="BMR"
                    label="BMR only"
                    hint="Basal metabolic rate only (e.g. Mifflin-St Jeor). You'll account for activity yourself."
                    onSelect={() =>
                      goalM.mutate({
                        goal: user.goal ?? 'MAINTAIN',
                        calorieBaseline: user.calorieBaseline ?? 2200,
                        calorieSource: 'BMR',
                      })
                    }
                    disabled={goalM.isPending}
                  />
                </div>
              </div>
            </div>

            {user.targets && (
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-ink-500/15">
                <TargetStat
                  label="Calorie goal"
                  value={String(user.targets.calorieGoal)}
                  unit="cal"
                  color="amber"
                />
                <TargetStat
                  label="Protein"
                  value={String(user.targets.proteinGoalG)}
                  unit="g"
                  color="lime"
                />
                <TargetStat
                  label="Water"
                  value={String(user.targets.waterGoalMl)}
                  unit={user.units === 'IMPERIAL' ? 'fl oz' : 'ml'}
                  color="cyan"
                />
              </div>
            )}
          </div>
        </Panel>

        {/* FRAME */}
        <Panel
          title="Frame"
          variant="cyan"
          action={
            <Link to="/profile" className="btn-ghost text-[10px]">
              → EDIT
            </Link>
          }
        >
          {missing.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <Field
                k="Frame"
                v={frameSize}
                accent
              />
              <Field k="Height" v={user.heightCm ? formatHeight(user.heightCm, system) : '—'} />
              <Field k="Wrist" v={user.wristCm ? displayValue(user.wristCm, 'cm', system) : '—'} />
              <Field k="Ankle" v={user.ankleCm ? displayValue(user.ankleCm, 'cm', system) : '—'} />
            </div>
          ) : (
            <div className="border border-neon-amber/30 bg-neon-amber/5 p-3">
              <div className="text-xs font-mono neon-text-amber mb-1">! FRAME INCOMPLETE</div>
              <div className="text-[10px] text-ink-300 font-mono mb-2">
                Missing: {missing.join(', ')}. Genetic max formulas need all three.
              </div>
              <Link to="/profile" className="btn-ghost text-[10px]">
                → COMPLETE FRAME
              </Link>
            </div>
          )}
          <div className="mt-3 text-[10px] text-ink-300 font-mono">
            {frameDescription(frameSize)}.{' '}
            <Link to="/profile" className="neon-text-cyan hover:underline">
              Edit
            </Link>
          </div>
        </Panel>

        {/* GENETIC MAXES */}
        <Panel
          title="Genetic Maxes"
          variant="lime"
          action={
            <NeonButton
              variant="lime"
              onClick={handleRecompute}
              loading={isRecomputing}
              icon="⟳"
              loadingText="Recomputing…"
            >
              Recompute
            </NeonButton>
          }
        >
          <div className="text-[10px] text-ink-300 font-mono mb-3">
            Formulas recalculated from your frame (height, wrist, ankle, BF). Manual overrides are preserved.
          </div>

          {recomputeSummary && (
            <div className="mb-3 border border-neon-cyan/30 bg-neon-cyan/5 p-3 text-xs font-mono">
              <div className="neon-text-cyan">✓ {recomputeSummary}</div>
              {recomputeResult && recomputeResult.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                  {recomputeResult.map((c) => {
                    const meta = METRICS[c.metric as MetricType];
                    if (!meta) return null;
                    const isRemoved = c.to === 0;
                    return (
                      <div key={c.metric} className="grid grid-cols-[100px_1fr_60px_1fr] gap-2 text-[10px]">
                        <span className={isRemoved ? 'text-ink-300 line-through' : 'text-ink-200'}>
                          {meta.shortLabel}
                        </span>
                        <span className="text-ink-400 text-right">
                          {c.from != null ? displayValue(c.from, meta.unit, system) : '—'}
                        </span>
                        <span className="text-ink-300 text-center">→</span>
                        <span className={isRemoved ? 'neon-text-amber' : 'neon-text-cyan'}>
                          {isRemoved ? 'removed' : displayValue(c.to, meta.unit, system)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => { setRecomputeSummary(null); setRecomputeResult(null); }}
                className="text-[10px] text-ink-300 hover:text-ink-100 mt-2"
              >
                ✕ dismiss
              </button>
            </div>
          )}

          <div className="text-[10px] text-ink-300 font-mono mb-2 uppercase tracking-widest">
            Current maxes
          </div>
          <div className="border border-ink-500/30 max-h-96 overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-bg-800">
                <tr className="text-[10px] uppercase tracking-widest text-ink-300 border-b border-ink-500/30">
                  <th className="text-left p-2">Metric</th>
                  <th className="text-right p-2">Max</th>
                  <th className="text-right p-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {(maxesQ.data?.items || []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-center text-ink-300 text-[10px]">
                      No maxes yet. Click Recompute to derive from your frame.
                    </td>
                  </tr>
                )}
                {(maxesQ.data?.items || [])
                  .sort((a, b) => {
                    const ca = METRICS[a.metric]?.category ?? '';
                    const cb = METRICS[b.metric]?.category ?? '';
                    return ca.localeCompare(cb) || a.metric.localeCompare(b.metric);
                  })
                  .map((m) => {
                    const meta = METRICS[m.metric];
                    if (!meta) return null;
                    const latest = (measurementsQ.data?.items || []).find((x) => x.metric === m.metric);
                    const pct = latest ? Math.min(1, latest.value / m.value) : 0;
                    return (
                      <tr key={m.id} className="border-b border-ink-500/20">
                        <td className="p-2 text-ink-100" title={meta.description}>
                          <div>{meta.shortLabel}</div>
                          {meta.description && m.metric === 'POWERLIFT_TOTAL' && (
                            <div className="text-[9px] text-ink-400 font-mono leading-tight mt-0.5">
                              {meta.description}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-right neon-text-cyan font-bold" title={meta.description}>
                          {displayValue(m.value, meta.unit, system)}
                        </td>
                        <td className="p-2 text-right text-[10px]">
                          <span className={m.source === 'MANUAL' ? 'neon-text-amber' : 'text-ink-300'}>
                            {m.source}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* DATA (placeholder) */}
        <Panel title="Data" variant="magenta">
          <div className="text-[10px] text-ink-300 font-mono mb-2">
            Export and import coming in v0.5. For now, back up with
            <code className="mx-1 px-1 bg-bg-700 border border-ink-500/30">pg_dump</code>
            on the server side.
          </div>
          <div className="flex gap-2">
            <button disabled className="btn-ghost opacity-40 cursor-not-allowed">
              ⬇ Export JSON (soon)
            </button>
            <button disabled className="btn-ghost opacity-40 cursor-not-allowed">
              ⬆ Import JSON (soon)
            </button>
          </div>
        </Panel>

        {/* ACCOUNT (placeholder) */}
        <Panel title="Account" variant="amber">
          <div className="space-y-2 text-xs font-mono">
            <Field k="Email" v={user.email} />
            <Field k="Username" v={user.username} />
            <Field k="2FA" v="Off (coming soon)" muted />
            <div className="flex gap-2 pt-2">
              <button disabled className="btn-ghost opacity-40 cursor-not-allowed">
                Change password
              </button>
              <button disabled className="btn-ghost opacity-40 cursor-not-allowed">
                Delete account
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </Layout>
  );
}

function UnitOption({
  current,
  value,
  label,
  detail,
  onSelect,
  disabled,
}: {
  current: UnitSystem;
  value: UnitSystem;
  label: string;
  detail: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  const selected = current === value;
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={classNames(
        'p-3 border-2 text-left transition-all',
        selected
          ? 'border-neon-cyan/80 bg-neon-cyan/10'
          : 'border-ink-500/40 hover:border-ink-300',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className={classNames(
        'font-display tracking-wider text-sm',
        selected ? 'neon-text-cyan' : 'text-ink-200'
      )}>
        {label}
      </div>
      <div className="text-[10px] text-ink-300 font-mono mt-1">{detail}</div>
    </button>
  );
}

function Field({ k, v, accent, muted }: { k: string; v: string; accent?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className="text-ink-300 text-[9px] uppercase tracking-widest">{k}</div>
      <div className={classNames(
        'mt-0.5',
        accent ? 'neon-text-cyan text-base' : 'text-ink-100',
        muted && 'text-ink-400'
      )}>
        {v}
      </div>
    </div>
  );
}

function formatHeight(cm: number, system: UnitSystem): string {
  if (system === 'IMPERIAL') {
    const totalIn = cm / 2.54;
    const ft = Math.floor(totalIn / 12);
    const inch = Math.round(totalIn - ft * 12);
    return `${ft}'${inch}"`;
  }
  return `${Math.round(cm)} cm`;
}

function GoalOption({
  current,
  value,
  label,
  delta,
  onSelect,
  disabled,
}: {
  current: 'CUT' | 'MAINTAIN' | 'BULK' | undefined;
  value: 'CUT' | 'MAINTAIN' | 'BULK';
  label: string;
  delta: number;
  onSelect: () => void;
  disabled: boolean;
}) {
  const selected = current === value;
  const deltaLabel = delta === 0 ? '±0' : delta > 0 ? `+${delta}` : `${delta}`;
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={classNames(
        'p-3 border-2 text-left transition-all',
        selected
          ? 'border-neon-lime/80 bg-neon-lime/10'
          : 'border-ink-500/40 hover:border-ink-300',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-baseline justify-between">
        <div className={classNames(
          'font-display tracking-wider text-sm',
          selected ? 'neon-text-lime' : 'text-ink-200'
        )}>
          {label}
        </div>
        <div className={classNames(
          'text-[10px] font-mono',
          selected ? 'text-neon-lime' : 'text-ink-400'
        )}>
          {deltaLabel} cal
        </div>
      </div>
      <div className="text-[10px] text-ink-300 font-mono mt-1">
        {value === 'CUT' && 'Conservative deficit for body-comp loss.'}
        {value === 'MAINTAIN' && 'Hold your weight steady.'}
        {value === 'BULK' && 'Conservative surplus for muscle gain.'}
      </div>
    </button>
  );
}

function BaselineEditor({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const valid = /^\d{3,5}$/.test(draft) && Number(draft) >= 800 && Number(draft) <= 8000;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={800}
        max={8000}
        step={50}
        className="input-neon w-32 text-sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <span className="text-xs text-ink-300 font-mono">cal/day</span>
      <NeonButton
        size="sm"
        variant="lime"
        onClick={() => valid && onSave(Number(draft))}
        disabled={!valid || disabled || Number(draft) === value}
        loading={disabled}
      >
        Save
      </NeonButton>
    </div>
  );
}

function TargetStat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: 'cyan' | 'lime' | 'amber' | 'magenta' | 'violet';
}) {
  return (
    <div className="text-center p-2 border border-ink-500/15 bg-bg-900/40">
      <div className="text-[10px] font-mono uppercase text-ink-400 tracking-widest">
        {label}
      </div>
      <div className={`text-lg font-display tracking-wider neon-text-${color} mt-0.5`}>
        {value}
        <span className="text-xs text-ink-300 ml-1">{unit}</span>
      </div>
    </div>
  );
}

function SourceOption({
  current,
  value,
  label,
  hint,
  onSelect,
  disabled,
}: {
  current: 'BASELINE' | 'BMR' | 'BMR_NEAT' | undefined;
  value: 'BASELINE' | 'BMR' | 'BMR_NEAT';
  label: string;
  hint: string;
  onSelect: () => void;
  disabled: boolean;
}) {
  const selected = current === value;
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={classNames(
        'p-2 border text-left transition-all',
        selected
          ? 'border-neon-lime/80 bg-neon-lime/10'
          : 'border-ink-500/40 hover:border-ink-300',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className={classNames(
        'text-xs font-mono',
        selected ? 'text-neon-lime' : 'text-ink-200'
      )}>
        {label}
      </div>
      <div className="text-[10px] text-ink-400 font-mono mt-0.5">{hint}</div>
    </button>
  );
}
