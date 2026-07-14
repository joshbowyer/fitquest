/**
 * Tests for `safeReadField` — the migration-resilience helper
 * added to publicUser() after the v1.0.27 incident where every
 * user got kicked to /login for ~25 minutes because
 * `User.coachPersonality` referenced in code hadn't been migrated
 * to the live DB.
 *
 * The helper's contract:
 * - If `cheapRead()` returns a defined value, return it (no DB hit).
 * - If it returns undefined, fall through to `dbFallback()`.
 * - If BOTH throw Prisma P2022 (column does not exist), return the
 *   fallback and log a warning. Never throw.
 * - Any other Prisma error (P2002, P2025, network) propagates.
 */
import { describe, it, expect, vi } from 'vitest';
import { safeReadField } from '../routes/auth';

describe('safeReadField — migration-resilience helper', () => {
  it('returns the cheap-read value when it is defined', async () => {
    const db = vi.fn(async () => null);
    const result = await safeReadField(
      () => 'from-object',
      db,
      'fallback',
    );
    expect(result).toBe('from-object');
    expect(db).not.toHaveBeenCalled();
  });

  it('falls through to dbFallback when cheapRead returns undefined', async () => {
    const result = await safeReadField(
      () => undefined,
      async () => 'from-db',
      'fallback',
    );
    expect(result).toBe('from-db');
  });

  it('returns the fallback when both paths return null', async () => {
    const result = await safeReadField(
      () => undefined,
      async () => null,
      'fallback-default',
    );
    expect(result).toBe('fallback-default');
  });

  it('swallows Prisma P2022 (column does not exist) and returns fallback', async () => {
    // The exact error shape Prisma 5 throws for "column does not
    // exist" on a select.
    const p2022 = Object.assign(new Error('column "coachPersonality" does not exist'), {
      code: 'P2022',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await safeReadField(
      () => undefined,
      async () => { throw p2022; },
      'safe-fallback',
    );

    expect(result).toBe('safe-fallback');
    expect(warn).toHaveBeenCalledTimes(1);
    // The warning should mention prisma migrate deploy so the
    // on-call engineer knows the runbook step.
    // toHaveBeenCalledTimes(1) above guarantees the first call exists.
    expect(warn.mock.calls[0]![0]).toMatch(/migrate deploy/);

    warn.mockRestore();
  });

  it('PROPAGATES non-P2022 errors (real bugs must surface)', async () => {
    const real = Object.assign(new Error('connection refused'), {
      code: 'P1001',
    });
    await expect(
      safeReadField(
        () => undefined,
        async () => { throw real; },
        'fallback',
      ),
    ).rejects.toBe(real);
  });

  it('swallows cheap-read throws (malformed user object) and falls through', async () => {
    // Belt-and-suspenders: even if destructuring the row throws
    // (e.g. property getter threw), the DB fallback still runs.
    const result = await safeReadField(
      () => { throw new Error('malformed row'); },
      async () => 'from-db',
      'fallback',
    );
    expect(result).toBe('from-db');
  });
});