import type { FrameArchetype } from '@/lib/frame';

export type AvatarProps = {
  archetype: FrameArchetype;
  bodyFatPct?: number | null;
  /// Static body measurements (cm). When provided, the disc radius,
  /// inner ring, and figure scale/position adapt so a 6'/28in/44in
  /// build looks visibly different from a 5'/32in/42in build. All
  /// optional — missing values fall back to the archetype defaults.
  shoulderCm?: number | null;
  waistCm?: number | null;
  heightCm?: number | null;
  accentColor?: string;
  size?: number | string;
  className?: string;
  classStripe?: string | null;
};

/**
 * Tron identity-disc style avatar.
 *
 * Each archetype is represented as a glowing circular disc with a
 * stylized humanoid silhouette inside. The silhouette's proportions
 * match the somatotype (lean = thin lines, solid = thicker shapes,
 * tall = elongated, etc.).
 *
 * - 40×40 viewBox at default size 160 (4× scale, chunky pixels)
 * - Outer ring: archetype color + class stripe
 * - Inner figure: simple Tron-style humanoid in the class color
 * - Glow filter on the ring
 * - Background grid pattern hinting at the digital world
 *
 * Sprites are gone — the catalog now ships Tron-style gear icons
 * under /sprites/gear/ and the class portrait under
 * /sprites/class-portraits/. Those are rendered as separate <img>
 * tags at call sites, not layered into this disc.
 */
export function Avatar({
  archetype,
  size = 160,
  className,
  accentColor,
  classStripe,
  shoulderCm,
  waistCm,
  heightCm,
}: AvatarProps) {
  const ringColor = classStripe ?? accentColor ?? '#14d6e8';
  const innerColor = archetypeTint(archetype);

  const fig = figurePath(archetype);
  const w = 40;
  const h = 40;
  const cx = w / 2;

  // Measurement-based scaling. Reference values are "average adult
  // male" — 110cm shoulders, 80cm waist, 175cm height — that map to a
  // 1.0x scale. Clamps keep the disc from looking weird (e.g. a
  // 60cm shoulder doesn't shrink the disc to half size).
  const shoulderScale = clampScale(shoulderCm, 110, 0.92, 1.10);
  const waistScale = clampScale(waistCm, 80, 0.88, 1.10);
  const heightScale = clampScale(heightCm, 175, 0.92, 1.10);
  // Outer ring scales with shoulders (broader → bigger disc).
  const outerR = 18 * shoulderScale;
  // Inner ring scales with waist (tighter waist → larger inner ring,
  // i.e. less gap to the outer). Inverse of waistScale so a small
  // waist gives a big inner ring.
  const innerR = 15 / Math.sqrt(waistScale);
  // Vertical figure scale — taller users get an elongated silhouette.
  // Width stays constant (archetype-controlled). Applied via a
  // scale transform on the <g> wrapper around the figure.
  const figScaleY = heightScale;
  // Figure y-offset — taller users shift the figure up so it stays
  // centered in the disc.
  const figYOffset = -(heightScale - 1) * 4;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={size ?? '100%'}
      height={size ?? '100%'}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
      className={className}
      aria-label={`${archetype} avatar`}
    >
      <defs>
        <filter id={`disc-glow-${archetype}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id={`disc-grid-${archetype}`} x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M 4 0 L 0 0 0 4" fill="none" stroke={innerColor} strokeWidth="0.3" opacity="0.25" />
        </pattern>
      </defs>

      {/* Background dark fill (the disc surface). R = outerR. */}
      <circle cx={cx} cy={h / 2} r={outerR} fill="#0e0f1a" />

      {/* Inner grid pattern — slightly inset from outerR for visual ring. */}
      <circle cx={cx} cy={h / 2} r={outerR - 2} fill={`url(#disc-grid-${archetype})`} />

      {/* Outer ring (glowing) — radius scales with shoulder width. */}
      <circle
        cx={cx}
        cy={h / 2}
        r={outerR}
        fill="none"
        stroke={ringColor}
        strokeWidth="2"
        filter={`url(#disc-glow-${archetype})`}
      />
      {/* Inner ring (thinner, slightly inset) — radius scales with waist
          (tighter waist → larger inner ring, less gap to the outer). */}
      <circle
        cx={cx}
        cy={h / 2}
        r={innerR}
        fill="none"
        stroke={ringColor}
        strokeWidth="0.5"
        opacity={0.5}
      />

      {/* Archetype silhouette — abstract humanoid. Vertical scale
          (taller users → elongated figure) + y-offset (taller users
          → figure shifts up to stay centered in the disc). */}
      <g
        fill={innerColor}
        filter={`url(#disc-glow-${archetype})`}
        transform={`translate(${cx}, ${h / 2 + figYOffset}) scale(1, ${figScaleY})`}
      >
        {fig}
      </g>

      {/* Class stripe accent: a thin radial line on the disc */}
      {classStripe && (
        <line
          x1={cx}
          y1={h / 2 - outerR}
          x2={cx}
          y2={h / 2 + outerR}
          stroke={classStripe}
          strokeWidth="0.8"
          opacity={0.5}
        />
      )}

      {/* Tick marks at cardinal points (Tron identifier) — span
          the full outer ring radius. */}
      <g stroke={ringColor} strokeWidth="0.6" opacity={0.7}>
        <line x1={cx - outerR} y1={h / 2} x2={cx - (outerR - 2)} y2={h / 2} />
        <line x1={cx + (outerR - 2)} y1={h / 2} x2={cx + outerR} y2={h / 2} />
        <line x1={cx} y1={h / 2 - outerR} x2={cx} y2={h / 2 - (outerR - 2)} />
        <line x1={cx} y1={h / 2 + (outerR - 2)} x2={cx} y2={h / 2 + outerR} />
      </g>
    </svg>
  );
}

/**
 * Clamp a measurement-driven scale to a [min, max] range around 1.0.
 * When the measurement is null/undefined, returns 1.0 (no scaling —
 * the archetype defaults win). Math is linear: measurement=ref → 1.0;
 * measurement=2*ref → 2.0 (clamped). The narrow band (±8-12%) keeps the
 * disc from looking too lopsided at extreme measurements.
 */
function clampScale(
  value: number | null | undefined,
  ref: number,
  min: number,
  max: number,
): number {
  if (value == null) return 1;
  return Math.min(max, Math.max(min, value / ref));
}

/**
 * Abstract humanoid silhouette per archetype.
 * Each is a small set of <rect> shapes centered on (0, 0).
 * Coordinates are relative to the center.
 *
 *   - HEAD: small square top
 *   - TORSO: medium rectangle middle
 *   - ARMS: 2 small rectangles beside torso
 *   - LEGS: 2 rectangles below torso
 */
function figurePath(a: FrameArchetype): JSX.Element {
  switch (a) {
    case 'WISP':
      // Short lean — small head, narrow torso, short limbs
      return (
        <g>
          <rect x={-1.5} y={-8} width={3} height={3} />
          <rect x={-2} y={-5} width={4} height={5} />
          <rect x={-4} y={-4} width={1.5} height={4} />
          <rect x={2.5} y={-4} width={1.5} height={4} />
          <rect x={-2} y={0} width={1.5} height={6} />
          <rect x={0.5} y={0} width={1.5} height={6} />
        </g>
      );
    case 'SPRITE':
      // Short balanced
      return (
        <g>
          <rect x={-2} y={-9} width={4} height={3} />
          <rect x={-3} y={-6} width={6} height={5} />
          <rect x={-5} y={-5} width={2} height={4} />
          <rect x={3} y={-5} width={2} height={4} />
          <rect x={-3} y={-1} width={2} height={6} />
          <rect x={1} y={-1} width={2} height={6} />
        </g>
      );
    case 'DRAKE':
      // Short solid — wide torso, short limbs
      return (
        <g>
          <rect x={-2} y={-9} width={4} height={3} />
          <rect x={-4} y={-6} width={8} height={5} />
          <rect x={-6} y={-5} width={2} height={3} />
          <rect x={4} y={-5} width={2} height={3} />
          <rect x={-3} y={-1} width={2.5} height={6} />
          <rect x={0.5} y={-1} width={2.5} height={6} />
        </g>
      );
    case 'STRIKER':
      // Medium lean
      return (
        <g>
          <rect x={-2} y={-10} width={4} height={3} />
          <rect x={-2.5} y={-7} width={5} height={6} />
          <rect x={-4.5} y={-6} width={2} height={5} />
          <rect x={2.5} y={-6} width={2} height={5} />
          <rect x={-2.5} y={-1} width={2} height={7} />
          <rect x={0.5} y={-1} width={2} height={7} />
        </g>
      );
    case 'FORGE':
      // Medium balanced — the default "classic" silhouette
      return (
        <g>
          <rect x={-2} y={-10} width={4} height={3} />
          <rect x={-3} y={-7} width={6} height={6} />
          <rect x={-5} y={-6} width={2} height={5} />
          <rect x={3} y={-6} width={2} height={5} />
          <rect x={-3} y={-1} width={2.5} height={7} />
          <rect x={0.5} y={-1} width={2.5} height={7} />
        </g>
      );
    case 'GOLEM':
      // Medium solid — wide shoulders
      return (
        <g>
          <rect x={-2} y={-10} width={4} height={3} />
          <rect x={-4} y={-7} width={8} height={6} />
          <rect x={-6} y={-6} width={2} height={4} />
          <rect x={4} y={-6} width={2} height={4} />
          <rect x={-4} y={-1} width={3} height={7} />
          <rect x={1} y={-1} width={3} height={7} />
        </g>
      );
    case 'WIRED':
      // Tall lean — elongated
      return (
        <g>
          <rect x={-1.5} y={-12} width={3} height={3} />
          <rect x={-2} y={-9} width={4} height={7} />
          <rect x={-4} y={-8} width={1.5} height={6} />
          <rect x={2.5} y={-8} width={1.5} height={6} />
          <rect x={-2} y={-2} width={1.5} height={9} />
          <rect x={0.5} y={-2} width={1.5} height={9} />
        </g>
      );
    case 'BEAR':
      // Tall balanced
      return (
        <g>
          <rect x={-2} y={-12} width={4} height={3} />
          <rect x={-3} y={-9} width={6} height={7} />
          <rect x={-5} y={-8} width={2} height={6} />
          <rect x={3} y={-8} width={2} height={6} />
          <rect x={-3} y={-2} width={2.5} height={9} />
          <rect x={0.5} y={-2} width={2.5} height={9} />
        </g>
      );
    case 'BEHEMOTH':
      // Tall solid — biggest silhouette
      return (
        <g>
          <rect x={-2.5} y={-12} width={5} height={3} />
          <rect x={-4} y={-9} width={8} height={7} />
          <rect x={-6} y={-8} width={2} height={5} />
          <rect x={4} y={-8} width={2} height={5} />
          <rect x={-4} y={-2} width={3} height={9} />
          <rect x={1} y={-2} width={3} height={9} />
        </g>
      );
  }
}

function archetypeTint(a: FrameArchetype): string {
  const bias: Record<FrameArchetype, string> = {
    WISP:     '#9bff5c',
    SPRITE:   '#14d6e8',
    DRAKE:    '#ffc34d',
    STRIKER:  '#14d6e8',
    FORGE:    '#14d6e8',
    GOLEM:    '#f55cc4',
    WIRED:    '#9bff5c',
    BEAR:     '#14d6e8',
    BEHEMOTH: '#f55cc4',
  };
  return bias[a];
}
