import { describe, it, expect } from 'vitest';
import { parseArticleBody } from '../lib/ewtn.js';

describe('parseArticleBody', () => {
  it('parses a typical weekday with just First Reading + Psalm + Gospel', () => {
    const body = [
      'Tuesday of the Twelfth Week in Ordinary Time',
      '',
      'First Reading',
      '',
      'Isaiah 49:1-6',
      '1',
      'Listen to me, O coastlands, and hearken, you peoples from afar.',
      '2',
      'He made my mouth like a sharp sword, in the shadow of his hand he hid me;',
      '',
      'Responsorial Psalm',
      '',
      'Psalms 139:1-3, 13-15',
      '1',
      'O LORD, thou hast searched me and known me!',
      '',
      'Gospel',
      '',
      'Luke 1:57-66, 80',
      '57',
      'Now the time came for Elizabeth to be delivered, and she gave birth to a son.',
    ].join('\n');
    const r = parseArticleBody(body)!;
    expect(r).not.toBeNull();
    expect(r.liturgicalInfo).toBe('Tuesday of the Twelfth Week in Ordinary Time');
    expect(r.firstReadingRef).toBe('Isaiah 49:1-6');
    expect(r.firstReading).toContain('Listen to me, O coastlands');
    expect(r.psalmRef).toBe('Psalms 139:1-3, 13-15');
    expect(r.gospelRef).toBe('Luke 1:57-66, 80');
    expect(r.gospel).toContain('Now the time came for Elizabeth');
  });

  it('concatenates a Second Reading onto firstReading for Solemnities', () => {
    const body = [
      'The Nativity of Saint John the Baptist',
      '',
      'First Reading',
      '',
      'Isaiah 49:1-6',
      '1',
      'Listen to me, O coastlands.',
      '',
      'Responsorial Psalm',
      '',
      'Psalms 139:1-3, 13-15',
      '1',
      'O LORD, thou hast searched me.',
      '',
      'Second Reading',
      '',
      'Acts 13:22-26',
      '22',
      'And when he had removed him, he raised up David to be their king.',
      '',
      'Gospel',
      '',
      'Luke 1:57-66, 80',
      '57',
      'Now the time came for Elizabeth to be delivered.',
    ].join('\n');
    const r = parseArticleBody(body)!;
    expect(r.firstReading).toContain('Listen to me, O coastlands');
    expect(r.firstReading).toContain('— Second Reading (Acts 13:22-26) —');
    expect(r.firstReading).toContain('And when he had removed him');
    expect(r.firstReadingRef).toBe('Isaiah 49:1-6; Acts 13:22-26');
  });

  it('returns null when body is empty', () => {
    expect(parseArticleBody('')).toBeNull();
  });

  it('returns null when no gospel or firstReading present', () => {
    // Body has only the liturgical title — no sections.
    const body = 'Tuesday of Week 12';
    expect(parseArticleBody(body)).toBeNull();
  });

  it('handles non-breaking space in verse text', () => {
    // EWTN uses \u00a0 (NBSP) — the parser should treat it as a
    // regular whitespace when joining verses.
    const body = [
      'Tuesday of Week 12',
      '',
      'Gospel',
      '',
      'Luke 1:1-4',
      '1',
      'In\u00a0the\u00a0beginning.',
    ].join('\n');
    const r = parseArticleBody(body)!;
    expect(r.gospel).toContain('In the beginning');
  });
});
