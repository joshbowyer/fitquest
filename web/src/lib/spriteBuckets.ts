/**
 * Shared sprite-bucket helpers used by both <SpriteAvatar> (the live
 * preview) and <HairThumb> (the customization picker). Keeping a
 * single source of truth so the swatch you click always matches the
 * sprite you see.
 *
 * Habitica ships fixed sprite sets — they don't recolour per user.
 * We download a representative set (black/brown/blond/TRUred hair,
 * 6 skin tones, 8 broad_shirts, ~7 weapons + 7 shields) and bucket
 * any free-form hex into the closest preset via HSL.
 */

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 0xff) / 255;
  let g = ((n >> 8) & 0xff) / 255;
  let b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

// Habitica hair color presets we have downloaded.
const HAIR_PRESETS = ['black', 'brown', 'blond', 'TRUred'] as const;
export type HairColorPreset = typeof HAIR_PRESETS[number];

/**
 * Map an arbitrary hex (or exact preset name) to one of the four
 * Habitica hair color presets we have sprites for. Uses HSL hue +
 * lightness to bucket reliably across warm/cool tints.
 */
export function hairColorSlug(hex: string | undefined, fallback: HairColorPreset = 'brown'): HairColorPreset {
  if (!hex) return fallback;
  const h = hex.toLowerCase().trim();
  if ((HAIR_PRESETS as readonly string[]).includes(h)) return h as HairColorPreset;
  const hsl = hexToHsl(h);
  if (!hsl) return fallback;
  const { h: hue, s, l } = hsl;
  if (l < 22) return 'black';
  if (l < 45 && hue >= 10 && hue <= 50 && s > 20) return 'brown';
  if (l > 55 && hue >= 30 && hue <= 60) return 'blond';
  if (s > 35 && ((hue >= 0 && hue <= 25) || (hue >= 320 && hue <= 360))) return 'TRUred';
  return 'brown';
}

// Habitica broad_shirt presets we have downloaded.
const SHIRT_PRESETS = [
  'broad_shirt_black', 'broad_shirt_blue', 'broad_shirt_green',
  'broad_shirt_pink', 'broad_shirt_purple', 'broad_shirt_white',
  'broad_shirt_yellow', 'slim_shirt_black', 'slim_shirt_blue',
] as const;
export type ShirtPreset = typeof SHIRT_PRESETS[number];

/**
 * Map an arbitrary hex to the closest broad_shirt preset. We use the
 * solid-coloured shirts (pink/purple) for the magenta hue range —
 * `broad_shirt_redblue` is a half-red half-blue checker that reads as
 * a "missing texture" pattern, so we skip it intentionally.
 */
export function shirtSlug(hex: string | undefined, fallback: ShirtPreset = 'broad_shirt_blue'): ShirtPreset {
  if (!hex) return fallback;
  const h = hex.toLowerCase().trim();
  if ((SHIRT_PRESETS as readonly string[]).includes(h)) return h as ShirtPreset;
  const hsl = hexToHsl(h);
  if (!hsl) return fallback;
  const { h: hue, s, l } = hsl;
  if (l < 22) return 'broad_shirt_black';
  if (l > 78 && s < 25) return 'broad_shirt_white';
  if (hue >= 35 && hue <= 65 && s > 40) return 'broad_shirt_yellow';
  if (hue >= 80 && hue <= 165) return 'broad_shirt_green';
  if (hue >= 180 && hue <= 260) return 'broad_shirt_blue';
  // Magenta / red — pick pink (warmer) for hue 280-330, purple (cooler) above
  if (hue >= 280 && hue <= 330) return 'broad_shirt_pink';
  if ((hue >= 331 && hue <= 360) || (hue >= 0 && hue <= 25)) return 'broad_shirt_pink';
  // Hue 260-280 falls between blue and purple — go purple
  if (hue >= 260 && hue <= 280) return 'broad_shirt_purple';
  return 'broad_shirt_blue';
}

// Skin tone presets we have downloaded (Habitica uses raw hex names).
const SKIN_PRESETS: Record<string, string> = {
  '#915533': 'skin_915533',
  '#c06534': 'skin_c06534',
  '#ea8349': 'skin_ea8349',
  '#f5a76e': 'skin_f5a76e',
  '#ddc994': 'skin_ddc994',
  '#98461a': 'skin_98461a',
};

export function skinSlug(hex: string | undefined, fallback = 'skin_915533'): string {
  if (!hex) return fallback;
  const h = hex.toLowerCase().trim();
  if (SKIN_PRESETS[h]) return SKIN_PRESETS[h];
  const hsl = hexToHsl(h);
  if (!hsl) return fallback;
  const { h: hue, s, l } = hsl;
  // Bucket by lightness primarily; skin tones are all warm so hue is
  // secondary. Pale → darkest deep.
  if (l > 78) return 'skin_ddc994';
  if (l > 65) return 'skin_f5a76e';
  if (l > 55) return 'skin_ea8349';
  if (l > 40) return 'skin_c06534';
  if (l > 28) return 'skin_915533';
  return 'skin_98461a';
}