import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { NeonButton } from '@/components/NeonButton';
import { classNames, formatRelative } from '@/lib/format';
import { todayInTz, localTodayStartUtc } from '@/lib/timezone';
import {
  BODY_PARTS,
  intensityLabel,
  intensityToColor,
} from '@/components/BodyModel';

// ============================================================================
// /calendar — pick a date, see everything you logged that day
// ============================================================================
//
// Two views stacked: a month grid on top (clickable days, with a
// tiny indicator dot on days that have any data) and a "selected
// day" detail panel below (workouts, weigh-in, sleep, recovery,
// dailies, meals, pain, substances, heart-loss events).
//
// Data sources (existing endpoints, all tz-aware):
//   GET /dailies/morning-popup?date=YYYY-MM-DD  — core payload
//     (workouts, sleep, weigh-in, recovery, heartLoss, dailies, mode, level, xp, hearts)
//   GET /meals/today?date=YYYY-MM-DD             — meals for that day
//   GET /pain-logs?since=...                     — pain for the day
//     (client-side filtered by date)
//   GET /substances?days=60                     — substances for the
//     month (client-side filtered by date)
//
// No new api endpoint — reuses the morning-popup pipeline which
// already takes a date param (the calendar view is the natural
// generalization of the morning popup from "yesterday recap" to
// "any day recap").

type TodayMealsResponse = {
  date: string;
  meals: Record<string, { items: any[]; totals: any }>;
  dayTotals: any;
};

type MealEntryLite = {
  id: string;
  meal: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
  servings: number;
  note: string | null;
  loggedAt: string;
  food: {
    name: string;
    brand: string | null;
    servingSizeG: number | null;
  };
  served: {
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
  };
};

type PainLog = {
  id: string;
  bodyPart: string;
  intensity: number;
  notes: string | null;
  loggedAt: string;
};

type SubstanceLog = {
  id: string;
  category: 'CAFFEINE' | 'ALCOHOL' | 'NICOTINE' | 'ELECTROLYTE';
  form: string;
  amount: number | null;
  unit: string | null;
  loggedAt: string;
};

// The morning-popup returns a comprehensive payload; the calendar
// only renders a subset of fields so we type-narrow it here.
// `workouts` was added in the v1.0.2 morning-popup shape — older
// servers (pre-2309089) don't include it, so the field is
// optional with a default of [] so the calendar renders on those
// too (just without the per-workout list).
type DayPayload = {
  date: string;
  mode: 'CASUAL' | 'HARDCORE';
  hearts: number;
  workouts?: Array<{ id: string; name: string | null; type: string; duration: number | null; performedAt: string }>;
  sleep: { value: number; recordedAt: string } | null;
  latestWeight: { value: number; recordedAt: string } | null;
  recovery: { score: number | null; components?: any[] } | null;
  heartLoss: Array<{ id: string; kind: string; details: string | null; sourceDate: string }>;
  dailies: {
    userDailies: Array<{ id: string; name: string; todayDone: boolean }>;
    builtins: Array<{ id: string; todayDone: boolean }>;
    spiritualDailies: Array<{ id: string; name: string; todayDone: boolean }>;
    counts: { total: number; completed: number; isWorkoutDay: boolean };
  };
  recap: {
    workoutLogged: boolean;
    workoutCount: number;
    workoutNames: string[];
    sleepHours: number | null;
    weighInLogged: boolean;
    latestWeightKg: number | null;
    recoveryScore: number | null;
  };
};

const MEAL_LABEL: Record<string, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACK: 'Snacks',
};

const HEART_LOSS_LABEL: Record<string, string> = {
  MISSED_WORKOUT: 'missed planned workout',
  MISSED_ALL_DAILIES: 'all dailies missed',
  SUBSTANCE_CAFFEINE: 'caffeine over cap',
  SUBSTANCE_ALCOHOL: 'alcohol over cap',
  SUBSTANCE_NICOTINE: 'nicotine over cap',
  ZERO_SPIRITUAL: 'no spiritual activity',
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function startOfMonthGrid(viewYear: number, viewMonth: number): { gridStart: Date; daysInMonth: number } {
  // viewMonth is 0-indexed (Jan = 0). The grid starts on the
  // Sunday on or before the 1st of the month.
  const first = new Date(viewYear, viewMonth, 1);
  const dow = first.getDay(); // 0=Sun, 6=Sat
  const gridStart = new Date(viewYear, viewMonth, 1 - dow);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  return { gridStart, daysInMonth };
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPage() {
  const { user } = useAuth();
  const userTz = user?.timezone ?? null;
  const today = todayInTz(userTz);

  // The currently displayed month (0-indexed month). Defaults to
  // today's month. "Today" button resets to today's month.
  const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  // The currently selected date for the detail panel. Defaults to
  // today. Clicking a day in the grid selects it.
  const [selectedDate, setSelectedDate] = useState(today);

  // Build the grid: 6 rows of 7 days = 42 cells. The first cell
  // is the Sunday on or before the 1st of the viewed month; the
  // last cell extends into the next month.
  const { gridStart, grid } = useMemo(() => {
    const { gridStart } = startOfMonthGrid(viewYear, viewMonth);
    const cells: { date: Date; inMonth: boolean; dateStr: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      cells.push({
        date: d,
        inMonth: d.getMonth() === viewMonth,
        dateStr: ymd(d),
      });
    }
    return { gridStart, grid: cells };
  }, [viewYear, viewMonth]);

  // Wide-window fetch for "has data" indicators. 60 days covers
  // the viewed month + 1 prev + 1 next. Filters by date client-side.
  const windowStart = ymd(addDays(gridStart, -7));
  const windowEnd = ymd(addDays(gridStart, 49));

  const morningQ = useQuery({
    queryKey: ['dailies', 'morning-popup', selectedDate],
    queryFn: () => api<DayPayload>(`/dailies/morning-popup?date=${selectedDate}`),
  });

  const mealsQ = useQuery({
    queryKey: ['meals', 'today', selectedDate],
    queryFn: () => api<TodayMealsResponse>(`/meals/today?date=${selectedDate}`),
  });

  const painQ = useQuery({
    queryKey: ['pain-logs', 'window', windowStart],
    queryFn: () => api<{ logs: PainLog[] }>(`/pain-logs?since=${windowStart}T00:00:00Z`),
  });

  const substancesQ = useQuery({
    queryKey: ['substances', 'window', windowStart],
    queryFn: () => api<{ items: SubstanceLog[] }>(`/substances?days=${daysBetween(windowStart, today) + 7}`),
  });

  // Set of dates (in user's tz) that have any data. Drives the
  // indicator dot in the month grid.
  const datesWithData = useMemo(() => {
    const set = new Set<string>();
    // workouts + recovery + dailies (already comes per-date from
    // morning-popup, but only for the selected day — so we can't
    // use it to mark all-month indicators). Use the windowed
    // fetches for the indicators.
    for (const l of painQ.data?.logs ?? []) {
      const d = new Date(l.loggedAt);
      set.add(localDateStr(d, userTz));
    }
    for (const s of substancesQ.data?.items ?? []) {
      const d = new Date(s.loggedAt);
      set.add(localDateStr(d, userTz));
    }
    return set;
  }, [painQ.data, substancesQ.data, userTz]);

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }
  function goNextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }
  function goToday() {
    setViewYear(Number(today.slice(0, 4)));
    setViewMonth(Number(today.slice(5, 7)) - 1);
    setSelectedDate(today);
  }

  const detail = morningQ.data;
  const meals = mealsQ.data;
  const dayPain = (painQ.data?.logs ?? []).filter((l) => localDateStr(new Date(l.loggedAt), userTz) === selectedDate);
  const daySubs = (substancesQ.data?.items ?? []).filter((s) => localDateStr(new Date(s.loggedAt), userTz) === selectedDate);

  return (
    <Layout>
      <PageHeader
        title="// Calendar"
        subtitle={`Pick a date — see everything you logged that day. Times in ${userTz ?? 'UTC'}.`}
        action={
          <button
            type="button"
            onClick={goToday}
            className="text-[10px] font-mono uppercase tracking-widest border border-neon-cyan/40 text-neon-cyan px-2 py-1 hover:bg-neon-cyan/10"
          >
            Today
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        {/* Month grid — clickable days, indicator dot when a day has
            any data (workouts, meals, weigh-in, dailies, pain,
            substances). Days outside the current month are dimmed. */}
        <Panel variant="cyan" title={`${MONTH_NAMES[viewMonth]} ${viewYear}`}>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={goPrevMonth}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/40 text-ink-300 hover:border-neon-cyan hover:text-neon-cyan"
            >
              ←
            </button>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              pick a day
            </div>
            <button
              type="button"
              onClick={goNextMonth}
              className="text-[10px] font-mono px-2 py-1 border border-ink-500/40 text-ink-300 hover:border-neon-cyan hover:text-neon-cyan"
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {DOW_SHORT.map((d) => (
              <div key={d} className="text-[9px] font-mono uppercase tracking-widest text-ink-500 py-1">
                {d}
              </div>
            ))}
            {grid.map((c) => {
              const isToday = c.dateStr === today;
              const isSelected = c.dateStr === selectedDate;
              const hasData = datesWithData.has(c.dateStr);
              return (
                <button
                  key={c.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(c.dateStr)}
                  className={classNames(
                    'relative py-2 text-xs font-mono border transition-colors',
                    !c.inMonth && 'opacity-30',
                    isSelected
                      ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                      : isToday
                        ? 'border-neon-lime/60 text-neon-lime hover:bg-neon-lime/5'
                        : 'border-ink-700/40 text-ink-200 hover:border-ink-500 hover:bg-bg-700/40',
                  )}
                  title={c.dateStr}
                >
                  {c.date.getDate()}
                  {hasData && (
                    <span
                      className={classNames(
                        'absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full',
                        isSelected ? 'bg-neon-cyan' : 'bg-neon-magenta',
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Selected-day detail. Mirrors the morning popup shape
            (workouts, sleep, weigh-in, recovery, dailies) + adds
            pain + substances + meals since the popup doesn't cover
            those. */}
        <Panel
          variant="lime"
          title={selectedDate === today ? `Today · ${selectedDate}` : formatLongDate(selectedDate)}
        >
          {morningQ.isLoading ? (
            <div className="text-[10px] font-mono text-ink-400">loading…</div>
          ) : !detail ? (
            <div className="text-[10px] font-mono text-ink-300 italic">No data for this day.</div>
          ) : (
            <DayDetail
              detail={detail}
              meals={meals}
              pain={dayPain}
              substances={daySubs}
              isFuture={selectedDate > today}
              isToday={selectedDate === today}
            />
          )}
        </Panel>
      </div>
    </Layout>
  );
}

// ============================================================================
// DayDetail — the per-day payload, rendered inside the right Panel.
// ============================================================================
function DayDetail({
  detail,
  meals,
  pain,
  substances,
  isFuture,
  isToday,
}: {
  detail: DayPayload;
  meals: TodayMealsResponse | undefined;
  pain: PainLog[];
  substances: SubstanceLog[];
  isToday: boolean;
  isFuture: boolean;
}) {
  const r = detail.recap;
  // Future dates are placeholder days — show an empty state for
  // every section. We deliberately don't render "all dailies
  // marked as missed" because that would look like the user
  // failed to do their dailies, when really the day just hasn't
  // happened yet.
  if (isFuture) {
    return (
      <div className="text-[10px] font-mono text-ink-300 italic py-4 text-center">
        Future date — nothing to show yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {/* Headline row — workout, sleep, weigh-in, recovery score */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
        <Stat
          label="Workout"
          value={r.workoutLogged ? `${r.workoutCount}×` : '—'}
          color={r.workoutLogged ? 'text-neon-lime' : 'text-ink-500'}
          detail={r.workoutLogged ? r.workoutNames[0] : 'none'}
        />
        <Stat
          label="Sleep"
          value={r.sleepHours != null ? `${r.sleepHours.toFixed(1)}h` : '—'}
          color={r.sleepHours != null ? 'text-neon-cyan' : 'text-ink-500'}
        />
        <Stat
          label="Weigh-in"
          value={r.weighInLogged ? `${r.latestWeightKg?.toFixed(1)}kg` : '—'}
          color={r.weighInLogged ? 'text-neon-cyan' : 'text-ink-500'}
        />
        <Stat
          label="Recovery"
          value={r.recoveryScore != null ? `${r.recoveryScore}` : '—'}
          color={r.recoveryScore != null ? 'text-neon-lime' : 'text-ink-500'}
          detail={r.recoveryScore != null && r.recoveryScore >= 80 ? 'good' : r.recoveryScore != null ? 'low' : ''}
        />
      </div>

      {/* Hearts + heart-loss events (Hardcore only) */}
      {detail.mode === 'HARDCORE' && detail.heartLoss.length > 0 && (
        <div className="border-t border-current/10 pt-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
            Hearts: <span className="text-neon-magenta">{detail.hearts}</span> (events)
          </div>
          <div className="space-y-0.5 text-[10px] font-mono">
            {detail.heartLoss.map((h) => (
              <div key={h.id} className="text-ink-300">
                <span className="text-neon-magenta">−1</span> {HEART_LOSS_LABEL[h.kind] ?? h.kind}
                {h.details && <span className="text-ink-500"> · {h.details}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workouts — list with name + type + duration. The recap
          stat cell above only shows the count + first name; the
          full list lives here so multi-workout days are visible
          (e.g. "AM lift + PM conditioning" both render). Older
          morning-popup responses (pre-2309089) don't include the
          `workouts` array; the optional chaining + `?? []` keeps
          the calendar rendering on those servers too (just with
          no per-workout list). */}
      {(detail.workouts ?? []).length > 0 && <WorkoutsSection workouts={detail.workouts ?? []} />}

      {/* Dailies (built-in + user + spiritual) with done/missed
          status. For past dates, undone = red X (truly missed).
          For today, undone = empty gray box (still actionable —
          the user can complete before midnight). For future
          dates the whole DayDetail short-circuits above so this
          section never renders with fake "missed" data. */}
      <DailiesSection dailies={detail.dailies} isToday={isToday} />

      {/* Meals — same data the /today dashboard shows, scoped to
          the selected date. */}
      {meals && Object.values(meals.meals).some((m: any) => m.items.length > 0) && (
        <MealsSection meals={meals} />
      )}

      {/* Pain — only when the user logged something that day. */}
      {pain.length > 0 && <PainSection pain={pain} />}

      {/* Substances — caffeine / alcohol / nicotine etc. */}
      {substances.length > 0 && <SubstancesSection substances={substances} />}
    </div>
  );
}

function WorkoutsSection({ workouts }: { workouts: NonNullable<DayPayload['workouts']> }) {
  return (
    <div className="border-t border-current/10 pt-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
        Workouts ({workouts.length})
      </div>
      <div className="space-y-0.5 text-[10px] font-mono">
        {workouts.map((w) => (
          <div key={w.id} className="flex items-center gap-2">
            <span className="text-neon-lime">⚔</span>
            <span className="text-ink-200 truncate flex-1">
              {w.name}
              {w.type && w.type !== 'STRENGTH' && (
                <span className="text-ink-500 ml-1">· {w.type.toLowerCase()}</span>
              )}
            </span>
            {w.duration != null && (
              <span className="text-ink-500 shrink-0">
                {Math.round(w.duration / 60)}m
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color, detail }: { label: string; value: string; color: string; detail?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-ink-500">{label}</div>
      <div className={classNames('text-lg font-display tabular-nums', color)}>{value}</div>
      {detail && <div className="text-[9px] text-ink-500">{detail}</div>}
    </div>
  );
}

function DailiesSection({ dailies, isToday }: { dailies: DayPayload['dailies']; isToday: boolean }) {
  const all = [
    ...dailies.userDailies.map((d) => ({ id: d.id, name: d.name, done: d.todayDone, kind: 'user' as const })),
    ...dailies.builtins.map((d) => ({ id: d.id, name: d.id, done: d.todayDone, kind: 'builtin' as const })),
    ...dailies.spiritualDailies.map((d) => ({ id: d.id, name: d.name, done: d.todayDone, kind: 'spiritual' as const })),
  ];
  if (all.length === 0) return null;
  return (
    <div className="border-t border-current/10 pt-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">Dailies</div>
        <div className="text-[10px] font-mono text-ink-400">
          <span className="text-neon-lime">{dailies.counts.completed}</span>/{dailies.counts.total}
        </div>
      </div>
      <div className="space-y-0.5 text-[10px] font-mono">
        {all.map((d) => {
          // Tri-state box:
          //   done  (any day)  → green box, white ✓
          //   undone (today)   → empty gray box, no icon. "Still
          //                      actionable" — the user can still
          //                      complete before midnight. Not a
          //                      failure, so no red.
          //   undone (past)    → rose box, rose × — truly missed.
          let boxClass: string;
          let textClass: string;
          let icon: string;
          if (d.done) {
            boxClass = 'bg-neon-lime border-neon-lime text-bg-900';
            textClass = 'text-ink-200';
            icon = '✓';
          } else if (isToday) {
            boxClass = 'border-ink-500/40';
            textClass = 'text-ink-300';
            icon = '';
          } else {
            boxClass = 'bg-rose-500/30 border-rose-400 text-rose-300';
            textClass = 'text-ink-300';
            icon = '×';
          }
          return (
            <div key={d.id} className="flex items-center gap-2">
              <span
                className={classNames(
                  'w-3 h-3 border shrink-0 grid place-items-center font-bold text-[10px] leading-none',
                  boxClass,
                )}
              >
                {icon}
              </span>
              <span className={classNames('truncate', textClass)}>
                {d.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MealsSection({ meals }: { meals: TodayMealsResponse }) {
  return (
    <div className="border-t border-current/10 pt-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">Meals</div>
      <div className="space-y-1.5">
        {(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const).map((bucket) => {
          const m = meals.meals[bucket] as { items: MealEntryLite[]; totals: any } | undefined;
          if (!m || m.items.length === 0) return null;
          return (
            <div key={bucket}>
              <div className="text-[9px] font-mono uppercase tracking-widest text-ink-500">
                {MEAL_LABEL[bucket]}{' '}
                <span className="text-ink-400">
                  · {m.totals.calories.toFixed(0)} kcal · {m.totals.proteinG.toFixed(0)}p · {m.totals.carbG.toFixed(0)}c · {m.totals.fatG.toFixed(0)}f
                </span>
              </div>
              <div className="space-y-0.5 mt-0.5">
                {m.items.map((it) => (
                  <div key={it.id} className="text-[10px] font-mono text-ink-300">
                    · {it.food.name}
                    {it.food.brand && <span className="text-ink-500"> · {it.food.brand}</span>}
                    <span className="text-ink-500"> · ×{it.servings}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PainSection({ pain }: { pain: PainLog[] }) {
  return (
    <div className="border-t border-current/10 pt-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">Pain</div>
      <div className="space-y-0.5 text-[10px] font-mono">
        {pain.map((p) => {
          const part = BODY_PARTS.find((b) => b.id === p.bodyPart);
          return (
            <div key={p.id} className="flex items-center gap-2">
              <span
                className="w-5 h-5 grid place-items-center font-display text-[11px] shrink-0"
                style={{
                  color: intensityToColor(p.intensity),
                  border: `1px solid ${intensityToColor(p.intensity)}`,
                }}
              >
                {p.intensity}
              </span>
              <span className="text-ink-200">{part?.label ?? p.bodyPart}</span>
              <span className="text-ink-500 text-[9px]">{intensityLabel(p.intensity)}</span>
              {p.notes && <span className="text-ink-500 italic truncate">— {p.notes}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubstancesSection({ substances }: { substances: SubstanceLog[] }) {
  // Group by category so the section reads as "Caffeine (3)" / "Alcohol (1)"
  // — matches the /today substance panel's pattern.
  const byCat = new Map<string, SubstanceLog[]>();
  for (const s of substances) {
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  return (
    <div className="border-t border-current/10 pt-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">Substances</div>
      <div className="space-y-1">
        {Array.from(byCat.entries()).map(([cat, list]) => (
          <div key={cat}>
            <div className="text-[9px] font-mono uppercase tracking-widest text-ink-500">
              {cat} ({list.length})
            </div>
            <div className="space-y-0.5 mt-0.5">
              {list.map((s) => (
                <div key={s.id} className="text-[10px] font-mono text-ink-300">
                  · {s.form}
                  {s.amount != null && (
                    <span className="text-ink-500"> · {s.amount} {s.unit}</span>
                  )}
                  <span className="text-ink-500"> · {formatRelative(s.loggedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Small date helpers used by the calendar grid + "has data" set.
// ============================================================================

function localDateStr(d: Date, tz: string | null): string {
  // d is an instant; we want the YYYY-MM-DD as seen in the user's tz.
  // Uses the same en-CA trick the rest of the app uses for tz-aware
  // date formatting (returns YYYY-MM-DD format natively).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz ?? 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

function formatLongDate(ymd: string): string {
  // ymd is "YYYY-MM-DD". Parse as local time so the date doesn't
  // shift by tz (otherwise "2026-07-01" might render as Jun 30 in
  // a tz west of UTC).
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const ms = new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
