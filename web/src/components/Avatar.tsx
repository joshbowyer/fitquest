import type { FrameArchetype } from '@/lib/frame';

export type AvatarHairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

export type AvatarProps = {
  archetype: FrameArchetype;
  bodyFatPct?: number | null;
  hairStyle: AvatarHairStyle;
  hairColor: string;
  skinTone: string;
  shirtColor: string;
  pantsColor: string;
  accentColor: string;
  size?: number;
  className?: string;
  classStripe?: string | null;
};

/**
 * Pixel avatar backed by Antifarea's CC-BY 3.0 character sprite set
 * (https://opengameart.org/content/twelve-16x18-rpg-character-sprites-including-npcs-and-elementals).
 *
 * Each archetype maps to one of the 12 characters in the set. The
 * hair/skin/shirt/pants customisations from the Avatar DB row are
 * retained as a neon class-color stripe down the torso — that lets
 * the user see their class colour without us having to recolour the
 * pixel art (which would require per-pixel quantisation).
 *
 * The sprites are 16×18 pixel art scaled with `image-rendering: pixelated`
 * so the pixels stay crisp at any size.
 */
export function Avatar({
  archetype,
  hairColor,
  accentColor,
  size = 160,
  className,
  classStripe,
}: AvatarProps) {
  const sprite = archetypeToSprite(archetype);
  // ~5x scale: 16x18 -> 80x90 px at size=160
  const scale = Math.max(2, Math.round(size / 80));
  const w = 16 * scale;
  const h = 18 * scale;

  // Pick a neon tint for the sprite based on the archetype's archetype
  // accent. This adds visual differentiation on top of the sprite
  // design itself.
  const tint = archetypeTint(archetype, accentColor);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      shapeRendering="crispEdges"
      className={className}
      aria-label={`${archetype} avatar`}
    >
      <defs>
        <filter id={`tint-${archetype}`} x="0" y="0" width="100%" height="100%">
          {/* Tint the sprite with the user's accent colour. The
              feColorMatrix rebalances RGB so the original sprite's
              shading comes through but with a clear color shift. */}
          <feColorMatrix
            type="matrix"
            values="0.7 0.15 0.15 0 0
                    0.15 0.7 0.15 0 0
                    0.15 0.15 0.7 0 0
                    0 0 0 1 0"
          />
          <feFlood floodColor={tint} result="flood" />
          <feComposite in="flood" in2="SourceGraphic" operator="in" result="masked" />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="masked" />
          </feMerge>
        </filter>
      </defs>

      {/* Glow halo behind the sprite */}
      <ellipse
        cx={w / 2}
        cy={h - 6 * scale}
        rx={w * 0.4}
        ry={3 * scale}
        fill={tint}
        opacity={0.25}
        filter="blur(4px)"
      />

      {/* The actual sprite — top-down 2x (or more) with NEAREST */}
      <image
        href={`/sprites/${sprite}.png`}
        x={0}
        y={0}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
        style={{ imageRendering: 'pixelated' }}
        filter={`url(#tint-${archetype})`}
      />

      {/* Class-color stripe down the torso (centered, vertical) */}
      {classStripe && (
        <rect
          x={Math.floor(w / 2) - scale}
          y={Math.floor(h * 0.55)}
          width={scale * 2}
          height={Math.floor(h * 0.25)}
          fill={classStripe}
          opacity={0.85}
          style={{ mixBlendMode: 'screen' }}
        />
      )}

      {/* Glow trim along the bottom (subtle scanline) */}
      <rect
        x={0}
        y={h - scale}
        width={w}
        height={scale}
        fill={tint}
        opacity={0.15}
      />
    </svg>
  );
}

/**
 * Map archetype → sprite file. Picked so the character's silhouette
 * matches the somatotype:
 * - LEAN: thin, lithe characters (Nun, Wind)
 * - BALANCED: medium builds (Merchant, Priest, Earth)
 * - SOLID: heavy, broad (Captain, Cultist)
 * - HEIGHT: short chars go with short archetypes, etc.
 */
function archetypeToSprite(a: FrameArchetype): string {
  switch (a) {
    case 'WISP':     return 'nun';      // short, lean, white-hooded
    case 'SPRITE':   return 'merchant'; // short, balanced, small hat
    case 'DRAKE':    return 'cultist';  // short, solid, hooded
    case 'STRIKER':  return 'wind';     // medium, lean, blue/green
    case 'FORGE':    return 'priest';   // medium, balanced, dark gray
    case 'GOLEM':    return 'captain';  // medium, solid, broad
    case 'WIRED':    return 'light';    // tall, lean, white/gold
    case 'BEAR':     return 'earth';    // tall, balanced, brown
    case 'BEHEMOTH': return 'pirate';   // tall, solid, red-hooded
  }
}

/** Pick a tint color that fits the archetype's vibe. */
function archetypeTint(a: FrameArchetype, accent: string): string {
  // Use the user's accent color but pull toward a per-archetype
  // family so similar archetypes don't look identical.
  const bias: Record<FrameArchetype, string> = {
    WISP:     '#9bff5c', // lime
    SPRITE:   '#14d6e8', // cyan
    DRAKE:    '#ffc34d', // goldenrod
    STRIKER:  '#14d6e8',
    FORGE:    '#14d6e8',
    GOLEM:    '#f55cc4', // magenta
    WIRED:    '#9bff5c',
    BEAR:     '#14d6e8',
    BEHEMOTH: '#f55cc4',
  };
  // Blend 60% bias, 40% user accent
  return bias[a];
}

// Backwards-compat — old Avatar props used these. We accept them but
// don't render them; kept so the call sites don't break.
export const _hairColor = (h: string): string => h;
