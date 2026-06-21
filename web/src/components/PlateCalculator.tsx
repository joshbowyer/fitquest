import { useMemo, useState } from 'react';
import { calcPlates, formatPlates } from '@/lib/plateCalc';
import type { UnitSystem } from '@/lib/types';

type Props = {
  /** The target weight in the user's current display unit (kg or lb). */
  weight: number;
  units: UnitSystem;
  /** Optional override of the bar weight (in display unit). */
  barWeight?: number;
  /** Hide the inline panel; only show a one-line readout. */
  compact?: boolean;
};

/**
 * Visual plate calculator. Shows the plates required to hit `weight`
 * on a standard barbell, with the bar weight editable inline so the
 * user can switch between 20kg / 15kg / 45lb / etc. bars.
 */
export function PlateCalculator({ weight, units, barWeight, compact }: Props) {
  const defaultBar =
    barWeight ?? (units === 'IMPERIAL' ? 45 : 20);
  const [bar, setBar] = useState<number>(defaultBar);

  const result = useMemo(
    () => calcPlates(weight || 0, units, bar),
    [weight, units, bar],
  );

  if (compact) {
    // One-line readout: "60.0 kg = 20 + 5 + 2.5 kg per side"
    if (!weight || weight <= 0) return null;
    return (
      <div className="text-xs text-slate-400 font-mono">
        ⚖ {formatPlates(result)}
        {result.status === 'infeasible' && result.plates.length > 0 && (
          <span className="ml-2 text-amber-400">
            (off by {result.delta > 0 ? '+' : ''}
            {result.delta.toFixed(2)} {result.unit})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-700/60 bg-slate-900/40 p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-widest text-slate-400">
          Plate breakdown
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">bar</span>
          <input
            type="number"
            step={units === 'IMPERIAL' ? 5 : 2.5}
            min={0}
            value={bar}
            onChange={(e) => setBar(Number(e.target.value) || 0)}
            className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs font-mono"
          />
          <span className="text-slate-500">{units === 'IMPERIAL' ? 'lb' : 'kg'}</span>
        </div>
      </div>
      <div className="text-sm font-mono">
        {weight > 0 ? (
          <>
            <span className="text-slate-200">
              {result.achieved.toFixed(2)} {result.unit}
            </span>
            <span className="text-slate-500"> = </span>
            <span className="text-neon-cyan">
              {formatPlates(result)}
            </span>
            {result.status === 'infeasible' && result.plates.length > 0 && (
              <span className="ml-2 text-amber-400 text-xs">
                (off by {result.delta > 0 ? '+' : ''}
                {result.delta.toFixed(2)} {result.unit})
              </span>
            )}
          </>
        ) : (
          <span className="text-slate-500">enter a weight to see plates</span>
        )}
      </div>
      {/* Visual: plate stack per side */}
      {weight > 0 && result.plates.length > 0 && (
        <div className="mt-2 flex items-end gap-0.5">
          <span className="text-[10px] text-slate-500 mr-1">bar</span>
          {result.plates
            .slice()
            .reverse()
            .map((p, i) => (
              <div
                key={i}
                className="rounded-sm border border-slate-500 bg-slate-700/60 text-[9px] font-mono text-slate-200 text-center"
                style={{
                  width: Math.max(10, p * 0.6),
                  height: 12 + p * 0.7,
                  lineHeight: `${12 + p * 0.7}px`,
                }}
                title={`${p} ${result.unit}`}
              >
                {p}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
