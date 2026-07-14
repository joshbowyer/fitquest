/**
 * Round-robin walker for supersets in the live workout logger.
 *
 * When a workout plan has paired exercises (two exercises sharing
 * the same `groupIndex`), the live logger should walk them in
 * alternating order — set 1 of A, set 1 of B, set 2 of A, set 2 of B,
 * etc. — so the user actually does supersets the way they're
 * defined. Un-paired exercises (groupIndex = null) walk linearly
 * in array order.
 *
 * Exported as a pure helper so the unit test (`roundRobin.test.ts`)
 * can verify the algorithm against concrete cases without mounting
 * the full React component.
 */

export type PlannedExerciseLite = {
  name: string;
  /** Superset pairing. Null = walk linearly. */
  groupIndex: number | null;
  sets: ReadonlyArray<unknown>;
};

export type RoundEntry = {
  /** Index back into the PlannedExercise[] array. */
  exerciseIndex: number;
  /** Index back into the exercise's sets[] array. */
  setIndex: number;
  /** "1A" / "1B" / null. Null for un-paired exercises. */
  label: string | null;
};

/**
 * Build the round-robin walk order.
 *
 * Algorithm:
 *   1. Group exercises by groupIndex. Preserve first-occurrence
 *      order so the order walks in the order the user defined the
 *      plan. Exercises with groupIndex = null are singletons.
 *   2. For each group, take one set at a time from each member
 *      (members in array order, sets in ascending index). Walk for
 *      `max set count` rounds, skipping members whose set list is
 *      shorter than the round index.
 *   3. The result is a flat list of (exerciseIndex, setIndex, label)
 *      tuples that the live logger advances through with a single
 *      integer counter.
 *
 * Examples (label shown in parens):
 *   [A null, B null, C null]   →  A0 A1 A2 B0 B1 B2 C0 C1
 *   [A=1, B=1, C null]         →  A0 B0 A1 B1 A2 B2 C0 C1
 *   [A=1, B=1, C=2, D=2]       →  A0 B0 A1 B1 C0 D0 A2 B2 C1 D1
 */
export function buildRoundRobinOrder(
  exercises: ReadonlyArray<PlannedExerciseLite>,
): RoundEntry[] {
  // Step 1: group exercises by groupIndex. Preserve first-occurrence
  // order so the round-robin walks pairs in the order the user
  // defined them in the Routines page.
  const groups: Array<{ groupIndex: number | null; exIndices: number[] }> = [];
  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];
    if (!exercise) continue;
    const gi = exercise.groupIndex;
    if (gi == null) {
      groups.push({ groupIndex: null, exIndices: [i] });
      continue;
    }
    const existing = groups.find((g) => g.groupIndex === gi);
    if (existing) {
      existing.exIndices.push(i);
    } else {
      groups.push({ groupIndex: gi, exIndices: [i] });
    }
  }

  // Step 2: walk each group, emitting one entry per set per round.
  const order: RoundEntry[] = [];
  for (const group of groups) {
    const isPaired = group.exIndices.length > 1;
    if (!isPaired) {
      const exIdx = group.exIndices[0];
      if (exIdx === undefined) continue;
      const exercise = exercises[exIdx];
      if (!exercise) continue;
      for (let s = 0; s < exercise.sets.length; s++) {
        order.push({ exerciseIndex: exIdx, setIndex: s, label: null });
      }
      continue;
    }
    // Round-robin for paired groups. The most-set member dictates
    // how many rounds we walk. Members with fewer sets get skipped
    // once they're out of sets.
    const maxSets = Math.max(
      ...group.exIndices.map((i) => exercises[i]?.sets.length ?? 0),
    );
    for (let s = 0; s < maxSets; s++) {
      for (let pos = 0; pos < group.exIndices.length; pos++) {
        const exIdx = group.exIndices[pos];
        if (exIdx === undefined) continue;
        const exercise = exercises[exIdx];
        if (!exercise) continue;
        if (s < exercise.sets.length) {
          order.push({
            exerciseIndex: exIdx,
            setIndex: s,
            // `<groupIndex><letter>` where letter = A, B, C, …
            // pos=0 → A, pos=1 → B, etc. Pairs of >2 produce C, D, …
            label: `${group.groupIndex}${String.fromCharCode(65 + pos)}`,
          });
        }
      }
    }
  }
  return order;
}

/**
 * Pretty label for the "current exercise" position readout.
 * Returns null for un-paired exercises so the caller can fall back
 * to the exercise name without showing a stray "0A" badge.
 */
export function currentPositionLabel(
  exercises: ReadonlyArray<PlannedExerciseLite>,
  exerciseIndex: number,
): string | null {
  const ex = exercises[exerciseIndex];
  if (!ex || ex.groupIndex == null) return null;
  const members = exercises
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.groupIndex === ex.groupIndex);
  const pos = members.findIndex((m) => m.i === exerciseIndex);
  if (pos < 0) return null;
  return `${ex.groupIndex}${String.fromCharCode(65 + pos)}`;
}