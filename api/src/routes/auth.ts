import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  tickHearts,
  heartMultiplier,
  HARDCORE_SUBSTANCE_CAPS,
} from '../lib/mode.js';
import {
  createSession,
  createSessionAndFetchUser,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  promotePendingSession,
  hashPassword,
  verifyPassword,
  requireUser,
  getSession,
  setTrustedDeviceCookie,
  clearTrustedDeviceCookie,
  readTrustedDeviceCookie,
} from '../lib/auth.js';
import { config } from '../lib/config.js';
import { getClassLockStatus, getClassDisplayName, getNextPromotion } from '../lib/classLock.js';
import { isCreatineActive } from './supplements.js';
import { computeGoalTargets } from '../lib/goalTargets.js';
import {
  generateTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  newTrustedDeviceToken,
  sha256,
  totpUrl,
  verifyTotp,
} from '../lib/totp.js';
import { checkLoginRate, clearLoginRate, recordFailedLogin } from '../lib/rateLimit.js';

const TRUSTED_DEVICE_TTL_DAYS = 90;

// Username-only registration — no email. Email features (verification,
// password reset, etc.) are deferred until we have a mail provider.
const RegisterSchema = z.object({
  username: z.string().min(3).max(21).regex(/^[a-zA-Z0-9_-]+$/, 'username may only contain letters, numbers, _ and -'),
  password: z.string().min(8).max(120),
});

const LoginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

const TotpSchema = z.object({
  /// TOTP code from the authenticator app, OR a recovery code.
  code: z.string().min(6).max(32),
  /// If true, issue a 90-day trusted-device cookie so subsequent
  /// logins skip TOTP. Default false.
  trustDevice: z.boolean().optional(),
});

const Disable2faSchema = z.object({
  /// Password confirmation. Belt-and-suspenders against an attacker
  /// who somehow has a valid session but not the password.
  password: z.string().min(1),
});

/**
 * Build the public user object returned by /login + /me + /auth/login/totp.
 * Centralized here so the three endpoints stay in lockstep — adding
 * a new field means editing one place.
 *
 * Also ticks the heart regen timer so Hardcore-mode UI (HeartsCard,
 * heart penalty multiplier) sees a current value on every /me load.
 */
async function publicUser(user: any) {
  const hearts = await tickHearts(user.id);
  const heartMult = heartMultiplier(hearts, user.mode ?? 'CASUAL');
  const mode = user.mode ?? 'CASUAL';
  // Count active Soulstones (unconsumed + non-expired) so the home
  // page shows the correct class-respec inventory. We compute here
  // rather than passing through the caller because publicUser is
  // hit on every /me read + every login.
  const soulstoneCount = await prisma.soulstone.count({
    where: { userId: user.id, consumed: false, expiresAt: { gt: new Date() } },
  });
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    level: user.level,
    xp: user.xp,
    gold: user.gold,
    soulstones: soulstoneCount,
    class: user.class,
    classDisplay: getClassDisplayName(user.class, user.level),
    classStage: user.class ? (user.level >= 25 ? 3 : user.level >= 10 ? 2 : 1) : null,
    nextPromotion: getNextPromotion(user.class, user.level),
    units: user.units,
    heightCm: user.heightCm,
    wristCm: user.wristCm,
    ankleCm: user.ankleCm,
    forearmLengthCm: user.forearmLengthCm,
    neckCircCm: user.neckCircCm,
    sex: user.sex,
    weightKg: user.weightKg,
    bodyFatPct: user.bodyFatPct,
    birthDate: user.birthDate,
    createdAt: user.createdAt,
    classChangedAt: user.classChangedAt,
    classLock: getClassLockStatus(user.class, user.classChangedAt, user.birthDate, soulstoneCount),
    ordained: user.ordained,
    isAdmin: user.isAdmin,
    spiritualDailyPrayers: user.spiritualDailyPrayers,
    creatine: user.creatine,
    timezone: user.timezone,
    creatineActive: await isCreatineActive(user.id),
    goal: user.goal,
    calorieBaseline: user.calorieBaseline,
    calorieSource: user.calorieSource,
    hasUsdaKey: !!user.usdaApiKey,
    /// Surfaced so the frontend can decide whether to render the
    /// 2FA step in the login flow on next render.
    totpEnabled: user.totpEnabled,
    /// Casual / Hardcore difficulty mode. Hearts tick on every /me
    /// load so the HeartsCard always sees a current value.
    mode,
    hearts,
    heartMultiplier: heartMult,
    hardcoreCaps: mode === 'HARDCORE' ? HARDCORE_SUBSTANCE_CAPS : null,
    targets: computeGoalTargets({
      goal: user.goal,
      calorieBaseline: user.calorieBaseline,
      weightKg: user.weightKg,
    }),
  };
}

/**
 * Best-effort device label from the User-Agent. Examples:
 *   "Macintosh; Intel Mac OS X 10_15_7" + Safari → "Safari on macOS"
 *   "iPhone; CPU iPhone OS 17_0" → "iPhone (iOS 17)"
 * Falls back to a truncated UA so the user can always see something.
 */
function parseDeviceLabel(req: any): string {
  const ua: string = req.headers?.['user-agent'] ?? '';
  if (!ua) return 'Unknown device';
  if (/iPhone/.test(ua)) {
    const m = ua.match(/iPhone OS (\d+)/);
    return `iPhone${m ? ` (iOS ${m[1]})` : ''}`;
  }
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+)/);
    return `Android${m ? ` ${m[1]}` : ''}`;
  }
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua)) return 'Safari on macOS';
  if (/Macintosh/.test(ua) && /Chrome/.test(ua)) return 'Chrome on macOS';
  if (/Windows/.test(ua) && /Chrome/.test(ua)) return 'Chrome on Windows';
  if (/Windows/.test(ua) && /Firefox/.test(ua)) return 'Firefox on Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 60);
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const usernameLower = body.username.toLowerCase();
    const exists = await prisma.user.findFirst({
      where: { usernameLower },
      select: { id: true, username: true },
    });
    if (exists) {
      return reply.code(409).send({ error: 'Username already taken.' });
    }
    const passwordHash = await hashPassword(body.password);
    // Generate a stable placeholder email so the User model's NOT NULL
    // email column is satisfied. Real emails are off the table for now.
    const placeholderEmail = `${usernameLower}@local.fitquest`;
    // The default admin user (admin) is created by ensureDefaultAdmin()
    // on first boot. After that, regular registrations are never admin.
    const user = await prisma.user.create({
      data: {
        email: placeholderEmail,
        username: body.username,
        usernameLower,
        passwordHash,
        isAdmin: false,
      },
      select: {
        id: true, email: true, username: true, level: true, xp: true, gold: true,
        class: true, units: true, createdAt: true, classChangedAt: true,
        birthDate: true, sex: true, heightCm: true, wristCm: true,
        ankleCm: true, forearmLengthCm: true, neckCircCm: true,
        isAdmin: true,
      },
    });
    const { session } = await createSessionAndFetchUser(user.id, req);
    await setSessionCookie(reply, session.token);
    return reply.send({ user: await publicUser(user) });
  });

  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const ip = req.ip ?? 'unknown';

    // Rate limit by both IP and username. Pass a placeholder key when
    // the user doesn't exist so an attacker can't bypass the per-user
    // lockout by failing fast on bad usernames.
    const tentativeKey = body.identifier?.toLowerCase().trim() ?? '';
    const rateCheck = checkLoginRate(ip, tentativeKey || '__no_user__');
    if (!rateCheck.allowed) {
      return reply.code(429).send({
        error: 'Too many attempts. Try again later.',
        retryAfterMs: rateCheck.retryAfterMs,
      });
    }

    const user = await prisma.user.findUnique({
      where: { usernameLower: body.identifier.toLowerCase() },
    });
    // Count active Soulstones (unconsumed + non-expired). Used in the
    // /login response below for the classLock status. Login shouldn't
    // have to call the DB twice, but it's < 1ms and keeps the code
    // symmetric with the PATCH /me path.
    let soulstoneCount = 0;
    if (user) {
      soulstoneCount = await prisma.soulstone.count({
        where: { userId: user.id, consumed: false, expiresAt: { gt: new Date() } },
      });
    }

    // Always run bcrypt even on missing user — constant-time-ish so
    // attackers can't tell "user doesn't exist" vs "wrong password"
    // from response timing.
    let ok = false;
    if (user) {
      ok = await verifyPassword(body.password, user.passwordHash);
    } else {
      // Burn ~250ms of CPU to mimic a real verify on a fake hash so
      // timing doesn't leak account existence.
      await verifyPassword(body.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    }

    if (!ok || !user) {
      recordFailedLogin(ip, tentativeKey || '__no_user__');
      return reply.code(401).send({ error: 'Invalid credentials.' });
    }

    // Account lockout from User.lockedUntil (DB-side; populated when
    // the in-process limiter isn't enough — e.g. after a deploy).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return reply.code(429).send({
        error: 'Account temporarily locked. Try again later.',
        retryAfterMs: user.lockedUntil.getTime() - Date.now(),
      });
    }

    // 2FA path: if the user has TOTP enabled, check for a valid
    // trusted-device cookie first. If present, skip straight to
    // issuing a full session. Otherwise return requiresTotp so the
    // client shows the code-entry step.
    if (user.totpEnabled && user.totpSecret) {
      const trustedHash = readTrustedDeviceCookie(req);
      if (trustedHash) {
        const trusted = await prisma.trustedDevice.findUnique({
          where: { tokenHash: trustedHash },
        });
        if (trusted && trusted.userId === user.id && trusted.expiresAt > new Date()) {
          // Bump lastUsedAt; sliding 90-day window from the last
          // successful use, so a daily user effectively never
          // re-prompts. A user who disappears for 90+ days does.
          const newExpiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);
          await prisma.trustedDevice.update({
            where: { id: trusted.id },
            data: { lastUsedAt: new Date(), expiresAt: newExpiresAt, lastIp: req.ip ?? null },
          });
          // Trusted-device path bypasses the TOTP step entirely —
          // this is the whole point of the feature.
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLogins: 0, lockedUntil: null },
          });
          clearLoginRate(ip, tentativeKey);
          const session = await createSession(user.id, req);
          await setSessionCookie(reply, session.token);
          return reply.send({ user: await publicUser(user) });
        }
      }
      // No trusted device — issue a TOTP_PENDING session cookie so
      // the client can call /auth/login/totp to finish. We do NOT
      // issue a regular session yet; requireUser() rejects
      // TOTP_PENDING so the rest of the API can't be reached.
      const pending = await createSession(user.id, req, { kind: 'TOTP_PENDING' });
      await setSessionCookie(reply, pending.token);
      return reply.send({ requiresTotp: true, user: { id: user.id, username: user.username } });
    }

    // No TOTP — issue a regular session. Reset lockout counters.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    clearLoginRate(ip, tentativeKey);
    const session = await createSession(user.id, req);
    await setSessionCookie(reply, session.token);
    return reply.send({ user: await publicUser(user) });
  });

  /// Step 2 of the 2FA login flow. Consumes a TOTP_PENDING session
  /// cookie (set by /login) and either:
  ///   - verifies a TOTP code, OR
  ///   - consumes a recovery code (one-time, deletes the row).
  /// On success, upgrades the session to FULL + optionally issues
  /// a 90-day trusted-device cookie.
  app.post('/login/totp', async (req, reply) => {
    const body = TotpSchema.parse(req.body);
    const session = await getSession(req);
    if (!session) return reply.code(401).send({ error: 'No pending login.' });
    if (session.kind !== 'TOTP_PENDING') {
      return reply.code(400).send({ error: 'Login is already complete.' });
    }
    const user = session.user;
    if (!user.totpEnabled || !user.totpSecret) {
      return reply.code(400).send({ error: 'TOTP not configured.' });
    }

    let verified = false;
    // Recovery codes are tried first because the TOTP code path is
    // case-sensitive + length-checked; a recovery code is also a
    // string and we don't want them to ever accidentally hit the
    // TOTP verify path. Strip dashes + whitespace before hashing.
    const normalized = body.code.replace(/[\s-]/g, '').toUpperCase();
    const hashed = sha256(normalized);
    const recovery = await prisma.recoveryCode.findUnique({
      where: { userId_codeHash: { userId: user.id, codeHash: hashed } },
    });
    if (recovery && !recovery.usedAt) {
      // Burn the recovery code on use. We don't soft-delete; the
      // unique index would conflict on a recreate.
      await prisma.recoveryCode.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      });
      verified = true;
    } else if (await verifyTotp(user.totpSecret, body.code)) {
      verified = true;
    }
    if (!verified) {
      return reply.code(401).send({ error: 'Invalid code.' });
    }

    // Promote the pending session to a real one.
    await promotePendingSession(session.token);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    clearLoginRate(req.ip ?? 'unknown', user.username);

    // Optional: trust this device for 90 days.
    if (body.trustDevice) {
      const { token, hash } = newTrustedDeviceToken();
      await prisma.trustedDevice.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          label: parseDeviceLabel(req),
          userAgent: req.headers['user-agent'] ?? null,
          lastIp: req.ip ?? null,
          expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      setTrustedDeviceCookie(reply, token);
    }

    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    return reply.send({ user: await publicUser(fresh) });
  });

  /// 2FA setup — step 1 of 2. Returns the otpauth:// URL + manual
  /// secret + recovery codes. The user must verify a code via
  /// /auth/2fa/verify-setup before totpEnabled flips on. This split
  /// ensures we don't accidentally lock the user out if their
  /// authenticator import fails (e.g. they mistyped the secret).
  app.post('/2fa/setup', async (req, reply) => {
    const me = await requireUser(req);
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes(8);
    // Persist the pending secret immediately so a page reload mid-
    // setup doesn't generate a different secret. We don't flip
    // totpEnabled until verify-setup; the secret is overwritten
    // there on success or on /2fa/disable.
    await prisma.user.update({
      where: { id: me.id },
      data: { totpSecret: secret },
    });
    return reply.send({
      secret,
      url: totpUrl(me.username, secret),
      recoveryCodes,
    });
  });

  /// 2FA setup — step 2 of 2. User scans the QR, then enters a
  /// 6-digit code. On match we:
  ///   - flip totpEnabled to true
  ///   - persist the recovery codes
  ///   - leave the secret in place (same value as step 1)
  /// On mismatch we leave the secret on the user but totpEnabled
  /// stays false, so the user can retry /2fa/setup from scratch
  /// (which generates a fresh secret).
  app.post('/2fa/verify-setup', async (req, reply) => {
    const me = await requireUser(req);
    const body = TotpSchema.pick({ code: true }).parse(req.body);
    if (!me.totpSecret) {
      return reply.code(400).send({ error: 'No pending 2FA setup. Call /auth/2fa/setup first.' });
    }
    if (me.totpEnabled) {
      return reply.code(400).send({ error: '2FA is already enabled. Disable it first to reconfigure.' });
    }
    if (!(await verifyTotp(me.totpSecret, body.code))) {
      return reply.code(401).send({ error: 'Invalid code. Check that the time on your authenticator matches the server.' });
    }
    // Generate fresh recovery codes on verify — the ones returned
    // by /2fa/setup are shown to the user but not stored, so
    // verify-setup is the commit point and we generate again here
    // so the stored hashes match what the user has on paper.
    const codes = generateRecoveryCodes(8);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: me.id },
        data: { totpEnabled: true },
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: me.id } }),
      prisma.recoveryCode.createMany({
        data: codes.map((c) => ({
          userId: me.id,
          codeHash: hashRecoveryCode(c),
        })),
      }),
    ]);
    return reply.send({ ok: true, recoveryCodes: codes });
  });

  /// Disable 2FA. Requires password confirmation. Wipes the secret
  /// and burns all recovery codes. Trusted-device cookies remain
  /// valid until their natural expiry (we don't mass-revoke — the
  /// 90-day window is short enough that this is acceptable; the
  /// user can manually revoke via /auth/trusted-devices).
  app.post('/2fa/disable', async (req, reply) => {
    const me = await requireUser(req);
    const body = Disable2faSchema.parse(req.body);
    const ok = await verifyPassword(body.password, me.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'Wrong password.' });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: me.id },
        data: { totpSecret: null, totpEnabled: false },
      }),
      prisma.recoveryCode.deleteMany({ where: { userId: me.id } }),
    ]);
    return reply.send({ ok: true });
  });

  /// List the user's currently-trusted devices. Used by /settings
  /// to render a "log out everywhere" UI.
  app.get('/trusted-devices', async (req) => {
    const me = await requireUser(req);
    const devices = await prisma.trustedDevice.findMany({
      where: { userId: me.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true, label: true, userAgent: true, lastIp: true,
        lastUsedAt: true, expiresAt: true, createdAt: true,
      },
    });
    return { devices };
  });

  /// Revoke a single trusted device. Used by /settings.
  app.delete('/trusted-devices/:id', async (req, reply) => {
    const me = await requireUser(req);
    const id = (req.params as any).id as string;
    await prisma.trustedDevice.deleteMany({
      where: { id, userId: me.id },
    });
    return reply.send({ ok: true });
  });

  /// Log out everywhere — destroys all FULL sessions + all trusted
  /// devices. The current request's session is also destroyed.
  app.post('/logout-everywhere', async (req, reply) => {
    const me = await requireUser(req);
    const currentRaw = req.cookies[config.cookieName];
    let currentToken: string | null = null;
    if (currentRaw) {
      const unsigned = req.unsignCookie(currentRaw);
      if (unsigned.valid && unsigned.value) currentToken = unsigned.value;
    }
    await prisma.$transaction([
      prisma.session.deleteMany({
        where: { userId: me.id, kind: 'FULL' },
      }),
      prisma.trustedDevice.deleteMany({ where: { userId: me.id } }),
    ]);
    // Re-issue the current session so the calling tab doesn't get
    // logged out — they hit "log out everywhere" but probably still
    // want to keep using the app from this device.
    if (currentToken) {
      const fresh = await createSession(me.id, req);
      await setSessionCookie(reply, fresh.token);
    } else {
      clearSessionCookie(reply);
    }
    clearTrustedDeviceCookie(reply);
    return reply.send({ ok: true });
  });

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[config.cookieName];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await destroySession(unsigned.value);
      }
    }
    clearSessionCookie(reply);
    clearTrustedDeviceCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/me', async (req, reply) => {
    const user = await requireUser(req);
    return reply.send({ user: await publicUser(user) });
  });
}