import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames } from '@/lib/format';
import type { MorningReport, Penalty, Nudge, Plateau } from '@/lib/types';

type Props = {
  /** When true, the per-metric insights are also rendered in their
   *  own rows (e.g. for embedding inside a larger dashboard). */
  withMetricInsights?: boolean;
  /** Hide the regenerate button (e.g. when embedded inline). */
  hideRegenerate?: boolean;
};

/**
 * Top-of-dashboard morning briefing. Renders the `general` cross-
 * domain advice as the headline, plus optional per-metric insight
 * rows that the Dashboard can also render individually in their
 * own metric panels (the same row data is consumed twice).
 */
export function MorningReportCard({ withMetricInsights, hideRegenerate }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['morning-report'],
    queryFn: () => api<MorningReport>('/morning-report'),
    // 7-day TTL is enforced server-side; this just stops refetch storms
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const regenM = useDelayedMutation({
    mutationFn: () => api<MorningReport>('/morning-report/regenerate', { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(['morning-report'], r),
  }, 1500);

  if (q.isError) {
    return null; // Don't break the dashboard on report failure
  }
  if (q.isLoading) {
    return (
      <Panel
        title="Morning briefing"
        variant="cyan"
        className="border-neon-cyan/30"
      >
        <div className="text-sm text-slate-400 font-mono py-2">
          ⏳ Generating your briefing…
        </div>
      </Panel>
    );
  }

  const r = q.data;
  if (!r) return null;

  // Hide the whole card if everything is empty (no data logged yet,
  // or LLM not configured). Penalties + plateaus + nudges count as
  // content so the user always sees the deterministic engines'
  // output even if the LLM prose is empty.
  const hasContent =
    r.general || r.sleep || r.training || r.recovery || r.nutrition || r.spiritual;
  const hasDeterministic =
    (r.penalties?.length ?? 0) > 0 ||
    (r.plateaus?.length ?? 0) > 0 ||
    (r.nudges?.length ?? 0) > 0;
  if (!hasContent && r.riskFlags.length === 0 && !hasDeterministic) {
    return (
      <Panel title="Morning briefing" variant="cyan">
        <div className="text-sm text-slate-400 font-mono py-1">
          Log a few days of sleep, workouts, or supplements to unlock your daily briefing.
        </div>
        {!hideRegenerate && (
          <div className="mt-2 flex justify-end">
            <NeonButton
              size="sm"
              variant="cyan"
              disabled={regenM.isPending}
              onClick={() => regenM.run()}
            >
              {regenM.isPending ? 'Generating…' : 'Generate now'}
            </NeonButton>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title="Morning briefing"
      variant="cyan"
      className="border-neon-cyan/40"
      action={
        !hideRegenerate && (
          <NeonButton
            size="sm"
            variant="cyan"
            disabled={regenM.isPending}
            onClick={() => regenM.run()}
            title="Regenerate using current data"
          >
            {regenM.isPending ? '…' : '↻'}
          </NeonButton>
        )
      }
    >
      {r.general && (
        <div className="text-sm text-slate-100 leading-relaxed">
          <span className="text-cyan-300 font-display tracking-widest text-[10px] uppercase mr-2">
            // today
          </span>
          {r.general}
        </div>
      )}
      {withMetricInsights && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          <MetricRow label="Sleep" text={r.sleep} color="lime" />
          <MetricRow label="Training" text={r.training} color="amber" />
          <MetricRow label="Recovery" text={r.recovery} color="violet" />
          <MetricRow label="Nutrition" text={r.nutrition} color="amber" />
          <MetricRow label="Spiritual" text={r.spiritual} color="periwinkle" wide />
        </div>
      )}
      {r.riskFlags.length > 0 && (
        <div className="mt-3 border-t border-amber-500/20 pt-2 space-y-1">
          <div className="text-[10px] font-display tracking-widest uppercase text-amber-300">
            ⚠ Watch
          </div>
          {r.riskFlags.map((flag, i) => (
            <div key={i} className="text-xs text-amber-200 leading-snug">
              • {flag}
            </div>
          ))}
        </div>
      )}

      {/* Macro/timing nudges. Warnings first, positive observations
          below in a separate sub-section so the user sees both
          "watch this" and "good calls" at a glance. */}
      {(r.nudges?.length ?? 0) > 0 && (
        <div className="mt-3 border-t border-amber-500/20 pt-2 space-y-1.5">
          <div className="text-[10px] font-display tracking-widest uppercase text-amber-300">
            ⚠ Macro nudges
          </div>
          {r.nudges.map((n, i) => (
            <NudgeRow key={`w${i}`} nudge={n} />
          ))}
        </div>
      )}
      {(r.positiveNudges?.length ?? 0) > 0 && (
        <div className="mt-3 border-t border-lime-500/20 pt-2 space-y-1.5">
          <div className="text-[10px] font-display tracking-widest uppercase text-lime-300">
            ✓ Good calls
          </div>
          {r.positiveNudges.map((n, i) => (
            <NudgeRow key={`p${i}`} nudge={n} />
          ))}
        </div>
      )}

      {/* Anti-staleness plateaus. Detected by the plateau engine
          (NO_PR_RECENT, ONE_RM_REGRESSION, VOLUME_REGRESSION,
          WEIGHT_FLATLINE, METRIC_FLATLINE). Surfaced only when the
          user has a real signal — empty array renders nothing. */}
      {(r.plateaus?.length ?? 0) > 0 && (
        <div className="mt-3 border-t border-violet-500/20 pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-display tracking-widest uppercase text-violet-300">
              ⚠ Stale
            </div>
            <span className="text-[10px] font-mono text-violet-400">
              {r.plateaus.length} flag{r.plateaus.length === 1 ? '' : 's'}
            </span>
          </div>
          {r.plateaus.map((p, i) => (
            <PlateauRow key={`p${i}`} plateau={p} />
          ))}
        </div>
      )}

      {/* Hardcore-mode penalty ledger. Only renders when there are
          active penalties; the array is empty for Casual users OR
          for Hardcore users who are currently clean (full hearts,
          no caps exceeded). */}
      {r.penalties && r.penalties.length > 0 && (
        <div className="mt-3 border-t border-rose-500/30 pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-display tracking-widest uppercase text-rose-300">
              ⚠ Penalties · Hardcore
            </div>
            <span className="text-[10px] font-mono text-rose-400">
              {r.penalties.length} active
            </span>
          </div>
          {r.penalties.map((p, i) => (
            <PenaltyRow key={i} penalty={p} />
          ))}
        </div>
      )}
      <div className="mt-2 text-[10px] font-mono text-slate-500">
        {r.cached ? 'cached' : 'fresh'} · {r.model ?? '—'} · {r.latencyMs != null ? `${r.latencyMs}ms` : ''} · {new Date(r.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </div>
    </Panel>
  );
}

function MetricRow({
  label,
  text,
  color,
  wide,
}: {
  label: string;
  text: string;
  color: 'lime' | 'amber' | 'violet' | 'periwinkle';
  wide?: boolean;
}) {
  if (!text) return null;
  return (
    <div
      className={classNames(
        'text-xs leading-snug p-2 border',
        `border-neon-${color}/20 bg-neon-${color}/5`,
        wide && 'sm:col-span-2',
      )}
    >
      <span className={`text-[10px] font-display tracking-widest uppercase neon-text-${color} mr-2`}>
        {label}
      </span>
      <span className="text-slate-200">{text}</span>
    </div>
  );
}

/**
 * One row in the Penalties ledger. Visual tone follows severity:
 *   - 'warn'  = amber chip, advisory
 *   - 'scold' = magenta chip, active penalty (e.g. halved rewards)
 *
 * The label is the chip on the left (Hearts / Caffeine / etc.),
 * the note is the prose on the right. Wraps cleanly on narrow
 * viewports.
 */
function PenaltyRow({ penalty }: { penalty: Penalty }) {
  const isScold = penalty.severity === 'scold';
  const tone = isScold ? 'magenta' : 'amber';
  return (
    <div
      className={classNames(
        'flex items-baseline gap-2 p-2 border text-xs leading-snug',
        `border-neon-${tone}/30 bg-neon-${tone}/5`,
      )}
    >
      <span
        className={classNames(
          'shrink-0 text-[10px] font-display tracking-widest uppercase px-1.5 py-0.5',
          `neon-text-${tone} border border-neon-${tone}/50 bg-bg-900/40`,
        )}
      >
        {isScold ? '⚡' : '⚠'} {penalty.label}
      </span>
      <span className="text-ink-200 flex-1">{penalty.note}</span>
    </div>
  );
}

/**
 * One row in the Macro-nudges / Good-calls ledger. Same shape as
 * PenaltyRow but tuned for macro/timing rules — cyan-tinted chip,
 * positive observations use a lime ✦ prefix instead of ⚠.
 */
function NudgeRow({ nudge }: { nudge: Nudge }) {
  const isPositive = nudge.severity === 'positive';
  const tone = isPositive ? 'lime' : 'amber';
  return (
    <div
      className={classNames(
        'flex items-baseline gap-2 p-2 border text-xs leading-snug',
        `border-neon-${tone}/30 bg-neon-${tone}/5`,
      )}
    >
      <span
        className={classNames(
          'shrink-0 text-[10px] font-display tracking-widest uppercase px-1.5 py-0.5',
          `neon-text-${tone} border border-neon-${tone}/50 bg-bg-900/40`,
        )}
      >
        {isPositive ? '✦' : '⚠'} {nudge.label}
      </span>
      <span className="text-ink-200 flex-1">{nudge.note}</span>
    </div>
  );
}

/**
 * One row in the Stale (plateau) ledger. Scolds (magenta) take
 * visual priority over warnings (amber). Tells the user what
 * regressed and — implicitly via the note — what to do about it.
 */
function PlateauRow({ plateau }: { plateau: Plateau }) {
  const isScold = plateau.severity === 'scold';
  const tone = isScold ? 'magenta' : 'amber';
  return (
    <div
      className={classNames(
        'flex items-baseline gap-2 p-2 border text-xs leading-snug',
        `border-neon-${tone}/30 bg-neon-${tone}/5`,
      )}
    >
      <span
        className={classNames(
          'shrink-0 text-[10px] font-display tracking-widest uppercase px-1.5 py-0.5',
          `neon-text-${tone} border border-neon-${tone}/50 bg-bg-900/40`,
        )}
      >
        {isScold ? '⚡' : '⚠'} {plateau.label}
      </span>
      <span className="text-ink-200 flex-1">{plateau.note}</span>
    </div>
  );
}
