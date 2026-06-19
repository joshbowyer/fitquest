import { type FrameArchetype, ARCHETYPE_META } from '@/lib/frame';

export type AvatarHairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

export type AvatarProps = {
  archetype: FrameArchetype;
  /** Body fat % (0–60). Drives width scaling. */
  bodyFatPct?: number | null;
  hairStyle: AvatarHairStyle;
  hairColor: string;   // #rrggbb
  skinTone: string;    // #rrggbb
  shirtColor: string;  // #rrggbb
  pantsColor: string;  // #rrggbb
  accentColor: string;  // #rrggbb
  /** Render at this pixel size. viewBox is 16×24. */
  size?: number;
  /** Add a subtle neon outline. Default true. */
  neon?: boolean;
  className?: string;
  /** Optional class color stripe on the shirt (the user's chosen class). */
  classStripe?: string | null;
};

/**
 * Pixel-art Tron-style avatar. 9 base silhouettes (one per
 * somatotype) with body-fat-driven width scaling + custom colors.
 *
 * The drawing is 16×24 cells. Each cell is 1 unit, so the viewBox is
 * 16×24. shape-rendering="crispEdges" keeps the edges sharp at any
 * size.
 *
 * Body parts:
 *   - Head  : top 1/4 (rows 0..5)
 *   - Body  : middle 1/2 (rows 6..15)
 *   - Legs  : bottom 1/4 (rows 16..23)
 *   - Arms  : flanking the body
 *   - Hair  : overlays the head
 *   - Eyes  : two pixels on the head
 */
export function Avatar({
  archetype,
  bodyFatPct = 12,
  hairStyle,
  hairColor,
  skinTone,
  shirtColor,
  pantsColor,
  accentColor,
  size = 128,
  neon = true,
  className,
  classStripe,
}: AvatarProps) {
  // Archetype base body shape. Width/height in cell units.
  const base = baseShape(archetype);

  // Body-fat width scaling: lean=0.85x, balanced=1.0x, solid=1.18x.
  // Within each build category we further scale by bf%.
  const buildScale = widthForBuild(archetype, bodyFatPct);
  const bodyW = Math.max(3, Math.round(base.bodyW * buildScale));
  const bodyH = base.bodyH;

  // Center the body horizontally on a 16-wide canvas.
  const cx = 8;
  const bodyX = Math.round(cx - bodyW / 2);

  // Vertical layout. Total height = 24 cells.
  const headH = 5;
  const legH = 6;
  const torsoH = 24 - headH - legH;
  const headY = 0;
  const torsoY = headH;
  const legY = headY + headH + torsoH;
  const headW = Math.min(6, bodyW);
  const headX = Math.round(cx - headW / 2);

  // Limbs
  const armW = Math.max(1, Math.floor(bodyW / 4));
  const armGap = bodyW >= 6 ? 1 : 0;
  const lArmX = bodyX - armW - armGap;
  const rArmX = bodyX + bodyW + armGap;
  const armY = torsoY + 1;
  const armH = torsoH - 2;

  // Legs: split bodyW into two
  const legW = Math.max(2, Math.floor((bodyW - 1) / 2));
  const gapMid = bodyW - 2 * legW;
  const lLegX = Math.round(cx - bodyW / 2) + 0;
  const lLegMid = bodyX + Math.floor(bodyW / 2) - Math.floor(gapMid / 2);

  const meta = ARCHETYPE_META[archetype];
  const outline = '#0e0f1a'; // near-black outline
  const stroke = neon ? accentColor : outline;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 24"
      width={size}
      height={size * 1.5}
      shapeRendering="crispEdges"
      className={className}
      aria-label={`${meta.label} avatar`}
    >
      {/* Background — transparent (let panel show through) */}

      {/* Legs */}
      <rect x={bodyX} y={legY} width={legW} height={legH} fill={pantsColor} stroke={outline} />
      <rect
        x={bodyX + bodyW - legW}
        y={legY}
        width={legW}
        height={legH}
        fill={pantsColor}
        stroke={outline}
      />
      {/* Leg gap shadow */}
      <line
        x1={bodyX + legW}
        y1={legY}
        x2={bodyX + legW}
        y2={legY + legH}
        stroke={outline}
        strokeWidth={0.2}
      />

      {/* Body / shirt */}
      <rect
        x={bodyX}
        y={torsoY}
        width={bodyW}
        height={torsoH}
        fill={shirtColor}
        stroke={outline}
      />
      {/* Shirt accent stripe (class color) */}
      {classStripe && (
        <rect
          x={bodyX + Math.floor(bodyW / 2) - 1}
          y={torsoY}
          width={2}
          height={torsoH}
          fill={classStripe}
        />
      )}
      {/* Shirt collar */}
      <rect
        x={bodyX + Math.floor(bodyW / 2) - 1}
        y={torsoY}
        width={2}
        height={1}
        fill={skinTone}
        stroke={outline}
      />

      {/* Arms */}
      <rect x={lArmX} y={armY} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      <rect x={rArmX} y={armY} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      {/* Hands */}
      <rect x={lArmX} y={armY + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />
      <rect x={rArmX} y={armY + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />

      {/* Head */}
      <rect x={headX} y={headY} width={headW} height={headH} fill={skinTone} stroke={outline} />

      {/* Hair (overlay) */}
      <Hair hairStyle={hairStyle} hairColor={hairColor} accent={accentColor}
            headX={headX} headY={headY} headW={headW} headH={headH} outline={outline} />

      {/* Eyes */}
      <rect
        x={headX + 1}
        y={headY + 2}
        width={Math.max(1, Math.floor(headW / 4))}
        height={1}
        fill={accentColor}
      />
      <rect
        x={headX + headW - 1 - Math.max(1, Math.floor(headW / 4))}
        y={headY + 2}
        width={Math.max(1, Math.floor(headW / 4))}
        height={1}
        fill={accentColor}
      />
    </svg>
  );
}

function baseShape(archetype: FrameArchetype): { bodyW: number; bodyH: number } {
  // Body widths/heights in 16x24 cells. Tuned for visual variety.
  switch (archetype) {
    case 'WISP':     return { bodyW: 4, bodyH: 19 }; // small + lean
    case 'SPRITE':   return { bodyW: 5, bodyH: 19 }; // small + balanced
    case 'DRAKE':    return { bodyW: 7, bodyH: 19 }; // small + solid
    case 'STRIKER':  return { bodyW: 4, bodyH: 21 }; // medium + lean
    case 'FORGE':    return { bodyW: 5, bodyH: 21 }; // medium + balanced
    case 'GOLEM':    return { bodyW: 7, bodyH: 21 }; // medium + solid
    case 'WIRED':    return { bodyW: 4, bodyH: 23 }; // tall + lean
    case 'BEAR':     return { bodyW: 5, bodyH: 23 }; // tall + balanced
    case 'BEHEMOTH': return { bodyW: 7, bodyH: 23 }; // tall + solid
  }
}

function widthForBuild(archetype: FrameArchetype, bodyFatPct: number | null | undefined): number {
  const bf = bodyFatPct ?? 15;
  // Build category by archetype
  let baseScale: number;
  if (archetype === 'WISP' || archetype === 'STRIKER' || archetype === 'WIRED') {
    baseScale = 0.85;
  } else if (
    archetype === 'DRAKE' ||
    archetype === 'GOLEM' ||
    archetype === 'BEHEMOTH'
  ) {
    baseScale = 1.15;
  } else {
    baseScale = 1.0;
  }
  // Within a build, scale +0.5% per body-fat point above 15.
  // Capped at 1.0× wider than base.
  const bfScale = 1 + Math.max(-0.2, Math.min(0.25, (bf - 15) * 0.005));
  return baseScale * bfScale;
}

function Hair({
  hairStyle,
  hairColor,
  accent,
  headX,
  headY,
  headW,
  headH,
  outline,
}: {
  hairStyle: AvatarHairStyle;
  hairColor: string;
  accent: string;
  headX: number;
  headY: number;
  headW: number;
  headH: number;
  outline: string;
}) {
  // Top row(s) of the head.
  const topW = headW;
  switch (hairStyle) {
    case 'SHORT': {
      return (
        <rect
          x={headX}
          y={headY}
          width={topW}
          height={1}
          fill={hairColor}
          stroke={outline}
        />
      );
    }
    case 'BUZZ': {
      return (
        <rect
          x={headX}
          y={headY}
          width={topW}
          height={1}
          fill={hairColor}
        />
      );
    }
    case 'LONG': {
      return (
        <>
          <rect
            x={headX}
            y={headY}
            width={topW}
            height={1}
            fill={hairColor}
            stroke={outline}
          />
          {/* Hair falls past the head on both sides */}
          <rect
            x={headX}
            y={headY + 1}
            width={1}
            height={headH - 1}
            fill={hairColor}
            stroke={outline}
          />
          <rect
            x={headX + headW - 1}
            y={headY + 1}
            width={1}
            height={headH - 1}
            fill={hairColor}
            stroke={outline}
          />
        </>
      );
    }
    case 'MOHAWK': {
      // 1-2 wide strip down the middle of the head
      const stripW = Math.max(1, Math.floor(headW / 3));
      return (
        <>
          <rect
            x={headX + Math.floor((headW - stripW) / 2)}
            y={headY}
            width={stripW}
            height={Math.ceil(headH / 2)}
            fill={hairColor}
            stroke={outline}
          />
          {/* Tip glow */}
          <rect
            x={headX + Math.floor((headW - stripW) / 2)}
            y={headY}
            width={stripW}
            height={1}
            fill={accent}
          />
        </>
      );
    }
    case 'PONYTAIL': {
      return (
        <>
          <rect
            x={headX}
            y={headY}
            width={topW}
            height={1}
            fill={hairColor}
            stroke={outline}
          />
          <rect
            x={headX + topW}
            y={headY}
            width={1}
            height={Math.max(2, Math.floor(headH * 0.7))}
            fill={hairColor}
            stroke={outline}
          />
        </>
      );
    }
    case 'PIXIE': {
      // Slightly narrower than SHORT, with a side tuft
      return (
        <>
          <rect
            x={headX + 1}
            y={headY}
            width={topW - 2}
            height={1}
            fill={hairColor}
            stroke={outline}
          />
          <rect
            x={headX - 1}
            y={headY + 1}
            width={1}
            height={2}
            fill={hairColor}
            stroke={outline}
          />
        </>
      );
    }
  }
}
