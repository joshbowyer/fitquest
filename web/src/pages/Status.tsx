import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, type UserAvatar } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { Avatar } from '@/components/Avatar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DeleteButton } from '@/components/DeleteButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import {
  BodyModel,
  BODY_PARTS_UI,
  BODY_PARTS,
  intensityToColor,
  intensityLabel,
  recoveryToColor,
  recoveryLabel,
  bodyPartColor,
  PALETTE_HEX,
  bandForRecoveryScore,
  bandForSetCount,
  partSummary,
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

  // Load the user's avatar customization so the small sprite in
  // the Identity panel matches the rest of the app (skin tone,
  // hair, shirt, pants).
  const { data: avatarData } = useQuery({
    queryKey: ['avatar'],
    queryFn: () => api<{ avatar: UserAvatar }>('/avatar'),
  });
  const avatar = avatarData?.avatar ?? null;

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
  // Creatine: water-weight subtraction kicks in only when the user has
  // logged Creatine on ≥3 of the last 7 days. The auto-derived flag
  // (`creatineActive`) is recomputed server-side per /me call, so we
  // trust it rather than reimplementing the rule here.
  const creatineActive = user.creatineActive ?? false;
  const lbmRaw = bf != null && weight != null ? weight * (1 - bf / 100) : null;
  const lbm = lbmRaw != null && bf != null && weight != null
    ? Math.max(0, weight * (1 - bf / 100) - (creatineActive ? 1.5 : 0))
    : null;
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
      <ErrorBoundary>
        <StatusBody
          user={user}
          data={data}
          painMarkers={painMarkers}
          selected={selected}
          setSelected={setSelected}
          hovered={hovered}
          setHovered={setHovered}
          archive={archive}
          archetype={archetype}
          avatar={avatar}
          meta={meta}
          bf={bf}
          weight={weight}
          height={height}
          lbm={lbm}
          ffmi={ffmi}
          avgRecovery={avgRecovery}
          recovered={recovered}
          fatigued={fatigued}
          recoveryToColor={recoveryToColor}
          intensityToColor={intensityToColor}
          intensityLabel={intensityLabel}
          recoveryLabel={recoveryLabel}
          isLoading={isLoading}
          qc={qc}
        />
      </ErrorBoundary>
    </Layout>
  );
}

/**
 * StatusBody renders the inner status content wrapped by an
 * ErrorBoundary in StatusPage. Splitting it out keeps a single
 * component-tree failure (e.g. R3F failing to init) from blanking
 * the whole page — the outer Layout + PageHeader stay visible and
 * the ErrorBoundary renders a fallback panel with the error.
 */
function StatusBody({
  user,
  data,
  painMarkers,
  selected,
  setSelected,
  hovered,
  setHovered,
  archive,
  archetype,
  avatar,
  meta,
  bf,
  weight,
  height,
  lbm,
  ffmi,
  avgRecovery,
  recovered,
  fatigued,
  recoveryToColor,
  intensityToColor,
  intensityLabel,
  recoveryLabel,
  isLoading,
  qc,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  data: StatusResponse | undefined;
  painMarkers: PainMarker[];
  selected: BodyPartMeta | null;
  setSelected: (v: BodyPartMeta | null) => void;
  hovered: BodyPartMeta | null;
  setHovered: (v: BodyPartMeta | null) => void;
  archive: ReturnType<typeof useDelayedMutation<{ ok: boolean }, string>>;
  archetype: ReturnType<typeof getFrameArchetype> | null;
  avatar: UserAvatar | null;
  meta: typeof ARCHETYPE_META[keyof typeof ARCHETYPE_META];
  bf: number | null;
  weight: number | null;
  height: number | null;
  lbm: number | null;
  ffmi: number | null;
  avgRecovery: number | null;
  recovered: number;
  fatigued: number;
  recoveryToColor: (s: number) => string;
  intensityToColor: (i: number) => string;
  intensityLabel: (i: number) => string;
  recoveryLabel: (s: number) => string;
  isLoading: boolean;
  qc: ReturnType<typeof useQueryClient>;
}) {
  return (
    <>

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
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono">
            <span className="text-ink-500">recovery:</span>
            <Legend color="#64748b" label="untrained" />
            <Legend color="#0891b2" label="primed" />
            <Legend color="#16a34a" label="recovering" />
            <Legend color="#b45309" label="fatigued" />
            <Legend color="#9f1239" label="spent" />
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] font-mono text-ink-500">
            <span>volume tint: light → heavy (opacity)</span>
            <span>·</span>
            <span>click a part to see contributing exercises</span>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Identity" variant="amber">
            <div className="flex items-center gap-3 mb-3">
              <Avatar
                archetype={archetype ?? 'SPRITE'}
                accentColor={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : '#14d6e8'}
                size={64}
                sprites
                hairStyle={avatar?.hairStyle ?? 'SHORT'}
                hairColor={avatar?.hairColor ?? 'brown'}
                skinTone={avatar?.skinTone ?? '#915533'}
                shirtColor={avatar?.shirtColor ?? '#14d6e8'}
                classStripe={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : null}
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
        <PartDetailsModal
          part={selected}
          recovery={data?.recovery.find((r) => r.bodyPart === selected.id)}
          worked={data?.worked.find((w) => w.bodyPart === selected.id)}
          painCount={painMarkers.filter((p) => p.bodyPart === selected.id).length}
          onClose={() => setSelected(null)}
          onPainLogged={() => qc.invalidateQueries({ queryKey: ['status'] })}
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
                  <DeleteButton
                    onClick={() => archive.run(log.id)}
                    disabled={archive.isPending}
                    size="sm"
                    showOnHover
                    title="Delete this log"
                  />
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
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
  const recoveryBand = recovery ? bandForRecoveryScore(recovery.score) : 'untrained';
  const volumeBand = bandForSetCount(worked?.setCount ?? 0);
  const summary = partSummary({ recovery: recovery ?? null, worked: worked ?? null });
  return (
    <div className="space-y-1">
      <div>
        <span className="text-ink-300">Part:</span>{' '}
        <span className="text-neon-cyan font-display tracking-widest">{part.label}</span>
      </div>
      <div>
        <span className="text-ink-300">State:</span>{' '}
        <span
          className="font-mono uppercase tracking-widest"
          style={{ color: PALETTE_HEX[recoveryBand][volumeBand === 'none' ? 'moderate' : volumeBand] }}
        >
          {summary}
        </span>
      </div>
      {recovery && (
        <div>
          <span className="text-ink-300">Recovery:</span>{' '}
          <span style={{ color: recoveryToColor(recovery.score) }}>
            {recovery.score}/100 · {recoveryBand}
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
          <span className="text-neon-cyan">
            {worked.setCount ?? 0} sets · {timeAgo(worked.workedAt)} · {volumeBand}
          </span>
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

// ============================================================
// PartDetailsModal — opened when the user clicks a body part.
// Shows recovery + volume summary, the contributing exercises
// from the last 36h (today + yesterday), and a Log Pain button
// that opens the existing PainLogModal inline.
// ============================================================
function PartDetailsModal({
  part,
  recovery,
  worked,
  painCount,
  onClose,
  onPainLogged,
}: {
  part: BodyPartMeta;
  recovery: RecoveryMarker | undefined;
  worked: MuscleWorkedMarker | undefined;
  painCount: number;
  onClose: () => void;
  onPainLogged: () => void;
}) {
  const qc = useQueryClient();
  const [loggingPain, setLoggingPain] = useState(false);

  // Fetch contributing exercises for this part. Window is
  // hard-capped server-side at 36h, but we let the server pick
  // the cutoff so the client doesn't have to compute "yesterday's
  // midnight" in tz-aware code.
  const exQ = useQuery({
    queryKey: ['part-exercises', part.id],
    queryFn: () => api<{
      bodyPart: string;
      since: string;
      windowHours: number;
      workouts: {
        id: string;
        name: string | null;
        type: string;
        performedAt: string;
        exercises: {
          id: string;
          name: string;
          setCount: number;
          totalVolumeKg: number;
          topSet: { reps: number; weight: number | null; duration: number | null } | null;
        }[];
      }[];
    }>(`/status/part/${part.id}/exercises`),
    enabled: !!part,
    staleTime: 30_000,
  });

  const totalSets = exQ.data?.workouts.reduce(
    (s, w) => s + w.exercises.reduce((ss, e) => ss + e.setCount, 0),
    0
  ) ?? 0;
  const totalVolume = exQ.data?.workouts.reduce(
    (s, w) => s + w.exercises.reduce((ss, e) => ss + e.totalVolumeKg, 0),
    0
  ) ?? 0;
  const sessionCount = exQ.data?.workouts.length ?? 0;

  // Summary line that combines recovery × volume into a single
  // phrase. Mirrors the wireframe color story.
  const recoveryBand = recovery
    ? bandForRecoveryScore(recovery.score)
    : 'untrained';
  const volumeBand = bandForSetCount(worked?.setCount ?? 0);
  const summaryText = partSummary({ recovery: recovery ?? null, worked: worked ?? null });

  return (
    <>
      <Modal open onClose={onClose} title={`${part.label} · ${part.group.toUpperCase()}`}>
        <div className="space-y-4 text-sm">
          {/* Status summary — the color story in text form */}
          <div className="border border-ink-700/40 rounded px-3 py-2 bg-bg-900/50">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                state
              </span>
              <span
                className="font-display tracking-widest text-xs uppercase"
                style={{ color: PALETTE_HEX[recoveryBand][volumeBand === 'none' ? 'moderate' : volumeBand] }}
              >
                {summaryText}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div>
                <div className="text-ink-500 uppercase tracking-widest text-[9px]">recovery</div>
                <div className="text-ink-100">{recovery?.score ?? '—'}<span className="text-ink-500">/100</span></div>
                <div className="text-ink-400 text-[10px]">{recoveryBand}</div>
              </div>
              <div>
                <div className="text-ink-500 uppercase tracking-widest text-[9px]">sets (36h)</div>
                <div className="text-ink-100">{totalSets || (worked?.setCount ?? 0)}</div>
                <div className="text-ink-400 text-[10px]">{volumeBand}</div>
              </div>
              <div>
                <div className="text-ink-500 uppercase tracking-widest text-[9px]">volume</div>
                <div className="text-ink-100">{totalVolume.toLocaleString()}<span className="text-ink-500"> kg</span></div>
                <div className="text-ink-400 text-[10px]">{sessionCount} session{sessionCount === 1 ? '' : 's'}</div>
              </div>
            </div>
            {recovery?.lastWorkedAt && (
              <div className="text-[10px] font-mono text-ink-400 mt-2">
                last worked · {timeAgo(recovery.lastWorkedAt)}
              </div>
            )}
            {painCount > 0 && (
              <div className="text-[10px] font-mono text-neon-amber/80 mt-1">
                {painCount} active pain log{painCount === 1 ? '' : 's'} on this part
              </div>
            )}
          </div>

          {/* Contributing exercises — last 36h only */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
              Contributing exercises · last {exQ.data?.windowHours ?? 36}h
            </div>
            {exQ.isLoading ? (
              <div className="text-xs text-ink-400 italic">loading…</div>
            ) : exQ.data && exQ.data.workouts.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {exQ.data.workouts.map((w) => (
                  <div key={w.id} className="border border-ink-700/30 rounded px-2 py-1.5 bg-bg-900/30">
                    <div className="flex items-baseline justify-between">
                      <div className="text-xs font-display tracking-wider text-ink-100 truncate">
                        {w.name ?? `${w.type} workout`}
                      </div>
                      <div className="text-[10px] font-mono text-ink-400 shrink-0 ml-2">
                        {timeAgo(w.performedAt)}
                      </div>
                    </div>
                    {w.exercises.map((e) => (
                      <div key={e.id} className="mt-1 flex items-baseline justify-between text-[11px] font-mono pl-2 border-l border-ink-700/40">
                        <div className="text-ink-200 truncate">{e.name}</div>
                        <div className="text-ink-400 shrink-0 ml-2">
                          {e.setCount} set{e.setCount === 1 ? '' : 's'}
                          {e.totalVolumeKg > 0 ? ` · ${e.totalVolumeKg.toLocaleString()}kg` : ''}
                          {e.topSet && e.topSet.weight != null
                            ? ` · top ${e.topSet.weight}×${e.topSet.reps}`
                            : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-ink-400 italic">
                No exercises for this part in the last {exQ.data?.windowHours ?? 36}h.
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-ink-700/40">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs font-mono text-ink-400 hover:text-ink-100"
            >
              Close
            </button>
            <NeonButton
              icon="⚠"
              variant="violet"
              onClick={() => setLoggingPain(true)}
            >
              Log pain here
            </NeonButton>
          </div>
        </div>
      </Modal>

      {loggingPain && (
        <PainLogModal
          part={part}
          onClose={() => setLoggingPain(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['status'] });
            qc.invalidateQueries({ queryKey: ['part-exercises', part.id] });
            onPainLogged();
            setLoggingPain(false);
          }}
        />
      )}
    </>
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