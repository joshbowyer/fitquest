import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { ProgressBar } from '@/components/ProgressBar';
import { TwoFactorSetup } from '@/components/TwoFactorSetup';
import { Modal } from '@/components/Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { useAuth } from '@/lib/auth';
import { convertForDisplay, displayUnit, displayValue, type UnitSystem } from '@/lib/units';
import { classNames, formatDate, formatRelative } from '@/lib/format';
import { getFrameSize, frameDescription } from '@/lib/frame';
import type { GeneticMax, Measurement, MetricType } from '@/lib/types';
import { METRICS, METRICS_BY_CATEGORY } from '@/lib/types';

type Change = { metric: string; from: number | null; to: number };

/**
 * Casual/Hardcore mode toggle. Renders a 2-card picker with
 * explainers for each mode's behavior. The toggle PATCHes the
 * server immediately; the dashboard's Hearts card will appear /
 * disappear on next /users/me fetch.
 *
 * The explainers list *exactly* what changes so the user can pick
 * informed. The penalty ladder is:
 *  - 5 hearts, lose 1 per missed planned workout, regen 1 per 8h
 *  - At 0 hearts: -50% XP, -50% gold, -50% raid damage
 *  - Streak break: a missed-week routine now resets the streak
 *  - Substance caps: >3 espressos/day or >5 drinks/week shows a
 *    "substance over-use" flag in the morning report
 *
 * Casual leaves all of this off — same behaviour as before this
  * feature shipped.
  */

// ============================================================
// Data export + import panel. Lets the user back up everything
// (workouts, measurements, food, daily logs, achievements,
// breach progress, etc.) to a JSON file or a ZIP of CSVs, and
// re-import from a previously-exported JSON. Round-trip safe.
// ============================================================
function DataPanel() {
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const { data: info, isLoading: infoLoading } = useQuery({
    queryKey: ['export-info'],
    queryFn: () => api<{
      workouts: number; measurements: number; savedFoods: number;
      dailies: number; dailyLogs: number; substanceLogs: number;
      morningReports: number; inventoryItems: number; achievements: number;
      breachKills: number; painLogs: number; prayers: number; meals: number;
    }>('/export/info'),
    staleTime: 60_000,
  });

  function handleDownload(path: string, filename: string) {
    // Open in a new tab so the browser's download manager picks
    // it up with the right Content-Disposition filename. The
    // cookie is sent automatically (same origin).
    const url = path.startsWith('http') ? path : `${window.location.origin}${path}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Panel title="Data" variant="magenta">
      <div className="text-[11px] text-ink-300 font-mono mb-3 leading-relaxed">
        Back up everything — workouts, measurements, food, dailies,
        morning reports, achievements, breach progress, and more.
        JSON is round-trip safe (re-imports into the same or a
        fresh FitQuest install). CSV is one file per table for
        spreadsheets.
      </div>

      {/* Counts preview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono mb-4">
        {infoLoading ? (
          <div className="col-span-full text-ink-500">loading…</div>
        ) : info ? (
          <>
            <CountCell label="workouts" v={info.workouts} />
            <CountCell label="measurements" v={info.measurements} />
            <CountCell label="dailies" v={info.dailies + info.dailyLogs} />
            <CountCell label="food" v={info.savedFoods + info.meals} />
            <CountCell label="achievements" v={info.achievements} />
            <CountCell label="substances" v={info.substanceLogs} />
            <CountCell label="prayers" v={info.prayers} />
            <CountCell label="pain logs" v={info.painLogs} />
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <NeonButton
          icon="⬇"
          onClick={() => handleDownload('/api/export/json', `fitquest-export-${new Date().toISOString().slice(0, 10)}.json`)}
        >
          Export JSON
        </NeonButton>
        <NeonButton
          icon="📊"
          onClick={() => handleDownload('/api/export/csv', `fitquest-export-${new Date().toISOString().slice(0, 10)}.zip`)}
        >
          Export CSV (.zip)
        </NeonButton>
        <NeonButton
          icon="⬆"
          onClick={() => setImportOpen(true)}
        >
          Import JSON
        </NeonButton>
      </div>

      {importOpen && (
        <ImportDialog
          onClose={() => {
            setImportOpen(false);
            qc.invalidateQueries();
          }}
        />
      )}
    </Panel>
  );
}

function CountCell({ label, v }: { label: string; v: number }) {
  return (
    <div className="border border-ink-700/50 px-2 py-1 rounded bg-bg-700/40">
      <div className="text-ink-500 uppercase tracking-widest">{label}</div>
      <div className="text-ink-100 text-sm">{v.toLocaleString()}</div>
    </div>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [wipeFirst, setWipeFirst] = useState(false);
  const [result, setResult] = useState<null | {
    ok: boolean; schema: string; version: number;
    imported: Record<string, number>;
    skipped: Record<string, number>;
    errors: { table: string; reason: string }[];
    wiped: number;
  }>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleRun() {
    if (!file) return;
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const body = { payload, dryRun, wipeFirst };
      const data = await api<typeof result>('/import/data', {
        method: 'POST',
        body,
      });
      setResult(data);
    } catch (e: any) {
      setErr(e?.message ?? 'Import failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Import JSON">
      <div className="space-y-3 text-sm">
        <p className="text-[11px] text-ink-300 font-mono">
          Select a previously-exported FitQuest JSON file. Dry-run
          reports what would be imported without writing.
        </p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs file:mr-2 file:px-3 file:py-1 file:rounded file:border file:border-neon-cyan/40 file:bg-bg-700 file:text-neon-cyan"
        />
        <label className="flex items-center gap-2 text-xs font-mono">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="accent-neon-cyan"
          />
          Dry run (no writes)
        </label>
        <label className="flex items-center gap-2 text-xs font-mono opacity-70">
          <input
            type="checkbox"
            checked={wipeFirst}
            onChange={(e) => setWipeFirst(e.target.checked)}
            disabled
            className="accent-neon-amber"
          />
          Wipe existing data first <span className="text-ink-500">(disabled — known bug, use /admin)</span>
        </label>
        {err && <div className="text-rose-400 text-xs font-mono">{err}</div>}
        {result && (
          <div className="border border-neon-cyan/30 bg-bg-700/50 p-3 rounded text-xs font-mono space-y-2">
            <div className="text-ink-100">
              {result.ok ? '✓ Import succeeded' : '⚠ Import completed with errors'}
            </div>
            <div className="text-ink-400">
              schema: {result.schema} · version: {result.version}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="text-emerald-300">
                imported: {Object.values(result.imported).reduce((s, n) => s + n, 0)}
              </div>
              <div className="text-amber-300">
                skipped: {Object.values(result.skipped).reduce((s, n) => s + n, 0)}
              </div>
              {result.wiped > 0 && (
                <div className="text-rose-300">wiped: {result.wiped}</div>
              )}
              <div className="text-rose-300">
                errors: {result.errors.length}
              </div>
            </div>
            {result.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-rose-300">error details</summary>
                <div className="mt-1 max-h-32 overflow-y-auto text-[10px] text-ink-400">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <div key={i} className="border-b border-ink-700/50 py-0.5">
                      <span className="text-ink-100">{e.table}:</span> {e.reason.slice(0, 100)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <NeonButton
            icon={running ? '⏳' : '▶'}
            onClick={handleRun}
            disabled={!file || running}
          >
            {running ? 'Running…' : dryRun ? 'Preview import' : 'Run import'}
          </NeonButton>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs font-mono text-ink-400 hover:text-ink-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ModeSection() {
  const { user, refresh } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'CASUAL' | 'HARDCORE' | null>(null);

  const { data: me } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => api<{ mode?: 'CASUAL' | 'HARDCORE' }>('/users/me'),
  });
  const current = me?.mode ?? 'CASUAL';

  const modeM = useDelayedMutation<{ ok: boolean }, 'CASUAL' | 'HARDCORE'>(
    {
      mutationFn: (mode) =>
        api('/users/me', { method: 'PATCH', body: { mode } }),
      onError: (e) => setErr(e instanceof ApiError ? e.message : 'Mode change failed'),
      onSuccess: () => {
        setConfirming(null);
        setErr(null);
        // Force-refresh the auth context so the dashboard's Hearts
        // card mounts/unmounts without waiting for the next /me poll.
        refresh();
      },
    },
    600,
  );

  function pickMode(mode: 'CASUAL' | 'HARDCORE') {
    if (mode === current) return;
    setErr(null);
    // Going to Hardcore from Casual: confirm (the user wants to know
    // what they're getting into). Going to Casual from Hardcore: also
    // confirm (they might be rage-quitting after a bad run — let them
    // confirm rather than tap-out by accident).
    setConfirming(mode);
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
        Pick the difficulty. Casual = current no-consequences behavior
        (streaks don't break, no hearts). Hardcore = full penalty ladder.
        You can switch back any time, but the switch is a real choice —
        no mid-session toggles.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ModeCard
          tone="cyan"
          title="Casual"
          subtitle="Default · no penalties"
          features={[
            'No heart system',
            'Missed workouts are free (streaks just sit frozen)',
            'All XP / gold / raid damage at full value',
            'Substance over-use is logged but ignored',
          ]}
          active={current === 'CASUAL'}
          onClick={() => pickMode('CASUAL')}
          disabled={modeM.isPending}
        />
        <ModeCard
          tone="magenta"
          title="Hardcore"
          subtitle={current === 'HARDCORE' ? 'Active' : 'Engages penalty ladder'}
          features={[
            '5 hearts — lose 1 per missed planned workout, regen 1 per 8h',
            'At 0 hearts: −50% XP, −50% gold, −50% raid damage',
            'Missed-week routine resets the streak (no silent freeze)',
            'Substance caps flag in the morning report',
          ]}
          active={current === 'HARDCORE'}
          onClick={() => pickMode('HARDCORE')}
          disabled={modeM.isPending}
        />
      </div>

      {err && (
        <div className="text-[10px] text-rose-300 font-mono">{err}</div>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
          setErr(null);
        }}
        title={
          confirming === 'HARDCORE'
            ? 'Engage Hardcore mode?'
            : 'Switch back to Casual?'
        }
      >
        {confirming === 'HARDCORE' ? (
          <HardcoreConfirmBody
            onCancel={() => setConfirming(null)}
            onConfirm={() => modeM.run('HARDCORE')}
            isPending={modeM.isPending}
            hearts={user?.hearts ?? 5}
          />
        ) : confirming === 'CASUAL' ? (
          <CasualConfirmBody
            onCancel={() => setConfirming(null)}
            onConfirm={() => modeM.run('CASUAL')}
            isPending={modeM.isPending}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ModeCard({
  tone,
  title,
  subtitle,
  features,
  active,
  onClick,
  disabled,
}: {
  tone: 'cyan' | 'magenta';
  title: string;
  subtitle: string;
  features: string[];
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'text-left p-3 border transition-colors',
        active
          ? tone === 'cyan'
            ? 'border-neon-cyan/70 bg-neon-cyan/10'
            : 'border-neon-magenta/70 bg-neon-magenta/10'
          : 'border-ink-500/30 bg-bg-900/40 hover:border-ink-300',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span
          className={classNames(
            'font-display tracking-widest text-xs uppercase',
            active
              ? tone === 'cyan' ? 'text-neon-cyan' : 'text-neon-magenta'
              : 'text-ink-200',
          )}
        >
          {title}
        </span>
        <span className="text-[10px] font-mono text-ink-500">{subtitle}</span>
      </div>
      <ul className="space-y-0.5 text-[11px] font-mono text-ink-300">
        {features.map((f) => (
          <li key={f} className="flex gap-1.5">
            <span className="text-ink-500">·</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {active && (
        <div className={classNames(
          'mt-2 text-[10px] font-mono uppercase tracking-widest',
          tone === 'cyan' ? 'text-neon-cyan' : 'text-neon-magenta',
        )}>
          ✓ Active
        </div>
      )}
    </button>
  );
}

function HardcoreConfirmBody({
  onCancel,
  onConfirm,
  isPending,
  hearts,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
  hearts: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-200">
        You'll start with{' '}
        <b className="text-neon-magenta">{hearts} hearts</b>. From here on:
      </p>
      <ul className="text-xs font-mono text-ink-300 space-y-1 list-disc pl-5">
        <li>Missed planned workouts cost a heart</li>
        <li>0 hearts = −50% XP, gold, raid damage until regen</li>
        <li>Missed-week routines break the streak (no silent freeze)</li>
        <li>Substance over-use gets flagged in the morning report</li>
      </ul>
      <p className="text-[10px] font-mono text-ink-500">
        You can switch back to Casual any time from this same page.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <NeonButton variant="cyan" onClick={onCancel}>
          Cancel
        </NeonButton>
        <NeonButton
          variant="magenta"
          loading={isPending}
          loadingText="Engaging…"
          onClick={onConfirm}
        >
          Engage Hardcore
        </NeonButton>
      </div>
    </div>
  );
}

function CasualConfirmBody({
  onCancel,
  onConfirm,
  isPending,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-200">
        Switching back to Casual immediately removes all penalty tracking.
      </p>
      <ul className="text-xs font-mono text-ink-300 space-y-1 list-disc pl-5">
        <li>Hearts refill to 5 (the field stays but no penalty applies)</li>
        <li>Streak freeze behaviour restored (missed weeks don't break streak)</li>
        <li>Substance caps ignored again</li>
        <li>All XP / gold / raid damage back at full value</li>
      </ul>
      <div className="flex justify-end gap-2 pt-1">
        <NeonButton variant="cyan" onClick={onCancel}>
          Cancel
        </NeonButton>
        <NeonButton
          variant="cyan"
          loading={isPending}
          loadingText="Switching…"
          onClick={onConfirm}
        >
          Switch to Casual
        </NeonButton>
      </div>
    </div>
  );
}

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

  // Goal + baseline + USDA key PATCH. Conservative ±250 cal adjustment.
  const goalM = useMutation({
    mutationFn: (body: {
      goal: 'CUT' | 'MAINTAIN' | 'BULK';
      calorieBaseline?: number;
      calorieSource?: 'BASELINE' | 'BMR' | 'BMR_NEAT';
      usdaApiKey?: string;
    }) =>
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
                ? `${Math.round(user.targets.calorieGoal)} cal · ${Math.round(user.targets.proteinGoalG)}g protein · ${Math.round(user.targets.waterGoalMl)} ml water`
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
                  baseline number is a full TDEE, a BMR alone, or a
                  BMR+NEAT estimate. CRUCIALLY the math is the same
                  regardless of which you pick — the source only
                  changes the LABEL shown next to the calorie target
                  on /nutrition, so the daily-target subtitle is
                  honest about what the number represents. Pick the
                  option that matches how YOU got the number; if
                  you don't care, leave it at Maintenance. */}
              <div className="mt-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">
                    Baseline source
                  </div>
                  <span
                    className="text-[10px] font-mono text-ink-500"
                    title="This is a LABEL for your baseline number, not a math change. The actual calorie target (baseline + goal offset) is identical regardless of which you pick. The label just keeps /nutrition honest about where the number came from."
                  >
                    (label only — math is identical)
                  </span>
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

        {/* DIFFICULTY MODE */}
        <Panel
          title="Difficulty mode"
          variant={user.mode === 'HARDCORE' ? 'magenta' : 'cyan'}
          action={
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              current: {user.mode === 'HARDCORE' ? 'HARDCORE' : 'CASUAL'}
            </span>
          }
        >
          <ModeSection />
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

        {/* FOOD DATABASES — for the upcoming food tracker. The LLM
            uses OpenFoodFacts (no key needed) first and falls back
            to USDA FDC when the user has set a key. */}
        <Panel
          title="Food Databases"
          variant="amber"
          action={
            <span className="text-[10px] font-mono text-ink-400">
              {user.hasUsdaKey ? '✓ USDA key set' : 'USDA key not set'}
            </span>
          }
        >
          <div className="space-y-3">
            <div className="text-[10px] font-mono text-ink-300">
              The food tracker (roadmap #8-9) will search OpenFoodFacts
              first (no key needed) and fall back to USDA FoodData
              Central when you provide a key. Get a free USDA key at{' '}
              <a
                className="text-neon-cyan hover:underline"
                href="https://fdc.nal.usda.gov/api-key-signup.html"
                target="_blank"
                rel="noreferrer"
              >
                fdc.nal.usda.gov/api-key-signup
              </a>.
            </div>
            <UsdaKeyEditor
              hasKey={!!user.hasUsdaKey}
              disabled={goalM.isPending}
              onSave={(k) => goalM.mutate({ goal: user.goal ?? 'MAINTAIN', calorieBaseline: user.calorieBaseline ?? 2200, calorieSource: user.calorieSource ?? 'BASELINE', usdaApiKey: k })}
              onClear={() => goalM.mutate({ goal: user.goal ?? 'MAINTAIN', calorieBaseline: user.calorieBaseline ?? 2200, calorieSource: user.calorieSource ?? 'BASELINE', usdaApiKey: '' })}
            />
            <div className="text-[10px] font-mono text-ink-500">
              // private to you. Never sent anywhere except
              api.data.gov for the food lookup. Stored hashed at rest.
            </div>
          </div>
        </Panel>

        {/* DATA export + import */}
        <DataPanel />

        {/* ACCOUNT */}
        <TwoFactorSetup />
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

function UsdaKeyEditor({
  hasKey,
  disabled,
  onSave,
  onClear,
}: {
  hasKey: boolean;
  disabled: boolean;
  onSave: (key: string) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (hasKey && !editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono text-emerald-300">✓ Key set</span>
        <span className="text-[10px] font-mono text-ink-400">
          (hidden — leave blank to keep, type to replace)
        </span>
        <NeonButton size="sm" variant="amber" onClick={() => setEditing(true)}>
          Replace
        </NeonButton>
        <NeonButton size="sm" variant="magenta" onClick={onClear} disabled={disabled}>
          Remove
        </NeonButton>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        autoComplete="off"
        className="input-neon flex-1 font-mono"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={hasKey ? '•••• (leave blank to keep current)' : 'paste your USDA FDC API key'}
        autoFocus={editing}
      />
      <NeonButton
        size="sm"
        variant="amber"
        onClick={() => {
          if (draft.trim().length > 0) {
            onSave(draft.trim());
            setDraft('');
            setEditing(false);
          }
        }}
        disabled={disabled || draft.trim().length === 0}
      >
        Save
      </NeonButton>
      {hasKey && (
        <NeonButton
          size="sm"
          variant="cyan"
          onClick={() => {
            setDraft('');
            setEditing(false);
          }}
        >
          Cancel
        </NeonButton>
      )}
    </div>
  );
}
