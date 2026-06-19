import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { CLASS_META, type ClassName } from '@/lib/types';
import { classNames } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { getFrameSize, frameDescription } from '@/lib/frame';

const CLASS_OPTIONS: ClassName[] = ['BODYBUILDER', 'POWERLIFTER', 'CALISTHENIST', 'ENDURANCE', 'HYBRID'];

// Casey Butt–calibrated preview formulas (must mirror api/src/lib/geneticMax.ts)
function previewMax(metric: string, wristCm: number | null, ankleCm: number | null, heightCm: number | null): number | null {
  const w = wristCm;
  const a = ankleCm;
  const h = heightCm;
  switch (metric) {
    case 'BICEP':      return w ? w * 2.7 : (h ? h * 0.228 : null);
    case 'FOREARM':    return w ? w * 2.3 : (h ? h * 0.195 : null);
    case 'CHEST':      return w ? w * 7.5 : (h ? h * 0.634 : null);
    case 'SHOULDER':   return w ? w * 8.5 : (h ? h * 0.718 : null);
    case 'NECK':       return w ? w * 2.9 : (h ? h * 0.245 : null);
    case 'QUAD':       return a ? a * 2.85 : (h ? h * 0.352 : null);
    case 'CALF':       return a ? a * 1.9 : (h ? h * 0.234 : null);
    case 'WAIST':      return h ? h * 0.161 : (w ? w * 1.9 : null);
    case 'BENCH_1RM':  return w ? w * 1.0 : null; // bench ≈ 1x bodyweight proxy (no weight)
    default: return null;
  }
}

const PREVIEW_METRICS = [
  { key: 'BICEP', label: 'Bicep', unit: 'cm' },
  { key: 'CHEST', label: 'Chest', unit: 'cm' },
  { key: 'SHOULDER', label: 'Shoulder', unit: 'cm' },
  { key: 'QUAD', label: 'Quad', unit: 'cm' },
] as const;

function storageUnitForKey(key: string): string {
  if (key === 'heightCm') return 'cm';
  if (key === 'wristCm') return 'cm';
  if (key === 'ankleCm') return 'cm';
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
  const [saveResult, setSaveResult] = useState<{ kind: 'idle' | 'saved' | 'recomputed' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });

  const NUMERIC_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'weightKg', 'bodyFatPct'] as const;
  const FRAME_KEYS = ['heightCm', 'wristCm', 'ankleCm', 'weightKg', 'bodyFatPct'] as const;

  // Initialize draft + class + birthdate from user on mount/unit change
  useEffect(() => {
    if (!user) return;
    const next: Record<string, string> = {};
    for (const key of NUMERIC_KEYS) {
      const v = (user as any)[key] as number | null | undefined;
      if (v == null) {
        next[key] = '';
      } else if (inImperial) {
        const converted = convertForDisplay(v, storageUnitForKey(key), 'IMPERIAL');
        next[key] = String(Math.round(converted.value * 10) / 10);
      } else {
        next[key] = String(v);
      }
    }
    setDraft(next);
    if (classChoice === null) setClassChoice(user.class);
    if (birthDate === null) setBirthDate(user.birthDate);
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
  const anythingChanged = frameChanged || classChanged || birthChanged;

  const saveM = useDelayedMutation({
    mutationFn: async () => {
      const body: any = {};
      if (classChoice) body.class = classChoice;
      for (const key of NUMERIC_KEYS) {
        const raw = draft[key];
        if (raw === '' || raw == null) {
          body[key] = null;
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        if (inImperial) {
          const stored = convertForStorage(n, displayUnit(storageUnitForKey(key), 'IMPERIAL'), 'IMPERIAL');
          body[key] = stored.value;
        } else {
          body[key] = n;
        }
      }
      if (birthChanged) body.birthDate = birthDate;
      await api('/users/me', { method: 'PATCH', body });
      // Auto-recompute genetic maxes if frame data changed
      if (frameChanged) {
        const recomputeRes = await api<{ changes: Array<{ metric: string; from: number | null; to: number }> }>(
          '/genetic-max/recompute',
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
    onError: (e) => setSaveResult({ kind: 'error', message: e instanceof Error ? e.message : 'Save failed' }),
  }, 1500);

  if (!user) return null;

  const missing: string[] = [];
  if (!previewHeight) missing.push('height');
  if (!previewWrist) missing.push('wrist');
  if (!previewAnkle) missing.push('ankle');
  const frameIncomplete = missing.length > 0;
  const previewValues = PREVIEW_METRICS.map((m) => ({
    ...m,
    value: previewMax(m.key, previewWrist, previewAnkle, previewHeight),
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
            {/* Frame size + summary */}
            <div className="text-center border-b border-ink-500/30 pb-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">Size</div>
              <div
                className={`font-display text-5xl tracking-[0.3em] mt-1 ${
                  previewFrame === 'SMALL' ? 'neon-text-magenta' :
                  previewFrame === 'MEDIUM' ? 'neon-text-cyan' :
                  previewFrame === 'LARGE' ? 'neon-text-amber' :
                  'text-ink-400'
                }`}
                style={{ textShadow: previewFrame !== 'UNKNOWN' ? '0 0 12px currentColor' : undefined }}
              >
                {previewFrame}
              </div>
              <div className="text-[10px] text-ink-300 font-mono mt-1 italic">
                {frameDescription(previewFrame)}
              </div>
            </div>

            {/* Frame inputs */}
            <div className="grid grid-cols-3 gap-3">
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

            {/* Body composition */}
            <div className="border-t border-ink-500/30 pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
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
                <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
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

            {/* Save button + feedback */}
            <div className="border-t border-ink-500/30 pt-3 flex items-center gap-3">
              <NeonButton
                onClick={() => saveM.run()}
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

        {/* CLASS */}
        <Panel variant="lime" title="Class">
          <div className="text-[10px] font-mono text-ink-300 mb-3">
            Your class determines which skill tree you can unlock and which stats get the most XP from training.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CLASS_OPTIONS.map((c) => {
              const m = CLASS_META[c];
              const selected = (classChoice ?? user.class) === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClassChoice(c)}
                  className={classNames(
                    'p-3 border-2 text-left transition-all',
                    selected
                      ? `border-neon-${m.color}/80 bg-neon-${m.color}/10`
                      : 'border-ink-500/40 hover:border-ink-300'
                  )}
                >
                  <div className={`font-display tracking-wider text-sm ${selected ? `neon-text-${m.color}` : 'text-ink-200'}`}>
                    {m.label}
                  </div>
                  <div className="text-[10px] text-ink-300 font-mono mt-1">{m.tagline}</div>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* IDENTITY */}
        <Panel variant="magenta" title="Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <Row k="Callsign" v={user.username} />
            <Row k="Email" v={user.email} />
            <Row k="Class" v={user.class ? CLASS_META[user.class].label : '—'} />
            <Row k="Level" v={String(user.level)} />
            <Row k="Total XP" v={String(user.xp)} />
            <Row k="Gold" v={String(user.gold)} />
            <Row k="Created" v={user.birthDate ? new Date(user.birthDate).toLocaleDateString() : '—'} />
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
  required,
  present,
}: {
  label: string;
  storageKey: string;
  value: string;
  onChange: (v: string) => void;
  system: UnitSystem;
  step: number;
  required: boolean;
  present: boolean;
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-ink-500/20 py-1.5">
      <span className="text-ink-300 text-[10px] uppercase tracking-widest">{k}</span>
      <span className="neon-text-cyan text-xs font-mono">{v}</span>
    </div>
  );
}
