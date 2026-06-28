import type { FrameArchetype } from '@/lib/frame';
import { useId } from 'react';
import { hairColorSlug, shirtSlug, skinSlug } from '@/lib/spriteBuckets';

export type SpriteHairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

export type SpriteAvatarProps = {
  archetype: FrameArchetype;
  hairStyle?: SpriteHairStyle;
  hairColor?: string;     // 'black' | 'blond' | 'brown' | 'TRUred' (Habitica palette)
  skinTone?: string;      // hex like '#915533' or preset name 'skin_915533'
  shirtColor?: string;    // 'black' | 'blue' | 'green' | 'redblue' | 'white' | 'yellow'
  weapon?: string;        // e.g. 'weapon_warrior_0' (without .png)
  shield?: string;        // e.g. 'shield_warrior_1'
  // Equipped item sprite IDs (relative paths under /sprites, e.g.
  // 'head/head_warrior_1', 'armor/broad_armor_rogue_2'). When set,
  // the matching sprite is layered on top of the base avatar. The
  // shirtColor stays a separate customization — equipped BODY
  // items paint OVER the chosen shirt like a chestplate.
  head?: string;
  body?: string;
  hands?: string;
  feet?: string;
  neck?: string;
  ring?: string;
  size?: number;
  className?: string;
  accentColor?: string;
  classStripe?: string | null;
};

// Hair style → Habitica sprite base name (no color suffix).
// Habitica sprites are designed to overlap at fixed pixel positions
// inside a 90×90 viewBox. We downloaded 6 styles × 4 colors = 24 files.
const HAIR_SPRITE_BASE: Record<SpriteHairStyle, string> = {
  SHORT:    'hair_bangs_1',
  LONG:     'hair_base_13',
  MOHAWK:   'hair_bangs_2',
  BUZZ:     'hair_bangs_3',
  PONYTAIL: 'hair_bangs_4',
  PIXIE:    'hair_base_10',
};


const SPRITE_BASE = '/sprites';

/**
 * Sprite-based avatar — composes Habitica pixel-art sprites (90×90 each)
 * inside a Tron-style disc frame.
 *
 * Layer order (back to front, all rendered at native 90×90 size so the
 * sprite pixels overlap correctly):
 *
 *   1. Skin sprite (the body silhouette — head + torso fill)
 *   2. Hair sprite (overlays the head area only)
 *   3. Shirt sprite (overlays the torso area only)
 *   4. Off-hand shield sprite (drawn over the body on one side)
 *   5. Main-hand weapon sprite (drawn over the body on the other side)
 *
 * Each sprite is a 90×90 PNG with transparent background — they
 * "interlock" via their content rows (hair covers y=24..50, shirt
 * covers y=54..83, skin covers y=24..68). Sprites we downloaded:
 *  - 6 hair styles × 4 colors = 24
 *  - 6 skin tones
 *  - 8 shirts
 *  - 7 weapons + 7 shields
 *
 * The disc frame preserves the identity-disc aesthetic; class stripe
 * and outer glow remain as Tron identifiers.
 *
 * Sprite source: Habitica (CC-BY-NC-SA 4.0) via habitica-images repo.
 */
export function SpriteAvatar({
  archetype,
  hairStyle = 'SHORT',
  hairColor = 'brown',
  skinTone = '#915533',
  shirtColor = '#14d6e8',
  weapon,
  shield,
  head,
  body,
  hands,
  feet,
  neck,
  ring,
  size = 140,
  className,
  accentColor,
  classStripe,
}: SpriteAvatarProps) {
  const id = useId();
  const ringColor = classStripe ?? accentColor ?? '#14d6e8';
  const innerColor = archetypeTint(archetype);

  const skinFile    = `${SPRITE_BASE}/skin/${skinSlug(skinTone)}.png`;
  const hairFile    = `${SPRITE_BASE}/hair/${HAIR_SPRITE_BASE[hairStyle]}_${hairColorSlug(hairColor)}.png`;
  const shirtFile   = `${SPRITE_BASE}/shirts/${shirtSlug(shirtColor)}.png`;
  // Equipped item sprites — the file name is the relative path
  // stored on ItemDef.sprite (e.g. 'head/head_warrior_1.png').
  // We prepend the /sprites/ base so the consumer doesn't have
  // to think about it.
  const headFile    = head    ? `${SPRITE_BASE}/${head.endsWith('.png') ? head : head + '.png'}`   : null;
  const bodyFile    = body    ? `${SPRITE_BASE}/${body.endsWith('.png') ? body : body + '.png'}`   : null;
  const handsFile   = hands   ? `${SPRITE_BASE}/${hands.endsWith('.png') ? hands : hands + '.png'}`  : null;
  const feetFile    = feet    ? `${SPRITE_BASE}/${feet.endsWith('.png') ? feet : feet + '.png'}`   : null;
  const neckFile    = neck    ? `${SPRITE_BASE}/${neck.endsWith('.png') ? neck : neck + '.png'}`   : null;
  const ringFile    = ring    ? `${SPRITE_BASE}/${ring.endsWith('.png') ? ring : ring + '.png'}`   : null;
  const weaponFile  = weapon  ? `${SPRITE_BASE}/weapon/${weapon}.png`  : null;
  const shieldFile  = shield  ? `${SPRITE_BASE}/shield/${shield}.png`  : null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 90 90"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
      className={className}
      aria-label={`${archetype} avatar (sprite)`}
    >
      <defs>
        <filter id={`sprite-glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`disc-clip-${id}`}>
          <circle cx="45" cy="45" r="42" />
        </clipPath>
        <pattern id={`disc-grid-${id}`} x="0" y="0" width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" stroke={innerColor} strokeWidth="0.3" opacity="0.2" />
        </pattern>
      </defs>

      {/* Tron disc frame */}
      <circle cx="45" cy="45" r="46" fill="#0e0f1a" />
      <circle cx="45" cy="45" r="42" fill={`url(#disc-grid-${id})`} />
      <circle
        cx="45"
        cy="45"
        r="46"
        fill="none"
        stroke={ringColor}
        strokeWidth="2"
        filter={`url(#sprite-glow-${id})`}
      />
      <circle
        cx="45"
        cy="45"
        r="42"
        fill="none"
        stroke={ringColor}
        strokeWidth="0.5"
        opacity={0.4}
      />

      {/* Sprite stack — each rendered at native 90×90. The natural
          transparency of each sprite lets the layer below show through. */}
      <g clipPath={`url(#disc-clip-${id})`}>
        {/* Skin is the body silhouette — the base everything else
            paints over. */}
        <image href={skinFile}    x="0" y="0" width="90" height="90" />

        {/* Head piece: rendered before the hair so the hair can
            paint over the helmet. */}
        {headFile && (
          <image href={headFile}  x="0" y="0" width="90" height="90" />
        )}

        {/* BODY item paints OVER the chosen shirt (e.g. a chestplate
            covers the underlying plain shirt). The user can still
            customize shirtColor as the underlayer. */}
        <image href={shirtFile}   x="0" y="0" width="90" height="90" />
        {bodyFile && (
          <image href={bodyFile}   x="0" y="0" width="90" height="90" />
        )}

        {/* Hands / feet / neck / ring paint over the body but
            under the hair / weapons so they don't cover the face. */}
        {neckFile && (
          <image href={neckFile}   x="0" y="0" width="90" height="90" />
        )}
        {handsFile && (
          <image href={handsFile}  x="0" y="0" width="90" height="90" />
        )}
        {feetFile && (
          <image href={feetFile}   x="0" y="0" width="90" height="90" />
        )}

        {/* Off-hand shield (LEFT) + main-hand weapon (RIGHT) sit
            over everything else so the user's weapons stay in
            front of their body. */}
        {shieldFile && (
          <image href={shieldFile} x="0" y="0" width="90" height="90" />
        )}
        {weaponFile && (
          <image href={weaponFile} x="0" y="0" width="90" height="90" />
        )}

        {/* Ring (cosmetic — small icon overlay) and hair on top so
            neither gets covered by the weapons. */}
        {ringFile && (
          <image href={ringFile}   x="0" y="0" width="90" height="90" />
        )}
        <image href={hairFile}    x="0" y="0" width="90" height="90" />
      </g>

      {/* Tick marks at cardinal points (Tron identifier) */}
      <g stroke={ringColor} strokeWidth="0.7" opacity={0.7}>
        <line x1="0"  y1="45" x2="3"  y2="45" />
        <line x1="87" y1="45" x2="90" y2="45" />
        <line x1="45" y1="0"  x2="45" y2="3" />
        <line x1="45" y1="87" x2="45" y2="90" />
      </g>
    </svg>
  );
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