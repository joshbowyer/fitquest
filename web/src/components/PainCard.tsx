import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  Tooltip,
} from 'recharts';
import { api } from '@/lib/api';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { BODY_PARTS_UI, BODY_PARTS, intensityToColor, intensityLabel } from '@/components/BodyModel';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames, formatRelative } from '@/lib/format';

type PainLog = {
  id: string;
  bodyPart: string;
  intensity: number;
  notes: string | null;
  loggedAt: string;
};

type PainLogsResponse = {
  logs: PainLog[];
  summary: Record<string, { latest: number; avg: number; count: number; latestAt: string }>;
};

/**
 * Pain card on the Today page. Surfaces the user's current active
 * pain logs (intensity > 0) with:
 *   - body part + intensity
 *   - a 14-day sparkline so the user can see "is it going down?"
 *   - a "pain is gone" quick action that posts intensity=0 for the
 *     same body part (no schema change — keeps a record of when it
 *     resolved)
 * If no pain is active, the card collapses to a one-line "no pain
 * today" message + a "Log" button.
 */
export function PainCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ bodyPart: string; intensity: number; notes: string } | null>(null);

  // Fetch last 30 days so the sparkline has enough data.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const logsQ = useQuery({
    queryKey: ['pain-logs', since],
    queryFn: () => api<PainLogsResponse>(`/pain-logs?since=${encodeURIComponent(since)}`),
  });

  const archive = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/pain-logs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pain-logs'] }),
  }, 400);

  const save = useDelayedMutation<{ id: string }, void>({
    mutationFn: () =>
      api('/pain-logs', {
        method: 'POST',
        body: {
          bodyPart: editing!.bodyPart,
          intensity: editing!.intensity,
          notes: editing!.notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pain-logs'] });
      qc.invalidateQueries({ queryKey: ['status'] });
      setEditing(null);
    },
  }, 400);

  // Active = intensity > 0. Find the most recently logged one.
  const active = (logsQ.data?.logs ?? [])
    .filter((l) => l.intensity > 0)
    .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());
  const top = active[0] ?? null;
  const partMeta = top
    ? BODY_PARTS_UI.find((p) => p.id === top.bodyPart) ?? BODY_PARTS.find((p) => p.id === top.bodyPart)
    : null;

  // 14-day sparkline for the active body part.
  const sparkData = top
    ? buildSparkData(logsQ.data?.logs ?? [], top.bodyPart, 14)
    : [];

  function painIsGone() {
    if (!top) return;
    setEditing({
      bodyPart: top.bodyPart,
      intensity: 0,
      notes: '',
    });
  }

  function logNew() {
    // Default to logging on the same body part the user already has pain in
    // (if any); otherwise the first body part. The modal lets them re-pick.
    setEditing({
      bodyPart: top?.bodyPart ?? BODY_PARTS_UI[0]?.id ?? 'CHEST',
      intensity: 5,
      notes: '',
    });
  }

  return (
    <Panel variant="violet" title="Pain">
      {logsQ.isLoading ? (
        <div className="text-[10px] font-mono text-ink-300">loading…</div>
      ) : !top ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-mono text-ink-300">
            No active pain. Click the body map on <span className="neon-text-violet">Status</span> for full logging.
          </div>
          <NeonButton onClick={logNew} variant="violet" icon="⚠">
            Log
          </NeonButton>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 grid place-items-center font-display text-base shrink-0"
              style={{
                color: intensityToColor(top.intensity),
                border: `2px solid ${intensityToColor(top.intensity)}`,
                textShadow: `0 0 6px ${intensityToColor(top.intensity)}`,
              }}
            >
              {top.intensity}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-ink-100 truncate">
                {partMeta?.label ?? top.bodyPart}
              </div>
              <div className="text-[10px] font-mono text-ink-400">
                {intensityLabel(top.intensity)} · last logged {formatRelative(top.loggedAt)}
                {active.length > 1 && ` · ${active.length} active`}
              </div>
            </div>
          </div>

          {/* "Is it going down?" sparkline — last 14 days for this part */}
          {sparkData.length > 1 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400 mb-1">
                Is it going down?
              </div>
              <div className="h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
                    <YAxis domain={[0, 10]} hide />
                    <Tooltip
                      contentStyle={{ background: '#0b0e1a', border: '1px solid #333', fontSize: 11 }}
                      labelFormatter={(v) => new Date(v as string).toLocaleDateString()}
                      formatter={(v) => [`${v}/10`, 'Pain']}
                    />
                    <Line
                      type="monotone"
                      dataKey="intensity"
                      stroke={intensityToColor(top.intensity)}
                      strokeWidth={2}
                      dot={{ r: 2, fill: intensityToColor(top.intensity) }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <NeonButton onClick={painIsGone} variant="lime" icon="✓">
              Pain is gone
            </NeonButton>
            <NeonButton onClick={logNew} variant="violet" icon="⚠">
              Update
            </NeonButton>
            <button
              onClick={() => archive.run(top.id)}
              disabled={archive.isPending}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/30 text-ink-400 hover:border-neon-magenta hover:text-neon-magenta ml-auto"
              title="Delete this pain log"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {editing && (
        <PainLogModal
          bodyPart={editing.bodyPart}
          intensity={editing.intensity}
          notes={editing.notes}
          onChange={(patch) => setEditing({ ...editing, ...patch })}
          onClose={() => setEditing(null)}
          onSave={() => save.run()}
          saving={save.isPending}
        />
      )}
    </Panel>
  );
}

function buildSparkData(logs: PainLog[], bodyPart: string, days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  // Latest reading per day for the requested body part.
  const latestPerDay = new Map<string, PainLog>();
  for (const l of logs) {
    if (l.bodyPart !== bodyPart) continue;
    const t = new Date(l.loggedAt).getTime();
    if (t < cutoff) continue;
    const day = new Date(l.loggedAt).toISOString().slice(0, 10);
    const cur = latestPerDay.get(day);
    if (!cur || new Date(cur.loggedAt).getTime() < t) {
      latestPerDay.set(day, l);
    }
  }
  // Build a continuous timeline so the sparkline doesn't have gaps.
  const out: Array<{ date: string; intensity: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out.push({ date: day, intensity: latestPerDay.get(day)?.intensity ?? 0 });
  }
  return out;
}

function PainLogModal({
  bodyPart,
  intensity,
  notes,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  bodyPart: string;
  intensity: number;
  notes: string;
  onChange: (patch: { bodyPart?: string; intensity?: number; notes?: string }) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const partMeta = BODY_PARTS_UI.find((p) => p.id === bodyPart) ?? BODY_PARTS.find((p) => p.id === bodyPart);
  const color = intensityToColor(intensity);
  return (
    <Modal open onClose={onClose} title={`Log pain · ${partMeta?.label ?? bodyPart}`}>
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Body part
          </label>
          <select
            className="input-neon w-full"
            value={bodyPart}
            onChange={(e) => onChange({ bodyPart: e.target.value })}
          >
            {BODY_PARTS_UI.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-2">
            Intensity
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={10}
              value={intensity}
              onChange={(e) => onChange({ intensity: Number(e.target.value) })}
              className="flex-1"
            />
            <div
              className="w-12 h-12 grid place-items-center font-display text-lg"
              style={{ color, border: `2px solid ${color}`, textShadow: `0 0 6px ${color}` }}
            >
              {intensity}
            </div>
          </div>
          <div
            className={classNames(
              'text-[10px] font-mono mt-1 tracking-widest uppercase',
            )}
            style={{ color }}
          >
            {intensityLabel(intensity)}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="sharp on outside, dull after warmup, etc."
            rows={3}
            maxLength={500}
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono focus:outline-none focus:border-neon-cyan"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
          <NeonButton
            variant={intensity === 0 ? 'lime' : 'violet'}
            onClick={onSave}
            loading={saving}
            icon={intensity === 0 ? '✓' : '⚡'}
            loadingText="Saving…"
          >
            {intensity === 0 ? 'Mark resolved' : 'Save'}
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}