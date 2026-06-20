import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { formatRelative } from '@/lib/format';
import { classNames } from '@/lib/format';

type PrayerType =
  | 'ROSARY' | 'MASS' | 'SCRIPTURE' | 'CONTEMPLATION'
  | 'LITURGY_HOURS' | 'CONFESSION' | 'OTHER';

type PrayerLog = {
  id: string;
  type: PrayerType;
  durationMin: number;
  notes: string | null;
  xpAwarded: number;
  loggedAt: string;
};

type SpiritualResponse = {
  xp: number;
  subclass: 'CATECHUMEN' | 'CRUSADER' | 'TEMPLAR';
  ordained: boolean;
  ordainedAt: string | null;
  ordinalBonus: number;
  showOrdainPicker: boolean;
  nextThreshold: number | null;
  logsThisWeek: number;
  logs: PrayerLog[];
  prayerTypes: Record<PrayerType, {
    label: string;
    icon: string;
    description: string;
    defaultMinutes: number;
  }>;
};

const SUBCLASS_INFO = {
  CATECHUMEN: { color: '#daa520', label: 'Catechumen',   description: 'Studying the faith. Preparing for full communion.' },
  CRUSADER:  { color: '#f55cc4', label: 'Crusader',    description: 'Vowed defender. Combines prayer with discipline.' },
  TEMPLAR:   { color: '#56e88e', label: 'Templar',     description: 'Elite order. Constant prayer, training, and service.' },
};

const XP_FOR_PROMOTION = [
  { stage: 'CATECHUMEN' as const, max: 500 },
  { stage: 'CRUSADER'  as const, max: 2500 },
  { stage: 'TEMPLAR'   as const, max: Infinity },
];

export function SpiritualPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [logging, setLogging] = useState<PrayerType | null>(null);
  const [duration, setDuration] = useState(20);
  const [notes, setNotes] = useState('');
  const [showOrdainModal, setShowOrdainModal] = useState(false);
  const [showFirstVisit, setShowFirstVisit] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['spiritual'],
    queryFn: () => api<SpiritualResponse>('/spiritual'),
  });

  // Show the first-visit picker on initial load if the API says so.
  useEffect(() => {
    if (data?.showOrdainPicker) setShowFirstVisit(true);
  }, [data?.showOrdainPicker]);

  const logM = useDelayedMutation<
    { log: PrayerLog; newXp: number; subclass: string; promoted: boolean },
    { type: PrayerType; durationMin: number; notes?: string }
  >({
    mutationFn: (body) =>
      api('/spiritual/log', { method: 'POST', body }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      setLogging(null);
      setNotes('');
      if (r.promoted) {
        // Toast or alert — keep simple, the UI already shows the new class
        // on the panel.
      }
    },
  }, 600);

  const ordainM = useDelayedMutation<
    { ok: boolean; ordained: boolean },
    boolean
  >({
    mutationFn: (ordained) =>
      api('/spiritual/ordain', { method: 'PATCH', body: { ordained } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      setShowOrdainModal(false);
      setShowFirstVisit(false);
    },
  }, 500);

  if (!user) return null;

  const currentClass = data ? SUBCLASS_INFO[data.subclass] : null;
  void XP_FOR_PROMOTION;
  const isFinalStage = data ? data.subclass === 'TEMPLAR' : false;
  const nextThresholdXp = data?.nextThreshold ?? null;

  return (
    <Layout>
      <PageHeader
        title="// Spiritual"
        subtitle="Track your devotional practice. A parallel progression to your fitness class."
      />

      {showFirstVisit && data && (
        <FirstVisitPicker
          onPick={(ordained) => {
            ordainM.run(ordained);
            setShowFirstVisit(false);
          }}
          onSkip={() => setShowFirstVisit(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
        <div className="space-y-4">
          {/* Subclass + XP */}
          <Panel
            title="Subclass"
            variant="cyan"
            action={
              data && !data.ordained ? (
                <button
                  onClick={() => setShowOrdainModal(true)}
                  className="text-[10px] font-mono uppercase tracking-widest neon-text-amber hover:underline"
                  title="Receive the sacrament of Holy Orders (+5% XP on all prayers)"
                >
                  ☩ Ordain
                </button>
              ) : data?.ordained ? (
                <span className="text-[10px] font-mono neon-text-amber">☩ ORDAINED</span>
              ) : null
            }
          >
            {isLoading || !data || !currentClass ? (
              <div className="text-[10px] font-mono text-ink-300">loading…</div>
            ) : (
              <div className="space-y-4">
                {/* 3-stage progression */}
                <div className="flex items-center gap-1 flex-wrap">
                  {(['CATECHUMEN', 'CRUSADER', 'TEMPLAR'] as const).map((stage, idx) => {
                    const stageNum = idx + 1;
                    const isCurrent = stage === data.subclass;
                    const isPast = XP_FOR_PROMOTION.findIndex((t) => t.stage === data.subclass) > idx;
                    const isFuture = !isCurrent && !isPast;
                    const meta = SUBCLASS_INFO[stage];
                    return (
                      <span key={stage} className="flex items-center gap-1">
                        <span
                          className={classNames(
                            'px-2 py-1 text-[10px] font-mono tracking-widest uppercase border',
                            isCurrent
                              ? 'border-current text-current'
                              : isPast
                              ? 'border-ink-500/40 text-ink-300 line-through'
                              : 'border-ink-700/40 text-ink-500',
                          )}
                          style={isCurrent ? { color: meta.color, textShadow: `0 0 6px ${meta.color}` } : undefined}
                        >
                          {meta.label}
                        </span>
                        {idx < 2 && <span className="text-ink-500 text-[10px]">→</span>}
                      </span>
                    );
                  })}
                </div>

                {/* Description of current class */}
                <div className="border-l-2 pl-3 italic text-xs font-mono text-ink-300" style={{ borderColor: currentClass.color }}>
                  "{currentClass.description}"
                </div>

                {/* XP bar */}
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                      {data.xp.toLocaleString()} XP
                    </span>
                    {!isFinalStage && nextThresholdXp != null && (
                      <span className="text-[10px] font-mono text-ink-400">
                        Next: <span className="text-ink-50">{nextThresholdXp.toLocaleString()}</span>
                      </span>
                    )}
                    {isFinalStage && (
                      <span className="text-[10px] font-mono neon-text-amber">⚜ MAXED</span>
                    )}
                  </div>
                  <div className="h-2 bg-bg-700 border border-ink-500/30">
                    {!isFinalStage && nextThresholdXp != null ? (
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.min(100, (data.xp / nextThresholdXp) * 100)}%`,
                          background: currentClass.color,
                          boxShadow: `0 0 6px ${currentClass.color}`,
                        }}
                      />
                    ) : (
                      <div
                        className="h-full"
                        style={{
                          width: '100%',
                          background: currentClass.color,
                          boxShadow: `0 0 6px ${currentClass.color}`,
                        }}
                      />
                    )}
                  </div>
                  {data.ordained && (
                    <div className="text-[10px] font-mono text-neon-amber mt-1">
                      ☩ Ordained: +5% XP on all prayers
                      {data.ordainedAt && (
                        <span className="text-ink-400 ml-2">
                          (since {new Date(data.ordainedAt).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>

          {/* Prayer type picker */}
          <Panel title="Log a Prayer" variant="violet">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data &&
                Object.entries(data.prayerTypes).map(([type, info]) => (
                  <button
                    key={type}
                    onClick={() => {
                      setLogging(type as PrayerType);
                      setDuration(info.defaultMinutes);
                    }}
                    className="p-3 border border-ink-500/30 hover:border-neon-violet hover:bg-neon-violet/5 text-left transition-all"
                  >
                    <div className="text-2xl mb-1">{info.icon}</div>
                    <div className="text-xs font-display tracking-wider text-ink-100">{info.label}</div>
                    <div className="text-[10px] font-mono text-ink-400 mt-0.5">
                      +{info.defaultMinutes ? Math.round(info.defaultMinutes * 2.5) : 50} XP · {info.defaultMinutes}m
                    </div>
                  </button>
                ))}
            </div>
          </Panel>
        </div>

        {/* Recent logs */}
        <Panel
          title="Recent"
          variant="cyan"
          action={
            <span className="text-[10px] font-mono text-ink-300">
              {data?.logsThisWeek ?? 0} this wk
            </span>
          }
        >
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {data?.logs.map((log) => {
              const meta = data.prayerTypes[log.type];
              return (
                <div
                  key={log.id}
                  className="border border-ink-700/30 p-2 text-[11px] font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.icon}</span>
                    <span className="text-ink-50">{meta.label}</span>
                    <span className="text-ink-400 ml-auto">+{log.xpAwarded}</span>
                  </div>
                  <div className="text-[10px] text-ink-400 mt-0.5">
                    {log.durationMin}m · {formatRelative(log.loggedAt)}
                  </div>
                  {log.notes && (
                    <div className="text-[10px] text-ink-300 italic mt-0.5">"{log.notes}"</div>
                  )}
                </div>
              );
            })}
            {(data?.logs ?? []).length === 0 && (
              <div className="text-xs text-ink-300 font-mono text-center py-4 italic">
                No prayers logged yet.
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Log prayer modal */}
      {logging && data && (
        <Modal open onClose={() => setLogging(null)} title={`Log ${data.prayerTypes[logging].label}`}>
          <div className="space-y-4">
            <p className="text-xs font-mono text-ink-300 italic">
              {data.prayerTypes[logging].description}
            </p>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
                Duration (min)
              </label>
              <input
                type="number"
                min={1}
                max={360}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="input-neon"
              />
              <div className="text-[10px] font-mono text-ink-400 mt-1">
                Default: {data.prayerTypes[logging].defaultMinutes} min
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <NeonButton onClick={() => setLogging(null)} variant="cyan">Cancel</NeonButton>
              <NeonButton
                onClick={() => logM.run({ type: logging, durationMin: duration, notes: notes.trim() || undefined })}
                loading={logM.isPending}
                loadingText="Logging…"
                icon="✦"
              >
                Save
              </NeonButton>
            </div>
          </div>
        </Modal>
      )}

      {/* Ordain modal (manual, after first visit) */}
      {showOrdainModal && (
        <Modal open onClose={() => setShowOrdainModal(false)} title="Receive Holy Orders">
          <div className="space-y-3 text-sm font-mono text-ink-200">
            <p>
              Ordained users receive a permanent <span className="neon-text-amber">+5% XP</span> boost
              on all prayers.
            </p>
            <p>
              Once you become Ordained, you cannot un-become Ordained. Choose carefully.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <NeonButton onClick={() => setShowOrdainModal(false)} variant="cyan">
                Cancel
              </NeonButton>
              <NeonButton
                variant="amber"
                onClick={() => ordainM.run(true)}
                loading={ordainM.isPending}
              >
                ☩ Ordain me
              </NeonButton>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function FirstVisitPicker({
  onPick,
  onSkip,
}: {
  onPick: (ordained: boolean) => void;
  onSkip: () => void;
}) {
  return (
    <div className="mb-4 border border-neon-amber/60 bg-neon-amber/5 p-4">
      <div className="font-display tracking-widest neon-text-amber text-base mb-2">
        ☩ Welcome to the Spiritual Path
      </div>
      <div className="text-xs font-mono text-ink-200 leading-relaxed mb-3">
        You'll progress through three stages as you build your devotional practice:
        <br />
        <span className="neon-text-goldenrod">Catechumen</span> →
        <span className="neon-text-magenta"> Crusader</span> →
        <span className="neon-text-lime"> Templar</span>.
        <br />
        <br />
        <span className="neon-text-amber">One question before you begin:</span> Would you like to
        receive Holy Orders? This is a one-time choice that grants a permanent
        <span className="neon-text-amber"> +5% XP boost</span> on all prayers.
      </div>
      <div className="flex flex-wrap gap-2">
        <NeonButton variant="amber" onClick={() => onPick(true)}>
          ☩ Yes, ordain me
        </NeonButton>
        <button
          onClick={onSkip}
          className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-ink-500/40 text-ink-300 hover:border-ink-300"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}