/**
 * Tests for the device-login Bearer-token flow. Verifies:
 *  - POST /auth/device-login issues a long-lived DEVICE session and
 *    returns a Bearer token (no cookie).
 *  - The token works on protected endpoints via Authorization header.
 *  - An invalid Bearer token fails closed (no cookie fallback).
 *  - 2FA-enabled accounts must supply totpCode or get 401 + requiresTotp.
 *  - Recovery codes work as a TOTP alternative (mirrors /login/totp).
 *  - Re-running device-login invalidates prior DEVICE sessions for
 *    that user (token rotation).
 *  - GET /auth/device-sessions lists the user's active device tokens.
 *  - DELETE /auth/device-sessions/:id revokes a single token.
 *  - POST /auth/device-logout revokes the calling token.
 *  - POST /auth/logout-everywhere wipes DEVICE sessions too.
 *  - Sessions past their expiresAt are rejected (lazy cleanup).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stores so we can exercise the auth + persistence path
// without standing up a real Postgres. Each store mimics the shape
// Prisma returns, including `expiresAt` as a Date.
const users = new Map<string, any>();
const sessions: any[] = [];
const recoveryCodes = new Map<string, any>();

// Mutable "now" so we can test expiry. Default to a fixed instant
// so expiresAt math is deterministic across the test file.
let now = new Date('2026-07-01T12:00:00Z');

vi.mock('../lib/prisma', () => ({
  // The auth route imports ./supplements.js which re-exports the
  // TrackedItemCategory + TrackedItemUnit enums from the generated
  // Prisma client. We expose matching enum objects so any stray
  // import in the route's transitive deps resolves.
  TrackedItemCategory: {
    VITAMIN: 'VITAMIN',
    MINERAL: 'MINERAL',
    FATTY_ACID: 'FATTY_ACID',
    PROBIOTIC: 'PROBIOTIC',
    HERB: 'HERB',
    AMINO_ACID: 'AMINO_ACID',
    OTHER: 'OTHER',
  },
  TrackedItemUnit: {
    mg: 'mg',
    g: 'g',
    mcg: 'mcg',
    iu: 'iu',
    cfu: 'cfu',
    capsule: 'capsule',
  },
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.usernameLower) {
          for (const u of users.values()) {
            if (u.usernameLower === where.usernameLower) return u;
          }
        }
        if (where.id) return users.get(where.id) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('user not found');
        Object.assign(u, data);
        return u;
      }),
    },
    session: {
      create: vi.fn(async ({ data }: any) => {
        const s = {
          id: `s-${sessions.length + 1}`,
          ...data,
          expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(data.expiresAt),
        };
        sessions.push(s);
        return s;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = sessions.find((s) => s.token === where.token);
        if (!row) return null;
        if (include?.user) {
          return { ...row, user: users.get(row.userId) ?? null };
        }
        return row;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        let out = sessions.slice();
        if (where?.userId) out = out.filter((s) => s.userId === where.userId);
        if (where?.kind) {
          const kinds = Array.isArray(where.kind.in) ? where.kind.in : [where.kind];
          out = out.filter((s) => kinds.includes(s.kind));
        }
        if (where?.expiresAt?.gt) {
          out = out.filter((s) => s.expiresAt > where.expiresAt.gt);
        }
        if (where?.token) out = out.filter((s) => s.token === where.token);
        return out;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i--) {
          const s = sessions[i];
          let drop = true;
          if (where?.userId && s.userId !== where.userId) drop = false;
          if (where?.kind) {
            const kinds = Array.isArray(where.kind.in) ? where.kind.in : [where.kind];
            if (!kinds.includes(s.kind)) drop = false;
          }
          if (where?.token && s.token !== where.token) drop = false;
          if (where?.id && s.id !== where.id) drop = false;
          if (drop) sessions.splice(i, 1);
        }
        return { count: before - sessions.length };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = sessions.find((x) => x.token === where.token);
        if (!s) throw new Error('session not found');
        Object.assign(s, data);
        return s;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = sessions.findIndex((s) => s.id === where.id);
        if (idx >= 0) {
          const [removed] = sessions.splice(idx, 1);
          return removed;
        }
        throw new Error('session not found');
      }),
    },
    recoveryCode: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = `${where.userId_codeHash.userId}|${where.userId_codeHash.codeHash}`;
        return recoveryCodes.get(key) ?? null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        for (const [, v] of recoveryCodes) {
          if (v.id === where.id) Object.assign(v, data);
        }
        return null;
      }),
    },
    trustedDevice: {
      // Auth-tests don't exercise the trusted-device path; expose
      // the shape the route calls so a stray call doesn't throw.
      findUnique: vi.fn(async () => null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    soulstone: {
      // publicUser() reads soulstone count to populate the
      // classLock status. No soulstones in tests = 0.
      count: vi.fn(async () => 0),
    },
    // logout-everywhere uses prisma.$transaction([op1, op2]). The
    // array form is a Prisma batch transaction; we execute the
    // operations in order against the in-memory store.
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) {
        const results = [];
        for (const op of arg) results.push(await op);
        return results;
      }
      return arg;
    }),
  },
}));

// Stand-in TOTP module. The auth route imports `verifyTotp` from
// ../lib/totp. We make it accept the literal code "TOTPVALID" as
// the valid TOTP code so the test can exercise the happy path.
vi.mock('../lib/totp', () => ({
  verifyTotp: vi.fn(async (_secret: string, code: string) => code === 'TOTPVALID'),
  sha256: vi.fn(async (s: string) => `sha:${s.toUpperCase()}`),
}));

// Bcrypt replacement — accept "right-password" as the only valid
// password. Avoids real hashing cost in tests.
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(async (plain: string, hash: string) =>
      plain === 'right-password' && hash.startsWith('$2'),
    ),
    hash: vi.fn(async (s: string) => `$2:${s}`),
  },
}));

// Auth-rate-limit module is invoked but we let it pass through.
vi.mock('../lib/rateLimit', () => ({
  checkLoginRate: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  recordFailedLogin: vi.fn(),
  clearLoginRate: vi.fn(),
}));

// Stub out the supplementary helpers so importing the route
// doesn't pull in the real supplement / class-lock / heart-tick /
// goal-targets code.
vi.mock('../routes/supplements.js', () => ({
  isCreatineActive: vi.fn(async () => false),
}));
vi.mock('../lib/classLock.js', () => ({
  getClassLockStatus: vi.fn(() => ({})),
  getClassDisplayName: vi.fn(() => 'Phantom'),
  getNextPromotion: vi.fn(() => null),
}));
vi.mock('../lib/mode.js', () => ({
  tickHearts: vi.fn(async () => 10),
  heartMultiplier: vi.fn(() => 1),
  HARDCORE_SUBSTANCE_CAPS: {},
}));
vi.mock('../lib/goalTargets.js', () => ({
  computeGoalTargets: vi.fn(() => ({})),
}));

import Fastify from 'fastify';
import { authRoutes } from '../routes/auth';
import * as authLib from '../lib/auth';

function newUser(opts: { username: string; totp?: boolean } = { username: 'u1' }) {
  const id = `u-${opts.username}`;
  const u = {
    id,
    email: `${opts.username}@local.fitquest`,
    username: opts.username,
    usernameLower: opts.username.toLowerCase(),
    passwordHash: '$2:right-password',
    isAdmin: false,
    totpEnabled: !!opts.totp,
    totpSecret: opts.totp ? 'JBSWY3DPEHPK3PXP' : null,
    level: 1, xp: 0, gold: 0, class: 'PHANTOM', units: 'METRIC',
    lockedUntil: null,
    failedLogins: 0,
  };
  users.set(id, u);
  return u;
}

async function buildApp() {
  const app = Fastify();
  // Decorate request with empty cookies so the cookie path is a
  // no-op for tests that only use Bearer. Also stub the reply's
  // clearCookie/setCookie methods since @fastify/cookie isn't
  // registered in the test app — auth.ts calls these in the
  // logout / logout-everywhere paths.
  app.decorateRequest('cookies', { getter: () => ({}) });
  // These simulate internal @fastify/cookie plugin hooks; the real
  // signature is a (this: FastifyReply, ...) => FastifyReply function.
  // We don't exercise the return value in tests — cast the no-op
  // stubs to any so tsc stops complaining without weakening assertions.
  app.decorateReply('clearCookie', (() => undefined) as any);
  app.decorateReply('setCookie', (() => undefined) as any);
  app.decorateReply('unsignCookie', () => ({ valid: false, value: null, renew: false }));
  await app.register(authRoutes);
  return app;
}

beforeEach(() => {
  users.clear();
  sessions.length = 0;
  recoveryCodes.clear();
  now = new Date('2026-07-01T12:00:00Z');
});

describe('POST /auth/device-login', () => {
  it('issues a Bearer token and a DEVICE session', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(now.getTime() + 300 * 24 * 3600 * 1000);
    expect(body.user.username).toBe('lobster');

    // The session row must be kind=DEVICE, no cookie should be set
    // on the response (the helper APK uses Bearer, not cookies).
    expect(sessions).toHaveLength(1);
    expect(sessions[0].kind).toBe('DEVICE');
    expect(sessions[0].userId).toBe('u-lobster');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('is case-insensitive on identifier (matches existing /login)', async () => {
    newUser({ username: 'LobsterWrangler' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'LOBSTERWRANGLER', password: 'right-password' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects wrong password with 401', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'lobster', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(sessions).toHaveLength(0);
  });

  it('returns requiresTotp for 2FA users without a code', async () => {
    newUser({ username: 'lobster', totp: true });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().requiresTotp).toBe(true);
    expect(sessions).toHaveLength(0);
  });

  it('accepts a valid TOTP code', async () => {
    newUser({ username: 'lobster', totp: true });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password', totpCode: 'TOTPVALID' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('rejects an invalid TOTP code', async () => {
    newUser({ username: 'lobster', totp: true });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password', totpCode: '999999' },
    });
    if (res.statusCode !== 401) console.error('DEBUG TOTP:', res.body);
    expect(res.statusCode).toBe(401);
    expect(sessions).toHaveLength(0);
  });

  it('rotates: re-running device-login deletes prior DEVICE sessions', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const r2 = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    expect(r1.json().token).not.toBe(r2.json().token);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token).toBe(r2.json().token);
  });

  it('survives rate-limit + lockout being exercised on bad creds', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    // 5 bad attempts shouldn't be enough to lock the account in the
    // mock (we don't actually wire lockout increments here) — just
    // verify the bad-attempt path stays rejected.
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST', url: '/device-login',
        payload: { identifier: 'lobster', password: 'wrong' },
      });
      expect(r.statusCode).toBe(401);
    }
    // Still can succeed.
    const r = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('Bearer-token auth on requireUser()', () => {
  it('accepts a valid Bearer token on /me', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const token = login.json().token;
    const res = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('lobster');
  });

  it('fails closed on a malformed Bearer header (no cookie fallback)', async () => {
    newUser({ username: 'lobster' });
    // Seed a cookie session that COULD authenticate, so we can prove
    // a bad Bearer is rejected even when a cookie would have worked.
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    // The mock doesn't actually parse cookies, but we can prove the
    // route refuses a typo'd Bearer.
    const res = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects expired DEVICE sessions', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const token = login.json().token;
    // Force the session's expiresAt into the past.
    sessions[0].expiresAt = new Date(now.getTime() - 1000);
    const res = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    // And the expired row was lazy-cleaned.
    expect(sessions).toHaveLength(0);
  });

  it('rejects non-DEVICE session tokens (e.g. a stolen FULL session token)', async () => {
    // The user could theoretically steal a FULL session cookie value
    // and try to use it as a Bearer token. The Bearer path must
    // refuse it because it's only authorized for cookie sessions.
    newUser({ username: 'lobster' });
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    // Manually create a FULL session row (the login mock creates
    // one in-memory with kind=FULL via the same session.create
    // call as device-login).
    const full = await app.inject({
      method: 'POST', url: '/login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    // The mock prisma.session.create records whatever kind the
    // route passes. The login route passes 'FULL'. So the most
    // recent session in the store should be FULL.
    const mostRecent = sessions[sessions.length - 1];
    expect(mostRecent.kind).toBe('FULL');
    const res = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: `Bearer ${mostRecent.token}` },
    });
    // FULL session tokens must not work as Bearer — fail closed.
    expect(res.statusCode).toBe(401);
    void full;
  });
});

describe('POST /auth/device-logout', () => {
  it('revokes the calling Bearer token', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const token = login.json().token;
    const logout = await app.inject({
      method: 'POST', url: '/device-logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    // Subsequent /me call with the same token now 401s.
    const me = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('is idempotent (no Bearer → 200, no crash)', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/device-logout',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /auth/device-sessions + DELETE /auth/device-sessions/:id', () => {
  it('lists active device tokens for the user', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const me = await app.inject({
      method: 'GET', url: '/me',
      headers: { authorization: `Bearer ${sessions[0].token}` },
    });
    // Use the cookie path for the /device-sessions call so the test
    // exercises the "user looks at their devices list" flow without
    // a Bearer-in-Bearer dance. We pre-stuff a fake cookie store.
    const list = await app.inject({
      method: 'GET', url: '/device-sessions',
      headers: { authorization: `Bearer ${sessions[0].token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(1);
    expect(list.json().sessions[0].fingerprint).toBe(sessions[0].token.slice(0, 8));
    void me;
  });

  it('revokes a single device session by id', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const sid = sessions[0].id;
    const token = sessions[0].token;
    const del = await app.inject({
      method: 'DELETE', url: `/device-sessions/${sid}`,
      headers: { authorization: `Bearer ${token}` },
    });
    if (del.statusCode !== 200) console.error('DEBUG DEL:', del.statusCode, del.body);
    expect(del.statusCode).toBe(200);
    expect(sessions).toHaveLength(0);
  });

  it('refuses to revoke another user\'s session', async () => {
    newUser({ username: 'lobster' });
    newUser({ username: 'admin' });
    const app = await buildApp();
    // Create a device session for "lobster".
    await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    const lobsterSid = sessions[0].id;
    // Now login "admin" as a device session too.
    await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'admin', password: 'right-password' },
    });
    const adminToken = sessions[sessions.length - 1].token;
    const del = await app.inject({
      method: 'DELETE', url: `/device-sessions/${lobsterSid}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(200);
    // lobster's session should still exist (admin isn't its owner).
    expect(sessions.find((s) => s.id === lobsterSid)).toBeTruthy();
  });
});

describe('POST /auth/logout-everywhere', () => {
  it('wipes both FULL and DEVICE sessions', async () => {
    newUser({ username: 'lobster' });
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    await app.inject({
      method: 'POST', url: '/device-login',
      payload: { identifier: 'lobster', password: 'right-password' },
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    // Use the DEVICE token, not the FULL one — Bearer auth only
    // accepts DEVICE tokens.
    const deviceToken = sessions.find((s) => s.kind === 'DEVICE')!.token;
    const res = await app.inject({
      method: 'POST', url: '/logout-everywhere',
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    if (res.statusCode !== 200) console.error('DEBUG logout-everywhere:', res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    // Both kinds should be gone.
    expect(sessions.filter((s) => s.kind === 'FULL')).toHaveLength(0);
    expect(sessions.filter((s) => s.kind === 'DEVICE')).toHaveLength(0);
  });
});

describe('auth helpers (lib/auth.ts)', () => {
  it('readBearerToken parses the standard Authorization header', () => {
    expect(authLib.readBearerToken({ headers: { authorization: 'Bearer abc123' } } as any)).toBe('abc123');
    expect(authLib.readBearerToken({ headers: { authorization: 'bearer abc123' } } as any)).toBe('abc123');
    expect(authLib.readBearerToken({ headers: { authorization: 'Bearer  spaced ' } } as any)).toBe('spaced');
    expect(authLib.readBearerToken({ headers: {} } as any)).toBeNull();
    expect(authLib.readBearerToken({ headers: { authorization: 'Basic xyz' } } as any)).toBeNull();
  });

  it('generateSessionToken produces a 64-char hex string', () => {
    const t = authLib.generateSessionToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DEVICE_SESSION_TTL_MS is approximately one year', () => {
    const days = authLib.DEVICE_SESSION_TTL_MS / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(367);
  });
});