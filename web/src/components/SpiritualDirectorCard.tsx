import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
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
 *
 * Error handling: if the LLM call fails (timeout, model down,
 * bad JSON response, etc.), we show a card with the error and
 * auto-retry on a fixed timer — 30s for the first retry, 60s
 * for the second, 120s thereafter. The user gets feedback
 * ("Couldn't reach Ollama, retrying in 25s…") instead of a
 * silent disappearance. Permanent errors (LLM disabled, USCCB
 * no reading for today) surface as a "won't retry" message.
 */
export function SpiritualDirectorCard({ hidePatron, collapseGospel, hideRegenerate }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['spiritual', 'director'],
    queryFn: () => api<SpiritualReflection>('/spiritual/director'),
    staleTime: 5 * 60 * 1000,
    // We manage retries ourselves (with backoff) below, so disable
    // react-query's automatic retries to avoid double-fetching.
    retry: false,
  });

  // Manual retry state. retryCount tracks how many automatic
  // retries have fired since the last successful fetch (or first
  // error). retryAt is the wall-clock time when the next retry
  // will fire. The countdown is driven by useEffect + setInterval
  // so it actually updates every second without re-rendering the
  // whole tree.
  const [retryCount, setRetryCount] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // When the query errors (and isn't currently fetching), schedule
  // the next retry. Schedule lengths grow so a persistently-broken
  // backend doesn't hammer the server: 30s / 60s / 120s / 120s / ...
  useEffect(() => {
    if (!q.isError || q.isFetching) return;
    const delays = [30_000, 60_000, 120_000, 120_000, 120_000];
    const delay = delays[Math.min(retryCount, delays.length - 1)];
    setRetryAt(Date.now() + delay);
  }, [q.isError, q.isFetching, retryCount, q.errorUpdatedAt]);

  // Countdown ticker. Cleared when retryAt goes null.
  useEffect(() => {
    if (retryAt == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  // When the timer hits 0, fire the next retry and bump the count
  // so the next schedule picks a longer delay.
  useEffect(() => {
    if (retryAt == null || now < retryAt) return;
    setRetryAt(null);
    setRetryCount((c) => c + 1);
    qc.invalidateQueries({ queryKey: ['spiritual', 'director'] });
  }, [now, retryAt, qc]);

  // Heuristic: classify the error message to decide whether it's
  // transient (worth retrying) or permanent (won't help to retry).
  // The server doesn't expose a status code field on
  // useQuery's error, so we inspect the message body. This is
  // best-effort — anything we don't recognise gets the
  // retry treatment.
  const errMsg = q.error ? String((q.error as any).message ?? q.error) : '';
  const isPermanent = /no reading available|no LLM configured|LLM not configured|LLM disabled/i.test(errMsg);

  const regenM = useDelayedMutation({
    mutationFn: () => api<SpiritualReflection>('/spiritual/director/regenerate', { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['spiritual', 'director'], r);
      setRetryCount(0);
      setRetryAt(null);
    },
  }, 1500);

  if (q.isLoading) {
    return (
      <Panel title="Spiritual director" variant="violet" className="border-neon-violet/30">
        <div className="text-sm text-slate-400 font-mono py-2">⏳ Preparing today's reflection…</div>
      </Panel>
    );
  }

  if (q.isError) {
    const secondsLeft = retryAt != null ? Math.max(0, Math.round((retryAt - now) / 1000)) : null;
    return (
      <Panel title="Spiritual director" variant="violet" className="border-neon-violet/30">
        <div className="space-y-2 py-1">
          <div className="text-sm text-rose-300 font-mono">
            ✗ {errMsg || "Couldn't load today's reflection"}
          </div>
          {!isPermanent && secondsLeft != null && (
            <div className="text-[11px] font-mono text-ink-400">
              ⟳ Auto-retry in {secondsLeft}s
              <span className="text-ink-500"> · attempt {retryCount + 1}</span>
            </div>
          )}
          {!isPermanent && (
            <div className="flex gap-2 pt-1">
              <NeonButton
                size="sm"
                variant="violet"
                disabled={q.isFetching}
                onClick={() => {
                  setRetryAt(null);
                  setRetryCount(0);
                  qc.invalidateQueries({ queryKey: ['spiritual', 'director'] });
                }}
              >
                Retry now
              </NeonButton>
              {!hideRegenerate && (
                <NeonButton
                  size="sm"
                  variant="violet"
                  disabled={regenM.isPending}
                  loading={regenM.isPending}
                  onClick={() => regenM.run()}
                >
                  Force regenerate
                </NeonButton>
              )}
            </div>
          )}
          {isPermanent && (
            <div className="text-[11px] font-mono text-ink-500">
              Check /admin → LLM config, or the USCCB feed for today's date.
            </div>
          )}
        </div>
      </Panel>
    );
  }

  const r = q.data;
  if (!r) {
    return (
      <Panel title="Spiritual director" variant="violet">
        <div className="space-y-2 py-1">
          <div className="text-sm text-slate-300 font-mono">
            No USCCB reading available right now.
          </div>
          <div className="text-[11px] font-mono text-ink-400 leading-relaxed">
            The USCCB redesigned their site in mid-2026 and stopped
            shipping reading text in their RSS feed — the per-day
            pages are now JavaScript-rendered and Wayback snapshots
            don't always have the readings either. Our cache falls
            back to the legacy <code>.cfm</code> snapshots when
            possible. If this persists past a day, the readings
            are genuinely unreachable from a server-side fetch.
          </div>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ['spiritual', 'director'] })}
            className="text-[10px] font-mono text-violet-300 hover:underline"
          >
            ↻ Re-check
          </button>
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
            <span className="text-[10px] font-mono text-ink-500 ml-2">RSV-CE · EWTN</span>
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