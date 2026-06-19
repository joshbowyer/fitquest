import { useState, useEffect, useMemo } from 'react';
import { Modal } from '@/components/Modal';
import { AvatarCustomizer } from '@/components/AvatarCustomizer';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { CLASS_META, isClassEligible, PRIMARY_ASPECT_LABEL, type ClassName } from '@/lib/types';
import { classNames } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, roundForUnits, type UnitSystem } from '@/lib/units';
import {
  getFrameSize,
  getFrameArchetype,
  getBuildCategory,
  getHeightCategory,
  ARCHETYPE_META,
  ARCHETYPE_MATRIX,
  type BuildCategory,
  type FrameArchetype,
  type HeightCategory,
} from '@/lib/frame';

const CLASS_OPTIONS: ClassName[] = ['JUGGERNAUT', 'PHANTOM', 'SCOUT', 'BERSERKER', 'ORACLE'];

// Casey Butt–calibrated preview formulas (must mirror api/src/lib/geneticMax.ts)
function previewMax(
  metric: string,
  wristCm: number | null,
  ankleCm: number | null,
  heightCm: number | null,
  neckCircCm: number | null = null,
): number | null {
  const w = wristCm;
  const a = ankleCm;
  const h = heightCm;
  const n = neckCircCm;
  switch (metric) {
    case 'BICEP':      return w ? w * 2.7 : (h ? h * 0.228 : null);
    case 'FOREARM':    return w ? w * 2.3 : (h ? h * 0.195 : null);
    case 'CHEST':      return w ? w * 7.5 : (h ? h * 0.634 : null);
    case 'SHOULDER':   return w ? w * 8.5 : (h ? h * 0.718 : null);
    case 'NECK':       return n ? n : (w ? w * 2.9 : (h ? h * 0.245 : null));
    case 'QUAD':       return a ? a * 2.85 : (h ? h * 0.352 : null);
    case 'CALF':       return a ? a * 1.9 : (h ? h * 0.234 : null);
    case 'WAIST':      return h ? h * 0.161 : (w ? w * 1.9 : null);
    case 'BENCH_1RM':  return w ? w * 1.0 : null; // bench ≈ 1x bodyweight proxy (no weight)
    default: return null;
  }
}

const PREVIEW_METRICS = [
  { key: 'BICEP', label: 'Bicep', unit: 'cm' },
  { key: 'FOREARM', label: 'Forearm', unit: 'cm' },
  { key: 'CHEST', label: 'Chest', unit: 'cm' },
  { key: 'SHOULDER', label: 'Shoulder', unit: 'cm' },
  { key: 'NECK', label: 'Neck', unit: 'cm' },
  { key: 'QUAD', label: 'Quad', unit: 'cm' },
  { key: 'CALF', label: 'Calf', unit: 'cm' },
] as const;

function storageUnitForKey(key: string): string {
  if (key === 'heightCm') return 'cm';
  if (key === 'wristCm') return 'cm';
  if (key === 'ankleCm') return 'cm';
  if (key === 'forearmLengthCm') return 'cm';
  if (key === 'neckCircCm') return 'cm';
  if (key === 'weightKg') return 'kg';
  return '';
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const inImperial = system === 'IMPERIAL';

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [classChoice, setClassChoice] = useState<ClassName | null>(null);
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [sexDraft, setSexDraft] = useState<'MALE' | 'FEMALE' | 'OTHER' | null>(null);
  const [saveResult, setSaveResult] = useState<{ kind: 'idle' | 'saved' | 'recomputed' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [pendingClass, setPendingClass] = useState<ClassName | null>(null);

  // Split frame inputs by volatility. Static = bone structure (rarely
  // changes, drives Casey Butt genetic maxes). Dynamic = body comp
  // (changes with training, drives FFMI + lean mass). birthDate lives
  // with the static set since it changes ~never.
  const STATIC_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'forearmLengthCm', 'neckCircCm', 'birthDate'] as const;
  const DYNAMIC_KEYS = ['weightKg', 'bodyFatPct'] as const;
  const FRAME_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'forearmLengthCm', 'neckCircCm', 'weightKg', 'bodyFatPct'] as const;

  // Initialize draft + class + birthdate from user on mount/unit change
  useEffect(() => {
    if (!user) return;
    const next: Record<string, string> = {};
    for (const key of FRAME_KEYS) {
      const v = (user as any)[key] as number | null | undefined;
      if (v == null) {
        next[key] = '';
      } else if (inImperial) {
        const converted = convertForDisplay(v, storageUnitForKey(key), 'IMPERIAL');
        next[key] = String(roundForUnits(converted.value, storageUnitForKey(key)));
      } else {
        // Always round to clean up float imprecision from prior
        // imperial->metric conversions (e.g. 71 in -> 180.3399... cm).
        next[key] = String(roundForUnits(v, storageUnitForKey(key)));
      }
    }
    setDraft(next);
    if (classChoice === null) setClassChoice(user.class);
    if (birthDate === null) setBirthDate(user.birthDate);
    if (sexDraft === null) setSexDraft(user.sex);
  }, [user, inImperial]);

  function setDraftField(key: string, raw: string) {
    setDraft((d) => ({ ...d, [key]: raw }));
  }

  function numFromDraft(key: string): number | null {
    const raw = draft[key];
    if (raw === '' || raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (inImperial) {
      return convertForStorage(n, displayUnit(storageUnitForKey(key), 'IMPERIAL'), 'IMPERIAL').value;
    }
    return n;
  }

  // Compute the "preview" values (cm, always in metric) from current draft
  const previewWrist = numFromDraft('wristCm');
  const previewAnkle = numFromDraft('ankleCm');
  const previewHeight = numFromDraft('heightCm');
  const previewWeight = numFromDraft('weightKg');

  const previewFrame = useMemo(
    () => getFrameSize(previewWrist, previewAnkle),
    [previewWrist, previewAnkle],
  );
  const previewArchetype = useMemo(
    () => getFrameArchetype(previewHeight, previewWeight, user?.bodyFatPct ?? null),
    [previewHeight, previewWeight, user?.bodyFatPct],
  );

  // Detect what changed from the saved user object
  const frameChanged = useMemo(() => {
    if (!user) return false;
    const checks: Array<[string, number | null | undefined]> = [
      ['wristCm', user.wristCm],
      ['ankleCm', user.ankleCm],
      ['heightCm', user.heightCm],
      ['weightKg', user.weightKg],
      ['bodyFatPct', user.bodyFatPct],
    ];
    for (const [key, saved] of checks) {
      const now = numFromDraft(key);
      const savedN = saved ?? null;
      if ((now ?? null) !== savedN) return true;
    }
    return false;
  }, [user, draft, inImperial]);

  const classChanged = classChoice !== null && classChoice !== user?.class;
  const birthChanged = birthDate !== null && birthDate !== user?.birthDate;
  const sexChanged = sexDraft !== null && sexDraft !== user?.sex;
  const anythingChanged = frameChanged || classChanged || birthChanged || sexChanged;

  const saveM = useDelayedMutation<
    { recomputed: boolean; changeCount: number },
    { targetClass?: ClassName | null } | undefined
  >({
    mutationFn: async (vars) => {
      const body: any = {};
      // The class to set comes from the modal's pendingClass (passed via
      // vars.targetClass) when the user confirms a class change. When
      // saving other Profile fields without a class change, vars is
      // undefined and we fall back to nothing (no class sent).
      if (vars?.targetClass) {
        body.class = vars.targetClass;
      } else if (classChoice) {
        body.class = classChoice;
      }
      for (const key of FRAME_KEYS) {
        const raw = draft[key];
        if (raw === '' || raw == null) {
          body[key] = null;
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        if (inImperial) {
          const stored = convertForStorage(n, displayUnit(storageUnitForKey(key), 'IMPERIAL'), 'IMPERIAL');
          // Round before saving so we never persist float imprecision
          // (e.g. 71 in -> 180.3399... cm).
          body[key] = roundForUnits(stored.value, storageUnitForKey(key));
        } else {
          body[key] = roundForUnits(n, storageUnitForKey(key));
        }
      }
      if (birthChanged) body.birthDate = birthDate;
      if (sexChanged) body.sex = sexDraft;
      await api('/users/me', { method: 'PATCH', body });
      // Auto-recompute genetic maxes if frame data changed
      if (frameChanged) {
        const recomputeRes = await api<{ changes: Array<{ metric: string; from: number | null; to: number }> }>(
          '/genetic-max/recompute',
          { method: 'POST' },
        );
        return { recomputed: true, changeCount: recomputeRes.changes.length };
      }
      return { recomputed: false, changeCount: 0 };
    },
    onSuccess: async (res) => {
      await refresh();
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      if (res?.recomputed) {
        setSaveResult({
          kind: 'recomputed',
          message: `Saved · ${res.changeCount} maxes recomputed from your frame.`,
        });
      } else {
        setSaveResult({ kind: 'saved', message: 'Saved.' });
      }
      setTimeout(() => setSaveResult({ kind: 'idle', message: '' }), 4000);
    },
    onError: (e: any) => {
      // 423 = class locked
      if (e?.status === 423) {
        setSaveResult({ kind: 'error', message: e.message || 'Class is locked.' });
        // Refresh so the lock status banner re-evaluates
        refresh();
      } else {
        setSaveResult({ kind: 'error', message: e instanceof Error ? e.message : 'Save failed' });
      }
    },
  }, 1500);

  if (!user) return null;

  const missing: string[] = [];
  if (!previewHeight) missing.push('height');
  if (!previewWrist) missing.push('wrist');
  if (!previewAnkle) missing.push('ankle');
  const frameIncomplete = missing.length > 0;
  const previewNeck = numFromDraft('neckCircCm');
  const previewValues = PREVIEW_METRICS.map((m) => ({
    ...m,
    value: previewMax(m.key, previewWrist, previewAnkle, previewHeight, previewNeck),
  }));
  const previewsValid = previewValues.every((v) => v.value != null);

  return (
    <Layout>
      <PageHeader title="// Profile" subtitle="Tune your frame. Pick your class." />

      <div className="space-y-4 max-w-4xl">
        {/* FRAME */}
        <Panel
          variant="cyan"
          title="Frame"
          action={
            <span className={`text-[10px] font-mono ${frameIncomplete ? 'neon-text-amber animate-pulse' : 'text-ink-300'}`}>
              {frameIncomplete ? `! NEEDS: ${missing.join(', ').toUpperCase()}` : '✓ COMPLETE'}
            </span>
          }
        >
          <div className="space-y-4">
            {/* Archetype (9-class somatotype) */}
            <div className="border-b border-ink-500/30 pb-3">
              {previewArchetype ? (
                <>
                  <div className="text-center">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Archetype</div>
                    <div
                      className="font-display text-4xl tracking-[0.2em] mt-1 text-ink-50"
                      style={{ textShadow: '0 0 12px rgba(245,245,250,0.5)' }}
                    >
                      {ARCHETYPE_META[previewArchetype].emoji} {ARCHETYPE_META[previewArchetype].label}
                    </div>
                    <div className="text-[10px] text-ink-300 font-mono mt-1 italic">
                      {ARCHETYPE_META[previewArchetype].tagline} · {ARCHETYPE_META[previewArchetype].description}
                    </div>
                  </div>
                  {/* 3x3 grid showing where the user fits */}
                  <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-1 text-[9px] font-mono mt-3">
                    <div></div>
                    <div className="text-center text-ink-300 uppercase tracking-widest pb-1">Short</div>
                    <div className="text-center text-ink-300 uppercase tracking-widest pb-1">Med</div>
                    <div className="text-center text-ink-300 uppercase tracking-widest pb-1">Tall</div>
                    {(['LEAN', 'BALANCED', 'SOLID'] as const).map((b) => (
                      <SomatotypeRow
                        key={b}
                        build={b}
                        archetype={previewArchetype}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-3">
                  <div className="text-xs text-neon-amber font-mono mb-1 animate-pulse">! ARCHETYPE UNKNOWN</div>
                  <div className="text-[10px] text-ink-300 font-mono">
                    Need height + wrist + ankle (and ideally weight) to classify.
                  </div>
                </div>
              )}
            </div>

            {/* Frame inputs — split into Static (rarely changes) and
                Dynamic (changes with training). Static drives the
                Casey Butt genetic maxes; Dynamic drives FFMI/lean mass. */}
            <div className="space-y-3">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
                  Static · bone structure
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <FrameField
                    label="Height"
                    storageKey="heightCm"
                    value={draft.heightCm ?? ''}
                    onChange={(v) => setDraftField('heightCm', v)}
                    system={system}
                    step={inImperial ? 0.5 : 0.1}
                    required
                    present={!!previewHeight}
                  />
                  <FrameField
                    label="Wrist"
                    storageKey="wristCm"
                    value={draft.wristCm ?? ''}
                    onChange={(v) => setDraftField('wristCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewWrist}
                  />
                  <FrameField
                    label="Ankle"
                    storageKey="ankleCm"
                    value={draft.ankleCm ?? ''}
                    onChange={(v) => setDraftField('ankleCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewAnkle}
                  />
                  <FrameField
                    label="Forearm"
                    storageKey="forearmLengthCm"
                    value={draft.forearmLengthCm ?? ''}
                    onChange={(v) => setDraftField('forearmLengthCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                  />
                  <FrameField
                    label="Neck"
                    storageKey="neckCircCm"
                    value={draft.neckCircCm ?? ''}
                    onChange={(v) => setDraftField('neckCircCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                  />
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
                  Dynamic · body comp
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                      Weight ({displayUnit('kg', system)})
                    </label>
                    <input
                      className="input-neon"
                      type="number"
                      step={inImperial ? 1 : 0.1}
                      value={draft.weightKg ?? ''}
                      onChange={(e) => setDraftField('weightKg', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
                      Body Fat (%)
                    </label>
                    <input
                      className="input-neon"
                      type="number"
                      step="0.1"
                      value={draft.bodyFatPct ?? ''}
                      onChange={(e) => setDraftField('bodyFatPct', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Preview maxes */}
            <div className="border-t border-ink-500/30 pt-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
                Preview maxes at these inputs
              </div>
              {previewsValid ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {previewValues.map((m) => (
                    <div key={m.key} className="border border-neon-cyan/20 bg-neon-cyan/5 p-2 text-center">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">{m.label}</div>
                      <div className="font-display text-lg neon-text-cyan">
                        {m.value != null ? convertForDisplay(m.value, m.unit, system).value.toFixed(1) : '—'}
                        <span className="text-[10px] text-ink-300 ml-1">{displayUnit(m.unit, system)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-ink-300 font-mono italic">
                  Fill in {missing.join(', ')} to preview maxes. These are the Casey Butt–calibrated natural ceilings.
                </div>
              )}
            </div>

            {/* Birth Date + Sex — sit with the static identity fields.
                Birthday drives the class-lock window. Sex affects body
                fat interpretation and genetic max norms. */}
            <div className="border-t border-ink-500/30 pt-3">
              <div className="text-[9px] font-mono uppercase tracking-widest text-ink-400 mb-1.5">
                Static · identity
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
                    Sex
                  </label>
                  <select
                    className="input-neon"
                    value={sexDraft ?? ''}
                    onChange={(e) => setSexDraft((e.target.value || null) as 'MALE' | 'FEMALE' | 'OTHER' | null)}
                  >
                    <option value="">— prefer not to say —</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other / non-binary</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
                    Birth Date
                  </label>
                  <input
                    className="input-neon"
                    type="date"
                    value={birthDate ? new Date(birthDate).toISOString().slice(0, 10) : ''}
                    onChange={(e) => setBirthDate(e.target.value ? new Date(e.target.value).toISOString() : null)}
                  />
                </div>
              </div>
              <p className="text-[10px] text-ink-400 font-mono mt-2 italic">
                Birthday unlocks your class once a year. Sex refines body fat
                interpretation, VO2 max, and other sex-aware genetic maxes.
              </p>
            </div>

            {/* Save button + feedback */}
            <div className="border-t border-ink-500/30 pt-3 flex items-center gap-3">
              <NeonButton
                onClick={() => saveM.run(undefined)}
                loading={saveM.isPending}
                disabled={!anythingChanged}
                icon="⚡"
                loadingText={frameChanged ? 'Saving & Recomputing…' : 'Saving…'}
              >
                {frameChanged ? 'Save & Recompute Maxes' : 'Save'}
              </NeonButton>
              {saveResult.kind === 'saved' && (
                <span className="text-xs font-mono neon-text-lime">✓ {saveResult.message}</span>
              )}
              {saveResult.kind === 'recomputed' && (
                <span className="text-xs font-mono neon-text-amber">⚡ {saveResult.message}</span>
              )}
              {saveResult.kind === 'error' && (
                <span className="text-xs font-mono neon-text-magenta">! {saveResult.message}</span>
              )}
              {!anythingChanged && saveResult.kind === 'idle' && (
                <span className="text-[10px] text-ink-400 font-mono">No changes to save</span>
              )}
            </div>
          </div>
        </Panel>

        {/* AVATAR */}
        <AvatarCustomizer user={user} />

        {/* CLASS */}
        <Panel variant="cyan" title="Class">
          <div className="text-[10px] font-mono text-ink-300 mb-3">
            Your class determines which skill tree you can unlock and which stats get the most XP from training.
            Classes are gated by your <span className="neon-text-cyan">archetype</span> — lean into what you are, not what you are not.
          </div>
          {user.classLock?.locked && (
            <div className="mb-3 border border-neon-amber/40 bg-neon-amber/5 p-3 text-[10px] font-mono space-y-1">
              <div>
                <span className="neon-text-amber">⚠ CLASS LOCKED</span> · You picked{' '}
                <span className="text-ink-100">{CLASS_META[user.class!]?.label}</span>{' '}
                and can change it again in{' '}
                <span className="neon-text-amber">{user.classLock.remainingLabel}</span>
                {user.classLock.birthdayUnlock && user.classLock.unlockAt && (
                  <span className="text-ink-300"> (on your birthday, {new Date(user.classLock.unlockAt).toLocaleDateString()})</span>
                )}
                {!user.classLock.birthdayUnlock && user.classLock.unlockAt && (
                  <span className="text-ink-300"> (unlocks {new Date(user.classLock.unlockAt).toLocaleDateString()})</span>
                )}
                .
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-ink-300">
                  💎 Soulstones: <span className="text-ink-100 font-bold">{user.soulstones ?? 0}</span>
                </span>
                {user.classLock.canUseSoulstone && (
                  <button
                    type="button"
                    onClick={() => {
                      // Open the confirmation modal with a flag that
                      // we're spending a soulstone.
                      const firstEligible = CLASS_OPTIONS.find(
                        (c) => c !== user.class && isClassEligible(c, previewArchetype),
                      );
                      if (firstEligible) setPendingClass(firstEligible);
                    }}
                    className="text-[10px] font-mono px-2 py-1 border border-neon-magenta/60 text-neon-magenta bg-neon-magenta/5 hover:bg-neon-magenta/10"
                  >
                    💎 Use 1 Soulstone to change class
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CLASS_OPTIONS.map((c) => {
              const m = CLASS_META[c];
              const isCurrentClass = user.class === c;
              const isPendingClass = pendingClass === c;
              const eligible = isClassEligible(c, previewArchetype);
              const disabled = !eligible || (user.classLock?.locked ?? false);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    if (isCurrentClass) return; // already picked, no-op
                    // Open confirmation dialog immediately. User must
                    // confirm before the class is actually set.
                    setPendingClass(c);
                  }}
                  disabled={disabled}
                  title={
                    user.classLock?.locked && !isCurrentClass
                      ? `Locked for ${user.classLock.remainingLabel}`
                      : eligible
                      ? m.description
                      : `Not for ${previewArchetype ? ARCHETYPE_META[previewArchetype].label.toLowerCase() : 'frame'} build`
                  }
                  className={classNames(
                    'p-3 border-2 text-left transition-all relative',
                    isCurrentClass
                      ? `border-neon-${m.color}/80 bg-neon-${m.color}/10`
                      : isPendingClass
                      ? `border-neon-magenta/80 bg-neon-magenta/10`
                      : disabled
                      ? 'border-ink-500/30 bg-bg-700/40 opacity-50 cursor-not-allowed'
                      : 'border-ink-500/40 hover:border-ink-300'
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <div className={`font-display tracking-wider text-sm ${isCurrentClass ? `neon-text-${m.color}` : isPendingClass ? 'neon-text-magenta' : !eligible || user.classLock?.locked ? 'text-ink-400' : 'text-ink-200'}`}>
                      {m.label}
                    </div>
                    {!eligible && (
                      <span className="text-[9px] font-mono text-ink-400 uppercase tracking-widest">LOCKED</span>
                    )}
                    {eligible && !isCurrentClass && !user.classLock?.locked && (
                      <span className="text-[9px] font-mono neon-text-lime uppercase tracking-widest">OPEN</span>
                    )}
                    {isCurrentClass && (
                      <span className="text-[9px] font-mono neon-text-amber uppercase tracking-widest">PICKED</span>
                    )}
                    {eligible && !isCurrentClass && user.classLock?.locked && (
                      <span className="text-[9px] font-mono neon-text-amber uppercase tracking-widest">FROZEN</span>
                    )}
                    {isPendingClass && (
                      <span className="text-[9px] font-mono neon-text-magenta uppercase tracking-widest animate-pulse">CONFIRM?</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] font-mono uppercase tracking-widest ${eligible && !user.classLock?.locked ? `neon-text-${m.color}` : 'text-ink-500'}`}>
                      {PRIMARY_ASPECT_LABEL[m.primary]}
                    </span>
                    <span className="text-ink-500 text-[9px]">·</span>
                    <span className={`text-[9px] font-mono ${eligible ? 'text-ink-400' : 'text-ink-500'}`}>
                      {m.ability.tag}
                    </span>
                  </div>
                  <div className={`text-[10px] font-mono mt-1 ${eligible && !user.classLock?.locked ? 'text-ink-300' : 'text-ink-500'}`}>
                    {m.tagline}
                  </div>
                  <div
                    className={classNames(
                      'inline-block mt-1.5 px-1.5 py-0.5 text-[9px] font-mono tracking-widest uppercase border',
                      isCurrentClass
                        ? `border-neon-${m.color}/60 text-neon-${m.color} bg-neon-${m.color}/5`
                        : eligible && !user.classLock?.locked
                        ? `border-neon-${m.color}/60 text-neon-${m.color} bg-neon-${m.color}/5`
                        : 'border-ink-500/30 text-ink-500 bg-ink-500/5'
                    )}
                    style={eligible && !user.classLock?.locked ? { textShadow: `0 0 4px currentColor` } : undefined}
                  >
                    ⚡ {m.ability.tag} · {m.ability.label}
                  </div>
                  {!eligible && previewArchetype && (
                    <div className="text-[9px] font-mono text-neon-magenta mt-1 italic">
                      Not for {ARCHETYPE_META[previewArchetype].label}s — needs {PRIMARY_ASPECT_LABEL[m.primary]}.
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {previewArchetype && (
            <div className="mt-3 text-[10px] font-mono text-ink-300 border-t border-ink-500/30 pt-2">
              <span className="text-ink-50">{ARCHETYPE_META[previewArchetype].label}</span> opens:{' '}
              {CLASS_OPTIONS.filter((c) => isClassEligible(c, previewArchetype)).map((c) => (
                <span key={c} className={`ml-1 neon-text-${CLASS_META[c].color}`}>
                  {CLASS_META[c].label}
                </span>
              ))}
            </div>
          )}
          {previewArchetype && (
            <div className="text-[10px] text-ink-400 font-mono italic mt-1">
              Tier 1 (primary aspect) drives the gating. Side-trains (e.g. cardio as a Juggernaut) still earn XP — the class shapes the focus, not the menu.
            </div>
          )}
        </Panel>

        {/* Class change confirmation dialog. Rendered only when there's
            a pending class — otherwise the children would reference
            `pendingClass!` and throw. */}
        {pendingClass && (
          <Modal
            open={true}
            onClose={() => setPendingClass(null)}
            title={user.class ? "⚠ Confirm class change" : "Confirm your class pick"}
          >
            <div className="text-xs font-mono text-ink-200 space-y-3">
              {user.class ? (
                <p>
                  You're switching from{' '}
                  <span className={`neon-text-${CLASS_META[user.class].color}`}>
                    {CLASS_META[user.class].label}
                  </span>{' '}
                  to{' '}
                  <span className={`neon-text-${CLASS_META[pendingClass].color}`}>
                    {CLASS_META[pendingClass].label}
                  </span>
                  .
                </p>
              ) : (
                <p>
                  You're starting your journey as{' '}
                  <span className={`neon-text-${CLASS_META[pendingClass].color}`}>
                    {CLASS_META[pendingClass].label}
                  </span>
                  .
                </p>
              )}
              {user.class && user.classLock?.locked && user.classLock.canUseSoulstone && (
                <div className="border border-neon-magenta/40 bg-neon-magenta/5 p-3">
                  <p className="neon-text-magenta mb-1">💎 Spending 1 Soulstone to bypass the lock.</p>
                  <p className="text-ink-300 text-[10px]">
                    After this change, your new class will lock until your next birthday
                    (or another Soulstone).
                  </p>
                </div>
              )}
              {user.class && (!user.classLock?.locked || !user.classLock.canUseSoulstone) && (
                <div className="border border-neon-amber/40 bg-neon-amber/5 p-3">
                  <p className="text-neon-amber mb-1">⚠ Class locks for a year (unlocks on your birthday).</p>
                  <p className="text-ink-300 text-[10px]">
                    You can change your class once per year, on (or after) your birthday.
                    Soulstone drops from raid victories let you bypass the lock.
                  </p>
                </div>
              )}
              <p className="text-ink-300 text-[10px]">
                Your new class:{' '}
                <span className="text-ink-100 font-bold">{CLASS_META[pendingClass].label}</span>{' '}
                ({CLASS_META[pendingClass].tagline})
              </p>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPendingClass(null)}
                className="btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingClass;
                  setPendingClass(null);
                  setClassChoice(null);
                  saveM.run({ targetClass: target });
                }}
                className={`flex-1 ${user.classLock?.locked && user.classLock.canUseSoulstone ? 'btn-neon-magenta' : 'btn-neon-magenta'}`}
              >
                {user.class
                  ? user.classLock?.locked && user.classLock.canUseSoulstone
                    ? '💎 Use Soulstone · Switch to '
                    : 'Switch to '
                  : 'Pick '}
                {CLASS_META[pendingClass].label}
              </button>
            </div>
          </Modal>
        )}

        {/* IDENTITY */}
        <Panel variant="cyan" title="Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <Row k="Callsign" v={user.username} />
            <Row k="Email" v={user.email} />
            <Row k="Class" v={user.class ? CLASS_META[user.class].label : '—'} />
            <Row k="Level" v={String(user.level)} />
            <Row k="Total XP" v={String(user.xp)} />
            <Row k="Gold" v={String(user.gold)} />
            <Row k="Created" v={new Date(user.createdAt).toLocaleDateString()} />
            <Row k="Units" v={user.units === 'IMPERIAL' ? 'in / lb / fl oz' : 'cm / kg / ml'} />
          </div>
          <div className="mt-4 text-[10px] text-ink-400 font-mono leading-relaxed border-t border-neon-magenta/20 pt-3">
            // change units in <Link to="/settings" className="neon-text-cyan hover:underline">Settings → Display</Link> · account actions (password, 2FA) coming in v0.5
          </div>
        </Panel>
      </div>
    </Layout>
  );
}

function FrameField({
  label,
  storageKey,
  value,
  onChange,
  system,
  step,
  required = false,
  present = true,
}: {
  label: string;
  storageKey: string;
  value: string;
  onChange: (v: string) => void;
  system: UnitSystem;
  step: number;
  required?: boolean;
  present?: boolean;
}) {
  const displayU = displayUnit(storageUnitForKey(storageKey), system);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className={`text-[10px] font-mono uppercase tracking-widest ${required ? 'text-neon-cyan/80' : 'text-ink-300'}`}>
          {label} ({displayU})
        </label>
        {required && (
          <span className={`text-[9px] font-mono ${present ? 'neon-text-lime' : 'neon-text-amber'}`}>
            {present ? '✓' : '⚠'}
          </span>
        )}
      </div>
      <input
        className="input-neon"
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={storageKey === 'heightCm' ? '180' : storageKey === 'wristCm' ? '15' : '21'}
      />
    </div>
  );
}

function SomatotypeRow({ build, archetype }: { build: BuildCategory; archetype: FrameArchetype }) {
  const labels: Record<BuildCategory, string> = { LEAN: 'Lean', BALANCED: 'Bal', SOLID: 'Solid' };
  return (
    <>
      <div className="text-right pr-2 text-ink-300 uppercase tracking-widest self-center">{labels[build]}</div>
      {(['SHORT', 'MEDIUM', 'TALL'] as const).map((h) => {
        const a = ARCHETYPE_MATRIX[build][h];
        const meta = ARCHETYPE_META[a];
        const isUser = archetype === a;
        return (
          <div
            key={h}
            className={classNames(
              'h-9 border flex items-center justify-center font-display tracking-wider text-[10px]',
              isUser
                ? `border-neon-${meta.color}/80 bg-neon-${meta.color}/15 neon-text-${meta.color}`
                : 'border-ink-500/30 text-ink-400'
            )}
            style={isUser ? { textShadow: '0 0 6px currentColor' } : undefined}
          >
            {meta.label.slice(0, 3).toUpperCase()}
          </div>
        );
      })}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-ink-500/20 py-1.5">
      <span className="text-ink-300 text-[10px] uppercase tracking-widest">{k}</span>
      <span className="neon-text-cyan text-xs font-mono">{v}</span>
    </div>
  );
}
