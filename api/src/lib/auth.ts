import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { config } from './config.js';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createSession(userId: string, req: FastifyRequest) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      token,
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

export async function getSessionUser(req: FastifyRequest) {
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
