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
const TOP_ANGLE = START_ANGLE + SWEEP / 2;

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
 * Monotonic radial gauge — "more is better" metrics.
 *
 * The dial fills from the bottom-left up around to the bottom-right,
 * passing through the top. Higher values push the indicator toward
 * the top. Three zone backgrounds (warn → healthy → elite) are drawn
 * at fixed angular positions corresponding to their threshold values,
 * so the indicator's color tells you which zone you're in at a
 * glance.
 */
type Props = {
  value: number | null;
  min: number;
  max: number;
  /** Threshold at which the value becomes "elite" (lime). */
  eliteMin: number;
  /** Threshold at which the value becomes "healthy" (cyan). Below this is warn. */
  healthyMin: number;
  metric: MetricType;
  color?: GaugeColor;
  size?: number;
  showPct?: boolean;
  subtitle?: string;
  /**
   * If true, the dial reads "less is better" (1mi / 5K). The arc fill
   * still sweeps from bottom-left → top → bottom-right, but the
   * "good" values sit at the left side of the arc and the indicator
   * moves right as the value worsens.
   */
  lessIsBetter?: boolean;
};

export function BetterGauge({
  value,
  min,
  max,
  eliteMin,
  healthyMin,
  metric,
  color = 'cyan',
  size = 200,
  showPct = true,
  subtitle,
  lessIsBetter = false,
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

  // Normalized position [0, 1] where 0 is the "worst" end and 1 is
  // the "best" (elite) end. For "more is better" that means v=max → 1.
  // For "less is better" v=min → 1.
  const goodness = (v: number) => {
    if (max <= min) return 0;
    const t = (v - min) / (max - min);
    return Math.max(0, Math.min(1, lessIsBetter ? 1 - t : t));
  };
  // Angle mapping: goodness 0 = bottom-left (135°), 1 = bottom-right (405°).
  const angleOf = (v: number) => 135 + goodness(v) * SWEEP;

  const valueAngle = value != null && Number.isFinite(value) ? angleOf(value) : null;
  const healthyAngle = angleOf(healthyMin);
  const eliteAngle = angleOf(eliteMin);

  // Zones (drawn as colored arcs):
  //   worst: START_ANGLE → healthyAngle (amber tint)
  //   healthy: healthyAngle → eliteAngle (cyan)
  //   best: eliteAngle → end (lime)
  // The arc goes bottom-left → top → bottom-right; "good" sits at
  // the top regardless of lessIsBetter.
  const warnArc  = arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, healthyAngle);
  const healthyArc = arcPath(cx, cy, (rOuter + rInner) / 2, healthyAngle, eliteAngle);
  const eliteArc  = arcPath(cx, cy, (rOuter + rInner) / 2, eliteAngle, START_ANGLE + SWEEP);

  // Filled progress: from the dial's start (worst) up to the current
  // value angle. Same pattern as Gauge.tsx (weight) so all radials
  // share the established visual language.
  const filledPath = valueAngle != null
    ? arcPath(cx, cy, (rOuter + rInner) / 2, START_ANGLE, valueAngle)
    : '';

  // Indicator dot at current value (rim).
  const indicatorPos = valueAngle != null
    ? polar(cx, cy, (rOuter + rInner) / 2, valueAngle)
    : null;

  // Status classification.
  //   "more is better": v >= eliteMin → elite; v >= healthyMin → healthy; else warn.
  //   "less is better": v <= eliteMin → elite; v <= healthyMax → healthy; else warn.
  // For "less is better" we treat `eliteMin` as "best" (lower) and
  // `healthyMax` as "edge of healthy" (anything below is healthy).
  const status = (() => {
    if (value == null) return '—';
    if (lessIsBetter) {
      if (value <= eliteMin) return 'elite';
      if (value <= (healthyMin /* edge of healthy — same as healthyMax in threshold mode */)) return 'healthy';
      return 'warn';
    }
    if (value >= eliteMin) return 'elite';
    if (value >= healthyMin) return 'healthy';
    return 'warn';
  })();

  const statusColor = (() => {
    switch (status) {
      case 'elite': return '#9bff5c';
      case 'healthy': return '#14d6e8';
      case 'warn': return '#ffc34d';
      default: return colorHex;
    }
  })();

  // Value display
  const valueDisp = value != null ? convertForDisplay(value, meta.unit, system) : null;
  const displayUnitLabel = displayUnit(meta.unit, system);
  const isTimeUnit =
    meta.unit === 's' &&
    (metric === 'ONE_MILE_TIME' ||
      metric === 'FIVE_K_TIME' ||
      metric === 'PLANK_HOLD' ||
      metric === 'L_SIT_HOLD');
  const fmt = (v: number | null): string => {
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
      displayUnitLabel === 'bpm' ||
      displayUnitLabel === 'reps'
        ? 0
        : 2;
    return formatNumber(v, decimals);
  };

  // Healthy & elite threshold labels (formatted in user units)
  const healthyDisp = convertForDisplay(healthyMin, meta.unit, system);
  const eliteDisp = convertForDisplay(eliteMin, meta.unit, system);

  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }}>
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="overflow-visible"
        role="img"
        aria-label={`${meta.label} gauge (more is better)`}
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
            <stop offset="0%" stopColor={statusColor} stopOpacity="0.4" />
            <stop offset="100%" stopColor={statusColor} stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Zone tracks */}
        <path d={warnArc} stroke="#ffc34d" strokeOpacity="0.10" strokeWidth={rOuter - rInner} fill="none" strokeLinecap="butt" />
        <path d={healthyArc} stroke="#14d6e8" strokeOpacity="0.18" strokeWidth={rOuter - rInner} fill="none" strokeLinecap="butt" />
        <path d={eliteArc} stroke="#9bff5c" strokeOpacity="0.30" strokeWidth={rOuter - rInner} fill="none" strokeLinecap="butt" />

        {/* Filled progress — same pattern as Gauge.tsx (weight). The
            gradient keeps the trailing edge soft so the stroke blob
            at the start is invisible against the track. */}
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

        {/* Tick marks at healthy + elite thresholds + edges */}
        {[
          { v: min, big: false },
          { v: healthyMin, big: true },
          { v: eliteMin, big: true },
          { v: max, big: false },
        ].map((s, i) => {
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
        })}

        {/* Indicator dot */}
        {indicatorPos && (
          <g>
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="6" fill={statusColor} filter={`url(#glow-${id})`} />
            <circle cx={indicatorPos.x} cy={indicatorPos.y} r="3" fill="#0a0a14" />
          </g>
        )}

        {/* Center text */}
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
            fill={statusColor}
            fillOpacity="0.85"
            className="font-mono"
          >
            {status.toUpperCase()}
          </text>
        )}
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