/**
 * Tests for the superset round-robin walker.
 *
 * `buildRoundRobinOrder` is the core algorithm that turns a flat
 * PlannedExercise[] (some of which may be paired via groupIndex) into
 * a flat walk order. The live logger advances one entry at a time,
 * so this function is the difference between "go linearly through
 * exercises" and "alternate 1A → 1B → 2A → 2B" for supersets.
 */
import { describe, it, expect } from 'vitest';
import { buildRoundRobinOrder, currentPositionLabel } from '../lib/supersetRoundRobin';

type PlannedExercise = {
  name: string;
  groupIndex: number | null;
  sets: Array<{ targetReps: number }>;
};

function ex(name: string, groupIndex: number | null, setCount: number): PlannedExercise {
  return {
    name,
    groupIndex,
    sets: Array.from({ length: setCount }, (_, i) => ({ targetReps: 8 })),
  };
}

describe('buildRoundRobinOrder — empty input', () => {
  it('returns [] for an empty plan', () => {
    expect(buildRoundRobinOrder([])).toEqual([]);
  });
});

describe('buildRoundRobinOrder — un-paired exercises', () => {
  it('walks three singletons linearly in array order', () => {
    const plan = [ex('A', null, 3), ex('B', null, 2), ex('C', null, 1)];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { ex: ex.name, set: e.setIndex };
    })).toEqual([
      { ex: 'A', set: 0 },
      { ex: 'A', set: 1 },
      { ex: 'A', set: 2 },
      { ex: 'B', set: 0 },
      { ex: 'B', set: 1 },
      { ex: 'C', set: 0 },
    ]);
    // All un-paired → no labels.
    expect(order.every((e) => e.label === null)).toBe(true);
  });
});

describe('buildRoundRobinOrder — paired exercises', () => {
  it('alternates A and B when both have 3 sets', () => {
    const plan = [ex('A', 1, 3), ex('B', 1, 3)];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { ex: ex.name, set: e.setIndex, label: e.label };
    })).toEqual([
      { ex: 'A', set: 0, label: '1A' },
      { ex: 'B', set: 0, label: '1B' },
      { ex: 'A', set: 1, label: '1A' },
      { ex: 'B', set: 1, label: '1B' },
      { ex: 'A', set: 2, label: '1A' },
      { ex: 'B', set: 2, label: '1B' },
    ]);
  });

  it('stops at the shorter member when set counts differ', () => {
    const plan = [ex('A', 1, 3), ex('B', 1, 2)];
    const order = buildRoundRobinOrder(plan);
    // A1, B1, A2, B2, A3 — B has no 3rd set so the walk ends there
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { ex: ex.name, set: e.setIndex };
    })).toEqual([
      { ex: 'A', set: 0 },
      { ex: 'B', set: 0 },
      { ex: 'A', set: 1 },
      { ex: 'B', set: 1 },
      { ex: 'A', set: 2 },
    ]);
  });

  it('round-robins a 3-exercise group (A=1A, B=1B, C=1C)', () => {
    const plan = [ex('A', 1, 2), ex('B', 1, 2), ex('C', 1, 2)];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => e.label)).toEqual(['1A', '1B', '1C', '1A', '1B', '1C']);
  });

  it('walks groups in array order when multiple pairs exist', () => {
    const plan = [
      ex('A', 1, 2), ex('B', 1, 2),  // pair 1
      ex('C', 2, 2), ex('D', 2, 2),  // pair 2
    ];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { name: ex.name, label: e.label };
    })).toEqual([
      { name: 'A', label: '1A' },
      { name: 'B', label: '1B' },
      { name: 'A', label: '1A' },
      { name: 'B', label: '1B' },
      { name: 'C', label: '2A' },
      { name: 'D', label: '2B' },
      { name: 'C', label: '2A' },
      { name: 'D', label: '2B' },
    ]);
  });

  it('mixes paired and un-paired correctly (1A, 1B, solo, 2A, 2B)', () => {
    const plan = [
      ex('A', 1, 2), ex('B', 1, 2),
      ex('C', null, 2),
      ex('D', 2, 2), ex('E', 2, 2),
    ];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { name: ex.name, label: e.label };
    })).toEqual([
      { name: 'A', label: '1A' },
      { name: 'B', label: '1B' },
      { name: 'A', label: '1A' },
      { name: 'B', label: '1B' },
      { name: 'C', label: null },
      { name: 'C', label: null },
      { name: 'D', label: '2A' },
      { name: 'E', label: '2B' },
      { name: 'D', label: '2A' },
      { name: 'E', label: '2B' },
    ]);
  });
});

describe('buildRoundRobinOrder — single-pair edge cases', () => {
  it('handles a pair with the FIRST exercise having zero sets', () => {
    const plan = [ex('A', 1, 0), ex('B', 1, 2)];
    const order = buildRoundRobinOrder(plan);
    // A contributes nothing; only B's sets are walked.
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { name: ex.name, set: e.setIndex };
    })).toEqual([
      { name: 'B', set: 0 },
      { name: 'B', set: 1 },
    ]);
  });

  it('handles a singleton groupIndex (only one member)', () => {
    // Defensive: a groupIndex attached to only one exercise is treated
    // as a singleton (walks linearly). The Routines page won't produce
    // this shape but the API accepts it.
    const plan = [ex('A', 1, 2)];
    const order = buildRoundRobinOrder(plan);
    expect(order.map((e) => {
      const ex = plan[e.exerciseIndex]!; // exerciseIndex is bounded by the buildRoundRobinOrder output contract
      return { name: ex.name, set: e.setIndex, label: e.label };
    })).toEqual([
      { name: 'A', set: 0, label: null },
      { name: 'A', set: 1, label: null },
    ]);
  });
});

describe('currentPositionLabel', () => {
  const plan = [
    ex('A', 1, 3),
    ex('B', 1, 3),
    ex('C', null, 2),
  ];

  it('returns the pair label for paired exercises', () => {
    expect(currentPositionLabel(plan, 0)).toBe('1A');
    expect(currentPositionLabel(plan, 1)).toBe('1B');
  });

  it('returns null for un-paired exercises', () => {
    expect(currentPositionLabel(plan, 2)).toBeNull();
  });

  it('returns null for an out-of-range index', () => {
    expect(currentPositionLabel(plan, 99)).toBeNull();
  });
});