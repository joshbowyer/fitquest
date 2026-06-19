import { useId, useMemo } from 'react';
import { METRICS, type MetricType } from '@/lib/types';
import { formatNumber } from '@/lib/format';

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
}: Props) {
  const id = useId();
  const meta = METRICS[metric];
  const colorHex = COLOR_HEX[color];
  const trackColor = BG_TRACK[color];

  const { pct, clamped, angle, tickPositions, hasValue, noMax } = useMemo(() => {
    const hasValue = value != null && Number.isFinite(value);
    const noMax = !max || !Number.isFinite(max);
    const range = max - min;
    const pct = hasValue && !noMax
      ? Math.max(0, Math.min(1, ((value as number) - min) / range))
      : 0;
    const clamped = hasValue && !noMax ? (value as number) > max : false;
    const angle = START_ANGLE + pct * SWEEP;
    const tickPositions = Array.from({ length: 11 }, (_, i) => START_ANGLE + (i / 10) * SWEEP);
    return { pct, clamped, angle, tickPositions, hasValue, noMax };
  }, [value, min, max]);

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
          {noMax ? '—' : hasValue ? formatNumber(value as number, meta.unit === 's' || meta.unit === '%' || meta.unit === 'ms' || meta.unit === 'bpm' ? 0 : 1) : '—'}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(180,180,210,0.7)"
          className="font-mono tracking-widest"
        >
          {meta.unit}
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
              {formatNumber(min, 0)}
            </text>
            <text x={180} y={170} textAnchor="end" fontSize="9" fill={colorHex} fillOpacity="0.85" className="font-mono">
              {formatNumber(max, 0)}
            </text>
          </>
        )}

        {/* Exceeded marker */}
        {clamped && (
          <text x={cx} y={cy + 50} textAnchor="middle" fontSize="9" fill="#ff2bd6" className="font-mono">
            ! EXCEEDED
          </text>
        )}
      </svg>

      <div className="mt-1 text-center">
        <div className={`text-[11px] font-display tracking-[0.2em] uppercase`} style={{ color: colorHex }}>
          {meta.shortLabel}
        </div>
        {noMax && (
          <div className="text-[10px] text-ink-300 font-mono mt-0.5">set body metrics →</div>
        )}
      </div>
    </div>
  );
}
