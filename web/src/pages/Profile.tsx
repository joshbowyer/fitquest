import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { BodyfatMethodPicker } from '@/components/BodyfatMethodPicker';
import { AvatarCustomizer } from '@/components/AvatarCustomizer';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth, type UserSex } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { CLASS_META, isClassEligible, PRIMARY_ASPECT_LABEL, type ClassName, CLASS_EVOLUTION, getClassDisplayName } from '@/lib/types';
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
import { previewMax, PREVIEW_METRICS } from '@/lib/geneticMax';

const CLASS_OPTIONS: ClassName[] = ['JUGGERNAUT', 'PHANTOM', 'SCOUT', 'BERSERKER', 'TRACER', 'ORACLE'];

// Open-Meteo geocoding search-result shape. Mirrors the JSON the
// `/geocode` route returns (see api/src/routes/geocode.ts).
type GeocodeResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  admin3?: string;
  admin4?: string;
  timezone?: string;
  population?: number;
  feature_code?: string;
};

// previewMax + PREVIEW_METRICS moved to @/lib/geneticMax (shared
// single source of truth; mirrors api/src/lib/geneticMax.ts).

function storageUnitForKey(key: string): string {
  if (key === 'heightCm') return 'cm';
  if (key === 'wristCm') return 'cm';
  if (key === 'ankleCm') return 'cm';
  if (key === 'forearmLengthCm') return 'cm';
  if (key === 'neckCircCm') return 'cm';
  if (key === 'shoulderCm') return 'cm';
  if (key === 'waistCm') return 'cm';
  if (key === 'weightKg') return 'kg';
  return '';
}

export function ProfilePage() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const location = useLocation();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const inImperial = system === 'IMPERIAL';

  // Scroll to the #class panel when arriving from a deep link (e.g.
  // /inventory's "Profile → Class" link sets location.hash = 'class').
  // Without this the link would just navigate but the user would have
  // to scroll to find the class-change UI.
  useEffect(() => {
    if (location.hash === 'class') {
      const el = document.getElementById('class');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [classChoice, setClassChoice] = useState<ClassName | null>(null);
  const [birthDate, setBirthDate] = useState<string | null>(null);
  // Sex picker offers MALE or FEMALE only — body-fat formulas
  // (Jackson-Pollock, Navy tape) branch on this and only have
  // validated forms for those two. The state still admits OTHER
  // (legacy enum value, never offered in the UI) because it's
  // seeded from user.sex for backward compat with any existing
  // row — those users get the male formula at the picker.
  const [sexDraft, setSexDraft] = useState<UserSex | null>(null);
  const [ordainedDraft, setOrdainedDraft] = useState<boolean>(false);
  const [timezoneDraft, setTimezoneDraft] = useState<string>('');
  const [latitudeDraft, setLatitudeDraft] = useState<string>('');
  const [longitudeDraft, setLongitudeDraft] = useState<string>('');
  const [locationSearchDraft, setLocationSearchDraft] = useState<string>('');
  const [locationSearchResults, setLocationSearchResults] = useState<GeocodeResult[]>([]);
  // Bodyfat picker is the recommended way to log a body-fat reading
  // on Profile — picks the method (DEXA / BIA / calipers / Navy),
  // computes %BF, and writes a Measurement row tagged with the
  // source. After a successful picker submit we also refresh auth
  // state so the dashboard's bodyFatPct reflects the latest value.
  const [showBodyfatPicker, setShowBodyfatPicker] = useState(false);
  const [saveResult, setSaveResult] = useState<{ kind: 'idle' | 'saved' | 'recomputed' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [pendingClass, setPendingClass] = useState<ClassName | null>(null);

  // The "Use 1 Soulstone to change class" button on the lock banner
  // opens its OWN modal. The intent there is "I want to spend a
  // Soulstone to remove the lock, then I'll pick a class normally"
  // — distinctly different from clicking a class tile, which bundles
  // the Soulstone spend + class change into one confirmation. We
  // keep these two flows separate so the lock banner button doesn't
  // silently prefill a class (which was the old behavior).
  const [pendingSoulstoneUnlock, setPendingSoulstoneUnlock] = useState(false);
  const [soulstoneUnlockError, setSoulstoneUnlockError] = useState<string | null>(null);
  const [soulstoneUnlockBusy, setSoulstoneUnlockBusy] = useState(false);

  // Split frame inputs by volatility. Static = bone structure (rarely
  // changes, drives Casey Butt genetic maxes + scales the Tron
  // identity disk). Dynamic = body comp (changes with training,
  // drives FFMI/lean mass). birthDate lives with the static set
  // since it changes ~never.
  const STATIC_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'forearmLengthCm', 'neckCircCm', 'shoulderCm', 'waistCm', 'birthDate'] as const;
  const DYNAMIC_KEYS = ['weightKg', 'bodyFatPct'] as const;
  const FRAME_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'forearmLengthCm', 'neckCircCm', 'shoulderCm', 'waistCm', 'weightKg', 'bodyFatPct'] as const;

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
    setOrdainedDraft(user.ordained ?? false);
    setTimezoneDraft(user.timezone ?? '');
    setLatitudeDraft(user.latitude != null ? String(user.latitude) : '');
    setLongitudeDraft(user.longitude != null ? String(user.longitude) : '');
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
  const previewForearm = numFromDraft('forearmLengthCm');
  const previewNeck = numFromDraft('neckCircCm');
  const previewWeight = numFromDraft('weightKg');
  const previewBodyFat = numFromDraft('bodyFatPct');

  const previewFrame = useMemo(
    () => getFrameSize(previewWrist, previewAnkle),
    [previewWrist, previewAnkle],
  );
  // Use the draft values for BOTH weight and body fat so the archetype
  // preview reacts to the user typing in either field. Using the saved
  // user.bodyFatPct here (the previous behaviour) makes editing BF in
  // the form a no-op until the user hits save — so a 160lb person at
  // 10% vs 20% BF both render STRIKER / FORGE identically until save,
  // even though their lean mass differs by ~9kg.
  const previewArchetype = useMemo(
    () => getFrameArchetype(previewHeight, previewWeight, previewBodyFat),
    [previewHeight, previewWeight, previewBodyFat],
  );

  // Detect what changed from the saved user object
  const frameChanged = useMemo(() => {
    if (!user) return false;
    const checks: Array<[string, number | null | undefined]> = [
      ['wristCm', user.wristCm],
      ['ankleCm', user.ankleCm],
      ['heightCm', user.heightCm],
      ['shoulderCm', user.shoulderCm],
      ['waistCm', user.waistCm],
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
  const ordainedChanged = ordainedDraft !== (user?.ordained ?? false);
  const timezoneChanged = timezoneDraft !== (user?.timezone ?? '');
  const locationLat = latitudeDraft === '' ? null : Number(latitudeDraft);
  const locationLng = longitudeDraft === '' ? null : Number(longitudeDraft);
  const locationValid = (locationLat == null && locationLng == null) ||
    (Number.isFinite(locationLat) && Number.isFinite(locationLng) &&
     locationLat! >= -90 && locationLat! <= 90 &&
     locationLng! >= -180 && locationLng! <= 180);
  const locationChanged =
    (locationLat ?? null) !== (user?.latitude ?? null) ||
    (locationLng ?? null) !== (user?.longitude ?? null);
  const anythingChanged = frameChanged || classChanged || birthChanged || sexChanged || ordainedChanged || timezoneChanged;

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
      if (ordainedChanged) body.ordained = ordainedDraft;
      if (timezoneChanged) body.timezone = timezoneDraft || null;
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
      // Belt-and-suspenders: clear the pending-class state in
      // onSuccess too (the click handler already does this
      // synchronously, but if a re-render batches it oddly the
      // modal could stick). Without this, "click change to SCOUT
      // then click away" was the workaround.
      setPendingClass(null);
      await refresh();
      qc.invalidateQueries({ queryKey: ['genetic-max'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['forecast'] });
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
  const previewValues = PREVIEW_METRICS.map((m) => ({
    ...m,
    value: previewMax(m.key, previewWrist, previewAnkle, previewHeight, previewWeight),
  }));
  const previewsValid = previewValues.every((v) => v.value != null);

  // Geocoding search — backed by Open-Meteo's free /v1/search
  // endpoint (no API key, no signup). We proxy through /geocode
  // server-side so the request always succeeds regardless of
  // CORS / rate-limiting on the user agent.
  const locationSearchM = useDelayedMutation<
    { results: GeocodeResult[] },
    void
  >({
    mutationFn: async () => {
      const q = locationSearchDraft.trim();
      if (q.length < 2) return { results: [] };
      return api<{ results: GeocodeResult[] }>('/geocode', { query: { q } });
    },
    onSuccess: (res) => {
      setLocationSearchResults(res.results);
      if (res.results.length === 0) {
        setSaveResult({ kind: 'error', message: 'No matches. Try a different city or postal code.' });
        setTimeout(() => setSaveResult({ kind: 'idle', message: '' }), 3000);
      }
    },
    onError: () => {
      setLocationSearchResults([]);
    },
  }, 400);

  // Picking a result fills the lat/lng inputs but does NOT save
  // — the user reviews the values and clicks "Save location".
  // (Same pattern as the rest of Profile: explicit save.)
  function pickGeocodeResult(r: GeocodeResult) {
    setLatitudeDraft(r.latitude.toFixed(4));
    setLongitudeDraft(r.longitude.toFixed(4));
    setLocationSearchResults([]);
    setSaveResult({ kind: 'idle', message: '' });
  }

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
                    label="Wrist circumference"
                    storageKey="wristCm"
                    value={draft.wristCm ?? ''}
                    onChange={(v) => setDraftField('wristCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewWrist}
                  />
                  <FrameField
                    label="Ankle circumference"
                    storageKey="ankleCm"
                    value={draft.ankleCm ?? ''}
                    onChange={(v) => setDraftField('ankleCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewAnkle}
                  />
                  <FrameField
                    label="Forearm length"
                    storageKey="forearmLengthCm"
                    value={draft.forearmLengthCm ?? ''}
                    onChange={(v) => setDraftField('forearmLengthCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewForearm}
                  />
                  <FrameField
                    label="Neck circumference"
                    storageKey="neckCircCm"
                    value={draft.neckCircCm ?? ''}
                    onChange={(v) => setDraftField('neckCircCm', v)}
                    system={system}
                    step={inImperial ? 0.25 : 0.1}
                    required
                    present={!!previewNeck}
                  />
                  <FrameField
                    label="Shoulder width"
                    storageKey="shoulderCm"
                    value={draft.shoulderCm ?? ''}
                    onChange={(v) => setDraftField('shoulderCm', v)}
                    system={system}
                    step={inImperial ? 0.5 : 0.1}
                    present={!!numFromDraft('shoulderCm')}
                  />
                  <FrameField
                    label="Waist"
                    storageKey="waistCm"
                    value={draft.waistCm ?? ''}
                    onChange={(v) => setDraftField('waistCm', v)}
                    system={system}
                    step={inImperial ? 0.5 : 0.1}
                    present={!!numFromDraft('waistCm')}
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
                    <button
                      type="button"
                      onClick={() => setShowBodyfatPicker(true)}
                      className="text-[10px] font-mono mt-1 text-neon-cyan/80 hover:text-neon-cyan underline"
                    >
                      or log via method (DEXA / BIA / Calipers / Navy) →
                    </button>
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
                    onChange={(e) => setSexDraft((e.target.value || null) as 'MALE' | 'FEMALE' | null)}
                  >
                    <option value="">—</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
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
        <Panel variant="cyan" title="Class" id="class">
          <div className="text-[10px] font-mono text-ink-300 mb-3">
            Your class determines which skill tree you can unlock and which stats get the most XP from training.
            Classes are gated by your <span className="neon-text-cyan">archetype</span> — lean into what you are, not what you are not.
          </div>

          {/* Current class evolution. If picked, show the 3-stage
              progression with the current stage highlighted. Guarded
              against missing CLASS_EVOLUTION entries (which can
              happen when a new class is added to the api seed but
              not yet mirrored in web/lib/types.ts — used to blank
              the whole Profile page). */}
          {user.class && CLASS_EVOLUTION[user.class] && (
            <div className="mb-3 border border-neon-cyan/30 bg-neon-cyan/5 p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
                Your evolution
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {CLASS_EVOLUTION[user.class].stages.map((stageName, idx) => {
                  const stageNum = idx + 1;
                  const isCurrent = stageNum === user.classStage;
                  const isPast = user.classStage != null && stageNum < user.classStage;
                  const isFuture = user.classStage != null && stageNum > user.classStage;
                  const meta = CLASS_META[user.class!];
                  return (
                    <span key={stageName} className="flex items-center gap-1">
                      <span
                        className={classNames(
                          'px-2 py-1 text-[10px] font-mono tracking-widest uppercase border',
                          isCurrent
                            ? `border-neon-${meta.color}/80 text-neon-${meta.color} bg-neon-${meta.color}/10`
                            : isPast
                            ? 'border-ink-500/40 text-ink-300 bg-ink-500/5 line-through'
                            : isFuture
                            ? 'border-ink-700/40 text-ink-500'
                            : 'border-ink-500/40 text-ink-300',
                        )}
                        style={isCurrent ? { textShadow: `0 0 6px currentColor` } : undefined}
                        title={
                          stageNum === 1
                            ? 'Lv 1-9: starter form'
                            : stageNum === 2
                            ? 'Lv 10-24: promoted form'
                            : 'Lv 25+: final form'
                        }
                      >
                        {stageName}
                      </span>
                      {idx < 2 && (
                        <span className="text-ink-500 text-[10px]">→</span>
                      )}
                    </span>
                  );
                })}
              </div>
              {user.nextPromotion && (
                <div className="text-[10px] font-mono text-ink-400 mt-2">
                  Next promotion:{' '}
                  <span className={`neon-text-${CLASS_META[user.class].color}`}>
                    {CLASS_EVOLUTION[user.class].stages[user.nextPromotion.nextStage - 1]}
                  </span>{' '}
                  at <span className="text-ink-50">Lvl {user.nextPromotion.threshold}</span>
                </div>
              )}
            </div>
          )}
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
                      // Open the dedicated "spend a Soulstone to
                      // remove the lock" modal. The previous
                      // version prefilled the first eligible
                      // class into the class-change modal, which
                      // felt like the button was silently picking
                      // a class for the user.
                      setSoulstoneUnlockError(null);
                      setPendingSoulstoneUnlock(true);
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
              // Locked = disabled UNLESS the user has a soulstone to
              // spend (canUseSoulstone). The old logic disabled the
              // button even when the user had soulstones — the cached
              // user.classLock just hadn't refreshed yet, so the
              // click did nothing. Now we honor canUseSoulstone.
              const disabled = !eligible || (
                (user.classLock?.locked ?? false) &&
                !user.classLock?.canUseSoulstone
              );
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
                    <span className={`text-[9px] font-mono uppercase tracking-widest ${eligible && !user.classLock?.locked ? `neon-text-${m.color}` : 'text-ink-400'}`}>
                      {PRIMARY_ASPECT_LABEL[m.primary]}
                    </span>
                    <span className="text-[9px] text-ink-300">·</span>
                    <span className="text-[9px] font-mono text-ink-200">
                      {m.ability.tag}
                    </span>
                    <span className="text-[9px] text-ink-300">·</span>
                    <span
                      className={`text-[9px] font-mono tracking-widest ${
                        eligible && !user.classLock?.locked
                          ? m.energySystem === 'AEROBIC' ? 'neon-text-cyan'
                          : m.energySystem === 'ANAEROBIC' ? 'neon-text-orange'
                          : m.energySystem === 'POWER' ? 'neon-text-red'
                          : m.energySystem === 'INTENSITY' ? 'neon-text-magenta'
                          : m.energySystem === 'CONTROL' ? 'neon-text-lime'
                          : 'neon-text-periwinkle'
                          : 'text-ink-400'
                      }`}
                    >
                      {m.energySystem}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono mt-1 text-ink-200">
                    {m.tagline}
                  </div>
                  <div className="text-[9px] font-mono mt-0.5 text-ink-300">
                    {m.fitnessType}
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
                    {getClassDisplayName(pendingClass, 1)}
                  </span>
                  {' '}
                  <span className="text-ink-400">
                    ({CLASS_META[pendingClass].label} class)
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
                className="flex-1 btn-neon-magenta"
              >
                {user.class
                  ? user.classLock?.locked && user.classLock.canUseSoulstone
                    ? '💎 Use Soulstone to switch to ' + getClassDisplayName(pendingClass, 1)
                    : 'Switch to ' + getClassDisplayName(pendingClass, 1)
                  : 'Pick ' + getClassDisplayName(pendingClass, 1)}
              </button>
            </div>
          </Modal>
        )}

        {/* Dedicated confirmation for the "Use 1 Soulstone to change
            class" banner button. Distinct from the class-change modal
            above: this one just consumes a Soulstone and clears the
            lock — the user then picks a class normally. If they go
            straight to clicking a class tile instead, PATCH /me will
            accept the change because the lock is now off.

            Failsafe: if the api container is running pre-change code
            (no /users/me/unlock-class route → 404), we fall back to
            the regular class-change flow so the user isn't stuck.
            The banner button used to silently prefill a class, which
            is the bug this whole thing fixes; the failsafe is opt-in
            (a "Try via class tile" link) so it doesn't repeat that. */}
        {pendingSoulstoneUnlock && (
          <Modal
            open={true}
            onClose={() => {
              if (soulstoneUnlockBusy) return;
              setPendingSoulstoneUnlock(false);
              setSoulstoneUnlockError(null);
            }}
            title="💎 Use 1 Soulstone to change class?"
          >
            <div className="text-xs font-mono text-ink-200 space-y-3">
              <p>
                Spend 1 Soulstone to lift the class lock on{' '}
                <span className={`neon-text-${CLASS_META[user.class!].color}`}>
                  {CLASS_META[user.class!].label}
                </span>
                ?
              </p>
              <div className="border border-neon-magenta/40 bg-neon-magenta/5 p-3">
                <p className="neon-text-magenta mb-1">After confirm:</p>
                <ul className="text-ink-300 text-[10px] space-y-1 list-disc list-inside">
                  <li>The class lock is removed.</li>
                  <li>You can pick a new class on this page normally.</li>
                  <li>The new class will lock on (or after) your next birthday, just like a fresh pick.</li>
                  <li>Your Soulstone balance drops by 1.</li>
                </ul>
              </div>
              <p className="text-ink-300 text-[10px]">
                Soulstones only drop from raid victories. Make sure you want to spend one — the action is immediate.
              </p>
              {soulstoneUnlockError && (
                <div className="border border-red-500/60 bg-red-500/10 p-3 space-y-2">
                  <p className="text-red-300 text-[11px] font-bold">
                    ⚠ Could not spend Soulstone: {soulstoneUnlockError}
                  </p>
                  {soulstoneUnlockError.toLowerCase().includes('not found') ||
                  soulstoneUnlockError.toLowerCase().includes('route') ? (
                    <p className="text-[10px] text-ink-200">
                      The api container is missing <code className="text-red-300">POST /users/me/unlock-class</code>.
                      Rebuild + redeploy the api image, or use the fallback below.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      // Failsafe: api hasn't been redeployed with the
                      // new route. Open the regular class-change
                      // modal pre-filled with the first eligible
                      // class so the user can spend their Soulstone
                      // via PATCH /me (which DOES exist in the old
                      // code) instead of being stuck.
                      const firstEligible = CLASS_OPTIONS.find(
                        (c) => c !== user.class && isClassEligible(c, previewArchetype),
                      );
                      setPendingSoulstoneUnlock(false);
                      setSoulstoneUnlockError(null);
                      if (firstEligible) setPendingClass(firstEligible);
                    }}
                    className="text-[10px] font-mono px-2 py-1 border border-neon-magenta/60 text-neon-magenta bg-neon-magenta/5 hover:bg-neon-magenta/10"
                  >
                    Try via class tile (uses 1 Soulstone to switch)
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setPendingSoulstoneUnlock(false);
                  setSoulstoneUnlockError(null);
                }}
                disabled={soulstoneUnlockBusy}
                className="btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setSoulstoneUnlockBusy(true);
                  setSoulstoneUnlockError(null);
                  try {
                    await api('/users/me/unlock-class', { method: 'POST' });
                    setPendingSoulstoneUnlock(false);
                    await refresh();
                  } catch (e: any) {
                    console.error('soulstone unlock-class failed', e);
                    const msg =
                      e?.message ||
                      (e instanceof Error ? e.message : 'Failed to spend Soulstone') ||
                      'Unknown error';
                    setSoulstoneUnlockError(msg);
                  } finally {
                    setSoulstoneUnlockBusy(false);
                  }
                }}
                disabled={soulstoneUnlockBusy}
                className="flex-1 btn-neon-magenta"
              >
                {soulstoneUnlockBusy ? '…' : '💎 Use 1 Soulstone'}
              </button>
            </div>
          </Modal>
        )}

        {/* IDENTITY */}
        <Panel variant="cyan" title="Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <Row k="Callsign" v={user.username} />
            <Row k="Class" v={user.class ? CLASS_META[user.class].label : '—'} />
            <Row k="Level" v={String(user.level)} />
            <Row k="Total XP" v={String(user.xp)} />
            <Row k="Gold" v={String(user.gold)} />
            <Row k="Created" v={new Date(user.createdAt).toLocaleDateString()} />
            <Row k="Units" v={user.units === 'IMPERIAL' ? 'in / lb / fl oz' : 'cm / kg / ml'} />
          </div>

          {/* Timezone — used to render absolute timestamps in your local time. */}
          <div className="mt-4 border-t border-ink-500/30 pt-3">
            <label className="block">
              <div className="text-xs font-mono text-ink-100 mb-1">
                Timezone
              </div>
              <div className="flex items-stretch gap-2">
                <input
                  className="input-neon flex-1 text-xs"
                  value={timezoneDraft}
                  onChange={(e) => setTimezoneDraft(e.target.value)}
                  placeholder="e.g. America/New_York"
                  list="tz-list"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api('/users/me', {
                        method: 'PATCH',
                        body: { timezone: timezoneDraft || null },
                      });
                      // Refresh the auth context so the new timezone
                      // takes effect everywhere (relative date math,
                      // today() helpers, streak windows, etc.).
                      await refresh();
                      setTimezoneDraft(user?.timezone ?? '');
                      setSaveResult({ kind: 'saved', message: 'Timezone saved.' });
                      setTimeout(() => setSaveResult({ kind: 'idle', message: '' }), 3000);
                    } catch (e: any) {
                      setSaveResult({ kind: 'error', message: e?.message ?? 'Save failed' });
                    }
                  }}
                  disabled={!timezoneChanged}
                  className="px-3 h-9 text-[10px] font-mono uppercase tracking-widest border border-neon-cyan text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-cyan/5"
                >
                  Save
                </button>
              </div>
              <datalist id="tz-list">
                <option value="America/New_York" />
                <option value="America/Chicago" />
                <option value="America/Denver" />
                <option value="America/Los_Angeles" />
                <option value="America/Toronto" />
                <option value="Europe/London" />
                <option value="Europe/Paris" />
                <option value="Europe/Berlin" />
                <option value="Europe/Madrid" />
                <option value="Asia/Tokyo" />
                <option value="Asia/Singapore" />
                <option value="Australia/Sydney" />
                <option value="Pacific/Auckland" />
                <option value="UTC" />
              </datalist>
              <div className="text-[10px] font-mono text-ink-400 mt-1 leading-relaxed">
                IANA timezone name (e.g. <code className="text-ink-200">America/New_York</code>). Activities,
                achievements, and logs render absolute dates in this zone. Leave blank for UTC.
              </div>
            </label>
          </div>

          {/* Home location — drives the /forecast page weather lookup. */}
          <div className="mt-4 border-t border-ink-500/30 pt-3">
            <div className="text-xs font-mono text-ink-100 mb-1">
              Home location <span className="text-ink-400">(for /forecast)</span>
            </div>

            {/* Search-by-city-or-zip: hits Open-Meteo's free
                geocoding endpoint through our own proxy so we
                don't burn CORS / rate-limit budget on the user
                agent directly. Pick a result to populate the
                lat/lng inputs below. */}
            <div className="flex items-stretch gap-2 mb-2">
              <input
                className="input-neon flex-1 text-xs"
                type="search"
                value={locationSearchDraft}
                onChange={(e) => setLocationSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    locationSearchM.run(undefined);
                  }
                }}
                placeholder="Search city or postal code (e.g. Kennesaw, 30144)"
              />
              <button
                type="button"
                onClick={() => locationSearchM.run(undefined)}
                disabled={locationSearchDraft.trim().length < 2 || locationSearchM.isPending}
                className="px-3 text-[10px] font-mono uppercase tracking-widest border border-neon-cyan text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-cyan/5"
              >
                {locationSearchM.isPending ? '…' : 'Search'}
              </button>
            </div>
            {locationSearchResults.length > 0 && (
              <div className="border border-ink-500/30 max-h-44 overflow-y-auto mb-2">
                {locationSearchResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pickGeocodeResult(r)}
                    className="w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-neon-cyan/10 border-b border-ink-500/20 last:border-b-0"
                  >
                    <span className="text-ink-100">{r.name}</span>
                    {r.admin1 && <span className="text-ink-300">, {r.admin1}</span>}
                    {r.country && <span className="text-ink-400"> · {r.country}</span>}
                    <span className="text-ink-400 ml-2">{r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</span>
                  </button>
                ))}
              </div>
            )}
            {/* useDelayedMutation exposes `error`, not `isError` —
                the old `isError` check was always undefined, so
                geocoding failures produced zero user feedback. */}
            {locationSearchM.error != null && (
              <div className="text-[10px] font-mono neon-text-magenta mb-2">
                Search failed: {(locationSearchM.error as any)?.message ?? 'unknown'}
              </div>
            )}

            <div className="flex items-stretch gap-2">
              <input
                className="input-neon flex-1 text-xs"
                type="number"
                step="0.0001"
                value={latitudeDraft}
                onChange={(e) => setLatitudeDraft(e.target.value)}
                placeholder="Latitude (e.g. 34.02)"
              />
              <input
                className="input-neon flex-1 text-xs"
                type="number"
                step="0.0001"
                value={longitudeDraft}
                onChange={(e) => setLongitudeDraft(e.target.value)}
                placeholder="Longitude (e.g. -84.62)"
              />
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                type="button"
                onClick={async () => {
                  if (!('geolocation' in navigator)) {
                    setSaveResult({ kind: 'error', message: 'Browser geolocation unavailable.' });
                    return;
                  }
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setLatitudeDraft(pos.coords.latitude.toFixed(4));
                      setLongitudeDraft(pos.coords.longitude.toFixed(4));
                    },
                    (err) => {
                      setSaveResult({ kind: 'error', message: `Geolocation failed: ${err.message}` });
                    },
                    { timeout: 8000, enableHighAccuracy: false, maximumAge: 60_000 },
                  );
                }}
                className="text-[10px] font-mono uppercase tracking-widest border border-ink-500/40 text-ink-200 hover:border-neon-cyan hover:text-neon-cyan px-2 py-1"
              >
                Use device location
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api('/users/me', { method: 'PATCH', body: { latitude: null, longitude: null } });
                    await refresh();
                    setLatitudeDraft('');
                    setLongitudeDraft('');
                    setSaveResult({ kind: 'saved', message: 'Home location cleared. Forecast will use last outdoor workout GPS.' });
                    setTimeout(() => setSaveResult({ kind: 'idle', message: '' }), 4000);
                    qc.invalidateQueries({ queryKey: ['forecast'] });
                  } catch (e: any) {
                    setSaveResult({ kind: 'error', message: e?.message ?? 'Clear failed' });
                  }
                }}
                disabled={user?.latitude == null && user?.longitude == null}
                className="text-[10px] font-mono uppercase tracking-widest border border-ink-500/40 text-ink-200 hover:border-neon-magenta hover:text-neon-magenta px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              {latitudeDraft !== '' && longitudeDraft !== '' && Number.isFinite(locationLat) && Number.isFinite(locationLng) && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${locationLat}&mlon=${locationLng}#map=11/${locationLat}/${locationLng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono uppercase tracking-widest border border-ink-500/40 text-ink-200 hover:border-neon-cyan hover:text-neon-cyan px-2 py-1"
                >
                  View on map ↗
                </a>
              )}
              {/* Own Save button — the Frame save button is far
                  above and not visibly linked to this section. */}
              <button
                type="button"
                onClick={async () => {
                  if (!locationChanged || !locationValid) return;
                  try {
                    await api('/users/me', {
                      method: 'PATCH',
                      body: { latitude: locationLat, longitude: locationLng },
                    });
                    await refresh();
                    setSaveResult({ kind: 'saved', message: 'Home location saved.' });
                    setTimeout(() => setSaveResult({ kind: 'idle', message: '' }), 3000);
                    qc.invalidateQueries({ queryKey: ['forecast'] });
                  } catch (e: any) {
                    setSaveResult({ kind: 'error', message: e?.message ?? 'Save failed' });
                  }
                }}
                disabled={!locationChanged || !locationValid}
                className="px-3 h-9 text-[10px] font-mono uppercase tracking-widest border border-neon-cyan text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-cyan/5"
              >
                Save location
              </button>
            </div>
            {!locationValid && (latitudeDraft !== '' || longitudeDraft !== '') && (
              <div className="text-[10px] font-mono neon-text-magenta mt-1">
                Lat must be -90..90 and lng -180..180 — or leave both blank to use workout GPS.
              </div>
            )}
            <div className="text-[10px] font-mono text-ink-400 mt-1 leading-relaxed">
              Decimal degrees (WGS84). Pick a search result above, paste manually, or use your device's location.
            </div>
          </div>

          <div className="mt-4 text-[10px] text-ink-400 font-mono leading-relaxed border-t border-neon-magenta/20 pt-3">
            // change units in <Link to="/settings" className="neon-text-cyan hover:underline">Settings → Display</Link> · account actions (password, 2FA) coming in v0.5
          </div>
        </Panel>
      </div>

      <BodyfatMethodPicker
        open={showBodyfatPicker}
        onClose={() => setShowBodyfatPicker(false)}
        initialSex={sexDraft ?? user.sex ?? null}
        onSubmit={async ({ bfPct, source }) => {
          // Write the Measurement row with the chosen source so the
          // morning report's confidence weighting applies. Then sync
          // the User.bodyFatPct so the dashboard's snapshot reflects
          // the latest reading without waiting for a /me refetch.
          await api('/measurements', {
            method: 'POST',
            body: { metric: 'BODY_FAT_PCT', value: bfPct, source },
          });
          await api('/users/me', {
            method: 'PATCH',
            body: { bodyFatPct: bfPct },
          });
          qc.invalidateQueries({ queryKey: ['measurements'] });
          qc.invalidateQueries({ queryKey: ['metric-history', 'BODY_FAT_PCT'] });
          await refresh();
        }}
      />
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
