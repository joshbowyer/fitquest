/**
 * Tests for the world → loot table mapping. The drop helpers should
 * filter candidates by class affiliation when a worldId is provided,
 * and stay unfiltered when the world is NEUTRAL.
 */
import { describe, it, expect } from 'vitest';
import { classForWorld } from '../lib/worlds.js';

describe('classForWorld — world → class mapping', () => {
  it('Spire maps to JUGGERNAUT', () => {
    expect(classForWorld('spire')).toBe('JUGGERNAUT');
  });

  it('Glade maps to PHANTOM', () => {
    expect(classForWorld('glade')).toBe('PHANTOM');
  });

  it('Citadel maps to BERSERKER', () => {
    expect(classForWorld('citadel')).toBe('BERSERKER');
  });

  it('Sanctum maps to ORACLE', () => {
    expect(classForWorld('sanctum')).toBe('ORACLE');
  });

  it('Longpath maps to SCOUT', () => {
    expect(classForWorld('longpath')).toBe('SCOUT');
  });

  it('Gap maps to TRACER', () => {
    expect(classForWorld('gap')).toBe('TRACER');
  });

  it('Crossroads (NEXUS) returns null = unfiltered', () => {
    expect(classForWorld('crossroads')).toBeNull();
  });

  it('Nexus returns null = unfiltered', () => {
    expect(classForWorld('nexus')).toBeNull();
  });

  it('Breach returns null = unfiltered', () => {
    expect(classForWorld('breach')).toBeNull();
  });

  it('Unknown world returns null', () => {
    expect(classForWorld('atlantis')).toBeNull();
  });
});