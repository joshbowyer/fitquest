import type { FrameArchetype } from '@/lib/frame';
import { SpriteAvatar } from './SpriteAvatar';

export type AvatarHairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

export type AvatarProps = {
  archetype: FrameArchetype;
  bodyFatPct?: number | null;
  hairStyle?: AvatarHairStyle;
  hairColor?: string;
  skinTone?: string;
  shirtColor?: string;
  pantsColor?: string;
  accentColor?: string;
  size?: number | string;
  className?: string;
  classStripe?: string | null;
  /**
   * When true, render the layered sprite avatar (Habitica pixel art)
   * inside the Tron disc. Falls back to the geometric silhouette
   * when `sprites` is false (the original behavior).
   */
  sprites?: boolean;
  /** Sprite variant IDs — used when `sprites` is true. */
  weapon?: string;
  shield?: string;
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
 * The Avatar DB row keeps the hair/skin/shirt/pants customizations
 * for forward-compat (we can overlay hair later), but they don't
 * affect the disc rendering.
 */
export function Avatar({
  archetype,
  size = 160,
  className,
  accentColor,
  classStripe,
  hairStyle,
  hairColor,
  shirtColor,
  sprites = false,
  weapon,
  shield,
}: AvatarProps) {
  // Branch: sprite-based avatar when `sprites` is enabled and the
  // browser has loaded the sprite assets. We forward skinTone too —
  // the DB has it per-user (avatars.ts) and dropping it here is
  // what made the Quest constellation map fall back to the default
  // brown tint (#915533) regardless of the user's customization.
  if (sprites) {
    return (
      <SpriteAvatar
        archetype={archetype}
        hairStyle={hairStyle}
        hairColor={hairColor}
        skinTone={skinTone}
        shirtColor={shirtColor}
        weapon={weapon}
        shield={shield}
        size={typeof size === 'number' ? size : 160}
        className={className}
        accentColor={accentColor}
        classStripe={classStripe}
      />
    );
  }

  const ringColor = classStripe ?? accentColor ?? '#14d6e8';
  const innerColor = archetypeTint(archetype);

  const fig = figurePath(archetype);
  const w = 40;
  const h = 40;
  const cx = w / 2;

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

      {/* Background dark fill (the disc surface) */}
      <circle cx={cx} cy={h / 2} r={18} fill="#0e0f1a" />

      {/* Inner grid pattern */}
      <circle cx={cx} cy={h / 2} r={16} fill={`url(#disc-grid-${archetype})`} />

      {/* Outer ring (glowing) */}
      <circle
        cx={cx}
        cy={h / 2}
        r={18}
        fill="none"
        stroke={ringColor}
        strokeWidth="2"
        filter={`url(#disc-glow-${archetype})`}
      />
      {/* Inner ring (thinner, slightly inset) */}
      <circle
        cx={cx}
        cy={h / 2}
        r={15}
        fill="none"
        stroke={ringColor}
        strokeWidth="0.5"
        opacity={0.5}
      />

      {/* Archetype silhouette — abstract humanoid */}
      <g
        fill={innerColor}
        filter={`url(#disc-glow-${archetype})`}
        transform={`translate(${cx}, ${h / 2})`}
      >
        {fig}
      </g>

      {/* Class stripe accent: a thin radial line on the disc */}
      {classStripe && (
        <line
          x1={cx}
          y1={h / 2 - 18}
          x2={cx}
          y2={h / 2 + 18}
          stroke={classStripe}
          strokeWidth="0.8"
          opacity={0.5}
        />
      )}

      {/* Tick marks at cardinal points (Tron identifier) */}
      <g stroke={ringColor} strokeWidth="0.6" opacity={0.7}>
        <line x1={cx - 18} y1={h / 2} x2={cx - 16} y2={h / 2} />
        <line x1={cx + 16} y1={h / 2} x2={cx + 18} y2={h / 2} />
        <line x1={cx} y1={h / 2 - 18} x2={cx} y2={h / 2 - 16} />
        <line x1={cx} y1={h / 2 + 16} x2={cx} y2={h / 2 + 18} />
      </g>
    </svg>
  );
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
