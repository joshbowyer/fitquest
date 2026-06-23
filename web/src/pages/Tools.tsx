import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { PlateCalculator } from '@/components/PlateCalculator';
import { useAuth } from '@/lib/auth';
import { classNames } from '@/lib/format';
import { calcPlates, formatPlates } from '@/lib/plateCalc';
import type { UnitSystem } from '@/lib/types';

const LS_KEY = 'fq.tools.plateCalc.v1';

type HistoryEntry = {
  ts: number;
  weight: number;
  unit: UnitSystem;
  bar: number;
  text: string;
};

/**
 * Tools page. Hosts stand-alone utilities that don't have a natural
 * home elsewhere. Currently just the plate calculator; future tools
 * (rest timer, BPM calculator, etc.) will join here.
 *
 * The plate calculator supports an in-place unit override so the user
 * can compute lb breakdowns even when their default is kg — useful
 * when reading a US-based workout plan.
 */
export function ToolsPage() {
  const { user } = useAuth();
  const userUnits: UnitSystem = user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';

  // Calculator state. Initialize from localStorage so the user's last
  // session is restored (target weight, bar, unit, 1RM baseline).
  const [weight, setWeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Number(JSON.parse(raw).weight) || 0;
    } catch { /* corrupt localStorage — fall through */ }
    return 0;
  });
  const [bar, setBar] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Number(JSON.parse(raw).bar) || (userUnits === 'IMPERIAL' ? 45 : 20);
    } catch { /* fall through */ }
    return userUnits === 'IMPERIAL' ? 45 : 20;
  });
  const [unit, setUnit] = useState<UnitSystem>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return (JSON.parse(raw).unit as UnitSystem) || userUnits;
    } catch { /* fall through */ }
    return userUnits;
  });
  const [oneRm, setOneRm] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Number(JSON.parse(raw).oneRm) || 0;
    } catch { /* fall through */ }
    return 0;
  });
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw).history ?? [];
    } catch { /* fall through */ }
    return [];
  });

  // Persist on any change. Throttling isn't worth it for one user.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ weight, bar, unit, oneRm, history: history.slice(0, 20) }));
    } catch { /* localStorage full or disabled — silent */ }
  }, [weight, bar, unit, oneRm, history]);

  // Whenever the user changes the target weight, log it to history
  // (debounced-ish: only when value differs from the last entry).
  function commitToHistory(w: number) {
    if (w <= 0) return;
    const result = calcPlates(w, unit, bar);
    const text = formatPlates(result);
    setHistory((prev) => {
      const last = prev[0];
      if (last && last.weight === w && last.bar === bar && last.unit === unit) return prev;
      const next = [{ ts: Date.now(), weight: w, unit, bar, text }, ...prev];
      return next.slice(0, 20);
    });
  }

  function clearHistory() {
    setHistory([]);
  }

  function applyPercent(pct: number) {
    if (!oneRm || oneRm <= 0) return;
    // 1RM percentages assume the user's baseline 1RM is in the same
    // unit as the calculator. If they entered the 1RM in lb but the
    // calculator is in kg, convert.
    const baselineDisplay = oneRm;
    const next = Math.round(baselineDisplay * pct * 2) / 2; // round to nearest 0.5
    setWeight(next);
    commitToHistory(next);
  }

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 max-w-3xl mx-auto pb-24 md:pb-6">
      <PageHeader
        title="Tools"
        subtitle="Stand-alone utilities. Plate calculator for now; rest timer + more to come."
      />

      <Panel
        variant="cyan"
        title="Plate calculator"
        className="border-neon-cyan/30"
      >
        <div className="text-xs text-ink-300 font-mono mb-3">
          Type a target weight, pick your bar, get the plates per side. Tap
          the breakdown to copy. The unit toggle is independent of your
          account default — useful when reading a workout plan written in
          the other system.
        </div>

        {/* Top controls: target + unit + bar */}
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              Target
            </label>
            <input
              type="number"
              step={unit === 'IMPERIAL' ? 5 : 2.5}
              min={0}
              value={weight || ''}
              onChange={(e) => setWeight(Number(e.target.value) || 0)}
              onBlur={() => commitToHistory(weight)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-mono"
              placeholder="0"
              aria-label="Target weight"
            />
            <span className="text-ink-400 text-sm font-mono">
              {unit === 'IMPERIAL' ? 'lb' : 'kg'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              Bar
            </label>
            <input
              type="number"
              step={unit === 'IMPERIAL' ? 5 : 2.5}
              min={0}
              value={bar}
              onChange={(e) => setBar(Number(e.target.value) || 0)}
              className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-mono"
              aria-label="Bar weight"
            />
            <span className="text-ink-400 text-sm font-mono">
              {unit === 'IMPERIAL' ? 'lb' : 'kg'}
            </span>
          </div>

          <div className="flex items-center gap-1 border border-slate-700 rounded ml-auto">
            <button
              type="button"
              onClick={() => setUnit('METRIC')}
              className={classNames(
                'px-3 py-1 text-xs font-mono',
                unit === 'METRIC'
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-slate-400 hover:text-slate-200',
              )}
              title="Kilograms"
            >
              kg
            </button>
            <button
              type="button"
              onClick={() => setUnit('IMPERIAL')}
              className={classNames(
                'px-3 py-1 text-xs font-mono',
                unit === 'IMPERIAL'
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-slate-400 hover:text-slate-200',
              )}
              title="Pounds"
            >
              lb
            </button>
          </div>
        </div>

        {/* The breakdown. Uses the same component that the workout
            logger embeds, so visual style stays consistent. */}
        <PlateCalculator
          units={userUnits}
          weight={weight}
          barWeight={bar}
          copyable
          unitOverride
          unitValue={unit}
          onUnitChange={setUnit}
        />
      </Panel>

      {/* 1RM quick presets: type a baseline once, then jump to common
          percentages. Saves you from re-doing the math every session. */}
      <Panel
        variant="violet"
        title="1RM quick-pick"
        className="border-neon-violet/30 mt-4"
      >
        <div className="text-xs text-ink-300 font-mono mb-3">
          Set your estimated one-rep max once; the buttons below apply the
          classic 5/3/1 + Texas Method percentages. Your baseline is stored
          in this browser only — no account coupling.
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
              Baseline 1RM
            </label>
            <input
              type="number"
              step={unit === 'IMPERIAL' ? 5 : 2.5}
              min={0}
              value={oneRm || ''}
              onChange={(e) => setOneRm(Number(e.target.value) || 0)}
              className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-mono"
              placeholder="0"
              aria-label="One-rep max"
            />
            <span className="text-ink-400 text-sm font-mono">
              {unit === 'IMPERIAL' ? 'lb' : 'kg'}
            </span>
          </div>
        </div>

        {oneRm > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { pct: 0.40, label: 'Warm-up', tone: 'cyan' as const },
              { pct: 0.65, label: 'Working', tone: 'lime' as const },
              { pct: 0.75, label: 'Volume', tone: 'lime' as const },
              { pct: 0.85, label: 'Strength', tone: 'amber' as const },
              { pct: 0.90, label: 'Heavy', tone: 'magenta' as const },
              { pct: 0.95, label: 'Peak', tone: 'magenta' as const },
              { pct: 1.00, label: '1RM Test', tone: 'magenta' as const },
              { pct: 1.05, label: '+5 %', tone: 'amber' as const },
            ].map((row) => {
              const tone = {
                cyan: 'border-neon-cyan/50 text-neon-cyan hover:bg-neon-cyan/10',
                lime: 'border-neon-lime/50 text-neon-lime hover:bg-neon-lime/10',
                amber: 'border-neon-amber/50 text-neon-amber hover:bg-neon-amber/10',
                magenta: 'border-neon-magenta/50 text-neon-magenta hover:bg-neon-magenta/10',
              }[row.tone];
              const computed = Math.round(oneRm * row.pct * 2) / 2;
              return (
                <button
                  key={row.label}
                  type="button"
                  onClick={() => applyPercent(row.pct)}
                  className={classNames(
                    'border rounded px-3 py-2 text-left transition-colors',
                    tone,
                  )}
                  title={`Apply ${(row.pct * 100).toFixed(0)}% of ${oneRm} ${unit}`}
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest opacity-70">
                    {(row.pct * 100).toFixed(0)}%
                  </div>
                  <div className="text-sm font-mono">
                    {computed} {unit === 'IMPERIAL' ? 'lb' : 'kg'}
                  </div>
                  <div className="text-[10px] font-mono opacity-60">{row.label}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-ink-400 font-mono italic">
            Enter a baseline to see percentage presets.
          </div>
        )}
      </Panel>

      {/* Recent calculations. Useful when you've just been clicking
          around and want to revisit the last few — also doubles as
          confirmation that the calculator saw your input. */}
      {history.length > 0 && (
        <Panel
          variant="amber"
          title="Recent calculations"
          className="border-neon-amber/30 mt-4"
          action={
            <button
              type="button"
              onClick={clearHistory}
              className="text-[10px] font-mono uppercase tracking-widest text-rose-300 hover:underline"
              title="Clear history"
            >
              clear
            </button>
          }
        >
          <ul className="divide-y divide-ink-500/10">
            {history.map((h) => (
              <li
                key={h.ts}
                className="py-2 flex items-center gap-3 text-xs font-mono"
              >
                <span className="text-ink-400 shrink-0 tabular-nums">
                  {new Date(h.ts).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-slate-200 shrink-0">
                  {h.weight} {h.unit === 'IMPERIAL' ? 'lb' : 'kg'}
                </span>
                <span className="text-slate-500">→</span>
                <span className="text-neon-cyan truncate flex-1" title={h.text}>
                  {h.text}
                </span>
                <button
                  type="button"
                  onClick={() => setWeight(h.weight)}
                  className="text-[10px] text-violet-300 hover:underline shrink-0"
                  title="Load this calculation back into the calculator"
                >
                  load
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}