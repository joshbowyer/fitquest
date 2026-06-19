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
  className?: string;
  classStripe?: string | null;
};

/**
 * Chibi-style pixel avatar. Big head (~1/3 of body), small limbs, neon
 * Tron aesthetic. Designed to look like an actual character rather
 * than a flat geometric shape.
 *
 * 9 archetype base shapes drive head/body proportions + build width.
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
  className,
  classStripe,
}: AvatarProps) {
  const dim = archetypeDims(archetype);
  const buildScale = widthForBuild(archetype, bodyFatPct);
  const headW = Math.max(7, Math.round(dim.headW * buildScale));
  const headH = 9;
  const cx = 16;
  const headX = Math.round(cx - headW / 2);
  const headY = 0;

  // Body: trapezoidal, narrower than head
  const bodyTopW = Math.max(4, headW - 2);
  const bodyBotW = Math.max(3, bodyTopW - 1);
  const bodyH = 6;
  const bodyY = headY + headH;
  const bodyTopX = Math.round(cx - bodyTopW / 2);
  const bodyBotX = Math.round(cx - bodyBotW / 2);

  // Legs
  const legH = 6;
  const legY = bodyY + bodyH;
  const legW = 2;
  const lLegX = bodyBotX;
  const rLegX = bodyBotX + bodyBotW - legW;

  // Arms (start at body top, beside shoulders)
  const armW = 2;
  const armH = 5;
  const armY = bodyY + 1;
  const lArmX = bodyTopX - armW;
  const rArmX = bodyTopX + bodyTopW;

  const meta = ARCHETYPE_META[archetype];
  const outline = '#0e0f1a';
  // Neon glow on the head outline (Tron-style)
  const glow = accentColor;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 22"
      width={size}
      height={size * 1.375}
      shapeRendering="crispEdges"
      className={className}
      aria-label={`${meta.label} avatar`}
    >
      {/* Body — tapered: top row (shoulders) full width, bottom row (waist) one cell narrower */}
      {Array.from({ length: bodyH }).map((_, i) => {
        const t = i / Math.max(1, bodyH - 1);
        const w = Math.round(bodyTopW + (bodyBotW - bodyTopW) * t);
        const x = Math.round(cx - w / 2);
        return (
          <rect
            key={`body-${i}`}
            x={x}
            y={bodyY + i}
            width={w}
            height={1}
            fill={shirtColor}
            stroke={outline}
          />
        );
      })}
      {/* Class-color accent stripe down the torso center */}
      {classStripe &&
        bodyTopW >= 5 &&
        Array.from({ length: bodyH - 1 }).map((_, i) => (
          <rect
            key={`stripe-${i}`}
            x={cx - 1}
            y={bodyY + i + 1}
            width={2}
            height={1}
            fill={classStripe}
          />
        ))}

      {/* Arms */}
      <rect x={lArmX} y={armY} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      <rect x={rArmX} y={armY} width={armW} height={armH} fill={shirtColor} stroke={outline} />
      {/* Hands */}
      <rect x={lArmX} y={armY + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />
      <rect x={rArmX} y={armY + armH - 1} width={armW} height={1} fill={skinTone} stroke={outline} />

      {/* Legs */}
      <rect x={lLegX} y={legY} width={legW} height={legH - 1} fill={pantsColor} stroke={outline} />
      <rect x={rLegX} y={legY} width={legW} height={legH - 1} fill={pantsColor} stroke={outline} />
      {/* Feet */}
      <rect x={lLegX - 1} y={legY + legH - 1} width={legW + 1} height={1} fill={outline} />
      <rect x={rLegX} y={legY + legH - 1} width={legW + 1} height={1} fill={outline} />

      {/* Head — drawn LAST so hair sits on top */}
      <Head
        archetype={archetype}
        headX={headX}
        headY={headY}
        headW={headW}
        headH={headH}
        skinTone={skinTone}
        hairColor={hairColor}
        accentColor={accentColor}
        hairStyle={hairStyle}
        outline={outline}
        glow={glow}
      />
    </svg>
  );
}

function Head({
  archetype,
  headX,
  headY,
  headW,
  headH,
  skinTone,
  hairColor,
  accentColor,
  hairStyle,
  outline,
  glow,
}: {
  archetype: FrameArchetype;
  headX: number;
  headY: number;
  headW: number;
  headH: number;
  skinTone: string;
  hairColor: string;
  accentColor: string;
  hairStyle: AvatarHairStyle;
  outline: string;
  glow: string;
}) {
  const cx = headX + Math.floor(headW / 2);
  // Eye positions
  const eyeY = headY + 4;
  const eyeSize = Math.max(1, Math.floor(headW / 5));
  const eyeGap = Math.max(1, Math.floor(headW / 4));
  const lEyeX = cx - eyeGap - eyeSize;
  const rEyeX = cx + eyeGap;
  // Mouth: a small line under the eyes
  const mouthY = headY + 6;
  const mouthW = Math.max(1, Math.floor(headW / 2));
  // Cheeks: small accent dots
  const cheekY = headY + 5;

  return (
    <g>
      {/* Head fill */}
      <rect x={headX} y={headY} width={headW} height={headH} fill={skinTone} stroke={outline} />

      {/* Hair (top half of head) */}
      <Hair hairStyle={hairStyle}
            hairColor={hairColor}
            accent={accentColor}
            glow={glow}
            headX={headX} headY={headY} headW={headW} headH={headH}
            outline={outline} />

      {/* Eyes — Tron glow */}
      <rect x={lEyeX} y={eyeY} width={eyeSize} height={eyeSize} fill={glow} />
      <rect x={rEyeX} y={eyeY} width={eyeSize} height={eyeSize} fill={glow} />
      {/* Eye highlights */}
      <rect x={lEyeX} y={eyeY} width={1} height={1} fill="#fafafd" />
      <rect x={rEyeX} y={eyeY} width={1} height={1} fill="#fafafd" />

      {/* Cheeks (subtle pink/cyan) */}
      {headW >= 7 && (
        <>
          <rect x={headX + 1} y={cheekY} width={1} height={1} fill="#f55cc4" opacity={0.5} />
          <rect x={headX + headW - 2} y={cheekY} width={1} height={1} fill="#f55cc4" opacity={0.5} />
        </>
      )}

      {/* Mouth — a small darker line */}
      <rect
        x={cx - Math.floor(mouthW / 2)}
        y={mouthY}
        width={mouthW}
        height={1}
        fill="#5a3825"
      />
    </g>
  );
}

function Hair({
  hairStyle,
  hairColor,
  accent,
  glow,
  headX,
  headY,
  headW,
  headH,
  outline,
}: {
  hairStyle: AvatarHairStyle;
  hairColor: string;
  accent: string;
  glow: string;
  headX: number;
  headY: number;
  headW: number;
  headH: number;
  outline: string;
}) {
  const cx = headX + Math.floor(headW / 2);
  switch (hairStyle) {
    case 'SHORT':
      return (
        <>
          {/* Top + side fringe */}
          <rect x={headX} y={headY} width={headW} height={2} fill={hairColor} stroke={outline} />
          <rect x={headX + 1} y={headY + 2} width={2} height={1} fill={hairColor} />
          <rect x={headX + headW - 3} y={headY + 2} width={2} height={1} fill={hairColor} />
          {/* Glowing accent strand */}
          <rect x={cx - 1} y={headY} width={2} height={1} fill={glow} />
        </>
      );
    case 'BUZZ':
      return (
        <>
          {/* Stubble shading — translucent row + glow tip */}
          <rect x={headX + 1} y={headY} width={headW - 2} height={1} fill={hairColor} opacity={0.6} />
          <rect x={cx} y={headY} width={1} height={1} fill={glow} />
        </>
      );
    case 'LONG':
      return (
        <>
          {/* Full top + side hair past the head */}
          <rect x={headX} y={headY} width={headW} height={3} fill={hairColor} stroke={outline} />
          <rect x={headX} y={headY + 3} width={1} height={headH - 3} fill={hairColor} stroke={outline} />
          <rect x={headX + headW - 1} y={headY + 3} width={1} height={headH - 3} fill={hairColor} stroke={outline} />
          {/* Glowing streak */}
          <rect x={cx - 1} y={headY} width={2} height={1} fill={glow} />
        </>
      );
    case 'MOHAWK':
      return (
        <>
          {/* Strip down the middle, glowing tip */}
          <rect x={headX + 1} y={headY} width={headW - 2} height={1} fill={glow} />
          <rect x={headX + 1} y={headY + 1} width={headW - 2} height={2} fill={hairColor} stroke={outline} />
        </>
      );
    case 'PONYTAIL':
      return (
        <>
          <rect x={headX} y={headY} width={headW} height={2} fill={hairColor} stroke={outline} />
          {/* Bangs */}
          <rect x={headX + 1} y={headY + 2} width={Math.max(1, headW - 2)} height={1} fill={hairColor} />
          {/* Tail off the back */}
          <rect
            x={headX + headW}
            y={headY}
            width={1}
            height={Math.max(2, headH - 2)}
            fill={hairColor}
            stroke={outline}
          />
          {/* Glowing hair tie */}
          <rect x={headX + headW} y={headY} width={1} height={1} fill={accent} />
        </>
      );
    case 'PIXIE':
      return (
        <>
          <rect x={headX + 1} y={headY} width={headW - 2} height={1} fill={hairColor} stroke={outline} />
          <rect x={headX + 1} y={headY + 1} width={headW - 2} height={1} fill={hairColor} />
          {/* Side tuft */}
          <rect x={headX} y={headY + 2} width={1} height={2} fill={hairColor} stroke={outline} />
          <rect x={headX + 1} y={headY} width={1} height={1} fill={glow} />
        </>
      );
  }
}

function archetypeDims(archetype: FrameArchetype): { headW: number } {
  switch (archetype) {
    case 'WISP':     return { headW: 7 }; // small + lean
    case 'SPRITE':   return { headW: 8 };
    case 'DRAKE':    return { headW: 9 }; // small + solid
    case 'STRIKER':  return { headW: 7 };
    case 'FORGE':    return { headW: 8 };
    case 'GOLEM':    return { headW: 9 };
    case 'WIRED':    return { headW: 7 }; // tall + lean (height via headH? we use 9)
    case 'BEAR':     return { headW: 8 };
    case 'BEHEMOTH': return { headW: 9 };
  }
}

function widthForBuild(archetype: FrameArchetype, bodyFatPct: number | null | undefined): number {
  const bf = bodyFatPct ?? 15;
  let baseScale: number;
  if (archetype === 'WISP' || archetype === 'STRIKER' || archetype === 'WIRED') {
    baseScale = 0.92;
  } else if (
    archetype === 'DRAKE' ||
    archetype === 'GOLEM' ||
    archetype === 'BEHEMOTH'
  ) {
    baseScale = 1.1;
  } else {
    baseScale = 1.0;
  }
  const bfScale = 1 + Math.max(-0.1, Math.min(0.15, (bf - 15) * 0.004));
  return baseScale * bfScale;
}
