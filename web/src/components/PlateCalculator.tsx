import { useMemo, useState } from 'react';
import { calcPlates, formatPlates } from '@/lib/plateCalc';
import { classNames } from '@/lib/format';
import type { UnitSystem } from '@/lib/types';

type Props = {
  /** The target weight in the user's current display unit (kg or lb).
   *  Ignored when `value` is provided (controlled mode). */
  weight?: number;
  units: UnitSystem;
  /** Optional override of the bar weight (in display unit). */
  barWeight?: number;
  /** Hide the inline panel; only show a one-line readout. */
  compact?: boolean;
  /** Controlled target weight. Overrides `weight` if provided. */
  value?: number;
  /** Called whenever the editable target weight changes. */
  onChange?: (next: number) => void;
  /** When true, the bar weight input is editable inline. */
  editableBar?: boolean;
  /** When true, the target weight field is editable inline. */
  editable?: boolean;
  /** Show a copy-to-clipboard button for the formatted breakdown. */
  copyable?: boolean;
  /** Called after a successful copy, with the copied string. */
  onCopied?: (text: string) => void;
  /** When true, allows unit override independent of the parent `units`. */
  unitOverride?: boolean;
  /** Optional override unit when `unitOverride` is on. */
  unitValue?: UnitSystem;
  /** Called when unitValue changes. */
  onUnitChange?: (next: UnitSystem) => void;
};

/**
 * Visual plate calculator. Shows the plates required to hit `weight`
 * on a standard barbell, with the bar weight editable inline so the
 * user can switch between 20kg / 15kg / 45lb / etc. bars.
 *
 * Three modes:
 *  - Read-only inline (default): takes `weight`, displays breakdown.
 *  - Editable target (`editable`): shows a number input + breakdown.
 *  - Controlled (`value`+`onChange`): parent owns the weight state.
 *
 * Optional `copyable` adds a "copy" button next to the breakdown.
 */
export function PlateCalculator({
  weight,
  units: unitsProp,
  barWeight,
  compact,
  value,
  onChange,
  editableBar = true,
  editable = false,
  copyable = false,
  onCopied,
  unitOverride = false,
  unitValue,
  onUnitChange,
}: Props) {
  const defaultBar =
    barWeight ?? (unitsProp === 'IMPERIAL' ? 45 : 20);
  const [bar, setBar] = useState<number>(defaultBar);
  const [internalWeight, setInternalWeight] = useState<number>(weight ?? 0);
  const [copied, setCopied] = useState(false);

  const units = unitOverride ? (unitValue ?? unitsProp) : unitsProp;
  const target = value !== undefined ? value : (editable ? internalWeight : (weight ?? 0));

  const result = useMemo(
    () => calcPlates(target || 0, units, bar),
    [target, units, bar],
  );

  function setTarget(next: number) {
    if (onChange) onChange(next);
    if (editable) setInternalWeight(next);
  }

  async function handleCopy() {
    const text = formatPlates(result);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.(text);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail on insecure origins — fall back to a
      // throwaway textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      setCopied(true);
      onCopied?.(text);
      setTimeout(() => setCopied(false), 1200);
    }
  }

  if (compact) {
    // One-line readout: "60.0 kg = 20 + 5 + 2.5 kg per side"
    if (!target || target <= 0) return null;
    return (
      <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
        <span>⚖ {formatPlates(result)}</span>
        {result.status === 'infeasible' && result.plates.length > 0 && (
          <span className="text-amber-400">
            (off by {result.delta > 0 ? '+' : ''}
            {result.delta.toFixed(2)} {result.unit})
          </span>
        )}
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-[10px] text-neon-cyan hover:underline"
            title="Copy breakdown to clipboard"
          >
            {copied ? 'copied!' : 'copy'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-700/60 bg-slate-900/40 p-3 mt-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs uppercase tracking-widest text-slate-400">
          Plate breakdown
        </span>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {unitOverride && (
            <div className="flex items-center gap-1 border border-slate-700 rounded">
              <button
                type="button"
                onClick={() => onUnitChange?.('METRIC')}
                className={classNames(
                  'px-2 py-0.5 text-[10px] font-mono',
                  units === 'METRIC'
                    ? 'bg-neon-cyan/20 text-neon-cyan'
                    : 'text-slate-400 hover:text-slate-200',
                )}
                title="Calculate in kilograms"
              >
                kg
              </button>
              <button
                type="button"
                onClick={() => onUnitChange?.('IMPERIAL')}
                className={classNames(
                  'px-2 py-0.5 text-[10px] font-mono',
                  units === 'IMPERIAL'
                    ? 'bg-neon-cyan/20 text-neon-cyan'
                    : 'text-slate-400 hover:text-slate-200',
                )}
                title="Calculate in pounds"
              >
                lb
              </button>
            </div>
          )}
          {editable && (
            <div className="flex items-center gap-1">
              <span className="text-slate-500">target</span>
              <input
                type="number"
                step={units === 'IMPERIAL' ? 5 : 2.5}
                min={0}
                value={target || ''}
                onChange={(e) => setTarget(Number(e.target.value) || 0)}
                className="w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs font-mono"
                placeholder="0"
              />
              <span className="text-slate-500">{units === 'IMPERIAL' ? 'lb' : 'kg'}</span>
            </div>
          )}
          {editableBar && (
            <div className="flex items-center gap-1">
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
          )}
        </div>
      </div>

      <div className="text-sm font-mono flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {target > 0 ? (
          <>
            <span className="text-slate-200">
              {result.achieved.toFixed(2)} {result.unit}
            </span>
            <span className="text-slate-500"> = </span>
            <span className="text-neon-cyan">
              {formatPlates(result)}
            </span>
            {result.status === 'infeasible' && result.plates.length > 0 && (
              <span className="text-amber-400 text-xs">
                (off by {result.delta > 0 ? '+' : ''}
                {result.delta.toFixed(2)} {result.unit})
              </span>
            )}
            {copyable && (
              <button
                type="button"
                onClick={handleCopy}
                className={classNames(
                  'text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border ml-1',
                  copied
                    ? 'border-neon-lime/60 text-neon-lime bg-neon-lime/10'
                    : 'border-slate-600 text-slate-400 hover:text-neon-cyan hover:border-neon-cyan/60',
                )}
                title="Copy breakdown to clipboard"
              >
                {copied ? '✓ copied' : 'copy'}
              </button>
            )}
          </>
        ) : (
          <span className="text-slate-500">
            {editable ? 'enter a target weight to see plates' : 'no weight set'}
          </span>
        )}
      </div>

      {/* Visual: plate stack per side. Scaled to fit; capped so the
          smallest plate stays visible (the previous `width: p * 0.6`
          crashed the layout for tiny 1.25kg plates). */}
      {target > 0 && result.plates.length > 0 && (
        <div className="mt-2 flex items-end gap-0.5 overflow-x-auto pb-1">
          <span className="text-[10px] text-slate-500 mr-1 shrink-0">bar</span>
          {result.plates
            .slice()
            .reverse()
            .map((p, i) => {
              // Imperial plates are typically 1.5-2x larger than metric,
              // so use the unit to scale. Cap height so 1.25kg plates
              // remain visible.
              const pxPerUnit = units === 'IMPERIAL' ? 0.5 : 0.7;
              const minHeight = 16;
              const height = Math.min(56, minHeight + p * pxPerUnit);
              const minWidth = 14;
              const width = Math.max(minWidth, p * pxPerUnit);
              return (
                <div
                  key={i}
                  className="rounded-sm border border-slate-500 bg-slate-700/60 text-[9px] font-mono text-slate-200 text-center shrink-0"
                  style={{
                    width,
                    height,
                    lineHeight: `${height}px`,
                  }}
                  title={`${p} ${result.unit}`}
                >
                  {p}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}