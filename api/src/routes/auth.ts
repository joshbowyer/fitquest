import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  createSession,
  createSessionAndFetchUser,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  hashPassword,
  verifyPassword,
  requireUser,
} from '../lib/auth.js';
import { config } from '../lib/config.js';
import { getClassLockStatus, getClassDisplayName, getNextPromotion } from '../lib/classLock.js';
import { isCreatineActive } from './supplements.js';

// Username-only registration — no email. Email features (verification,
// password reset, etc.) are deferred until we have a mail provider.
const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'username may only contain letters, numbers, _ and -'),
  password: z.string().min(8).max(120),
});

const LoginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const exists = await prisma.user.findFirst({
      where: { username: body.username },
      select: { id: true, username: true },
    });
    if (exists) {
      return reply.code(409).send({ error: 'Username already taken.' });
    }
    const passwordHash = await hashPassword(body.password);
    // Generate a stable placeholder email so the User model's NOT NULL
    // email column is satisfied. Real emails are off the table for now.
    const placeholderEmail = `${body.username.toLowerCase()}@local.fitquest`;
    // Bootstrap: the very first user becomes admin. This makes fresh
    // installs self-managing without requiring an env var or seed step.
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        email: placeholderEmail,
        username: body.username,
        passwordHash,
        isAdmin: userCount === 0,
      },
      select: {
        id: true, email: true, username: true, level: true, xp: true, gold: true,
        class: true, units: true, createdAt: true, classChangedAt: true,
        soulstones: true, birthDate: true, sex: true, heightCm: true, wristCm: true,
        ankleCm: true, forearmLengthCm: true, neckCircCm: true,
        isAdmin: true,
      },
    });
    const { session } = await createSessionAndFetchUser(user.id, req);
    await setSessionCookie(reply, session.token);
    return reply.send({ user });
  });

  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    // Username-only login (no email).
    const user = await prisma.user.findUnique({
      where: { username: body.identifier },
    });
    if (!user) return reply.code(401).send({ error: 'Invalid credentials.' });
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'Invalid credentials.' });
    const { session } = await createSessionAndFetchUser(user.id, req);
    await setSessionCookie(reply, session.token);
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        level: user.level,
        xp: user.xp,
        gold: user.gold,
        soulstones: user.soulstones,
        class: user.class,
        classDisplay: getClassDisplayName(user.class, user.level),
        classStage: user.class ? (user.level >= 25 ? 3 : user.level >= 10 ? 2 : 1) : null,
        nextPromotion: getNextPromotion(user.class, user.level),
        units: user.units,
        createdAt: user.createdAt,
        classChangedAt: user.classChangedAt,
        classLock: getClassLockStatus(user.class, user.classChangedAt, user.birthDate, user.soulstones),
        ordained: user.ordained,
        isAdmin: user.isAdmin,
        spiritualDailyPrayers: user.spiritualDailyPrayers,
        creatine: user.creatine,
        timezone: user.timezone,
        creatineActive: await isCreatineActive(user.id),
      },
    });
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
    return reply.send({ ok: true });
  });

  app.get('/me', async (req, reply) => {
    const user = await requireUser(req);
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        level: user.level,
        xp: user.xp,
        gold: user.gold,
        soulstones: user.soulstones,
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
        classLock: getClassLockStatus(user.class, user.classChangedAt, user.birthDate, user.soulstones),
        ordained: user.ordained,
        isAdmin: user.isAdmin,
        spiritualDailyPrayers: user.spiritualDailyPrayers,
        creatine: user.creatine,
        timezone: user.timezone,
        creatineActive: await isCreatineActive(user.id),
      },
    });
  });
}
