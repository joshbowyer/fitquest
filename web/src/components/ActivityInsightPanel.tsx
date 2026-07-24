import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { classNames } from '@/lib/format';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';

export type InsightFactor = {
  label: string;
  signal: 'positive' | 'negative' | 'neutral';
  weight: number;
  note: string;
};

export type ActivityInsightDto = {
  id: string;
  workoutId: string;
  summary: string;
  qualityScore: number;
  recoveryLoad: 'light' | 'normal' | 'rest';
  confidence: 'low' | 'medium' | 'high';
  factors: InsightFactor[];
  model: string | null;
  latencyMs: number | null;
  promptVersion: number;
  createdAt: string;
  updatedAt: string;
};

type GetResp = { insight: ActivityInsightDto; promptVersion: number };
type PostResp = { insight: ActivityInsightDto; cached: boolean; promptVersion: number };

/**
 * Renders the AI insight block on /activities/:id. Three states:
 *   - loading on first GET
 *   - empty (404) → "Generate" button
 *   - populated → summary + quality score + recovery recommendation
 *     + factor chips + "Regenerate" button
 *
 * The factor chips use a colour-coded signal (positive=lime,
 * negative=magenta, neutral=cyan) and a font-size proportional to
 * weight so the most-important factor reads biggest.
 */
export function ActivityInsightPanel({ workoutId }: { workoutId: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const insightQ = useQuery({
    queryKey: ['workout-insight', workoutId],
    queryFn: () => api<GetResp>(`/workouts/${workoutId}/insight`),
    retry: false,
  });

  const generateM = useDelayedMutation<PostResp, boolean | undefined>(
    {
      mutationFn: (force) =>
        api<PostResp>(
          `/workouts/${workoutId}/insight${force ? '?force=1' : ''}`,
          { method: 'POST' },
        ),
      onError: (e) => {
        setErr(e instanceof ApiError ? e.message : 'Generation failed');
      },
      onSuccess: () => {
        setShowGenerate(false);
        insightQ.refetch();
      },
    },
    800,
  );

  if (insightQ.isLoading) {
    return (
      <Panel variant="violet" title="🧠 AI insight" className="border-neon-violet/30">
        <div className="text-[10px] font-mono text-ink-400">Loading…</div>
      </Panel>
    );
  }

  // 404: no insight yet → show generate button
  if (insightQ.isError || !insightQ.data) {
    if (!showGenerate) {
      return (
        <Panel variant="violet" title="🧠 AI insight" className="border-neon-violet/30">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-mono text-ink-300 leading-relaxed">
              Per-session AI analysis. Scores this workout against your
              recent HRV, sleep, soreness, and exercise history, and
              recommends recovery load for the next 24-48h.
            </div>
            <NeonButton
              size="sm"
              variant="violet"
              onClick={() => setShowGenerate(true)}
            >
              Generate
            </NeonButton>
          </div>
        </Panel>
      );
    }
    return (
      <Panel variant="violet" title="🧠 AI insight" className="border-neon-violet/30">
        <div className="text-[11px] font-mono text-ink-300 mb-2">
          This takes 5-15 seconds — gathering HRV, sleep, and exercise
          history then asking the model for a structured analysis.
        </div>
        <div className="flex items-center gap-2">
          <NeonButton
            size="sm"
            variant="violet"
            loading={generateM.isPending}
            loadingText="Generating…"
            onClick={() => {
              setErr(null);
              generateM.run(false);
            }}
          >
            Run analysis
          </NeonButton>
          <button
            type="button"
            onClick={() => setShowGenerate(false)}
            className="text-[10px] font-mono text-ink-400 hover:text-ink-200"
          >
            cancel
          </button>
        </div>
        {err && (
          <div className="mt-2 text-[10px] text-rose-300 font-mono">{err}</div>
        )}
      </Panel>
    );
  }

  // Populated: render the insight
  const insight = insightQ.data.insight;
  return (
    <Panel
      variant="violet"
      title="🧠 AI insight"
      className="border-neon-violet/30"
      action={
        <button
          type="button"
          onClick={() => generateM.run(true)}
          disabled={generateM.isPending}
          className="text-[10px] font-mono uppercase tracking-widest text-violet-300 hover:underline disabled:opacity-50"
          title="Regenerate using latest context (HRV, sleep, soreness)"
        >
          {generateM.isPending ? 'regenerating…' : 'regenerate'}
        </button>
      }
    >
      <InsightBody insight={insight} />
      {err && (
        <div className="mt-3 text-[10px] text-rose-300 font-mono">{err}</div>
      )}
    </Panel>
  );
}

function InsightBody({ insight }: { insight: ActivityInsightDto }) {
  const qualityColor =
    insight.qualityScore >= 8 ? 'lime' :
    insight.qualityScore >= 5 ? 'cyan' :
    'magenta';

  const recoveryTone =
    insight.recoveryLoad === 'rest' ? 'magenta' :
    insight.recoveryLoad === 'light' ? 'amber' :
    'cyan';

  const recoveryCopy =
    insight.recoveryLoad === 'rest' ? 'Rest today. Walk or mobility only.' :
    insight.recoveryLoad === 'light' ? 'Light session next. Bodyweight or 50% volume.' :
    'Train normally.';

  return (
    <>
      <div className="text-[11px] font-mono text-ink-200 leading-relaxed mb-3 whitespace-pre-wrap">
        {insight.summary}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <ScoreTile
          label="Quality"
          value={`${insight.qualityScore}/10`}
          accent={qualityColor}
        />
        <ScoreTile
          label="Next session"
          value={recoveryCopy}
          accent={recoveryTone}
        />
        <ScoreTile
          label="Confidence"
          value={insight.confidence}
          accent={insight.confidence === 'high' ? 'lime' : insight.confidence === 'medium' ? 'cyan' : 'amber'}
          mono
        />
      </div>

      {insight.factors.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
            Key factors
          </div>
          <ul className="space-y-1">
            {insight.factors
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .map((f, i) => (
                <FactorRow key={`${f.label}-${i}`} factor={f} />
              ))}
          </ul>
        </div>
      )}

      {insight.model && (
        <div className="mt-3 text-[10px] font-mono text-ink-500">
          generated by {insight.model}
          {insight.latencyMs != null && ` · ${(insight.latencyMs / 1000).toFixed(1)}s`}
        </div>
      )}
    </>
  );
}

function ScoreTile({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: string;
  accent: 'lime' | 'cyan' | 'amber' | 'magenta';
  mono?: boolean;
}) {
  return (
    <div className={`border border-neon-${accent}/30 bg-neon-${accent}/5 p-2`}>
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400">
        {label}
      </div>
      <div
        className={classNames(
          mono ? 'font-mono text-xs' : 'font-display text-sm',
          `text-neon-${accent} mt-0.5`,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FactorRow({ factor }: { factor: InsightFactor }) {
  const signalColor =
    factor.signal === 'positive' ? 'lime' :
    factor.signal === 'negative' ? 'magenta' :
    'cyan';
  const size = 10 + Math.round(factor.weight * 4); // 10..14 px
  return (
    <li className="flex items-baseline gap-2 text-[11px] font-mono">
      <span
        className={`text-neon-${signalColor} shrink-0`}
        style={{ fontSize: `${size}px` }}
      >
        {factor.signal === 'positive' ? '▲' : factor.signal === 'negative' ? '▼' : '◆'}
      </span>
      <span className={`text-neon-${signalColor} shrink-0 font-display uppercase tracking-widest`}>
        {factor.label}
      </span>
      <span className="text-ink-300 flex-1 truncate" title={factor.note}>
        {factor.note}
      </span>
    </li>
  );
}