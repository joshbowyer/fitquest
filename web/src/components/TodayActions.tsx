import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';
import { ActionTile, QuickActionGrid } from './QuickActionGrid';
import { WorkoutLogger } from './WorkoutLogger';
import { QuickLogModal as CheckInsQuickLogModal } from './CheckInsPanel';
import { useAuth } from '@/lib/auth';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames, formatRelative } from '@/lib/format';
import { convertForDisplay, convertForStorage, displayUnit, type UnitSystem } from '@/lib/units';
import { getLocalHour, localTodayStartUtc } from '@/lib/timezone';
import { type MealEntry } from '@/lib/types';

/**
 * Window event the parent page dispatches when a non-tile UI
 * element (e.g. the WORKOUT daily row) wants to open the Activity
 * log modal. Keeps the openModal state inside TodayActions without
 * forcing the parent to thread props down.
 */
export const OPEN_ACTIVITY_EVENT = 'fitquest:open-activity';

/**
 * /today action grid + modals. Each tile opens a focused log modal
 * for its category. Designed for one-tap logging from the
 * dashboard.
 *
 * Tile list:
 *  - Water       inline-form (kept in the parent Today page; passed
 *                as a slot so the parent can render it however it wants)
 *  - Food        → FoodLogModal: search OFF/USDA + saved-foods + manual
 *  - Supplements → SupplementLogModal: pick from UserTrackedItem
 *  - Probiotics  → SupplementLogModal with PROBIOTIC filter
 *  - Electrolytes→ SubstanceLogModal with category=ELECTROLYTE
 *  - Caffeine    → SubstanceLogModal with category=CAFFEINE
 *  - Alcohol     → SubstanceLogModal with category=ALCOHOL
 *  - Nicotine    → SubstanceLogModal with category=NICOTINE
 *  - Activity    → WorkoutLogger (the existing reusable component)
 *  - Prayer      → PrayerLogModal
 *  - Check-ins   → CheckIns QuickLogModal (existing in CheckInsPanel)
 *
 * Each modal is wrapped in its own <Modal> so the layout stays
 * consistent. They share a `useDelayedMutation` to disable the
 * tile + flash a green border on success.
 */

type SubstancesResponse = { items: Array<{ id: string; category: string; form: string; amount: number | null; unit: string | null; context: string | null; loggedAt: string }> };
type MeasurementsResponse = { items: Array<{ id: string; metric: string; value: number; recordedAt: string }> };
type SavedFoodDto = {
  id: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  useCount: number;
  lastUsedAt: string | null;
};
type FoodSearchHit = {
  source: 'OFF' | 'USDA' | 'MANUAL';
  sourceId: string;
  name: string;
  brand: string | null;
  servingSizeG: number | null;
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

type TrackedItem = {
  id: string;
  name: string;
  category: 'VITAMIN' | 'MINERAL' | 'FATTY_ACID' | 'PROBIOTIC' | 'HERB' | 'AMINO_ACID' | 'OTHER';
  defaultDose: number;
  doseUnit: string;
  /**
   * Today log inline on the tracked item (returned by GET /supplements/tracked
   * so the UI renders in one round-trip). null = not taken yet today.
   */
  today: {
    logId: string;
    dose: number;
    doseUnit: string;
    checkedAt: string;
  } | null;
};


const PRAYER_LABELS: Record<string, string> = {
  ROSARY: 'Rosary',
  MASS: 'Mass',
  SCRIPTURE: 'Scripture Reading',
  CONTEMPLATION: 'Contemplation',
  LITURGY_HOURS: 'Liturgy of the Hours',
  CONFESSION: 'Confession',
  OTHER: 'Other Prayer',
};

const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACK: 'Snack',
};

/**
 * Canonical forms per substance category. Shown alongside the
 * user's recently-logged forms so the picker isn't empty on first
 * use. User can still type a free-form value at the bottom for
 * anything not listed.
 *
 * Keep these short — long lists overwhelm the modal. Add a form
 * here when a category becomes commonly logged but the user has
 * never tried it.
 */
const CANONICAL_FORMS: Record<string, string[]> = {
  // Macro-level only. Brand-specific forms (Liquid IV vs LMNT, etc.)
  // collapsed into "electrolyte packet" so the picker stays scannable.
  // If the user logs something we don't list, the form string still
  // gets recorded verbatim so we can grow the macro list over time
  // from real usage data.
  CAFFEINE: [
    'coffee', 'tea', 'yerba mate', 'soda', 'pre-workout', 'energy drink',
  ],
  ALCOHOL: [
    'wine', 'beer', 'liquor', 'mead', 'cocktail',
  ],
  NICOTINE: [
    'cigarette', 'cigar', 'pipe tobacco', 'nicotine pouch', 'hookah',
    'dip', 'vape', 'nicotine gum',
  ],
  ELECTROLYTE: [
    'electrolyte packet', 'sports drink', 'sole water', 'coconut water',
    'mineral water',
  ],
};

function inferMealType(userTz: string | null): MealType {
  const h = getLocalHour(new Date(), userTz);
  if (h < 11) return 'BREAKFAST';
  if (h < 15) return 'LUNCH';
  if (h < 21) return 'DINNER';
  return 'SNACK';
}

export function TodayActions() {
  const qc = useQueryClient();
  const [openModal, setOpenModal] = useState<null | 'food' | 'supplements' | 'probiotics' | 'electrolytes' | 'caffeine' | 'alcohol' | 'nicotine' | 'activity' | 'prayer' | 'checkIns' | 'weighIn'>(null);
  const [prayerType, setPrayerType] = useState<keyof typeof PRAYER_LABELS | null>(null);

  // Listen for the global "open Activity modal" event so other
  // surfaces (e.g. the WORKOUT daily row, the wall-mode shell) can
  // dispatch a programmatic trigger without prop-drilling.
  useEffect(() => {
    const handler = () => setOpenModal('activity');
    window.addEventListener(OPEN_ACTIVITY_EVENT, handler);
    return () => window.removeEventListener(OPEN_ACTIVITY_EVENT, handler);
  }, []);

  function close() {
    setOpenModal(null);
    setPrayerType(null);
    // Invalidate any queries that may have changed so the tile
    // summaries refresh next render.
    qc.invalidateQueries({ queryKey: ['today'] });
    qc.invalidateQueries({ queryKey: ['meals', 'today'] });
    qc.invalidateQueries({ queryKey: ['substances'] });
    qc.invalidateQueries({ queryKey: ['supplements'] });
    qc.invalidateQueries({ queryKey: ['measurements'] });
  }

  return (
    <>
      <QuickActionGrid>
        <WaterTile />
        <WeighInTile onOpen={() => setOpenModal('weighIn')} />
        <ActionTile
          glyph="◉"
          label="Food"
          accent="cyan"
          onClick={() => setOpenModal('food')}
          summary={<FoodSummary />}
        />
        <ActionTile
          glyph="℘"
          label="Supplements"
          accent="amber"
          onClick={() => setOpenModal('supplements')}
          summary={<SupplementSummary category={null} />}
        />
        <ActionTile
          glyph="⌬"
          label="Probiotics"
          accent="lime"
          onClick={() => setOpenModal('probiotics')}
          summary={<SupplementSummary category="PROBIOTIC" />}
        />
        <ActionTile
          glyph="⚡"
          label="Electrolytes"
          accent="cyan"
          onClick={() => setOpenModal('electrolytes')}
          summary={<SubstanceSummary category="ELECTROLYTE" days={1} />}
        />
        <ActionTile
          glyph="☕"
          label="Caffeine"
          accent="amber"
          onClick={() => setOpenModal('caffeine')}
          summary={<SubstanceSummary category="CAFFEINE" days={1} />}
        />
        <ActionTile
          glyph="🍷"
          label="Alcohol"
          accent="magenta"
          onClick={() => setOpenModal('alcohol')}
          summary={<SubstanceSummary category="ALCOHOL" days={7} />}
        />
        <ActionTile
          glyph="🚬"
          label="Nicotine"
          accent="magenta"
          onClick={() => setOpenModal('nicotine')}
          summary={<SubstanceSummary category="NICOTINE" days={1} />}
        />
        <ActionTile
          glyph="⚔"
          label="Activity"
          accent="cyan"
          onClick={() => setOpenModal('activity')}
          summary={<ActivitySummary />}
        />
        <ActionTile
          glyph="✝"
          label="Prayer"
          accent="violet"
          onClick={() => setOpenModal('prayer')}
          summary={<PrayerSummary />}
        />
      </QuickActionGrid>

      {openModal === 'food' && (
        <FoodLogModal open onClose={close} />
      )}
      {openModal === 'supplements' && (
        <SupplementLogModal open onClose={close} category={null} />
      )}
      {openModal === 'probiotics' && (
        <SupplementLogModal open onClose={close} category="PROBIOTIC" />
      )}
      {openModal === 'electrolytes' && (
        <SubstanceLogModal open onClose={close} category="ELECTROLYTE" days={1} label="Electrolyte" />
      )}
      {openModal === 'caffeine' && (
        <SubstanceLogModal open onClose={close} category="CAFFEINE" days={1} label="Caffeine" />
      )}
      {openModal === 'alcohol' && (
        <SubstanceLogModal open onClose={close} category="ALCOHOL" days={7} label="Alcohol" />
      )}
      {openModal === 'nicotine' && (
        <SubstanceLogModal open onClose={close} category="NICOTINE" days={1} label="Nicotine" />
      )}
      {openModal === 'activity' && (
        <WorkoutLoggerModal open onClose={close} />
      )}
      {openModal === 'prayer' && !prayerType && (
        <PrayerPickerModal open onClose={close} onPick={setPrayerType} />
      )}
      {openModal === 'prayer' && prayerType && (
        <PrayerLogModal open onClose={close} prayerType={prayerType} onSwitch={() => setPrayerType(null)} />
      )}
      {openModal === 'weighIn' && (
        <WeighInModal open onClose={close} />
      )}
    </>
  );
}

/* ============================================================
 * Tile summaries (small queries that run in the background so
 * each tile can show its current state without opening the modal)
 * ============================================================ */

function WaterTile() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const q = useQuery({
    queryKey: ['today', 'water'],
    queryFn: () => api<MeasurementsResponse>('/measurements?metric=WATER_ML&limit=200'),
    refetchInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [logErr, setLogErr] = useState<string | null>(null);
  const system: UnitSystem = (user?.units ?? 'METRIC') as UnitSystem;
  const today = localTodayStartUtc(userTz);
  let totalMl = 0;
  for (const m of q.data?.items ?? []) {
    if (new Date(m.recordedAt) >= today) totalMl += m.value;
  }
  const targetMl = user?.targets?.waterGoalMl ?? 2500;
  const pct = Math.min(100, Math.round((totalMl / targetMl) * 100));
  // Display in the user's preferred unit. Storage stays in ml.
  const totalDisp = convertForDisplay(totalMl, 'ml', system);
  const targetDisp = convertForDisplay(targetMl, 'ml', system);
  // Presets match the Nutrition tab so 8 fl oz logs as 8 fl oz,
  // not 8.5 (which is what 250ml rounds to).
  const presets =
    system === 'IMPERIAL'
      ? [
          { ml: 237, label: '+8 oz',   title: 'Small glass (~8 fl oz / 237 ml)' },
          { ml: 355, label: '+12 oz',  title: 'Tall glass / can (~12 fl oz / 355 ml)' },
          { ml: 473, label: '+16 oz',  title: 'Large cup / bottle (~16 fl oz / 473 ml)' },
          { ml: 710, label: '+24 oz',  title: 'Big bottle (~24 fl oz / 710 ml)' },
        ]
      : [
          { ml: 200, label: '+200', title: 'Small cup (~200 ml)' },
          { ml: 250, label: '+250', title: 'Standard glass (~250 ml)' },
          { ml: 350, label: '+350', title: 'Tall glass / can (~350 ml)' },
          { ml: 500, label: '+500', title: 'Bottle (~500 ml)' },
          { ml: 750, label: '+750', title: 'Large bottle (~750 ml)' },
        ];
  const summaryStr = `${totalDisp.value.toFixed(0)} ${totalDisp.unit} · ${pct}%`;
  const logM = useMutation({
    mutationFn: (ml: number) =>
      api<{ id: string }>('/measurements', {
        method: 'POST',
        body: { metric: 'WATER_ML', value: ml, unit: 'ml', source: 'MANUAL' },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['today', 'water'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'water', 'today'] });
      setOpen(false);
      setValue('');
      setLogErr(null);
    },
    onError: (e: any) => setLogErr(e?.message ?? 'Log failed'),
  });
  return (
    <>
      <ActionTile
        glyph="💧"
        label="Water"
        accent="cyan"
        onClick={() => setOpen(true)}
        summary={<span className="text-ink-100">{summaryStr}</span>}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Log water" width="max-w-sm">
        <div className="space-y-3">
          {logErr && (
            <div className="text-[10px] font-mono text-rose-300 border border-rose-500/40 bg-rose-500/10 px-2 py-1 rounded">
              {logErr}
            </div>
          )}
          {/* Progress: current total vs goal, with the same color
              ladder DailyTotalsBar uses. Keeps the user oriented
              before they tap a preset. */}
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-mono uppercase text-ink-400 tracking-widest">
                Today
              </span>
              <span className="text-xs font-mono text-ink-300">
                {totalDisp.value.toFixed(0)} {totalDisp.unit}
                <span className="text-ink-500"> / {targetDisp.value.toFixed(0)} {targetDisp.unit}</span>
              </span>
            </div>
            <div className="h-1.5 bg-slate-800 border border-ink-500/30 overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background:
                    pct >= 100
                      ? '#9bff5c'
                      : pct >= 60
                      ? '#5ec5e8'
                      : '#3aa0c8',
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.ml}
                type="button"
                disabled={logM.isPending}
                onClick={() => logM.mutate(p.ml)}
                title={p.title}
                className="px-3 h-8 text-sm font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              step="1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={system === 'IMPERIAL' ? 'custom fl oz' : 'custom ml'}
              autoFocus
              className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1.5 text-sm font-mono rounded"
            />
            {system === 'IMPERIAL' && (
              <span className="text-[10px] font-mono text-ink-400">fl oz</span>
            )}
            <button
              type="button"
              disabled={logM.isPending || !value}
              onClick={() => {
                const n = Number(value);
                if (!Number.isFinite(n) || n <= 0) return;
                const ml = system === 'IMPERIAL'
                  ? Math.round(n * 29.5735)
                  : Math.round(n);
                logM.mutate(ml);
              }}
              className="px-3 py-1.5 text-sm font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
            >
              Log
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Daily weigh-in tile + modal. The /today quick-action grid hosts
 * it; clicking opens a focused log modal (same shape as the
 * WaterTile's modal). On the dashboard the same weigh-in form
 * lives inside the full-size <WeighInPanel />, which also
 * renders the today/streak stats and a 7-day trend chart. On
 * /today we just want the quick-log entry point — the dashboard
 * remains the place to see the trend.
 */
function WeighInTile({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth();
  const system: UnitSystem = (user?.units ?? 'METRIC') as UnitSystem;
  const statusQ = useQuery({
    queryKey: ['weigh-in', 'status'],
    queryFn: () =>
      api<{
        today: { logged: boolean; value: number | null; recordedAt: string | null; unit: string };
        streak: { current: number; longest: number; lastDate: string | null };
      }>('/measurements/weigh-in/status'),
    refetchOnMount: 'always',
  });
  const today = statusQ.data?.today;
  const streak = statusQ.data?.streak?.current ?? 0;
  const logged = !!today?.logged;
  const weightUnit = displayUnit('kg', system);
  const summary = logged && today?.value != null ? (
    <span>
      <span className="text-neon-lime">✓ </span>
      {(() => {
        const disp = convertForDisplay(today.value, 'kg', system);
        return `${disp.value.toFixed(1)} ${disp.unit}`;
      })()}
      {streak > 0 && <span className="text-ink-500"> · {streak}d</span>}
    </span>
  ) : (
    <span className="text-ink-500">not logged</span>
  );
  return (
    <ActionTile
      glyph="⚖"
      label="Weigh-in"
      accent="amber"
      onClick={onOpen}
      summary={summary}
    />
  );
}

function WeighInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const system: UnitSystem = (user?.units ?? 'METRIC') as UnitSystem;
  const weightUnit = displayUnit('kg', system);

  // Today / streak status. Same endpoint the dashboard tile hits,
  // so the two surfaces stay in sync.
  const statusQ = useQuery({
    queryKey: ['weigh-in', 'status'],
    queryFn: () =>
      api<{
        today: { logged: boolean; value: number | null; recordedAt: string | null; unit: string };
        streak: { current: number; longest: number; lastDate: string | null };
      }>('/measurements/weigh-in/status'),
    refetchOnMount: 'always',
  });
  const today = statusQ.data?.today;
  const streak = statusQ.data?.streak?.current ?? 0;
  const logged = !!today?.logged;

  // Prefill the input with today's value (in display unit) so the
  // user can just adjust + log; falls back to "" for first-time
  // weigh-ins. Same UX as the dashboard's <WeighInPanel /> input
  // placeholder.
  const [draft, setDraft] = useState('');
  const [unlocked, setUnlocked] = useState<string[] | null>(null);
  const [logErr, setLogErr] = useState<string | null>(null);

  // Reset draft when the modal opens / re-opens so a stale value
  // from a previous session doesn't stick around. Also prefill from
  // today's value when status lands.
  useEffect(() => {
    if (!open) return;
    setUnlocked(null);
    setLogErr(null);
    if (today?.value != null) {
      const disp = convertForDisplay(today.value, 'kg', system);
      setDraft(disp.value.toFixed(1));
    } else {
      setDraft('');
    }
  }, [open, today?.value, system]);

  const logM = useMutation({
    mutationFn: () => {
      const inputValue = Number(draft);
      // Convert input from display unit back to kg for storage.
      const stored = convertForStorage(inputValue, weightUnit, system);
      return api<{ unlocked?: string[] }>('/measurements/weigh-in', {
        method: 'POST',
        body: { value: stored.value },
      });
    },
    onSuccess: (r) => {
      setDraft('');
      // Same invalidation set as the dashboard's <WeighInPanel />,
      // so a weigh-in from /today propagates everywhere: the
      // dashboard tile, /measurements history, achievements,
      // check-ins, and the morning popup's "Weigh-in" recap cell.
      qc.invalidateQueries({ queryKey: ['weigh-in'] });
      qc.invalidateQueries({ queryKey: ['measurements'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
      qc.invalidateQueries({ queryKey: ['check-ins'] });
      if (r.unlocked && r.unlocked.length > 0) {
        setUnlocked(r.unlocked);
        setTimeout(() => setUnlocked(null), 4000);
      }
    },
    onError: (e: any) => setLogErr(e?.message ?? 'Log failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Daily weigh-in" width="max-w-sm" hideCloseButton>
      <div className="space-y-3">
        {logErr && (
          <div className="text-[10px] font-mono text-rose-300 border border-rose-500/40 bg-rose-500/10 px-2 py-1 rounded">
            {logErr}
          </div>
        )}

        {/* Today + streak status. Mirrors the read-out at the top
            of the dashboard's <WeighInPanel /> so the user can
            confirm "yep, today's logged" before they tap anything. */}
        <div className="border border-ink-700/40 bg-bg-900/40 px-3 py-2 flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Today</div>
            {logged && today?.value != null ? (
              <div className="font-display text-2xl neon-text-amber leading-none mt-0.5">
                {(() => {
                  const disp = convertForDisplay(today.value, 'kg', system);
                  return disp.value.toFixed(1);
                })()}
                <span className="text-sm text-ink-300 ml-1.5 font-mono">{weightUnit}</span>
              </div>
            ) : (
              <div className="text-sm text-rose-300 font-mono mt-0.5">not logged yet</div>
            )}
            {logged && today?.recordedAt && (
              <div className="text-[10px] font-mono text-ink-300 mt-1">
                ✓ {formatRelative(today.recordedAt)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Streak</div>
            <div
              className={classNames(
                'font-display text-2xl leading-none mt-0.5',
                streak > 0 ? 'neon-text-amber' : 'text-ink-300',
              )}
            >
              {streak}
              <span className="text-sm text-ink-300 ml-1.5 font-mono">d</span>
            </div>
          </div>
        </div>

        {/* Log form. Prefilled with today's value when logged so
            the user just adjusts + taps "Log" to update. */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft && !logM.isPending) {
                logM.mutate();
              }
            }}
            placeholder={weightUnit}
            autoFocus
            className="flex-1 bg-bg-900 border border-neon-amber/40 px-2 py-1.5 text-sm font-mono text-neon-amber rounded"
          />
          <span className="text-[10px] font-mono text-ink-400">{weightUnit}</span>
          <NeonButton
            variant="amber"
            size="sm"
            disabled={!draft || logM.isPending}
            onClick={() => logM.mutate()}
          >
            {logM.isPending ? '…' : logged ? '⚡ Update' : '⚡ Log'}
          </NeonButton>
        </div>

        {/* Inline achievement unlock toast — same UX as the
            dashboard's <WeighInPanel /> so the user doesn't have
            to bounce back to /dashboard to see what they earned. */}
        {unlocked && unlocked.length > 0 && (
          <div className="text-[10px] font-mono neon-text-amber text-center border border-neon-amber/30 bg-neon-amber/5 p-1.5">
            ✦ Unlocked: {unlocked.join(', ')}
          </div>
        )}

        <div className="text-[10px] font-mono text-ink-500">
          Logs as WEIGHT (kg). {logged ? 'Re-logs overwrite today\'s value.' : 'Streak starts on your first log.'}
        </div>
      </div>
    </Modal>
  );
}

function FoodSummary() {
  const q = useQuery({
    queryKey: ['meals', 'today'],
    queryFn: () => api<{ dayTotals: { calories: number; proteinG: number } }>('/meals/today'),
  });
  const t = q.data?.dayTotals;
  return t ? (
    <span className="text-ink-100">
      {Math.round(t.calories)} kcal · {Math.round(t.proteinG)}g protein
    </span>
  ) : (
    <span className="text-ink-500">nothing logged</span>
  );
}

function SupplementSummary({ category }: { category: TrackedItem['category'] | null }) {
  const q = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<{ items: TrackedItem[] }>('/supplements/tracked'),
  });
  const items = q.data?.items ?? [];
  // Filter to this category (or all categories when null) BEFORE
  // counting, otherwise "Supplements" tile shows progress across
  // vitamins + probiotics which double-counts items that fall in both.
  const filtered = category ? items.filter((i) => i.category === category) : items;
  const total = filtered.length;
  const checkedToday = filtered.filter((i) => i.today).length;
  return total > 0 ? (
    <span className="text-ink-100">
      {total} tracked · <span className={checkedToday === total ? 'text-neon-lime' : 'text-ink-300'}>{checkedToday}/{total}</span> today
    </span>
  ) : (
    <span className="text-ink-500">none tracked</span>
  );
}

function SubstanceSummary({ category, days }: { category: string; days: number }) {
  const q = useQuery({
    queryKey: ['substances', category, days],
    queryFn: () => api<SubstancesResponse>(`/substances?days=${days}`),
  });
  const count = (q.data?.items ?? []).filter((s) => s.category === category).length;
  return count > 0 ? (
    <span className="text-ink-100">
      {count} {count === 1 ? 'serving' : 'servings'} · last {days}d
    </span>
  ) : (
    <span className="text-ink-500">none logged</span>
  );
}

function ActivitySummary() {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const q = useQuery({
    queryKey: ['today', 'workout'],
    queryFn: () => api<{ items: any[] }>('/workouts?limit=200'),
  });
  const today = localTodayStartUtc(userTz);
  const todayCount = (q.data?.items ?? []).filter((w) => new Date(w.performedAt) >= today).length;
  return todayCount > 0 ? (
    <span className="text-neon-lime">✓ logged today</span>
  ) : (
    <span className="text-ink-500">not logged</span>
  );
}

function PrayerSummary() {
  // /spiritual returns the last 30 prayer logs (newest first).
  // Filter to today for the tile summary.
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const q = useQuery({
    queryKey: ['spiritual', 'logs'],
    queryFn: () => api<{ logs: Array<{ id: string; type: string | null; loggedAt: string }> }>('/spiritual'),
    refetchInterval: 60_000,
  });
  const today = localTodayStartUtc(userTz);
  const todayLogs = (q.data?.logs ?? []).filter((l) => new Date(l.loggedAt) >= today);
  return todayLogs.length > 0 ? (
    <span className="text-neon-lime">✓ {todayLogs.length} prayer{todayLogs.length === 1 ? '' : 's'} today</span>
  ) : (
    <span className="text-ink-500">not logged</span>
  );
}

function FoodLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  // Default to Ask AI — the LLM-direct path handles multi-item
  // recipes well (vanilla protein shake, smoothie bowls, mixed
  // salads) without needing every ingredient in OFF/USDA. Search
  // mode is still here as a fallback for users who want a barcode
  // paste or to log a known brand product, but the LLM path is
  // the more common case.
  const [mode, setMode] = useState<'search' | 'ask'>('ask');
  const [meal, setMeal] = useState<MealType>(inferMealType(userTz));

  return (
    <Modal open={open} onClose={onClose} title="Log food" width="max-w-2xl" hideCloseButton>
      <div className="space-y-4">
        {/* Mode selector + meal picker */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(['ask', 'search'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={classNames(
                  'px-3 py-1 text-[10px] font-display tracking-widest uppercase border rounded',
                  mode === m
                    ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-cyan/40',
                )}
                title={
                  m === 'ask'
                    ? 'Ask the AI to estimate macros for a recipe / mixed dish'
                    : 'Search OpenFoodFacts / USDA for a packaged product'
                }
              >
                {m === 'ask' ? '✦ Ask AI' : 'Search'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mr-1">Meal:</span>
            {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMeal(m)}
                className={classNames(
                  'px-2 py-0.5 text-xs border rounded',
                  meal === m
                    ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-cyan/40',
                )}
              >
                {MEAL_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {mode === 'search' ? <FoodSearchMode meal={meal} onClose={onClose} /> : <FoodAskAiMode meal={meal} onClose={onClose} />}
      </div>
    </Modal>
  );
}

/**
 * Search mode — debounced OFF/USDA query + saved foods for
 * quick-log. Single food at a time.
 */
function FoodSearchMode({ meal, onClose }: { meal: MealType; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [servings, setServings] = useState('1');
  const [searchTrigger, setSearchTrigger] = useState('');
  useEffect(() => {
    if (!q || q.length < 2) return;
    const t = setTimeout(() => setSearchTrigger(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const searchQ = useQuery({
    queryKey: ['foods', 'search', searchTrigger],
    queryFn: () => api<{ items: FoodSearchHit[] }>('/foods/search', { method: 'GET', query: { q: searchTrigger } }),
    enabled: searchTrigger.length >= 2,
  });
  const savedQ = useQuery({
    queryKey: ['foods', 'saved'],
    queryFn: () => api<{ items: SavedFoodDto[] }>('/foods/saved'),
  });

  const logSavedM = useDelayedMutation<{ entry: any }, { id: string; meal: MealType; servings: number }>({
    mutationFn: ({ id, meal, servings }) =>
      api(`/foods/saved/${id}/log`, { method: 'POST', body: { meal, servings } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
      onClose();
    },
  }, 300);

  // Recently EATEN (logged meals) — complements the "Recently used"
  // (saved foods) section above. Same data the /nutrition page's
  // RecentFoodsModal shows. Lets the user re-log the same meal they
  // ate yesterday/last week without re-typing macros.
  const recentMealsQ = useQuery({
    queryKey: ['meals', 'recent', 7],
    queryFn: () => api<{ items: MealEntry[] }>('/meals?days=7'),
  });
  // Dedup: many entries per food (one per log). Keep most-recent.
  const dedupedMeals: MealEntry[] = [];
  const seenMeal = new Set<string>();
  for (const m of recentMealsQ.data?.items ?? []) {
    const k = `${m.food.source}|${m.food.sourceId}|${m.food.name.toLowerCase()}`;
    if (seenMeal.has(k)) continue;
    seenMeal.add(k);
    dedupedMeals.push(m);
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search foods (OFF / USDA)…"
        autoFocus
        className="w-full bg-bg-900 border border-ink-700/40 px-3 py-2 text-sm font-mono rounded"
      />

      {q.length >= 2 && (
        <div className="max-h-48 overflow-y-auto border border-ink-700/40 rounded divide-y divide-ink-700/30">
          {(searchQ.data?.items ?? []).map((hit, i) => (
            <SearchResultRow
              key={`${hit.source}-${hit.sourceId}-${i}`}
              hit={hit}
              servings={servings}
              onLog={() => {
                api('/meals', {
                  method: 'POST',
                  body: {
                    meal,
                    servings: Number(servings) || 1,
                    source: hit.source,
                    sourceId: hit.sourceId,
                    name: hit.name,
                    brand: hit.brand ?? null,
                    servingSizeG: hit.servingSizeG ?? null,
                    calories: hit.calories,
                    proteinG: hit.proteinG,
                    carbG: hit.carbG,
                    fatG: hit.fatG,
                    fiberG: hit.fiberG ?? null,
                    sugarG: hit.sugarG ?? null,
                    sodiumMg: hit.sodiumMg ?? null,
                  },
                }).then(() => {
                  qc.invalidateQueries({ queryKey: ['meals', 'today'] });
                  qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
                  onClose();
                });
              }}
            />
          ))}
          {searchQ.isLoading && (
            <div className="p-3 text-[10px] font-mono text-ink-400 text-center">searching…</div>
          )}
          {searchQ.data && searchQ.data.items.length === 0 && (
            <div className="p-3 text-[10px] font-mono text-ink-400 text-center">no matches</div>
          )}
        </div>
      )}

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-2">
          Recently used
        </div>
        {(savedQ.data?.items ?? []).slice(0, 8).map((f) => (
          <div key={f.id} className="flex items-center justify-between border-b border-ink-700/30 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate">{f.name}</div>
              <div className="text-[10px] font-mono text-ink-500">
                {Math.round(f.calories)} kcal · {Math.round(f.proteinG)}g P · {Math.round(f.carbG)}g C · {Math.round(f.fatG)}g F
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="w-14 bg-bg-900 border border-ink-700/40 px-1.5 py-0.5 text-xs font-mono text-right rounded"
              />
              <span className="text-[10px] font-mono text-ink-400">×</span>
              <button
                type="button"
                disabled={logSavedM.isPending}
                onClick={() => logSavedM.run({ id: f.id, meal, servings: Number(servings) || 1 })}
                className="px-2 py-0.5 text-[10px] font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded disabled:opacity-50"
              >
                Log
              </button>
            </div>
          </div>
        ))}
        {savedQ.data?.items.length === 0 && (
          <div className="text-[10px] font-mono text-ink-500 italic">
            No saved foods yet. Use search to log a new one.
          </div>
        )}
      </div>

      {/* Recently eaten — logged meals from the last 7 days. The user
          asked to add this; without it, the /today modal is missing
          the "I had the same thing yesterday" quick-log path that
          the /nutrition page has via RecentFoodsModal. */}
      {dedupedMeals.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-2">
            Recently eaten
          </div>
          {dedupedMeals.slice(0, 6).map((m) => (
            <div key={`${m.food.source}-${m.food.sourceId}-${m.id}`} className="flex items-center justify-between border-b border-ink-700/30 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate">{m.food.name}</div>
                <div className="text-[10px] font-mono text-ink-500">
                  {Math.round(m.served.calories)} kcal · {Math.round(m.served.proteinG)}g P · {Math.round(m.served.carbG)}g C · {Math.round(m.served.fatG)}g F
                  {' · '}
                  <span className="text-ink-400">{MEAL_LABELS[m.meal]}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Re-log with the same per-serving macros the user
                  // had. Server upserts the FoodItem via (source,
                  // sourceId) so we don't duplicate the row.
                  api('/meals', {
                    method: 'POST',
                    body: {
                      source: m.food.source,
                      sourceId: m.food.sourceId,
                      name: m.food.name,
                      brand: m.food.brand,
                      servingSizeG: m.food.servingSizeG,
                      calories: m.served.calories,
                      proteinG: m.served.proteinG,
                      carbG: m.served.carbG,
                      fatG: m.served.fatG,
                      fiberG: m.served.fiberG ?? null,
                      sugarG: m.served.sugarG ?? null,
                      sodiumMg: m.served.sodiumMg ?? null,
                      imageUrl: m.food.imageUrl,
                      sourceUrl: null,
                      meal,
                      servings: 1,
                    },
                  }).then(() => {
                    qc.invalidateQueries({ queryKey: ['meals', 'today'] });
                    qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
                    onClose();
                  });
                }}
                className="px-2 py-0.5 text-[10px] font-mono border border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10 rounded shrink-0"
              >
                Log
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Ask AI mode — paste a comma-separated description and the LLM
 * splits it into individual items, each with a search query that
 * gets piped through OFF/USDA. The preview table lets the user
 * pick the right match (or override) before logging all of them.
 *
 * Example input: "1 cup milk, 1 cup kefir, 6 strawberries,
 * collagen peptides, 1 avocado"
 */
// crypto.randomUUID() is gated to secure contexts (HTTPS +
// localhost). LAN access via http://10.0.0.59:5173 is NOT
// considered secure, so the API is missing there. Fall back to
// crypto.getRandomValues which works everywhere crypto exists.
function randomUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    // RFC 4122 v4 layout
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  // Last-resort: timestamp + random. Collision-prone but
  // /meals is user-scoped so worst case is a stale row, not a
  // global conflict.
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function FoodAskAiMode({ meal, onClose }: { meal: MealType; onClose: () => void }) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  // Single-entry preview. The LLM returns one consolidated
  // { name, reason, calories, proteinG, carbG, fatG, ... }
  // covering the whole meal description (e.g. "1 cup milk, 1
  // avocado, 6 strawberries"). User can edit the name and
  // macronumbers before logging. A new MANUAL row is created on
  // every submit so the same description can be logged multiple
  // times without dedupe collisions.
  type AskAiPreview = {
    name: string;
    reason: string;
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
    sodiumMg?: number;
  };
  const [preview, setPreview] = useState<AskAiPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const askM = useMutation({
    mutationFn: () =>
      api<AskAiPreview>('/foods/ask-ai-multi', {
        method: 'POST',
        body: { description },
      }),
    onSuccess: (r) => {
      setPreview(r);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Ask AI failed'),
  });

  const logM = useMutation({
    mutationFn: async (p: AskAiPreview) => {
      // MANUAL source — no upsert into FoodItem, just a one-shot
      // Meal row tied to this description. sourceId uses a fresh
      // UUID so two loggings of the same description don't collide
      // on the (source, sourceId) unique index.
      return api('/meals', {
        method: 'POST',
        body: {
          meal,
          servings: 1,
          source: 'MANUAL',
          sourceId: `askai-${randomUuid()}`,
          name: p.name,
          brand: null,
          servingSizeG: null,
          calories: p.calories,
          proteinG: p.proteinG,
          carbG: p.carbG,
          fatG: p.fatG,
          fiberG: p.fiberG ?? null,
          sugarG: p.sugarG ?? null,
          sodiumMg: p.sodiumMg ?? null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', 'today'] });
      qc.invalidateQueries({ queryKey: ['nutrition', 'meals', 'today'] });
      onClose();
    },
  });

  function reset() {
    setPreview(null);
    setError(null);
  }

  // Inline numeric editor — lets the user tighten any macro
  // the LLM overshot/undershot before logging. Defaults stay
  // locked to the LLM's number; edits commit on blur.
  function MacroField({ label, valueKey, unit }: { label: string; valueKey: keyof AskAiPreview; unit: string }) {
    const v = preview?.[valueKey];
    if (typeof v !== 'number') return null;
    return (
      <label className="flex items-center gap-1.5 text-[10px] font-mono">
        <span className="text-ink-400 w-12">{label}</span>
        <input
          type="number"
          min="0"
          step="1"
          value={Math.round(v)}
          onChange={(e) =>
            setPreview((p) => (p ? { ...p, [valueKey]: Number(e.target.value) || 0 } as AskAiPreview : p))
          }
          className="w-16 bg-bg-900 border border-ink-700/40 px-1.5 py-0.5 text-xs font-mono text-right rounded"
        />
        <span className="text-ink-500">{unit}</span>
      </label>
    );
  }

  return (
    <div className="space-y-3">
      {!preview ? (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Comma-separated list with quantities:&#10;1 cup milk, 1 cup kefir, 6 strawberries, collagen peptides, 1 avocado"
            rows={4}
            autoFocus
            className="w-full bg-bg-900 border border-ink-700/40 px-3 py-2 text-sm font-mono rounded resize-y"
          />
          {error && (
            <div className="text-[11px] font-mono text-rose-300">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <NeonButton
              onClick={() => askM.mutate()}
              loading={askM.isPending}
              disabled={description.length < 3}
              variant="cyan"
            >
              ✦ Estimate macros
            </NeonButton>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono text-ink-400">
              LLM estimate · edit before logging
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-[10px] font-mono text-neon-cyan hover:underline"
            >
              ← edit description
            </button>
          </div>

          <div className="border border-neon-cyan/30 rounded p-3 space-y-2 bg-neon-cyan/5">
            <input
              type="text"
              value={preview.name}
              onChange={(e) => setPreview((p) => (p ? { ...p, name: e.target.value } : p))}
              className="w-full bg-bg-900 border border-ink-700/40 px-2 py-1.5 text-sm rounded"
              placeholder="Meal name"
            />
            {preview.reason && (
              <div className="text-[10px] font-mono text-ink-300 italic leading-snug">
                {preview.reason}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <MacroField label="Cal" valueKey="calories" unit="kcal" />
              <MacroField label="Protein" valueKey="proteinG" unit="g" />
              <MacroField label="Carbs" valueKey="carbG" unit="g" />
              <MacroField label="Fat" valueKey="fatG" unit="g" />
              <MacroField label="Fiber" valueKey="fiberG" unit="g" />
              <MacroField label="Sodium" valueKey="sodiumMg" unit="mg" />
            </div>
          </div>

          {logM.isError && (
            <div className="text-[11px] font-mono text-rose-300">
              Log failed: {logM.error instanceof Error ? logM.error.message : 'unknown'}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1.5 text-[10px] font-display tracking-widest uppercase border border-ink-700/40 text-ink-300 hover:border-neon-cyan/40 rounded"
            >
              Cancel
            </button>
            <NeonButton
              onClick={() => logM.mutate(preview)}
              loading={logM.isPending}
              disabled={!preview.name.trim() || preview.calories < 1}
              variant="cyan"
            >
              Log meal
            </NeonButton>
          </div>
        </>
      )}
    </div>
  );
}

function SearchResultRow({
  hit,
  servings,
  onLog,
}: {
  hit: FoodSearchHit;
  servings: string;
  onLog: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLog}
      className="w-full text-left px-3 py-2 hover:bg-neon-cyan/5 flex items-center justify-between gap-2"
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate">{hit.name}</div>
        <div className="text-[10px] font-mono text-ink-400">
          {hit.brand ? `${hit.brand} · ` : ''}{Math.round(hit.calories * (Number(servings) || 1))} kcal · {hit.source}
        </div>
      </div>
      <span className="text-[10px] font-mono text-neon-cyan shrink-0">+ log</span>
    </button>
  );
}

/* ============================================================
 * Supplement log modal: pick from UserTrackedItem
 * ============================================================ */

function SupplementLogModal({
  open,
  onClose,
  category,
}: {
  open: boolean;
  onClose: () => void;
  category: TrackedItem['category'] | null;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['supplements', 'tracked'],
    queryFn: () => api<{ items: TrackedItem[] }>('/supplements/tracked'),
  });
  const items = (q.data?.items ?? []).filter((i) => !category || i.category === category);
  const checkM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/supplements/tracked/${id}/check`, { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplements'] });
    },
  }, 300);
  // Undo: DELETE today's log. The server endpoint is
  // /supplements/tracked/:id/check (DELETE) which removes the
  // DailyTrackedItem for today.
  const uncheckM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/supplements/tracked/${id}/check`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplements'] });
    },
  }, 300);
  return (
    <Modal open={open} onClose={onClose} title={category === 'PROBIOTIC' ? 'Log probiotic' : 'Log supplement'} width="max-w-md" hideCloseButton>
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-ink-400 italic py-3 text-center">
            No tracked items{category ? ` in ${category}` : ''}. Add some in <a href="/nutrition" className="text-neon-cyan underline">/nutrition</a>.
          </div>
        )}
        {items.map((i) => {
          const taken = !!i.today;
          return (
            <div
              key={i.id}
              className={
                'flex items-center justify-between border p-2 rounded ' +
                (taken
                  ? 'border-neon-lime/40 bg-neon-lime/5'
                  : 'border-ink-700/30')
              }
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm flex items-center gap-2">
                  {i.name}
                  {taken && (
                    <span className="text-[10px] font-mono text-neon-lime">✓ taken today</span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-ink-500">
                  {taken && i.today
                    ? `${i.today.dose} ${i.today.doseUnit} · logged ${new Date(i.today.checkedAt).toLocaleTimeString()}`
                    : `${i.defaultDose} ${i.doseUnit} · ${i.category.toLowerCase()}`}
                </div>
              </div>
              {taken ? (
                <button
                  type="button"
                  disabled={uncheckM.isPending}
                  onClick={() => uncheckM.run(i.id)}
                  className="px-3 py-1 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-rose-500/60 hover:text-rose-300 rounded disabled:opacity-50"
                  title="Undo today's log"
                >
                  Undo
                </button>
              ) : (
                <button
                  type="button"
                  disabled={checkM.isPending}
                  onClick={() => checkM.run(i.id)}
                  className="px-3 py-1 text-xs font-mono border border-neon-lime/50 text-neon-lime hover:bg-neon-lime/10 rounded disabled:opacity-50"
                >
                  ✓ Took
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ============================================================
 * Substance log modal (caffeine/alcohol/nicotine/electrolytes)
 * ============================================================ */

function SubstanceLogModal({
  open,
  onClose,
  category,
  days,
  label,
}: {
  open: boolean;
  onClose: () => void;
  category: string;
  days: number;
  label: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  // No free-form input — modal is now buttons-only.
  const today = (q: { items: Array<{ category: string; loggedAt: string; form: string }> }) =>
    q.items.filter((s) => s.category === category && new Date(s.loggedAt) >= localTodayStartUtc(userTz)).length;
  const recentQ = useQuery({
    queryKey: ['substances', category, days],
    queryFn: () => api<SubstancesResponse>(`/substances?days=${days}`),
  });
  const recentForms = Array.from(
    new Set((recentQ.data?.items ?? []).filter((s) => s.category === category).map((s) => s.form)),
  );
  // Canonical forms per category. Recent user-logged forms are
  // merged in so previously-used macros surface first; the merge
  // keeps the picker scannable without making the user re-type
  // their usual brand every time.
  const canonical = CANONICAL_FORMS[category] ?? [];
  // Merge: recent first (in their original order), then canonical
  // forms not already present. Dedup case-insensitively.
  const seen = new Set<string>();
  const orderedForms: string[] = [];
  for (const f of [...recentForms, ...canonical]) {
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    orderedForms.push(f);
  }
  const logM = useMutation({
    mutationFn: (b: { form: string; amount?: number; context?: string }) =>
      api<{ id: string }>('/substances', { method: 'POST', body: { category, ...b } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['substances'] });
      qc.invalidateQueries({ queryKey: ['today'] });
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Log ${label.toLowerCase()}`} width="max-w-sm" hideCloseButton>
      <div className="space-y-3">
        <div className="text-[10px] font-mono text-ink-300">
          {recentQ.data && (
            <>
              {today(recentQ.data)} today · {recentQ.data.items.filter((s) => s.category === category).length} in last {days}d
            </>
          )}
        </div>
        {orderedForms.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            {orderedForms.map((f) => {
              const isRecent = recentForms.some((r) => r.toLowerCase() === f.toLowerCase());
              return (
                <button
                  key={f}
                  type="button"
                  disabled={logM.isPending}
                  onClick={() => logM.mutate({ form: f })}
                  className={classNames(
                    'px-2.5 py-1 text-xs font-mono border rounded disabled:opacity-50',
                    isRecent
                      ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/5 hover:bg-neon-cyan/10'
                      : 'border-ink-700/40 text-ink-200 hover:border-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/5',
                  )}
                  title={isRecent ? 'recently logged' : 'common form'}
                >
                  {f}
                </button>
              );
            })}
          </div>
        )}
        {/* Macro-only modal: the canonical buttons above are the
            only way to log. Free-text input was removed because
            the user wants a scannable picker, not a form. The
            server still records whatever form string the client
            sends, so a future macro addition just means adding
            a button here. */}
      </div>
    </Modal>
  );
}

/* ============================================================
 * Activity modal — wraps WorkoutLogger
 * ============================================================ */

function WorkoutLoggerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  // user + units are REQUIRED by WorkoutLogger. This previously
  // passed `open`/`setOpen` (props WorkoutLogger doesn't have) and
  // omitted user/units — so `units` was undefined, IMPERIAL users
  // got kg labels AND their lb entries were stored unconverted as
  // kg, and bodyweight-derived set weights fell back to 0.
  return (
    <Modal open={open} onClose={onClose} title="Log activity" width="max-w-3xl" hideCloseButton>
      <WorkoutLogger
        user={user}
        units={user?.units ?? 'METRIC'}
        onCommit={() => onClose()}
      />
    </Modal>
  );
}

/* ============================================================
 * Prayer picker + log modal
 * ============================================================ */

function PrayerPickerModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (k: keyof typeof PRAYER_LABELS) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Log prayer" width="max-w-sm">
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(PRAYER_LABELS) as Array<keyof typeof PRAYER_LABELS>).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPick(k)}
            className="px-3 py-2 text-sm font-mono border border-neon-violet/40 text-neon-violet hover:bg-neon-violet/10 rounded text-left"
          >
            {PRAYER_LABELS[k]}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PrayerLogModal({
  open,
  onClose,
  prayerType,
  onSwitch,
}: {
  open: boolean;
  onClose: () => void;
  prayerType: keyof typeof PRAYER_LABELS;
  onSwitch: () => void;
}) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState('15');
  const logM = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; log: { id: string } }>('/spiritual/log', {
        method: 'POST',
        body: {
          type: prayerType,
          durationMin: Number(minutes) || 15,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spiritual'] });
      qc.invalidateQueries({ queryKey: ['today', 'prayer-logs'] });
      onClose();
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={`Log ${PRAYER_LABELS[prayerType]}`} width="max-w-sm" hideCloseButton>
      <div className="space-y-3">
        <div>
          <button
            type="button"
            onClick={onSwitch}
            className="text-[10px] font-mono text-neon-violet hover:underline"
          >
            ← pick a different prayer
          </button>
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
            Minutes
          </label>
          <div className="flex gap-2">
            {['5', '10', '15', '30', '60'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={classNames(
                  'px-2.5 py-1 text-xs border rounded',
                  minutes === m
                    ? 'border-neon-violet/60 text-neon-violet bg-neon-violet/10'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-violet/40',
                )}
              >
                {m}m
              </button>
            ))}
            <input
              type="number"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="flex-1 bg-bg-900 border border-ink-700/40 px-2 py-1 text-xs font-mono rounded"
            />
          </div>
        </div>
        <NeonButton
          onClick={() => logM.mutate()}
          loading={logM.isPending}
          variant="violet"
          className="w-full"
        >
          Log {PRAYER_LABELS[prayerType]}
        </NeonButton>
      </div>
    </Modal>
  );
}

