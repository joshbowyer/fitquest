import { useId, useMemo } from 'react';
import { METRICS, type MetricType } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

export type GaugeColor = 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet';

const COLOR_HEX: Record<GaugeColor, string> = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  lime: '#00ff88',
  amber: '#ffb800',
  violet: '#7c3aed',
};

const BG_TRACK: Record<GaugeColor, string> = {
  cyan: 'rgba(0,240,255,0.08)',
  magenta: 'rgba(255,43,214,0.08)',
  lime: 'rgba(0,255,136,0.08)',
  amber: 'rgba(255,184,0,0.08)',
  violet: 'rgba(124,58,237,0.08)',
};

type Props = {
  value: number | null;
  min: number;
  max: number;
  metric: MetricType;
  color?: GaugeColor;
  size?: number;
  showPct?: boolean;
  /**
   * If true, the gauge is "less is better" (e.g. RHR, 1mi/5K).
   * The "X% OVER" warning is suppressed because exceeding the
   * dial's max means the user out-performed the ceiling — a
   * personal best, not a problem to flag. (For these metrics
   * consider using IdealGauge instead — it'll visualise the
   * "ideal in the middle" semantics correctly. This prop is
   * here for the basic Gauge so we can still render them
   * somewhere with the warning off rather than misleading the
   * user.)
   */
  lessIsBetter?: boolean;
};

const START_ANGLE = 135; // SVG: 0=right, 90=down, 135=bottom-left
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  // sweep flag: 1 = clockwise (in SVG y-down). For our arc going from 135 → 405, that's clockwise visually.
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function Gauge({
  value,
  min,
  max,
  metric,
  color = 'cyan',
  size = 200,
  showPct = true,
  subtitle,
  lessIsBetter = false,
}: Props & { subtitle?: string }) {
  const id = useId();
  const meta = METRICS[metric];
  const colorHex = COLOR_HEX[color];
  const trackColor = BG_TRACK[color];
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';

  const { pct, clamped, clampedExtreme, angle, tickPositions, hasValue, noMax } = useMemo(() => {
    const hasValue = value != null && Number.isFinite(value);
    const noMax = !max || !Number.isFinite(max);
    const range = max - min;
    const pct = hasValue && !noMax
      ? Math.max(0, Math.min(1, ((value as number) - min) / range))
      : 0;
    // `clamped` = any value above max (gates the dial indicator at the
    //   top end). For "less is better" metrics, exceeding the max
    //   is a personal best, not a data issue.
    const clamped = hasValue && !noMax ? (value as number) > max : false;
    // `clampedExtreme` = value > 2× max (gates the "X% OVER" warning
    //   to genuinely out-of-range values, e.g. typos like typing
    //   "5000" instead of "50" for RHR). Also suppressed entirely
    //   when `lessIsBetter` is true.
    const clampedExtreme = hasValue && !noMax && (value as number) > max * 2;
    const angle = START_ANGLE + pct * SWEEP;
    const tickPositions = Array.from({ length: 11 }, (_, i) => START_ANGLE + (i / 10) * SWEEP);
    return { pct, clamped, clampedExtreme, angle, tickPositions, hasValue, noMax };
  }, [value, min, max, lessIsBetter]);

  const cx = 100;
  const cy = 100;
  const rOuter = 86;
  const rInner = 70;

  const filledPath = hasValue && !noMax
    ? arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, angle)
    : '';

  const indicatorPos = hasValue && !noMax
    ? polar(cx, cy, (rOuter + rInner) / 2, angle)
    : null;

  // Convert min, max, and value into the user's display unit so the gauge
  // reads in their preferred system. The math (pct) is computed on the
  // metric values so conversion is purely cosmetic.
  const valueDisp = value != null ? convertForDisplay(value, meta.unit, system) : null;
  const minDisp = convertForDisplay(min, meta.unit, system);
  const maxDisp = convertForDisplay(max, meta.unit, system);
  const displayValue = valueDisp?.value ?? null;
  const displayMin = minDisp.value;
  const displayMax = maxDisp.value;
  const displayUnitLabel = displayUnit(meta.unit, system);

  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }}>
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="overflow-visible"
        role="img"
        aria-label={`${meta.label} gauge`}
      >
        <defs>
          <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={colorHex} stopOpacity="0.4" />
            <stop offset="100%" stopColor={colorHex} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Track (dim full arc) */}
        <path
          d={arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, START_ANGLE + SWEEP)}
          stroke={trackColor}
          strokeWidth={rOuter - rInner}
          fill="none"
          strokeLinecap="round"
        />

        {/* Outer/inner ring details */}
        <path
          d={arcPath(cx, cy, rOuter, START_ANGLE, START_ANGLE + SWEEP)}
          stroke={colorHex}
          strokeOpacity="0.15"
          strokeWidth="1"
          fill="none"
        />
        <path
          d={arcPath(cx, cy, rInner, START_ANGLE, START_ANGLE + SWEEP)}
          stroke={colorHex}
          strokeOpacity="0.15"
          strokeWidth="1"
          fill="none"
        />

        {/* Tick marks */}
        {tickPositions.map((a, i) => {
          const outer = polar(cx, cy, rOuter + 4, a);
          const inner = polar(cx, cy, rInner - 4, a);
          return (
            <line
              key={i}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke={colorHex}
              strokeOpacity={i % 5 === 0 ? 0.6 : 0.25}
              strokeWidth={i % 5 === 0 ? 1.5 : 0.8}
            />
          );
        })}

        {/* Filled progress */}
        {filledPath && (
          <path
            d={filledPath}
            stroke={`url(#grad-${id})`}
            strokeWidth={rOuter - rInner}
            strokeLinecap="round"
            fill="none"
            filter={`url(#glow-${id})`}
            style={{ transition: 'all 0.6s cubic-bezier(0.22,1,0.36,1)' }}
          />
        )}

        {/* Indicator dot at current value */}
        {indicatorPos && (
          <g>
            <circle
              cx={indicatorPos.x}
              cy={indicatorPos.y}
              r="6"
              fill={colorHex}
              filter={`url(#glow-${id})`}
            />
            <circle
              cx={indicatorPos.x}
              cy={indicatorPos.y}
              r="3"
              fill="#0a0a14"
            />
          </g>
        )}

        {/* Center text */}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="font-mono"
          fontSize="28"
          fontWeight="700"
          fill={colorHex}
          style={{ filter: `drop-shadow(0 0 4px ${colorHex})` }}
        >
          {noMax ? '—' : displayValue != null ? formatNumber(displayValue, displayUnitLabel === 's' || displayUnitLabel === '%' || displayUnitLabel === '/10' || displayUnitLabel === 'ms' || displayUnitLabel === 'bpm' ? 0 : 1) : '—'}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(180,180,210,0.7)"
          className="font-mono tracking-widest"
        >
          {displayUnitLabel}
        </text>
        {showPct && !noMax && (
          <text
            x={cx}
            y={cy + 26}
            textAnchor="middle"
            fontSize="10"
            fill={colorHex}
            fillOpacity="0.85"
            className="font-mono"
          >
            {(pct * 100).toFixed(0)}% OF MAX
          </text>
        )}

        {/* Min/Max labels */}
        {!noMax && (
          <>
            <text x={20} y={170} fontSize="9" fill="rgba(180,180,210,0.6)" className="font-mono">
              {formatNumber(displayMin, 0)}
            </text>
            <text x={180} y={170} textAnchor="end" fontSize="9" fill={colorHex} fillOpacity="0.85" className="font-mono">
              {formatNumber(displayMax, 0)}
            </text>
          </>
        )}

        {/* Exceeded marker — only show for genuinely out-of-range values
            (value > 2× max) so the warning flags data-entry errors,
            not personal-best overflows. Suppressed entirely for
            less-is-better metrics since exceeding the max there is a
            win, not a problem. (For "more is better" metrics, a
            slightly-over-max value still gets the indicator at 100%
            — just no warning ribbon.) */}
        {clampedExtreme && value != null && max > 0 && (
          <text
            x={cx}
            y={cy + 50}
            textAnchor="middle"
            fontSize="9"
            fill="#ff2bd6"
            className="font-mono"
            style={{ filter: `drop-shadow(0 0 3px #ff2bd6)` }}
          >
            ! {(((value as number) / max) * 100 - 100).toFixed(0)}% OVER
          </text>
        )}
      </svg>

      <div className="mt-1 text-center">
        <div className={`text-[11px] font-display tracking-[0.2em] uppercase`} style={{ color: colorHex }}>
          {meta.shortLabel}
        </div>
        {subtitle && (
          <div className="text-[9px] text-ink-400 font-mono mt-0.5 leading-tight max-w-[120px] mx-auto">
            {subtitle}
          </div>
        )}
        {noMax && (
          <div className="text-[10px] text-ink-300 font-mono mt-0.5">set body metrics →</div>
        )}
      </div>
    </div>
  );
}
