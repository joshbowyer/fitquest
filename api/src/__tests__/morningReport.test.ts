/**
 * Tests for buildPenalties — the deterministic Hardcore-mode
 * penalty ledger builder. Doesn't touch the LLM path; just verifies
 * the rule logic that decides when a penalty fires.
 */
import { describe, it, expect } from 'vitest';
import { buildPenalties, type Penalty, type ReportPayload } from '../lib/morningReport';
import { HARDCORE_SUBSTANCE_CAPS } from '../lib/mode';

function makePayload(overrides: Partial<{
  mode: 'CASUAL' | 'HARDCORE';
  hearts: number;
  caffeineLast24h: number;
  alcoholLast7d: number;
  nicotineLast7d: number;
  currentStreak: number;
  brokenThisWeek: boolean;
}> = {}): ReportPayload {
  return {
    generatedAt: '2026-06-23T00:00:00Z',
    user: { class: 'PHANTOM', level: 4, xp: 100, ordained: false },
    sleep: { last7: null, prior7: null, deltaPct: null, coverageDays: 0 },
    sleepQuality: { last7: null, prior7: null, deltaPct: null, coverageDays: 0 },
    hrv: { last7: null, prior7: null, deltaPct: null, coverageDays: 0 },
    weight: { last7: null, prior7: null, deltaPct: null, coverageDays: 0 },
    bodyFat: { last7: null, prior7: null, deltaPct: null, coverageDays: 0 },
    workouts: {
      last7: { count: 0, volume: 0, minutes: 0, byType: {} },
      prior7: { count: 0, volume: 0, minutes: 0, byType: {} },
      deltaPct: null,
      coverageDays: 0,
    },
    habits: {
      last7: 0,
      prior7: 0,
      deltaPct: null,
      coverageDays: 0,
    },
    supplements: { daysLogged: 0, total: 0, adherencePct: 0 },
    spiritual: { prayerCount: 0, customDays: 0, daysHit: 0, totalMinutes: 0 },
    recovery: { score: null, trend: null },
    mode: overrides.mode ?? 'CASUAL',
    hearts: overrides.hearts ?? 5,
    streak: {
      currentStreak: overrides.currentStreak ?? 0,
      lastCompletedWeek: null,
      brokenThisWeek: overrides.brokenThisWeek ?? false,
    },
    substanceCounts: {
      caffeineLast24h: overrides.caffeineLast24h ?? 0,
      alcoholLast7d: overrides.alcoholLast7d ?? 0,
      nicotineLast7d: overrides.nicotineLast7d ?? 0,
      caffeineAllLast7d: 0,
    },
    // Engines wired into the gather payload. Defaults to empty so
    // existing penalty tests don't have to care about them — they
    // only assert on `buildPenalties` output.
    plateaus: [],
    nudges: { warnings: [], positive: [] },
    sleepOverlap: {
      windowDays: 7,
      nightsTotal: 0,
      lastNight: [],
      categories: [],
      supplements: [],
    },
    bodyBattery: {
      windowDays: 7,
      morningsTotal: 0,
      lastMorning: null,
      overlaps: [],
    },
    bodyFatSources: [],
  };
}

describe('buildPenalties', () => {
  it('returns empty array for Casual users regardless of state', () => {
    const penalties = buildPenalties(
      makePayload({
        mode: 'CASUAL',
        hearts: 0,
        caffeineLast24h: 99,
        alcoholLast7d: 99,
        brokenThisWeek: true,
        currentStreak: 10,
      }),
    );
    expect(penalties).toEqual([]);
  });

  it('returns empty array for Hardcore with full hearts and no caps', () => {
    const penalties = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 5 }));
    expect(penalties).toEqual([]);
  });

  describe('hearts', () => {
    it('fires a scold at 0 hearts', () => {
      const p = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 0 }));
      const heart = p.find((x) => x.label === 'Hearts');
      expect(heart).toBeDefined();
      expect(heart?.severity).toBe('scold');
      expect(heart?.note).toContain('halved');
    });

    it('fires a warn at 1-2 hearts (hearts low)', () => {
      const p1 = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 1 }));
      const p2 = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 2 }));
      expect(p1.find((x) => x.label === 'Hearts')?.severity).toBe('warn');
      expect(p2.find((x) => x.label === 'Hearts')?.severity).toBe('warn');
    });

    it('fires a soft warn at 3-4 hearts (recovery info)', () => {
      const p = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 3 }));
      const heart = p.find((x) => x.label === 'Hearts');
      expect(heart?.severity).toBe('warn');
      expect(heart?.note).toContain('3/5');
    });

    it('fires nothing at full 5 hearts', () => {
      const p = buildPenalties(makePayload({ mode: 'HARDCORE', hearts: 5 }));
      expect(p.find((x) => x.label === 'Hearts')).toBeUndefined();
    });
  });

  describe('substance caps', () => {
    it('fires caffeine warn when over daily cap by 1', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          caffeineLast24h: HARDCORE_SUBSTANCE_CAPS.caffeinePerDay + 1,
        }),
      );
      const c = p.find((x) => x.label === 'Caffeine');
      expect(c?.severity).toBe('warn');
    });

    it('fires caffeine scold when 2x over the cap', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          caffeineLast24h: HARDCORE_SUBSTANCE_CAPS.caffeinePerDay * 2,
        }),
      );
      expect(p.find((x) => x.label === 'Caffeine')?.severity).toBe('scold');
    });

    it('fires alcohol scold when 2x over weekly cap', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          alcoholLast7d: HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek * 2,
        }),
      );
      expect(p.find((x) => x.label === 'Alcohol')?.severity).toBe('scold');
    });

    it('fires alcohol warn when just over weekly cap', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          alcoholLast7d: HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek + 1,
        }),
      );
      expect(p.find((x) => x.label === 'Alcohol')?.severity).toBe('warn');
    });

    it('does NOT fire at exactly the cap (boundary)', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          caffeineLast24h: HARDCORE_SUBSTANCE_CAPS.caffeinePerDay,
          alcoholLast7d: HARDCORE_SUBSTANCE_CAPS.alcoholPerWeek,
        }),
      );
      expect(p.find((x) => x.label === 'Caffeine')).toBeUndefined();
      expect(p.find((x) => x.label === 'Alcohol')).toBeUndefined();
    });
  });

  describe('streak break', () => {
    it('fires when streak was positive and broken this week', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          currentStreak: 5,
          brokenThisWeek: true,
        }),
      );
      const s = p.find((x) => x.label === 'Streak');
      expect(s?.severity).toBe('warn');
      expect(s?.note).toContain('5-week');
    });

    it('does NOT fire when streak is 0 (no streak to break)', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          currentStreak: 0,
          brokenThisWeek: true,
        }),
      );
      expect(p.find((x) => x.label === 'Streak')).toBeUndefined();
    });

    it('does NOT fire when not broken this week', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          currentStreak: 5,
          brokenThisWeek: false,
        }),
      );
      expect(p.find((x) => x.label === 'Streak')).toBeUndefined();
    });
  });

  describe('multi-penalty', () => {
    it('can produce several at once', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          hearts: 0,
          caffeineLast24h: 10,
          alcoholLast7d: 10,
          currentStreak: 4,
          brokenThisWeek: true,
        }),
      );
      const labels = p.map((x) => x.label);
      expect(labels).toContain('Hearts');
      expect(labels).toContain('Caffeine');
      expect(labels).toContain('Alcohol');
      expect(labels).toContain('Streak');
      expect(p.length).toBe(4);
    });

    it('produces at most one of each label', () => {
      const p = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          hearts: 0,
          caffeineLast24h: 99,
        }),
      );
      const labels = p.map((x) => x.label);
      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  describe('shape', () => {
    it('every entry has label, severity, and note', () => {
      const p: Penalty[] = buildPenalties(
        makePayload({
          mode: 'HARDCORE',
          hearts: 0,
          caffeineLast24h: 10,
          alcoholLast7d: 10,
        }),
      );
      for (const entry of p) {
        expect(typeof entry.label).toBe('string');
        expect(entry.label.length).toBeGreaterThan(0);
        expect(['warn', 'scold']).toContain(entry.severity);
        expect(typeof entry.note).toBe('string');
        expect(entry.note.length).toBeGreaterThan(0);
      }
    });
  });
});