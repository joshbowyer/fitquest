/**
 * Skill tree v1 — full data for all skills across 6 classes.
 *
 * Tree structure:
 *   JUGGERNAUT  — 6 branches = 39 skills   (tier-based prereqs)
 *   PHANTOM     — 7 branches = 50 skills   (explicit per-skill prereqs)
 *   SCOUT       — 3 branches = 20 skills   (tier-based prereqs)
 *   BERSERKER   — 7 branches = ~45 skills  (tier-based prereqs)
 *                                (Capacity absorbed Hero WODs; +2 KB
 *                                farmer's carries; +Sandbag; +MB)
 *   TRACER      — 5 branches = 27 skills   (tier-based prereqs)
 *   ORACLE      — 6 branches = 34 skills   (tier-based prereqs)
 *
 * Prereq models:
 *   - Explicit (PHANTOM): each skill declares `prereqs: string[]`
 *     pointing at the skill names that must be unlocked first.
 *     Linear chains per branch with a few weaving merge points
 *     (e.g. 5 Ring Rows + 5 Ring Dips both unlock from Rings Support,
 *     then 5 Ring Muscle-Ups requires both). Readable top-to-bottom
 *     in the seed — no surprises from the auto-tier heuristic.
 *   - Tier-based (other classes): T2 requires all T1s in the same
 *     class+branch; T3 requires all T2s; T1 has no prereqs. Less
 *     polished but functional — slated for the ROADMAP follow-up
 *     "same fix for other classes".
 *
 * SP economy: REMOVED. The unlock is gated on the test (if
 * defined) + the per-skill prereqs. No level gate, no point
 * economy. Pre-v1 skills (no test) still get the prereq check
 * but no SP cost.
 *
 * Each skill has:
 *   - blurb: "What is this skill / why does it matter?"
 *   - description: short in-game perk summary (gold multiplier etc.)
 *   - test: { description, safety, metric, threshold } — used by
 *     the unlock endpoint to validate the user's submitted result
 *
 * Re-seeding is idempotent (upsert by skill name). Existing data
 * with null blurb / null test still works — the unlock endpoint
 * skips the test-validation block when test is missing.
 *
 * The structure mirrors api/src/lib/skillTest.ts's validators —
 * if you add a new metric type, add a case there AND a way to
 * fill it in the seed below.
 */

import { prisma } from './prisma.js';

// ---- Test spec shape (mirrors lib/skillTest.ts) ----
//
// prereqs is optional. When set, it lists the explicit skill
// names that must be unlocked before this skill can be unlocked.
// When unset (legacy auto-prereq path), the seed loop falls back
// to the tier-based heuristic: T2 requires all T1s in the same
// class+branch, T3 requires all T2s, T1 has no prereqs. PHANTOM
// uses the explicit form (clean linear progression per branch);
// the other classes still use the heuristic (less polished
// but functional — slated for the "same fix for other classes"
// ROADMAP follow-up).
//
// tier can be any of TIER_1..TIER_6. We extended the enum past
// TIER_3 in 2026-07 to support per-branch god-tier "super-tiers"
// — e.g. PHANTOM Holds' 30s V-Sit / 5s Back Lever are clearly
// harder than the rest of the branch's T3 set, and forced them
// into the same T3 as L-Sit / Straddle L. With T4..T6 the
// branch's hard-god-tier can sit at its own level (T5 in Holds).
type Tier = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6';

type Spec = {
  name: string;
  branch: string;
  blurb: string;
  description: string; // in-game perk summary
  tier: Tier;
  prereqs?: string[];
  test: {
    description: string;
    safety: string;
    metric: 'reps' | 'reps:each' | 'weight:reps' | 'weighted:reps:each' | 'duration' | 'distance' | 'rounds';
    threshold: {
      reps?: number;
      weight_kg_mult_of_bw?: number;
      duration_sec?: number;
      distance_m?: number;
      rounds?: number;
      /** 'each' (per side) or 'total' — stored in the seeded
       *  threshold JSON for unilateral tests. */
      sides?: string;
    };
  };
};

// Per-branch wrapper. `maxTier` is the highest tier in this
// branch — the SkillTree page uses it to decide which nodes get
// the "god-tier" glow treatment (s.tier === branch.maxTier).
// Most branches default to TIER_3 (the historical cap); the ones
// that need it explicitly override to TIER_4..TIER_6.
type BranchSpec = {
  name: string;
  maxTier?: Tier;
  skills: Spec[];
};

// Per-branch "highest tier" override. Most branches top out at
// TIER_3 (the historical cap) — those don't need to be in this
// map. Branches where the hardest skill is clearly past the rest
// of the T3 set are listed with their god-tier max (TIER_4, TIER_5,
// or TIER_6). The SkillTree page uses this entry (or TIER_3 as
// the default) to decide which nodes get the god-tier glow.
//
//   Holds: V-Sit is way past L-Sit, Front Lever > Straddle L,
//          Back Lever is the hardest. The T3/T4/T5 split captures
//          the realistic progression within the branch.
//   JUGGERNAUT Strongman: 200ft Atlas-stone carry at 1×BW is a
//          long event. The other Strongman T3s are shorter / lighter.
//   BERSERKER Sandbag god-tier (30 reps at 70kg in <8:00) is heavy
//          high-volume; the other Sandbag T3s are single-event feats.
//   ORACLE Mobility god-tier (Pancake + Splits combo) is the
//          culmination of the flexibility branch.
// Every branch's hardest skill now sits well past the rest of its
// progression, so each branch tops out at its own super-tier (T4-T6)
// instead of the historical T3 cap. The tier gradient reflects real
// difficulty spread (e.g. a knee one-arm push-up and a 50%BW weighted
// one-arm push-up are NOT the same tier). The god-tier feat in each
// branch is the last skill in the branch's chain and matches this
// max (that's what earns the god-tier glow in the UI).
//
// IMPORTANT: keep this in sync with BRANCH_MAX_TIER in
// web/src/pages/SkillTree.tsx — they must agree or the glow misfires.
const BRANCH_MAX_TIER: Record<string, Tier> = {
  // JUGGERNAUT
  Squat: 'TIER_5',
  Press: 'TIER_4',
  Deadlift: 'TIER_4',
  Strongman: 'TIER_4',
  Sled: 'TIER_5', // shared name: JUGGERNAUT + BERSERKER Sled both cap T5
  // PHANTOM (calisthenics)
  Push: 'TIER_6',
  Pull: 'TIER_5',
  Holds: 'TIER_5',
  Rings: 'TIER_5',
  Handstand: 'TIER_5',
  Planche: 'TIER_6',
  Legs: 'TIER_5',
  // SCOUT
  Run: 'TIER_6',
  Ruck: 'TIER_5',
  Triathlon: 'TIER_5',
  // BERSERKER
  Kettlebell: 'TIER_4',
  Capacity: 'TIER_4',
  Boxing: 'TIER_4',
  'Mace / Indian Club': 'TIER_4',
  Sandbag: 'TIER_4',
  // TRACER
  Sprint: 'TIER_5',
  Plyo: 'TIER_5',
  Parkour: 'TIER_5',
  Agility: 'TIER_4',
  // ORACLE
  Mobility: 'TIER_5',
  Breath: 'TIER_4',
  Balance: 'TIER_5',
  'Ignatian Meditation': 'TIER_4',
  Yoga: 'TIER_4',
};

function maxTierFor(branchName: string): Tier {
  return BRANCH_MAX_TIER[branchName] ?? 'TIER_3';
}

// ---- 1. JUGGERNAUT (heavy + strongman) — 39 skills, linear prereqs ----
//
// Explicit per-skill prereqs (mirrors PHANTOM + SCOUT + BERSERKER).
// Each branch is roughly linear with 1-2 weaving merge points at
// the heavier weights. See the per-branch comment headers for the
// specific chains. Strongman has a weaving merge between Yoke Walk
// (T2 carry) and Atlas Stones (T2 loading) — both branch from
// the Farmer Walk T1 and each feeds its own T3.
const JUGGERNAUT_SKILLS: Spec[] = [
  // A. Squat — two parallel progressions off the T1s (volume +
  // pause-single), converging at the 2×BW god-tier set.
  { name: 'Half-Squat Initiate', branch: 'Squat', tier: 'TIER_1', prereqs: [], blurb: 'Build the squat pattern with light load before going heavy.', description: '+5% squat volume XP', test: { description: '5 reps at half your bodyweight, full depth to parallel. Bar on upper traps, neutral spine, knees track over toes.', safety: 'Warm up with bodyweight squats first. Don\'t let knees cave in.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Bodyweight Squat', branch: 'Squat', tier: 'TIER_1', prereqs: [], blurb: 'Unweighted squat at full depth.', description: '+5% squat frequency XP', test: { description: '5 reps at bodyweight, full depth (hip crease below knee). Brace core, neutral spine, controlled eccentric (3s descent).', safety: 'Knees stay aligned over toes. Heels stay grounded.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Squat 1.25×BW', branch: 'Squat', tier: 'TIER_2', prereqs: ['Half-Squat Initiate'], blurb: 'Intermediate-end novice squat milestone.', description: '+5% squat XP', test: { description: '5 reps at 1.25× bodyweight, full depth. Same form as T2.', safety: 'Use safety pins set 1-2" below your chest in a rack.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'Squat 1.5×BW Pause', branch: 'Squat', tier: 'TIER_2', prereqs: ['Bodyweight Squat'], blurb: 'First true strength milestone — heavy single with proper pause.', description: '+5% squat 1RM tracking', test: { description: '1 rep at 1.5× bodyweight, full depth, 3-second pause at the bottom. Drive up smoothly.', safety: 'Safety pins mandatory. Have a spotter for the unrack.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Squat 5×1.5×BW', branch: 'Squat', tier: 'TIER_3', prereqs: ['Squat 1.5×BW Pause'], blurb: 'Volume at intermediate-end load.', description: '+8% squat work XP', test: { description: '5 reps at 1.5× bodyweight, 2s pause at the bottom each rep. Controlled tempo throughout.', safety: 'Use safety pins. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Squat 2×BW Single', branch: 'Squat', tier: 'TIER_4', prereqs: ['Squat 1.5×BW Pause'], blurb: 'Advanced — heavy single-rep squat.', description: '+10% squat 1RM XP', test: { description: '1 rep at 2× bodyweight, full depth, controlled descent + ascent. Pause briefly at the bottom.', safety: 'Safety pins set 1" below your depth. Have spotters.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.0 } } },
  { name: 'Squat 5×2×BW', branch: 'Squat', tier: 'TIER_5', prereqs: ['Squat 2×BW Single'], blurb: 'Advanced work-set at 2× bodyweight — small percentages-of-lifters territory.', description: '+12% squat 1RM tracking', test: { description: '5 reps at 2× bodyweight, full depth, controlled tempo. 2s pause at the bottom each rep.', safety: 'Safety pins mandatory. Have at least one spotter.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 2.0 } } },

  // B. Bench Press — two T1s (half-bench single + 0.75×BW volume)
  // converge into Bench 1×BW T2 (volume). T2 1.25×BW Strict
  // branches off half-bench. T3 1.5×BW requires BOTH T2s (weaving).
  // T3 1.75×BW (heavy single) requires 1.5×BW. T3 3×1.25×BW
  // (volume) requires Bench 1×BW.
  { name: 'Half-Bench Initiate', branch: 'Press', tier: 'TIER_1', prereqs: [], blurb: 'Bench pattern with light load — arch, leg drive, bar path.', description: '+5% bench volume XP', test: { description: '5 reps at half bodyweight, bar to lower chest. Slight arch, leg drive, bar path: lower to chest, drive up and slightly back.', safety: 'Use safety pins set 1-2" above your chest.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Bench 0.75×BW', branch: 'Press', tier: 'TIER_1', prereqs: [], blurb: 'Beginner-end bench volume.', description: '+5% bench XP', test: { description: '5 reps at 0.75× bodyweight, controlled eccentric, full ROM to lower chest.', safety: 'Use safety pins + spotter if available.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'Bench 1×BW', branch: 'Press', tier: 'TIER_2', prereqs: ['Bench 0.75×BW'], blurb: 'Bodyweight bench press — the bodyweight milestone for most lifters.', description: '+5% bench XP', test: { description: '5 reps at 1× bodyweight, full ROM. Touch chest lightly, drive up and back.', safety: 'Safety pins set 1" above your chest. Spotter recommended.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'Bench 1.25×BW Strict', branch: 'Press', tier: 'TIER_2', prereqs: ['Half-Bench Initiate'], blurb: 'Intermediate-end bench strict form.', description: '+5% bench 1RM tracking', test: { description: '1 rep at 1.25× bodyweight, strict form (full ROM, controlled eccentric, paused at the chest).', safety: 'Spotter + safety pins mandatory.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'Bench 1.5×BW Strict', branch: 'Press', tier: 'TIER_3', prereqs: ['Bench 1×BW', 'Bench 1.25×BW Strict'], blurb: 'Advanced bench — competitive lifter territory.', description: '+8% bench 1RM tracking', test: { description: '1 rep at 1.5× bodyweight, strict form. Pause at the chest, full ROM.', safety: 'Spotter + safety pins mandatory.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Bench 1.75×BW Strict', branch: 'Press', tier: 'TIER_4', prereqs: ['Bench 1.5×BW Strict'], blurb: 'Elite bench — competitive powerlifter.', description: '+10% bench 1RM tracking', test: { description: '1 rep at 1.75× bodyweight, strict form. Pause at the chest.', safety: 'Spotters + safety pins. Only attempt after a successful 1.5×BW max.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.75 } } },
  { name: 'Bench 3×1.25×BW Strict', branch: 'Press', tier: 'TIER_4', prereqs: ['Bench 1×BW'], blurb: 'Work capacity at advanced load — bench god-tier work set.', description: '+12% bench 1RM tracking', test: { description: '3 reps at 1.25× bodyweight, strict form. Full ROM, controlled tempo.', safety: 'Spotter + safety pins. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 1.25 } } },

  // C. Deadlift — two T1s (light + heavier) merge into T2
  // single + volume progressions.
  { name: 'DL 0.75×BW Conventional', branch: 'Deadlift', tier: 'TIER_1', prereqs: [], blurb: 'Beginner conventional deadlift volume.', description: '+5% DL volume XP', test: { description: '5 reps at 0.75× bodyweight, conventional stance, neutral spine, controlled eccentric.', safety: 'Brace HARD. Use mixed grip if grip is limiting.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'DL 1.25×BW Conventional', branch: 'Deadlift', tier: 'TIER_1', prereqs: [], blurb: 'Beginner-end deadlift — first real weight milestone.', description: '+5% DL XP', test: { description: '5 reps at 1.25× bodyweight, conventional. Brace before the pull. Neutral spine throughout.', safety: 'Use mixed grip or straps if grip is limiting.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'DL 1.5×BW Conventional', branch: 'Deadlift', tier: 'TIER_2', prereqs: ['DL 0.75×BW Conventional'], blurb: 'Intermediate novice deadlift — bodyweight deadlift is the Starting Strength endgame for many lifters.', description: '+5% DL XP', test: { description: '5 reps at 1.5× bodyweight, conventional. Brace, hinge, drive through heels. Neutral spine throughout.', safety: 'Use lifting belt if you have one. Strap in or chalk up for grip.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'DL 2×BW Conventional', branch: 'Deadlift', tier: 'TIER_2', prereqs: ['DL 1.25×BW Conventional'], blurb: 'Intermediate-end single — strong lift.', description: '+5% DL 1RM tracking', test: { description: '1 rep at 2× bodyweight, conventional stance. Brace before the pull. Neutral spine, lockout at the top.', safety: 'Use a belt. Have a spotter in case of grip failure.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.0 } } },
  { name: 'DL 2.25×BW Conventional', branch: 'Deadlift', tier: 'TIER_3', prereqs: ['DL 1.5×BW Conventional'], blurb: 'Advanced single — strong lifter.', description: '+8% DL 1RM tracking', test: { description: '1 rep at 2.25× bodyweight, conventional. Brace HARD, neutral spine, lockout.', safety: 'Belt + spotter. Straps or hook grip if needed.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.25 } } },
  { name: 'DL 2.5×BW Conventional', branch: 'Deadlift', tier: 'TIER_4', prereqs: ['DL 2.25×BW Conventional'], blurb: 'Elite single — competitive powerlifter territory.', description: '+10% DL 1RM tracking', test: { description: '1 rep at 2.5× bodyweight, conventional. Brace HARD. Lockout cleanly.', safety: 'Belt + spotter. Use hook grip if you have it.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.5 } } },
  { name: 'DL 3×2×BW Conventional', branch: 'Deadlift', tier: 'TIER_4', prereqs: ['DL 1.5×BW Conventional'], blurb: 'Work capacity at advanced load — DL god-tier work set.', description: '+12% DL 1RM tracking', test: { description: '3 reps at 2× bodyweight, conventional. Brace each rep. Neutral spine throughout.', safety: 'Belt + spotter mandatory. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 2.0 } } },

  // D. Overhead Press — T1 30% / T1 50% / T2 0.75×BW / T2 0.75×BW
  // single. T3 single is the god-tier (1×BW strict). T3 volume
  // branches off T2 0.75×BW.
  { name: 'OHP 30% BW Initiate', branch: 'Overhead Press', tier: 'TIER_1', prereqs: [], blurb: 'Beginner overhead press pattern.', description: '+5% OHP volume XP', test: { description: '5 reps at 30% bodyweight overhead press. Brace core. Press in a straight line, head through at the top.', safety: 'Don\'t flare ribs. Keep core tight.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.3 } } },
  { name: 'OHP 50% BW', branch: 'Overhead Press', tier: 'TIER_1', prereqs: [], blurb: 'Beginner-end press volume.', description: '+5% OHP XP', test: { description: '5 reps at 50% bodyweight overhead press, strict form.', safety: 'Brace core. Don\'t lean back excessively.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'OHP 0.75×BW Strict', branch: 'Overhead Press', tier: 'TIER_2', prereqs: ['OHP 30% BW Initiate'], blurb: 'Intermediate-end press strict form.', description: '+5% OHP 1RM tracking', test: { description: '5 reps at 0.75× bodyweight, strict overhead press. Brace core, head through at the top.', safety: 'Brace core hard. Don\'t lean back excessively.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'OHP 0.75×BW Strict Single', branch: 'Overhead Press', tier: 'TIER_2', prereqs: ['OHP 50% BW'], blurb: 'Strict single at intermediate load.', description: '+5% OHP 1RM tracking', test: { description: '1 rep at 0.75× bodyweight, strict form.', safety: 'Brace core. Use safety bars or a spotter.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'OHP 1×BW Strict', branch: 'Overhead Press', tier: 'TIER_3', prereqs: ['OHP 0.75×BW Strict', 'OHP 0.75×BW Strict Single'], blurb: 'The holy grail of pressing — bodyweight strict press.', description: '+15% OHP 1RM tracking', test: { description: '1 rep at bodyweight, strict form. Brace core HARD, head through at the top.', safety: 'Brace core. Use safety bars or spotter.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'OHP 3×0.75×BW Strict', branch: 'Overhead Press', tier: 'TIER_3', prereqs: ['OHP 0.75×BW Strict'], blurb: 'Work capacity at intermediate-end press.', description: '+12% OHP 1RM tracking', test: { description: '3 reps at 0.75× bodyweight, strict form. Brace each rep. Head through at the top.', safety: 'Brace core. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 0.75 } } },

  // E. Strongman — Farmer walk T1 → Yoke walk T2 / Atlas Stones T2
  // (weaving merge). T3: Atlas 100ft + Husafell from each T2.
  // T3 god-tier: Atlas 200ft requires 100ft (progression).
  { name: 'Farmer Walk 50m', branch: 'Strongman', tier: 'TIER_1', prereqs: [], blurb: 'Loaded carry — grip + core + posture.', description: '+5% carry XP', test: { description: '50m farmer walk at 0.5× bodyweight per hand. Stand tall, slow controlled steps. Don\'t lean.', safety: 'Use a flat surface. Wear flat shoes. Chalk or use straps if grip is limiting.', metric: 'weight:reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Yoke Walk 20m', branch: 'Strongman', tier: 'TIER_2', prereqs: ['Farmer Walk 50m'], blurb: 'Heavy yoke carry — pure back + core.', description: '+8% carry XP', test: { description: '20m yoke walk at 1.5× bodyweight. Walk slowly, stand tall, breathe.', safety: 'Use a flat surface. Wear a belt if you have one.', metric: 'reps', threshold: { reps: 20, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Atlas Stones 5 in 60s', branch: 'Strongman', tier: 'TIER_2', prereqs: ['Farmer Walk 50m'], blurb: 'Loading event — multiple stone lifts to platform.', description: '+8% strongman XP', test: { description: '5 atlas stones to a 48" platform in under 60 seconds. Use tacky. Lap each stone.', safety: 'Use proper lifting form. Tacky or chalk for grip. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Atlas 100ft @ 1×BW', branch: 'Strongman', tier: 'TIER_3', prereqs: ['Atlas Stones 5 in 60s'], blurb: 'Strongman loading event at bodyweight — long carry, multiple stones.', description: '+10% strongman XP', test: { description: '100ft atlas-stone carry at 1× bodyweight total. Multiple stones, lap them as needed.', safety: 'Use proper form. Tacky + belt. Spotter for transitions.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'Husafell 50m @ 1.5×BW', branch: 'Strongman', tier: 'TIER_3', prereqs: ['Yoke Walk 20m'], blurb: 'The iconic — circular yoke walk with stones.', description: '+12% strongman XP', test: { description: '50m circular walk with 1.5×BW total weight (per hand 0.75×BW). Use the stones, walk the circle, transition smoothly.', safety: 'Practice lighter loads first. Tacky + belt.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Atlas 200ft @ 1×BW', branch: 'Strongman', tier: 'TIER_4', prereqs: ['Atlas 100ft @ 1×BW'], blurb: 'Strongman god-tier — long loading carry at bodyweight.', description: '+15% strongman XP', test: { description: '200ft atlas-stone carry at 1× bodyweight total. Multiple stones, plan transitions.', safety: 'Practice shorter distances first. Belt + tacky + spotter.', metric: 'reps', threshold: { reps: 200, weight_kg_mult_of_bw: 1.0 } } },

  // F. Sled (strongman variety — disambiguated from BERSERKER's
  // prowler-sled branch by the (Strongman) infix so the upsert-by-name
  // seed doesn't collapse the two class-specific trees into one).
  // Linear: 25m → 50m (T1) → 100m@50% (T2) → 1mi@50% → 1mi@75% →
  // 1mi@100% (T3 chain).
  { name: 'Sled (Strongman) Push 25m', branch: 'Sled', tier: 'TIER_1', prereqs: [], blurb: 'Light sled work — horizontal push introduction.', description: '+5% sled XP', test: { description: 'Push a sled 25m at 0.25× bodyweight. Bend at the waist, drive through the legs, don\'t hyperextend at the top.', safety: 'Flat surface, good shoes. Don\'t lock the knees at the top.', metric: 'reps', threshold: { reps: 25, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled (Strongman) Push 50m', branch: 'Sled', tier: 'TIER_1', prereqs: ['Sled (Strongman) Push 25m'], blurb: 'Volume at light load.', description: '+5% sled XP', test: { description: 'Push 50m at 0.25× bodyweight. Same form as T1.', safety: 'Flat surface, good shoes.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled (Strongman) Push 100m @ 50%BW', branch: 'Sled', tier: 'TIER_2', prereqs: ['Sled (Strongman) Push 50m'], blurb: 'Distance at half bodyweight.', description: '+8% sled XP', test: { description: 'Push 100m at 0.5× bodyweight. Drive through legs, controlled pace.', safety: 'Flat surface. Wear good shoes for grip.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Sled (Strongman) 1mi @ 50%BW < 8:00', branch: 'Sled', tier: 'TIER_3', prereqs: ['Sled (Strongman) Push 100m @ 50%BW'], blurb: 'A mile of heavy sled — pure grit.', description: '+10% sled XP', test: { description: 'Push a sled 1 mile at 0.5× bodyweight in under 8 minutes. Steady pace, drive through the legs.', safety: 'Flat surface. Don\'t grip too hard — use the harness.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled (Strongman) 1mi @ 75%BW < 8:00', branch: 'Sled', tier: 'TIER_4', prereqs: ['Sled (Strongman) 1mi @ 50%BW < 8:00'], blurb: 'Three-quarter bodyweight mile.', description: '+12% sled XP', test: { description: 'Push 1 mile at 0.75× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lighter loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled (Strongman) 1mi @ 100%BW < 8:00', branch: 'Sled', tier: 'TIER_5', prereqs: ['Sled (Strongman) 1mi @ 75%BW < 8:00'], blurb: 'Bodyweight mile — strongman crossfit benchmark.', description: '+15% sled XP', test: { description: 'Push 1 mile at bodyweight in under 8 minutes. Strongman-class feat.', safety: 'Flat surface. Practice lower loads first. Spotter / coach nearby.', metric: 'duration', threshold: { duration_sec: 480 } } },
];

// ---- 2. PHANTOM (calisthenics + gymnastics) — 42 skills ----
// ---- 2. PHANTOM (calisthenics + bodyweight) — 6 branches, linear prereqs ----
//
// Each skill declares its own prereqs explicitly so the topology is
// readable top-to-bottom (no surprises from the auto-T1-all logic).
// Linear chains per branch, with a few merge points where weaving
// makes sense (e.g. 5 Ring Rows + 5 Ring Dips both unlock from
// Rings Support, then 5 Ring Muscle-Ups requires both).
const PHANTOM_SKILLS: Spec[] = [
  // A. Push (horizontal pressing) — linear chain
  { name: 'Incline Push-Up Initiate', branch: 'Push', tier: 'TIER_1', prereqs: [],
    blurb: 'Easier-than-wall push-up — start here.', description: '+5% push-up volume XP',
    test: { description: '5 incline push-ups (hands on a 12"+" surface, body straight, full ROM).', safety: 'Keep elbows tracked. Don\'t shrug shoulders.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Standard Push-Up 20', branch: 'Push', tier: 'TIER_2', prereqs: ['Incline Push-Up Initiate'],
    blurb: 'Bodyweight push-up milestone — 20 in a row.', description: '+5% push-up XP',
    test: { description: '20 standard push-ups in a row, full ROM (chest within a fist of the floor).', safety: 'Lower slowly (3-4s eccentric). Don\'t flare elbows past 75°.', metric: 'reps', threshold: { reps: 20 } } },
  { name: 'Archer Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Standard Push-Up 20'],
    blurb: 'Asymmetric push-up — first step toward one-arm work.', description: '+5% push-up XP',
    test: { description: '5 archer push-ups on each side. Most weight stays on one arm, the other extends out for balance.', safety: 'Warm up with regular push-ups first. Don\'t shrug.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'One-Arm Push-Up (knee)', branch: 'Push', tier: 'TIER_3', prereqs: ['Archer Push-Up'],
    blurb: 'One-arm push-up with knee assist — building the path to freestanding.', description: '+10% push-up XP',
    test: { description: '5 one-arm push-ups on each side, with the off hand on the knee. Full ROM, controlled.', safety: 'Master archer PU first. Use a wider stance for balance.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'One-Arm Push-Up (no knee)', branch: 'Push', tier: 'TIER_4', prereqs: ['One-Arm Push-Up (knee)'],
    blurb: 'Freestanding one-arm push-up — pure horizontal pressing strength.', description: '+12% push-up XP',
    test: { description: '5 one-arm push-ups on each side, no knee assist. Full ROM, body stays rigid.', safety: 'Warm up with archer PU first. Stop if shoulder pain.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Weighted 1-Arm PU 25% BW', branch: 'Push', tier: 'TIER_5', prereqs: ['One-Arm Push-Up (no knee)'],
    blurb: 'First weighted push-up — strong horizontal pressing.', description: '+15% push-up 1RM tracking',
    test: { description: '5 weighted one-arm push-ups on each side, with 25% bodyweight added (vest or plate on back).', safety: 'Master unweighted 1-arm PU first. Use a vest or plate placement that doesn\'t shift during the rep.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.25, sides: 'each' } } },
  { name: 'Weighted 1-Arm PU 50% BW', branch: 'Push', tier: 'TIER_6', prereqs: ['Weighted 1-Arm PU 25% BW'],
    blurb: 'Horizontal pressing god-tier — 1-arm PU with bodyweight added.', description: '+20% push-up 1RM tracking',
    test: { description: '5 weighted one-arm push-ups on each side, with 50% bodyweight added.', safety: 'Strong unweighted 1-arm PU + 25% weighted first. Use a spotter for safety.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5, sides: 'each' } } },

  // Push variants — width, angle, and explosive variations on the
  // standard push-up. Wide-grip for chest width, diamond for triceps,
  // decline/elevated feet for upper chest, Hindu/Spiderman/Dive
  // Bomber for shoulder mobility + serratus, Clap/Superman/Aztec for
  // explosive power.
  { name: 'Wide Push-Up', branch: 'Push', tier: 'TIER_1', prereqs: ['Incline Push-Up Initiate'],
    blurb: 'Wide-grip push-up — chest-width emphasis.', description: '+5% push-up XP',
    test: { description: '5 wide-grip push-ups, hands ~1.5× shoulder-width, full ROM (chest within a fist of the floor).', safety: 'Don\'t shrug. Keep elbows tracked at ~45° (not flared to 90°).', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Diamond Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Standard Push-Up 20'],
    blurb: 'Diamond push-up — triceps and inner-chest focus.', description: '+8% push-up XP',
    test: { description: '5 diamond push-ups, hands together forming a diamond shape under the chest, full ROM, elbows tight to torso.', safety: 'Don\'t flare elbows. Warm up with regular push-ups first.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Decline Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Standard Push-Up 20'],
    blurb: 'Decline push-up (feet elevated) — upper-chest emphasis.', description: '+8% push-up XP',
    test: { description: '5 decline push-ups with feet on a 12-18" surface, hands on floor, full ROM, body rigid.', safety: 'Don\'t sag hips. Master regular push-ups first.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Hindu Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Standard Push-Up 20'],
    blurb: 'Hindu push-up — flowing downward-dog into upward-dog. Serratus + shoulder mobility.', description: '+8% push-up XP',
    test: { description: '5 Hindu push-ups in a row, full flowing motion (scoop down through downward dog, push up through upward dog).', safety: 'Master regular push-ups first. Don\'t yank the neck — lead with the chest.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Spiderman Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Standard Push-Up 20'],
    blurb: 'Spiderman push-up — bring the knee to the elbow on each rep. Core + hip flexor.', description: '+8% push-up XP',
    test: { description: '5 Spiderman push-ups on each side (knee to elbow as you descend, full ROM each rep).', safety: 'Master regular push-ups first. Keep hips level.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Typewriter Push-Up', branch: 'Push', tier: 'TIER_2', prereqs: ['Archer Push-Up'],
    blurb: 'Typewriter push-up — at the top, shift side to side. Asymmetric pressing control.', description: '+8% push-up XP',
    test: { description: '5 typewriter push-ups (push up to archer position, shift weight side to side, touch chest to each side).', safety: 'Strong archer PU first. Don\'t shrug. Have a wall for balance.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Clap Push-Up', branch: 'Push', tier: 'TIER_3', prereqs: ['Standard Push-Up 20'],
    blurb: 'Clap push-up — explosive plyometric push-up with a clap at the top.', description: '+10% push-up XP',
    test: { description: '5 clap push-ups in a row. Push explosively, hands leave the floor, clap, land soft.', safety: 'Master 20+ standard PU first. Use a soft surface. Land with bent elbows.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Dive Bomber Push-Up', branch: 'Push', tier: 'TIER_3', prereqs: ['Hindu Push-Up'],
    blurb: 'Dive bomber — Hindu PU with a deeper scoop and reverse direction. Chest + shoulder.', description: '+10% push-up XP',
    test: { description: '5 dive bomber push-ups in a row. Deep scoop through downward dog, push up backward through upward dog.', safety: 'Strong Hindu PU first. Stretch shoulders before testing.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Superman Push-Up', branch: 'Push', tier: 'TIER_4', prereqs: ['Clap Push-Up'],
    blurb: 'Superman push-up — push up, hands leave the floor AND feet leave the floor (whole-body flight).', description: '+12% push-up XP',
    test: { description: '5 superman push-ups. Push explosively so both hands and feet leave the floor.', safety: 'Strong clap PU first. Use a soft surface. Land with bent elbows.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Aztec Push-Up', branch: 'Push', tier: 'TIER_5', prereqs: ['Superman Push-Up'],
    blurb: 'Aztec push-up — push up into a handstand, lower back down to PU position. Pure plyo + balance.', description: '+15% push-up XP',
    test: { description: '5 Aztec push-ups in a row. Push up explosively into a handstand (or near-handstand), lower back down with control.', safety: 'Strong superman PU + solid handstand balance first. Spotter nearby. Soft surface.', metric: 'reps', threshold: { reps: 5 } } },

  // Dip sub-chain — vertical pressing variation. T1 bench dips → T2
  // PB dips → T3 strict straight-bar + forward lean (two parallel
  // angles), T4 Korean + plyo + L-sit dip (advanced bar-dip angles;
  // L-sit dip is a cross-branch with Holds).
  { name: 'Bench Dip', branch: 'Push', tier: 'TIER_1', prereqs: [],
    blurb: 'Bench dip — first vertical pressing bodyweight move.', description: '+5% push-up XP',
    test: { description: '5 bench dips, hands on a bench behind you, feet on the floor, full ROM (arms to ~90°).', safety: 'Don\'t shrug. Master push-ups first. Keep shoulders down.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Parallel Bar Dip', branch: 'Push', tier: 'TIER_2', prereqs: ['Bench Dip'],
    blurb: 'Parallel bar dip — the standard vertical press.', description: '+8% push-up XP',
    test: { description: '5 parallel bar dips, full ROM, lockout at the top.', safety: 'Master bench dip first. Don\'t shrug. Don\'t go past shoulder comfort.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Straight Bar Dip', branch: 'Push', tier: 'TIER_3', prereqs: ['Parallel Bar Dip'],
    blurb: 'Straight bar dip — wrists in line, harder grip.', description: '+10% push-up XP',
    test: { description: '5 straight bar dips, wrists neutral, full ROM, lockout at the top.', safety: 'Strong PB dip first. Use chalk if grip is limiting. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Forward Lean Dip', branch: 'Push', tier: 'TIER_3', prereqs: ['Parallel Bar Dip'],
    blurb: 'Forward-lean dip — chest-forward dip on PBs for chest emphasis.', description: '+10% push-up XP',
    test: { description: '5 forward-lean parallel bar dips (chest comes forward over the bars as you descend).', safety: 'Strong PB dip first. Stretch pecs + shoulders before testing.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Korean Dip', branch: 'Push', tier: 'TIER_4', prereqs: ['Straight Bar Dip'],
    blurb: 'Korean dip — deep dip on a straight bar, hands behind the body. Intense shoulder stretch.', description: '+12% push-up XP',
    test: { description: '5 Korean dips, hands behind the body, deep ROM (below parallel).', safety: 'Strong straight-bar dip + shoulder mobility first. Stretch shoulders thoroughly. Stop if pain.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Plyo Dip', branch: 'Push', tier: 'TIER_4', prereqs: ['Straight Bar Dip'],
    blurb: 'Plyo dip — explosive dip with hands leaving the bars.', description: '+12% push-up XP',
    test: { description: '5 plyo parallel bar dips, push up so hands leave the bars momentarily.', safety: 'Strong straight-bar dip first. Spotter nearby. Soft surface.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'L-Sit Dip', branch: 'Push', tier: 'TIER_4', prereqs: ['Korean Dip', '30s L-Sit'],
    blurb: 'L-sit dip — dip while holding an L-sit. Cross-branch with Holds.', description: '+12% push-up XP',
    test: { description: '5 L-sit dips (legs straight and parallel to floor throughout the dip, full ROM).', safety: 'Strong Korean dip + 30s L-sit first. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },

  // Push god-tier — Maltese push-up needs one-arm PU + straddle
  // planche as prereqs (hardcore cross-branch work).
  { name: 'Maltese Push-Up', branch: 'Push', tier: 'TIER_6', prereqs: ['One-Arm Push-Up (no knee)', '5s Straddle Planche'],
    blurb: 'Push god-tier — Maltese push-up on parallettes. Insane shoulder + chest strength.', description: '+25% push-up XP',
    test: { description: '3 Maltese push-ups on parallettes or rings (arms extended out to the sides at the top, body lowered between them).', safety: 'Strong 1-arm PU + straddle planche first. Work up over months. Spotter nearby. Stop immediately if shoulder/elbow pain.', metric: 'reps', threshold: { reps: 3 } } },

  // B. Pull (vertical pulling) — linear chain ending at the peak.
  // Order: Dead Hang → 1 strict PU → 5 PUs → 10 PUs → Weighted PU →
  // Muscle-Up → Pull-up to Waist (explosive) → One-Arm PU.
  // One-arm is the hardest — the previous version had it before
  // Muscle-Up which inverted the real-world difficulty (one-arm PU
  // is universally harder than either a weighted PU or a muscle-up
  // for almost all climbers).
  { name: 'Dead Hang 30s Initiate', branch: 'Pull', tier: 'TIER_1', prereqs: [],
    blurb: 'Just hanging — grip + shoulder stability.', description: '+5% pull-up XP',
    test: { description: '30s dead hang from a pull-up bar. Active shoulders (don\'t shrug).', safety: 'Don\'t kip. Use a bar you can reach comfortably.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '1 Strict Pull-Up', branch: 'Pull', tier: 'TIER_1', prereqs: ['Dead Hang 30s Initiate'],
    blurb: 'The first strict pull-up — bodyweight pulling.', description: '+10% pull-up XP',
    test: { description: '1 strict pull-up (full ROM, no kip). Engage lats, drive elbows down.', safety: 'Don\'t kip. Don\'t shrug at the top.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '5 Strict Pull-Ups', branch: 'Pull', tier: 'TIER_2', prereqs: ['1 Strict Pull-Up'],
    blurb: '5 strict pull-ups in a row.', description: '+10% pull-up XP',
    test: { description: '5 strict pull-ups in a row, full ROM, controlled eccentric each rep.', safety: 'Don\'t kip. Don\'t shrug. Don\'t drop fast.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10 Pull-Ups in a Row', branch: 'Pull', tier: 'TIER_2', prereqs: ['5 Strict Pull-Ups'],
    blurb: 'Bodyweight pulling volume — solid intermediate.', description: '+10% pull-up XP',
    test: { description: '10 strict pull-ups in a row. No kip, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Weighted Pull-Up 25% BW', branch: 'Pull', tier: 'TIER_3', prereqs: ['10 Pull-Ups in a Row'],
    blurb: 'First weighted pull-up — strong bilateral pulling.', description: '+15% pull-up XP',
    test: { description: '5 weighted pull-ups at 25% bodyweight added (vest or belt). Strict form.', safety: 'Master 10 BW pull-ups first. Use a belt/vest, not dumbbell between legs.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.25, sides: 'each' } } },
  { name: '3 Muscle-Ups', branch: 'Pull', tier: 'TIER_4', prereqs: ['Weighted Pull-Up 25% BW'],
    blurb: 'Muscle-up — bilateral pulling + a smooth transition over the bar into a dip lockout.', description: '+15% pull-up XP',
    test: { description: '3 muscle-ups in a row. False grip. Strong explosive pull + smooth transition over the bar.', safety: 'Master weighted BW pull-ups first. Use a band for assistance if needed. Spotter nearby.', metric: 'reps', threshold: { reps: 3 } } },
  { name: 'High Pull-Up to Waist', branch: 'Pull', tier: 'TIER_4', prereqs: ['3 Muscle-Ups'],
    blurb: 'Explosive pulling — bar to waist, not chest.', description: '+12% pull-up XP',
    test: { description: '5 high pull-ups to waist at bodyweight. Bar comes to the navel/waist, full explosive hip drive.', safety: 'Master muscle-ups first. Don\'t shrug — keep lats engaged.', metric: 'reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'One-Arm Pull-Up (each)', branch: 'Pull', tier: 'TIER_5', prereqs: ['High Pull-Up to Waist'],
    blurb: 'One-arm bodyweight pull-up — vertical pulling god-tier.', description: '+20% pull-up XP',
    test: { description: '1 one-arm pull-up on each side at bodyweight. Full ROM, no kip. The off-arm can hold a towel on the bar for grip reference but must not pull.', safety: 'Strong explosive pull-ups (waist height) first. Use a spotter. Stop if elbow pain.', metric: 'reps', threshold: { reps: 1, sides: 'each' } } },

  // Pull variants — grip variations, rows, and lever pulls. Two T1
  // entries (scapular pull-up + inverted row) feed T2 rows + grip
  // variations. Chin-up opens as a parallel T1 path to the strict
  // pull-up. T3/T4 add grip, towel, and asymmetric variations;
  // L-sit pull-up is a cross-branch with Holds. T5/T6 are god-tier
  // holds and lever rows.
  { name: 'Scapular Pull-Up', branch: 'Pull', tier: 'TIER_1', prereqs: [],
    blurb: 'Scapular pull-up — pull the shoulders down without bending the arms. Scapula activation.', description: '+5% pull-up XP',
    test: { description: '5 scapular pull-ups from a dead hang (depress scapula, don\'t bend elbows).', safety: 'Warm up the shoulders first. Don\'t yank.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Inverted Row', branch: 'Pull', tier: 'TIER_1', prereqs: [],
    blurb: 'Inverted row (Australian pull-up) — horizontal pull, gateway to pull-ups.', description: '+5% pull-up XP',
    test: { description: '10 inverted rows, body rigid, chest to bar (or rings), controlled eccentric.', safety: 'Use a low bar + elevated feet. Keep shoulders down.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Bar Pullover', branch: 'Pull', tier: 'TIER_2', prereqs: ['Dead Hang 30s Initiate'],
    blurb: 'Bar pullover — pull knees-to-bar from a hang. First step to leg raises.', description: '+8% pull-up XP',
    test: { description: '5 bar pullovers (from dead hang, pull legs up so they pass over the bar, then lower).', safety: 'Master dead hang first. Don\'t kip.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Chin-Up', branch: 'Pull', tier: 'TIER_1', prereqs: ['Dead Hang 30s Initiate'],
    blurb: 'Chin-up — supinated grip pull-up, easier than strict PU for most.', description: '+5% pull-up XP',
    test: { description: '5 chin-ups in a row, palms facing you, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Wide-Grip Inverted Row', branch: 'Pull', tier: 'TIER_2', prereqs: ['Inverted Row'],
    blurb: 'Wide-grip inverted row — upper-back width.', description: '+8% pull-up XP',
    test: { description: '10 wide-grip inverted rows (hands wider than shoulders, chest to bar).', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Wide-Grip Pull-Up', branch: 'Pull', tier: 'TIER_2', prereqs: ['5 Strict Pull-Ups'],
    blurb: 'Wide-grip pull-up — lat-width emphasis.', description: '+8% pull-up XP',
    test: { description: '5 wide-grip pull-ups, hands ~1.5× shoulder-width, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Close-Grip Pull-Up', branch: 'Pull', tier: 'TIER_2', prereqs: ['5 Strict Pull-Ups'],
    blurb: 'Close-grip pull-up — biceps + back emphasis.', description: '+8% pull-up XP',
    test: { description: '5 close-grip pull-ups, hands a few inches apart, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Neutral-Grip Pull-Up', branch: 'Pull', tier: 'TIER_2', prereqs: ['5 Strict Pull-Ups'],
    blurb: 'Neutral-grip pull-up — palms facing each other. Shoulder-friendly grip.', description: '+8% pull-up XP',
    test: { description: '5 neutral-grip pull-ups, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Burpee Pull-Up', branch: 'Pull', tier: 'TIER_3', prereqs: ['5 Strict Pull-Ups'],
    blurb: 'Burpee pull-up — burpee under a bar, then a pull-up. Conditioning + pull.', description: '+10% pull-up XP',
    test: { description: '10 burpee pull-ups in a row (burpee under the bar, jump up and grab the bar, strict pull-up).', safety: 'Master 5 strict PU first. Use a sturdy bar. Soft surface for the burpee.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'One-Arm Inverted Row', branch: 'Pull', tier: 'TIER_3', prereqs: ['Wide-Grip Inverted Row'],
    blurb: 'One-arm inverted row — single-arm horizontal pull.', description: '+10% pull-up XP',
    test: { description: '5 one-arm inverted rows on each side. Body rigid, full ROM.', safety: 'Strong wide-grip row first. Use a low bar that allows full ROM.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Archer Pull-Up', branch: 'Pull', tier: 'TIER_3', prereqs: ['10 Pull-Ups in a Row'],
    blurb: 'Archer pull-up — first step toward one-arm work. One arm bends, the other stays straight.', description: '+10% pull-up XP',
    test: { description: '5 archer pull-ups on each side (most pulling on one arm, the other extends straight out).', safety: 'Master 10 strict PU first. Don\'t shrug. Spotter nearby.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Towel Pull-Up', branch: 'Pull', tier: 'TIER_3', prereqs: ['10 Pull-Ups in a Row'],
    blurb: 'Towel pull-up — hang a towel over the bar and grip the ends. Grip + pull.', description: '+10% pull-up XP',
    test: { description: '5 towel pull-ups (each hand grips one end of a towel draped over the bar), full ROM.', safety: 'Master 10 strict PU first. Use a sturdy towel. Wraps recommended for grip.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Commando Pull-Up', branch: 'Pull', tier: 'TIER_3', prereqs: ['Neutral-Grip Pull-Up'],
    blurb: 'Commando pull-up — head passes one side, then the other.', description: '+10% pull-up XP',
    test: { description: '5 commando pull-ups (head passes left side on one rep, right side on the next), full ROM.', safety: 'Strong neutral grip first. Don\'t kip.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Typewriter Pull-Up', branch: 'Pull', tier: 'TIER_4', prereqs: ['Archer Pull-Up'],
    blurb: 'Typewriter pull-up — pull up, then shift side to side at the top.', description: '+12% pull-up XP',
    test: { description: '5 typewriter pull-ups (pull up to archer position, shift chest side to side at the top).', safety: 'Strong archer PU first. Don\'t shrug. Spotter.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'L-Sit Pull-Up', branch: 'Pull', tier: 'TIER_4', prereqs: ['10 Pull-Ups in a Row', '30s L-Sit'],
    blurb: 'L-sit pull-up — pull-up while holding an L-sit. Cross-branch with Holds.', description: '+12% pull-up XP',
    test: { description: '5 L-sit pull-ups (legs straight and parallel to floor throughout, full ROM).', safety: 'Strong 10 strict PU + 30s L-sit first. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Headbanger Pull-Up', branch: 'Pull', tier: 'TIER_4', prereqs: ['3 Muscle-Ups'],
    blurb: 'Headbanger — muscle-up followed by aggressive kip swing. Dynamic power.', description: '+12% pull-up XP',
    test: { description: '5 headbanger pull-ups (muscle-up + swing the body forward and back, controlled).', safety: 'Master muscle-up first. Use a spotter. Don\'t slam the neck into the bar.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Front Lever Row', branch: 'Pull', tier: 'TIER_5', prereqs: ['5s Front Lever'],
    blurb: 'Front lever row — pull from a front lever position toward the bar.', description: '+15% pull-up XP',
    test: { description: '5 front lever rows (start in a front lever, pull chest to bar, lower back to lever).', safety: 'Strong front lever first. Don\'t shrug. Use a spotter for first attempts.', metric: 'reps', threshold: { reps: 5 } } },
  // Pull god-tier — true 10s+ versions of the lever holds.
  { name: 'Full Front Lever', branch: 'Pull', tier: 'TIER_6', prereqs: ['5s Front Lever'],
    blurb: 'Pull god-tier — 10s+ full front lever hold.', description: '+25% pull-up XP',
    test: { description: '10s full front lever hold (body horizontal, arms straight, body and legs together).', safety: 'Master 5s front lever first. Warm up thoroughly. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: 'Full Back Lever', branch: 'Pull', tier: 'TIER_6', prereqs: ['5s Back Lever'],
    blurb: 'Pull god-tier — 10s+ full back lever hold.', description: '+25% pull-up XP',
    test: { description: '10s full back lever hold (face-down, body horizontal, arms straight, shoulders externally rotated).', safety: 'Master 5s back lever first. Stretch shoulders thoroughly. Back lever is shoulder-stress-intense.', metric: 'duration', threshold: { duration_sec: 10 } } },

  // C. Holds (static) — linear chain. BACK LEVER added (user flagged
  // it missing). Front lever keeps its old threshold (5s god-tier
  // is the existing bar; user noted the 5s front lever is closer
  // to intermediate than god-tier, so the prereq chain puts it
  // behind serious holds work).
  { name: '30s Plank Initiate', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Core stability — every calisthenics foundation.', description: '+5% core XP',
    test: { description: '30s plank. Tuck pelvis, brace core, neutral spine.', safety: 'Don\'t sag hips. Don\'t pike up.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '60s Plank', branch: 'Holds', tier: 'TIER_2', prereqs: ['30s Plank Initiate'],
    blurb: 'Bodyweight plank milestone.', description: '+5% core XP',
    test: { description: '60s plank, same form as T1.', safety: 'Don\'t sag hips.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '10s L-Sit Initiate', branch: 'Holds', tier: 'TIER_2', prereqs: ['60s Plank'],
    blurb: 'Static core + hip flexor — gateway to advanced holds.', description: '+8% core XP',
    test: { description: '10s L-sit (legs straight, parallel to floor, arms straight).', safety: 'Warm up with planks first. Don\'t shrug shoulders.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '30s L-Sit', branch: 'Holds', tier: 'TIER_3', prereqs: ['10s L-Sit Initiate'],
    blurb: 'Core + hip flexor endurance.', description: '+10% core XP',
    test: { description: '30s L-sit. Legs straight, parallel to floor.', safety: 'Don\'t shrug shoulders. Warm up first.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s V-Sit', branch: 'Holds', tier: 'TIER_4', prereqs: ['30s L-Sit'],
    blurb: 'V-sit (legs together) — harder than L-sit.', description: '+12% core XP',
    test: { description: '30s V-sit (legs together, straight, parallel to floor).', safety: 'Master 30s L-sit first. Don\'t shrug.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '10s Straddle L', branch: 'Holds', tier: 'TIER_4', prereqs: ['30s V-Sit'],
    blurb: 'Straddle L-sit — advanced hold.', description: '+12% core XP',
    test: { description: '10s straddle L (legs spread wide, straight, parallel to floor).', safety: 'Master V-sit first. Stretch hip adductors before testing.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Front Lever', branch: 'Holds', tier: 'TIER_4', prereqs: ['10s Straddle L', '5 Strict Pull-Ups'],
    blurb: 'Holds god-tier — the front lever is the king of static holds (requires both serious core + pulling).', description: '+20% core XP',
    test: { description: '5s front lever hold (body horizontal, arms straight, pulling from shoulders).', safety: 'Master multiple L-sits + 5+ strict pull-ups first. Warm up thoroughly. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5s Back Lever', branch: 'Holds', tier: 'TIER_5', prereqs: ['10s Straddle L', '5 Strict Pull-Ups'],
    blurb: 'Back lever — the antagonist of the front lever (face-down, open shoulders).', description: '+15% core XP',
    test: { description: '5s back lever hold (face-down, body horizontal, arms straight, shoulders externally rotated).', safety: 'Master straddle L + strict pull-ups first. Stretch shoulders thoroughly. Stop if shoulder/elbow pain — back lever is shoulder-stress-intense.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // Holds variants — anti-rotation, anti-extension, oblique, prone
  // back, hanging leg, and advanced god-tier holds. Five T1 entries
  // (side plank, hollow body, dead bug, russian twist, bicycle
  // crunch, bird dog, reverse crunch, mountain climber — eight T1s
  // total) seed the variations. T2 ramps volume or angle. T3 is the
  // first "real" challenge (ab wheel, pike compression, body saw).
  // T4 windshield wiper. T5 dragon flag. T6 Manna.
  { name: 'Side Plank', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Side plank — oblique + lateral core stability.', description: '+5% core XP',
    test: { description: '30s side plank on each side (elbow under shoulder, hips up, body straight).', safety: 'Don\'t sag hips. Don\'t let the shoulder drift forward.', metric: 'duration', threshold: { duration_sec: 30, sides: 'each' } } },
  { name: 'Hollow Body Hold', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Hollow body hold — supine, lower back pressed to floor. Anti-extension core.', description: '+5% core XP',
    test: { description: '30s hollow body hold (lying on back, arms + legs raised, lower back pressed to floor).', safety: 'Don\'t let the lower back arch off the floor.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Dead Bug', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Dead bug — anti-extension core from a supine position.', description: '+5% core XP',
    test: { description: '10 dead bugs on each side (lying on back, opposite arm + leg lower and return).', safety: 'Don\'t let the lower back arch.', metric: 'reps', threshold: { reps: 10, sides: 'each' } } },
  { name: 'Hanging Knee Raise', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Hanging knee raise — knees to chest from a hang.', description: '+5% core XP',
    test: { description: '10 hanging knee raises (from a dead hang, bring both knees to chest).', safety: 'Don\'t kip. Active shoulders.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Russian Twist', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Russian twist — seated, rotate side to side. Oblique + anti-rotation.', description: '+5% core XP',
    test: { description: '20 Russian twists on each side (seated, knees bent, lean back slightly, rotate side to side).', safety: 'Keep the chest up. Don\'t yank the neck.', metric: 'reps', threshold: { reps: 20, sides: 'each' } } },
  { name: 'Bicycle Crunch', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Bicycle crunch — supine, opposite elbow to knee. Oblique + rectus abdominis.', description: '+5% core XP',
    test: { description: '30 bicycle crunches on each side (lying on back, opposite elbow to knee).', safety: 'Don\'t yank the neck. Lower back stays on the floor.', metric: 'reps', threshold: { reps: 30, sides: 'each' } } },
  { name: 'Bird Dog', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Bird dog — opposite arm + leg extend. Anti-rotation, low-back-friendly.', description: '+5% core XP',
    test: { description: '10 bird dogs on each side (hands + knees on floor, opposite arm + leg extend).', safety: 'Don\'t arch the lower back. Move slowly.', metric: 'reps', threshold: { reps: 10, sides: 'each' } } },
  { name: 'Reverse Crunch', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Reverse crunch — supine, hips curl up. Lower-ab focus.', description: '+5% core XP',
    test: { description: '15 reverse crunches (lying on back, knees bent, curl hips up off the floor).', safety: 'Don\'t yank the neck.', metric: 'reps', threshold: { reps: 15 } } },
  { name: 'Mountain Climber', branch: 'Holds', tier: 'TIER_1', prereqs: [],
    blurb: 'Mountain climber — plank position, alternating knees to chest.', description: '+5% core XP',
    test: { description: '30 mountain climbers on each side (plank position, alternate knees to chest).', safety: 'Don\'t bounce the hips. Keep the plank tight.', metric: 'reps', threshold: { reps: 30, sides: 'each' } } },
  { name: 'Side Plank with Rotation', branch: 'Holds', tier: 'TIER_2', prereqs: ['Side Plank'],
    blurb: 'Side plank with rotation — reach under and rotate. Anti-rotation core.', description: '+8% core XP',
    test: { description: '10 side plank rotations on each side (from side plank, reach the top arm under the body, then back up).', safety: 'Master side plank first. Move slowly.', metric: 'reps', threshold: { reps: 10, sides: 'each' } } },
  { name: 'Hollow Body Rock', branch: 'Holds', tier: 'TIER_2', prereqs: ['Hollow Body Hold'],
    blurb: 'Hollow body rock — rock forward and back. Gymnastics core control.', description: '+8% core XP',
    test: { description: '10 hollow body rocks (from hollow body hold, rock forward to a seated V and back).', safety: 'Master hollow body hold first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Superman Hold', branch: 'Holds', tier: 'TIER_2', prereqs: [],
    blurb: 'Superman hold — prone, arms + legs raised. Lower-back + glute endurance.', description: '+8% core XP',
    test: { description: '30s Superman hold (lying face-down, arms + legs raised, glutes squeezed).', safety: 'Don\'t yank the neck.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Arch Body Hold', branch: 'Holds', tier: 'TIER_2', prereqs: ['Superman Hold'],
    blurb: 'Arch body hold — like a Superman but with hands by the ears, pulling back harder.', description: '+8% core XP',
    test: { description: '30s arch body hold (face-down, hands by ears, squeeze shoulder blades together + raise).', safety: 'Master Superman hold first.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Hanging Leg Raise', branch: 'Holds', tier: 'TIER_2', prereqs: ['Hanging Knee Raise'],
    blurb: 'Hanging leg raise — legs to horizontal (L-position).', description: '+8% core XP',
    test: { description: '10 hanging leg raises (legs straight, raise to horizontal).', safety: 'Master hanging knee raise first. Don\'t kip.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'V-Up', branch: 'Holds', tier: 'TIER_2', prereqs: ['Reverse Crunch'],
    blurb: 'V-up — supine, body comes to a V. Full anterior core.', description: '+8% core XP',
    test: { description: '10 V-ups (lying on back, simultaneously raise the upper body + legs to a V position).', safety: 'Master reverse crunch first. Keep the legs straight.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Lying Leg Raise', branch: 'Holds', tier: 'TIER_2', prereqs: [],
    blurb: 'Lying leg raise — supine, legs raise to vertical. Lower-ab focus.', description: '+8% core XP',
    test: { description: '15 lying leg raises (lying on back, raise both legs to vertical, lower slowly).', safety: 'Don\'t arch the lower back. Lower legs under control.', metric: 'reps', threshold: { reps: 15 } } },
  { name: 'Plank Shoulder Tap', branch: 'Holds', tier: 'TIER_2', prereqs: ['60s Plank'],
    blurb: 'Plank shoulder tap — plank position, tap the opposite shoulder. Anti-rotation.', description: '+8% core XP',
    test: { description: '20 plank shoulder taps total (plank position, alternate tapping each shoulder with the opposite hand).', safety: 'Don\'t rock the hips. Move slowly.', metric: 'reps', threshold: { reps: 20 } } },
  { name: 'Ab Wheel Rollout', branch: 'Holds', tier: 'TIER_3', prereqs: ['60s Plank'],
    blurb: 'Ab wheel rollout — anti-extension core at the limit of ROM.', description: '+10% core XP',
    test: { description: '10 ab wheel rollouts (knees on the floor, roll out to full extension, return).', safety: 'Master 60s plank first. Don\'t let the hips sag. Use a pad under the knees.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Pike Compression', branch: 'Holds', tier: 'TIER_3', prereqs: ['30s L-Sit'],
    blurb: 'Pike compression — L-sit with legs together and compressed toward the chest. Compression strength.', description: '+10% core XP',
    test: { description: '10s pike compression (hands on floor or parallettes, legs straight and pressed toward the chest, hips high).', safety: 'Master 30s L-sit first. Stretch hamstrings.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: 'Body Saw', branch: 'Holds', tier: 'TIER_3', prereqs: ['60s Plank'],
    blurb: 'Body saw — plank on sliders, push forward and back. Anti-extension core.', description: '+10% core XP',
    test: { description: '10 body saws (forearm plank on sliders, push the body forward and back).', safety: 'Master 60s plank first. Use sliders on a slick surface. Don\'t let the hips sag.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Windshield Wiper', branch: 'Holds', tier: 'TIER_4', prereqs: ['Hanging Leg Raise'],
    blurb: 'Windshield wiper — at the top of a hanging leg raise, swing legs side to side. Oblique + core.', description: '+12% core XP',
    test: { description: '5 windshield wipers on each side (from hanging leg raise top, swing legs to one side, then to the other).', safety: 'Master hanging leg raise first. Active shoulders. Move slowly.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Dragon Flag', branch: 'Holds', tier: 'TIER_5', prereqs: ['60s Plank', '30s V-Sit'],
    blurb: 'Dragon flag — full body raises from a supine position. Holds god-tier.', description: '+20% core XP',
    test: { description: '5 dragon flags (lying on back, grab a pole or bench behind your head, raise the entire body to a vertical position, lower back down under control).', safety: 'Master 60s plank + 30s V-sit first. Strong grip. Use a sturdy anchor.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Manna', branch: 'Holds', tier: 'TIER_6', prereqs: ['30s V-Sit'],
    blurb: 'Holds god-tier — Manna (legs fully past parallel, hanging from bars). Insane flexibility + strength.', description: '+25% core XP',
    test: { description: '5s Manna hold (legs fully past parallel toward the head, hanging from parallel bars or rings).', safety: 'Master 30s V-sit + significant shoulder mobility. Train for months. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // D. Rings — Rings Rows and Ring Dips both unlock from Rings Support
  // (parallel siblings, no prereq between them). 5 Ring Muscle-Ups
  // then requires BOTH (weaving merge point) before Iron Cross.
  { name: 'Rings Dead Hang 30s', branch: 'Rings', tier: 'TIER_1', prereqs: [],
    blurb: 'Rings grip + shoulder stability.', description: '+5% rings XP',
    test: { description: '30s rings dead hang. Active shoulders.', safety: 'Don\'t kip. Use a bar you can reach.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Rings Support 5s', branch: 'Rings', tier: 'TIER_1', prereqs: ['Rings Dead Hang 30s'],
    blurb: 'Hold at the top of a dip — shoulder stability.', description: '+5% rings XP',
    test: { description: '5s rings support hold (top of rings dip, arms straight, body locked out).', safety: 'Use a band for assistance if needed.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5 Ring Rows', branch: 'Rings', tier: 'TIER_2', prereqs: ['Rings Support 5s'],
    blurb: 'Rings horizontal pull — the foundation of rings work.', description: '+5% rings XP',
    test: { description: '5 ring rows. Pull chest to ring level. Squeeze shoulder blades.', safety: 'Use a band for assistance if needed. Keep wrists stacked.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Ring Dips', branch: 'Rings', tier: 'TIER_2', prereqs: ['Rings Support 5s'],
    blurb: 'Rings vertical push — chest and triceps.', description: '+5% rings XP',
    test: { description: '5 ring dips. Full ROM, lockout at the top.', safety: 'Use a band for assistance if needed. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10s L-Sit on Rings', branch: 'Rings', tier: 'TIER_3', prereqs: ['5 Ring Dips'],
    blurb: 'Rings core + hip flexor on unstable surface.', description: '+12% rings XP',
    test: { description: '10s L-sit on rings (legs straight, parallel to floor).', safety: 'Master floor L-sit first. Have a spotter nearby for safety.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5 Ring Muscle-Ups', branch: 'Rings', tier: 'TIER_4', prereqs: ['5 Ring Rows', '5 Ring Dips'],
    blurb: 'Rings muscle-up — the rings-specific version.', description: '+12% rings XP',
    test: { description: '5 ring muscle-ups in a row. False grip. Strong transition.', safety: 'Use a band for assistance if needed. Spotter for first attempts.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '3s Iron Cross', branch: 'Rings', tier: 'TIER_5', prereqs: ['5 Ring Muscle-Ups', '10s L-Sit on Rings'],
    blurb: 'Rings god-tier — the iron cross is the most iconic rings skill of all.', description: '+25% rings XP',
    test: { description: '3s iron cross support (arms straight out to the sides, body horizontal).', safety: 'Master rings support + dips + muscle-ups first. Work up to this over months. Spotter + band for safety. Stop immediately if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 3 } } },

  // Rings variants — RTO progression, bicep work, and god-tier crosses.
  // RTO (rings turned out) progression is the classic rings-specific
  // path: support → RTO 45 → RTO 90, each progressively harder on
  // the biceps. Ring bicep curl + face pull build auxiliary strength.
  // Pelican curl is the first straight-arm-strength skill. The two
  // T6 entries are god-tier crosses requiring planche or front lever.
  { name: 'RTO 45 Hold', branch: 'Rings', tier: 'TIER_2', prereqs: ['Rings Support 5s'],
    blurb: 'RTO 45° — rings turned out 45°. Shoulder + bicep stability.', description: '+8% rings XP',
    test: { description: '10s rings turned-out 45° hold (top of support, rings rotated 45° outward).', safety: 'Master support first. Don\'t shrug. Stretch biceps between sets.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: 'Ring Face Pull', branch: 'Rings', tier: 'TIER_2', prereqs: ['Rings Support 5s'],
    blurb: 'Ring face pull — high rows to the face. Rear delt + upper back.', description: '+8% rings XP',
    test: { description: '10 ring face pulls (pull rings to the face, elbows high).', safety: 'Master support first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Ring Bicep Curl', branch: 'Rings', tier: 'TIER_2', prereqs: ['Rings Support 5s'],
    blurb: 'Ring bicep curl — supinated curl on rings. Bicep strength.', description: '+8% rings XP',
    test: { description: '10 ring bicep curls (supinated grip, curl up to the forehead).', safety: 'Master support first. Stop if elbow pain.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Full RTO 90', branch: 'Rings', tier: 'TIER_3', prereqs: ['RTO 45 Hold'],
    blurb: 'Full RTO 90° — rings perpendicular to the body. Bicep torture.', description: '+10% rings XP',
    test: { description: '5s full RTO 90° hold (rings fully turned out, perpendicular to body).', safety: 'Master RTO 45 first. Stretch biceps thoroughly. Stop if elbow pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: 'Pelican Curl', branch: 'Rings', tier: 'TIER_3', prereqs: ['5 Ring Rows'],
    blurb: 'Pelican curl — straight-arm lower from inverted to biceps curl. Bicep + shoulder.', description: '+10% rings XP',
    test: { description: '5 pelican curls (start in an inverted hang, lower to a bicep curl position, return).', safety: 'Master ring rows first. Stretch shoulders thoroughly. Stop if elbow pain.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Ice Cream Maker', branch: 'Rings', tier: 'TIER_5', prereqs: ['5 Ring Muscle-Ups', '5s Straddle Planche'],
    blurb: 'Ice cream maker — back lever to front lever on rings. Insane pulling + core.', description: '+15% rings XP',
    test: { description: '5 ice cream makers (start in back lever, transition smoothly through a flag position to front lever, repeat).', safety: 'Strong muscle-ups + straddle planche first. Warm up thoroughly. Spotter nearby. Stop if shoulder/elbow pain.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Maltese Cross', branch: 'Rings', tier: 'TIER_6', prereqs: ['3s Iron Cross', '5s Straddle Planche'],
    blurb: 'Rings god-tier — Maltese cross (iron cross with arms in front of the body).', description: '+25% rings XP',
    test: { description: '3s Maltese cross (arms extended in front of the body, rings wide apart, body horizontal).', safety: 'Strong iron cross + straddle planche first. Train for months. Spotter + band. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 3 } } },
  { name: 'Victorian Cross', branch: 'Rings', tier: 'TIER_6', prereqs: ['3s Iron Cross', '5s Front Lever'],
    blurb: 'Rings god-tier — Victorian (iron cross with horizontal body, like a front lever).', description: '+25% rings XP',
    test: { description: '3s Victorian cross (iron cross arms + horizontal body from a front lever).', safety: 'Strong iron cross + front lever first. Train for months. Spotter + band. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 3 } } },

  // E. Handstand — linear chain
  { name: '5 Pike Push-Ups Initiate', branch: 'Handstand', tier: 'TIER_1', prereqs: [],
    blurb: 'Pressing with a downward-dog pike — gateway to handstand work.', description: '+5% handstand XP',
    test: { description: '5 pike push-ups (hips piked, body in an inverted V, hands on floor, push-ups).', safety: 'Don\'t flare ribs. Keep core tight.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Elevated Pike PU', branch: 'Handstand', tier: 'TIER_1', prereqs: ['5 Pike Push-Ups Initiate'],
    blurb: 'Easier handstand prep — feet on a chair.', description: '+5% handstand XP',
    test: { description: '5 elevated pike push-ups (feet on a chair, hands on floor, hips piked, push-ups).', safety: 'Same as pike PU. Don\'t flare ribs.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10s Free Handstand', branch: 'Handstand', tier: 'TIER_2', prereqs: ['5 Elevated Pike PU'],
    blurb: 'Freestanding balance — the goal of HS training.', description: '+10% handstand XP',
    test: { description: '10s freestanding handstand. Stack joints, use finger-tip control, engage lats and glutes.', safety: 'Practice against a wall first. Have a spotter. Bail by rolling out.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5 Wall HSPUs', branch: 'Handstand', tier: 'TIER_2', prereqs: ['10s Free Handstand'],
    blurb: 'Handstand push-ups against a wall — the first true vertical pressing.', description: '+8% handstand XP',
    test: { description: '5 wall handstand push-ups (back to wall, hands on floor, HSPUs).', safety: 'Practice chest-to-wall HS first. Bail by rolling out, not jumping.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '30s Free Handstand', branch: 'Handstand', tier: 'TIER_3', prereqs: ['10s Free Handstand'],
    blurb: '30 seconds of free balance — the handstand benchmark.', description: '+12% handstand XP',
    test: { description: '30s freestanding handstand. Engage lats, glutes, use finger-tip control.', safety: 'Practice with shorter holds first. Have a spotter.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '5 Free HSPUs', branch: 'Handstand', tier: 'TIER_4', prereqs: ['5 Wall HSPUs', '30s Free Handstand'],
    blurb: 'Freestanding handstand push-ups — vertical pressing balance.', description: '+12% handstand XP',
    test: { description: '5 freestanding HSPUs. Full ROM, controlled.', safety: 'Master 30s free HS first. Bail safely.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '1 Strict Free HSPU 5s', branch: 'Handstand', tier: 'TIER_5', prereqs: ['5 Free HSPUs'],
    blurb: 'Vertical pressing god-tier — strict free HSPU hold.', description: '+20% handstand XP',
    test: { description: '1 strict freestanding handstand push-up, held 5 seconds at the top of the rep.', safety: 'Master free HSPUs first. Bail by rolling out. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // Handstand variants — arm balance, press work, and god-tier balances.
  // Crow pose is the arm-balance gateway skill (T1, easier than pike
  // PU for many beginners since it loads the wrist less). Elbow
  // lever is the next compression step. Press to handstand is the
  // first controlled handstand entry. Deficit / Japanese / Tiger
  // bend are god-tier (T5). 90-degree HSPU + One-arm handstand are
  // the two T6 god-tier entries.
  { name: 'Crow Pose', branch: 'Handstand', tier: 'TIER_1', prereqs: [],
    blurb: 'Crow pose — knees on the back of the upper arms, lean forward and balance. Arm-balance gateway.', description: '+5% handstand XP',
    test: { description: '10s crow pose (hands on floor, knees resting on the back of the upper arms, feet off the floor).', safety: 'Use a pad or soft surface. Lean forward — don\'t lock the elbows.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: 'Elbow Lever', branch: 'Handstand', tier: 'TIER_2', prereqs: ['Crow Pose'],
    blurb: 'Elbow lever — body horizontal, balanced on the elbows. Compression + balance.', description: '+8% handstand XP',
    test: { description: '5s elbow lever (forearms on the floor, body horizontal, hands clasped, head off the floor).', safety: 'Master crow first. Use a soft surface.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: 'Press to Handstand', branch: 'Handstand', tier: 'TIER_4', prereqs: ['30s Free Handstand'],
    blurb: 'Press to handstand — straddle or pike, legs come up smoothly without jumping. Pure balance + strength.', description: '+12% handstand XP',
    test: { description: '3 strict presses to handstand in a row (straddle or pike press, smooth and controlled).', safety: 'Master 30s free HS first. Spotter nearby.', metric: 'reps', threshold: { reps: 3 } } },
  { name: 'Deficit Handstand Push-Up', branch: 'Handstand', tier: 'TIER_5', prereqs: ['1 Strict Free HSPU 5s'],
    blurb: 'Deficit HSPU — hands on parallettes, deeper ROM. Handstand god-tier.', description: '+20% handstand XP',
    test: { description: '5 deficit HSPUs (hands on parallettes, lower head below the parallettes, press back up).', safety: 'Master strict free HSPU first. Use stable parallettes. Spotter.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Japanese Handstand', branch: 'Handstand', tier: 'TIER_5', prereqs: ['30s Free Handstand'],
    blurb: 'Japanese handstand — back to wall, hold a single-arm handstand position with the other arm at the side. Control.', description: '+15% handstand XP',
    test: { description: '10s Japanese handstand on each side (back to wall, one hand on the floor, the other arm extended to the side).', safety: 'Master 30s free HS first. Use a wall. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 10, sides: 'each' } } },
  { name: 'Tiger Bend Handstand Push-Up', branch: 'Handstand', tier: 'TIER_5', prereqs: ['5 Free HSPUs'],
    blurb: 'Tiger bend HSPU — bend the elbows and lower the head all the way to the floor, then push back up. Handstand god-tier.', description: '+15% handstand XP',
    test: { description: '5 tiger bend HSPUs in a row.', safety: 'Strong free HSPUs first. Use a soft surface. Spotter.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '90-Degree Handstand Push-Up', branch: 'Handstand', tier: 'TIER_6', prereqs: ['Deficit Handstand Push-Up'],
    blurb: '90-degree HSPU — push all the way through to a planche-like position at the bottom. Handstand god-tier.', description: '+25% handstand XP',
    test: { description: '3 90-degree HSPUs in a row (lower all the way through to where the body is horizontal at the bottom, then press back up to handstand).', safety: 'Master deficit HSPU first. Strong horizontal pressing required. Spotter.', metric: 'reps', threshold: { reps: 3 } } },
  { name: 'One-Arm Handstand', branch: 'Handstand', tier: 'TIER_6', prereqs: ['90-Degree Handstand Push-Up', 'Japanese Handstand'],
    blurb: 'Handstand god-tier — one-arm freestanding handstand. The ultimate balance.', description: '+25% handstand XP',
    test: { description: '5s one-arm freestanding handstand on each side.', safety: 'Master 90-degree HSPU + Japanese HS first. Strong single-arm balance. Spotter nearby. Bail safely.', metric: 'duration', threshold: { duration_sec: 5, sides: 'each' } } },

  // F. Planche — linear chain
  { name: 'Plank Foundation 30s', branch: 'Planche', tier: 'TIER_1', prereqs: [],
    blurb: 'Plank — the foundation for all planche work.', description: '+5% planche XP',
    test: { description: '30s plank. Tuck pelvis, brace core.', safety: 'Don\'t sag hips. Don\'t pike up.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '10s Pseudo-Planche Lean', branch: 'Planche', tier: 'TIER_2', prereqs: ['Plank Foundation 30s'],
    blurb: 'Hands at hips, lean forward — planche intro.', description: '+5% planche XP',
    test: { description: '10s pseudo-planche lean (hands at hips, lean forward until shoulders are over wrists).', safety: 'Master 60s plank first. Stretch shoulders before testing.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Tuck Planche', branch: 'Planche', tier: 'TIER_2', prereqs: ['10s Pseudo-Planche Lean'],
    blurb: 'Tuck planche — first real planche progression.', description: '+10% planche XP',
    test: { description: '5s tuck planche (knees to chest, body horizontal, arms straight).', safety: 'Master pseudo-planche lean first. Stretch shoulders thoroughly. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '10s Tuck Planche', branch: 'Planche', tier: 'TIER_3', prereqs: ['5s Tuck Planche'],
    blurb: 'Solid tuck planche — the first real planche level.', description: '+10% planche XP',
    test: { description: '10s tuck planche. Body horizontal, knees tight to chest.', safety: 'Master 5s first. Stretch shoulders. Stop if pain.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Advanced Tuck Planche', branch: 'Planche', tier: 'TIER_4', prereqs: ['10s Tuck Planche'],
    blurb: 'Advanced tuck — one step from straddle.', description: '+12% planche XP',
    test: { description: '5s advanced tuck planche (knees away from chest, more horizontal).', safety: 'Master 10s tuck first. Stretch shoulders thoroughly. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5s Straddle Planche', branch: 'Planche', tier: 'TIER_5', prereqs: ['5s Advanced Tuck Planche'],
    blurb: 'Straddle planche — hardcore horizontal pushing.', description: '+15% planche XP',
    test: { description: '5s straddle planche (legs straight, spread wide, body horizontal).', safety: 'Master adv tuck first. Stretch hamstrings and shoulders. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5s Full Planche', branch: 'Planche', tier: 'TIER_6', prereqs: ['5s Straddle Planche'],
    blurb: 'Planche god-tier — the king of horizontal pushing.', description: '+25% planche XP',
    test: { description: '5s full planche (body horizontal, arms straight, legs together).', safety: 'Master straddle first. This is the hardest move in calisthenics — train for months. Spotter nearby. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // Planche variants — push-up progressions through the planche
  // shapes. Ring fly is the planche-lean-equivalent on rings (T2).
  // T3 tuck planche push-up. T5 straddle planche push-up. T6 full
  // planche push-up + straight-arm press (the latter is a cross-
  // branch with Handstand).
  { name: 'Ring Fly', branch: 'Planche', tier: 'TIER_2', prereqs: ['Plank Foundation 30s'],
    blurb: 'Ring fly — planche lean on rings. Shoulder + chest.', description: '+8% planche XP',
    test: { description: '5 ring flyes (start in a planche lean, lower the body between the rings, return).', safety: 'Master plank first. Stretch shoulders.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Tuck Planche Push-Up', branch: 'Planche', tier: 'TIER_3', prereqs: ['5s Tuck Planche'],
    blurb: 'Tuck planche push-up — push-up while holding a tuck planche.', description: '+10% planche XP',
    test: { description: '5 tuck planche push-ups (push up and down while maintaining a tuck planche).', safety: 'Master 5s tuck planche first. Stretch shoulders. Stop if pain.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Straddle Planche Push-Up', branch: 'Planche', tier: 'TIER_5', prereqs: ['5s Straddle Planche', 'Tuck Planche Push-Up'],
    blurb: 'Straddle planche push-up — push-up while holding a straddle planche. Planche god-tier.', description: '+15% planche XP',
    test: { description: '3 straddle planche push-ups.', safety: 'Master 5s straddle planche + tuck PP first. Stretch shoulders. Stop if pain.', metric: 'reps', threshold: { reps: 3 } } },
  { name: 'Full Planche Push-Up', branch: 'Planche', tier: 'TIER_6', prereqs: ['5s Full Planche', 'Straddle Planche Push-Up'],
    blurb: 'Full planche push-up — push-up while holding a full planche. The planche god-tier.', description: '+25% planche XP',
    test: { description: '3 full planche push-ups in a row.', safety: 'Master 5s full planche + straddle PP first. This is the hardest push-up in the world. Train for months. Spotter.', metric: 'reps', threshold: { reps: 3 } } },
  { name: 'Straight-Arm Press', branch: 'Planche', tier: 'TIER_6', prereqs: ['5s Full Planche', '10s Free Handstand'],
    blurb: 'Planche god-tier — straight-arm press from a handstand down to a planche. Cross-branch with Handstand.', description: '+25% planche XP',
    test: { description: '3 straight-arm presses in a row (from a handstand, lower under control to a planche, return).', safety: 'Master 5s full planche + 10s free HS first. Train for months. Spotter nearby.', metric: 'reps', threshold: { reps: 3 } } },

  // G. Legs (NEW — calitree has a dedicated Legs domain. We add it as
  // a 7th PHANTOM branch so bodyweight leg progressions sit alongside
  // the gymnastics skills. Linear chain, no weaving.)
  { name: 'Squat to Chair', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Squat to a chair — first real bodyweight squat pattern.', description: '+5% squat XP',
    test: { description: '5 bodyweight squats to a chair (or box at knee height), full depth, controlled. Heels stay grounded, knees track over toes.', safety: 'Warm up first. Don\'t let knees cave.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Bulgarian Split Squat', branch: 'Legs', tier: 'TIER_2', prereqs: ['Squat to Chair'],
    blurb: 'Rear-foot-elevated split squat — single-leg stability.', description: '+5% squat XP',
    test: { description: '5 Bulgarian split squats on each side, bodyweight, rear foot on a bench/chair at knee height. Full depth on the front leg.', safety: 'Master squat first. Use a stable surface. Keep the front knee tracking over the toes.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Assisted Pistol Squat', branch: 'Legs', tier: 'TIER_2', prereqs: ['Bulgarian Split Squat'],
    blurb: 'Pistol squat with a counterbalance (doorframe / pole / band).', description: '+8% squat XP',
    test: { description: '5 pistol squats on each side, assisted by holding a doorframe, pole, or light band. Full depth (hamstring to calf). Other leg stays straight forward.', safety: 'Master Bulgarian first. Squat onto a soft surface in case of bail.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Shrimp Squat', branch: 'Legs', tier: 'TIER_2', prereqs: ['Assisted Pistol Squat'],
    blurb: 'Shrimp squat — single-leg squat with one knee on the ground.', description: '+8% squat XP',
    test: { description: '5 shrimp squats on each side (one leg forward, one knee on the ground, stand up to full extension using the front leg only).', safety: 'Master pistol first. Use a pad under the knee. Have a wall for balance.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Free Pistol Squat', branch: 'Legs', tier: 'TIER_3', prereqs: ['Assisted Pistol Squat'],
    blurb: 'Free pistol squat — single-leg bodyweight squat, unassisted.', description: '+12% squat XP',
    test: { description: '5 pistol squats on each side, no assistance. Full depth (hamstring to calf). Other leg stays straight forward, parallel to the working leg.', safety: 'Master assisted pistol first. Squat onto a soft surface. Have a wall for safety.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Dragon Pistol Squat', branch: 'Legs', tier: 'TIER_4', prereqs: ['Free Pistol Squat'],
    blurb: 'Dragon pistol — back-leg stays straight and elevated (no knee touch).', description: '+18% squat XP',
    test: { description: '3 dragon pistol squats on each side, free. Working leg squats to full depth; back leg stays straight and lifted off the ground the whole rep (no knee touch).', safety: 'Strong free pistol first. Hamstring flexibility required. Use a soft surface.', metric: 'reps', threshold: { reps: 3, sides: 'each' } } },
  { name: 'Shrimp → Pistol Progression', branch: 'Legs', tier: 'TIER_5', prereqs: ['Shrimp Squat', 'Free Pistol Squat'],
    blurb: 'Legs god-tier — combining shrimp squat + pistol squat strength.', description: '+20% squat XP',
    test: { description: '5 shrimp squats followed immediately by 5 pistols, on each side. No rest between forms.', safety: 'Both prereqs mastered. Warm up thoroughly. Use a soft surface.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },

  // Legs variants — single-leg, jump, hamstring, calf, lunge variants.
  // The body of the branch (pistol/shrimp/dragon/shrimp→pistol) is the
  // single-leg strength core; these variants add width (skater, archer,
  // sissy, lateral), posterior-chain (RDL, leg curl, Nordic), glute
  // accessories (bridge, hip thrust, donkey kick), step variants, calf
  // + shin (tibialis), and plyo (jump squat family). Depth jump is the
  // god-tier.
  { name: 'Hindu Squat', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Hindu squat — heels-up squat with arms swinging forward. Mobility + squat volume.', description: '+5% squat XP',
    test: { description: '20 Hindu squats in a row (heels together, rise onto toes as you descend, arms swing forward, stand up on the way up).', safety: 'Knees track over toes. Warm up first.', metric: 'reps', threshold: { reps: 20 } } },
  { name: 'Donkey Kick', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Donkey kick — hands + knees on floor, kick one leg back. Glute activation.', description: '+5% squat XP',
    test: { description: '10 donkey kicks on each side (hands + one knee on floor, kick the other leg back and up).', safety: 'Don\'t arch the lower back. Squeeze the glute at the top.', metric: 'reps', threshold: { reps: 10, sides: 'each' } } },
  { name: 'Wall Sit', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Wall sit — back against the wall, knees at 90°. Quad endurance.', description: '+5% squat XP',
    test: { description: '60s wall sit, back against the wall, knees at 90°, thighs parallel to the floor.', safety: 'Don\'t slide down. Keep knees over ankles.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Forward Lunge', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Forward lunge — the classic. Step forward, drop the back knee.', description: '+5% squat XP',
    test: { description: '10 forward lunges total (5 each side). Step forward, drop the back knee to just above the floor, return to standing.', safety: 'Front knee tracks over toes. Don\'t slam the back knee.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Glute Bridge', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Glute bridge — supine hip thrust. Glute activation.', description: '+5% squat XP',
    test: { description: '10 glute bridges (lying on back, feet flat, hips rise to full extension, squeeze glutes at the top).', safety: 'Don\'t hyperextend the lower back.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Step-Up', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Step-up — first unilateral leg-strength move on a box.', description: '+5% squat XP',
    test: { description: '10 step-ups total (5 each side), onto a knee-height box or bench.', safety: 'Drive through the heel. Don\'t push off the back leg.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Single-Leg Calf Raise', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Single-leg calf raise — bodyweight, on a step. Calf strength.', description: '+5% squat XP',
    test: { description: '15 single-leg calf raises on each side, full ROM (heel below the step, rise to full extension).', safety: 'Use a wall for balance. Don\'t bounce.', metric: 'reps', threshold: { reps: 15, sides: 'each' } } },
  { name: 'Tibialis Raise', branch: 'Legs', tier: 'TIER_1', prereqs: [],
    blurb: 'Tibialis raise — back against a wall, toes pull up. Shin strength, runner\'s-knee prevention.', description: '+5% squat XP',
    test: { description: '15 tibialis raises on each side (back to wall, lift the toes toward the shin).', safety: 'Slow controlled reps. Don\'t bounce.', metric: 'reps', threshold: { reps: 15, sides: 'each' } } },
  { name: 'Sissy Squat', branch: 'Legs', tier: 'TIER_2', prereqs: ['Squat to Chair'],
    blurb: 'Sissy squat — knees travel forward, lean back. Quad stretch + strength.', description: '+8% squat XP',
    test: { description: '5 sissy squats (rise onto toes, knees travel forward, lean back, return to standing).', safety: 'Master squat first. Use a wall or pole for balance if needed. Stretch quads before testing.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Reverse Lunge', branch: 'Legs', tier: 'TIER_2', prereqs: ['Forward Lunge'],
    blurb: 'Reverse lunge — step backward instead. Knee-friendly.', description: '+8% squat XP',
    test: { description: '10 reverse lunges total (5 each side).', safety: 'Master forward lunge first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Curtsy Lunge', branch: 'Legs', tier: 'TIER_2', prereqs: ['Forward Lunge'],
    blurb: 'Curtsy lunge — cross behind. Glute emphasis.', description: '+8% squat XP',
    test: { description: '10 curtsy lunges total (5 each side).', safety: 'Master forward lunge first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Lateral Lunge', branch: 'Legs', tier: 'TIER_2', prereqs: ['Forward Lunge'],
    blurb: 'Lateral lunge — step out to the side. Inner thigh + adductor.', description: '+8% squat XP',
    test: { description: '10 lateral lunges total (5 each side).', safety: 'Master forward lunge first. Keep the stationary leg straight.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Hip Thrust', branch: 'Legs', tier: 'TIER_2', prereqs: ['Glute Bridge'],
    blurb: 'Hip thrust — back on a bench, hips rise. Glute strength.', description: '+8% squat XP',
    test: { description: '10 hip thrusts, bodyweight, upper back on a bench, hips rise to full extension.', safety: 'Master glute bridge first. Tuck pelvis at the top.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Step-Up with Knee Drive', branch: 'Legs', tier: 'TIER_2', prereqs: ['Step-Up'],
    blurb: 'Step-up with knee drive — at the top, drive the knee up. Balance + power.', description: '+8% squat XP',
    test: { description: '10 step-up with knee drive total (5 each side).', safety: 'Master step-up first. Don\'t lose balance.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Jump Squat', branch: 'Legs', tier: 'TIER_2', prereqs: ['Squat to Chair'],
    blurb: 'Jump squat — squat then jump explosively. Plyo legs.', description: '+8% squat XP',
    test: { description: '10 jump squats in a row. Land soft, knees bent.', safety: 'Master squat first. Soft surface. Land with bent knees.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Frog Jump', branch: 'Legs', tier: 'TIER_2', prereqs: ['Jump Squat'],
    blurb: 'Frog jump — wide stance, jump forward. Power + mobility.', description: '+8% squat XP',
    test: { description: '5 frog jumps for distance. Wide stance, jump forward, land in a wide squat.', safety: 'Master jump squat first. Soft surface. Warm up hips.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Skater Squat', branch: 'Legs', tier: 'TIER_3', prereqs: ['Free Pistol Squat'],
    blurb: 'Skater squat — cross-behind single-leg squat. Similar to a rear-foot-elevated split squat but reversed.', description: '+10% squat XP',
    test: { description: '5 skater squats on each side (cross one leg behind the other, squat down on the front leg, touch the back knee to the ground).', safety: 'Master free pistol first. Use a soft surface. Have a wall for balance.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Archer Squat', branch: 'Legs', tier: 'TIER_3', prereqs: ['Assisted Pistol Squat'],
    blurb: 'Archer squat — like an archer push-up but for legs. Most weight on one leg, the other extends.', description: '+10% squat XP',
    test: { description: '5 archer squats on each side (most weight on one leg, the other extends out for balance, full depth).', safety: 'Master assisted pistol first. Have a wall for balance.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Sliding Leg Curl', branch: 'Legs', tier: 'TIER_3', prereqs: ['Bulgarian Split Squat'],
    blurb: 'Sliding leg curl — lie on back, slide heels out and in on a slippery surface. Hamstring + glute.', description: '+10% squat XP',
    test: { description: '10 sliding leg curls (lying on back, slide heels out and back, hips stay elevated).', safety: 'Use a slick surface + socks or sliders. Master Bulgarian first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Single-Leg Romanian Deadlift', branch: 'Legs', tier: 'TIER_3', prereqs: ['Bulgarian Split Squat'],
    blurb: 'Single-leg RDL — hinge on one leg. Hamstring + balance.', description: '+10% squat XP',
    test: { description: '5 single-leg RDLs on each side, bodyweight. Hinge at the hips, back leg rises as torso lowers.', safety: 'Master Bulgarian split squat first. Use a wall for balance if needed.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Deficit Step-Down', branch: 'Legs', tier: 'TIER_3', prereqs: ['Step-Up'],
    blurb: 'Deficit step-down — step off a box under control. Eccentric single-leg strength.', description: '+10% squat XP',
    test: { description: '5 deficit step-downs on each side (start standing on a box, slowly lower one foot to the floor below, return to standing).', safety: 'Master step-up first. Use a stable box. Soft surface below.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Box Jump', branch: 'Legs', tier: 'TIER_3', prereqs: ['Jump Squat'],
    blurb: 'Box jump — squat then jump onto a box. Pure lower-body power.', description: '+10% squat XP',
    test: { description: '5 box jumps onto a knee-height box. Land soft, hips back.', safety: 'Master jump squat first. Stable box. Soft surface.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Lunge Jump', branch: 'Legs', tier: 'TIER_3', prereqs: ['Forward Lunge'],
    blurb: 'Lunge jump — jump and switch legs in the air. Plyo lunge.', description: '+10% squat XP',
    test: { description: '10 lunge jumps (5 each side, switching legs in the air).', safety: 'Master forward lunge first. Soft surface. Land with bent knees.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Skater Bound', branch: 'Legs', tier: 'TIER_3', prereqs: ['Skater Squat'],
    blurb: 'Skater bound — lateral jump-and-stick. Power + balance.', description: '+10% squat XP',
    test: { description: '10 skater bounds total (5 each side, lateral jump and stick the landing).', safety: 'Master skater squat first. Soft surface. Warm up ankles.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Nordic Hamstring Curl', branch: 'Legs', tier: 'TIER_4', prereqs: ['Bulgarian Split Squat'],
    blurb: 'Nordic hamstring curl — eccentric hamstring strength. Knee-injury-prevention classic.', description: '+12% squat XP',
    test: { description: '5 Nordic hamstring curls (knees anchored, lower the body forward slowly under hamstring control, push back up with the hands if needed).', safety: 'Strong Bulgarian split squat first. Warm up thoroughly. Use a pad under the knees.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Depth Jump', branch: 'Legs', tier: 'TIER_5', prereqs: ['Box Jump'],
    blurb: 'Depth jump — drop from a box, immediately jump. Reactive strength god-tier.', description: '+15% squat XP',
    test: { description: '5 depth jumps (drop from a 12-18" box, immediately max vertical jump upon landing).', safety: 'Master box jump first. Use a softer landing surface. Coach recommended.', metric: 'reps', threshold: { reps: 5 } } },
];

// ---- 3. SCOUT (endurance) — 20 skills ----
//
// Run + Ruck + Triathlon share a "distance & time" theme; the
// class is about covering ground (faster, further, with weight
// on your back, or three sports in a row). All three branches
// are linear: each subsequent test is a step up in either
// distance, weight, or strictness. No merging.
//
// Explicit per-skill prereqs (mirrors PHANTOM's linear-DAG
// style) — each skill's prereqs point at the skill directly
// below it in the same branch. T1 entries declare `prereqs: []`
// so the seed loop's "any skill has prereqs" detection picks
// this class up for explicit mode.
const SCOUT_SKILLS: Spec[] = [
  // A. Run — linear: distance ramps 1M → 5K → 10K → HM → M, then
  // M gets tighter (4:30 → 3:30 → 3:00).
  { name: '1 Mile < 10:00', branch: 'Run', tier: 'TIER_1', prereqs: [], blurb: 'Bodyweight running baseline.', description: '+5% run XP', test: { description: '1 mile (1.6km) in under 10 minutes. Steady pace, conversational breathing.', safety: 'Build up to 1 mile gradually. Stay hydrated.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '5K < 35:00', branch: 'Run', tier: 'TIER_1', prereqs: ['1 Mile < 10:00'], blurb: 'First 5K milestone.', description: '+5% 5K XP', test: { description: '5K in under 35 minutes. Steady pace.', safety: 'Build up to 5K over weeks. Hydrate. Stop if chest pain.', metric: 'duration', threshold: { duration_sec: 2100 } } },
  { name: '5K < 25:00', branch: 'Run', tier: 'TIER_2', prereqs: ['5K < 35:00'], blurb: '5K sub-25 — first real running milestone.', description: '+5% 5K XP', test: { description: '5K in under 25 minutes. Steady pace, negative split optional.', safety: 'Build a base of 5K < 35 first. Hydrate.', metric: 'duration', threshold: { duration_sec: 1500 } } },
  { name: '10K < 55:00', branch: 'Run', tier: 'TIER_2', prereqs: ['5K < 25:00'], blurb: '10K milestone — first hour-long run.', description: '+5% 10K XP', test: { description: '10K in under 55 minutes.', safety: 'Build up to 10K over weeks. Hydrate + electrolytes.', metric: 'duration', threshold: { duration_sec: 3300 } } },
  { name: '10K < 45:00', branch: 'Run', tier: 'TIER_3', prereqs: ['10K < 55:00'], blurb: '10K sub-45.', description: '+8% 10K XP', test: { description: '10K in under 45 minutes.', safety: 'Build up to 10K < 55 first.', metric: 'duration', threshold: { duration_sec: 2700 } } },
  { name: 'Half Marathon < 2:00:00', branch: 'Run', tier: 'TIER_4', prereqs: ['10K < 45:00'], blurb: 'Half marathon sub-2 — intermediate-end.', description: '+10% HM XP', test: { description: 'Half marathon in under 2:00:00.', safety: 'Build base of 25+mpw first. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 7200 } } },
  { name: 'Marathon < 4:30:00', branch: 'Run', tier: 'TIER_4', prereqs: ['Half Marathon < 2:00:00'], blurb: 'First marathon under 4:30.', description: '+12% M XP', test: { description: 'Marathon in under 4:30:00.', safety: 'Long build (12+ weeks). Carb-load. Hydrate + fuel heavily. Practice pacing.', metric: 'duration', threshold: { duration_sec: 16200 } } },
  { name: 'Marathon < 3:30:00', branch: 'Run', tier: 'TIER_5', prereqs: ['Marathon < 4:30:00'], blurb: 'Marathon sub-3:30.', description: '+15% M XP', test: { description: 'Marathon in under 3:30:00.', safety: 'Long build (16+ weeks). Carb-load. Hydrate + fuel heavily.', metric: 'duration', threshold: { duration_sec: 12600 } } },
  { name: 'Marathon < 3:00:00', branch: 'Run', tier: 'TIER_6', prereqs: ['Marathon < 3:30:00'], blurb: 'Marathon sub-3 — competitive amateur territory.', description: '+20% M XP', test: { description: 'Marathon in under 3:00:00.', safety: 'Long build (20+ weeks). Carb-load. Hydrate + fuel heavily. Pacing is critical. Coach recommended.', metric: 'duration', threshold: { duration_sec: 10800 } } },

  // B. Ruck — linear: distance ramps 5K → 10K → HM → 30K → 50K
  // and weight ramps 8kg → 12kg → 15kg → 20kg → 20kg.
  { name: '5K Ruck @ 8kg < 50:00', branch: 'Ruck', tier: 'TIER_1', prereqs: [], blurb: 'Loaded walk — base of rucking.', description: '+5% ruck XP', test: { description: '5K walk with 8kg pack in under 50 minutes.', safety: 'Use a comfortable pack. Wear broken-in shoes.', metric: 'duration', threshold: { duration_sec: 3000 } } },
  { name: '10K Ruck @ 12kg < 1:30', branch: 'Ruck', tier: 'TIER_2', prereqs: ['5K Ruck @ 8kg < 50:00'], blurb: 'Longer ruck with more weight.', description: '+5% ruck XP', test: { description: '10K ruck with 12kg pack in under 1:30:00.', safety: 'Build up ruck time + weight gradually.', metric: 'duration', threshold: { duration_sec: 5400 } } },
  { name: 'Half Marathon Ruck @ 15kg < 3:00', branch: 'Ruck', tier: 'TIER_3', prereqs: ['10K Ruck @ 12kg < 1:30'], blurb: 'Long-distance ruck at intermediate weight.', description: '+8% ruck XP', test: { description: 'Half marathon ruck with 15kg pack in under 3:00:00.', safety: 'Build up to long rucks gradually. Hydrate heavily.', metric: 'duration', threshold: { duration_sec: 10800 } } },
  { name: '30K Ruck @ 20kg < 4:00', branch: 'Ruck', tier: 'TIER_4', prereqs: ['Half Marathon Ruck @ 15kg < 3:00'], blurb: 'Long ruck at heavier weight.', description: '+10% ruck XP', test: { description: '30K ruck with 20kg pack in under 4:00:00.', safety: 'Build up to long rucks at heavy loads. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 14400 } } },
  { name: '50K Ruck @ 20kg < 7:00', branch: 'Ruck', tier: 'TIER_5', prereqs: ['30K Ruck @ 20kg < 4:00'], blurb: 'Ruck god-tier — 50K at heavy weight.', description: '+15% ruck XP', test: { description: '50K ruck with 20kg pack in under 7:00:00.', safety: 'Long build. Carb-load. Hydrate + fuel. Spotter / team recommended.', metric: 'duration', threshold: { duration_sec: 25200 } } },

  // C. Triathlon — linear: each test is a longer / stricter
  // version of the prior. "Any time" entries are the
  // completion-celebration tier; the timed entries behind them
  // are the performance tier.
  { name: 'Sprint Tri (any time)', branch: 'Triathlon', tier: 'TIER_1', prereqs: [], blurb: 'First tri — short format, accessible entry.', description: '+5% tri XP', test: { description: 'Sprint triathlon (750m swim + 20km bike + 5km run) in any time.', safety: 'Train each discipline separately first. Wetsuit if water is cold.', metric: 'reps', threshold: { reps: 1 } } },
  { name: 'Sprint Tri < 1:30:00', branch: 'Triathlon', tier: 'TIER_1', prereqs: ['Sprint Tri (any time)'], blurb: 'First sub-1:30 sprint tri.', description: '+5% tri XP', test: { description: 'Sprint triathlon in under 1:30:00.', safety: 'Practice transitions. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 5400 } } },
  { name: 'Olympic Tri (any time)', branch: 'Triathlon', tier: 'TIER_2', prereqs: ['Sprint Tri < 1:30:00'], blurb: 'Standard distance triathlon.', description: '+8% tri XP', test: { description: 'Olympic triathlon (1.5km swim + 40km bike + 10km run) in any time.', safety: 'Build base in each discipline. Practice transitions. Hydrate + fuel.', metric: 'reps', threshold: { reps: 1 } } },
  { name: 'Olympic Tri < 3:00:00', branch: 'Triathlon', tier: 'TIER_3', prereqs: ['Olympic Tri (any time)'], blurb: 'Sub-3 Olympic tri — solid intermediate.', description: '+10% tri XP', test: { description: 'Olympic triathlon in under 3:00:00.', safety: 'Long build. Practice transitions. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 10800 } } },
  { name: 'Half Ironman < 6:30:00', branch: 'Triathlon', tier: 'TIER_4', prereqs: ['Olympic Tri < 3:00:00'], blurb: 'Half Ironman — serious multi-engine endurance.', description: '+12% half-IM XP', test: { description: 'Half Ironman (1.9km swim + 90km bike + 21km run) in under 6:30:00.', safety: 'Long build. Carb-load. Hydrate + fuel heavily. Coach recommended.', metric: 'duration', threshold: { duration_sec: 23400 } } },
  { name: 'Full Ironman (any time)', branch: 'Triathlon', tier: 'TIER_5', prereqs: ['Half Ironman < 6:30:00'], blurb: 'Ironman — the god-tier of multi-sport endurance.', description: '+20% IM XP', test: { description: 'Full Ironman (3.8km swim + 180km bike + 42km run) in any time. Just finishing is the achievement.', safety: 'Long build (months). Carb-load. Hydrate + fuel heavily. Coach + crew strongly recommended.', metric: 'reps', threshold: { reps: 1 } } },
];

// ---- 4. BERSERKER (volume + HIIT + combat) — 7 branches, ~45 skills ----
//
// Explicit per-skill prereqs (mirrors PHANTOM + SCOUT). Each branch
// is roughly linear with 2-3 weaving merge points (see per-branch
// header comments for the specific chains). Two T1 entries in
// Kettlebell + Boxing + Mace merge into a single T2 (the same
// T2 has both T1s as prereqs); Capacity's Murph entries fork off
// the 20min Cindy T2 independently from the AMRAP T2s.
//
// Restructure notes:
//   - Capacity + Hero WODs merged into one Capacity branch. Both
//     were AMRAP/benchmark territory (Cindy, Murph variants, 30/60-
//     min mixed AMRAPs) — slightly different angles on the same
//     work, so they collapse cleanly. Murphs demoted from T3 to T2;
//     finishing a Murph is a serious benchmark but 40-min-vest
//     isn't a god-tier feat. New T3 rows are 60-90 min mixed AMRAPs.
//   - The freed-up "Hero WODs" branch slot becomes a new Medicine
//     Ball branch (strongman-style heavy MB: 10-20kg throws,
//     slams, clean+jerk).
//   - Kettlebell gained two Farmer's Carry skills (T1 + T2) —
//     grip + gait under load, separate from KB swings / snatch /
//     long cycle.
//   - Sandbag branch added — bear-hug hold/walk, clean to shoulder,
//     sandbag load (lifting the bag onto a platform).
//
// Final branch layout (still 7):
//   A. Sled / Prowler          6
//   B. Kettlebell              7 (was 5; +2 farmer's carries)
//   C. Capacity (merged)       8 (was 11 across C+E; Murphs demoted)
//   D. Boxing                  5 (unchanged)
//   E. Mace / Indian Club      7 (unchanged)
//   F. Sandbag                 6 (NEW)
//   G. Medicine Ball           6 (NEW, replaces Hero WODs slot)
//
// Total: ~45 skills, 7 branches.
const BERSERKER_SKILLS: Spec[] = [
  // A. Sled / Prowler — linear: 25m → 50m → 100m → 1mi, then
  // 1mi gets heavier (50% → 75% → 100% BW). No merging.
  { name: 'Sled Push 25m', branch: 'Sled', tier: 'TIER_1', prereqs: [], blurb: 'Light horizontal push — sled basics.', description: '+5% sled XP', test: { description: 'Push a sled 25m at 25% bodyweight. Bend at the waist, drive through the legs.', safety: 'Flat surface. Don\'t lock knees at the top.', metric: 'reps', threshold: { reps: 25, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled Push 50m', branch: 'Sled', tier: 'TIER_1', prereqs: ['Sled Push 25m'], blurb: 'Sled volume at light load.', description: '+5% sled XP', test: { description: 'Push 50m at 25% bodyweight. Same form.', safety: 'Flat surface.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled Push 100m @ 50%BW', branch: 'Sled', tier: 'TIER_2', prereqs: ['Sled Push 50m'], blurb: 'Sled distance at half bodyweight.', description: '+8% sled XP', test: { description: 'Push 100m at 0.5× bodyweight. Steady pace.', safety: 'Flat surface. Good shoes.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Sled 1mi @ 50%BW < 8:00', branch: 'Sled', tier: 'TIER_3', prereqs: ['Sled Push 100m @ 50%BW'], blurb: 'A mile of heavy sled — pure grit.', description: '+10% sled XP', test: { description: 'Push a sled 1 mile at 0.5× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled 1mi @ 75%BW < 8:00', branch: 'Sled', tier: 'TIER_4', prereqs: ['Sled 1mi @ 50%BW < 8:00'], blurb: 'Three-quarter bodyweight mile.', description: '+12% sled XP', test: { description: 'Push 1 mile at 0.75× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled 1mi @ 100%BW < 8:00', branch: 'Sled', tier: 'TIER_5', prereqs: ['Sled 1mi @ 75%BW < 8:00'], blurb: 'Bodyweight mile — strongman-class feat.', description: '+15% sled XP', test: { description: 'Push 1 mile at bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first. Spotter / coach nearby.', metric: 'duration', threshold: { duration_sec: 480 } } },

  // B. Kettlebell + Farmer's Carry — KB swings: T1 100 swings → T2 200
  // swings → T3 long cycle (or → 30+ LCC). KB snatches: T1 swings
  // → T2 snatches → T3 long cycle. Farmer carry: T1 50m → T2 100m
  // (no T3 — carry is a maintenance skill, not a peak one). 100 KB
  // Long Cycle T3 is the weaving merge point for swings + snatches.
  { name: '100 KB Swings @ 24kg', branch: 'Kettlebell', tier: 'TIER_1', prereqs: [], blurb: 'Russian-style KB swings — grip + hip power.', description: '+5% KB XP', test: { description: '100 single-arm KB swings at 24kg, alternating arms. Hardstyle swing to chest level.', safety: 'Use a hip hinge, not a squat. Don\'t round the back.', metric: 'reps', threshold: { reps: 100 } } },
  { name: 'Farmer Carry 50m @ 24kg/hand', branch: 'Kettlebell', tier: 'TIER_1', prereqs: [], blurb: 'Farmer\'s carry — grip + gait under load.', description: '+5% KB XP', test: { description: 'Carry a kettlebell (or dumbbell) in each hand for 50m at 24kg/hand. No setting down.', safety: 'Use proper grip. Stand tall, don\'t lean. Stop if grip fails.', metric: 'reps', threshold: { reps: 50 } } },
  { name: '200 KB Swings < 20:00', branch: 'Kettlebell', tier: 'TIER_2', prereqs: ['100 KB Swings @ 24kg'], blurb: 'KB swing volume — pure conditioning.', description: '+5% KB XP', test: { description: '200 KB swings in under 20 minutes. Use a hip hinge, controlled pace.', safety: 'Same as T1. Don\'t go to failure — pace yourself.', metric: 'duration', threshold: { duration_sec: 1200 } } },
  { name: 'Farmer Carry 100m @ 32kg/hand < 2:00', branch: 'Kettlebell', tier: 'TIER_2', prereqs: ['Farmer Carry 50m @ 24kg/hand'], blurb: 'Loaded carry under time pressure.', description: '+8% KB XP', test: { description: 'Carry 32kg in each hand for 100m in under 2:00. No setting down.', safety: 'Strong T1 baseline first. Stand tall. Spotter if loaded heavy.', metric: 'duration', threshold: { duration_sec: 120 } } },
  { name: '100 KB Snatches < 10:00', branch: 'Kettlebell', tier: 'TIER_2', prereqs: ['100 KB Swings @ 24kg'], blurb: 'KB snatch — ballistic overhead work.', description: '+8% KB XP', test: { description: '100 KB snatches at 24kg in under 10 minutes, alternating arms.', safety: 'Use a hip drive. Don\'t press out — it\'s a flip catch. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '100 KB Long Cycle < 5:00', branch: 'Kettlebell', tier: 'TIER_3', prereqs: ['200 KB Swings < 20:00', '100 KB Snatches < 10:00'], blurb: 'Long cycle — clean + snatch + jerk + clean.', description: '+10% KB XP', test: { description: '100 KB long cycle at 24kg in under 5 minutes.', safety: 'Build up to long cycle gradually. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '30+ LCC @ 24kg', branch: 'Kettlebell', tier: 'TIER_4', prereqs: ['100 KB Long Cycle < 5:00'], blurb: 'Long cycle god-tier — 30+ reps in 5 minutes at 24kg.', description: '+15% KB XP', test: { description: '30+ KB long cycle reps at 24kg in 5 minutes.', safety: 'Strong LC base first. Don\'t go to failure.', metric: 'rounds', threshold: { rounds: 30 } } },

  // C. Capacity (was: Capacity + Hero WODs, merged. Murphs demoted
  // to T2.) Two parallel progressions: Cindy (10/20min AMRAP) →
  // 30min AMRAP → 60min AMRAP → 90min AMRAP. Murph unpartitioned /
  // partitioned are sibling T2 benchmarks off the 20min Cindy.
  // 30min AMRAP and Murph are independent — both can unlock off the
  // Cindy 15+ baseline.
  { name: '10min Cindy ≥ 12 Rounds', branch: 'Capacity', tier: 'TIER_1', prereqs: [], blurb: 'Capacity baseline — bodyweight AMRAP.', description: '+5% capacity XP', test: { description: '10min Cindy (5 PU + 10 PU + 15 squats) for 12+ rounds.', safety: 'Scale PU/PU if needed.', metric: 'rounds', threshold: { rounds: 12 } } },
  { name: 'Cindy 15+ Rounds (20min AMRAP)', branch: 'Capacity', tier: 'TIER_1', prereqs: ['10min Cindy ≥ 12 Rounds'], blurb: 'Classic Hero WOD Cindy — 20min AMRAP at 15+ rounds.', description: '+5% capacity XP', test: { description: '20min Cindy (5 PU + 10 PU + 15 squats) for 15+ rounds.', safety: 'Scale pull-ups / push-ups to bands or knees if needed.', metric: 'rounds', threshold: { rounds: 15 } } },
  { name: '20min Cindy ≥ 18 Rounds', branch: 'Capacity', tier: 'TIER_2', prereqs: ['Cindy 15+ Rounds (20min AMRAP)'], blurb: '20min Cindy — strong capacity.', description: '+8% capacity XP', test: { description: '20min Cindy for 18+ rounds.', safety: 'Hydrate. Don\'t go to failure on PU.', metric: 'rounds', threshold: { rounds: 18 } } },
  { name: 'Murph Unpartitioned < 60:00', branch: 'Capacity', tier: 'TIER_2', prereqs: ['20min Cindy ≥ 18 Rounds'], blurb: 'Murph as a mid-tier capacity test — finishing is the win.', description: '+8% capacity XP', test: { description: 'Murph (1mi + 100 PU + 200 PU + 1mi) in under 60:00, unpartitioned.', safety: 'Hydrate + fuel. Run/walk splits allowed. Build up over weeks.', metric: 'duration', threshold: { duration_sec: 3600 } } },
  { name: 'Murph Partitioned < 45:00', branch: 'Capacity', tier: 'TIER_2', prereqs: ['20min Cindy ≥ 18 Rounds'], blurb: 'Murph with set breaks (5/10/15) — demoted from T3.', description: '+8% capacity XP', test: { description: 'Murph partitioned (sets of 5/10/15 PU + squats) in under 45:00.', safety: 'Same as T2. Stay hydrated.', metric: 'duration', threshold: { duration_sec: 2700 } } },
  { name: '30min Mixed AMRAP ≥ 15 Rounds', branch: 'Capacity', tier: 'TIER_2', prereqs: ['20min Cindy ≥ 18 Rounds'], blurb: '30min mixed AMRAP — sustained output.', description: '+8% capacity XP', test: { description: '30min AMRAP of mixed movements (e.g. KB swings, push-ups, air squats) for 15+ rounds.', safety: 'Hydrate + fuel. Don\'t go to failure.', metric: 'rounds', threshold: { rounds: 15 } } },
  { name: '60min Mixed AMRAP ≥ 20 Rounds', branch: 'Capacity', tier: 'TIER_3', prereqs: ['30min Mixed AMRAP ≥ 15 Rounds'], blurb: '60min mixed AMRAP — extreme capacity.', description: '+12% capacity XP', test: { description: '60min AMRAP of mixed movements for 20+ rounds.', safety: 'Hydrate + fuel heavily. Coach / spotter recommended.', metric: 'rounds', threshold: { rounds: 20 } } },
  { name: '90min Mixed AMRAP ≥ 25 Rounds', branch: 'Capacity', tier: 'TIER_4', prereqs: ['60min Mixed AMRAP ≥ 20 Rounds'], blurb: '90min mixed AMRAP — capacity god-tier.', description: '+15% capacity XP', test: { description: '90min AMRAP of mixed movements for 25+ rounds.', safety: 'Hydrate + fuel heavily. Coach / spotter recommended. Pre-plan nutrition.', metric: 'rounds', threshold: { rounds: 25 } } },

  // D. Boxing — two T1s (jabs + shadowbox) merge into 3min Heavy Bag
  // (T2), which feeds 5min Full Speed (T3) and finally 3×3min Rounds
  // (T3 god-tier). Both T3s require the 5min baseline.
  { name: '100 Jabs in 3min', branch: 'Boxing', tier: 'TIER_1', prereqs: [], blurb: 'Boxing basics — jab volume.', description: '+5% boxing XP', test: { description: '100 jabs on a heavy bag in 3 minutes.', safety: 'Use proper hand wrapping. Don\'t over-extend the elbow.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '3min Shadowbox Round', branch: 'Boxing', tier: 'TIER_1', prereqs: [], blurb: 'Shadowboxing — full-body warmup.', description: '+5% boxing XP', test: { description: '3 minutes of continuous shadowboxing (jabs, crosses, hooks, movement).', safety: 'Warm up first. Use proper stance and rotation.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '3min Heavy Bag Round', branch: 'Boxing', tier: 'TIER_2', prereqs: ['100 Jabs in 3min', '3min Shadowbox Round'], blurb: 'Heavy bag work — power + combinations.', description: '+5% boxing XP', test: { description: '3 minutes of heavy bag work (jabs + crosses + hooks + movement).', safety: 'Use hand wrapping + gloves. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '5min Heavy Bag @ Full Speed', branch: 'Boxing', tier: 'TIER_3', prereqs: ['3min Heavy Bag Round'], blurb: 'Full-speed 5min — sustained power.', description: '+8% boxing XP', test: { description: '5 minutes of heavy bag at full speed. Sustained combinations.', safety: 'Use wrapping + gloves. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '3×3min Heavy Bag Rounds', branch: 'Boxing', tier: 'TIER_4', prereqs: ['5min Heavy Bag @ Full Speed'], blurb: 'Boxing god-tier — three rounds of sustained power.', description: '+12% boxing XP', test: { description: '3 rounds of 3min heavy bag, with 30s rest between rounds.', safety: 'Strong base first. Wrap hands, use gloves. Coach / sparring partner recommended.', metric: 'duration', threshold: { duration_sec: 540 } } },

  // E. Mace / Indian Club (was F — re-lettered after Capacity absorbed Hero WODs)
  // Two T1s (figure-8s + mills) merge into 5 Fig-8 + 5 Mills (T2
  // weaving). 50 Figure-8s T2 branches off the figure-8s T1. T3
  // entries: 10 Mace 360s off the 50 figure-8s (vertical → full
  // rotation), 50 Alt T3 off the 5 Fig-8+Mills combination, and
  // Gravedigger (the god-tier combo) requires both 360s and the
  // combination.
  { name: '10 Figure-8s @ 7kg', branch: 'Mace / Indian Club', tier: 'TIER_1', prereqs: [], blurb: 'Mace basics — figure-8 swings. Grip + shoulder + rotational core.', description: '+5% mace XP', test: { description: '10 figure-8 swings at 7kg (each side, alternating). Smooth horizontal circles at chest level.', safety: 'Use proper grip. Don\'t lock the elbow. Warm up shoulders first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: '10 Mills @ 7kg', branch: 'Mace / Indian Club', tier: 'TIER_1', prereqs: [], blurb: 'Vertical circles — shoulder mobility + grip.', description: '+5% mace XP', test: { description: '10 mills (vertical circles, alternating forward/back) at 7kg. Each side.', safety: 'Same as figure-8. Don\'t lock the elbow.', metric: 'reps', threshold: { reps: 10 } } },
  { name: '5 Fig-8 + 5 Mills @ 7kg < 3:00', branch: 'Mace / Indian Club', tier: 'TIER_2', prereqs: ['10 Figure-8s @ 7kg', '10 Mills @ 7kg'], blurb: 'Mace combination — both planes in one session.', description: '+5% mace XP', test: { description: '5 figure-8 + 5 mills at 7kg in under 3 minutes (each side).', safety: 'Same as T1/T2. Stay loose in the grip.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '50 Figure-8s @ 10kg Continuous', branch: 'Mace / Indian Club', tier: 'TIER_2', prereqs: ['10 Figure-8s @ 7kg'], blurb: 'Mace volume at moderate load — grip endurance.', description: '+8% mace XP', test: { description: '50 figure-8s continuous at 10kg. Smooth circles, no breaks.', safety: 'Use lighter mace first. Don\'t lock the elbow. Stop if grip fails.', metric: 'reps', threshold: { reps: 50 } } },
  { name: '10 Mace 360s @ 14kg < 5:00', branch: 'Mace / Indian Club', tier: 'TIER_3', prereqs: ['50 Figure-8s @ 10kg Continuous'], blurb: 'Heavy mace at 14kg — full shoulder + grip work.', description: '+10% mace XP', test: { description: '10 mace 360s (full horizontal rotations around the body) at 14kg in under 5 minutes. Each side.', safety: 'Build up to heavy mace gradually. Use chalk. Stop if elbow pain.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '50 Alt Fig-8/Mill @ 14kg < 10:00', branch: 'Mace / Indian Club', tier: 'TIER_3', prereqs: ['5 Fig-8 + 5 Mills @ 7kg < 3:00'], blurb: 'Mace AMRAP — sustained mace work capacity.', description: '+12% mace XP', test: { description: '50 alternating figure-8 / mill at 14kg in under 10 minutes.', safety: 'Build up to heavy mace first. Use chalk + a flat surface.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: 'Gravedigger @ 18kg < 5:00', branch: 'Mace / Indian Club', tier: 'TIER_4', prereqs: ['10 Mace 360s @ 14kg < 5:00', '50 Alt Fig-8/Mill @ 14kg < 10:00'], blurb: 'Mace god-tier — the iconic gravedigger combo.', description: '+15% mace XP', test: { description: 'Gravedigger (squat down → 360° circle as you stand → press overhead → repeat) at 18kg in under 5 minutes. Each side.', safety: 'Strong mace base first. Use a controlled mace. Coach / spotter recommended. Stop if elbow/shoulder pain.', metric: 'duration', threshold: { duration_sec: 300 } } },

  // F. Sandbag (NEW) — two T1 paths (static hold + clean) merge into
  // two T2 paths (walk + clean+squat). T3s: Sandbag Load (T3 from
  // the walk — the closer analog to "lift onto platform") and
  // Sandbag-to-Shoulder (T3 from clean+squat — volume test).
  { name: 'Bear Hug Hold 30s @ 25kg', branch: 'Sandbag', tier: 'TIER_1', prereqs: [], blurb: 'Sandbag bear-hug static hold — grip + core under load.', description: '+5% sandbag XP', test: { description: 'Hold a 25kg sandbag in a bear-hug position against your chest for 30 seconds.', safety: 'Stand tall. Don\'t round the lower back. Use a floor-bag, not a cylindrical one.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Sandbag Clean to Shoulder × 10 @ 30kg', branch: 'Sandbag', tier: 'TIER_1', prereqs: [], blurb: 'Clean the bag from floor to shoulder — the foundational strongman pattern.', description: '+5% sandbag XP', test: { description: '10 sandbag cleans from floor to shoulder at 30kg, alternating sides.', safety: 'Use a hip drive. Bag shifts in-hand — expect it. Use a flat surface.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Bear Hug Walk 25m @ 50kg', branch: 'Sandbag', tier: 'TIER_2', prereqs: ['Bear Hug Hold 30s @ 25kg'], blurb: 'Walking bear-hug carry — grip + gait + core.', description: '+8% sandbag XP', test: { description: 'Bear-hug carry a 50kg sandbag for 25m without setting it down.', safety: 'Use a flat surface. Stand tall — don\'t lean. Spotter for transitions.', metric: 'reps', threshold: { reps: 25 } } },
  { name: 'Sandbag Clean + Squat × 10 @ 50kg', branch: 'Sandbag', tier: 'TIER_2', prereqs: ['Sandbag Clean to Shoulder × 10 @ 30kg'], blurb: 'Clean + front squat — combine the carry pattern with leg strength.', description: '+8% sandbag XP', test: { description: '10 sandbag cleans to shoulder followed by a front squat at 50kg. Alternating sides.', safety: 'Master T1 clean + light front squat first. Use a controlled bag.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Sandbag Load 80kg to 48" Platform < 30s', branch: 'Sandbag', tier: 'TIER_3', prereqs: ['Bear Hug Walk 25m @ 50kg'], blurb: 'Strongman classic — lift the bag onto a platform fast.', description: '+12% sandbag XP', test: { description: 'Lift an 80kg sandbag onto a 48" platform in under 30 seconds, any number of attempts. Use any carry style.', safety: 'Use a stable platform. Warm up the spine. Spotter for transitions. Stop if back pain.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Sandbag-to-Shoulder 30 reps @ 70kg < 8:00', branch: 'Sandbag', tier: 'TIER_4', prereqs: ['Sandbag Clean + Squat × 10 @ 50kg'], blurb: 'Sandbag god-tier — heavy sandbag volume in time.', description: '+15% sandbag XP', test: { description: '30 sandbag cleans to shoulder at 70kg in under 8:00, any carry style.', safety: 'Strong T2 base first. Coach / spotter recommended. Pre-plan grip rotation.', metric: 'duration', threshold: { duration_sec: 480 } } },

  // G. Medicine Ball (NEW — replaces the old Hero WODs slot) — two
  // T1s (chest pass + slam) seed the heavier patterns. T2s:
  // Overhead Throw off the chest pass (sagittal → overhead);
  // Rotational Throw off the chest pass (sagittal → rotational).
  // T3s: 20kg Rotational Throw off the 15kg version (heavier
  // weight, same movement). 20kg Clean + Jerk requires the 15kg
  // Rotational — clean + jerk on a 20kg ball is a different
  // movement from a 10kg slam.
  { name: '10kg MB Chest Pass ≥ 6m', branch: 'Medicine Ball', tier: 'TIER_1', prereqs: [], blurb: 'Heavy MB chest pass — power transfer through the core.', description: '+5% MB XP', test: { description: '10kg medicine ball chest pass ≥ 6 meters (to a wall or partner).', safety: 'Use a wall or partner catcher. Don\'t throw at people. Stand sideways, rotate.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '10kg MB Slam × 30', branch: 'Medicine Ball', tier: 'TIER_1', prereqs: [], blurb: 'Heavy MB slam — full-body ballistic.', description: '+5% MB XP', test: { description: '30 overhead slams with a 10kg medicine ball.', safety: 'Use a slam ball, not a hard-shell ball. Warm up shoulders. Don\'t lock the elbows.', metric: 'reps', threshold: { reps: 30 } } },
  { name: '15kg MB Overhead Throw ≥ 7m', branch: 'Medicine Ball', tier: 'TIER_2', prereqs: ['10kg MB Chest Pass ≥ 6m'], blurb: 'Heavy MB overhead throw — full kinetic chain.', description: '+8% MB XP', test: { description: '15kg medicine ball overhead throw ≥ 7 meters.', safety: 'Use a safe landing area. Don\'t throw at people. Warm up shoulders first.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '15kg MB Rotational Throw ≥ 9m', branch: 'Medicine Ball', tier: 'TIER_2', prereqs: ['10kg MB Chest Pass ≥ 6m'], blurb: 'Heavy MB rotational throw — core power transfer.', description: '+8% MB XP', test: { description: '15kg medicine ball rotational (sideways) throw ≥ 9 meters.', safety: 'Use a safe landing area. Master 10kg chest pass first. Coach / spotter nearby.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '20kg MB Rotational Throw ≥ 11m', branch: 'Medicine Ball', tier: 'TIER_3', prereqs: ['15kg MB Rotational Throw ≥ 9m'], blurb: 'Heavy MB rotational god-tier — 20kg thrown sideways 11m.', description: '+12% MB XP', test: { description: '20kg medicine ball rotational (sideways) throw ≥ 11 meters.', safety: 'Strong 15kg baseline first. Coach / spotter recommended. Safe landing area.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '20kg MB Clean + Jerk × 20', branch: 'Medicine Ball', tier: 'TIER_3', prereqs: ['15kg MB Rotational Throw ≥ 9m'], blurb: 'MB god-tier — heavy slam ball clean + jerk volume.', description: '+15% MB XP', test: { description: '20 medicine ball clean + jerks at 20kg (floor to shoulder, then overhead). Continuous sets allowed.', safety: 'Strong T1/T2 MB baseline first. Coach / spotter nearby. Use a slam ball, not a hard shell.', metric: 'reps', threshold: { reps: 20 } } },
];

// ---- 5. TRACER (speed + plyo + parkour) — 27 skills, linear prereqs ----
//
// Explicit per-skill prereqs (mirrors PHANTOM + SCOUT + BERSERKER +
// JUGGERNAUT). Each branch is a linear distance/time chain with
// one weaving merge at the heavier T3 entry. See per-branch
// comments for the specific chain.
const TRACER_SKILLS: Spec[] = [
  // A. Sprint — T1 100m feeds two T2 paths (faster 100m + longer
  // 200m). T2 faster-100m + T2 200m weave into T3 200m sub-25.
  // T2 200m also feeds T3 400m < 60; T3 400m < 60 → T3 400m < 50.
  { name: '100m < 18s', branch: 'Sprint', tier: 'TIER_1', prereqs: [], blurb: 'Sprint basics — 100m baseline.', description: '+5% sprint XP', test: { description: '100m in under 18 seconds.', safety: 'Warm up with dynamic stretching. Don\'t pull a hamstring.', metric: 'duration', threshold: { duration_sec: 18 } } },
  { name: '100m < 14s', branch: 'Sprint', tier: 'TIER_2', prereqs: ['100m < 18s'], blurb: 'Sub-14 — competitive amateur.', description: '+5% sprint XP', test: { description: '100m in under 14 seconds.', safety: 'Warm up thoroughly. Don\'t pull a hamstring.', metric: 'duration', threshold: { duration_sec: 14 } } },
  { name: '200m < 30s', branch: 'Sprint', tier: 'TIER_2', prereqs: ['100m < 18s'], blurb: '200m — first true sprint distance.', description: '+5% sprint XP', test: { description: '200m in under 30 seconds.', safety: 'Same as 100m. Build up to 200m first.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '200m < 25s', branch: 'Sprint', tier: 'TIER_3', prereqs: ['100m < 14s', '200m < 30s'], blurb: 'Sub-25 200m.', description: '+8% sprint XP', test: { description: '200m in under 25 seconds.', safety: 'Same as T3.', metric: 'duration', threshold: { duration_sec: 25 } } },
  { name: '400m < 60s', branch: 'Sprint', tier: 'TIER_4', prereqs: ['200m < 30s'], blurb: '400m — the lactic acid test.', description: '+10% sprint XP', test: { description: '400m in under 60 seconds.', safety: 'Build base of 200m first. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '400m < 50s', branch: 'Sprint', tier: 'TIER_5', prereqs: ['400m < 60s'], blurb: 'Sub-50 400m — elite amateur.', description: '+12% sprint XP', test: { description: '400m in under 50 seconds.', safety: 'Strong 400m base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 50 } } },

  // B. Plyo (vertical) — T1 broad jump feeds T2 stronger broad
  // jump + T2 box jump. T3 30" box requires BOTH T2s (weaving).
  // T3 vertical jump requires T2 box jump. T3 depth jump (god-tier)
  // requires T3 30" box.
  { name: 'Broad Jump ≥ Height', branch: 'Plyo', tier: 'TIER_1', prereqs: [], blurb: 'Standing broad jump — baseline plyo.', description: '+5% plyo XP', test: { description: 'Standing broad jump ≥ your height (e.g. if you\'re 6ft, jump 6ft).', safety: 'Warm up. Land softly. Don\'t over-extend the knees.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Broad Jump ≥ 1.25× Height', branch: 'Plyo', tier: 'TIER_2', prereqs: ['Broad Jump ≥ Height'], blurb: 'Strong broad jump.', description: '+5% plyo XP', test: { description: 'Standing broad jump ≥ 1.25× your height.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Box Jump 24"', branch: 'Plyo', tier: 'TIER_2', prereqs: ['Broad Jump ≥ Height'], blurb: '24" box jump — the standard.', description: '+8% plyo XP', test: { description: 'Box jump 24" (60cm). Jump and land soft, full hip extension.', safety: 'Warm up. Use a stable box. Don\'t over-jump your ability.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Box Jump 30"', branch: 'Plyo', tier: 'TIER_3', prereqs: ['Broad Jump ≥ 1.25× Height', 'Box Jump 24"'], blurb: 'Strong box jump — 30".', description: '+10% plyo XP', test: { description: 'Box jump 30" (75cm).', safety: 'Same as T3. Master 24" first.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Vertical Jump ≥ 1.5× Height', branch: 'Plyo', tier: 'TIER_4', prereqs: ['Box Jump 24"'], blurb: 'Vertical jump — pure lower-body power.', description: '+10% plyo XP', test: { description: 'Standing vertical jump ≥ 1.5× your height (e.g. 6ft person jumps 9ft up).', safety: 'Same as T1. Don\'t pull a hamstring.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Depth Jump 24" + Max Vertical', branch: 'Plyo', tier: 'TIER_5', prereqs: ['Box Jump 30"'], blurb: 'Depth jump — reactive strength god-tier.', description: '+12% plyo XP', test: { description: 'Drop from 24" box, immediately max vertical jump upon landing.', safety: 'Master regular box jump first. Use a softer landing surface. Coach recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },

  // C. Parkour — T1 precision jump feeds both T2 paths. T3 wall spin
  // requires BOTH T2s (weaving). T3 dash vault from T2 tic-tac;
  // T3 kong vault (god-tier) from T3 dash vault.
  { name: '5m Precision Jump Initiate', branch: 'Parkour', tier: 'TIER_1', prereqs: [], blurb: 'Land within a target — precision training.', description: '+5% parkour XP', test: { description: 'Jump 5m and land within 6" of a target on the ground.', safety: 'Start short. Land soft. Don\'t roll an ankle.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Tic-Tac ≥ 4 Steps', branch: 'Parkour', tier: 'TIER_2', prereqs: ['5m Precision Jump Initiate'], blurb: 'Vertical wall run-up — the tic-tac.', description: '+5% parkour XP', test: { description: 'Tic-tac off a wall with at least 4 steps (push off, land on the same wall, push off again).', safety: 'Practice lower steps first. Use a sturdy wall. Spotter for first attempts.', metric: 'reps', threshold: { reps: 4, sides: 'total' } } },
  { name: 'Wall Cat 8ft, 2 Holds', branch: 'Parkour', tier: 'TIER_2', prereqs: ['5m Precision Jump Initiate'], blurb: 'Climb 8ft using two cat-grab holds.', description: '+8% parkour XP', test: { description: 'Climb an 8ft wall using only two cat-grab (one-hand-each) holds.', safety: 'Have a spotter. Practice lower walls first. Check holds for stability.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Dash Vault 5ft', branch: 'Parkour', tier: 'TIER_3', prereqs: ['Tic-Tac ≥ 4 Steps'], blurb: 'Clear a 5ft obstacle from a run.', description: '+10% parkour XP', test: { description: 'From a run, clear a 5ft obstacle with a vault (speed vault or dive roll).', safety: 'Practice lower obstacles first. Use a soft landing surface. Spotter.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Wall Spin (180°)', branch: 'Parkour', tier: 'TIER_4', prereqs: ['Tic-Tac ≥ 4 Steps', 'Wall Cat 8ft, 2 Holds'], blurb: 'Run up + spin 180° off a wall.', description: '+10% parkour XP', test: { description: 'Wall spin: run up wall, push off, spin 180°, land facing the other way.', safety: 'Have a spotter. Practice shorter walls first. Use a sturdy wall.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Kong Vault 6ft', branch: 'Parkour', tier: 'TIER_5', prereqs: ['Dash Vault 5ft'], blurb: 'Parkour god-tier — the kong is the highest-vault flow.', description: '+15% parkour XP', test: { description: 'From a run, kong vault (two-handed) over a 6ft obstacle.', safety: 'Master dash vault first. Spotter / coach required. Use a soft surface.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },

  // D. Agility — T1 5-10-5 → T2 sub-4.5. T2 fans into T3 sub-4.0
  // (continuing the 5-10-5 progression) and T3 T-test (new
  // movement). T3 T-test < 9.0 (god-tier) requires T-test < 10.
  { name: '5-10-5 Pro-Agility < 5.0s', branch: 'Agility', tier: 'TIER_1', prereqs: [], blurb: 'Reactive change-of-direction baseline.', description: '+5% agility XP', test: { description: '5-10-5 yard pro-agility drill in under 5.0 seconds.', safety: 'Warm up. Don\'t cut too sharp — use proper technique.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5-10-5 < 4.5s', branch: 'Agility', tier: 'TIER_2', prereqs: ['5-10-5 Pro-Agility < 5.0s'], blurb: 'Sub-4.5 — solid.', description: '+5% agility XP', test: { description: '5-10-5 in under 4.5 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 4.5 } } },
  { name: 'T-Test < 10.0s', branch: 'Agility', tier: 'TIER_3', prereqs: ['5-10-5 < 4.5s'], blurb: 'T-test — multi-directional agility.', description: '+10% agility XP', test: { description: 'T-test (forward + lateral + backpedal) in under 10.0 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5-10-5 < 4.0s', branch: 'Agility', tier: 'TIER_4', prereqs: ['5-10-5 < 4.5s'], blurb: 'Sub-4 — elite amateur.', description: '+8% agility XP', test: { description: '5-10-5 in under 4.0 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 4 } } },
  { name: 'T-Test < 9.0s', branch: 'Agility', tier: 'TIER_4', prereqs: ['T-Test < 10.0s'], blurb: 'T-test god-tier.', description: '+12% agility XP', test: { description: 'T-test in under 9.0 seconds.', safety: 'Strong base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 9 } } },

  // E. Throws — T1 chest pass feeds both T2 paths (heavier
  // overhead, heavier rotational). T3 8kg rotational requires
  // BOTH T2s (weaving — heavier ball on either plane).
  { name: '2kg MB Chest ≥ 8m', branch: 'Throws', tier: 'TIER_1', prereqs: [], blurb: 'Med ball chest throw — power transfer.', description: '+5% throws XP', test: { description: '2kg med ball chest pass ≥ 8 meters.', safety: 'Use a wall or partner catcher. Don\'t throw at people.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '4kg MB OH ≥ 6m', branch: 'Throws', tier: 'TIER_2', prereqs: ['2kg MB Chest ≥ 8m'], blurb: 'Overhead throw — full-body power.', description: '+5% throws XP', test: { description: '4kg med ball overhead throw ≥ 6 meters.', safety: 'Use a safe landing area. Don\'t throw at people.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '5kg MB Rotational ≥ 10m', branch: 'Throws', tier: 'TIER_2', prereqs: ['2kg MB Chest ≥ 8m'], blurb: 'Rotational throw — core power transfer.', description: '+8% throws XP', test: { description: '5kg med ball rotational throw (sideways) ≥ 10 meters.', safety: 'Same. Master 4kg OH first.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '8kg MB Rotational ≥ 12m', branch: 'Throws', tier: 'TIER_3', prereqs: ['4kg MB OH ≥ 6m', '5kg MB Rotational ≥ 10m'], blurb: 'Heavy med ball throw — power god-tier.', description: '+12% throws XP', test: { description: '8kg med ball rotational throw ≥ 12 meters.', safety: 'Strong base of lighter throws first. Coach / spotter recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
];

// ---- 6. ORACLE (yoga + pilates + mobility) — 34 skills, linear prereqs ----
//
// Explicit per-skill prereqs (mirrors PHANTOM + SCOUT + BERSERKER +
// JUGGERNAUT + TRACER). Each branch is a linear time / hold /
// distance / flow progression with one weaving merge at the
// god-tier. See per-branch comment headers for the chains.
const ORACLE_SKILLS: Spec[] = [
  // A. Mobility (static) — two T1s (forward fold + bridge) feed T2
  // pancake paths. T3 front split + middle split converge at the
  // pancake + splits combo god-tier (weaving).
  { name: 'Palms to Floor Initiate', branch: 'Mobility', tier: 'TIER_1', prereqs: [], blurb: 'Forward fold — the first static hold.', description: '+5% mobility XP', test: { description: 'Standing forward fold, palms to the floor (knees soft).', safety: 'Don\'t bounce. Hold steady.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s Bridge', branch: 'Mobility', tier: 'TIER_1', prereqs: [], blurb: 'Bridge — hip flexor + glute control.', description: '+5% mobility XP', test: { description: '30s bridge (shoulders + feet on floor, hips up).', safety: 'Don\'t hyperextend the lower back. Tuck pelvis.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake 80% ROM 30s', branch: 'Mobility', tier: 'TIER_2', prereqs: ['Palms to Floor Initiate'], blurb: 'Pancake — hamstring + adductor stretch.', description: '+5% mobility XP', test: { description: 'Seated pancake at 80% ROM (legs wide, chest to floor, knees straight). 30s hold.', safety: 'Warm up first. Don\'t force the stretch.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake 100% ROM 60s', branch: 'Mobility', tier: 'TIER_2', prereqs: ['30s Bridge'], blurb: 'Full pancake — advanced hip mobility.', description: '+8% mobility XP', test: { description: 'Seated pancake at 100% ROM (chest to floor). 60s hold.', safety: 'Master 80% first. Stretch before testing.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '30s Front Split', branch: 'Mobility', tier: 'TIER_3', prereqs: ['Pancake 100% ROM 60s'], blurb: 'Front split — peak hamstring flexibility.', description: '+10% mobility XP', test: { description: '30s front split (one leg forward, one back, both straight, pelvis square).', safety: 'Master 100% pancake first. Stretch before testing. Don\'t force into the split.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s Middle Split', branch: 'Mobility', tier: 'TIER_4', prereqs: ['Pancake 100% ROM 60s'], blurb: 'Middle split — peak adductor flexibility.', description: '+10% mobility XP', test: { description: '30s middle split (legs wide, both straight, pelvis square, chest to floor).', safety: 'Master 100% pancake + front split first. Stretch thoroughly. Don\'t force.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake + Splits Combo', branch: 'Mobility', tier: 'TIER_5', prereqs: ['30s Front Split', '30s Middle Split'], blurb: 'Mobility god-tier — pancake + both splits.', description: '+15% mobility XP', test: { description: 'Hold pancake (30s) + front split (30s, each side) + middle split (30s) in sequence.', safety: 'Master each individual milestone first. Stretch thoroughly before testing.', metric: 'duration', threshold: { duration_sec: 90 } } },

  // B. Breath — T1 box breathing feeds two T2 paths (4-7-8
  // structured breathwork + 60s hold). T2 60s hold → T3 90s → T3
  // 120s (linear hold progression) and T3 Wim Hof (god-tier,
  // requires 90s as the hold baseline).
  { name: 'Box 5min Sustained', branch: 'Breath', tier: 'TIER_1', prereqs: [], blurb: 'Box breathing — calm focus.', description: '+5% breath XP', test: { description: 'Box breathing (4-4-4-4) sustained for 5 minutes.', safety: 'Sit comfortably. Don\'t force the breath.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '4-7-8 × 50 Cycles', branch: 'Breath', tier: 'TIER_2', prereqs: ['Box 5min Sustained'], blurb: '4-7-8 breathwork — parasympathetic activation.', description: '+5% breath XP', test: { description: '4-7-8 breathwork (inhale 4, hold 7, exhale 8) for 50 cycles.', safety: 'Same as T1. Don\'t force.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '60s Breath Hold', branch: 'Breath', tier: 'TIER_2', prereqs: ['Box 5min Sustained'], blurb: 'Comfortable breath hold — lung capacity.', description: '+8% breath XP', test: { description: '60s comfortable breath hold (after a normal inhale, not forced).', safety: 'Don\'t do this in water. Stop if you feel lightheaded.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '90s Breath Hold', branch: 'Breath', tier: 'TIER_3', prereqs: ['60s Breath Hold'], blurb: '90s hold — strong lung capacity.', description: '+10% breath XP', test: { description: '90s comfortable breath hold.', safety: 'Same as T3. Don\'t push to blackout.', metric: 'duration', threshold: { duration_sec: 90 } } },
  { name: '120s Breath Hold', branch: 'Breath', tier: 'TIER_4', prereqs: ['90s Breath Hold'], blurb: '2-minute hold — elite pranayama.', description: '+12% breath XP', test: { description: '120s comfortable breath hold.', safety: 'Same as T3. Practice in a safe environment.', metric: 'duration', threshold: { duration_sec: 120 } } },
  { name: 'Wim Hof Round 1', branch: 'Breath', tier: 'TIER_4', prereqs: ['90s Breath Hold'], blurb: 'Wim Hof method — breath god-tier.', description: '+15% breath XP', test: { description: 'Wim Hof round 1: 3 cycles of 30 breaths + retention ≥ 2 minutes.', safety: 'Practice shorter rounds first. Don\'t do in water. Coach recommended.', metric: 'duration', threshold: { duration_sec: 120 } } },

  // C. Balance — T1 single-leg 30s → T2 single-leg 60s (eyes open)
  // + T2 single-leg 60s eyes closed. T2 60s eyes closed → T3
  // tree pose eyes closed (similar proprioception challenge at
  // the god-tier level). T2 60s eyes open → T3 30s handstand.
  // T3 30s handstand → T3 60s handstand (progression).
  { name: 'Single-Leg Stand 30s Initiate', branch: 'Balance', tier: 'TIER_1', prereqs: [], blurb: 'Single-leg stand — the balance baseline.', description: '+5% balance XP', test: { description: '30s single-leg stand on each leg (no shoes preferred).', safety: 'Stand near a wall or chair for safety. Don\'t lock the standing knee.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Single-Leg Stand 60s', branch: 'Balance', tier: 'TIER_2', prereqs: ['Single-Leg Stand 30s Initiate'], blurb: 'Single-leg stand milestone.', description: '+5% balance XP', test: { description: '60s single-leg stand on each leg.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Single-Leg Stand 60s Eyes Closed', branch: 'Balance', tier: 'TIER_2', prereqs: ['Single-Leg Stand 30s Initiate'], blurb: 'Single-leg stand with eyes closed — proprioception.', description: '+8% balance XP', test: { description: '60s single-leg stand with eyes closed, on each leg.', safety: 'Have a wall or spotter nearby. Don\'t fall.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Tree Pose 60s Eyes Closed (Each Side)', branch: 'Balance', tier: 'TIER_3', prereqs: ['Single-Leg Stand 60s Eyes Closed'], blurb: 'Tree pose with closed eyes — balance + calm.', description: '+8% balance XP', test: { description: '60s tree pose with eyes closed, each side.', safety: 'Same as T3.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '30s Free Handstand (Wall)', branch: 'Balance', tier: 'TIER_4', prereqs: ['Single-Leg Stand 60s'], blurb: 'Wall handstand balance — 30s free balance attempt.', description: '+10% balance XP', test: { description: '30s free handstand (back to wall, light touch for safety).', safety: 'Practice chest-to-wall first. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '60s Free Handstand (Wall)', branch: 'Balance', tier: 'TIER_5', prereqs: ['30s Free Handstand (Wall)'], blurb: '60s wall handstand — strong balance.', description: '+12% balance XP', test: { description: '60s free handstand (back to wall, light touch).', safety: 'Master 30s first. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 60 } } },

  // D. Ignatian Meditation (was 'Mindfulness' — renamed to a
  //    specifically Catholic tradition. Ignatian meditation is the
  //    Jesuit practice of imaginative contemplation on a passage
  //    of scripture: read the scene, place yourself in it,
  //    converse with Christ / a saint in it, take a "colloquy".
  //    Distinct from new-age "meditation" while still being a
  //    stillness + breathing + attention practice. The app
  //    already uses Ignatian themes elsewhere (Examen on
  //    /spiritual), so this keeps the same spiritual register.)
  // T1 5min → T2 10min + T2 20min (two parallel sits). T3 30min
  // requires BOTH T2s (weaving — the user has done both shorter
  // sits before attempting the long one). T3 god-tier 60min
  // requires T3 30min.
  { name: '5min Ignatian Meditation Initiate', branch: 'Ignatian Meditation', tier: 'TIER_1', prereqs: [], blurb: '5 minutes of imaginative contemplation on a short Gospel scene.', description: '+5% meditation XP', test: { description: '5min seated Ignatian meditation: read a short Gospel scene (e.g. a single miracle), place yourself in it, have a brief conversation with Christ in the scene. Eyes can be open or closed.', safety: 'Sit comfortably. Don\'t force visualization. Skip if racing thoughts make it miserable — try again tomorrow.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '10min Ignatian Meditation', branch: 'Ignatian Meditation', tier: 'TIER_2', prereqs: ['5min Ignatian Meditation Initiate'], blurb: '10 minutes — comfortable in the silence.', description: '+5% meditation XP', test: { description: '10min seated Ignatian meditation on a single scene.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '20min Ignatian Meditation', branch: 'Ignatian Meditation', tier: 'TIER_2', prereqs: ['5min Ignatian Meditation Initiate'], blurb: '20 minutes — a real sit.', description: '+8% meditation XP', test: { description: '20min seated Ignatian meditation, working through one scene slowly (movement by movement).', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 1200 } } },
  { name: '30min Ignatian Meditation', branch: 'Ignatian Meditation', tier: 'TIER_3', prereqs: ['10min Ignatian Meditation', '20min Ignatian Meditation'], blurb: '30 minutes — sustained stillness.', description: '+10% meditation XP', test: { description: '30min seated Ignatian meditation, with a 4th movement (the colloquy / conversation with Christ) clearly held throughout.', safety: 'Same as T1. Pick a scene you\'ve used before — familiar material makes the longer sit easier.', metric: 'duration', threshold: { duration_sec: 1800 } } },
  { name: '60min Ignatian Meditation (HRV)', branch: 'Ignatian Meditation', tier: 'TIER_4', prereqs: ['30min Ignatian Meditation'], blurb: '60min Ignatian meditation — the stillness god-tier.', description: '+15% meditation XP', test: { description: '60min seated Ignatian meditation. HRV measured before/after to track the parasympathetic response (sustained HRV rise is the long-sit signature).', safety: 'Same as T1. Long sit is its own practice — work up over weeks, not in one jump.', metric: 'duration', threshold: { duration_sec: 3600 } } },

  // E. Yoga Flows — linear: 5 salutations (T1) → 10 salutations
  // (T2) → A→B 10 cycles (T3) → Modified Ashtanga 1 round (T3) →
  // Modified Ashtanga 3 rounds (T3 god-tier).
  { name: '5 Sun Salutations Initiate', branch: 'Yoga', tier: 'TIER_1', prereqs: [], blurb: 'Sun salutation — the classic vinyasa flow.', description: '+5% yoga XP', test: { description: '5 sun salutations (A or B, your choice).', safety: 'Warm up first. Don\'t push into injuries.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10 Sun Salutations', branch: 'Yoga', tier: 'TIER_2', prereqs: ['5 Sun Salutations Initiate'], blurb: '10 salutations — sustained flow.', description: '+5% yoga XP', test: { description: '10 sun salutations.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'A→B × 10 Cycles', branch: 'Yoga', tier: 'TIER_3', prereqs: ['10 Sun Salutations'], blurb: 'Full salutation sequence — sustained flow.', description: '+8% yoga XP', test: { description: 'A→B sequence × 10 cycles.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Modified Ashtanga × 1 Round', branch: 'Yoga', tier: 'TIER_3', prereqs: ['A→B × 10 Cycles'], blurb: 'Modified Ashtanga — the classical sequence.', description: '+10% yoga XP', test: { description: 'Modified Ashtanga primary series (skip headstand) × 1 round.', safety: 'Strong yoga base first. Skip headstand if not ready. Coach recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Modified Ashtanga × 3 Rounds', branch: 'Yoga', tier: 'TIER_4', prereqs: ['Modified Ashtanga × 1 Round'], blurb: 'Ashtanga god-tier — 3 rounds of the classical sequence.', description: '+15% yoga XP', test: { description: 'ModifiedAshtanga primary series × 3 rounds.', safety: 'Strong yoga base first. Coach / experienced practitioner recommended.', metric: 'reps', threshold: { reps: 3, sides: 'total' } } },

  // F. Pilates — two T1s (crunches + hundreds) feed T2 roll-ups +
  // teasers (core sequence). T2 → T3 30 teaser-outs + T3 45min
  // mat class (god-tier, requires T2).
  { name: '100 Crunches Initiate', branch: 'Pilates', tier: 'TIER_1', prereqs: [], blurb: 'Core endurance baseline.', description: '+5% pilates XP', test: { description: '100 crunches (any style, can be split into sets).', safety: 'Don\'t yank the neck. Keep the lower back engaged.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '100 Hundreds', branch: 'Pilates', tier: 'TIER_1', prereqs: [], blurb: 'The hundreds — the classic Pilates core exercise.', description: '+5% pilates XP', test: { description: '100 hundreds (legs at 45°, arms pumping).', safety: 'Keep lower back pressed to floor. Don\'t strain neck.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '50 Roll-Ups + 50 Teasers', branch: 'Pilates', tier: 'TIER_2', prereqs: ['100 Crunches Initiate', '100 Hundreds'], blurb: 'Roll-ups + teasers — full core sequence.', description: '+8% pilates XP', test: { description: '50 roll-ups + 50 teasers (any style, can be split).', safety: 'Don\'t strain neck. Keep lower back engaged.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '30 Teaser-Outs', branch: 'Pilates', tier: 'TIER_3', prereqs: ['50 Roll-Ups + 50 Teasers'], blurb: 'Teaser-outs — V-sit core endurance.', description: '+10% pilates XP', test: { description: '30 teaser-outs (V-sit, alternating leg drops and raises).', safety: 'Strong core base first. Don\'t strain the lower back.', metric: 'reps', threshold: { reps: 30 } } },
  { name: '45min Mat Class (No Rest)', branch: 'Pilates', tier: 'TIER_3', prereqs: ['50 Roll-Ups + 50 Teasers'], blurb: 'Pilates god-tier — full mat class with no breaks.', description: '+15% pilates XP', test: { description: 'Full mat pilates class, 45 minutes, no rest breaks.', safety: 'Strong pilates base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 2700 } } },
];

const SKILLS_BY_CLASS: Record<string, Spec[]> = {
  JUGGERNAUT: JUGGERNAUT_SKILLS,
  PHANTOM: PHANTOM_SKILLS,
  SCOUT: SCOUT_SKILLS,
  BERSERKER: BERSERKER_SKILLS,
  TRACER: TRACER_SKILLS,
  ORACLE: ORACLE_SKILLS,
};

export async function seedSkills(): Promise<{ upserted: number; deleted: number }> {
  let upserted = 0;
  // Compute prereqs two ways, per skill:
  // Two prereq modes, picked per class:
  //   1. EXPLICIT — the class's seed array declares `prereqs: string[]`
  //      on each skill. Reads as a clean linear chain (with optional
  //      weaving merge points) in the seed file itself. Used by
  //      PHANTOM (calisthenics linear DAG), SCOUT (running/ruck/
  //      triathlon distance/time chains).
  //   2. TIER-BASED (other classes) — fall back to the auto
  //      heuristic: T1 has no prereqs, T2 requires all T1s in the
  //      same class+branch, T3 requires all T2s. Less polished but
  //      functional — slated for the ROADMAP "same fix for other
  //      classes" follow-up.
  //
  // Detection: a class uses explicit mode if any of its skills has
  // the `prereqs` field defined (truthy). T1 entries in explicit
  // mode should declare `prereqs: []` so the detection is
  // consistent — the seed loop reads the field verbatim.
  const prereqsByName = new Map<string, string[]>();
  for (const [className, skills] of Object.entries(SKILLS_BY_CLASS)) {
    const usesExplicit = skills.some((s) => s.prereqs !== undefined);
    if (usesExplicit) {
      for (const s of skills) {
        prereqsByName.set(s.name, s.prereqs ?? []);
      }
      continue;
    }
    // Tier-based heuristic.
    const byBranch = new Map<string, typeof skills>();
    for (const s of skills) {
      if (!byBranch.has(s.branch)) byBranch.set(s.branch, []);
      byBranch.get(s.branch)!.push(s);
    }
    for (const [, group] of byBranch) {
      const t1s = group.filter((s) => s.tier === 'TIER_1').map((s) => s.name);
      const t2s = group.filter((s) => s.tier === 'TIER_2').map((s) => s.name);
      for (const s of group) {
        if (s.tier === 'TIER_1') {
          prereqsByName.set(s.name, []);
        } else if (s.tier === 'TIER_2') {
          prereqsByName.set(s.name, t1s);
        } else {
          // TIER_3
          prereqsByName.set(s.name, t2s);
        }
      }
    }
  }
  for (const [className, skills] of Object.entries(SKILLS_BY_CLASS)) {
    let position = 0;
    for (const s of skills) {
      await prisma.skill.upsert({
        where: { name: s.name },
        create: {
          name: s.name,
          className: className as 'JUGGERNAUT',
          tier: s.tier,
          branch: s.branch,
          blurb: s.blurb,
          description: s.description,
          test: s.test as any,
          // cost is left at the schema default (0). The SP economy
          // is gone; the column is kept for backward compat only.
          prerequisites: prereqsByName.get(s.name) ?? [],
          position: position++,
          effects: { perk: 'in-game', tier: s.tier } as any,
        },
        update: {
          blurb: s.blurb,
          description: s.description,
          test: s.test as any,
          tier: s.tier,
          branch: s.branch,
          className: className as 'JUGGERNAUT',
          // Re-write prereqs on every upsert so re-seeding picks up
          // any future changes to the prereq structure. (The create
          // block also sets them; both run on insert, only update
          // runs on conflict.)
          prerequisites: prereqsByName.get(s.name) ?? [],
        },
      });
      upserted++;
    }
  }
  // Sweep orphaned Skill rows. When a skill is renamed or its
  // branch moves to a different slot (e.g. the Berserker Hero
  // WODs branch being merged into Capacity), the old row stays
  // in the DB unless we explicitly drop it. Without this sweep,
  // a rename would leave a duplicate (old name still in the tree,
  // new name added) and a branch drop would leave a ghost
  // branch in the UI. We only delete names that don't exist in
  // ANY of the 6 class specs — so a skill moved from BERSERKER
  // to PHANTOM wouldn't be dropped. UserSkill / progress rows
  // cascade via FK ON DELETE CASCADE.
  const validNames = new Set<string>();
  for (const skills of Object.values(SKILLS_BY_CLASS)) {
    for (const s of skills) validNames.add(s.name);
  }
  const existing = await prisma.skill.findMany({ select: { name: true } });
  const toDelete = existing.filter((row) => !validNames.has(row.name)).map((row) => row.name);
  if (toDelete.length > 0) {
    await prisma.skill.deleteMany({ where: { name: { in: toDelete } } });
  }
  return { upserted, deleted: toDelete.length };
}
