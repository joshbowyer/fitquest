import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { classNames } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import {
  computeBodyfat,
  methodToMeasurementSource,
  type BodyfatMethod,
  type BodyfatResult,
  type Sex,
} from '@/lib/bodyfat';
import { convertForDisplay, displayUnit, displayValue, type UnitSystem } from '@/lib/units';

/**
 * Bodyfat method picker — modal that lets the user enter a body-fat
 * reading via the method they actually used, instead of forcing
 * "type the percentage" everywhere. Four methods:
 *
 *   - DEXA: gold-standard direct % from a scan report.
 *   - BIA: bioelectrical impedance (scale / handheld) — direct %.
 *   - CALIPERS (3-site Jackson-Pollock): 3 mm skinfold readings
 *     (chest/abdomen/thigh for men, triceps/suprailium/thigh for
 *     women) → %BF via ACSM Siri equation.
 *   - NAVY: tape measure only (waist + neck for men, + hip for
 *     women) → %BF via Hodgdon-Beckett.
 *
 * The picker is self-contained: it accepts the user's existing
 * sex + height from auth context (so the formulas have what they
 * need without extra fields), shows method-specific inputs, and
 * calls onSubmit with the computed %BF + the MeasurementSource enum
 * value (so the api can store the right confidence tag for the
 * morning report).
 */
type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the computed %BF + the MeasurementSource to store. */
  onSubmit: (result: BodyfatResult & { source: string }) => void | Promise<void>;
  /** Optional initial sex override (used by Profile picker). */
  initialSex?: Sex | null;
  /** Optional initial age (only used for CALIPERS — pulled from auth). */
};

const METHOD_LABELS: Record<BodyfatMethod, { title: string; hint: string }> = {
  DEXA: {
    title: 'DEXA scan',
    hint: 'Gold standard. Enter the body-fat % from the most recent DEXA scan (within 90 days).',
  },
  BIA: {
    title: 'BIA (scale or handheld)',
    hint: 'Bioelectrical impedance. Best taken fasted, same time of day each week for consistency.',
  },
  CALIPERS_3: {
    title: 'Caliper · 3-site (Jackson-Pollock)',
    hint: 'Skinfold thickness in millimetres. Measure in the morning, the day after fasting, ideally before training — water weight can shift the reading 2-3%.',
  },
  NAVY: {
    title: 'Navy tape method',
    hint: 'Tape measure only. Men: waist − neck. Women: waist + hip − neck. The 2nd-derivative of the log10 formula amplifies small errors — measure carefully.',
  },
};

export function BodyfatMethodPicker({ open, onClose, onSubmit, initialSex }: Props) {
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';
  const userSex: Sex = (initialSex ?? user?.sex ?? 'MALE') as Sex;

  const [method, setMethod] = useState<BodyfatMethod>('DEXA');
  // DEXA / BIA: single number input.
  const [bfDirect, setBfDirect] = useState('');
  // Caliper 3-site: 3 mm inputs (label text swaps based on sex).
  const [sk1, setSk1] = useState('');
  const [sk2, setSk2] = useState('');
  const [sk3, setSk3] = useState('');
  // Navy: circumferences in user units (cm/in), converted to cm
  // before passing to the formula.
  const [navyWaist, setNavyWaist] = useState('');
  const [navyNeck, setNavyNeck] = useState('');
  const [navyHip, setNavyHip] = useState('');
  const [navyHeight, setNavyHeight] = useState(
    user?.heightCm ? String(user.heightCm) : '',
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Age in whole years, derived from User.birthDate. Required for
  // the JP3 formula. Falls back to 30 if no birthDate — most adult
  // users land within ±5 of that, and the picker shows a hint if
  // we have to use the default.
  const ageYears = useMemo(() => {
    if (!user?.birthDate) return 30;
    const ms = Date.now() - new Date(user.birthDate).getTime();
    return Math.max(0, Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)));
  }, [user?.birthDate]);

  // Live preview of the computed %BF as the user types. Lets them
  // see the result update without clicking a "compute" button.
  const preview = useMemo<{ bfPct: number | null; error: string | null }>(() => {
    try {
      if (method === 'DEXA' || method === 'BIA') {
        const v = Number(bfDirect);
        if (!Number.isFinite(v) || v <= 0) return { bfPct: null, error: null };
        const r = computeBodyfat({ method, bfPct: v });
        return { bfPct: r.bfPct, error: null };
      }
      if (method === 'CALIPERS_3') {
        const a = Number(sk1), b = Number(sk2), c = Number(sk3);
        if (![a, b, c].every((n) => Number.isFinite(n) && n > 0)) {
          return { bfPct: null, error: null };
        }
        const r = computeBodyfat({
          method: 'CALIPERS_3',
          sex: userSex,
          skinfoldsMm: [a, b, c],
          ageYears,
        });
        return { bfPct: r.bfPct, error: null };
      }
      // NAVY
      const w = Number(navyWaist), n = Number(navyNeck), h = Number(navyHeight);
      if (![w, n, h].every((v) => Number.isFinite(v) && v > 0)) {
        return { bfPct: null, error: null };
      }
      const hip = userSex === 'FEMALE' ? Number(navyHip) : undefined;
      if (userSex === 'FEMALE' && (!Number.isFinite(hip) || hip! <= 0)) {
        return { bfPct: null, error: null };
      }
      // Convert to cm before formula.
      const waistCm = convertToCm(w, system, 'cm');
      const neckCm = convertToCm(n, system, 'cm');
      const hipCm = hip != null ? convertToCm(hip, system, 'cm') : undefined;
      const heightCm = convertToCm(h, system, 'cm');
      const r = computeBodyfat({
        method: 'NAVY',
        sex: userSex,
        waistCm,
        neckCm,
        hipCm,
        heightCm,
      });
      if (Number.isNaN(r.bfPct)) {
        return {
          bfPct: null,
          error: userSex === 'FEMALE'
            ? 'waist + hip must be greater than neck'
            : 'waist must be greater than neck',
        };
      }
      return { bfPct: r.bfPct, error: null };
    } catch (err: any) {
      return { bfPct: null, error: err?.message ?? 'Could not compute' };
    }
  }, [method, bfDirect, sk1, sk2, sk3, navyWaist, navyNeck, navyHip, navyHeight, userSex, ageYears, system]);

  const canSubmit = preview.bfPct != null && preview.error == null && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        method,
        bfPct: preview.bfPct!,
        source: methodToMeasurementSource(method),
      });
      // Reset form on success — common pattern so reopening starts
      // fresh. (The parent owns visibility via `open`.)
      setBfDirect(''); setSk1(''); setSk2(''); setSk3('');
      setNavyWaist(''); setNavyNeck(''); setNavyHip('');
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save');
    } finally {
      setSubmitting(false);
    }
  }

  // Site labels for CALIPERS_3 swap with sex.
  const maleSiteLabels = ['Chest', 'Abdomen', 'Thigh'];
  const femaleSiteLabels = ['Triceps', 'Suprailium', 'Thigh'];
  const siteLabels = userSex === 'FEMALE' ? femaleSiteLabels : maleSiteLabels;

  return (
    <Modal open={open} onClose={onClose} title="Log Body Fat" width="max-w-lg">
      <div className="space-y-4">
        {/* Method picker — 4 radio chips in a 2x2 grid */}
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(METHOD_LABELS) as BodyfatMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={classNames(
                'text-left p-3 border transition-all',
                method === m
                  ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                  : 'border-ink-500/40 text-ink-200 hover:border-neon-cyan/40',
              )}
            >
              <div className="font-display text-xs tracking-widest uppercase">
                {METHOD_LABELS[m].title}
              </div>
            </button>
          ))}
        </div>

        <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
          {METHOD_LABELS[method].hint}
        </div>

        {/* Method-specific inputs */}
        {method === 'DEXA' || method === 'BIA' ? (
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80 block mb-1">
              Body Fat (%)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={bfDirect}
              onChange={(e) => setBfDirect(e.target.value)}
              placeholder="e.g. 14.5"
              className="input-neon w-full"
            />
          </div>
        ) : method === 'CALIPERS_3' ? (
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
              3 skinfold sites (mm)
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[sk1, sk2, sk3].map((v, i) => (
                <div key={i}>
                  <label className="text-[10px] font-mono text-ink-300 block mb-1">
                    {siteLabels[i]}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={v}
                    onChange={(e) => {
                      const setter = [setSk1, setSk2, setSk3][i]!;
                      setter(e.target.value);
                    }}
                    placeholder="mm"
                    className="input-neon w-full"
                  />
                </div>
              ))}
            </div>
            {!user?.birthDate && (
              <div className="text-[10px] font-mono text-ink-400 italic">
                Using default age 30 — set your birth date in Profile for a more accurate result.
              </div>
            )}
            <div className="text-[10px] font-mono text-ink-400">
              Sites for {userSex === 'FEMALE' ? 'women' : 'men'}:
              {' '}
              {userSex === 'FEMALE'
                ? 'triceps + suprailium + thigh (vertical fold, midway between sides)'
                : 'chest (between nipple + armpit fold) + abdomen (2cm right of navel) + thigh (top, vertical)'}
              .
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
              Tape measurements ({displayUnit('cm', system)})
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-mono text-ink-300 block mb-1">
                  Waist
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={system === 'IMPERIAL' ? 0.25 : 0.1}
                  value={navyWaist}
                  onChange={(e) => setNavyWaist(e.target.value)}
                  placeholder="navel"
                  className="input-neon w-full"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-ink-300 block mb-1">
                  Neck
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={system === 'IMPERIAL' ? 0.25 : 0.1}
                  value={navyNeck}
                  onChange={(e) => setNavyNeck(e.target.value)}
                  placeholder="below larynx"
                  className="input-neon w-full"
                />
              </div>
              {userSex === 'FEMALE' && (
                <div>
                  <label className="text-[10px] font-mono text-ink-300 block mb-1">
                    Hip
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step={system === 'IMPERIAL' ? 0.25 : 0.1}
                    value={navyHip}
                    onChange={(e) => setNavyHip(e.target.value)}
                    placeholder="widest point"
                    className="input-neon w-full"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] font-mono text-ink-300 block mb-1">
                  Height
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={system === 'IMPERIAL' ? 0.5 : 1}
                  value={navyHeight}
                  onChange={(e) => setNavyHeight(e.target.value)}
                  placeholder="from profile"
                  className="input-neon w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Preview result + Submit */}
        <div className="border-t border-ink-500/30 pt-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">
                Computed body fat
              </div>
              <div className="font-display text-3xl neon-text-cyan mt-1">
                {preview.bfPct != null ? preview.bfPct.toFixed(1) : '—'}
                <span className="text-base text-ink-300 ml-1">%</span>
              </div>
              {preview.error && (
                <div className="text-[10px] font-mono mt-1" style={{ color: '#ff2bd6' }}>
                  {preview.error}
                </div>
              )}
            </div>
            <NeonButton
              variant="cyan"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={submitting}
              icon="⚡"
              loadingText="Logging…"
            >
              Log
            </NeonButton>
          </div>
          {error && (
            <div className="text-[10px] font-mono mt-1" style={{ color: '#ff2bd6' }}>
              {error}
            </div>
          )}
          <div className="text-[9px] font-mono text-ink-500 mt-2">
            Source: <span className="text-ink-300">{preview.bfPct != null ? methodToMeasurementSource(method) : '—'}</span>
            {' '}· stored as a BODY_FAT_PCT Measurement so the morning report's confidence weighting applies.
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Convert a value (entered in the user's preferred system) to cm
 *  for the Navy formula. Imperial users see inches; we convert. */
function convertToCm(value: number, system: UnitSystem, _unit: string): number {
  if (system === 'IMPERIAL') return value * 2.54;
  return value;
}

// Avoid an unused-import warning if displayUnit / displayValue end up unused.
void displayUnit; void displayValue;