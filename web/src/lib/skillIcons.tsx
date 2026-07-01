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

const Squat = icon(
  <>
    {/* Barbell: long bar with weight plates at each end */}
    <line x1="4" y1="14" x2="20" y2="14" />
    <rect x="2" y="11" width="3" height="6" rx="0.5" />
    <rect x="19" y="11" width="3" height="6" rx="0.5" />
    {/* Squatter's shoulders — slight V under the bar */}
    <path d="M8 14 L10 18 L14 18 L16 14" />
    {/* Lower body squat */}
    <path d="M10 18 L9 21" />
    <path d="M14 18 L15 21" />
  </>
);

const Press = icon(
  <>
    {/* Bench */}
    <rect x="3" y="14" width="18" height="3" rx="0.5" />
    {/* Bench legs */}
    <line x1="5" y1="17" x2="5" y2="20" />
    <line x1="19" y1="17" x2="19" y2="20" />
    {/* Bar + plates above */}
    <line x1="4" y1="9" x2="20" y2="9" />
    <rect x="2" y="6" width="3" height="6" rx="0.5" />
    <rect x="19" y="6" width="3" height="6" rx="0.5" />
  </>
);

const Deadlift = icon(
  <>
    {/* Bar with plates, low to ground */}
    <line x1="4" y1="18" x2="20" y2="18" />
    <rect x="2" y="15" width="3" height="6" rx="0.5" />
    <rect x="19" y="15" width="3" height="6" rx="0.5" />
    {/* Up-arrow showing the lift direction */}
    <path d="M12 14 L12 7 M9 10 L12 7 L15 10" />
  </>
);

const OverheadPress = icon(
  <>
    {/* Arms pushing bar up — V shape */}
    <path d="M8 16 L12 8 L16 16" />
    {/* Bar with plates at top */}
    <line x1="4" y1="6" x2="20" y2="6" />
    <rect x="2" y="3" width="3" height="6" rx="0.5" />
    <rect x="19" y="3" width="3" height="6" rx="0.5" />
    {/* Head */}
    <circle cx="12" cy="18" r="2" />
  </>
);

const Strongman = icon(
  <>
    {/* Yoke: vertical pole + horizontal crossbar */}
    <line x1="12" y1="3" x2="12" y2="15" />
    <line x1="4" y1="6" x2="20" y2="6" />
    {/* Weights hanging on each end of the crossbar */}
    <rect x="3" y="7" width="3" height="5" rx="0.5" />
    <rect x="18" y="7" width="3" height="5" rx="0.5" />
    {/* Carrier's body */}
    <circle cx="12" cy="19" r="2.25" />
    <line x1="12" y1="15" x2="12" y2="16.75" />
  </>
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

// (Planche was previously hand-coded here as a stopgap while waiting
// for fal.ai to generate a real icon. It's been replaced by the
// PNG at web/public/icons/calitree/planche.png. The hand-coded SVG
// is removed to avoid confusion.)

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

const HeroWODs = icon(
  <>
    {/* Medal — circle with star inside */}
    <circle cx="12" cy="9" r="5" />
    {/* Star (5-point) inside the circle */}
    <path d="M12 6 L13 8 L15 8 L13.5 9.5 L14 12 L12 10.5 L10 12 L10.5 9.5 L9 8 L11 8 Z" />
    {/* Ribbon below */}
    <path d="M9 14 L7 22 L12 19 L17 22 L15 14" />
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
  </>
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

const Mindfulness = icon(
  <>
    {/* Meditation figure — head + crossed legs (V shape) */}
    <circle cx="12" cy="6" r="2" />
    {/* Arms resting on knees */}
    <path d="M10 8 L7 13" />
    <path d="M14 8 L17 13" />
    {/* Crossed legs — wide V */}
    <path d="M12 10 L4 19" />
    <path d="M12 10 L20 19" />
    {/* Base */}
    <line x1="3" y1="20" x2="21" y2="20" />
  </>
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
  // JUGGERNAUT — heavy barbell / strongman (no perfect calitree
  // match; using the closest bodyweight movement for each)
  'Squat':          'bodyweight-squat',
  'Press':          'bench-dips',        // bench + bar vibe
  'Deadlift':       'cossack-squat',     // wide-stance heavy lift
  'Overhead Press': 'pike-press',        // overhead pressing motion
  'Strongman':     'bulgarian-dips',    // heavy weighted hold
  // 'Sled' — no calitree equivalent, falls back to hand-coded SVG

  // PHANTOM — calisthenics, direct mapping
  'Push':           'incline-push-ups',
  'Pull':           'pull-ups',
  'Holds':          'plank',
  'Rings':          'ring-dips',
  'Handstand':      'wall-handstand',
  // 'Planche' — generated via fal.ai FLUX schnell because calitree's
  // own planche icon is just a front-lever figure (a guy lying on
  // his stomach). Front lever = arms UP to bar above; planche =
  // arms DOWN to ground below. The two moves look superficially
  // similar but are mechanically opposite. See
  // web/public/icons/calitree/planche.png — script:
  // scripts/gen-planche-icon.py.

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
  // 'Mindfulness' — no calitree equivalent.
  'Yoga':           'bridge-hold',
  'Pilates':        'l-sit',
};

export function calitreeIconFor(branchName: string | null): string | null {
  if (!branchName) return null;
  return CALITREE_ICON_FILES[branchName] ?? null;
}

export const BRANCH_ICONS: Record<string, ReactElement> = {
  // JUGGERNAUT — branches without calitree matches use hand-coded SVGs
  'Sled': Sled,
  // PHANTOM
  // All 6 branches have calitree matches (the planche PNG was
  // generated via fal.ai FLUX schnell since calitree's own planche
  // icon is a front-lever figure).
  // SCOUT — no calitree matches for any of the 3 branches
  'Run': Run,
  'Ruck': Ruck,
  'Triathlon': Triathlon,
  // BERSERKER — only Hero WODs + Capacity have calitree matches
  'Kettlebell': Kettlebell,
  'Boxing': Boxing,
  'Mace / Indian Club': Mace,
  // TRACER — only Plyo + Parkour + Agility have matches
  'Sprint': Sprint,
  'Throws': Throws,
  // ORACLE — only Mobility + Breath + Balance + Yoga + Pilates have matches
  'Mindfulness': Mindfulness,
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