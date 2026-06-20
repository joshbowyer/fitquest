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
const TOP_ANGLE = START_ANGLE + SWEEP / 2; // top

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
 * Elite-based radial gauge.
 *
 * Zones (in order of goodness):
 *   - elite   : the green band centered on the top of the dial. Values
 *               here are world-class.
 *   - healthy : the wider band around elite. Values here are fine.
 *   - warn    : outside the healthy band but not extreme. Sub-healthy.
 *   - far     : the rest — too low or too high.
 *
 * Top of the dial is `idealMid` (the middle of the elite band).
 * Values fan outward symmetrically.
 */
type Props = {
  value: number | null;
  min: number;
  eliteMin: number;
  eliteMax: number;
  healthyMin: number;
  healthyMax: number;
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
  eliteMin,
  eliteMax,
  healthyMin,
  healthyMax,
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
  const idealMid = (eliteMin + eliteMax) / 2;

  // Angle mapping: t in [-1, +1] maps linearly to the dial.
  const angleOf = (v: number) => {
    const t = (v - idealMid) / Math.max(range / 2, 0.0001);
    const half = SWEEP / 2;
    return TOP_ANGLE - t * half;
  };

  const valueAngle = value != null && Number.isFinite(value) ? angleOf(value) : null;
  const eliteMinAngle = angleOf(eliteMin);
  const eliteMaxAngle = angleOf(eliteMax);
  const healthyMinAngle = angleOf(healthyMin);
  const healthyMaxAngle = angleOf(healthyMax);

  // Status classification.
  const status = (() => {
    if (value == null) return '—';
    if (value >= eliteMin && value <= eliteMax) return 'elite';
    if (value >= healthyMin && value <= healthyMax) return 'healthy';
    // Anything outside healthy is "warn" (mild) or "far" (extreme).
    // Use a 25% buffer of the healthy span to differentiate.
    const span = healthyMax - healthyMin;
    const buf = span * 0.25;
    if (value < healthyMin - buf || value > healthyMax + buf) return 'far';
    return 'warn';
  })();

  const statusColor = (() => {
    switch (status) {
      case 'elite': return '#9bff5c';
      case 'healthy': return '#14d6e8';
      case 'warn': return '#ffc34d';
      case 'far': return '#ff2bd6';
      default: return colorHex;
    }
  })();

  // Convert to display unit for the labels/center text.
  const valueDisp = value != null ? convertForDisplay(value, meta.unit, system) : null;
  const eliteMinDisp = convertForDisplay(eliteMin, meta.unit, system);
  const eliteMaxDisp = convertForDisplay(eliteMax, meta.unit, system);
  const healthyMinDisp = convertForDisplay(healthyMin, meta.unit, system);
  const healthyMaxDisp = convertForDisplay(healthyMax, meta.unit, system);
  const minDisp = convertForDisplay(min, meta.unit, system);
  const maxDisp = convertForDisplay(max, meta.unit, system);
  const displayUnitLabel = displayUnit(meta.unit, system);

  // Time durations (seconds) display as M:SS; everything else uses
  // formatNumber().
  const isTimeUnit =
    meta.unit === 's' &&
    (metric === 'ONE_MILE_TIME' ||
      metric === 'FIVE_K_TIME' ||
      metric === 'PLANK_HOLD' ||
      metric === 'L_SIT_HOLD');

  const fmtValue = (v: number | null): string => {
    if (v == null) return '—';
    if (isTimeUnit) {
      const total = Math.max(0, Math.round(v));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    }
    const decimals =
      displayUnitLabel === 's' ||
      displayUnitLabel === '%' ||
      displayUnitLabel === '/10' ||
      displayUnitLabel === 'ms' ||
      displayUnitLabel === 'bpm'
        ? 0
        : 1;
    return formatNumber(v, decimals);
  };

  // Background zones
  const eliteArc = arcPath(cx, cy, (rOuter + rInner) / 2, eliteMaxAngle, eliteMinAngle);
  const healthyArc = arcPath(
    cx,
    cy,
    (rOuter + rInner) / 2,
    healthyMaxAngle,
    healthyMinAngle,
  );

  // Indicator (current value → ideal midpoint), colored by status
  const indicatorArc =
    valueAngle != null
      ? arcPath(cx, cy, (rOuter + rInner) / 2, valueAngle, TOP_ANGLE)
      : null;

  const indicatorPos = valueAngle != null
    ? polar(cx, cy, (rOuter + rInner) / 2, valueAngle)
    : null;

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

        {/* Full track */}
        <path
          d={arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, START_ANGLE + SWEEP)}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={rOuter - rInner}
          fill="none"
          strokeLinecap="round"
        />

        {/* Healthy band (wider) */}
        <path
          d={healthyArc}
          stroke="#14d6e8"
          strokeOpacity="0.10"
          strokeWidth={rOuter - rInner - 2}
          fill="none"
          strokeLinecap="round"
        />
        {/* Elite band (narrower, lime) */}
        <path
          d={eliteArc}
          stroke="#9bff5c"
          strokeOpacity="0.30"
          strokeWidth={rOuter - rInner - 4}
          fill="none"
          strokeLinecap="round"
        />

        {/* Indicator */}
        {indicatorArc && (
          <path
            d={indicatorArc}
            stroke={statusColor}
            strokeWidth={rOuter - rInner}
            fill="none"
            strokeLinecap="round"
            filter={`url(#glow-${id})`}
            style={{ transition: 'all 0.6s cubic-bezier(0.22,1,0.36,1)' }}
          />
        )}

        {/* Tick marks at elite/healthy boundaries + edges */}
        {useMemo(() => {
          const stops = [
            { v: min, big: false },
            { v: healthyMin, big: true },
            { v: eliteMin, big: true },
            { v: eliteMax, big: true },
            { v: healthyMax, big: true },
            { v: max, big: false },
          ];
          return stops.map((s, i) => {
            const a = angleOf(s.v);
            const outer = polar(cx, cy, rOuter + 4, a);
            const inner = polar(cx, cy, rInner - 4, a);
            return (
              <line
                key={i}
                x1={outer.x}
                y1={outer.y}
                x2={inner.x}
                y2={inner.y}
                stroke={s.big ? '#9bff5c' : colorHex}
                strokeOpacity={s.big ? 0.55 : 0.18}
                strokeWidth={s.big ? 1.2 : 0.7}
              />
            );
          });
        }, [min, max, healthyMin, healthyMax, eliteMin, eliteMax, colorHex])}

        {/* Indicator dot */}
        {indicatorPos && (
          <g>
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="6" fill={statusColor} filter={`url(#glow-${id})`} />
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="3" fill="#0a0a14" />
          </g>
        )}

        {/* Center text — value + unit + status */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="font-mono"
          fontSize="28"
          fontWeight="700"
          fill={statusColor}
          style={{ filter: `drop-shadow(0 0 4px ${statusColor})` }}
        >
          {fmtValue(valueDisp?.value ?? null)}
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
            fill={statusColor}
            fillOpacity="0.85"
            className="font-mono"
          >
            {status.toUpperCase()}
          </text>
        )}

        {/* Min / max labels (subtle) */}
        <text x={20} y={170} fontSize="9" fill="rgba(180,180,210,0.55)" className="font-mono">
          {fmtValue(minDisp.value)}
        </text>
        <text x={180} y={170} textAnchor="end" fontSize="9" fill="rgba(180,180,210,0.55)" className="font-mono">
          {fmtValue(maxDisp.value)}
        </text>
      </svg>

      <div className="mt-1 text-center">
        <div className={`text-[11px] font-display tracking-[0.2em] uppercase`} style={{ color: colorHex }}>
          {meta.shortLabel}
        </div>
        {subtitle && (
          <div className="text-[9px] text-ink-400 font-mono mt-0.5 leading-tight max-w-[140px] mx-auto">
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