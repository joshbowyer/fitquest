/**
 * Pure-logic tests for the AI Coach library.
 *
 * Covers the personality-selection plumbing (effectivePersonality),
 * the prompt composition (coachSystemPrompt), and the available-list
 * integrity (every enum value appears exactly once with non-empty
 * label + blurb).
 *
 * gatherCoachContext is not tested here — it's a DB-bound helper that
 * would need full prisma mocking; the route-level test would be a
 * better place to catch regressions there (TODO if/when integration
 * coverage lands).
 */
import { describe, it, expect } from 'vitest';
import {
  COACH_PERSONALITIES,
  DEFAULT_COACH_PERSONALITY,
  coachSystemPrompt,
  effectivePersonality,
} from '../lib/coach';
import { CoachPersonality } from '../lib/prisma';

describe('coach — effectivePersonality', () => {
  it('falls back to DEFAULT_COACH_PERSONALITY when the user has nothing stored', () => {
    expect(effectivePersonality(null)).toBe(DEFAULT_COACH_PERSONALITY);
    expect(effectivePersonality(undefined)).toBe(DEFAULT_COACH_PERSONALITY);
  });

  it('preserves the user\'s explicit choice (including GENERIC)', () => {
    // GENERIC is a real choice, not "no choice" — a user might
    // explicitly opt into the neutral voice, and the picker
    // surfaces "saved" on it. The old code conflated null with
    // "explicit GENERIC" which made the picker show GENERIC as
    // un-selected after explicit save.
    for (const p of COACH_PERSONALITIES) {
      expect(effectivePersonality(p.key)).toBe(p.key);
    }
  });

  it('the default is the FitQuest voice (PRIEST_BODYBUILDER)', () => {
    // The roadmap pins the default personality to the FitQuest
    // voice so a first-time /coach visitor sees something thematically
    // appropriate rather than the bland GENERIC option.
    expect(DEFAULT_COACH_PERSONALITY).toBe('PRIEST_BODYBUILDER');
  });
});

describe('coach — coachSystemPrompt', () => {
  it('every personality produces a non-empty prompt with the shared preamble', () => {
    for (const p of COACH_PERSONALITIES) {
      const sys = coachSystemPrompt(p.key);
      expect(sys.length).toBeGreaterThan(200);
      // Shared preamble fragments every prompt must carry.
      expect(sys).toContain('You are the FitQuest AI Coach');
      expect(sys).toContain('PERSONALITY:');
      expect(sys).toContain('WORLD CONTEXT:');
      // The prompt for each personality should have at least one
      // sentence that distinguishes it from the others. GENERIC
      // deliberately has no persona markers (it's the neutral
      // baseline), so we only check "has SOME content after
      // PERSONALITY:" for it.
      const personalitySlice = sys.split('PERSONALITY:')[1]?.split('WORLD CONTEXT:')[0] ?? '';
      expect(personalitySlice.trim().length).toBeGreaterThan(100);
    }
  });

  it('PRIEST_BODYBUILDER carries the Catholic voice markers', () => {
    const sys = coachSystemPrompt('PRIEST_BODYBUILDER');
    expect(sys).toMatch(/priest|parish|yoke|monastic/i);
  });

  it('DRILL_SERGEANT carries the direct-voice markers', () => {
    const sys = coachSystemPrompt('DRILL_SERGEANT');
    // Drill-sergeant voice is imperative + no-nonsense.
    expect(sys).toMatch(/direct|imperative|discipline/i);
  });

  it('BOB_ROSS never uses negative framing (the only personality with that constraint)', () => {
    const sys = coachSystemPrompt('BOB_ROSS');
    // The whole point of Bob Ross: never say "failed" / "missed".
    expect(sys).toMatch(/never negative|affirming/i);
    expect(sys).toMatch(/happy little/i);
  });

  it('ZOOMER carries the gym-bro voice markers', () => {
    const sys = coachSystemPrompt('ZOOMER');
    expect(sys).toMatch(/aesthetic|pump|shrek|gym-bro/i);
  });

  it('GENERIC carries no persona markers (intentionally neutral)', () => {
    const sys = coachSystemPrompt('GENERIC');
    // GENERIC should read like a polite AI health assistant with no
    // persona. The absence of persona markers is the whole point.
    expect(sys).not.toMatch(/priest|monastic|drill sergeant|aesthetic|happy little/i);
  });

  it('includes the FitQuest world context (classes, modes) so the coach doesn\'t invent wrong info', () => {
    const sys = coachSystemPrompt('GENERIC');
    // Class names + mode names appear in the world context block.
    // The text is "Hardcore mode = …" / "Casual mode = …" — title
    // case — so we check case-insensitively for the enum names
    // rather than the ALL-CAPS form.
    expect(sys).toContain('FitQuest');
    expect(sys).toContain('PHANTOM');
    expect(sys.toLowerCase()).toContain('hardcore');
    expect(sys.toLowerCase()).toContain('casual');
  });
});

describe('coach — COACH_PERSONALITIES list integrity', () => {
  it('has exactly one entry per enum value (no duplicates, no gaps)', () => {
    // The picker UI iterates this array; if a new enum value is
    // added to schema.prisma but not here, the picker silently
    // drops it.
    const enumValues = Object.values(CoachPersonality) as string[];
    const listKeys = COACH_PERSONALITIES.map((p) => p.key);

    expect(listKeys.sort()).toEqual(enumValues.sort());
    // No duplicates.
    expect(new Set(listKeys).size).toBe(listKeys.length);
  });

  it('every entry has a non-empty label, blurb, and icon', () => {
    for (const p of COACH_PERSONALITIES) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.blurb.trim().length).toBeGreaterThan(5);
      // Icons are single Unicode chars (or at most 2 for compound
      // graphemes like '⚔'). Allow up to 4 graphemes.
      expect(p.icon.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeLessThan(8);
    }
  });
});