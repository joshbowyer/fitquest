export type FrameSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'UNKNOWN';

const FRAME_DESCRIPTIONS: Record<FrameSize, string> = {
  SMALL: 'small frame, narrow bone structure',
  MEDIUM: 'medium frame, average build',
  LARGE: 'large frame, wide bone structure',
  UNKNOWN: 'log your wrist to classify',
};

/**
 * Classify frame size from wrist circumference (the standard Casey Butt /
 * McCallum approach). Ankle is used as a secondary check — if wrist
 * says "small" but ankle is large, the overall frame is closer to
 * medium. Returns the more permissive classification.
 */
export function getFrameSize(wristCm?: number | null, ankleCm?: number | null): FrameSize {
  if (!wristCm) return 'UNKNOWN';
  let fromWrist: FrameSize;
  if (wristCm < 17) fromWrist = 'SMALL';
  else if (wristCm < 19) fromWrist = 'MEDIUM';
  else fromWrist = 'LARGE';
  if (!ankleCm) return fromWrist;
  // Ankle check: small ankle confirms small frame; large ankle can upgrade
  // medium to large (or keep large). Ankle in cm: <22 small, 22-24 medium, >24 large
  let fromAnkle: FrameSize;
  if (ankleCm < 22) fromAnkle = 'SMALL';
  else if (ankleCm < 24) fromAnkle = 'MEDIUM';
  else fromAnkle = 'LARGE';
  // Take the larger of the two (permissive)
  const order: Record<FrameSize, number> = { SMALL: 0, MEDIUM: 1, LARGE: 2, UNKNOWN: -1 };
  return order[fromWrist] >= order[fromAnkle] ? fromWrist : fromAnkle;
}

export function frameDescription(size: FrameSize): string {
  return FRAME_DESCRIPTIONS[size];
}
