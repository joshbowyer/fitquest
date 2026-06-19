import { type FrameArchetype, ARCHETYPE_META } from '@/lib/frame';

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
  neon?: boolean;
  className?: string;
  classStripe?: string | null;
};

/**
 * Stylized pixel avatar. 16x24 viewBox with proper human proportions:
 * head ~1/3 of total height, body has shoulders narrowing to waist,
 * jointed limbs with hands/feet, visible face.
 *
 * 9 archetype base shapes (WISP/SPRITE/DRAKE/STRIKER/FORGE/GOLEM/
 * WIRED/BEAR/BEHEMOTH) drive height + build width. Body fat %
 * scales width further. All customizations layered on top.
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
  size = 160,
  neon = true,
  className,
  classStripe,
}: AvatarProps) {
  // Build dimensions (in 16x24 cells) per archetype.
  // shoulderW (cells 0-1) is how much the body is wider at top than waist
  const dim = archetypeDims(archetype);
  const shoulderW = dim.shoulderW;
  const waistW = dim.waistW;
  const heightH = dim.bodyH; // total body (torso + head + legs)
  const headH = 6;
  const legH = 7;
  const torsoH = heightH - headH - legH;
  const cx = 8;

  // Body-fat width scaling
  const buildScale = widthForBuild(archetype, bodyFatPct);
  const shoulder = Math.max(3, Math.round(shoulderW * buildScale));
  const waist = Math.max(2, Math.round(waistW * buildScale));
  const shoulderX = Math.round(cx - shoulder / 2);
  const waistX = Math.round(cx - waist / 2);
  // Taper: top at shoulderY, bottom at waistY. We use a polyline.

  // Vertical layout
  const headY = 0;
  const torsoY = headY + headH; // 6
  const waistY = torsoY + torsoH;
  const legY = waistY;
  // Total height check: headH + torsoH + legH should = 24
  // headH=6, legH=7, so torsoH=11, total=24 ✓

  // Head
  const headW = 5;
  const headX = Math.round(cx - headW / 2);

  // Arms: drawn from shoulder corner downward
  const armW = 2;
  const armGap = 0; // touching shoulder
  const lArmX = shoulderX - armW - armGap;
  const rArmX = shoulderX + shoulder + armGap;
  const armTop = torsoY + 1;
  const armBottom = waistY - 1;
  const armH = armBottom - armTop;

  // Legs: split waist into 2, plus a small gap
  const legTotalW = waist;
  const legW = Math.max(2, Math.floor((legTotalW - 1) / 2));
  const lLegX = waistX;
  const rLegX = waistX + legW + 1;

  // Foot depth
  const footH = 1;
  const meta = ARCHETYPE_META[archetype];
  const outline = '#0e0f1a';

  // Build a T-shaped torso polygon (shoulders wider than waist).
  // As a series of horizontal rects that taper down:
  // - Top row (shoulders) is `shoulder` cells wide.
  // - Each row below shrinks by 1 cell every 2 rows until waist.
  // - Bottom row is `waist` cells wide.
  const torsoRows: Array<{ x: number; y: number; w: number }> = [];
  for (let i = 0; i < torsoH; i++) {
    const t = i / Math.max(1, torsoH - 1); // 0..1
    const w = Math.round(shoulder + (waist - shoulder) * t);
    torsoRows.push({ x: Math.round(cx - w / 2), y: torsoY + i, w });
  }

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
      {/* Legs (drawn first so the torso covers their top edge) */}
      {/* Left leg */}
      <rect x={lLegX} y={legY} width={legW} height={legH - footH} fill={pantsColor} stroke={outline} />
      {/* Right leg */}
      <rect x={rLegX} y={legY} width={legW} height={legH - footH} fill={pantsColor} stroke={outline} />
      {/* Feet */}
      <rect x={lLegX - 1} y={legY + legH - footH} width={legW + 1} height={footH} fill={outline} />
      <rect x={rLegX} y={legY + legH - footH} width={legW + 1} height={footH} fill={outline} />

      {/* Torso (tapered rows) */}
      {torsoRows.map((r, i) => (
        <rect
          key={`torso-${i}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={shirtColor}
          stroke={outline}
        />
      ))}
      {/* Class-color accent stripe down the torso center */}
      {classStripe &&
        torsoRows.map((r, i) => {
          if (r.w < 4) return null;
          const stripeX = Math.round(cx - 1 / 2);
          return (
            <rect
              key={`stripe-${i}`}
              x={stripeX}
              y={r.y}
              width={1}
              height={1}
              fill={classStripe}
            />
          );
        })}

      {/* Arms (shoulder to wrist) */}
      <rect x={lArmX} y={armTop} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      <rect x={rArmX} y={armTop} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      {/* Hands (skin) */}
      <rect x={lArmX} y={armTop + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />
      <rect x={rArmX} y={armTop + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />

      {/* Neck (1 cell below the head) */}
      <rect x={cx - 1} y={torsoY - 1} width={2} height={1} fill={skinTone} />

      {/* Head */}
      <rect x={headX} y={headY} width={headW} height={headH} fill={skinTone} stroke={outline} />

      {/* Hair (overlay on head) */}
      <Hair hairStyle={hairStyle} hairColor={hairColor} accent={accentColor}
            headX={headX} headY={headY} headW={headW} headH={headH} outline={outline} />

      {/* Face: eyes + small mouth */}
      <Eye x={headX + 1} y={headY + 3} color={accentColor} />
      <Eye x={headX + headW - 2} y={headY + 3} color={accentColor} />
      <rect x={cx - 1} y={headY + 5} width={2} height={1} fill={skinTone === '#fcd2a3' ? '#a87148' : '#5a3825'} />
    </svg>
  );
}

function Eye({ x, y, color }: { x: number; y: number; color: string }) {
  return <rect x={x} y={y} width={1} height={1} fill={color} />;
}

function archetypeDims(archetype: FrameArchetype): {
  bodyH: number;
  shoulderW: number;
  waistW: number;
} {
  // Body heights in cells. Head takes 6, legs 7, so torso = bodyH - 13.
  // Forgoes an extremely tall body since viewBox is 24 cells; we
  // differentiate archetype via proportions + build, not just height.
  switch (archetype) {
    case 'WISP':     return { bodyH: 22, shoulderW: 5, waistW: 4 }; // small + lean
    case 'SPRITE':   return { bodyH: 22, shoulderW: 6, waistW: 5 };
    case 'DRAKE':    return { bodyH: 22, shoulderW: 8, waistW: 7 };
    case 'STRIKER':  return { bodyH: 23, shoulderW: 5, waistW: 4 };
    case 'FORGE':    return { bodyH: 23, shoulderW: 6, waistW: 5 };
    case 'GOLEM':    return { bodyH: 23, shoulderW: 8, waistW: 7 };
    case 'WIRED':    return { bodyH: 24, shoulderW: 5, waistW: 4 }; // tall + lean
    case 'BEAR':     return { bodyH: 24, shoulderW: 6, waistW: 5 };
    case 'BEHEMOTH': return { bodyH: 24, shoulderW: 8, waistW: 7 };
  }
}

function widthForBuild(archetype: FrameArchetype, bodyFatPct: number | null | undefined): number {
  const bf = bodyFatPct ?? 15;
  let baseScale: number;
  if (archetype === 'WISP' || archetype === 'STRIKER' || archetype === 'WIRED') {
    baseScale = 0.9;
  } else if (
    archetype === 'DRAKE' ||
    archetype === 'GOLEM' ||
    archetype === 'BEHEMOTH'
  ) {
    baseScale = 1.2;
  } else {
    baseScale = 1.0;
  }
  // Wider as body fat % increases; capped to prevent absurd values.
  const bfScale = 1 + Math.max(-0.15, Math.min(0.2, (bf - 15) * 0.005));
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
  const full = { x: headX, y: headY, w: headW, h: 1, fill: hairColor, stroke: outline };
  switch (hairStyle) {
    case 'SHORT':
      return (
        <>
          <rect {...full} />
          {/* tiny bangs */}
          <rect x={headX + 1} y={headY + 1} width={2} height={1} fill={hairColor} />
          <rect x={headX + headW - 3} y={headY + 1} width={2} height={1} fill={hairColor} />
        </>
      );
    case 'BUZZ':
      // Hair stubble shading — a single thin row + a soft tint
      return (
        <>
          <rect x={headX + 1} y={headY} width={headW - 2} height={1} fill={hairColor} opacity={0.6} />
          {/* Tip accent: one cell glow */}
          <rect x={headX + Math.floor(headW / 2)} y={headY} width={1} height={1} fill={accent} />
        </>
      );
    case 'LONG':
      return (
        <>
          <rect {...full} />
          {/* Top fringe */}
          <rect x={headX} y={headY + 1} width={headW} height={1} fill={hairColor} />
          {/* Falls down both sides past the head */}
          <rect x={headX} y={headY + 1} width={1} height={headH - 1} fill={hairColor} stroke={outline} />
          <rect x={headX + headW - 1} y={headY + 1} width={1} height={headH - 1} fill={hairColor} stroke={outline} />
        </>
      );
    case 'MOHAWK':
      // Strip down the middle, glowing tip
      return (
        <>
          <rect
            x={headX + 1}
            y={headY}
            width={Math.max(1, headW - 2)}
            height={1}
            fill={accent}
          />
          <rect
            x={headX + 1}
            y={headY + 1}
            width={Math.max(1, headW - 2)}
            height={2}
            fill={hairColor}
          />
        </>
      );
    case 'PONYTAIL':
      return (
        <>
          <rect {...full} />
          {/* Bangs */}
          <rect x={headX} y={headY + 1} width={Math.max(1, headW - 1)} height={1} fill={hairColor} />
          {/* Tail trailing off the back-right */}
          <rect
            x={headX + headW}
            y={headY}
            width={1}
            height={Math.max(2, headH - 1)}
            fill={hairColor}
            stroke={outline}
          />
        </>
      );
    case 'PIXIE':
      return (
        <>
          <rect x={headX + 1} y={headY} width={headW - 2} height={1} fill={hairColor} stroke={outline} />
          {/* Side tuft */}
          <rect
            x={headX}
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
