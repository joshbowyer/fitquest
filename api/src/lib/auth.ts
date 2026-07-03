import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { config } from './config.js';

const SALT_ROUNDS = 12;

/// How long a TOTP_PENDING session is valid before it expires
/// without the user entering a code. Five minutes is enough time
/// to grab a phone and type 6 digits without being so long that
/// a stolen cookie becomes a long-lived attack window.
const TOTP_PENDING_TTL_MS = 5 * 60 * 1000;

/// Device (unattended) tokens last a year by default. The user
/// can revoke them from the web UI or by re-running device-login
/// (which deletes prior DEVICE rows for that user).
export const DEVICE_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/// Cookie name for the "remember this device for 90 days" token.
/// Different from the session cookie so the two can have different
/// lifetimes and we can revoke them independently.
export const TRUSTED_DEVICE_COOKIE = 'fq_trust';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a session row. `kind` is 'FULL' (normal authenticated
 * session) or 'TOTP_PENDING' (password passed, awaiting TOTP
 * code — see /auth/login + /auth/login/totp below).
 *
 * TOTP_PENDING sessions are short-lived (5 min) and can ONLY be
 * consumed by /auth/login/totp which upgrades them to FULL or
 * deletes them on failure. requireUser() rejects TOTP_PENDING so
 * a half-completed login can't reach the API.
 */
export async function createSession(
  userId: string,
  req: FastifyRequest,
  options: { kind?: 'FULL' | 'TOTP_PENDING' | 'DEVICE' } = {}
) {
  const token = generateSessionToken();
  const kind = options.kind ?? 'FULL';
  const ttlMs =
    kind === 'TOTP_PENDING' ? TOTP_PENDING_TTL_MS
    : kind === 'DEVICE' ? DEVICE_SESSION_TTL_MS
    : config.sessionTtlDays * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const session = await prisma.session.create({
    data: {
      userId,
      token,
      kind,
      expiresAt,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip,
    },
  });
  return session;
}

export async function createSessionAndFetchUser(userId: string, req: FastifyRequest) {
  const session = await createSession(userId, req);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return { session, user };
}

/**
 * Promote a TOTP_PENDING session to FULL by updating its kind
 * and extending the expiresAt. Returns the updated session.
 */
export async function promotePendingSession(token: string) {
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  return prisma.session.update({
    where: { token },
    data: { kind: 'FULL', expiresAt },
  });
}

export async function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    secure: !config.isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(config.cookieName, { path: '/' });
}

/**
 * Set the trusted-device cookie. Holds the raw token; the DB
 * stores the sha256 hash so a leak of the DB doesn't leak trust.
 * 90-day lifetime matches the TrustedDevice row's expiresAt.
 */
export function setTrustedDeviceCookie(reply: FastifyReply, token: string) {
  reply.setCookie(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: !config.isDev,
    // SameSite=None in prod so the Capacitor WebView (which loads
    // at https://localhost) can send this cookie on cross-site
    // requests to the api domain. See setSessionCookie for the
    // matching comment.
    sameSite: config.isDev ? 'lax' : 'none',
    path: '/',
    // Match setSessionCookie's domain so both cookies are
    // scoped to the same parent (e.g. .joshbullock.net).
    domain: process.env.API_COOKIE_DOMAIN || (config.isDev ? '' : '.joshbullock.net'),
    maxAge: 90 * 24 * 60 * 60,
    signed: true,
  });
}

export function clearTrustedDeviceCookie(reply: FastifyReply) {
  reply.clearCookie(TRUSTED_DEVICE_COOKIE, { path: '/' });
}

/**
 * Read the trusted-device cookie + return its hash (suitable for
 * TrustedDevice.tokenHash lookup). Returns null if the cookie is
 * missing or the signed value is invalid.
 */
export function readTrustedDeviceCookie(req: FastifyRequest): string | null {
  const raw = req.cookies[TRUSTED_DEVICE_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  // Mirror of totp.sha256 — kept inline to avoid an import cycle.
  return crypto.createHash('sha256').update(unsigned.value).digest('hex');
}

/**
 * Look up the session attached to the request cookie and return
 * the full session row. Returns null if the cookie is missing,
 * invalid, or the session has expired.
 */
export async function getSession(req: FastifyRequest) {
  const raw = req.cookies[config.cookieName];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const session = await prisma.session.findUnique({
    where: { token: unsigned.value },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

/**
 * Extract the Bearer token from the Authorization header. Returns
 * the raw token (after the "Bearer " prefix) or null if the header
 * is missing, malformed, or doesn't use the Bearer scheme.
 */
export function readBearerToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m && m[1] ? m[1].trim() : null;
}

/**
 * Look up a DEVICE session by its bearer token. Unlike getSession()
 * this does NOT consult cookies — Bearer is the only way to find
 * a DEVICE session. Returns null on missing/invalid/expired token.
 *
 * DEVICE sessions are issued by POST /auth/device-login for the
 * FitQuestBridge helper APK (and any future unattended clients).
 * They have no cookie and last a year; the user can revoke them
 * from the web UI.
 */
export async function getDeviceSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.kind !== 'DEVICE') return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

/**
 * Authenticated user lookup. Tries Bearer first (so an APK doesn't
 * need cookies), then falls back to the cookie session. TOTP_PENDING
 * sessions are rejected so a half-finished login can't reach any
 * protected route. The /auth/login/totp route uses getSession()
 * directly to read the pending session, so it's the one place
 * TOTP_PENDING leaks.
 */
export async function getSessionUser(req: FastifyRequest) {
  const bearer = readBearerToken(req);
  if (bearer) {
    const device = await getDeviceSession(bearer);
    if (device) return device.user;
    // Bearer present but invalid — fail closed rather than silently
    // falling through to a cookie, which would let a typo'd token
    // accidentally authenticate as the web user.
    return null;
  }
  const session = await getSession(req);
  if (!session) return null;
  if (session.kind === 'TOTP_PENDING') return null;
  return session.user;
}

export async function requireUser(req: FastifyRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }
  return user;
}

export async function requireAdmin(req: FastifyRequest) {
  const user = await requireUser(req);
  if (!user.isAdmin) {
    const err = new Error('Forbidden');
    (err as any).statusCode = 403;
    throw err;
  }
  return user;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { token } }).catch(() => {});
}
