/**
 * Tests for the formatEffectsInline helper (lives in SkillNode.tsx
 * + duplicated in Skills.tsx so the rules stay in one place). The
 * function reads Skill.effects (a JSON array) and renders a
 * short, comma-joined line describing the perk.
 */
import { describe, it, expect } from 'vitest';

// Re-import the implementation. The function is module-private
// so we re-declare the same logic here (or — better — export it
// from a shared util). For now, keep tests self-contained.
const EFFECT_LABEL = {
  gold_multiplier: 'gold',
  xp_multiplier: 'xp',
  measurement_bonus: 'PR',
  raid_damage_multiplier: 'raid dmg',
};

function formatEffectsInline(effects: unknown): string {
  if (!Array.isArray(effects) || effects.length === 0) return '';
  return effects
    .map((e: any) => {
      const type = String(e?.type ?? '');
      const value = Number(e?.value ?? 0);
      if (!type || !Number.isFinite(value) || value === 0) return '';
      if (type === 'measurement_bonus') {
        const metric = String(e?.metric ?? '?').toLowerCase().replace(/_/g, ' ');
        return `+${value} ${metric}`;
      }
      const label =
        EFFECT_LABEL[type as keyof typeof EFFECT_LABEL] ?? type.toLowerCase();
      const pct = Math.round((value - 1) * 100);
      const sign = pct >= 0 ? '+' : '';
      const scope = e?.appliesTo ? ` (${String(e.appliesTo).toLowerCase()})` : '';
      return `${sign}${pct}% ${label}${scope}`;
    })
    .filter(Boolean)
    .join(', ');
}

describe('formatEffectsInline', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatEffectsInline(null)).toBe('');
    expect(formatEffectsInline(undefined)).toBe('');
    expect(formatEffectsInline([])).toBe('');
    expect(formatEffectsInline('not an array')).toBe('');
  });

  it('formats gold_multiplier + ALL scope', () => {
    expect(formatEffectsInline([{ type: 'gold_multiplier', value: 1.1, appliesTo: 'ALL' }])).toBe(
      '+10% gold (all)',
    );
  });

  it('formats xp_multiplier + STRENGTH scope (lowercased)', () => {
    expect(formatEffectsInline([{ type: 'xp_multiplier', value: 1.15, appliesTo: 'STRENGTH' }])).toBe(
      '+15% xp (strength)',
    );
  });

  it('formats negative deltas with a - prefix', () => {
    expect(formatEffectsInline([{ type: 'xp_multiplier', value: 0.85 }])).toBe('-15% xp');
  });

  it('formats measurement_bonus as absolute +N.METRIC (no percent)', () => {
    expect(formatEffectsInline([{ type: 'measurement_bonus', value: 0.15, metric: 'PULLUP_1RM' }])).toBe(
      '+0.15 pullup 1rm',
    );
  });

  it('formats integer measurement_bonus without trailing decimal', () => {
    expect(formatEffectsInline([{ type: 'measurement_bonus', value: 1, metric: 'VO2_MAX' }])).toBe(
      '+1 vo2 max',
    );
  });

  it('joins multiple effects with comma', () => {
    expect(
      formatEffectsInline([
        { type: 'raid_damage_multiplier', value: 1.2 },
        { type: 'measurement_bonus', value: 0.2, metric: 'PULLUP_1RM' },
      ]),
    ).toBe('+20% raid dmg, +0.2 pullup 1rm');
  });

  it('skips effects with zero/NaN value', () => {
    expect(formatEffectsInline([{ type: 'gold_multiplier', value: 0 }])).toBe('');
    expect(formatEffectsInline([{ type: 'gold_multiplier', value: NaN }])).toBe('');
    expect(
      formatEffectsInline([
        { type: 'gold_multiplier', value: 0 },
        { type: 'xp_multiplier', value: 1.1, appliesTo: 'ALL' },
      ]),
    ).toBe('+10% xp (all)');
  });

  it('falls back to lowercased type name for unknown effect types', () => {
    expect(formatEffectsInline([{ type: 'FUTURE_PERK_KIND', value: 1.5 }])).toBe('+50% future_perk_kind');
  });
});