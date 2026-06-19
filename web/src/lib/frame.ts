export type FrameSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'UNKNOWN';
export type HeightCategory = 'SHORT' | 'MEDIUM' | 'TALL';
export type BuildCategory = 'LEAN' | 'BALANCED' | 'SOLID';

export type FrameArchetype =
  | 'WISP' | 'SPRITE' | 'DRAKE'
  | 'STRIKER' | 'FORGE' | 'GOLEM'
  | 'WIRED' | 'BEAR' | 'BEHEMOTH';

const FRAME_DESCRIPTIONS: Record<FrameSize, string> = {
  SMALL: 'small frame, narrow bone structure',
  MEDIUM: 'medium frame, average build',
  LARGE: 'large frame, wide bone structure',
  UNKNOWN: 'log your wrist to classify',
};

// 9-class somatotype matrix: rows = build (LEAN, BALANCED, SOLID), columns = height
export const ARCHETYPE_MATRIX: Record<BuildCategory, Record<HeightCategory, FrameArchetype>> = {
  LEAN:      { SHORT: 'WISP',    MEDIUM: 'STRIKER', TALL: 'WIRED'    },
  BALANCED:  { SHORT: 'SPRITE',  MEDIUM: 'FORGE',   TALL: 'BEAR'     },
  SOLID:     { SHORT: 'DRAKE',   MEDIUM: 'GOLEM',   TALL: 'BEHEMOTH' },
};

export type ArchetypeMeta = {
  label: string;
  emoji: string;
  tagline: string;
  description: string;
  build: BuildCategory;
  height: HeightCategory;
  color: 'magenta' | 'cyan' | 'lime' | 'amber' | 'violet';
};

export const ARCHETYPE_META: Record<FrameArchetype, ArchetypeMeta> = {
  WISP:     { label: 'Wisp',     emoji: '◇',  tagline: 'light & quick',  description: 'Nimble frame, no excess. Built for speed.', build: 'LEAN', height: 'SHORT', color: 'magenta' },
  SPRITE:   { label: 'Sprite',   emoji: '◈',  tagline: 'compact & balanced', description: 'Small but proportionally even. Every system in harmony.', build: 'BALANCED', height: 'SHORT', color: 'cyan' },
  DRAKE:    { label: 'Drake',    emoji: '◉',  tagline: 'small & dense',  description: 'Short, heavy-set. Compact mass over height.', build: 'SOLID', height: 'SHORT', color: 'amber' },
  STRIKER:  { label: 'Striker',  emoji: '◆',  tagline: 'athletic & lean',  description: 'Average build, low fat. Built for performance.', build: 'LEAN', height: 'MEDIUM', color: 'lime' },
  FORGE:    { label: 'Forge',    emoji: '◼',  tagline: 'classic physique', description: 'Balanced proportions, room to grow in any direction.', build: 'BALANCED', height: 'MEDIUM', color: 'cyan' },
  GOLEM:    { label: 'Golem',    emoji: '◧',  tagline: 'thick & grounded', description: 'Solid mass on a normal frame. Heavy where it counts.', build: 'SOLID', height: 'MEDIUM', color: 'amber' },
  WIRED:    { label: 'Wired',    emoji: '◬',  tagline: 'tall & lean',  description: 'Long frame, low body fat. Aesthetic and high-ceiling.', build: 'LEAN', height: 'TALL', color: 'magenta' },
  BEAR:     { label: 'Bear',     emoji: '◐',  tagline: 'tall & built',  description: 'Tall and thick. Strength with reach.', build: 'BALANCED', height: 'TALL', color: 'cyan' },
  BEHEMOTH: { label: 'Behemoth', emoji: '⬢',  tagline: 'massive',  description: 'Maximum frame, maximum mass. Powerlifter territory.', build: 'SOLID', height: 'TALL', color: 'amber' },
};

export function frameDescription(size: FrameSize): string {
  return FRAME_DESCRIPTIONS[size];
}

// ---- Backwards-compat: small/medium/large classification still used in some places ----
export function getFrameSize(wristCm?: number | null, ankleCm?: number | null): FrameSize {
  if (!wristCm) return 'UNKNOWN';
  let fromWrist: FrameSize;
  if (wristCm < 17) fromWrist = 'SMALL';
  else if (wristCm < 19) fromWrist = 'MEDIUM';
  else fromWrist = 'LARGE';
  if (!ankleCm) return fromWrist;
  let fromAnkle: FrameSize;
  if (ankleCm < 22) fromAnkle = 'SMALL';
  else if (ankleCm < 24) fromAnkle = 'MEDIUM';
  else fromAnkle = 'LARGE';
  const order: Record<FrameSize, number> = { SMALL: 0, MEDIUM: 1, LARGE: 2, UNKNOWN: -1 };
  return order[fromWrist] >= order[fromAnkle] ? fromWrist : fromAnkle;
}

// ---- New: 9-class somatotype from height + weight + BF% ----

export function getHeightCategory(heightCm: number | null): HeightCategory {
  if (heightCm == null) return 'MEDIUM';
  if (heightCm < 170) return 'SHORT';
  if (heightCm < 183) return 'MEDIUM';
  return 'TALL';
}

export function getBuildCategory(
  weightKg: number | null,
  heightCm: number | null,
  bodyFatPct: number | null,
): BuildCategory {
  // Use FFMI when we have lean mass
  if (weightKg != null && heightCm != null) {
    const h2 = (heightCm / 100) ** 2;
    let leanMass = weightKg;
    if (bodyFatPct != null) leanMass = weightKg * (1 - bodyFatPct / 100);
    const ffmi = leanMass / h2;
    if (ffmi < 20) return 'LEAN';
    if (ffmi < 23) return 'BALANCED';
    return 'SOLID';
  }
  // Fallback to BMI
  if (weightKg != null && heightCm != null) {
    const bmi = weightKg / ((heightCm / 100) ** 2);
    if (bmi < 22) return 'LEAN';
    if (bmi < 27) return 'BALANCED';
    return 'SOLID';
  }
  return 'BALANCED';
}

export function getFrameArchetype(
  heightCm: number | null,
  weightKg: number | null,
  bodyFatPct: number | null,
): FrameArchetype | null {
  if (heightCm == null) return null;
  const build = getBuildCategory(weightKg, heightCm, bodyFatPct);
  const height = getHeightCategory(heightCm);
  return ARCHETYPE_MATRIX[build][height];
}

export const ARCHETYPE_ORDER: FrameArchetype[] = [
  'WISP', 'SPRITE', 'DRAKE',
  'STRIKER', 'FORGE', 'GOLEM',
  'WIRED', 'BEAR', 'BEHEMOTH',
];
