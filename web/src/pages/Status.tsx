import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { Avatar } from '@/components/Avatar';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import {
  BodyModel,
  BODY_PARTS,
  intensityToColor,
  intensityLabel,
  type BodyPartMeta,
  type BodyPartId,
  type PainMarker,
} from '@/components/BodyModel';
import { getFrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { WORLD_COLOR_HEX } from '@/lib/quest';
import { classNames } from '@/lib/format';

type PainLogEntry = {
  id: string;
  bodyPart: BodyPartId;
  intensity: number;
  notes: string | null;
  loggedAt: string;
};

type PainLogsResponse = {
  logs: PainLogEntry[];
  summary: Record<string, { latest: number; avg: number; count: number; latestAt: string }>;
};

export function StatusPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<BodyPartMeta | null>(null);
  const [hovered, setHovered] = useState<BodyPartMeta | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pain-logs'],
    queryFn: () => api<PainLogsResponse>('/pain-logs'),
  });

  const archive = useDelayedMutation<
    { ok: boolean },
    string
  >({
    mutationFn: (id: string) =>
      api(`/pain-logs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pain-logs'] }),
  }, 400);

  if (!user) return null;

  const archetype = getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE';
  const meta = ARCHETYPE_META[archetype];

  // Convert summary to marker list
  const markers: PainMarker[] = data
    ? Object.entries(data.summary).map(([partId, s]) => ({
        bodyPart: partId as BodyPartId,
        intensity: Math.round(s.latest),
        count: s.count,
        latestAt: s.latestAt,
      }))
    : [];

  const bf = user.bodyFatPct ?? null;
  const weight = user.weightKg ?? null;
  const height = user.heightCm ?? null;
  // Lean mass = weight * (1 - bf)
  const lbm = bf != null && weight != null ? weight * (1 - bf / 100) : null;
  // FFMI = LBM / (height_m)^2 + adjustment
  const ffmi = lbm != null && height != null ? lbm / Math.pow(height / 100, 2) + 6.1 * (1.8 / (height / 100)) : null;

  return (
    <Layout>
      <PageHeader
        title="Status"
        subtitle="A holographic readout of your body. Click a part to log pain, hover for details."
      />

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <Panel title="Hologram" variant="cyan">
          <BodyModel
            markers={markers}
            onPartClick={(p) => setSelected(p)}
            onPartHover={(p) => setHovered(p)}
            height={520}
          />
          {hovered && (
            <div className="mt-2 px-3 py-2 border border-neon-cyan/40 bg-bg-900/80 text-xs font-mono">
              <span className="text-ink-300">Hover:</span>{' '}
              <span className="text-neon-cyan">{hovered.label}</span>{' '}
              <span className="text-ink-400">·</span>{' '}
              <span className="text-ink-200">click to log pain</span>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Identity" variant="amber">
            <div className="flex items-center gap-3 mb-3">
              <Avatar
                archetype={archetype}
                accentColor={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : '#14d6e8'}
                size={64}
              />
              <div className="text-xs font-mono">
                <div className="text-ink-50 font-display tracking-widest">{user.username}</div>
                <div className="text-ink-300">Lvl {user.level} {user.class ? `· ${user.class}` : ''}</div>
                <div className="text-ink-400 text-[10px]">{meta.label} · {meta.tagline}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {height != null && (
                <Stat label="Height" value={`${Math.round(height)} cm`} />
              )}
              {weight != null && (
                <Stat label="Weight" value={`${weight.toFixed(1)} kg`} />
              )}
              {bf != null && (
                <Stat label="Body Fat" value={`${bf.toFixed(1)}%`} color={intensityToColor(bf / 2)} />
              )}
              {lbm != null && (
                <Stat label="Lean Mass" value={`${lbm.toFixed(1)} kg`} color="#9bff5c" />
              )}
              {ffmi != null && (
                <Stat label="FFMI" value={ffmi.toFixed(1)} color={ffmi > 22 ? '#9bff5c' : '#14d6e8'} />
              )}
            </div>
          </Panel>

          <Panel title="Pain Map" variant="violet">
            {isLoading ? (
              <div className="text-[10px] font-mono text-ink-300">loading…</div>
            ) : markers.length === 0 ? (
              <div className="text-[10px] font-mono text-ink-300 italic">
                No pain logged. Click a body part on the hologram to log.
              </div>
            ) : (
              <div className="space-y-1.5">
                {markers
                  .sort((a, b) => b.intensity - a.intensity)
                  .slice(0, 8)
                  .map((m) => {
                    const meta = BODY_PARTS.find((p) => p.id === m.bodyPart);
                    if (!meta) return null;
                    return (
                      <button
                        key={m.bodyPart}
                        onClick={() => setSelected(meta)}
                        className="w-full flex items-center gap-2 px-2 py-1 border border-ink-700/50 hover:border-ink-300 text-left"
                      >
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            background: intensityToColor(m.intensity),
                            boxShadow: `0 0 6px ${intensityToColor(m.intensity)}`,
                          }}
                        />
                        <div className="flex-1 text-[10px] font-mono">
                          <span className="text-ink-50">{meta.label}</span>
                          <span className="text-ink-400 ml-2">
                            {intensityLabel(m.intensity)} ({m.intensity}/10)
                          </span>
                        </div>
                        <span className="text-[10px] text-ink-500 font-mono">×{m.count}</span>
                      </button>
                    );
                  })}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {selected && (
        <PainLogModal
          part={selected}
          onClose={() => setSelected(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['pain-logs'] })}
        />
      )}

      {/* Recent log list (collapsible at bottom) */}
      {data && data.logs.length > 0 && (
        <Panel title="Recent logs" variant="cyan" className="mt-6">
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {data.logs.slice(0, 20).map((log) => {
              const part = BODY_PARTS.find((p) => p.id === log.bodyPart);
              return (
                <div
                  key={log.id}
                  className="flex items-center gap-3 px-2 py-1.5 border border-ink-700/30 text-[11px] font-mono"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                      background: intensityToColor(log.intensity),
                      boxShadow: `0 0 4px ${intensityToColor(log.intensity)}`,
                    }}
                  />
                  <div className="flex-1">
                    <span className="text-ink-50">{part?.label ?? log.bodyPart}</span>
                    <span className="text-ink-400 ml-2">
                      {log.intensity}/10 · {new Date(log.loggedAt).toLocaleDateString()}
                    </span>
                    {log.notes && (
                      <div className="text-ink-300 italic text-[10px] mt-0.5">"{log.notes}"</div>
                    )}
                  </div>
                  <button
                    onClick={() => archive.run(log.id)}
                    disabled={archive.isPending}
                    className="text-ink-400 hover:text-neon-magenta text-[10px] font-mono"
                    title="Delete this log"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </Layout>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-ink-700/50 p-2">
      <div className="text-[10px] uppercase tracking-widest text-ink-400 font-mono">{label}</div>
      <div className="text-base font-display" style={{ color: color ?? '#fafafd' }}>{value}</div>
    </div>
  );
}

function PainLogModal({
  part,
  onClose,
  onSaved,
}: {
  part: BodyPartMeta;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [intensity, setIntensity] = useState(5);
  const [notes, setNotes] = useState('');

  const create = useDelayedMutation<
    { id: string },
    void
  >({
    mutationFn: () =>
      api('/pain-logs', {
        method: 'POST',
        body: {
          bodyPart: part.id,
          intensity,
          notes: notes.trim() || undefined,
        },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  }, 400);

  return (
    <Modal open onClose={onClose} title={`Log pain · ${part.label}`}>
      <div className="space-y-4">
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
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="flex-1"
            />
            <div
              className="w-12 h-12 grid place-items-center font-display text-lg"
              style={{
                color: intensityToColor(intensity),
                textShadow: `0 0 6px ${intensityToColor(intensity)}`,
                border: `2px solid ${intensityToColor(intensity)}`,
              }}
            >
              {intensity}
            </div>
          </div>
          <div
            className="text-[10px] font-mono mt-1 tracking-widest uppercase"
            style={{ color: intensityToColor(intensity) }}
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
            onChange={(e) => setNotes(e.target.value)}
            placeholder="sharp on outside, dull after warmup, etc."
            rows={3}
            maxLength={500}
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono focus:outline-none focus:border-neon-cyan"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <NeonButton onClick={onClose} variant="cyan">
            Cancel
          </NeonButton>
          <NeonButton
            variant="violet"
            onClick={() => create.run()}
            loading={create.isPending}
            icon="⚡"
            loadingText="Logging…"
          >
            Save
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}

function primaryColorForClass(c: string): 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' {
  switch (c) {
    case 'JUGGERNAUT':
    case 'BERSERKER': return 'magenta';
    case 'PHANTOM':
    case 'SCOUT':     return 'lime';
    case 'ORACLE':    return 'periwinkle';
    default:          return 'goldenrod';
  }
}
