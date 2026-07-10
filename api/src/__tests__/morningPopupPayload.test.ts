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
    durationSec: z.number().nullable(),
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
  // Server-side dismissal flag for *today* in the user's tz.
  // Drives the popup's show/hide check so dismissals carry across
  // devices (Android app + web desktop have separate localStorage
  // areas). See migration 20260708030000_morning_popup_dismissal.
  // New in v1.0.38; older test samples predate it so we mark
  // optional.
  dismissed: z.boolean().optional(),
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
        { id: 'w1', name: 'Push', type: 'STRENGTH', durationSec: 3600, performedAt: '2026-06-29T14:00:00.000Z' },
        { id: 'w2', name: 'PM conditioning', type: 'CARDIO', durationSec: 1800, performedAt: '2026-06-29T18:00:00.000Z' },
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
      heartLoss: [
        { id: 'hle-1', kind: 'MISSED_WORKOUT', details: 'foo', sourceDate: '2026-06-29' },
      ],
    };
    expect(MorningPopupPayload.parse(sample).heartLoss).toHaveLength(1);
  });

  it('accepts a dismissed=true response (cross-device dismissal state)', () => {
    const sample = {
      date: '2026-07-08',
      mode: 'CASUAL',
      level: 4,
      xp: 120,
      hearts: 5,
      dailies: { date: '2026-07-08', counts: { total: 0, completed: 0 } },
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
      dismissed: true,
    };
    expect(MorningPopupPayload.parse(sample).dismissed).toBe(true);
  });

  it('defaults dismissed to false when the field is omitted (older client)', () => {
    const sample = {
      date: '2026-07-08',
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
    const parsed = MorningPopupPayload.parse(sample);
    expect(parsed.dismissed).toBeUndefined();
  });
});