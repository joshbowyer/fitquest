import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames } from '@/lib/format';
import type { MorningReport } from '@/lib/types';

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
  // or LLM not configured).
  const hasContent = r.general || r.sleep || r.training || r.recovery || r.nutrition || r.spiritual;
  if (!hasContent && r.riskFlags.length === 0) {
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
