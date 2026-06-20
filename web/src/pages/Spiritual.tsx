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

// Persist the dismissal across remounts (tab switches) and reloads.
// The server-side showOrdainPicker stays true until the user logs a
// prayer, so without this the banner reappears every time you navigate
// back to the tab. Once dismissed, the Ordain button is still in the
// Subclass panel for anyone who actually needs it.
const FIRST_VISIT_DISMISSED_KEY = 'fitquest:spiritual:firstVisitDismissed';

function isFirstVisitDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FIRST_VISIT_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function dismissFirstVisit() {
  try {
    localStorage.setItem(FIRST_VISIT_DISMISSED_KEY, 'true');
  } catch {
    /* localStorage unavailable — banner will reappear next mount */
  }
}

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
  CATECHUMEN: { color: '#daa520', label: 'Catechumen', description: 'Studying the faith. Preparing for full communion.' },
  CRUSADER:  { color: '#f55cc4', label: 'Crusader',  description: 'Vowed defender. Combines prayer with discipline.' },
  TEMPLAR:   { color: '#56e88e', label: 'Templar',   description: 'Elite order. Constant prayer, training, and service.' },
};

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

  useEffect(() => {
    // Only show the welcome card if (a) the server says we're a fresh
    // visitor, AND (b) the user hasn't dismissed it in this browser
    // before. Dismissal persists via localStorage so navigating away
    // and back, or reloading the page, doesn't bring it back.
    if (data?.showOrdainPicker && !isFirstVisitDismissed()) {
      setShowFirstVisit(true);
    } else if (!data?.showOrdainPicker) {
      // Once the user has logged a prayer (server flips to false),
      // ensure we don't have a stale banner visible.
      setShowFirstVisit(false);
    }
  }, [data?.showOrdainPicker]);

  const logM = useDelayedMutation<
    { log: PrayerLog; newXp: number; subclass: string; promoted: boolean },
    { type: PrayerType; durationMin: number; notes?: string }
  >({
    mutationFn: (body) =>
      api('/spiritual/log', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      setLogging(null);
      setNotes('');
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
          onPick={(ordained) => ordainM.run(ordained)}
          onSkip={() => {
            dismissFirstVisit();
            setShowFirstVisit(false);
          }}
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
                  className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-ink-100 hover:underline"
                  title="For those who have actually received the sacrament of Holy Orders"
                >
                  ☩ Ordain
                </button>
              ) : data?.ordained ? (
                <span className="text-[10px] font-mono text-ink-300">☩ ORDAINED</span>
              ) : null
            }
          >
            {isLoading || !data || !currentClass ? (
              <div className="text-[10px] font-mono text-ink-300">loading…</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-1 flex-wrap">
                  {(['CATECHUMEN', 'CRUSADER', 'TEMPLAR'] as const).map((stage, idx) => {
                    const stageIdx = (['CATECHUMEN', 'CRUSADER', 'TEMPLAR'] as const).indexOf(data.subclass);
                    const isCurrent = stage === data.subclass;
                    const isPast = stageIdx > idx;
                    const meta = SUBCLASS_INFO[stage];
                    return (
                      <span key={stage} className="flex items-center gap-1">
                        <span
                          className={
                            'px-2 py-1 text-[10px] font-mono tracking-widest uppercase border ' +
                            (isCurrent
                              ? 'border-current text-current'
                              : isPast
                              ? 'border-ink-500/40 text-ink-300 line-through'
                              : 'border-ink-700/40 text-ink-500')
                          }
                          style={isCurrent ? { color: meta.color, textShadow: `0 0 6px ${meta.color}` } : undefined}
                        >
                          {meta.label}
                        </span>
                        {idx < 2 && <span className="text-ink-500 text-[10px]">→</span>}
                      </span>
                    );
                  })}
                </div>

                <div className="border-l-2 pl-3 italic text-xs font-mono text-ink-300" style={{ borderColor: currentClass.color }}>
                  "{currentClass.description}"
                </div>

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
                    <div className="text-[10px] font-mono text-ink-400 mt-2 italic">
                      ☩ Ordained status: +5% XP on all prayers
                      {data.ordainedAt && (
                        <span className="text-ink-500 ml-1">
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
                      +{Math.round(info.defaultMinutes * 2.5)} XP · {info.defaultMinutes}m
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

      {/* Ordain modal — explicit, accurate copy. Only relevant for
          people who've actually received the sacrament IRL. */}
      {showOrdainModal && (
        <Modal open onClose={() => setShowOrdainModal(false)} title="☩ Holy Orders">
          <div className="space-y-3 text-sm font-mono text-ink-200">
            <p>
              Holy Orders is a sacrament conferred by a bishop in real life — it's not
              a perk you opt into here. If you've actually been ordained (priest,
              deacon, religious brother/sister in solemn vows, etc.), flipping this on
              grants a permanent <span className="text-ink-100">+5% XP</span> bonus on
              all prayer logs.
            </p>
            <p className="text-ink-300 text-xs">
              If that doesn't describe you, just close this and don't worry about it.
              The app won't ask again once you've logged any prayer.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <NeonButton onClick={() => setShowOrdainModal(false)} variant="cyan">
                Close
              </NeonButton>
              <NeonButton
                variant="amber"
                onClick={() => ordainM.run(true)}
                loading={ordainM.isPending}
                icon="☩"
              >
                Yes — I've received Holy Orders
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
    <div className="mb-4 border border-ink-500/30 p-4">
      <div className="font-display tracking-widest text-ink-100 text-base mb-2">
        ☩ Welcome to the Spiritual Path
      </div>
      <div className="text-xs font-mono text-ink-300 leading-relaxed mb-3">
        You'll progress through three stages as you build your devotional practice:
        <br />
        <span className="text-amber-600">Catechumen</span> →
        <span className="text-pink-400"> Crusader</span> →
        <span className="text-green-400"> Templar</span>.
        <br />
        <br />
        One quick note: there's a button to mark yourself as <span className="text-ink-100">Ordained</span>,
        which grants +5% XP on prayers. That flag is for people who've actually
        received the sacrament of Holy Orders in real life — it's not a cosmetic
        achievement. If that describes you, the Ordain button will be in the
        Subclass panel above; otherwise, just log prayers and ignore it.
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSkip}
          className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-ink-500/40 text-ink-300 hover:border-ink-300"
        >
          Got it
        </button>
      </div>
    </div>
  );
}