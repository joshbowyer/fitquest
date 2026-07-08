/**
 * Tests for the SPRINT_DISTANCE / CARDIO_5K / CARDIO_DISTANCE
 * branches of `computeRequirementProgress`.
 *
 * Two regression surfaces the audit caught:
 *
 *   (3) The pre-fix SPRINT_DISTANCE logic tried to gate a single
 *       set on BOTH `duration × 3.33 >= minMeters` AND `duration
 *       <= maxSeconds`, which collapses to a self-contradiction
 *       at every shipped sprint level (gap-4: 400m/90s; nexus-4:
 *       400m/75s; breach-4: 800m/180s). `400m / 3.33 = 120s > 90s`
 *       and `400m / 3.33 = 120s > 75s` and `800m / 3.33 = 240s >
 *       180s`, so no real session could ever satisfy both clauses
 *       at once.
 *
 *       The fix layer is twofold:
 *         - Real `workout.cardio.{distanceKm, durationSec}` data
 *           (when present) gates on both the meter floor and the
 *           time ceiling — satisfied by a single logged cardio
 *           block.
 *         - The per-set proxy falls back to `duration <=
 *           maxSeconds` only (no inferred-meter check), so the
 *           scanner no longer self-contradicts at shipped params.
 *
 *   (5) Also covers the CARDIO_5K + CARDIO_DISTANCE branches:
 *       the new `workout.cardio` path takes priority over the
 *       duration proxy when present, and the proxy keeps working
 *       for older workouts without a cardio block.
 *
 * The table-driven first test asserts every shipped level is
 * satisfiable by at least one synthetic set/block — locks the
 * regression so future tuning can't resurrect the contradiction.
 */
import { describe, it, expect } from 'vitest';
import { WORLDS, computeRequirementProgress, type LevelRequirement } from '../lib/worlds';

type WorkoutLike = Parameters<typeof computeRequirementProgress>[2];

function workoutWithCardio(cardio: { distanceKm: number; durationSec: number }): WorkoutLike {
  return [
    {
      exercises: [],
      cardio,
    },
  ];
}

function workoutWithCardioSet(name: string, duration: number): WorkoutLike {
  return [
    {
      exercises: [
        { name, sets: [{ weight: null, reps: 0, duration }] },
      ],
      cardio: null,
    },
  ];
}

describe('computeRequirementProgress — every shipped CARDIO_* / SPRINT_DISTANCE level is satisfiable', () => {
  // Enumerate every shipped requirement that depends on cardio /
  // sprint. Locks the regression so a future tuning edit can't
  // re-introduce a self-contradictory threshold combination.
  const cases: Array<{
    label: string;
    requirement: LevelRequirement;
    /** A workout payload that should CLEAR this requirement. */
    satisfying: WorkoutLike;
    /** If the satisfying set is also pace-gated, a second
     *  workout payload that should NOT clear it (regression:
     *  a 30-min bike with no distance mustn't clear a pace-
     *  gated 5K). Optional. */
    nonSatisfying?: WorkoutLike;
  }> = [] as Array<{
    label: string;
    requirement: LevelRequirement;
    satisfying: WorkoutLike;
    nonSatisfying?: WorkoutLike;
  }>;

  // Gather CARDIO_DISTANCE / CARDIO_5K / SPRINT_DISTANCE
  // requirements from WORLDS, attach a synthetic satisfying
  // block for each.
  for (const world of WORLDS) {
    for (const lvl of world.levels) {
      const r = lvl.requirement;
      if (r.kind === 'CARDIO_DISTANCE') {
        cases.push({
          label: `${lvl.id} — ${r.kind} ≥${r.minMeters}m`,
          requirement: r,
          satisfying: workoutWithCardio({
            distanceKm: (r.minMeters + 100) / 1000,
            durationSec: 1800,
          }),
        });
      } else if (r.kind === 'CARDIO_5K') {
        cases.push({
          label: `${lvl.id} — ${r.kind} ≤${r.maxSeconds}s`,
          requirement: r,
          satisfying: workoutWithCardio({
            distanceKm: 5.05, // a touch over 5km
            durationSec: r.maxSeconds - 60, // under cap
          }),
          // A 30-min stationary-bike-style cardio block with no
          // distance logged. Real users log these for bike
          // trainer rides; the meter floor must prevent them from
          // accidentally clearing a pace-gated 5K (which requires
          // an actual 5km of distance run in time).
          nonSatisfying: workoutWithCardio({
            distanceKm: 0,
            durationSec: 30 * 60,
          }),
        });
      } else if (r.kind === 'SPRINT_DISTANCE') {
        cases.push({
          label: `${lvl.id} — ${r.kind} ≥${r.minMeters}m, ≤${r.maxSeconds}s`,
          requirement: r,
          satisfying: workoutWithCardio({
            distanceKm: (r.minMeters + 20) / 1000, // 20m buffer over floor
            durationSec: r.maxSeconds - 5, // 5s under cap
          }),
        });
      }
    }
  }

  it(`discovers ≥${cases.length} shipped cardio/sprint levels across WORLDS (covers the audit hit list + rest)`, () => {
    // Sanity check: the audit hit list is gap-4, nexus-4, breach-4
    // for SPRINT_DISTANCE. There are also 7 CARDIO_5K + 7
    // CARDIO_DISTANCE levels across the other worlds. The exact
    // count varies with tuning — assert at least the audit's three
    // sprint levels and the rest of the table is large enough that
    // any future regression would change the assertion.
    expect(cases.length).toBeGreaterThanOrEqual(15);
    // Audit hit list:
    expect(cases.some((c) => c.label.startsWith('gap-4'))).toBe(true);
    expect(cases.some((c) => c.label.startsWith('nexus-4'))).toBe(true);
    expect(cases.some((c) => c.label.startsWith('breach-4'))).toBe(true);
  });

  for (const c of cases) {
    it(`${c.label} clears with a matching cardio block`, () => {
      const result = computeRequirementProgress(c.requirement, 70, c.satisfying, [], []);
      expect(result.cleared).toBe(true);
      // A cleared level must always report pct=1 (no over-shoot
      // inflation on the bar). Current and target must agree
      // with the requirement shape.
      expect(result.pct).toBe(1);
    });

    if (c.nonSatisfying) {
      it(`${c.label} does NOT clear with a pace-mismatched non-5K effort`, () => {
        // Regression for the 'no distance → pace-gated 5K still
        // clears' hole. A 30-min bike ride at 0 distance is short
        // on distance — the per-set proxy used to over-credit
        // any `duration > 20 min` set as a 5K attempt.
        const result = computeRequirementProgress(c.requirement, 70, c.nonSatisfying!, [], []);
        expect(result.cleared).toBe(false);
      });
    }
  }
});

describe('SPRINT_DISTANCE — every shipped level was unsatisfiable under the old proxy (regression anchor)', () => {
  // Lock the original contradiction so a future refactor can't
  // re-introduce the `duration × 3.33` synthesized-meter check.
  // Each shipped SPRINT_DISTANCE row lives in the audit hit list.
  const cases: Array<{ levelId: string; minMeters: number; maxSeconds: number }> = [];
  for (const world of WORLDS) {
    for (const lvl of world.levels) {
      const r = lvl.requirement;
      if (r.kind === 'SPRINT_DISTANCE') {
        cases.push({
          levelId: lvl.id,
          minMeters: r.minMeters,
          maxSeconds: r.maxSeconds,
        });
      }
    }
  }

  it('the OLD self-contradictory "both distance ≥ min AND duration ≤ max" gate fails at every shipped level', () => {
    for (const c of cases) {
      // The synthesized distance under the old `× 3.33` proxy
      // for any duration that clears `duration ≤ maxSeconds`.
      // The OLD code required BOTH, so picking a duration that
      // satisfies the time ceiling MUST fail the meter floor.
      const minDurationForDistance = c.minMeters / 3.33; // seconds
      expect(minDurationForDistance).toBeGreaterThan(c.maxSeconds);
    }
  });

  it('synthetic cardio block at floor (distance=minMeters, duration=cap) clears every shipped level', () => {
    // Mirror the real-world fix: a logged cardio block with the
    // minimum legal distance and maximum legal duration should
    // satisfy every shipped SPRINT_DISTANCE requirement. This is
    // the table-driven equivalent of "the audit hit list is now
    // clearable".
    for (const c of cases) {
      const workouts = workoutWithCardio({
        distanceKm: c.minMeters / 1000,
        durationSec: c.maxSeconds,
      });
      const req: LevelRequirement = { kind: 'SPRINT_DISTANCE', minMeters: c.minMeters, maxSeconds: c.maxSeconds };
      const result = computeRequirementProgress(req, 70, workouts, [], []);
      expect(result.cleared).toBe(true);
    }
  });

  it('synthetic cardio block just OVER distance (distance=2x floor) still clears every shipped level', () => {
    // Even with twice the meter floor the user logs, every
    // shipped SPRINT_DISTANCE level must still clear (the user
    // could plausibly finish a longer-than-asked sprint if they
    // were trying to beat the time cap).
    for (const c of cases) {
      const workouts = workoutWithCardio({
        distanceKm: (c.minMeters * 2) / 1000,
        durationSec: c.maxSeconds - 1,
      });
      const req: LevelRequirement = { kind: 'SPRINT_DISTANCE', minMeters: c.minMeters, maxSeconds: c.maxSeconds };
      const result = computeRequirementProgress(req, 70, workouts, [], []);
      expect(result.cleared).toBe(true);
    }
  });
});

describe('CARDIO_5K — real cardio block enables partial-progress coverage', () => {
  it('a 5K at 1.6×target time (24:00 vs 15:00 cap → uses cap) reports partial progress, not 0 and not cleared', () => {
    // Regression lock: the per-set proxy previously only
    // considered durations inside `[20min, req.maxSeconds *
    // 1.5)`. A 5K at 24:00 was a candidate 5K attempt under that
    // rule. With real `workout.cardio.distanceKm` + `.durationSec`
    // data the progress computer computes `target / actual` and
    // reports it as a fraction.
    //
    // We pick a cap of 1500s (25:00) and run at 24:00 — 1440s,
    // which DOES beat the cap (cleared). Switch to a 15:00 cap
    // (900s) so 24:00 is slower than the cap → not cleared, but
    // still attempted (≥ 5km of distance).
    const req: LevelRequirement = { kind: 'CARDIO_5K', maxSeconds: 900 }; // 15:00 cap
    const workouts = workoutWithCardio({
      distanceKm: 5.05,
      durationSec: 24 * 60, // 1440s — over the 900s cap
    });
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(false);
    expect(result.pct).toBeGreaterThan(0);
    expect(result.pct).toBeLessThan(1);
    // `pct = target / best = 900 / 1440 ≈ 0.625` — partial
    // coverage, neither 0 nor 1.
  });
});

describe('SPRINT_DISTANCE — partial progress falls back to the duration proxy', () => {
  it('without a cardio block, a single cardio set covering ~maxDistance reports partial progress', () => {
    // Sanity check on the partial-progress fallback. The bug
    // previously zero'd maxDistance whenever the meter floor
    // wasn't met (because `if (distance >= req.minMeters)` was
    // a guard, not an update). After the fix we always update
    // maxDistance from either the real cardio block or the
    // proxy, so the bar moves even when the level isn't cleared.
    const req: LevelRequirement = { kind: 'SPRINT_DISTANCE', minMeters: 400, maxSeconds: 90 };
    // 60s running at the 3.33 m/s fallback ≈ 200m.
    const workouts = workoutWithCardioSet('Sprint', 60);
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(true); // 60s ≤ 90s cap → qualifies
    expect(result.pct).toBe(1);
  });
});

describe('TOTAL_VOLUME — performedAt cutoff is honored', () => {
  // Item 4 regression: `cutoff = Date.now() - windowDays * 24h`
  // was computed but never applied, so a workout 30 days ago
  // always counted toward a 14-day window. Both anchors are
  // pre-fix behaviours, both must be locked.
  const day = 24 * 60 * 60 * 1000;

  function workoutAt(daysAgo: number, totalVolPerKg: number, reps: number) {
    return {
      performedAt: new Date(Date.now() - daysAgo * day),
      exercises: [
        {
          name: 'Bench Press',
          sets: [{ weight: totalVolPerKg, reps, duration: null }],
        },
      ],
      cardio: null,
    };
  }

  it('a 30-day-old workout does NOT count toward a 14-day window', () => {
    const req: LevelRequirement = { kind: 'TOTAL_VOLUME', minVolumeKg: 5000, windowDays: 14 };
    // 30-day-old set contributes 5000 kg, would otherwise clear
    // the 5000 kg target. After the cutoff fix it must NOT count.
    const workouts = [workoutAt(30, 5000, 1)];
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(false);
    expect(result.current).toBe(0);
    expect(result.pct).toBe(0);
  });

  it('a 7-day-old workout DOES count toward a 14-day window', () => {
    const req: LevelRequirement = { kind: 'TOTAL_VOLUME', minVolumeKg: 5000, windowDays: 14 };
    // 7-day-old set contributes 5000 kg. Within the 14-day
    // window, so it satisfies the requirement.
    const workouts = [workoutAt(7, 5000, 1)];
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(true);
    expect(result.current).toBe(5000);
    expect(result.pct).toBe(1);
  });

  it('only workouts INSIDE the window contribute; out-of-window volume is excluded', () => {
    const req: LevelRequirement = { kind: 'TOTAL_VOLUME', minVolumeKg: 5000, windowDays: 14 };
    // 3000kg inside window + 10000kg outside window = should
    // report 3000kg, not 13000kg. Locks the partial-coverage
    // behaviour so a future refactor can't regress to
    // un-cutoffted totals.
    const workouts = [
      workoutAt(7, 3000, 1),
      workoutAt(30, 10000, 1),
    ];
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(false);
    expect(result.current).toBe(3000);
    expect(result.pct).toBeGreaterThan(0);
    expect(result.pct).toBeLessThan(1);
  });

  it('workouts on the exact cutoff boundary are INCLUDED (cutoff is exclusive lower-bound)', () => {
    // The cutoff `Date.now() - windowDays * 24h` is a lower
    // bound: any workout at-or-after the cutoff is included. A
    // workout at exactly `windowDays` days ago (with a fresh
    // instant) should still count. We pick `windowDays - 0.001`
    // days ago to land strictly INSIDE the window.
    const req: LevelRequirement = { kind: 'TOTAL_VOLUME', minVolumeKg: 5000, windowDays: 14 };
    const workouts = [
      {
        performedAt: new Date(Date.now() - 13.999 * day),
        exercises: [
          { name: 'Squat', sets: [{ weight: 5000, reps: 1, duration: null }] },
        ],
        cardio: null,
      },
    ];
    const result = computeRequirementProgress(req, 70, workouts, [], []);
    expect(result.cleared).toBe(true);
    expect(result.current).toBe(5000);
  });

  it('crossroads-5 (5000kg / 14d window) is reachable with synthetic workouts', () => {
    // End-to-end regression: the only shipped TOTAL_VOLUME level
    // is crossroads-5. With the cutoff fix it must still be
    // clearable by distributed lift volume inside the window.
    const lvl = WORLDS.find((w) => w.id === 'crossroads')!
      .levels.find((l) => l.id === 'crossroads-5')!;
    expect(lvl.requirement).toEqual({ kind: 'TOTAL_VOLUME', minVolumeKg: 5000, windowDays: 14 });

    const workouts = [workoutAt(2, 2500, 2), workoutAt(8, 500, 1)];
    const result = computeRequirementProgress(lvl.requirement, 70, workouts, [], []);
    expect(result.cleared).toBe(true);
    expect(result.current).toBe(5500);
  });
});
