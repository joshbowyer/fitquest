import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { classNames } from '@/lib/format';
import type { SpiritualReflection } from '@/lib/types';

type Props = {
  /** Hide the patron-suggestion row (e.g. on a tight layout). */
  hidePatron?: boolean;
  /** Hide the gospel passage (collapsed default for the dashboard
   *  variant; expanded on the /spiritual page). */
  collapseGospel?: boolean;
  /** Hide the regenerate button. */
  hideRegenerate?: boolean;
};

/**
 * Renders the day's USCCB Gospel alongside an LLM-tailored
 * reflection from the spiritual director. Designed for the
 * /spiritual page; reuse on dashboard with collapseGospel=true.
 */
export function SpiritualDirectorCard({ hidePatron, collapseGospel, hideRegenerate }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['spiritual', 'director'],
    queryFn: () => api<SpiritualReflection>('/spiritual/director'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const regenM = useDelayedMutation({
    mutationFn: () => api<SpiritualReflection>('/spiritual/director/regenerate', { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(['spiritual', 'director'], r),
  }, 1500);

  if (q.isError || q.error) {
    return null; // Don't break the page on failure
  }
  if (q.isLoading) {
    return (
      <Panel title="Spiritual director" variant="violet" className="border-neon-violet/30">
        <div className="text-sm text-slate-400 font-mono py-2">⏳ Preparing today's reflection…</div>
      </Panel>
    );
  }

  const r = q.data;
  if (!r) {
    return (
      <Panel title="Spiritual director" variant="violet">
        <div className="text-sm text-slate-400 font-mono py-1">
          No reading available for today. The USCCB feed may be stale or the date is outside the cached window.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Spiritual director"
      variant="violet"
      className="border-neon-violet/30"
      action={
        !hideRegenerate && (
          <NeonButton
            size="sm"
            variant="violet"
            disabled={regenM.isPending}
            onClick={() => regenM.run()}
            title="Regenerate reflection with current state"
          >
            {regenM.isPending ? '…' : '↻'}
          </NeonButton>
        )
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-violet/70 mb-1">
            {r.liturgicalInfo} · {r.gospelRef}
          </div>
        </div>
        {r.reflection && (
          <div className="text-sm text-slate-100 leading-relaxed">
            <span className="text-violet-300 font-display tracking-widest text-[10px] uppercase mr-2 align-baseline">
              // reflection
            </span>
            {r.reflection}
          </div>
        )}
        {!r.reflection && (
          <div className="text-sm text-slate-400 font-mono">
            The reading is here, but the LLM reflection is empty (LLM not configured or disabled — see /admin).
          </div>
        )}
        {!hidePatron && r.patronSuggestion && (
          <div className="text-xs text-violet-200 font-mono border-t border-neon-violet/15 pt-2">
            ☩ Consider: <span className="text-violet-100">{r.patronSuggestion}</span>
          </div>
        )}
        {!collapseGospel && r.gospelText && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-400 font-mono select-none hover:text-slate-200">
              {`▸ Today's Gospel (${r.gospelRef})`}
            </summary>
            <div className="mt-2 text-slate-300 leading-relaxed whitespace-pre-wrap font-mono pl-3 border-l border-neon-violet/20">
              {r.gospelText}
            </div>
          </details>
        )}
        <div className="text-[10px] font-mono text-slate-500">
          {r.cached ? 'cached' : 'fresh'} · {r.model ?? '—'} · {r.latencyMs != null ? `${r.latencyMs}ms` : ''} · {new Date(r.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>
    </Panel>
  );
}
