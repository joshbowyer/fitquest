/**
 * Hand-coded SVG icons for the SkillTree page.
 *
 * 32 branch icons total — one per branch label across all 6 classes.
 * All use viewBox="0 0 24 24" and stroke-based rendering so they
 * scale cleanly to the circle's display size (the SkillTree page
 * renders them inside a w-14 h-14 circle). `currentColor` lets the
 * parent control fill/stroke color via Tailwind text-* classes.
 *
 * Visual language (consistent across all icons):
 *   - Single-color line art (stroke style, no fills)
 *   - strokeWidth 1.75, round caps + joins
 *   - Content centered in 24x24 box, padded ~2px from edges
 *   - Simple primitives: lines, rects, circles, simple paths
 *   - Human-figure icons use a small filled circle for the head
 *     and straight lines for limbs
 *
 * Note: the `Sled` branch label is shared between JUGGERNAUT and
 * BERSERKER — both classes get the same icon. Different columns,
 * same label, no collision in the UI (the page only renders one
 * class at a time).
 */

import type { ReactElement } from 'react';

const COMMON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: '1em',
  height: '1em',
};

const icon = (children: ReactElement | ReactElement[]): ReactElement => (
  <svg {...COMMON_PROPS}>{children}</svg>
);

// ---- JUGGERNAUT (heavy + barbell) ----
//
// All JUGGERNAUT icons are hand-coded barbell SVG (NOT borrowed from
// calitree.app — the calitree calisthenics PNGs like bench-dips /
// cossack-squat / pike-press are wrong for barbell movements). Each
// icon shows the lifter + bar in a position that's unambiguous at
// small (28-32px) render sizes, the same way SkillTree renders the
// branch header icons.

const Squat = icon(
  <>
    {/* Squatter: head circle + shoulders + hips + bent legs */}
    {/* Head */}
    <circle cx="12" cy="5" r="2" />
    {/* Shoulders */}
    <line x1="9" y1="8" x2="15" y2="8" />
    {/* Torso (slightly leaning forward) */}
    <line x1="12" y1="8" x2="11" y2="13" />
    {/* Hips */}
    <line x1="11" y1="13" x2="14" y2="14" />
    {/* Thighs (down to knees) */}
    <line x1="14" y1="14" x2="15" y2="17" />
    <line x1="11" y1="13" x2="9" y2="17" />
    {/* Lower legs (feet planted) */}
    <line x1="15" y1="17" x2="15" y2="21" />
    <line x1="9" y1="17" x2="9" y2="21" />
    {/* Barbell on the shoulders (across the trap) */}
    <line x1="6" y1="9" x2="18" y2="9" />
    <rect x="4" y="7" width="2.5" height="4" rx="0.4" />
    <rect x="17.5" y="7" width="2.5" height="4" rx="0.4" />
  </>,
);

const Press = icon(
  <>
    {/* Bench Press — lifter lying on bench, bar held at lockout */}
    {/* Bench */}
    <rect x="2" y="14" width="20" height="3" rx="0.5" />
    {/* Bench legs */}
    <line x1="4" y1="17" x2="4" y2="21" />
    <line x1="20" y1="17" x2="20" y2="21" />
    {/* Lifter's body — short line on top of the bench */}
    <line x1="9" y1="14" x2="15" y2="14" />
    {/* Lifter's head (small circle at one end) */}
    <circle cx="8.5" cy="12.5" r="1.5" />
    {/* Arms holding the bar at lockout (above the bench) */}
    <line x1="9" y1="13" x2="9" y2="9" />
    <line x1="15" y1="13" x2="15" y2="9" />
    {/* Barbell at lockout position */}
    <line x1="6" y1="9" x2="18" y2="9" />
    {/* Weight plates */}
    <rect x="4" y="7" width="3" height="4" rx="0.4" />
    <rect x="17" y="7" width="3" height="4" rx="0.4" />
  </>,
);

const Deadlift = icon(
  <>
    {/* Deadlift — lifter hinged at the hips, gripping bar on floor */}
    {/* Floor */}
    <line x1="3" y1="22" x2="21" y2="22" />
    {/* Barbell on the floor (low) */}
    <line x1="5" y1="20" x2="19" y2="20" />
    <rect x="3" y="17" width="3" height="6" rx="0.4" />
    <rect x="18" y="17" width="3" height="6" rx="0.4" />
    {/* Lifter hinged at hips — diagonal torso, bent legs, arms down to bar */}
    {/* Head (low, looking forward) */}
    <circle cx="9" cy="12" r="2" />
    {/* Back (angled) */}
    <line x1="9" y1="14" x2="14" y2="17" />
    {/* Hip hinge */}
    <line x1="14" y1="17" x2="15" y2="20" />
    {/* Front (bent) leg */}
    <line x1="15" y1="20" x2="15" y2="22" />
    {/* Rear leg */}
    <line x1="14" y1="17" x2="11" y2="22" />
    {/* Arms reaching down to the bar */}
    <line x1="9" y1="13" x2="6" y2="20" />
    <line x1="9" y1="13" x2="9" y2="20" />
  </>,
);

const OverheadPress = icon(
  <>
    {/* Overhead Press — standing lifter, bar locked out overhead */}
    {/* Floor */}
    <line x1="5" y1="22" x2="19" y2="22" />
    {/* Lifter's legs (vertical, standing) */}
    <line x1="11" y1="22" x2="11" y2="16" />
    <line x1="13" y1="22" x2="13" y2="16" />
    {/* Torso */}
    <line x1="12" y1="16" x2="12" y2="10" />
    {/* Head */}
    <circle cx="12" cy="9" r="2" />
    {/* Arms extending straight up to the bar */}
    <line x1="11" y1="10" x2="9" y2="4" />
    <line x1="13" y1="10" x2="15" y2="4" />
    {/* Barbell overhead */}
    <line x1="6" y1="4" x2="18" y2="4" />
    {/* Plates */}
    <rect x="4" y="2" width="3" height="4" rx="0.4" />
    <rect x="17" y="2" width="3" height="4" rx="0.4" />
  </>,
);

const Strongman = icon(
  <>
    {/* Strongman yoke — upright post + crossbar + hanging weights + carrier below */}
    {/* Upright central post */}
    <line x1="12" y1="2" x2="12" y2="14" />
    {/* Crossbar */}
    <line x1="4" y1="6" x2="20" y2="6" />
    {/* Weights hanging from each end */}
    <rect x="3" y="7" width="3" height="5" rx="0.4" />
    <rect x="18" y="7" width="3" height="5" rx="0.4" />
    {/* Carrier's head */}
    <circle cx="12" cy="17" r="2" />
    {/* Carrier's shoulders + torso (under the crossbar) */}
    <line x1="9" y1="19" x2="15" y2="19" />
    <line x1="12" y1="19" x2="12" y2="22" />
    {/* Carrier's legs */}
    <line x1="11" y1="22" x2="10" y2="22" />
    <line x1="13" y1="22" x2="14" y2="22" />
  </>,
);

const Sled = icon(
  <>
    {/* Sled body — angled triangle / prowler */}
    <path d="M4 8 L18 8 L20 16 L4 16 Z" />
    {/* Handle at the back */}
    <path d="M4 8 L2 6" />
    {/* Vertical post for pushing */}
    <line x1="14" y1="8" x2="14" y2="4" />
    <line x1="14" y1="4" x2="17" y2="4" />
    {/* Wheels */}
    <circle cx="7" cy="18" r="1.75" />
    <circle cx="17" cy="18" r="1.75" />
  </>
);

// ---- PHANTOM (calisthenics + gymnastics) ----

const Push = icon(
  <>
    {/* Arms pushing up */}
    <path d="M12 14 L12 6" />
    <path d="M9 9 L12 6 L15 9" />
    {/* Ground line */}
    <line x1="3" y1="18" x2="21" y2="18" />
    {/* Figure base — half-rectangle */}
    <path d="M9 18 L9 14 L15 14 L15 18" />
  </>
);

const Pull = icon(
  <>
    {/* Pull-up bar */}
    <line x1="3" y1="4" x2="21" y2="4" />
    {/* Arms hanging down */}
    <line x1="9" y1="4" x2="9" y2="10" />
    <line x1="15" y1="4" x2="15" y2="10" />
    {/* Head */}
    <circle cx="12" cy="13" r="2.25" />
    {/* Body hanging */}
    <line x1="12" y1="15" x2="12" y2="21" />
  </>
);

const Holds = icon(
  <>
    {/* Hands gripping a bar above */}
    <line x1="3" y1="5" x2="21" y2="5" />
    <line x1="9" y1="5" x2="9" y2="9" />
    <line x1="15" y1="5" x2="15" y2="9" />
    {/* L-sit body: vertical torso + horizontal legs */}
    <line x1="12" y1="9" x2="12" y2="16" />
    <line x1="12" y1="16" x2="20" y2="16" />
    {/* Head */}
    <circle cx="12" cy="7" r="1.75" />
  </>
);

const Rings = icon(
  <>
    {/* Two rings hanging from straps */}
    <line x1="6" y1="3" x2="6" y2="9" />
    <line x1="18" y1="3" x2="18" y2="9" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="12" r="3" />
    {/* Small ring outline (overlap hint) */}
    <line x1="6" y1="9" x2="9" y2="12" />
    <line x1="18" y1="9" x2="15" y2="12" />
  </>
);

const Handstand = icon(
  <>
    {/* Arms straight up from ground */}
    <line x1="9" y1="6" x2="9" y2="21" />
    <line x1="15" y1="6" x2="15" y2="21" />
    {/* Ground */}
    <line x1="3" y1="21" x2="21" y2="21" />
    {/* Inverted body — legs up */}
    <path d="M9 6 L9 3 L15 3 L15 6" />
    {/* Head (between arms) */}
    <circle cx="12" cy="9" r="2" />
  </>
);

// Back lever — face-down horizontal hold. Bar at top of viewbox,
// body horizontal below, shoulders externally rotated (arms out to
// the sides, palms back). Different from front lever which has the
// figure face-up with arms pulling down toward the bar.
const BackLever = icon(
  <>
    {/* Bar across the top */}
    <line x1="4" y1="3" x2="20" y2="3" />
    {/* Arms hanging straight down from bar (palms back) */}
    <line x1="6" y1="3" x2="6" y2="9" />
    <line x1="18" y1="3" x2="18" y2="9" />
    {/* Body horizontal — torso + legs as a straight line */}
    <line x1="6" y1="9" x2="20" y2="9" />
    {/* Legs split slightly for character */}
    <line x1="20" y1="9" x2="22" y2="13" />
    {/* Head below the bar, face-down */}
    <circle cx="3" cy="11" r="1.5" />
  </>
);

// One-arm pull-up — figure hanging from the bar with ONE arm
// extended (the pulling arm grips the bar, the other arm hangs at
// the side). The asymmetric silhouette is the key visual cue.
const OneArmPullUp = icon(
  <>
    {/* Bar across the top */}
    <line x1="4" y1="4" x2="20" y2="4" />
    {/* Head */}
    <circle cx="9" cy="9" r="2" />
    {/* Pulling arm — straight up to the bar */}
    <line x1="9" y1="11" x2="13" y2="4" />
    {/* Other arm — hangs straight down at the side */}
    <line x1="9" y1="11" x2="9" y2="20" />
    {/* Body — torso + legs */}
    <line x1="9" y1="11" x2="9" y2="20" />
  </>
);

// Muscle-up — figure with hands at the bar, body in the lockout
// transition (above-the-bar dip lockout). Torso above bar, arms
// bent at the elbows, head above the bar — the visual cue that
// distinguishes it from a regular pull-up.
const KippingMuscleUp = icon(
  <>
    {/* Bar across the top */}
    <line x1="4" y1="4" x2="20" y2="4" />
    {/* Hands gripping the bar */}
    <line x1="6" y1="4" x2="6" y2="7" />
    <line x1="18" y1="4" x2="18" y2="7" />
    {/* Arms bent at the elbows (lockout position) */}
    <line x1="6" y1="7" x2="9" y2="9" />
    <line x1="18" y1="7" x2="15" y2="9" />
    {/* Torso above the bar (lockout) */}
    <line x1="9" y1="9" x2="12" y2="7" />
    <line x1="15" y1="9" x2="12" y2="7" />
    {/* Head above the bar */}
    <circle cx="12" cy="4" r="1.5" />
  </>
);

// High pull-up to waist — explosive pull where the bar reaches the
// navel (waist height), not the chin. Bar near the top of the
// viewbox (the height), full hip extension (vertical body below),
// bar ABOVE the head — the visual cue that distinguishes it from
// a regular pull-up.
const HighPullUp = icon(
  <>
    {/* Bar — high, near top */}
    <line x1="6" y1="3" x2="18" y2="3" />
    {/* Hands gripping the bar */}
    <line x1="8" y1="3" x2="8" y2="6" />
    <line x1="16" y1="3" x2="16" y2="6" />
    {/* Arms straight up (lats + hip drive, not bent at lockout) */}
    <line x1="8" y1="6" x2="12" y2="9" />
    <line x1="16" y1="6" x2="12" y2="9" />
    {/* Body — torso + legs (extended, full hip drive) */}
    <line x1="12" y1="9" x2="12" y2="22" />
    {/* Head below the bar (between arms) */}
    <circle cx="12" cy="11" r="1.75" />
  </>
);

// ---- PHANTOM Legs (NEW — 7th branch) ----
//
// All icons are 24x24 stroke style. Each shows a simplified human
// silhouette performing the movement. The viewBox is centered on
// the figure so it renders cleanly inside the SkillTree's circle
// node.
const SquatToChair = icon(
  <>
    {/* Head */}
    <circle cx="12" cy="5" r="2" />
    {/* Torso */}
    <line x1="12" y1="7" x2="12" y2="14" />
    {/* Thighs (horizontal in deep squat) */}
    <line x1="12" y1="14" x2="8" y2="17" />
    <line x1="12" y1="14" x2="16" y2="17" />
    {/* Lower legs (vertical, knees bent at 90°) */}
    <line x1="8" y1="17" x2="8" y2="21" />
    <line x1="16" y1="17" x2="16" y2="21" />
    {/* Chair / box under butt */}
    <rect x="6" y="20" width="12" height="2" rx="0.5" />
    {/* Arms forward for balance */}
    <line x1="12" y1="9" x2="9" y2="11" />
    <line x1="12" y1="9" x2="15" y2="11" />
  </>
);

// Bulgarian split squat — figure with one foot forward on the
// ground, the rear foot elevated on a bench behind. The bench
// behind + elevated rear foot is the visual cue.
const BulgarianSplitSquat = icon(
  <>
    {/* Head */}
    <circle cx="12" cy="4" r="1.75" />
    {/* Torso — slight forward lean */}
    <line x1="12" y1="6" x2="11" y2="13" />
    {/* Front leg — bent at knee, foot down */}
    <path d="M11 13 L9 17 L9 21" />
    {/* Rear leg — bent, foot up on bench */}
    <path d="M12 13 L15 13 L16 11" />
    {/* Bench behind — horizontal line */}
    <line x1="13" y1="11" x2="20" y2="11" />
    {/* Bench legs */}
    <line x1="14" y1="11" x2="14" y2="14" />
    <line x1="19" y1="11" x2="19" y2="14" />
    {/* Arms forward for balance */}
    <line x1="12" y1="8" x2="9" y2="10" />
    <line x1="12" y1="8" x2="15" y2="10" />
  </>
);

// Pistol squat — single-leg squat with one leg straight out in
// front. The straight horizontal leg is the key visual cue.
const PistolSquat = icon(
  <>
    {/* Head */}
    <circle cx="12" cy="4" r="1.75" />
    {/* Torso */}
    <line x1="12" y1="6" x2="12" y2="14" />
    {/* Standing leg — bent at knee */}
    <path d="M12 14 L10 18 L10 21" />
    {/* Straight leg — pointing forward (horizontal) */}
    <line x1="12" y1="14" x2="21" y2="14" />
    {/* Arms forward for balance */}
    <line x1="12" y1="8" x2="16" y2="10" />
    <line x1="12" y1="8" x2="17" y2="11" />
  </>
);

// Shrimp squat — single-leg squat with the rear knee on the ground
// (no straight leg out front — knee contact is the visual cue).
const ShrimpSquat = icon(
  <>
    {/* Head */}
    <circle cx="12" cy="4" r="1.75" />
    {/* Torso — slight forward lean */}
    <line x1="12" y1="6" x2="11" y2="14" />
    {/* Front leg — bent at knee, foot down */}
    <path d="M11 14 L9 17 L9 21" />
    {/* Rear leg — bent, knee ON the ground (no foot lift) */}
    <path d="M11 14 L15 18 L15 21" />
    {/* Ground */}
    <line x1="3" y1="21" x2="21" y2="21" />
    {/* Arms forward */}
    <line x1="12" y1="8" x2="9" y2="10" />
    <line x1="12" y1="8" x2="15" y2="10" />
  </>
);

// Dragon pistol squat — pistol with the rear leg straight and
// elevated (no knee touch). Same as PistolSquat but the rear leg
// is RAISED OFF the ground, not pointing forward at floor level.
const DragonPistolSquat = icon(
  <>
    {/* Head */}
    <circle cx="12" cy="4" r="1.75" />
    {/* Torso */}
    <line x1="12" y1="6" x2="12" y2="14" />
    {/* Standing leg — bent at knee */}
    <path d="M12 14 L10 18 L10 21" />
    {/* Straight leg — pointing forward but elevated (no ground touch) */}
    <line x1="12" y1="14" x2="22" y2="11" />
    {/* Ground (elevated rear foot hovers above this) */}
    <line x1="3" y1="21" x2="9" y2="21" />
    {/* Arms forward */}
    <line x1="12" y1="8" x2="16" y2="10" />
    <line x1="12" y1="8" x2="17" y2="11" />
  </>
);

// Combined shrimp+pistol — both forms chained. We show the figure
// mid-transition (one leg bent under, one straight forward) with
// a small "→" arrow hint of the chain.
const ShrimpToPistol = icon(
  <>
    {/* Head */}
    <circle cx="11" cy="4" r="1.5" />
    {/* Torso */}
    <line x1="11" y1="6" x2="11" y2="14" />
    {/* Front leg bent under (shrimp-like) */}
    <path d="M11 14 L9 17 L9 21" />
    {/* Rear leg straight forward (pistol-like) */}
    <line x1="11" y1="14" x2="20" y2="14" />
    {/* Chain arrow showing the progression */}
    <path d="M3 11 L7 11 M5 9 L7 11 L5 13" />
    <path d="M3 14 L7 14 M5 12 L7 14 L5 16" />
  </>
);

// ---- SCOUT (endurance) ----

const Run = icon(
  <>
    {/* Running figure — head + body + bent legs + arms */}
    <circle cx="14" cy="4" r="2" />
    <path d="M14 6 L11 12 L8 18" />
    <path d="M11 12 L15 15 L13 20" />
    <path d="M14 8 L18 9" />
    <path d="M14 8 L11 6" />
  </>
);

const Ruck = icon(
  <>
    {/* Figure with backpack — head + body + backpack square */}
    <circle cx="11" cy="4" r="2" />
    {/* Backpack behind */}
    <rect x="13" y="7" width="6" height="9" rx="1" />
    {/* Body */}
    <path d="M11 6 L11 14" />
    {/* Legs walking */}
    <path d="M11 14 L8 20" />
    <path d="M11 14 L14 20" />
    {/* Arms */}
    <path d="M11 8 L7 13" />
    <path d="M11 8 L13 14" />
  </>
);

const Triathlon = icon(
  <>
    {/* Three small icons in a row representing swim/bike/run */}
    {/* Swim — wave */}
    <path d="M1 9 Q2.5 7 4 9 T7 9" />
    <path d="M1 13 Q2.5 11 4 13 T7 13" />
    {/* Bike — two wheels + frame */}
    <circle cx="11" cy="15" r="2.5" />
    <circle cx="17" cy="15" r="2.5" />
    <line x1="11" y1="15" x2="14" y2="11" />
    <line x1="17" y1="15" x2="14" y2="11" />
    <line x1="13" y1="11" x2="15" y2="9" />
    {/* Run — figure */}
    <circle cx="21" cy="8" r="1.5" />
    <path d="M21 9.5 L19 13 L17 17" />
    <path d="M19 13 L22 15 L21 19" />
  </>
);

// ---- BERSERKER (intensity + combat) ----

const BerserkerSled = icon(
  <>
    {/* Prowler sled — flat platform with vertical push handle */}
    <rect x="3" y="13" width="18" height="3" rx="0.5" />
    {/* Vertical push posts */}
    <line x1="6" y1="13" x2="6" y2="7" />
    <line x1="18" y1="13" x2="18" y2="7" />
    {/* Horizontal grip */}
    <line x1="6" y1="7" x2="18" y2="7" />
    {/* Wheels */}
    <circle cx="7" cy="18" r="1.5" />
    <circle cx="17" cy="18" r="1.5" />
    {/* Weight plates stacked */}
    <circle cx="9" cy="14.5" r="1.2" />
    <circle cx="15" cy="14.5" r="1.2" />
  </>
);

const Kettlebell = icon(
  <>
    {/* Round bell body */}
    <circle cx="12" cy="15" r="6" />
    {/* Handle on top — two arcs */}
    <path d="M8 9 Q8 4 12 4 Q16 4 16 9" />
    {/* Inner handle gap */}
    <line x1="9.5" y1="9" x2="14.5" y2="9" />
  </>
);

const Boxing = icon(
  <>
    {/* Boxing glove outline — mitten shape */}
    <path d="M7 11 L7 7 Q7 4 10 4 L15 4 Q18 4 18 7 L18 14 Q18 18 14 18 L10 18 Q7 18 7 15 Z" />
    {/* Thumb */}
    <path d="M18 9 Q21 9 21 12 Q21 14 18 14" />
    {/* Wrist line */}
    <line x1="9" y1="14" x2="16" y2="14" />
  </>,
);

// Sandbag — strongman-style bag with a gathered top + handle.
const Sandbag = icon(
  <>
    {/* Bag body — rounded rectangle (the cylinder of a filled sandbag) */}
    <rect x="4" y="9" width="16" height="12" rx="2.5" />
    {/* Horizontal seam / panel line across the middle */}
    <line x1="4" y1="14" x2="20" y2="14" />
    {/* Gathered top — a small bunched handle arc on top of the bag */}
    <path d="M8 9 Q8 5 12 5 Q16 5 16 9" />
    {/* Tiny pinch at the centre of the gathered top (the knot/seal) */}
    <line x1="12" y1="5.5" x2="12" y2="3.5" />
  </>,
);

// Medicine Ball — heavy slam ball with seam lines (leather medicine-ball silhouette).
const MedicineBall = icon(
  <>
    {/* Round ball body */}
    <circle cx="12" cy="12" r="8" />
    {/* Curved horizontal seam — like the equator on a leather med ball */}
    <path d="M4.5 11 Q12 8.5 19.5 11" />
    <path d="M4.5 13 Q12 15.5 19.5 13" />
    {/* Vertical seam down the centre */}
    <line x1="12" y1="4" x2="12" y2="20" />
  </>,
);

const Capacity = icon(
  <>
    {/* Flame — teardrop shape */}
    <path d="M12 21 Q6 18 6 13 Q6 9 9 6 Q9 9 11 8 Q11 4 12 2 Q13 4 13 8 Q15 9 15 6 Q18 9 18 13 Q18 18 12 21 Z" />
    {/* Inner flame curl */}
    <path d="M12 18 Q9 16 9 13" />
  </>
);

const Mace = icon(
  <>
    {/* Mace head — ball */}
    <circle cx="12" cy="6" r="4" />
    {/* Studs / texture on the ball */}
    <line x1="12" y1="2" x2="12" y2="10" />
    <line x1="8" y1="6" x2="16" y2="6" />
    {/* Handle */}
    <line x1="12" y1="10" x2="12" y2="21" />
    {/* Grip wrap */}
    <line x1="12" y1="14" x2="12" y2="17" />
  </>
);

// ---- TRACER (speed + agility) ----

const Sprint = icon(
  <>
    {/* Lightning bolt */}
    <path d="M13 2 L5 13 L11 13 L9 22 L19 10 L13 10 Z" />
  </>
);

const Plyo = icon(
  <>
    {/* Jumping figure — arc underneath + figure mid-air */}
    <circle cx="14" cy="6" r="2" />
    <path d="M14 8 L11 11 L13 14" />
    <path d="M14 8 L17 11 L16 14" />
    <path d="M11 11 L9 12" />
    <path d="M17 11 L19 12" />
    {/* Arc under feet */}
    <path d="M5 18 Q12 22 19 18" />
  </>
);

const Parkour = icon(
  <>
    {/* Wall / obstacle */}
    <rect x="14" y="9" width="6" height="10" rx="0.5" />
    {/* Figure vaulting over */}
    <circle cx="6" cy="6" r="2" />
    <path d="M6 8 L8 11 L11 11" />
    <path d="M8 11 L9 14" />
    <path d="M6 9 L4 12" />
    {/* Motion arc */}
    <path d="M3 9 Q5 5 8 5" strokeDasharray="2 2" />
  </>
);

const Agility = icon(
  <>
    {/* 4-way arrows — agility / change of direction */}
    <path d="M12 3 L12 9 M9 6 L12 3 L15 6" />
    <path d="M12 21 L12 15 M9 18 L12 21 L15 18" />
    <path d="M3 12 L9 12 M6 9 L3 12 L6 15" />
    <path d="M21 12 L15 12 M18 9 L21 12 L18 15" />
    {/* Center dot */}
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </>
);

const Throws = icon(
  <>
    {/* Med ball — circle with motion lines */}
    <circle cx="14" cy="12" r="5" />
    {/* Ball seam / texture */}
    <path d="M11 9 Q14 12 11 15" />
    <path d="M17 9 Q14 12 17 15" />
    {/* Motion lines (behind ball, going right) */}
    <line x1="2" y1="9" x2="6" y2="9" />
    <line x1="1" y1="12" x2="6" y2="12" />
    <line x1="2" y1="15" x2="6" y2="15" />
  </>
);

// ---- ORACLE (mindfulness + mobility) ----

const Mobility = icon(
  <>
    {/* Stretching figure — bent forward, arms reaching */}
    <circle cx="14" cy="5" r="2" />
    <path d="M14 7 L10 14" />
    {/* Arms reaching toward foot */}
    <path d="M10 14 L7 19" />
    <path d="M10 14 L8 20" />
    {/* Standing leg */}
    <path d="M10 14 L13 21" />
  </>
);

const Breath = icon(
  <>
    {/* Lungs — two rounded shapes */}
    <path d="M12 6 Q7 6 6 11 Q5 16 8 19 L10 19 L10 11" />
    <path d="M12 6 Q17 6 18 11 Q19 16 16 19 L14 19 L14 11" />
    {/* Trachea at top */}
    <line x1="12" y1="3" x2="12" y2="6" />
    {/* Air-flow arrows (in/out) */}
    <path d="M9 3 L12 1 L15 3" strokeDasharray="1.5 1.5" />
  </>
);

const Balance = icon(
  <>
    {/* Scale base — tripod */}
    <line x1="12" y1="14" x2="12" y2="20" />
    <line x1="9" y1="20" x2="15" y2="20" />
    {/* Beam */}
    <line x1="4" y1="10" x2="20" y2="10" />
    {/* Fulcrum */}
    <path d="M10 12 L12 10 L14 12" />
    {/* Two pans */}
    <path d="M3 10 L3 12 Q3 14 5 14 Q7 14 7 12 L7 10" />
    <path d="M17 10 L17 12 Q17 14 19 14 Q21 14 21 12 L21 10" />
  </>
);

const IgnatianMeditation = icon(
  <>
    {/* Cross + halo — distinctly Catholic contemplative icon. */}
    {/* Cross stem */}
    <line x1="12" y1="4" x2="12" y2="20" />
    {/* Cross arm */}
    <line x1="7" y1="9" x2="17" y2="9" />
    {/* Halo / aura around the head of the cross */}
    <circle cx="12" cy="4" r="3.5" />
    {/* Base line — the ground the cross stands on */}
    <line x1="4" y1="20" x2="20" y2="20" />
    {/* Two small rays outward at the base — the colloquy */}
    <path d="M9 18 L7 20" />
    <path d="M15 18 L17 20" />
  </>,
);

const Yoga = icon(
  <>
    {/* Lotus / seated figure with halo of energy */}
    <circle cx="12" cy="12" r="9" strokeDasharray="2 3" opacity="0.5" />
    {/* Head */}
    <circle cx="12" cy="7" r="2" />
    {/* Body — triangle / lotus base */}
    <path d="M12 9 L5 19 L19 19 Z" />
    {/* Arms in prayer */}
    <path d="M10 11 L14 11" />
    <path d="M12 11 L12 15" />
  </>
);

const Pilates = icon(
  <>
    {/* Reformer / carriage shape */}
    <rect x="3" y="14" width="18" height="4" rx="1" />
    {/* Wheels / rails */}
    <circle cx="5" cy="20" r="1" />
    <circle cx="19" cy="20" r="1" />
    {/* Foot bar */}
    <line x1="9" y1="14" x2="9" y2="10" />
    <line x1="15" y1="14" x2="15" y2="10" />
    <line x1="8" y1="10" x2="16" y2="10" />
    {/* Pulley ropes */}
    <line x1="9" y1="10" x2="7" y2="6" />
    <line x1="15" y1="10" x2="17" y2="6" />
  </>
);

// ---- Lookup ----

// Calitree.app-style icon mapping for branches that have a direct
// calisthenics analog. The PNGs live at web/public/icons/calitree/
// and were re-themed via CSS filters at render time (synthwave-ify):
//   filter: hue-rotate(...) brightness(...) saturate(...)
// to recolor the calitree brand colors into our neon palette per
// state (locked = grayscale/dimmed, unlocked = neon, god-tier =
// amber). Branches not in this map fall back to a hand-coded SVG
// further down — those are the heavy/barbell/boxing/mace/sled
// categories that calitree.app doesn't cover (it's a calisthenics-
// only tree).
//
// Attribution: icons adapted from calitree.app (open-source-feel
// calisthenics tree, see https://calitree.app). Path data was
// rasterized to PNG by the upstream; we re-color and re-frame
// rather than 1:1 copy.
const CALITREE_ICON_FILES: Record<string, string> = {
  // JUGGERNAUT — heavy barbell / strongman. Calitree.app has no good
  // matches (it's a calisthenics-only tree, so the closest PNGs are
  // always wrong — bench-dips for Press, cossack-squat for Deadlift,
  // pike-press for OHP, bulgarian-dips for Strongman). JUGGERNAUT
  // branches now fall through to the hand-coded barbell SVGs below.

  // 'Sled' — no calitree equivalent, falls back to hand-coded SVG

  // PHANTOM — calisthenics, direct mapping
  'Push':           'incline-push-ups',
  'Pull':           'pull-ups',
  'Holds':          'plank',
  'Rings':          'ring-dips',
  'Handstand':      'wall-handstand',
  'Planche':        'tuck-planche',
  'Legs':           'bodyweight-squat',   // closest calitree PNG to legs

  // SCOUT — running/rucking/triathlon have no direct calisthenics
  // analogs in calitree; all three fall back to hand-coded.

  // BERSERKER
  // 'Sled' / 'Kettlebell' / 'Boxing' / 'Mace / Indian Club' — no
  // calitree equivalent; fall back to hand-coded.
  'Hero WODs':      'kipping-muscle-up', // high-volume benchmark
  'Capacity':       'chin-ups',          // AMRAP-style grinder

  // TRACER
  // 'Sprint' / 'Throws' — no calitree equivalent.
  'Plyo':           'tuck-front-lever',  // explosive isometric
  'Parkour':        'tuck-back-lever',   // body-control rotation
  'Agility':        'tuck-back-lever',   // shared with Parkour

  // ORACLE — mobility / holds, mostly direct mapping
  'Mobility':       'pancake-stretch',
  'Breath':         'hollow-hold',
  'Balance':        'side-plank',
  // 'Ignatian Meditation' (was 'Mindfulness' — renamed) — no calitree equivalent.
  'Yoga':           'bridge-hold',
  'Pilates':        'l-sit',
};

export function calitreeIconFor(branchName: string | null): string | null {
  if (!branchName) return null;
  return CALITREE_ICON_FILES[branchName] ?? null;
}

// Per-skill overrides — used when a specific skill (e.g. "L-Sit")
// has a calitree PNG that's more accurate than its branch's generic
// one (plank). Wins over the branch map. Falls through to
// calitreeIconFor() if the skill isn't listed.
const CALITREE_ICON_FILES_BY_SKILL: Record<string, string> = {
  // ---- PHANTOM Holds (overrides plank branch icon) ----
  '10s L-Sit Initiate':           'l-sit',
  '30s L-Sit':                    'l-sit',
  '10s Straddle L':               'straddle-l-sit',
  '30s V-Sit':                    'v-sit',
  '5s Front Lever':               'tuck-front-lever',
  '5s Back Lever':                'tuck-back-lever',

  // ---- PHANTOM Planche (overrides planche branch icon) ----
  '10s Pseudo-Planche Lean':      'planche-lean',
  '5s Tuck Planche':              'tuck-planche',
  '5s Advanced Tuck Planche':      'adv-tuck-planche',
  '5s Straddle Planche':          'straddle-planche',
  '5s Full Planche':              'full-planche',

  // ---- PHANTOM Rings (overrides ring-dips branch icon) ----
  'Rings Dead Hang 30s':          'active-hang',
  'Rings Support 5s':             'rto-support',
  '5 Ring Rows':                  'australian-rows',
  '5 Ring Dips':                  'ring-dips',
  '5 Ring Muscle-Ups':            'ring-muscle-up',
  '10s L-Sit on Rings':           'ring-l-sit',
  '3s Iron Cross':                'kipping-muscle-up', // closest analog

  // ---- PHANTOM Handstand (overrides wall-handstand branch icon) ----
  '5 Pike Push-Ups Initiate':     'pike-press',
  '5 Elevated Pike PU':           'pike-press',
  '10s Free Handstand':           'freestanding-handstand',
  '5 Wall HSPUs':                 'wall-hspu',
  '30s Free Handstand':           'freestanding-handstand',
  '5 Free HSPUs':                 'freestanding-hspu',
  '1 Strict Free HSPU 5s':         'freestanding-hspu',

  // ---- PHANTOM Pull (overrides pull-ups branch icon) ----
  'Dead Hang 30s Initiate':       'active-hang',
  '1 Strict Pull-Up':             'pull-ups',
  '5 Strict Pull-Ups':            'chin-ups',
  '10 Pull-Ups in a Row':         'wide-pull-ups',
  'Weighted Pull-Up 25% BW':      'weighted-pull-ups',
  '3 Muscle-Ups':                 'kipping-muscle-up',
  'High Pull-Up to Waist':        'kipping-muscle-up', // closest analog
  'One-Arm Pull-Up (each)':       'one-arm-chin-up',

  // ---- PHANTOM Push (overrides incline-push-ups branch icon) ----
  'Incline Push-Up Initiate':     'incline-push-ups',
  'Standard Push-Up 20':          'decline-push-ups',  // closest: declined for difficulty
  'Archer Push-Up':               'archer-push-ups',
  'One-Arm Push-Up (knee)':       'one-arm-push-up',
  'One-Arm Push-Up (no knee)':    'one-arm-push-up',
  'Weighted 1-Arm PU 25% BW':    'one-arm-push-up',
  'Weighted 1-Arm PU 50% BW':    'one-arm-push-up',

  // ---- PHANTOM Legs (NEW — calitree has most of these) ----
  'Squat to Chair':               'bodyweight-squat',
  'Bulgarian Split Squat':        'bulgarian-split-squat',
  'Assisted Pistol Squat':        'assisted-pistol',
  'Shrimp Squat':                 'beginner-shrimp',
  'Free Pistol Squat':            'pistol-squat',
  'Dragon Pistol Squat':          'dragon-squat',
  'Shrimp → Pistol Progression':   'sissy-squat',
};

export function skillCalitreeIconFor(skillName: string | null): string | null {
  if (!skillName) return null;
  return CALITREE_ICON_FILES_BY_SKILL[skillName] ?? null;
}

export const BRANCH_ICONS: Record<string, ReactElement> = {
  // JUGGERNAUT — barbell movements (calitree.app has no good
  // calisthenics-PNG equivalents; we hand-code them).
  'Squat':          Squat,
  'Press':          Press,
  'Deadlift':       Deadlift,
  'Overhead Press': OverheadPress,
  'Strongman':      Strongman,
  'Sled':           Sled,
  // PHANTOM
  // All 7 branches have calitree matches. (Calitree's planche icon
  // is technically a front-lever figure rather than a true planche,
  // but the silhouette shape is close enough for now.)
  // SCOUT — no calitree matches for any of the 3 branches
  'Run': Run,
  'Ruck': Ruck,
  'Triathlon': Triathlon,
  // BERSERKER — only Capacity has a calitree match (was Hero WODs
  // before the merge). Hand-coded icons for the other branches.
  'Kettlebell': Kettlebell,
  'Boxing': Boxing,
  'Mace / Indian Club': Mace,
  'Sandbag': Sandbag,
  'Medicine Ball': MedicineBall,
  // TRACER — only Plyo + Parkour + Agility have matches
  'Sprint': Sprint,
  'Throws': Throws,
  // ORACLE — only Mobility + Breath + Balance + Yoga + Pilates have matches
  'Ignatian Meditation': IgnatianMeditation,
};

// Per-skill icons — override the branch icon for specific skills
// whose silhouette is more recognizable than the branch label.
// Skill name → icon element. Most skills fall back to the branch
// icon via the page; this map holds the exceptions.
export const SKILL_ICONS: Record<string, ReactElement> = {
  // PHANTOM.Pull — special moves get their own icon instead of
  // the generic pull-ups.png.
  '3 Muscle-Ups':                 KippingMuscleUp,
  'High Pull-Up to Waist':       HighPullUp,
  'One-Arm Pull-Up (each)':      OneArmPullUp,
  // PHANTOM.Holds — back lever was missing from the original seed.
  '5s Back Lever':               BackLever,
  // PHANTOM.Legs (NEW 7th branch) — every skill gets a dedicated
  // icon since the bodyweight-squat.png PNG only roughly matches.
  'Squat to Chair':              SquatToChair,
  'Bulgarian Split Squat':       BulgarianSplitSquat,
  'Assisted Pistol Squat':       PistolSquat,  // pistol is the canonical shape
  'Shrimp Squat':                ShrimpSquat,
  'Free Pistol Squat':           PistolSquat,
  'Dragon Pistol Squat':         DragonPistolSquat,
  'Shrimp → Pistol Progression': ShrimpToPistol,
};

export const BRANCH_ICONS_BY_CLASS: Record<string, Record<string, ReactElement>> = {
  JUGGERNAUT: {
    'Sled': Sled,
  },
  BERSERKER: {
    'Sled': BerserkerSled,
  },
};

export function branchIcon(
  branchName: string | null,
  className?: string,
): ReactElement {
  if (!branchName) return Default;
  // Per-class override (e.g. JUGGERNAUT.Sled vs BERSERKER.Sled)
  if (className) {
    const cls = BRANCH_ICONS_BY_CLASS[className];
    if (cls && cls[branchName]) return cls[branchName];
  }
  return BRANCH_ICONS[branchName] ?? Default;
}

const Default = icon(
  <>
    {/* Generic diamond for unknown branches */}
    <path d="M12 3 L21 12 L12 21 L3 12 Z" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
  </>,
);