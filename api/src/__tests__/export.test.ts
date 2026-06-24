import { describe, expect, it } from 'vitest';
import { toCsv, csvEscape, zipStore, exportChecksum, EXPORT_VERSION, EXPORT_SCHEMA } from '../lib/export';

// csvEscape is internal; we test through toCsv for behavior.

describe('toCsv', () => {
  it('returns empty string for empty array', () => {
    expect(toCsv([])).toBe('');
  });

  it('emits header row + data rows', () => {
    const out = toCsv([{ a: 1, b: 'two' }, { a: 3, b: 'four' }]);
    expect(out).toBe('a,b\n1,two\n3,four');
  });

  it('unions keys across rows', () => {
    const out = toCsv([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]);
    const lines = out.split('\n');
    expect(lines[0].split(',').sort()).toEqual(['a', 'b', 'c']);
  });

  it('escapes commas, quotes, and newlines', () => {
    const out = toCsv([{ msg: 'has, comma' }, { msg: 'has "quote"' }, { msg: 'has\nnewline' }]);
    expect(out).toContain('"has, comma"');
    expect(out).toContain('"has ""quote"""');
    expect(out).toContain('"has\nnewline"');
  });

  it('renders Date as ISO string', () => {
    const d = new Date('2026-06-24T20:00:00.000Z');
    const out = toCsv([{ ts: d }]);
    expect(out).toContain('2026-06-24T20:00:00.000Z');
  });

  it('renders null/undefined as empty cells', () => {
    const out = toCsv([{ a: null, b: undefined, c: 0 }]);
    expect(out).toBe('a,b,c\n,,0');
  });

  it('serializes nested objects as JSON', () => {
    const out = toCsv([{ obj: { x: 1 } }]);
    expect(out).toContain('"{""x"":1}"');
  });
});

describe('zipStore', () => {
  it('produces a valid empty ZIP for an empty file list', () => {
    const zip = zipStore([]);
    // Empty ZIP is just the EOCD record (22 bytes) starting at 0.
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });

  it('produces a ZIP with files readable by unzip', () => {
    const zip = zipStore([
      { name: 'a.txt', content: 'hello' },
      { name: 'b.txt', content: 'world' },
    ]);
    // Local file header magic at offset 0
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // EOCD signature at the very end (last 22 bytes start with this)
    const eocdOffset = zip.length - 22;
    expect(zip.readUInt32LE(eocdOffset)).toBe(0x06054b50);
  });

  it('preserves file content + names', () => {
    const zip = zipStore([{ name: 'test.csv', content: 'a,b\n1,2\n' }]);
    // Find the file content by searching for the content bytes
    const idx = zip.indexOf('a,b\n1,2\n');
    expect(idx).toBeGreaterThan(-1);
    expect(zip.indexOf('test.csv')).toBeGreaterThan(-1);
  });
});

describe('exportChecksum', () => {
  it('returns a stable 32-char hex string', () => {
    const payload = {
      schema: EXPORT_SCHEMA,
      version: EXPORT_VERSION,
      exportedAt: '2026-06-24T20:00:00.000Z',
      userId: 'u1',
      user: { id: 'u1' },
      tables: {},
      counts: {},
    } as any;
    const c = exportChecksum(payload);
    expect(c).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable across re-exports (exportedAt varies)', () => {
    const a = { ...payloadStub(), exportedAt: '2026-06-24T20:00:00.000Z' };
    const b = { ...payloadStub(), exportedAt: '2026-06-25T20:00:00.000Z' };
    expect(exportChecksum(a as any)).toBe(exportChecksum(b as any));
  });

  it('changes when the data changes', () => {
    const a = payloadStub();
    const b = { ...payloadStub(), userId: 'different' };
    expect(exportChecksum(a as any)).not.toBe(exportChecksum(b as any));
  });
});

function payloadStub() {
  return {
    schema: EXPORT_SCHEMA,
    version: EXPORT_VERSION,
    exportedAt: '2026-06-24T20:00:00.000Z',
    userId: 'u1',
    user: { id: 'u1' },
    tables: { workouts: [{ id: 'w1' }] },
    counts: { workouts: 1 },
  };
}

describe('export constants', () => {
  it('schema marker matches fitquest.user-export.v1', () => {
    expect(EXPORT_SCHEMA).toBe('fitquest.user-export.v1');
    expect(EXPORT_VERSION).toBe(1);
  });
});
