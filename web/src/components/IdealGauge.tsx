import { useId, useMemo } from 'react';
import { METRICS, type MetricType } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { convertForDisplay, displayUnit, type UnitSystem } from '@/lib/units';
import { useAuth } from '@/lib/auth';

export type GaugeColor = 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet';

const COLOR_HEX: Record<GaugeColor, string> = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  lime: '#9bff5c',
  amber: '#ffc34d',
  violet: '#7c3aed',
};

const START_ANGLE = 135; // bottom-left
const SWEEP = 270;
const TOP_ANGLE = START_ANGLE + SWEEP / 2; // 270 → directly up

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/**
 * Ideal-based gauge for metrics where the goal is in the middle of
 * the range — body fat, HRV, VO2 max. The TOP CENTER of the arc is
 * the ideal point; values fan outward toward "too low" on the left
 * and "too high" on the right. The fill is colored by how far you
 * are from the ideal range:
 *   - inside [idealMin, idealMax] = lime (ideal)
 *   - within warn margin          = amber
 *   - outside warn margin         = magenta
 */
type Props = {
  value: number | null;
  min: number;
  idealMin: number;
  idealMax: number;
  max: number;
  metric: MetricType;
  color?: GaugeColor;
  size?: number;
  showPct?: boolean;
  subtitle?: string;
};

export function IdealGauge({
  value,
  min,
  idealMin,
  idealMax,
  max,
  metric,
  color = 'cyan',
  size = 200,
  showPct = true,
  subtitle,
}: Props) {
  const id = useId();
  const meta = METRICS[metric];
  const colorHex = COLOR_HEX[color];
  const { user } = useAuth();
  const system: UnitSystem = user?.units ?? 'METRIC';

  const cx = 100;
  const cy = 100;
  const rOuter = 86;
  const rInner = 70;

  const range = max - min;
  const idealMid = (idealMin + idealMax) / 2;
  const idealSpan = idealMax - idealMin;

  // Map a numeric value to an angle on the gauge. The top center
  // (270° = TOP_ANGLE) is `idealMid`. Linear stretch outward to
  // min/max at the edges (135° and 405°).
  const angleOf = (v: number) => {
    const t = (v - idealMid) / Math.max(range / 2, 0.0001);
    // t = -1 → bottom-left, t = +1 → bottom-right, t = 0 → top
    const half = SWEEP / 2;
    return TOP_ANGLE - t * half; // t=-1 → +half = bottom-left, t=+1 → -half = bottom-right
  };

  const valueAngle = value != null && Number.isFinite(value) ? angleOf(value) : null;
  const idealMinAngle = angleOf(idealMin);
  const idealMaxAngle = angleOf(idealMax);

  // "How close to ideal": 0 at ideal midpoint, 1 at the edges of
  // the ideal range, increasing past it. Used for fill color.
  const distance = value != null && Number.isFinite(value)
    ? Math.abs(value - idealMid)
    : null;
  const inIdealRange = value != null && value >= idealMin && value <= idealMax;
  // Warning margin = 50% of the ideal span, capped to remaining
  // range on each side.
  const warnMargin = idealSpan * 0.5;
  const warnLow = Math.max(min, idealMin - warnMargin);
  const warnHigh = Math.min(max, idealMax + warnMargin);

  let fillColor = '#9bff5c'; // lime — ideal
  if (value != null) {
    if (!inIdealRange) {
      if (value < warnLow || value > warnHigh) {
        fillColor = '#ff2bd6'; // magenta — bad
      } else {
        fillColor = '#ffc34d'; // amber — warning
      }
    }
  }

  // Convert to display unit for the labels/center text.
  const valueDisp = value != null ? convertForDisplay(value, meta.unit, system) : null;
  const idealMinDisp = convertForDisplay(idealMin, meta.unit, system);
  const idealMaxDisp = convertForDisplay(idealMax, meta.unit, system);
  const minDisp = convertForDisplay(min, meta.unit, system);
  const maxDisp = convertForDisplay(max, meta.unit, system);
  const displayUnitLabel = displayUnit(meta.unit, system);
  const fmt = (v: number | null) =>
    v == null
      ? '—'
      : formatNumber(
          v,
          displayUnitLabel === 's' ||
            displayUnitLabel === '%' ||
            displayUnitLabel === '/10' ||
            displayUnitLabel === 'ms' ||
            displayUnitLabel === 'bpm'
            ? 0
            : 1,
        );

  // Ideal-band arc (lime, full opacity)
  const idealArc = arcPath(cx, cy, (rOuter + rInner) / 2, idealMaxAngle, idealMinAngle);
  // Outer warning band on each side (amber)
  const leftWarnArc =
    value != null && value < idealMin
      ? arcPath(cx, cy, (rOuter + rInner) / 2, angleOf(warnLow), idealMinAngle)
      : null;
  const rightWarnArc =
    value != null && value > idealMax
      ? arcPath(cx, cy, (rOuter + rInner) / 2, idealMaxAngle, angleOf(warnHigh))
      : null;
  // Indicator arc (current value to ideal midpoint) — colored by status
  const indicatorArc =
    valueAngle != null
      ? arcPath(cx, cy, (rOuter + rInner) / 2, valueAngle, TOP_ANGLE)
      : null;

  const indicatorPos = valueAngle != null
    ? polar(cx, cy, (rOuter + rInner) / 2, valueAngle)
    : null;

  const statusLabel = (() => {
    if (value == null) return '—';
    if (inIdealRange) return 'ideal';
    if (value < warnLow) return 'too low';
    if (value > warnHigh) return 'too high';
    return 'warn';
  })();

  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }}>
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="overflow-visible"
        role="img"
        aria-label={`${meta.label} ideal gauge`}
      >
        <defs>
          <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track (dim full arc) */}
        <path
          d={arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, START_ANGLE + SWEEP)}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={rOuter - rInner}
          fill="none"
          strokeLinecap="round"
        />

        {/* Ideal band (lime, subtle) */}
        <path
          d={idealArc}
          stroke="#9bff5c"
          strokeOpacity="0.22"
          strokeWidth={rOuter - rInner}
          fill="none"
          strokeLinecap="round"
        />

        {/* Warning bands (amber) — left + right of ideal */}
        {leftWarnArc && (
          <path
            d={leftWarnArc}
            stroke="#ffc34d"
            strokeOpacity="0.18"
            strokeWidth={rOuter - rInner - 6}
            fill="none"
            strokeLinecap="round"
          />
        )}
        {rightWarnArc && (
          <path
            d={rightWarnArc}
            stroke="#ffc34d"
            strokeOpacity="0.18"
            strokeWidth={rOuter - rInner - 6}
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Indicator (current value → ideal midpoint), colored by status */}
        {indicatorArc && (
          <path
            d={indicatorArc}
            stroke={fillColor}
            strokeWidth={rOuter - rInner}
            fill="none"
            strokeLinecap="round"
            filter={`url(#glow-${id})`}
            style={{ transition: 'all 0.6s cubic-bezier(0.22,1,0.36,1)' }}
          />
        )}

        {/* Tick marks */}
        {useMemo(() => {
          return Array.from({ length: 9 }, (_, i) => {
            const t = (i / 8) * 2 - 1; // -1 .. +1
            const a = angleOf(min + (range / 2) * (1 + t));
            const outer = polar(cx, cy, rOuter + 4, a);
            const inner = polar(cx, cy, rInner - 4, a);
            const isIdeal = t >= -0.15 && t <= 0.15;
            return (
              <line
                key={i}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x}
                y2={inner.y}
                stroke={isIdeal ? '#9bff5c' : colorHex}
                strokeOpacity={i % 2 === 0 ? 0.5 : 0.2}
                strokeWidth={i % 2 === 0 ? 1.2 : 0.7}
              />
            );
          });
        }, [min, max, colorHex])}

        {/* Indicator dot at current value */}
        {indicatorPos && (
          <g>
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="6" fill={fillColor} filter={`url(#glow-${id})`} />
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="3" fill="#0a0a14" />
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
          fill={fillColor}
          style={{ filter: `drop-shadow(0 0 4px ${fillColor})` }}
        >
          {fmt(valueDisp?.value ?? null)}
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
        {showPct && (
          <text
            x={cx}
            y={cy + 26}
            textAnchor="middle"
            fontSize="9"
            fill={fillColor}
            fillOpacity="0.85"
            className="font-mono"
          >
            {statusLabel.toUpperCase()}
          </text>
        )}

        {/* Min / ideal-range labels */}
        <text x={20} y={170} fontSize="9" fill="rgba(180,180,210,0.55)" className="font-mono">
          {fmt(minDisp.value)}
        </text>
        <text x={100} y={28} textAnchor="middle" fontSize="9" fill="#9bff5c" fillOpacity="0.85" className="font-mono">
          ideal {fmt(idealMinDisp.value)}–{fmt(idealMaxDisp.value)}
        </text>
        <text x={180} y={170} textAnchor="end" fontSize="9" fill="rgba(180,180,210,0.55)" className="font-mono">
          {fmt(maxDisp.value)}
        </text>
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
        {value == null && (
          <div className="text-[10px] text-ink-300 font-mono mt-0.5">log to populate →</div>
        )}
      </div>
    </div>
  );
}