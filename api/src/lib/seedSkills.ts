/**
 * Skill tree v1 — full data for all 196 skills across 6 classes.
 *
 * Tree structure (from the design conversation with Josh):
 *   JUGGERNAUT  — 6 branches × 5-7 tiers = 39 skills
 *   PHANTOM     — 6 branches × 7 tiers  = 42 skills
 *   SCOUT       — 3 branches × 5-9 tiers = 20 skills
 *   BERSERKER   — 7 branches × 4-7 tiers = 34 skills (incl. mace)
 *   TRACER      — 5 branches × 4-6 tiers = 27 skills
 *   ORACLE      — 6 branches × 5-7 tiers = 34 skills
 *   TOTAL = 196
 *
 * Each skill has:
 *   - blurb: "What is this skill / why does it matter?"
 *   - description: short in-game perk summary (gold multiplier etc.)
 *   - test: { description, safety, metric, threshold } — used by
 *     the unlock endpoint to validate the user's submitted result
 *
 * Re-seeding is idempotent (upsert by skill name). Existing data
 * with null blurb / null test still works — the unlock endpoint
 * falls back to the SP-cost check when test is missing.
 *
 * The structure mirrors api/src/lib/skillTest.ts's validators —
 * if you add a new metric type, add a case there AND a way to
 * fill it in the seed below.
 */

import { prisma } from './prisma.js';

// ---- Test spec shape (mirrors lib/skillTest.ts) ----
type Spec = {
  name: string;
  branch: string;
  blurb: string;
  description: string; // in-game perk summary
  tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
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
    };
  };
};

// ---- 1. JUGGERNAUT (heavy + strongman) — 39 skills ----
const JUGGERNAUT_SKILLS: Spec[] = [
  // A. Squat
  { name: 'Half-Squat Initiate', branch: 'Squat', tier: 'TIER_1', blurb: 'Build the squat pattern with light load before going heavy.', description: '+5% squat volume XP', test: { description: '5 reps at half your bodyweight, full depth to parallel. Bar on upper traps, neutral spine, knees track over toes.', safety: 'Warm up with bodyweight squats first. Don\'t let knees cave in.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Bodyweight Squat', branch: 'Squat', tier: 'TIER_1', blurb: 'Unweighted squat at full depth.', description: '+5% squat frequency XP', test: { description: '5 reps at bodyweight, full depth (hip crease below knee). Brace core, neutral spine, controlled eccentric (3s descent).', safety: 'Knees stay aligned over toes. Heels stay grounded.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Squat 1.25×BW', branch: 'Squat', tier: 'TIER_2', blurb: 'Intermediate-end novice squat milestone.', description: '+5% squat XP', test: { description: '5 reps at 1.25× bodyweight, full depth. Same form as T2.', safety: 'Use safety pins set 1-2" below your chest in a rack.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'Squat 1.5×BW Pause', branch: 'Squat', tier: 'TIER_2', blurb: 'First true strength milestone — heavy single with proper pause.', description: '+5% squat 1RM tracking', test: { description: '1 rep at 1.5× bodyweight, full depth, 3-second pause at the bottom. Drive up smoothly.', safety: 'Safety pins mandatory. Have a spotter for the unrack.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Squat 5×1.5×BW', branch: 'Squat', tier: 'TIER_3', blurb: 'Volume at intermediate-end load.', description: '+8% squat work XP', test: { description: '5 reps at 1.5× bodyweight, 2s pause at the bottom each rep. Controlled tempo throughout.', safety: 'Use safety pins. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Squat 2×BW Single', branch: 'Squat', tier: 'TIER_3', blurb: 'Advanced — heavy single-rep squat.', description: '+10% squat 1RM XP', test: { description: '1 rep at 2× bodyweight, full depth, controlled descent + ascent. Pause briefly at the bottom.', safety: 'Safety pins set 1" below your depth. Have spotters.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.0 } } },
  { name: 'Squat 5×2×BW', branch: 'Squat', tier: 'TIER_3', blurb: 'Advanced work-set at 2× bodyweight — small percentages-of-lifters territory.', description: '+12% squat 1RM tracking', test: { description: '5 reps at 2× bodyweight, full depth, controlled tempo. 2s pause at the bottom each rep.', safety: 'Safety pins mandatory. Have at least one spotter.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 2.0 } } },

  // B. Bench Press
  { name: 'Half-Bench Initiate', branch: 'Press', tier: 'TIER_1', blurb: 'Bench pattern with light load — arch, leg drive, bar path.', description: '+5% bench volume XP', test: { description: '5 reps at half bodyweight, bar to lower chest. Slight arch, leg drive, bar path: lower to chest, drive up and slightly back.', safety: 'Use safety pins set 1-2" above your chest.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Bench 0.75×BW', branch: 'Press', tier: 'TIER_1', blurb: 'Beginner-end bench volume.', description: '+5% bench XP', test: { description: '5 reps at 0.75× bodyweight, controlled eccentric, full ROM to lower chest.', safety: 'Use safety pins + spotter if available.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'Bench 1×BW', branch: 'Press', tier: 'TIER_2', blurb: 'Bodyweight bench press — the bodyweight milestone for most lifters.', description: '+5% bench XP', test: { description: '5 reps at 1× bodyweight, full ROM. Touch chest lightly, drive up and back.', safety: 'Safety pins set 1" above your chest. Spotter recommended.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'Bench 1.25×BW Strict', branch: 'Press', tier: 'TIER_2', blurb: 'Intermediate-end bench strict form.', description: '+5% bench 1RM tracking', test: { description: '1 rep at 1.25× bodyweight, strict form (full ROM, controlled eccentric, paused at the chest).', safety: 'Spotter + safety pins mandatory.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'Bench 1.5×BW Strict', branch: 'Press', tier: 'TIER_3', blurb: 'Advanced bench — competitive lifter territory.', description: '+8% bench 1RM tracking', test: { description: '1 rep at 1.5× bodyweight, strict form. Pause at the chest, full ROM.', safety: 'Spotter + safety pins mandatory.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Bench 1.75×BW Strict', branch: 'Press', tier: 'TIER_3', blurb: 'Elite bench — competitive powerlifter.', description: '+10% bench 1RM tracking', test: { description: '1 rep at 1.75× bodyweight, strict form. Pause at the chest.', safety: 'Spotters + safety pins. Only attempt after a successful 1.5×BW max.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.75 } } },
  { name: 'Bench 3×1.25×BW Strict', branch: 'Press', tier: 'TIER_3', blurb: 'Work capacity at advanced load — bench god-tier work set.', description: '+12% bench 1RM tracking', test: { description: '3 reps at 1.25× bodyweight, strict form. Full ROM, controlled tempo.', safety: 'Spotter + safety pins. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 1.25 } } },

  // C. Deadlift
  { name: 'DL 0.75×BW Conventional', branch: 'Deadlift', tier: 'TIER_1', blurb: 'Beginner conventional deadlift volume.', description: '+5% DL volume XP', test: { description: '5 reps at 0.75× bodyweight, conventional stance, neutral spine, controlled eccentric.', safety: 'Brace HARD. Use mixed grip if grip is limiting.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'DL 1.25×BW Conventional', branch: 'Deadlift', tier: 'TIER_1', blurb: 'Beginner-end deadlift — first real weight milestone.', description: '+5% DL XP', test: { description: '5 reps at 1.25× bodyweight, conventional. Brace before the pull. Neutral spine throughout.', safety: 'Use mixed grip or straps if grip is limiting.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.25 } } },
  { name: 'DL 1.5×BW Conventional', branch: 'Deadlift', tier: 'TIER_2', blurb: 'Intermediate novice deadlift — bodyweight deadlift is the Starting Strength endgame for many lifters.', description: '+5% DL XP', test: { description: '5 reps at 1.5× bodyweight, conventional. Brace, hinge, drive through heels. Neutral spine throughout.', safety: 'Use lifting belt if you have one. Strap in or chalk up for grip.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'DL 2×BW Conventional', branch: 'Deadlift', tier: 'TIER_2', blurb: 'Intermediate-end single — strong lift.', description: '+5% DL 1RM tracking', test: { description: '1 rep at 2× bodyweight, conventional stance. Brace before the pull. Neutral spine, lockout at the top.', safety: 'Use a belt. Have a spotter in case of grip failure.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.0 } } },
  { name: 'DL 2.25×BW Conventional', branch: 'Deadlift', tier: 'TIER_3', blurb: 'Advanced single — strong lifter.', description: '+8% DL 1RM tracking', test: { description: '1 rep at 2.25× bodyweight, conventional. Brace HARD, neutral spine, lockout.', safety: 'Belt + spotter. Straps or hook grip if needed.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.25 } } },
  { name: 'DL 2.5×BW Conventional', branch: 'Deadlift', tier: 'TIER_3', blurb: 'Elite single — competitive powerlifter territory.', description: '+10% DL 1RM tracking', test: { description: '1 rep at 2.5× bodyweight, conventional. Brace HARD. Lockout cleanly.', safety: 'Belt + spotter. Use hook grip if you have it.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 2.5 } } },
  { name: 'DL 3×2×BW Conventional', branch: 'Deadlift', tier: 'TIER_3', blurb: 'Work capacity at advanced load — DL god-tier work set.', description: '+12% DL 1RM tracking', test: { description: '3 reps at 2× bodyweight, conventional. Brace each rep. Neutral spine throughout.', safety: 'Belt + spotter mandatory. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 2.0 } } },

  // D. Overhead Press
  { name: 'OHP 30% BW Initiate', branch: 'Overhead Press', tier: 'TIER_1', blurb: 'Beginner overhead press pattern.', description: '+5% OHP volume XP', test: { description: '5 reps at 30% bodyweight overhead press. Brace core. Press in a straight line, head through at the top.', safety: 'Don\'t flare ribs. Keep core tight.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.3 } } },
  { name: 'OHP 50% BW', branch: 'Overhead Press', tier: 'TIER_1', blurb: 'Beginner-end press volume.', description: '+5% OHP XP', test: { description: '5 reps at 50% bodyweight overhead press, strict form.', safety: 'Brace core. Don\'t lean back excessively.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'OHP 0.75×BW Strict', branch: 'Overhead Press', tier: 'TIER_2', blurb: 'Intermediate-end press strict form.', description: '+5% OHP 1RM tracking', test: { description: '5 reps at 0.75× bodyweight, strict overhead press. Brace core, head through at the top.', safety: 'Brace core hard. Don\'t lean back excessively.', metric: 'weight:reps', threshold: { reps: 5, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'OHP 0.75×BW Strict Single', branch: 'Overhead Press', tier: 'TIER_2', blurb: 'Strict single at intermediate load.', description: '+5% OHP 1RM tracking', test: { description: '1 rep at 0.75× bodyweight, strict form.', safety: 'Brace core. Use safety bars or a spotter.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 0.75 } } },
  { name: 'OHP 1×BW Strict', branch: 'Overhead Press', tier: 'TIER_3', blurb: 'The holy grail of pressing — bodyweight strict press.', description: '+15% OHP 1RM tracking', test: { description: '1 rep at bodyweight, strict form. Brace core HARD, head through at the top.', safety: 'Brace core. Use safety bars or spotter.', metric: 'weight:reps', threshold: { reps: 1, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'OHP 3×0.75×BW Strict', branch: 'Overhead Press', tier: 'TIER_3', blurb: 'Work capacity at intermediate-end press.', description: '+12% OHP 1RM tracking', test: { description: '3 reps at 0.75× bodyweight, strict form. Brace each rep. Head through at the top.', safety: 'Brace core. Stop if technique breaks.', metric: 'weight:reps', threshold: { reps: 3, weight_kg_mult_of_bw: 0.75 } } },

  // E. Strongman
  { name: 'Farmer Walk 50m', branch: 'Strongman', tier: 'TIER_1', blurb: 'Loaded carry — grip + core + posture.', description: '+5% carry XP', test: { description: '50m farmer walk at 0.5× bodyweight per hand. Stand tall, slow controlled steps. Don\'t lean.', safety: 'Use a flat surface. Wear flat shoes. Chalk or use straps if grip is limiting.', metric: 'weight:reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Yoke Walk 20m', branch: 'Strongman', tier: 'TIER_2', blurb: 'Heavy yoke carry — pure back + core.', description: '+8% carry XP', test: { description: '20m yoke walk at 1.5× bodyweight. Walk slowly, stand tall, breathe.', safety: 'Use a flat surface. Wear a belt if you have one.', metric: 'reps', threshold: { reps: 20, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Atlas Stones 5 in 60s', branch: 'Strongman', tier: 'TIER_2', blurb: 'Loading event — multiple stone lifts to platform.', description: '+8% strongman XP', test: { description: '5 atlas stones to a 48" platform in under 60 seconds. Use tacky. Lap each stone.', safety: 'Use proper lifting form. Tacky or chalk for grip. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Atlas 100ft @ 1×BW', branch: 'Strongman', tier: 'TIER_3', blurb: 'Strongman loading event at bodyweight — long carry, multiple stones.', description: '+10% strongman XP', test: { description: '100ft atlas-stone carry at 1× bodyweight total. Multiple stones, lap them as needed.', safety: 'Use proper form. Tacky + belt. Spotter for transitions.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 1.0 } } },
  { name: 'Husafell 50m @ 1.5×BW', branch: 'Strongman', tier: 'TIER_3', blurb: 'The iconic — circular yoke walk with stones.', description: '+12% strongman XP', test: { description: '50m circular walk with 1.5×BW total weight (per hand 0.75×BW). Use the stones, walk the circle, transition smoothly.', safety: 'Practice lighter loads first. Tacky + belt.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 1.5 } } },
  { name: 'Atlas 200ft @ 1×BW', branch: 'Strongman', tier: 'TIER_3', blurb: 'Strongman god-tier — long loading carry at bodyweight.', description: '+15% strongman XP', test: { description: '200ft atlas-stone carry at 1× bodyweight total. Multiple stones, plan transitions.', safety: 'Practice shorter distances first. Belt + tacky + spotter.', metric: 'reps', threshold: { reps: 200, weight_kg_mult_of_bw: 1.0 } } },

  // F. Sled (strongman variety — disambiguated from BERSERKER's
  // prowler-sled branch by the (Strongman) infix so the upsert-by-name
  // seed doesn't collapse the two class-specific trees into one).
  { name: 'Sled (Strongman) Push 25m', branch: 'Sled', tier: 'TIER_1', blurb: 'Light sled work — horizontal push introduction.', description: '+5% sled XP', test: { description: 'Push a sled 25m at 0.25× bodyweight. Bend at the waist, drive through the legs, don\'t hyperextend at the top.', safety: 'Flat surface, good shoes. Don\'t lock the knees at the top.', metric: 'reps', threshold: { reps: 25, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled (Strongman) Push 50m', branch: 'Sled', tier: 'TIER_1', blurb: 'Volume at light load.', description: '+5% sled XP', test: { description: 'Push 50m at 0.25× bodyweight. Same form as T1.', safety: 'Flat surface, good shoes.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled (Strongman) Push 100m @ 50%BW', branch: 'Sled', tier: 'TIER_2', blurb: 'Distance at half bodyweight.', description: '+8% sled XP', test: { description: 'Push 100m at 0.5× bodyweight. Drive through legs, controlled pace.', safety: 'Flat surface. Wear good shoes for grip.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Sled (Strongman) 1mi @ 50%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'A mile of heavy sled — pure grit.', description: '+10% sled XP', test: { description: 'Push a sled 1 mile at 0.5× bodyweight in under 8 minutes. Steady pace, drive through the legs.', safety: 'Flat surface. Don\'t grip too hard — use the harness.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled (Strongman) 1mi @ 75%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'Three-quarter bodyweight mile.', description: '+12% sled XP', test: { description: 'Push 1 mile at 0.75× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lighter loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled (Strongman) 1mi @ 100%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'Bodyweight mile — strongman crossfit benchmark.', description: '+15% sled XP', test: { description: 'Push 1 mile at bodyweight in under 8 minutes. Strongman-class feat.', safety: 'Flat surface. Practice lower loads first. Spotter / coach nearby.', metric: 'duration', threshold: { duration_sec: 480 } } },
];

// ---- 2. PHANTOM (calisthenics + gymnastics) — 42 skills ----
const PHANTOM_SKILLS: Spec[] = [
  // A. Push (horizontal pressing)
  { name: 'Incline Push-Up Initiate', branch: 'Push', tier: 'TIER_1', blurb: 'Easier-than-wall push-up — start here.', description: '+5% push-up volume XP', test: { description: '5 incline push-ups (hands on a 12"+" surface, body straight, full ROM).', safety: 'Keep elbows tracked. Don\'t shrug shoulders.', metric: 'reps', threshold: { reps: 5 } } },
  { name: 'Standard Push-Up 20', branch: 'Push', tier: 'TIER_2', blurb: 'Bodyweight push-up milestone — 20 in a row.', description: '+5% push-up XP', test: { description: '20 standard push-ups in a row, full ROM (chest within a fist of the floor).', safety: 'Lower slowly (3-4s eccentric). Don\'t flare elbows past 75°.', metric: 'reps', threshold: { reps: 20 } } },
  { name: 'Archer Push-Up', branch: 'Push', tier: 'TIER_2', blurb: 'Asymmetric push-up — first step toward one-arm work.', description: '+5% push-up XP', test: { description: '5 archer push-ups on each side. Most weight stays on one arm, the other extends out for balance.', safety: 'Warm up with regular push-ups first. Don\'t shrug.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'One-Arm Push-Up (knee)', branch: 'Push', tier: 'TIER_3', blurb: 'One-arm push-up with knee assist — building the path to freestanding.', description: '+10% push-up XP', test: { description: '5 one-arm push-ups on each side, with the off hand on the knee. Full ROM, controlled.', safety: 'Master archer PU first. Use a wider stance for balance.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'One-Arm Push-Up (no knee)', branch: 'Push', tier: 'TIER_3', blurb: 'Freestanding one-arm push-up — pure horizontal pressing strength.', description: '+12% push-up XP', test: { description: '5 one-arm push-ups on each side, no knee assist. Full ROM, body stays rigid.', safety: 'Warm up with archer PU first. Stop if shoulder pain.', metric: 'reps', threshold: { reps: 5, sides: 'each' } } },
  { name: 'Weighted 1-Arm PU 25% BW', branch: 'Push', tier: 'TIER_3', blurb: 'First weighted push-up — strong horizontal pressing.', description: '+15% push-up 1RM tracking', test: { description: '5 weighted one-arm push-ups on each side, with 25% bodyweight added (vest or plate on back).', safety: 'Master unweighted 1-arm PU first. Use a vest or plate placement that doesn\'t shift during the rep.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.25, sides: 'each' } } },
  { name: 'Weighted 1-Arm PU 50% BW', branch: 'Push', tier: 'TIER_3', blurb: 'Horizontal pressing god-tier — 1-arm PU with bodyweight added.', description: '+20% push-up 1RM tracking', test: { description: '5 weighted one-arm push-ups on each side, with 50% bodyweight added.', safety: 'Strong unweighted 1-arm PU + 25% weighted first. Use a spotter for safety.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.5, sides: 'each' } } },

  // B. Pull (vertical pulling)
  { name: 'Dead Hang 30s Initiate', branch: 'Pull', tier: 'TIER_1', blurb: 'Just hanging — grip + shoulder stability.', description: '+5% pull-up XP', test: { description: '30s dead hang from a pull-up bar. Active shoulders (don\'t shrug).', safety: 'Don\'t kip. Use a bar you can reach comfortably.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '1 Strict Pull-Up', branch: 'Pull', tier: 'TIER_1', blurb: 'The first strict pull-up — bodyweight pulling.', description: '+10% pull-up XP', test: { description: '1 strict pull-up (full ROM, no kip). Engage lats, drive elbows down.', safety: 'Don\'t kip. Don\'t shrug at the top.', metric: 'reps', threshold: { reps: 1 } } },
  { name: '5 Strict Pull-Ups', branch: 'Pull', tier: 'TIER_2', blurb: '5 strict pull-ups in a row.', description: '+10% pull-up XP', test: { description: '5 strict pull-ups in a row, full ROM, controlled eccentric each rep.', safety: 'Don\'t kip. Don\'t shrug. Don\'t drop fast.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10 Pull-Ups in a Row', branch: 'Pull', tier: 'TIER_3', blurb: 'Bodyweight pulling volume — solid intermediate.', description: '+10% pull-up XP', test: { description: '10 strict pull-ups in a row. No kip, full ROM.', safety: 'Don\'t kip. Don\'t shrug.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Weighted Pull-Up 25% BW', branch: 'Pull', tier: 'TIER_3', blurb: 'First weighted pull-up — strong pulling.', description: '+15% pull-up XP', test: { description: '5 weighted pull-ups at 25% bodyweight added (vest or belt). Strict form.', safety: 'Master 10 BW pull-ups first. Use a belt/vest, not dumbbell between legs.', metric: 'weighted:reps:each', threshold: { reps: 5, weight_kg_mult_of_bw: 0.25, sides: 'each' } } },
  { name: 'High Pull-Up to Waist', branch: 'Pull', tier: 'TIER_3', blurb: 'Explosive pulling — bar to waist, not chest.', description: '+12% pull-up XP', test: { description: '5 high pull-ups to waist at bodyweight. Bar comes to the navel/waist, full explosive hip drive.', safety: 'Master BW pull-ups first. Don\'t shrug — keep lats engaged.', metric: 'reps', threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 } } },
  { name: '3 Muscle-Ups', branch: 'Pull', tier: 'TIER_3', blurb: 'Pulling god-tier — the muscle-up is the peak of bodyweight pulling.', description: '+20% pull-up XP', test: { description: '3 muscle-ups in a row. False grip. Strong explosive pull + smooth transition over the bar.', safety: 'Master weighted BW pull-ups first. Use a band for assistance if needed. Spotter nearby.', metric: 'reps', threshold: { reps: 3 } } },

  // C. Holds (static)
  { name: '30s Plank Initiate', branch: 'Holds', tier: 'TIER_1', blurb: 'Core stability — every calisthenics foundation.', description: '+5% core XP', test: { description: '30s plank. Tuck pelvis, brace core, neutral spine.', safety: 'Don\'t sag hips. Don\'t pike up.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '60s Plank', branch: 'Holds', tier: 'TIER_2', blurb: 'Bodyweight plank milestone.', description: '+5% core XP', test: { description: '60s plank, same form as T1.', safety: 'Don\'t sag hips.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '10s L-Sit Initiate', branch: 'Holds', tier: 'TIER_2', blurb: 'Static core + hip flexor — gateway to advanced holds.', description: '+8% core XP', test: { description: '10s L-sit (legs straight, parallel to floor, arms straight).', safety: 'Warm up with planks first. Don\'t shrug shoulders.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '30s L-Sit', branch: 'Holds', tier: 'TIER_3', blurb: 'Core + hip flexor endurance.', description: '+10% core XP', test: { description: '30s L-sit. Legs straight, parallel to floor.', safety: 'Don\'t shrug shoulders. Warm up first.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s V-Sit', branch: 'Holds', tier: 'TIER_3', blurb: 'V-sit (legs together) — harder than L-sit.', description: '+12% core XP', test: { description: '30s V-sit (legs together, straight, parallel to floor).', safety: 'Master 30s L-sit first. Don\'t shrug.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '10s Straddle L', branch: 'Holds', tier: 'TIER_3', blurb: 'Straddle L-sit — advanced hold.', description: '+12% core XP', test: { description: '10s straddle L (legs spread wide, straight, parallel to floor).', safety: 'Master V-sit first. Stretch hip adductors before testing.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Front Lever', branch: 'Holds', tier: 'TIER_3', blurb: 'Holds god-tier — the front lever is the king of static holds.', description: '+20% core XP', test: { description: '5s front lever hold (body horizontal, arms straight, pulling from shoulders).', safety: 'Master multiple L-sits + pull-ups first. Warm up thoroughly. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // D. Rings
  { name: 'Rings Dead Hang 30s', branch: 'Rings', tier: 'TIER_1', blurb: 'Rings grip + shoulder stability.', description: '+5% rings XP', test: { description: '30s rings dead hang. Active shoulders.', safety: 'Don\'t kip. Use a bar you can reach.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Rings Support 5s', branch: 'Rings', tier: 'TIER_1', blurb: 'Hold at the top of a dip — shoulder stability.', description: '+5% rings XP', test: { description: '5s rings support hold (top of rings dip, arms straight, body locked out).', safety: 'Use a band for assistance if needed.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5 Ring Rows', branch: 'Rings', tier: 'TIER_2', blurb: 'Rings horizontal pull — the foundation of rings work.', description: '+5% rings XP', test: { description: '5 ring rows. Pull chest to ring level. Squeeze shoulder blades.', safety: 'Use a band for assistance if needed. Keep wrists stacked.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Ring Dips', branch: 'Rings', tier: 'TIER_2', blurb: 'Rings vertical push — chest and triceps.', description: '+5% rings XP', test: { description: '5 ring dips. Full ROM, lockout at the top.', safety: 'Use a band for assistance if needed. Don\'t shrug.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Ring Muscle-Ups', branch: 'Rings', tier: 'TIER_3', blurb: 'Rings muscle-up — the rings-specific version.', description: '+12% rings XP', test: { description: '5 ring muscle-ups in a row. False grip. Strong transition.', safety: 'Use a band for assistance if needed. Spotter for first attempts.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10s L-Sit on Rings', branch: 'Rings', tier: 'TIER_3', blurb: 'Rings core + hip flexor on unstable surface.', description: '+12% rings XP', test: { description: '10s L-sit on rings (legs straight, parallel to floor).', safety: 'Master floor L-sit first. Have a spotter nearby for safety.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '3s Iron Cross', branch: 'Rings', tier: 'TIER_3', blurb: 'Rings god-tier — the iron cross is the most iconic rings skill of all.', description: '+25% rings XP', test: { description: '3s iron cross support (arms straight out to the sides, body horizontal).', safety: 'Master rings support + dips first. Work up to this over months. Spotter + band for safety. Stop immediately if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 3 } } },

  // E. Handstand
  { name: '5 Pike Push-Ups Initiate', branch: 'Handstand', tier: 'TIER_1', blurb: 'Pressing with a downward-dog pike — gateway to handstand work.', description: '+5% handstand XP', test: { description: '5 pike push-ups (hips piked, body in an inverted V, hands on floor, push-ups).', safety: 'Don\'t flare ribs. Keep core tight.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Elevated Pike PU', branch: 'Handstand', tier: 'TIER_1', blurb: 'Easier handstand prep — feet on a chair.', description: '+5% handstand XP', test: { description: '5 elevated pike push-ups (feet on a chair, hands on floor, hips piked, push-ups).', safety: 'Same as pike PU. Don\'t flare ribs.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '5 Wall HSPUs', branch: 'Handstand', tier: 'TIER_2', blurb: 'Handstand push-ups against a wall — the first true vertical pressing.', description: '+8% handstand XP', test: { description: '5 wall handstand push-ups (back to wall, hands on floor, HSPUs).', safety: 'Practice chest-to-wall HS first. Bail by rolling out, not jumping.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10s Free Handstand', branch: 'Handstand', tier: 'TIER_2', blurb: 'Freestanding balance — the goal of HS training.', description: '+10% handstand XP', test: { description: '10s freestanding handstand. Stack joints, use finger-tip control, engage lats and glutes.', safety: 'Practice against a wall first. Have a spotter. Bail by rolling out.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5 Free HSPUs', branch: 'Handstand', tier: 'TIER_3', blurb: 'Freestanding handstand push-ups — vertical pressing balance.', description: '+12% handstand XP', test: { description: '5 freestanding HSPUs. Full ROM, controlled.', safety: 'Master 30s free HS first. Bail safely.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '30s Free Handstand', branch: 'Handstand', tier: 'TIER_3', blurb: '30 seconds of free balance — the handstand benchmark.', description: '+12% handstand XP', test: { description: '30s freestanding handstand. Engage lats, glutes, use finger-tip control.', safety: 'Practice with shorter holds first. Have a spotter.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '1 Strict Free HSPU 5s', branch: 'Handstand', tier: 'TIER_3', blurb: 'Vertical pressing god-tier — strict free HSPU hold.', description: '+20% handstand XP', test: { description: '1 strict freestanding handstand push-up, held 5 seconds at the top of the rep.', safety: 'Master free HSPUs first. Bail by rolling out. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 5 } } },

  // F. Planche
  { name: 'Plank Foundation 30s', branch: 'Planche', tier: 'TIER_1', blurb: 'Plank — the foundation for all planche work.', description: '+5% planche XP', test: { description: '30s plank. Tuck pelvis, brace core.', safety: 'Don\'t sag hips. Don\'t pike up.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '10s Pseudo-Planche Lean', branch: 'Planche', tier: 'TIER_2', blurb: 'Hands at hips, lean forward — planche intro.', description: '+5% planche XP', test: { description: '10s pseudo-planche lean (hands at hips, lean forward until shoulders are over wrists).', safety: 'Master 60s plank first. Stretch shoulders before testing.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Tuck Planche', branch: 'Planche', tier: 'TIER_2', blurb: 'Tuck planche — first real planche progression.', description: '+10% planche XP', test: { description: '5s tuck planche (knees to chest, body horizontal, arms straight).', safety: 'Master pseudo-planche lean first. Stretch shoulders thoroughly. Stop if shoulder/elbow pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '10s Tuck Planche', branch: 'Planche', tier: 'TIER_3', blurb: 'Solid tuck planche — the first real planche level.', description: '+10% planche XP', test: { description: '10s tuck planche. Body horizontal, knees tight to chest.', safety: 'Master 5s first. Stretch shoulders. Stop if pain.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: '5s Advanced Tuck Planche', branch: 'Planche', tier: 'TIER_3', blurb: 'Advanced tuck — one step from straddle.', description: '+12% planche XP', test: { description: '5s advanced tuck planche (knees away from chest, more horizontal).', safety: 'Master 10s tuck first. Stretch shoulders thoroughly. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5s Straddle Planche', branch: 'Planche', tier: 'TIER_3', blurb: 'Straddle planche — hardcore horizontal pushing.', description: '+15% planche XP', test: { description: '5s straddle planche (legs straight, spread wide, body horizontal).', safety: 'Master adv tuck first. Stretch hamstrings and shoulders. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5s Full Planche', branch: 'Planche', tier: 'TIER_3', blurb: 'Planche god-tier — the king of horizontal pushing.', description: '+25% planche XP', test: { description: '5s full planche (body horizontal, arms straight, legs together).', safety: 'Master straddle first. This is the hardest move in calisthenics — train for months. Spotter nearby. Stop if pain.', metric: 'duration', threshold: { duration_sec: 5 } } },
];

// ---- 3. SCOUT (endurance) — 20 skills ----
const SCOUT_SKILLS: Spec[] = [
  // A. Run
  { name: '1 Mile < 10:00', branch: 'Run', tier: 'TIER_1', blurb: 'Bodyweight running baseline.', description: '+5% run XP', test: { description: '1 mile (1.6km) in under 10 minutes. Steady pace, conversational breathing.', safety: 'Build up to 1 mile gradually. Stay hydrated.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '5K < 35:00', branch: 'Run', tier: 'TIER_1', blurb: 'First 5K milestone.', description: '+5% 5K XP', test: { description: '5K in under 35 minutes. Steady pace.', safety: 'Build up to 5K over weeks. Hydrate. Stop if chest pain.', metric: 'duration', threshold: { duration_sec: 2100 } } },
  { name: '5K < 25:00', branch: 'Run', tier: 'TIER_2', blurb: '5K sub-25 — first real running milestone.', description: '+5% 5K XP', test: { description: '5K in under 25 minutes. Steady pace, negative split optional.', safety: 'Build a base of 5K < 35 first. Hydrate.', metric: 'duration', threshold: { duration_sec: 1500 } } },
  { name: '10K < 55:00', branch: 'Run', tier: 'TIER_2', blurb: '10K milestone — first hour-long run.', description: '+5% 10K XP', test: { description: '10K in under 55 minutes.', safety: 'Build up to 10K over weeks. Hydrate + electrolytes.', metric: 'duration', threshold: { duration_sec: 3300 } } },
  { name: '10K < 45:00', branch: 'Run', tier: 'TIER_3', blurb: '10K sub-45.', description: '+8% 10K XP', test: { description: '10K in under 45 minutes.', safety: 'Build up to 10K < 55 first.', metric: 'duration', threshold: { duration_sec: 2700 } } },
  { name: 'Half Marathon < 2:00:00', branch: 'Run', tier: 'TIER_3', blurb: 'Half marathon sub-2 — intermediate-end.', description: '+10% HM XP', test: { description: 'Half marathon in under 2:00:00.', safety: 'Build base of 25+mpw first. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 7200 } } },
  { name: 'Marathon < 4:30:00', branch: 'Run', tier: 'TIER_3', blurb: 'First marathon under 4:30.', description: '+12% M XP', test: { description: 'Marathon in under 4:30:00.', safety: 'Long build (12+ weeks). Carb-load. Hydrate + fuel heavily. Practice pacing.', metric: 'duration', threshold: { duration_sec: 16200 } } },
  { name: 'Marathon < 3:30:00', branch: 'Run', tier: 'TIER_3', blurb: 'Marathon sub-3:30.', description: '+15% M XP', test: { description: 'Marathon in under 3:30:00.', safety: 'Long build (16+ weeks). Carb-load. Hydrate + fuel heavily.', metric: 'duration', threshold: { duration_sec: 12600 } } },
  { name: 'Marathon < 3:00:00', branch: 'Run', tier: 'TIER_3', blurb: 'Marathon sub-3 — competitive amateur territory.', description: '+20% M XP', test: { description: 'Marathon in under 3:00:00.', safety: 'Long build (20+ weeks). Carb-load. Hydrate + fuel heavily. Pacing is critical. Coach recommended.', metric: 'duration', threshold: { duration_sec: 10800 } } },

  // B. Ruck
  { name: '5K Ruck @ 8kg < 50:00', branch: 'Ruck', tier: 'TIER_1', blurb: 'Loaded walk — base of rucking.', description: '+5% ruck XP', test: { description: '5K walk with 8kg pack in under 50 minutes.', safety: 'Use a comfortable pack. Wear broken-in shoes.', metric: 'duration', threshold: { duration_sec: 3000 } } },
  { name: '10K Ruck @ 12kg < 1:30', branch: 'Ruck', tier: 'TIER_2', blurb: 'Longer ruck with more weight.', description: '+5% ruck XP', test: { description: '10K ruck with 12kg pack in under 1:30:00.', safety: 'Build up ruck time + weight gradually.', metric: 'duration', threshold: { duration_sec: 5400 } } },
  { name: 'Half Marathon Ruck @ 15kg < 3:00', branch: 'Ruck', tier: 'TIER_3', blurb: 'Long-distance ruck at intermediate weight.', description: '+8% ruck XP', test: { description: 'Half marathon ruck with 15kg pack in under 3:00:00.', safety: 'Build up to long rucks gradually. Hydrate heavily.', metric: 'duration', threshold: { duration_sec: 10800 } } },
  { name: '30K Ruck @ 20kg < 4:00', branch: 'Ruck', tier: 'TIER_3', blurb: 'Long ruck at heavier weight.', description: '+10% ruck XP', test: { description: '30K ruck with 20kg pack in under 4:00:00.', safety: 'Build up to long rucks at heavy loads. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 14400 } } },
  { name: '50K Ruck @ 20kg < 7:00', branch: 'Ruck', tier: 'TIER_3', blurb: 'Ruck god-tier — 50K at heavy weight.', description: '+15% ruck XP', test: { description: '50K ruck with 20kg pack in under 7:00:00.', safety: 'Long build. Carb-load. Hydrate + fuel. Spotter / team recommended.', metric: 'duration', threshold: { duration_sec: 25200 } } },

  // C. Triathlon
  { name: 'Sprint Tri (any time)', branch: 'Triathlon', tier: 'TIER_1', blurb: 'First tri — short format, accessible entry.', description: '+5% tri XP', test: { description: 'Sprint triathlon (750m swim + 20km bike + 5km run) in any time.', safety: 'Train each discipline separately first. Wetsuit if water is cold.', metric: 'reps', threshold: { reps: 1 } } },
  { name: 'Sprint Tri < 1:30:00', branch: 'Triathlon', tier: 'TIER_1', blurb: 'First sub-1:30 sprint tri.', description: '+5% tri XP', test: { description: 'Sprint triathlon in under 1:30:00.', safety: 'Practice transitions. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 5400 } } },
  { name: 'Olympic Tri (any time)', branch: 'Triathlon', tier: 'TIER_2', blurb: 'Standard distance triathlon.', description: '+8% tri XP', test: { description: 'Olympic triathlon (1.5km swim + 40km bike + 10km run) in any time.', safety: 'Build base in each discipline. Practice transitions. Hydrate + fuel.', metric: 'reps', threshold: { reps: 1 } } },
  { name: 'Olympic Tri < 3:00:00', branch: 'Triathlon', tier: 'TIER_3', blurb: 'Sub-3 Olympic tri — solid intermediate.', description: '+10% tri XP', test: { description: 'Olympic triathlon in under 3:00:00.', safety: 'Long build. Practice transitions. Hydrate + fuel.', metric: 'duration', threshold: { duration_sec: 10800 } } },
  { name: 'Half Ironman < 6:30:00', branch: 'Triathlon', tier: 'TIER_3', blurb: 'Half Ironman — serious multi-engine endurance.', description: '+12% half-IM XP', test: { description: 'Half Ironman (1.9km swim + 90km bike + 21km run) in under 6:30:00.', safety: 'Long build. Carb-load. Hydrate + fuel heavily. Coach recommended.', metric: 'duration', threshold: { duration_sec: 23400 } } },
  { name: 'Full Ironman (any time)', branch: 'Triathlon', tier: 'TIER_3', blurb: 'Ironman — the god-tier of multi-sport endurance.', description: '+20% IM XP', test: { description: 'Full Ironman (3.8km swim + 180km bike + 42km run) in any time. Just finishing is the achievement.', safety: 'Long build (months). Carb-load. Hydrate + fuel heavily. Coach + crew strongly recommended.', metric: 'reps', threshold: { reps: 1 } } },
];

// ---- 4. BERSERKER (volume + HIIT + combat) — 34 skills ----
const BERSERKER_SKILLS: Spec[] = [
  // A. Sled / Prowler
  { name: 'Sled Push 25m', branch: 'Sled', tier: 'TIER_1', blurb: 'Light horizontal push — sled basics.', description: '+5% sled XP', test: { description: 'Push a sled 25m at 25% bodyweight. Bend at the waist, drive through the legs.', safety: 'Flat surface. Don\'t lock knees at the top.', metric: 'reps', threshold: { reps: 25, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled Push 50m', branch: 'Sled', tier: 'TIER_1', blurb: 'Sled volume at light load.', description: '+5% sled XP', test: { description: 'Push 50m at 25% bodyweight. Same form.', safety: 'Flat surface.', metric: 'reps', threshold: { reps: 50, weight_kg_mult_of_bw: 0.25 } } },
  { name: 'Sled Push 100m @ 50%BW', branch: 'Sled', tier: 'TIER_2', blurb: 'Sled distance at half bodyweight.', description: '+8% sled XP', test: { description: 'Push 100m at 0.5× bodyweight. Steady pace.', safety: 'Flat surface. Good shoes.', metric: 'reps', threshold: { reps: 100, weight_kg_mult_of_bw: 0.5 } } },
  { name: 'Sled 1mi @ 50%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'A mile of heavy sled — pure grit.', description: '+10% sled XP', test: { description: 'Push a sled 1 mile at 0.5× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled 1mi @ 75%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'Three-quarter bodyweight mile.', description: '+12% sled XP', test: { description: 'Push 1 mile at 0.75× bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first.', metric: 'duration', threshold: { duration_sec: 480 } } },
  { name: 'Sled 1mi @ 100%BW < 8:00', branch: 'Sled', tier: 'TIER_3', blurb: 'Bodyweight mile — strongman-class feat.', description: '+15% sled XP', test: { description: 'Push 1 mile at bodyweight in under 8 minutes.', safety: 'Flat surface. Practice lower loads first. Spotter / coach nearby.', metric: 'duration', threshold: { duration_sec: 480 } } },

  // B. Kettlebell
  { name: '100 KB Swings @ 24kg', branch: 'Kettlebell', tier: 'TIER_1', blurb: 'Russian-style KB swings — grip + hip power.', description: '+5% KB XP', test: { description: '100 single-arm KB swings at 24kg, alternating arms. Hardstyle swing to chest level.', safety: 'Use a hip hinge, not a squat. Don\'t round the back.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '200 KB Swings < 20:00', branch: 'Kettlebell', tier: 'TIER_2', blurb: 'KB swing volume — pure conditioning.', description: '+5% KB XP', test: { description: '200 KB swings in under 20 minutes. Use a hip hinge, controlled pace.', safety: 'Same as T1. Don\'t go to failure — pace yourself.', metric: 'duration', threshold: { duration_sec: 1200 } } },
  { name: '100 KB Snatches < 10:00', branch: 'Kettlebell', tier: 'TIER_2', blurb: 'KB snatch — ballistic overhead work.', description: '+8% KB XP', test: { description: '100 KB snatches at 24kg in under 10 minutes, alternating arms.', safety: 'Use a hip drive. Don\'t press out — it\'s a flip catch. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '100 KB Long Cycle < 5:00', branch: 'Kettlebell', tier: 'TIER_3', blurb: 'Long cycle — clean + snatch + jerk + clean.', description: '+10% KB XP', test: { description: '100 KB long cycle at 24kg in under 5 minutes.', safety: 'Build up to long cycle gradually. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '30+ LCC @ 24kg', branch: 'Kettlebell', tier: 'TIER_3', blurb: 'Long cycle god-tier — 30+ reps in 5 minutes at 24kg.', description: '+15% KB XP', test: { description: '30+ KB long cycle reps at 24kg in 5 minutes.', safety: 'Strong LC base first. Don\'t go to failure.', metric: 'rounds', threshold: { rounds: 30 } } },

  // C. Hero WODs
  { name: 'Cindy 15+ Rounds', branch: 'Hero WODs', tier: 'TIER_1', blurb: 'Classic AMRAP — 5 pull-ups + 10 push-ups + 15 air squats.', description: '+5% WOD XP', test: { description: 'Cindy (5 PU + 10 PU + 15 squats, 20min AMRAP) for 15+ rounds.', safety: 'Scale pull-ups and push-ups to bands/knees if needed.', metric: 'rounds', threshold: { rounds: 15 } } },
  { name: 'Murph Unpartitioned < 60:00', branch: 'Hero WODs', tier: 'TIER_2', blurb: 'Murph — the Hero WOD benchmark.', description: '+10% WOD XP', test: { description: 'Murph (1mi run + 100 PU + 200 PU + 1mi run) in under 60 minutes, unpartitioned.', safety: 'Scale as needed. Hydrate. Run/walk splits allowed.', metric: 'duration', threshold: { duration_sec: 3600 } } },
  { name: 'Murph Partitioned < 45:00', branch: 'Hero WODs', tier: 'TIER_3', blurb: 'Murph partitioned — reps are split into manageable sets.', description: '+10% WOD XP', test: { description: 'Murph partitioned (sets of 5, 10, 15 PU + squats) in under 45 minutes.', safety: 'Same as unpartitioned. Stay hydrated.', metric: 'duration', threshold: { duration_sec: 2700 } } },
  { name: 'Murph w/ 20lb Vest < 50:00', branch: 'Hero WODs', tier: 'TIER_3', blurb: 'Murph with a vest — added load.', description: '+12% WOD XP', test: { description: 'Murph with 20lb vest, partitioned, in under 50 minutes.', safety: 'Master weighted vest PU first. Stay hydrated.', metric: 'duration', threshold: { duration_sec: 3000 } } },
  { name: 'Murph w/ 20lb Vest, Partitioned < 40:00', branch: 'Hero WODs', tier: 'TIER_3', blurb: 'Murph god-tier — vest + partitioned, sub-40.', description: '+15% WOD XP', test: { description: 'Murph with 20lb vest, partitioned, in under 40 minutes.', safety: 'Strong base of all 4 movements at 20lb vest. Hydrate heavily.', metric: 'duration', threshold: { duration_sec: 2400 } } },

  // D. Boxing
  { name: '100 Jabs in 3min', branch: 'Boxing', tier: 'TIER_1', blurb: 'Boxing basics — jab volume.', description: '+5% boxing XP', test: { description: '100 jabs on a heavy bag in 3 minutes.', safety: 'Use proper hand wrapping. Don\'t over-extend the elbow.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '3min Shadowbox Round', branch: 'Boxing', tier: 'TIER_1', blurb: 'Shadowboxing — full-body warmup.', description: '+5% boxing XP', test: { description: '3 minutes of continuous shadowboxing (jabs, crosses, hooks, movement).', safety: 'Warm up first. Use proper stance and rotation.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '3min Heavy Bag Round', branch: 'Boxing', tier: 'TIER_2', blurb: 'Heavy bag work — power + combinations.', description: '+5% boxing XP', test: { description: '3 minutes of heavy bag work (jabs + crosses + hooks + movement).', safety: 'Use hand wrapping + gloves. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '5min Heavy Bag @ Full Speed', branch: 'Boxing', tier: 'TIER_3', blurb: 'Full-speed 5min — sustained power.', description: '+8% boxing XP', test: { description: '5 minutes of heavy bag at full speed. Sustained combinations.', safety: 'Use wrapping + gloves. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '3×3min Heavy Bag Rounds', branch: 'Boxing', tier: 'TIER_3', blurb: 'Boxing god-tier — three rounds of sustained power.', description: '+12% boxing XP', test: { description: '3 rounds of 3min heavy bag, with 30s rest between rounds.', safety: 'Strong base first. Wrap hands, use gloves. Coach / sparring partner recommended.', metric: 'duration', threshold: { duration_sec: 540 } } },

  // E. Capacity
  { name: '10min Cindy ≥ 12 Rounds', branch: 'Capacity', tier: 'TIER_1', blurb: 'Capacity baseline — bodyweight AMRAP.', description: '+5% capacity XP', test: { description: '10min Cindy (5 PU + 10 PU + 15 squats) for 12+ rounds.', safety: 'Scale PU/PU if needed.', metric: 'rounds', threshold: { rounds: 12 } } },
  { name: '10min Cindy ≥ 15 Rounds', branch: 'Capacity', tier: 'TIER_2', blurb: 'Mid-level capacity.', description: '+5% capacity XP', test: { description: '10min Cindy for 15+ rounds.', safety: 'Same as T1.', metric: 'rounds', threshold: { rounds: 15 } } },
  { name: '20min Cindy ≥ 18 Rounds', branch: 'Capacity', tier: 'TIER_2', blurb: '20min Cindy — strong capacity.', description: '+8% capacity XP', test: { description: '20min Cindy for 18+ rounds.', safety: 'Hydrate. Don\'t go to failure on PU.', metric: 'rounds', threshold: { rounds: 18 } } },
  { name: '30min Mixed AMRAP ≥ 15 Rounds', branch: 'Capacity', tier: 'TIER_3', blurb: '30min mixed AMRAP — sustained output.', description: '+10% capacity XP', test: { description: '30min AMRAP of mixed movements (e.g. KB swings, push-ups, air squats) for 15+ rounds.', safety: 'Hydrate + fuel. Don\'t go to failure.', metric: 'rounds', threshold: { rounds: 15 } } },
  { name: '60min Mixed AMRAP ≥ 20 Rounds', branch: 'Capacity', tier: 'TIER_3', blurb: '60min mixed AMRAP — extreme capacity.', description: '+12% capacity XP', test: { description: '60min AMRAP of mixed movements for 20+ rounds.', safety: 'Hydrate + fuel heavily. Coach / spotter recommended.', metric: 'rounds', threshold: { rounds: 20 } } },
  { name: 'Murph Unpartitioned (Capacity)', branch: 'Capacity', tier: 'TIER_3', blurb: 'Murph as capacity test — the OG benchmark.', description: '+15% capacity XP', test: { description: 'Full Murph (1mi + 100 PU + 200 PU + 1mi), unpartitioned, in any time. Just finishing is the win.', safety: 'Long build. Hydrate + fuel heavily. Coach + crew recommended.', metric: 'reps', threshold: { reps: 1 } } },

  // F. Mace / Indian Club (NEW)
  { name: '10 Figure-8s @ 7kg', branch: 'Mace / Indian Club', tier: 'TIER_1', blurb: 'Mace basics — figure-8 swings. Grip + shoulder + rotational core.', description: '+5% mace XP', test: { description: '10 figure-8 swings at 7kg (each side, alternating). Smooth horizontal circles at chest level.', safety: 'Use proper grip. Don\'t lock the elbow. Warm up shoulders first.', metric: 'reps', threshold: { reps: 10 } } },
  { name: '10 Mills @ 7kg', branch: 'Mace / Indian Club', tier: 'TIER_1', blurb: 'Vertical circles — shoulder mobility + grip.', description: '+5% mace XP', test: { description: '10 mills (vertical circles, alternating forward/back) at 7kg. Each side.', safety: 'Same as figure-8. Don\'t lock the elbow.', metric: 'reps', threshold: { reps: 10 } } },
  { name: '5 Fig-8 + 5 Mills @ 7kg < 3:00', branch: 'Mace / Indian Club', tier: 'TIER_2', blurb: 'Mace combination — both planes in one session.', description: '+5% mace XP', test: { description: '5 figure-8 + 5 mills at 7kg in under 3 minutes (each side).', safety: 'Same as T1/T2. Stay loose in the grip.', metric: 'duration', threshold: { duration_sec: 180 } } },
  { name: '50 Figure-8s @ 10kg Continuous', branch: 'Mace / Indian Club', tier: 'TIER_2', blurb: 'Mace volume at moderate load — grip endurance.', description: '+8% mace XP', test: { description: '50 figure-8s continuous at 10kg. Smooth circles, no breaks.', safety: 'Use lighter mace first. Don\'t lock the elbow. Stop if grip fails.', metric: 'reps', threshold: { reps: 50 } } },
  { name: '10 Mace 360s @ 14kg < 5:00', branch: 'Mace / Indian Club', tier: 'TIER_3', blurb: 'Heavy mace at 14kg — full shoulder + grip work.', description: '+10% mace XP', test: { description: '10 mace 360s (full horizontal rotations around the body) at 14kg in under 5 minutes. Each side.', safety: 'Build up to heavy mace gradually. Use chalk. Stop if elbow pain.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '50 Alt Fig-8/Mill @ 14kg < 10:00', branch: 'Mace / Indian Club', tier: 'TIER_3', blurb: 'Mace AMRAP — sustained mace work capacity.', description: '+12% mace XP', test: { description: '50 alternating figure-8 / mill at 14kg in under 10 minutes.', safety: 'Build up to heavy mace first. Use chalk + a flat surface.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: 'Gravedigger @ 18kg < 5:00', branch: 'Mace / Indian Club', tier: 'TIER_3', blurb: 'Mace god-tier — the iconic gravedigger combo.', description: '+15% mace XP', test: { description: 'Gravedigger (squat down → 360° circle as you stand → press overhead → repeat) at 18kg in under 5 minutes. Each side.', safety: 'Strong mace base first. Use a controlled mace. Coach / spotter recommended. Stop if elbow/shoulder pain.', metric: 'duration', threshold: { duration_sec: 300 } } },
];

// ---- 5. TRACER (speed + plyo + parkour) — 27 skills ----
const TRACER_SKILLS: Spec[] = [
  // A. Sprint
  { name: '100m < 18s', branch: 'Sprint', tier: 'TIER_1', blurb: 'Sprint basics — 100m baseline.', description: '+5% sprint XP', test: { description: '100m in under 18 seconds.', safety: 'Warm up with dynamic stretching. Don\'t pull a hamstring.', metric: 'duration', threshold: { duration_sec: 18 } } },
  { name: '100m < 14s', branch: 'Sprint', tier: 'TIER_2', blurb: 'Sub-14 — competitive amateur.', description: '+5% sprint XP', test: { description: '100m in under 14 seconds.', safety: 'Warm up thoroughly. Don\'t pull a hamstring.', metric: 'duration', threshold: { duration_sec: 14 } } },
  { name: '200m < 30s', branch: 'Sprint', tier: 'TIER_2', blurb: '200m — first true sprint distance.', description: '+5% sprint XP', test: { description: '200m in under 30 seconds.', safety: 'Same as 100m. Build up to 200m first.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '200m < 25s', branch: 'Sprint', tier: 'TIER_3', blurb: 'Sub-25 200m.', description: '+8% sprint XP', test: { description: '200m in under 25 seconds.', safety: 'Same as T3.', metric: 'duration', threshold: { duration_sec: 25 } } },
  { name: '400m < 60s', branch: 'Sprint', tier: 'TIER_3', blurb: '400m — the lactic acid test.', description: '+10% sprint XP', test: { description: '400m in under 60 seconds.', safety: 'Build base of 200m first. Don\'t go to failure.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '400m < 50s', branch: 'Sprint', tier: 'TIER_3', blurb: 'Sub-50 400m — elite amateur.', description: '+12% sprint XP', test: { description: '400m in under 50 seconds.', safety: 'Strong 400m base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 50 } } },

  // B. Plyo (vertical)
  { name: 'Broad Jump ≥ Height', branch: 'Plyo', tier: 'TIER_1', blurb: 'Standing broad jump — baseline plyo.', description: '+5% plyo XP', test: { description: 'Standing broad jump ≥ your height (e.g. if you\'re 6ft, jump 6ft).', safety: 'Warm up. Land softly. Don\'t over-extend the knees.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Broad Jump ≥ 1.25× Height', branch: 'Plyo', tier: 'TIER_2', blurb: 'Strong broad jump.', description: '+5% plyo XP', test: { description: 'Standing broad jump ≥ 1.25× your height.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Box Jump 24"', branch: 'Plyo', tier: 'TIER_2', blurb: '24" box jump — the standard.', description: '+8% plyo XP', test: { description: 'Box jump 24" (60cm). Jump and land soft, full hip extension.', safety: 'Warm up. Use a stable box. Don\'t over-jump your ability.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Box Jump 30"', branch: 'Plyo', tier: 'TIER_3', blurb: 'Strong box jump — 30".', description: '+10% plyo XP', test: { description: 'Box jump 30" (75cm).', safety: 'Same as T3. Master 24" first.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Vertical Jump ≥ 1.5× Height', branch: 'Plyo', tier: 'TIER_3', blurb: 'Vertical jump — pure lower-body power.', description: '+10% plyo XP', test: { description: 'Standing vertical jump ≥ 1.5× your height (e.g. 6ft person jumps 9ft up).', safety: 'Same as T1. Don\'t pull a hamstring.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Depth Jump 24" + Max Vertical', branch: 'Plyo', tier: 'TIER_3', blurb: 'Depth jump — reactive strength god-tier.', description: '+12% plyo XP', test: { description: 'Drop from 24" box, immediately max vertical jump upon landing.', safety: 'Master regular box jump first. Use a softer landing surface. Coach recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },

  // C. Parkour
  { name: '5m Precision Jump Initiate', branch: 'Parkour', tier: 'TIER_1', blurb: 'Land within a target — precision training.', description: '+5% parkour XP', test: { description: 'Jump 5m and land within 6" of a target on the ground.', safety: 'Start short. Land soft. Don\'t roll an ankle.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Tic-Tac ≥ 4 Steps', branch: 'Parkour', tier: 'TIER_2', blurb: 'Vertical wall run-up — the tic-tac.', description: '+5% parkour XP', test: { description: 'Tic-tac off a wall with at least 4 steps (push off, land on the same wall, push off again).', safety: 'Practice lower steps first. Use a sturdy wall. Spotter for first attempts.', metric: 'reps', threshold: { reps: 4, sides: 'total' } } },
  { name: 'Wall Cat 8ft, 2 Holds', branch: 'Parkour', tier: 'TIER_2', blurb: 'Climb 8ft using two cat-grab holds.', description: '+8% parkour XP', test: { description: 'Climb an 8ft wall using only two cat-grab (one-hand-each) holds.', safety: 'Have a spotter. Practice lower walls first. Check holds for stability.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Wall Spin (180°)', branch: 'Parkour', tier: 'TIER_3', blurb: 'Run up + spin 180° off a wall.', description: '+10% parkour XP', test: { description: 'Wall spin: run up wall, push off, spin 180°, land facing the other way.', safety: 'Have a spotter. Practice shorter walls first. Use a sturdy wall.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Dash Vault 5ft', branch: 'Parkour', tier: 'TIER_3', blurb: 'Clear a 5ft obstacle from a run.', description: '+10% parkour XP', test: { description: 'From a run, clear a 5ft obstacle with a vault (speed vault or dive roll).', safety: 'Practice lower obstacles first. Use a soft landing surface. Spotter.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Kong Vault 6ft', branch: 'Parkour', tier: 'TIER_3', blurb: 'Parkour god-tier — the kong is the highest-vault flow.', description: '+15% parkour XP', test: { description: 'From a run, kong vault (two-handed) over a 6ft obstacle.', safety: 'Master dash vault first. Spotter / coach required. Use a soft surface.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },

  // D. Agility
  { name: '5-10-5 Pro-Agility < 5.0s', branch: 'Agility', tier: 'TIER_1', blurb: 'Reactive change-of-direction baseline.', description: '+5% agility XP', test: { description: '5-10-5 yard pro-agility drill in under 5.0 seconds.', safety: 'Warm up. Don\'t cut too sharp — use proper technique.', metric: 'duration', threshold: { duration_sec: 5 } } },
  { name: '5-10-5 < 4.5s', branch: 'Agility', tier: 'TIER_2', blurb: 'Sub-4.5 — solid.', description: '+5% agility XP', test: { description: '5-10-5 in under 4.5 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 4.5 } } },
  { name: '5-10-5 < 4.0s', branch: 'Agility', tier: 'TIER_3', blurb: 'Sub-4 — elite amateur.', description: '+8% agility XP', test: { description: '5-10-5 in under 4.0 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 4 } } },
  { name: 'T-Test < 10.0s', branch: 'Agility', tier: 'TIER_3', blurb: 'T-test — multi-directional agility.', description: '+10% agility XP', test: { description: 'T-test (forward + lateral + backpedal) in under 10.0 seconds.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 10 } } },
  { name: 'T-Test < 9.0s', branch: 'Agility', tier: 'TIER_3', blurb: 'T-test god-tier.', description: '+12% agility XP', test: { description: 'T-test in under 9.0 seconds.', safety: 'Strong base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 9 } } },

  // E. Throws
  { name: '2kg MB Chest ≥ 8m', branch: 'Throws', tier: 'TIER_1', blurb: 'Med ball chest throw — power transfer.', description: '+5% throws XP', test: { description: '2kg med ball chest pass ≥ 8 meters.', safety: 'Use a wall or partner catcher. Don\'t throw at people.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '4kg MB OH ≥ 6m', branch: 'Throws', tier: 'TIER_2', blurb: 'Overhead throw — full-body power.', description: '+5% throws XP', test: { description: '4kg med ball overhead throw ≥ 6 meters.', safety: 'Use a safe landing area. Don\'t throw at people.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '5kg MB Rotational ≥ 10m', branch: 'Throws', tier: 'TIER_2', blurb: 'Rotational throw — core power transfer.', description: '+8% throws XP', test: { description: '5kg med ball rotational throw (sideways) ≥ 10 meters.', safety: 'Same. Master 4kg OH first.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: '8kg MB Rotational ≥ 12m', branch: 'Throws', tier: 'TIER_3', blurb: 'Heavy med ball throw — power god-tier.', description: '+12% throws XP', test: { description: '8kg med ball rotational throw ≥ 12 meters.', safety: 'Strong base of lighter throws first. Coach / spotter recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
];

// ---- 6. ORACLE (yoga + pilates + mobility) — 34 skills ----
const ORACLE_SKILLS: Spec[] = [
  // A. Mobility (static)
  { name: 'Palms to Floor Initiate', branch: 'Mobility', tier: 'TIER_1', blurb: 'Forward fold — the first static hold.', description: '+5% mobility XP', test: { description: 'Standing forward fold, palms to the floor (knees soft).', safety: 'Don\'t bounce. Hold steady.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s Bridge', branch: 'Mobility', tier: 'TIER_1', blurb: 'Bridge — hip flexor + glute control.', description: '+5% mobility XP', test: { description: '30s bridge (shoulders + feet on floor, hips up).', safety: 'Don\'t hyperextend the lower back. Tuck pelvis.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake 80% ROM 30s', branch: 'Mobility', tier: 'TIER_2', blurb: 'Pancake — hamstring + adductor stretch.', description: '+5% mobility XP', test: { description: 'Seated pancake at 80% ROM (legs wide, chest to floor, knees straight). 30s hold.', safety: 'Warm up first. Don\'t force the stretch.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake 100% ROM 60s', branch: 'Mobility', tier: 'TIER_2', blurb: 'Full pancake — advanced hip mobility.', description: '+8% mobility XP', test: { description: 'Seated pancake at 100% ROM (chest to floor). 60s hold.', safety: 'Master 80% first. Stretch before testing.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '30s Front Split', branch: 'Mobility', tier: 'TIER_3', blurb: 'Front split — peak hamstring flexibility.', description: '+10% mobility XP', test: { description: '30s front split (one leg forward, one back, both straight, pelvis square).', safety: 'Master 100% pancake first. Stretch before testing. Don\'t force into the split.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '30s Middle Split', branch: 'Mobility', tier: 'TIER_3', blurb: 'Middle split — peak adductor flexibility.', description: '+10% mobility XP', test: { description: '30s middle split (legs wide, both straight, pelvis square, chest to floor).', safety: 'Master 100% pancake + front split first. Stretch thoroughly. Don\'t force.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'Pancake + Splits Combo', branch: 'Mobility', tier: 'TIER_3', blurb: 'Mobility god-tier — pancake + both splits.', description: '+15% mobility XP', test: { description: 'Hold pancake (30s) + front split (30s, each side) + middle split (30s) in sequence.', safety: 'Master each individual milestone first. Stretch thoroughly before testing.', metric: 'duration', threshold: { duration_sec: 90 } } },

  // B. Breath
  { name: 'Box 5min Sustained', branch: 'Breath', tier: 'TIER_1', blurb: 'Box breathing — calm focus.', description: '+5% breath XP', test: { description: 'Box breathing (4-4-4-4) sustained for 5 minutes.', safety: 'Sit comfortably. Don\'t force the breath.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '4-7-8 × 50 Cycles', branch: 'Breath', tier: 'TIER_2', blurb: '4-7-8 breathwork — parasympathetic activation.', description: '+5% breath XP', test: { description: '4-7-8 breathwork (inhale 4, hold 7, exhale 8) for 50 cycles.', safety: 'Same as T1. Don\'t force.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '60s Breath Hold', branch: 'Breath', tier: 'TIER_2', blurb: 'Comfortable breath hold — lung capacity.', description: '+8% breath XP', test: { description: '60s comfortable breath hold (after a normal inhale, not forced).', safety: 'Don\'t do this in water. Stop if you feel lightheaded.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '90s Breath Hold', branch: 'Breath', tier: 'TIER_3', blurb: '90s hold — strong lung capacity.', description: '+10% breath XP', test: { description: '90s comfortable breath hold.', safety: 'Same as T3. Don\'t push to blackout.', metric: 'duration', threshold: { duration_sec: 90 } } },
  { name: '120s Breath Hold', branch: 'Breath', tier: 'TIER_3', blurb: '2-minute hold — elite pranayama.', description: '+12% breath XP', test: { description: '120s comfortable breath hold.', safety: 'Same as T3. Practice in a safe environment.', metric: 'duration', threshold: { duration_sec: 120 } } },
  { name: 'Wim Hof Round 1', branch: 'Breath', tier: 'TIER_3', blurb: 'Wim Hof method — breath god-tier.', description: '+15% breath XP', test: { description: 'Wim Hof round 1: 3 cycles of 30 breaths + retention ≥ 2 minutes.', safety: 'Practice shorter rounds first. Don\'t do in water. Coach recommended.', metric: 'duration', threshold: { duration_sec: 120 } } },

  // C. Balance
  { name: 'SL Stand 30s Initiate', branch: 'Balance', tier: 'TIER_1', blurb: 'Single-leg stand — the balance baseline.', description: '+5% balance XP', test: { description: '30s single-leg stand on each leg (no shoes preferred).', safety: 'Stand near a wall or chair for safety. Don\'t lock the standing knee.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: 'SL Stand 60s', branch: 'Balance', tier: 'TIER_2', blurb: 'Single-leg stand milestone.', description: '+5% balance XP', test: { description: '60s single-leg stand on each leg.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'SL Stand 60s Eyes Closed', branch: 'Balance', tier: 'TIER_2', blurb: 'Single-leg stand with eyes closed — proprioception.', description: '+8% balance XP', test: { description: '60s single-leg stand with eyes closed, on each leg.', safety: 'Have a wall or spotter nearby. Don\'t fall.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: 'Tree Pose 60s Eyes Closed (Each Side)', branch: 'Balance', tier: 'TIER_3', blurb: 'Tree pose with closed eyes — balance + calm.', description: '+8% balance XP', test: { description: '60s tree pose with eyes closed, each side.', safety: 'Same as T3.', metric: 'duration', threshold: { duration_sec: 60 } } },
  { name: '30s Free Handstand (Wall)', branch: 'Balance', tier: 'TIER_3', blurb: 'Wall handstand balance — 30s free balance attempt.', description: '+10% balance XP', test: { description: '30s free handstand (back to wall, light touch for safety).', safety: 'Practice chest-to-wall first. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 30 } } },
  { name: '60s Free Handstand (Wall)', branch: 'Balance', tier: 'TIER_3', blurb: '60s wall handstand — strong balance.', description: '+12% balance XP', test: { description: '60s free handstand (back to wall, light touch).', safety: 'Master 30s first. Spotter nearby.', metric: 'duration', threshold: { duration_sec: 60 } } },

  // D. Mindfulness
  { name: '5min Meditation Initiate', branch: 'Mindfulness', tier: 'TIER_1', blurb: 'Seated meditation — the stillness baseline.', description: '+5% mindfulness XP', test: { description: '5min seated meditation (eyes open → closed).', safety: 'Sit comfortably. Don\'t force.', metric: 'duration', threshold: { duration_sec: 300 } } },
  { name: '10min Meditation', branch: 'Mindfulness', tier: 'TIER_2', blurb: '10 minutes of stillness.', description: '+5% mindfulness XP', test: { description: '10min seated meditation.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 600 } } },
  { name: '20min Meditation', branch: 'Mindfulness', tier: 'TIER_2', blurb: '20 minutes — a real sit.', description: '+8% mindfulness XP', test: { description: '20min seated meditation.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 1200 } } },
  { name: '30min Meditation', branch: 'Mindfulness', tier: 'TIER_3', blurb: '30 minutes — strong stillness.', description: '+10% mindfulness XP', test: { description: '30min seated meditation.', safety: 'Same as T1.', metric: 'duration', threshold: { duration_sec: 1800 } } },
  { name: '60min Meditation (HRV)', branch: 'Mindfulness', tier: 'TIER_3', blurb: '60min meditation — the mindfulness god-tier.', description: '+15% mindfulness XP', test: { description: '60min seated meditation (HRV measured before/after to track the parasympathetic response).', safety: 'Same as T1. Coach / experienced practitioner recommended.', metric: 'duration', threshold: { duration_sec: 3600 } } },

  // E. Yoga Flows
  { name: '5 Sun Salutations Initiate', branch: 'Yoga', tier: 'TIER_1', blurb: 'Sun salutation — the classic vinyasa flow.', description: '+5% yoga XP', test: { description: '5 sun salutations (A or B, your choice).', safety: 'Warm up first. Don\'t push into injuries.', metric: 'reps', threshold: { reps: 5 } } },
  { name: '10 Sun Salutations', branch: 'Yoga', tier: 'TIER_2', blurb: '10 salutations — sustained flow.', description: '+5% yoga XP', test: { description: '10 sun salutations.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'A→B × 10 Cycles', branch: 'Yoga', tier: 'TIER_3', blurb: 'Full salutation sequence — sustained flow.', description: '+8% yoga XP', test: { description: 'A→B sequence × 10 cycles.', safety: 'Same as T1.', metric: 'reps', threshold: { reps: 10 } } },
  { name: 'Modified Ashtanga × 1 Round', branch: 'Yoga', tier: 'TIER_3', blurb: 'Modified Ashtanga — the classical sequence.', description: '+10% yoga XP', test: { description: 'Modified Ashtanga primary series (skip headstand) × 1 round.', safety: 'Strong yoga base first. Skip headstand if not ready. Coach recommended.', metric: 'reps', threshold: { reps: 1, sides: 'total' } } },
  { name: 'Modified Ashtanga × 3 Rounds', branch: 'Yoga', tier: 'TIER_3', blurb: 'Ashtanga god-tier — 3 rounds of the classical sequence.', description: '+15% yoga XP', test: { description: 'ModifiedAshtanga primary series × 3 rounds.', safety: 'Strong yoga base first. Coach / experienced practitioner recommended.', metric: 'reps', threshold: { reps: 3, sides: 'total' } } },

  // F. Pilates
  { name: '100 Crunches Initiate', branch: 'Pilates', tier: 'TIER_1', blurb: 'Core endurance baseline.', description: '+5% pilates XP', test: { description: '100 crunches (any style, can be split into sets).', safety: 'Don\'t yank the neck. Keep the lower back engaged.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '100 Hundreds', branch: 'Pilates', tier: 'TIER_1', blurb: 'The hundreds — the classic Pilates core exercise.', description: '+5% pilates XP', test: { description: '100 hundreds (legs at 45°, arms pumping).', safety: 'Keep lower back pressed to floor. Don\'t strain neck.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '50 Roll-Ups + 50 Teasers', branch: 'Pilates', tier: 'TIER_2', blurb: 'Roll-ups + teasers — full core sequence.', description: '+8% pilates XP', test: { description: '50 roll-ups + 50 teasers (any style, can be split).', safety: 'Don\'t strain neck. Keep lower back engaged.', metric: 'reps', threshold: { reps: 100 } } },
  { name: '30 Teaser-Outs', branch: 'Pilates', tier: 'TIER_3', blurb: 'Teaser-outs — V-sit core endurance.', description: '+10% pilates XP', test: { description: '30 teaser-outs (V-sit, alternating leg drops and raises).', safety: 'Strong core base first. Don\'t strain the lower back.', metric: 'reps', threshold: { reps: 30 } } },
  { name: '45min Mat Class (No Rest)', branch: 'Pilates', tier: 'TIER_3', blurb: 'Pilates god-tier — full mat class with no breaks.', description: '+15% pilates XP', test: { description: 'Full mat pilates class, 45 minutes, no rest breaks.', safety: 'Strong pilates base first. Coach recommended.', metric: 'duration', threshold: { duration_sec: 2700 } } },
];

const SKILLS_BY_CLASS: Record<string, Spec[]> = {
  JUGGERNAUT: JUGGERNAUT_SKILLS,
  PHANTOM: PHANTOM_SKILLS,
  SCOUT: SCOUT_SKILLS,
  BERSERKER: BERSERKER_SKILLS,
  TRACER: TRACER_SKILLS,
  ORACLE: ORACLE_SKILLS,
};

export async function seedSkills(): Promise<{ upserted: number }> {
  let upserted = 0;
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
          cost: 1,
          prerequisites: [],
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
        },
      });
      upserted++;
    }
  }
  return { upserted };
}
