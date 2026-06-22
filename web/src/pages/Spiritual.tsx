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
import { DIFFICULTY_TIERS, type DifficultyTier } from '@/lib/difficultyTiers';
import { SpiritualDirectorCard } from '@/components/SpiritualDirectorCard';

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

type CustomPractice = {
  id: string;
  name: string;
  days: string[];
  notes: string | null;
  goldReward: number;
  xpReward: number;
  archived: boolean;
  isDaily: boolean;
  createdAt: string;
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
  customPractices: CustomPractice[];
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
  const [loggingCustom, setLoggingCustom] = useState<CustomPractice | null>(null);
  const [duration, setDuration] = useState(20);
  const [notes, setNotes] = useState('');
  const [showOrdainModal, setShowOrdainModal] = useState(false);
  const [showFirstVisit, setShowFirstVisit] = useState(false);
  const [creatingCustom, setCreatingCustom] = useState(false);

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
    { type?: PrayerType; dailyId?: string; durationMin: number; notes?: string }
  >({
    mutationFn: (body) =>
      api('/spiritual/log', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      qc.invalidateQueries({ queryKey: ['dailies'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['auth'] });
      setLogging(null);
      setLoggingCustom(null);
      setNotes('');
    },
  }, 800);

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

      {/* Spiritual director — today's USCCB Gospel + LLM-tailored
          reflection. Sits above the dailies so it's the first thing
          the user reads when they open the page. */}
      <div className="mb-4 md:mb-6">
        <SpiritualDirectorCard />
      </div>

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
          <Panel
            title="Log a Prayer"
            variant="violet"
            action={
              <button
                type="button"
                onClick={() => setCreatingCustom(true)}
                className="text-[10px] font-mono uppercase tracking-widest neon-text-cyan hover:underline"
              >
                + Custom practice
              </button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {/* Built-in prayer types */}
              {data &&
                Object.entries(data.prayerTypes).map(([type, info]) => {
                  const isDaily = (user?.spiritualDailyPrayers ?? []).includes(type as PrayerType);
                  return (
                    <button
                      key={`builtin-${type}`}
                      onClick={() => {
                        setLogging(type as PrayerType);
                        setDuration(info.defaultMinutes);
                      }}
                      className={`relative p-3 border text-left transition-all ${
                        isDaily
                          ? 'border-neon-violet bg-neon-violet/5'
                          : 'border-ink-500/30 hover:border-neon-violet hover:bg-neon-violet/5'
                      }`}
                    >
                      {isDaily && (
                        <span className="absolute top-1 right-1 text-[8px] font-mono uppercase neon-text-violet">
                          ☩ daily
                        </span>
                      )}
                      <div className="text-2xl mb-1">{info.icon}</div>
                      <div className="text-xs font-display tracking-wider text-ink-100">{info.label}</div>
                      <div className="text-[10px] font-mono text-ink-400 mt-0.5">
                        +{Math.round(info.defaultMinutes * 2.5)} XP · {info.defaultMinutes}m
                      </div>
                    </button>
                  );
                })}
              {/* User-defined custom practices */}
              {data?.customPractices.map((cp) => (
                <button
                  key={`custom-${cp.id}`}
                  onClick={() => {
                    setLoggingCustom(cp);
                    setDuration(15);
                  }}
                  className="relative p-3 border border-neon-cyan/40 bg-neon-cyan/5 text-left transition-all hover:border-neon-cyan hover:bg-neon-cyan/10"
                >
                  <span className="absolute top-1 right-1 text-[8px] font-mono uppercase neon-text-cyan">
                    ✦ custom
                  </span>
                  <div className="text-2xl mb-1">✦</div>
                  <div className="text-xs font-display tracking-wider text-ink-100 truncate">{cp.name}</div>
                  <div className="text-[10px] font-mono text-ink-400 mt-0.5">
                    +{cp.goldReward}g · {cp.xpReward} XP
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          {/* Daily prayer obligations — toggle which prayers become dailies */}
          <DailyPrayerConfig
            current={user?.spiritualDailyPrayers ?? []}
            prayerTypes={data ? (Object.keys(data.prayerTypes) as PrayerType[]) : []}
            prayerInfo={data?.prayerTypes}
            customPractices={data?.customPractices ?? []}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['user'] });
              qc.invalidateQueries({ queryKey: ['auth'] });
              qc.invalidateQueries({ queryKey: ['dailies'] });
              qc.invalidateQueries({ queryKey: ['spiritual'] });
            }}
          />
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

      {/* Log prayer modal (built-in) */}
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

      {/* Log custom practice modal */}
      {loggingCustom && (
        <Modal open onClose={() => setLoggingCustom(null)} title={`Log ${loggingCustom.name}`}>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink-300">
              <span className="px-1.5 py-0.5 border border-neon-cyan/40 text-neon-cyan">✦ custom</span>
              <span>Reward:</span>
              <span className="text-ink-100">+{loggingCustom.goldReward}g</span>
              <span>·</span>
              <span className="text-ink-100">+{loggingCustom.xpReward} XP</span>
            </div>
            {loggingCustom.notes && (
              <p className="text-xs font-mono text-ink-300 italic">
                "{loggingCustom.notes}"
              </p>
            )}
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
              <NeonButton onClick={() => setLoggingCustom(null)} variant="cyan">Cancel</NeonButton>
              <NeonButton
                onClick={() => logM.run({ dailyId: loggingCustom.id, durationMin: duration, notes: notes.trim() || undefined })}
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

      {/* Create custom spiritual practice — stores as a USER SPIRITUAL daily */}
      {creatingCustom && (
        <CustomPracticeModal
          onClose={() => setCreatingCustom(false)}
          onSaved={() => {
            setCreatingCustom(false);
            qc.invalidateQueries({ queryKey: ['dailies'] });
            qc.invalidateQueries({ queryKey: ['today'] });
          }}
        />
      )}
    </Layout>
  );
}

function DailyPrayerConfig({
  current,
  prayerTypes,
  prayerInfo,
  customPractices,
  onSaved,
}: {
  current: PrayerType[];
  prayerTypes: PrayerType[];
  prayerInfo: SpiritualResponse['prayerTypes'] | undefined;
  customPractices: CustomPractice[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PrayerType[]>(current);
  // Local optimistic copy of the custom-practice "is on /today"
  // toggle. Each click flips the draft and fires a PATCH. We keep
  // the server's view in `customPractices` for re-syncs (e.g. when
  // a different tab updates) — when `customPractices` changes, we
  // re-seed the draft to match.
  const [customDraft, setCustomDraft] = useState<Record<string, boolean>>(
    () => Object.fromEntries(customPractices.map((cp) => [cp.id, cp.isDaily])),
  );

  // Re-seed customDraft when the server's customPractices list
  // changes (e.g. after invalidation following a successful toggle,
  // or after creating a new practice from the + Custom practice
  // modal). Without this, toggling one practice could leave the
  // draft out of sync with the server, and newly-created practices
  // wouldn't show in the panel until a hard reload.
  useEffect(() => {
    setCustomDraft((cur) => {
      const next: Record<string, boolean> = {};
      for (const cp of customPractices) {
        // Preserve the user's pending toggle if the server value
        // hasn't been updated yet (we just optimistically flipped it).
        // When the server catches up to our optimistic value, it
        // matches `cur[cp.id]` and we keep it; if the server is
        // different (shouldn't happen for in-flight toggles, but
        // covers external changes), we adopt the server's value.
        next[cp.id] = cur[cp.id] !== undefined ? cur[cp.id] : cp.isDaily;
      }
      return next;
    });
  }, [customPractices]);

  const dirty =
    draft.length !== current.length ||
    draft.some((d) => !current.includes(d));

  const saveM = useDelayedMutation<{ ok: boolean }, PrayerType[]>({
    mutationFn: (prayers) =>
      api('/spiritual/dailies', { method: 'PATCH', body: { prayers } }),
    onSuccess: () => onSaved(),
  }, 400);

  // Toggle a custom practice's isDaily flag. PATCHes the row in
  // place — same shape as the built-in toggle (single click,
  // single round trip, no confirm modal). We update the local
  // draft immediately for snappy UX, then on success the parent
  // invalidates ['spiritual'] and re-seeds customDraft from the
  // fresh server payload.
  const toggleCustomM = useDelayedMutation<{ daily: CustomPractice }, { id: string; isDaily: boolean }>({
    mutationFn: ({ id, isDaily }) =>
      api(`/dailies/${id}`, { method: 'PATCH', body: { isDaily } }),
    onSuccess: () => onSaved(),
  }, 250);

  function toggle(t: PrayerType) {
    setDraft((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]));
  }

  function toggleCustom(cp: CustomPractice) {
    const next = !(customDraft[cp.id] ?? cp.isDaily);
    setCustomDraft((d) => ({ ...d, [cp.id]: next }));
    toggleCustomM.run({ id: cp.id, isDaily: next });
  }

  return (
    <Panel title="Daily prayers" variant="violet">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        Toggle which prayers become built-in dailies on <span className="neon-text-cyan">/today</span>.
        Daily prayers still earn full XP when you log them; they just also appear in your daily checklist.
        Confession is monthly-ish in practice — leave it off unless you go weekly.
      </div>
      <div className="flex flex-wrap gap-1.5">
        {prayerTypes.map((t) => {
          const info = prayerInfo?.[t];
          const on = draft.includes(t);
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              className={
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border transition-all ' +
                (on
                  ? 'border-neon-violet text-neon-violet bg-neon-violet/10'
                  : 'border-ink-500/30 text-ink-300 hover:border-ink-300')
              }
            >
              <span>{info?.icon ?? '○'}</span>
              <span>{info?.label ?? t}</span>
              <span className={on ? 'text-neon-violet' : 'text-ink-500'}>{on ? '✓ daily' : '+ add'}</span>
            </button>
          );
        })}
      </div>

      {/* User-defined custom practices — same click-to-toggle UX as
          the built-in chips above. Click to add/remove from /today.
          A practice is still loggable from the "Log a Prayer" grid
          regardless of its daily status; the toggle only controls
          whether it auto-appears on the daily checklist. */}
      {customPractices.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-500/20">
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
            Your custom practices
            <span className="text-ink-500 normal-case tracking-normal ml-2">
              · click to toggle on /today
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {customPractices.map((cp) => {
              const on = customDraft[cp.id] ?? cp.isDaily;
              return (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => toggleCustom(cp)}
                  className={
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono border transition-all ' +
                    (on
                      ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                      : 'border-ink-500/30 text-ink-300 hover:border-ink-300')
                  }
                  title={on ? 'On /today — click to remove' : 'Click to add to /today'}
                >
                  <span>✦</span>
                  <span className="max-w-[16rem] truncate">{cp.name}</span>
                  <span className="text-ink-500">+{cp.xpReward}xp</span>
                  <span className={on ? 'text-neon-cyan' : 'text-ink-500'}>{on ? '✓ daily' : '+ add'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dirty && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <NeonButton
            onClick={() => saveM.run(draft)}
            loading={saveM.isPending}
            variant="violet"
            icon="☩"
            loadingText="Saving…"
          >
            Save daily prayers
          </NeonButton>
        </div>
      )}
    </Panel>
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
/**
 * Custom spiritual practice creation. Stores as a USER SPIRITUAL daily
 * so it shows up on /today alongside the built-in prayers.
 * The user picks a difficulty tier (Trivial → Epic) which maps to a
 * fixed (gold, xp) reward so we don't show raw sliders.
 */
function CustomPracticeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [tier, setTier] = useState<DifficultyTier>(DIFFICULTY_TIERS[2]); // default MEDIUM
  const [days, setDays] = useState<Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: typeof days[number]) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  const createM = useDelayedMutation({
    mutationFn: () =>
      api('/dailies', {
        method: 'POST',
        body: {
          name,
          notes: notes || undefined,
          category: 'SPIRITUAL',
          goldReward: tier.gold,
          xpReward: tier.xp,
          days: days.length > 0 ? days : undefined,
        },
      }),
    onSuccess: () => onSaved(),
    onError: (err: Error) => setError(err.message ?? 'Failed to create practice.'),
  }, 800);

  return (
    <Modal open onClose={onClose} title="New spiritual practice">
      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Name
          </label>
          <input
            className="input-neon w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g., Novena to St. Joseph, Litany of Humility, Act of charity"
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Difficulty
          </label>
          <div className="grid grid-cols-5 gap-1">
            {DIFFICULTY_TIERS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTier(t)}
                className={`p-2 text-center border transition-all ${
                  tier.key === t.key ? 'bg-bg-900/60' : 'border-ink-500/30 hover:border-ink-300'
                }`}
                style={
                  tier.key === t.key
                    ? { borderColor: t.color, boxShadow: `0 0 8px ${t.color}55` }
                    : undefined
                }
                title={t.hint}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: t.color }}>
                  {t.label}
                </div>
                <div className="text-[9px] font-mono text-ink-300 mt-0.5">
                  +{t.gold}g · {t.xp}xp
                </div>
              </button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-1 italic">
            {tier.hint}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Days (leave empty for every day)
          </label>
          <div className="flex flex-wrap gap-1">
            {(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`px-3 py-1.5 text-xs font-mono uppercase border ${
                  days.includes(d)
                    ? 'border-neon-violet/80 text-neon-violet bg-neon-violet/10'
                    : 'border-ink-500/30 text-ink-300 hover:border-ink-300'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>

        {error && (
          <div className="text-[10px] font-mono text-neon-red">{error}</div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
          <NeonButton
            onClick={() => createM.run()}
            loading={createM.isPending}
            icon="☩"
            loadingText="Creating…"
            disabled={!name.trim()}
          >
            Create
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
