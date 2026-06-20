import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  BODY_PARTS_UI,
  BODY_PARTS,
  intensityToColor,
  intensityLabel,
  recoveryToColor,
  recoveryLabel,
  type BodyPartMeta,
  type BodyPartId,
  type PainMarker,
  type MuscleWorkedMarker,
  type RecoveryMarker,
} from '@/components/BodyModel';
import { getFrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { WORLD_COLOR_HEX } from '@/lib/quest';
import { convertForDisplay, displayUnit } from '@/lib/units';

type PainEntry = {
  id: string;
  bodyPart: BodyPartId;
  intensity: number;
  notes: string | null;
  loggedAt: string;
};

type StatusResponse = {
  recovery: RecoveryMarker[];
  worked: MuscleWorkedMarker[];
  pain: PainEntry[];
  painSummary: Record<string, { latest: number; avg: number; count: number; latestAt: string }>;
};

export function StatusPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<BodyPartMeta | null>(null);
  const [hovered, setHovered] = useState<BodyPartMeta | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['status'],
    queryFn: () => api<StatusResponse>('/status'),
  });

  const archive = useDelayedMutation<
    { ok: boolean },
    string
  >({
    mutationFn: (id: string) =>
      api(`/pain-logs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  }, 400);

  if (!user) return null;

  const archetype = getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE';
  const meta = ARCHETYPE_META[archetype];

  const painMarkers: PainMarker[] = data
    ? Object.entries(data.painSummary).map(([partId, s]) => ({
        bodyPart: partId as BodyPartId,
        intensity: Math.round(s.latest),
        count: s.count,
        latestAt: s.latestAt,
      }))
    : [];

  const bf = user.bodyFatPct ?? null;
  const weight = user.weightKg ?? null;
  const height = user.heightCm ?? null;
  // Creatine adds ~1-2 kg of intracellular water (mostly muscle cells).
  // Subtract that from displayed LBM so the number reflects contractile
  // tissue, not water. We approximate as 1.5 kg (mid-range).
  const creatineWaterKg = user.creatine ? 1.5 : 0;
  const lbmRaw = bf != null && weight != null ? weight * (1 - bf / 100) : null;
  const lbm = lbmRaw != null ? Math.max(0, lbmRaw - creatineWaterKg) : null;
  // Standard FFMI = lean mass (kg) / height (m)^2. No Kouri correction
  // — the previous version added ~6 points to every reading because of
  // a wrong formulation (`+ 6.1 * (1.8 / height)` is essentially +6
  // for any normal height, not the Kouri height-normalized value).
  const ffmi = lbm != null && height != null ? lbm / Math.pow(height / 100, 2) : null;

  // Aggregate stats
  const avgRecovery = data && data.recovery.length > 0
    ? Math.round(data.recovery.reduce((s, r) => s + r.score, 0) / data.recovery.length)
    : null;
  const recovered = data?.recovery.filter((r) => r.score >= 80).length ?? 0;
  const fatigued = data?.recovery.filter((r) => r.score < 50).length ?? 0;

  return (
    <Layout>
      <PageHeader
        title="Status"
        subtitle="Holographic readout of your body. Click to log pain. Color = recovery status."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
        <Panel
          title="Hologram"
          variant="cyan"
          action={
            <span className="text-[10px] font-mono text-ink-300 tracking-widest">
              {data?.worked.length ?? 0} worked · {painMarkers.length} pain · {data?.recovery.length ?? 0} tracked
            </span>
          }
        >
          <BodyModel
            painMarkers={painMarkers}
            workedMarkers={data?.worked ?? []}
            recoveryMarkers={data?.recovery ?? []}
            onPartClick={(p) => setSelected(p)}
            onPartHover={(p) => setHovered(p)}
            height={560}
          />
          {hovered && (
            <div className="mt-2 px-3 py-2 border border-neon-cyan/40 bg-bg-900/80 text-xs font-mono">
              <HoverInfo
                part={hovered}
                recovery={data?.recovery.find((r) => r.bodyPart === hovered.id)}
                worked={data?.worked.find((w) => w.bodyPart === hovered.id)}
                pain={painMarkers.find((p) => p.bodyPart === hovered.id)}
              />
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-mono">
            <Legend color="#9bff5c" label="recovered" />
            <Legend color="#ffc34d" label="active" />
            <Legend color="#f55cc4" label="fatigued" />
            <Legend color="#ff3060" label="overworked" />
            <Legend color="#14d6e8" label="pain" />
          </div>
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
              {(() => {
                const sys = user.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
                const conv = (val: number, base: 'cm' | 'kg') =>
                  convertForDisplay(val, base, sys);
                // Height: imperial mode renders as feet + inches (5'11"),
                // not raw inches (which is awkward at 71+).
                const renderHeight = () => {
                  if (height == null) return null;
                  if (sys === 'IMPERIAL') {
                    const totalIn = height * 0.393701;
                    const ft = Math.floor(totalIn / 12);
                    const inch = Math.round(totalIn - ft * 12);
                    return `${ft}'${inch}"`;
                  }
                  return `${Math.round(height)} cm`;
                };
                const w = weight != null ? conv(weight, 'kg') : null;
                const lm = lbm != null ? conv(lbm, 'kg') : null;
                return (
                  <>
                    {height != null && <Stat label="Height" value={renderHeight() ?? ''} />}
                    {w != null && <Stat label="Weight" value={`${w.value.toFixed(1)} ${w.unit}`} />}
                    {bf != null && <Stat label="Body Fat" value={`${bf.toFixed(1)}%`} color={intensityToColor(bf / 2)} />}
                    {lm != null && <Stat label="Lean Mass" value={`${lm.value.toFixed(1)} ${lm.unit}`} color="#9bff5c" />}
                    {ffmi != null && <Stat label="FFMI" value={ffmi.toFixed(1)} color={ffmi > 22 ? '#9bff5c' : '#14d6e8'} />}
                  </>
                );
              })()}
            </div>
          </Panel>

          {avgRecovery != null && (
            <Panel title="Recovery" variant={fatigued > 3 ? 'magenta' : 'lime'}>
              <div className="space-y-2">
                <div className="text-center">
                  <div
                    className="text-3xl font-display"
                    style={{
                      color: recoveryToColor(avgRecovery),
                      textShadow: `0 0 8px ${recoveryToColor(avgRecovery)}`,
                    }}
                  >
                    {avgRecovery}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                    Avg Recovery
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-center">
                  <div>
                    <div className="text-lg text-neon-lime">{recovered}</div>
                    <div className="text-ink-400">ready</div>
                  </div>
                  <div>
                    <div className="text-lg text-neon-amber">
                      {data!.recovery.filter((r) => r.score >= 50 && r.score < 80).length}
                    </div>
                    <div className="text-ink-400">active</div>
                  </div>
                  <div>
                    <div className="text-lg text-neon-magenta">{fatigued}</div>
                    <div className="text-ink-400">fatigued</div>
                  </div>
                </div>
              </div>
            </Panel>
          )}

          {data && data.worked.length > 0 && (
            <Panel title="Recently Worked" variant="cyan">
              <div className="space-y-1 text-[10px] font-mono">
                {data.worked
                  .sort((a, b) => new Date(b.workedAt).getTime() - new Date(a.workedAt).getTime())
                  .slice(0, 6)
                  .map((w) => {
                    const meta = BODY_PARTS_UI.find((p) => p.id === w.bodyPart);
                    if (!meta) return null;
                    return (
                      <div key={w.bodyPart} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-neon-cyan shrink-0" />
                        <div className="flex-1 text-ink-50">{meta.label}</div>
                        <div className="text-ink-400">{timeAgo(w.workedAt)}</div>
                      </div>
                    );
                  })}
              </div>
            </Panel>
          )}

          <Panel title="Pain Map" variant="violet">
            {isLoading ? (
              <div className="text-[10px] font-mono text-ink-300">loading…</div>
            ) : painMarkers.length === 0 ? (
              <div className="text-[10px] font-mono text-ink-300 italic">
                No pain logged. Click a body part on the hologram to log.
              </div>
            ) : (
              <div className="space-y-1.5">
                {painMarkers
                  .sort((a, b) => b.intensity - a.intensity)
                  .slice(0, 6)
                  .map((m) => {
                    const m2 = BODY_PARTS_UI.find((p) => p.id === m.bodyPart);
                    if (!m2) return null;
                    return (
                      <button
                        key={m.bodyPart}
                        onClick={() => setSelected(m2)}
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
                          <span className="text-ink-50">{m2.label}</span>
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
          onSaved={() => qc.invalidateQueries({ queryKey: ['status'] })}
        />
      )}

      {data && data.pain.length > 0 && (
        <Panel title="Recent pain logs" variant="cyan" className="mt-6">
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {data.pain.slice(0, 20).map((log) => {
              const part = BODY_PARTS_UI.find((p) => p.id === log.bodyPart) ?? BODY_PARTS.find((p) => p.id === log.bodyPart);
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

function HoverInfo({
  part,
  recovery,
  worked,
  pain,
}: {
  part: BodyPartMeta;
  recovery?: RecoveryMarker;
  worked?: MuscleWorkedMarker;
  pain?: PainMarker;
}) {
  return (
    <div className="space-y-1">
      <div>
        <span className="text-ink-300">Part:</span>{' '}
        <span className="text-neon-cyan font-display tracking-widest">{part.label}</span>
      </div>
      {recovery && (
        <div>
          <span className="text-ink-300">Recovery:</span>{' '}
          <span style={{ color: recoveryToColor(recovery.score) }}>
            {recovery.score}/100 · {recoveryLabel(recovery.score)}
          </span>
          {recovery.lastWorkedAt && (
            <span className="text-ink-400 ml-2 text-[10px]">
              (last worked {timeAgo(recovery.lastWorkedAt)})
            </span>
          )}
        </div>
      )}
      {worked && (
        <div>
          <span className="text-ink-300">Worked:</span>{' '}
          <span className="text-neon-cyan">{timeAgo(worked.workedAt)} · intensity {worked.intensity}/10</span>
        </div>
      )}
      {pain && (
        <div>
          <span className="text-ink-300">Pain:</span>{' '}
          <span style={{ color: intensityToColor(pain.intensity) }}>
            {pain.intensity}/10 · {intensityLabel(pain.intensity)} ({pain.count} logs)
          </span>
        </div>
      )}
      {!recovery && !worked && !pain && (
        <div className="text-ink-400 text-[10px]">No data. Click to log pain.</div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
      />
      <span className="text-ink-300">{label}</span>
    </span>
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
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}