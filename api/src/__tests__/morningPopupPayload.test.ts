/**
 * Tests for the morning-popup payload builder. The popup drives
 * the user's first interaction of the day — missed-dailies
 * recovery + health/level animations — so the payload shape
 * must stay stable.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const MorningPopupPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['CASUAL', 'HARDCORE']),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  hearts: z.number().int().min(0).max(5),
  dailies: z.any(), // shape covered by /dailies/today
  // Full workout list for the day — used by the Calendar page
  // to render every session. New in 2309089; older test samples
  // predate this so we mark it optional.
  workouts: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    type: z.string(),
    duration: z.number().nullable(),
    performedAt: z.string(),
  })).optional(),
  recap: z.object({
    workoutLogged: z.boolean(),
    workoutCount: z.number().int().min(0),
    workoutNames: z.array(z.string()),
    sleepHours: z.number().nullable(),
    weighInLogged: z.boolean(),
    latestWeightKg: z.number().nullable(),
    recoveryScore: z.number().nullable(),
  }),
  heartLoss: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    details: z.string().nullable(),
    sourceDate: z.string(),
  })),
});

describe('MorningPopupPayload schema', () => {
  it('accepts the shape returned by /dailies/morning-popup', () => {
    const sample = {
      date: '2026-06-29',
      mode: 'CASUAL' as const,
      level: 4,
      xp: 120,
      hearts: 5,
      dailies: { date: '2026-06-29', counts: { total: 3, completed: 2 } },
      workouts: [
        { id: 'w1', name: 'Push', type: 'STRENGTH', duration: 3600, performedAt: '2026-06-29T14:00:00.000Z' },
        { id: 'w2', name: 'PM conditioning', type: 'CARDIO', duration: 1800, performedAt: '2026-06-29T18:00:00.000Z' },
      ],
      recap: {
        workoutLogged: true,
        workoutCount: 2,
        workoutNames: ['Push', 'PM conditioning'],
        sleepHours: 7.2,
        weighInLogged: false,
        latestWeightKg: 175.5,
        recoveryScore: 72,
      },
      heartLoss: [],
    };
    expect(MorningPopupPayload.parse(sample)).toEqual(sample);
  });

  it('requires a YYYY-MM-DD date', () => {
    const sample = {
      date: 'not-a-date',
      mode: 'CASUAL',
      level: 1,
      xp: 0,
      hearts: 5,
      dailies: {},
      recap: {
        workoutLogged: false,
        workoutCount: 0,
        workoutNames: [],
        sleepHours: null,
        weighInLogged: false,
        latestWeightKg: null,
        recoveryScore: null,
      },
      heartLoss: [],
    };
    expect(() => MorningPopupPayload.parse(sample)).toThrow();
  });

  it('accepts heart-loss events array (empty is fine for Casual)', () => {
    const sample = {
      date: '2026-06-29',
      mode: 'CASUAL',
      level: 4,
      xp: 120,
      hearts: 5,
      dailies: {},
      recap: {
        workoutLogged: false,
        workoutCount: 0,
        workoutNames: [],
        sleepHours: null,
        weighInLogged: false,
        latestWeightKg: null,
        recoveryScore: null,
      },
      heartLoss: [
        { id: 'hle-1', kind: 'MISSED_WORKOUT', details: 'foo', sourceDate: '2026-06-29' },
      ],
    };
    expect(MorningPopupPayload.parse(sample).heartLoss).toHaveLength(1);
  });
});