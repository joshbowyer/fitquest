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

const RegisterSchema = z.object({
  email: z.string().email().max(120),
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
      where: { OR: [{ email: body.email }, { username: body.username }] },
      select: { id: true, email: true, username: true },
    });
    if (exists) {
      return reply.code(409).send({ error: 'User with that email or username already exists.' });
    }
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, username: body.username, passwordHash },
      select: {
        id: true, email: true, username: true, level: true, xp: true, gold: true,
        class: true, units: true, createdAt: true, classChangedAt: true,
        soulstones: true, birthDate: true, sex: true, heightCm: true, wristCm: true,
        ankleCm: true, forearmLengthCm: true, neckCircCm: true,
      },
    });
    const { session } = await createSessionAndFetchUser(user.id, req);
    await setSessionCookie(reply, session.token);
    return reply.send({ user });
  });

  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: body.identifier }, { username: body.identifier }] },
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
        spiritualDailyPrayers: user.spiritualDailyPrayers,
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
        spiritualDailyPrayers: user.spiritualDailyPrayers,
      },
    });
  });
}
