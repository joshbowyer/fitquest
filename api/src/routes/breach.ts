// ============================================================
// The Breach — HTTP routes (Fastify)
// ============================================================
//
// GET /breach         — current progress + boss + recent damage + drops
// GET /breach/pool    — full boss pool (read-only, for transparency)
// POST /breach/claim  — claim VICTORY → rotate next boss + drop rewards
// POST /breach/skip   — pay 10 gold to skip the current boss
//
// All routes require auth. Damage is applied server-side on
// workout commit (workouts.ts hook), NOT via this endpoint —
// clients don't get to send arbitrary damage values.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  getOrCreateProgress,
  rollNextBoss,
  claimKill,
  tickCooldown,
  unlockBreachIfReady,
  BREACH_UNLOCK_LEVEL,
} from '../lib/breach.js';

export async function breachRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const me = await requireUser(req);
    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { level: true, class: true },
    });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    // Lazy-unlock + cooldown tick on every GET so the UI sees a
    // fresh status without polling for transitions.
    await unlockBreachIfReady(me.id, user.level);
    await tickCooldown(me.id);

    const progress = await getOrCreateProgress(me.id);
    const boss = progress.currentBossId
      ? await prisma.breachBoss.findUnique({ where: { id: progress.currentBossId } })
      : null;
    const recentDamage = await prisma.breachDamageEvent.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { boss: { select: { name: true, spriteEmoji: true, spriteColor: true } } },
    });

    return reply.send({
      progress: {
        status: progress.status,
        unlockedAt: progress.unlockedAt,
        bossHp: progress.bossHp,
        bossMaxHp: boss?.maxHp ?? 0,
        damageToday: progress.damageToday,
        damageDayKey: progress.damageDayKey,
        kills: progress.kills,
        soulstones: progress.soulstones,
        deaths: progress.deaths,
        recentBossIds: progress.recentBossIds,
        lastDeathAt: progress.lastDeathAt,
      },
      boss: boss
        ? {
            id: boss.id,
            name: boss.name,
            lore: boss.lore,
            intro: boss.intro,
            tier: boss.tier,
            difficulty: boss.difficulty,
            classAffinity: boss.classAffinity,
            preferredTags: boss.preferredTags,
            bonusTags: boss.bonusTags,
            spriteEmoji: boss.spriteEmoji,
            spriteColor: boss.spriteColor,
          }
        : null,
      recentDamage: recentDamage.map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
        damage: d.damage,
        bossHpAfter: d.bossHpAfter,
        matchType: d.matchType,
        bossName: d.boss?.name ?? '',
        bossSprite: d.boss?.spriteEmoji ?? '',
        bossColor: d.boss?.spriteColor ?? '',
      })),
      unlockLevel: BREACH_UNLOCK_LEVEL,
      userLevel: user.level,
      userClass: user.class,
    });
  });

  app.get('/pool', async (_req, reply) => {
    const bosses = await prisma.breachBoss.findMany({
      orderBy: [{ tier: 'asc' }, { difficulty: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        tier: true,
        difficulty: true,
        classAffinity: true,
        preferredTags: true,
        bonusTags: true,
        spriteEmoji: true,
        spriteColor: true,
        lore: true,
        intro: true,
      },
    });
    return reply.send({ bosses });
  });

  app.post('/claim', async (req, reply) => {
    const me = await requireUser(req);
    const reward = await claimKill(me.id);
    if (!reward) return reply.code(400).send({ error: 'no_pending_victory' });
    return reply.send({ reward });
  });

  app.post('/skip', async (req, reply) => {
    const me = await requireUser(req);
    const progress = await getOrCreateProgress(me.id);
    if (progress.status === 'LOCKED' || !progress.currentBossId) {
      return reply.code(400).send({ error: 'no_active_boss' });
    }
    const skipPenalty = 10;
    const user = await prisma.user.findUnique({ where: { id: me.id } });
    if (!user || user.gold < skipPenalty) {
      return reply.code(400).send({ error: 'insufficient_gold' });
    }
    const nextBoss = await rollNextBoss(
      me.id,
      (progress.recentBossIds as string[]).filter((id) => id !== progress.currentBossId),
      prisma
    );
    await prisma.$transaction([
      prisma.user.update({ where: { id: me.id }, data: { gold: { decrement: skipPenalty } } }),
      prisma.userBreachProgress.update({
        where: { userId: me.id },
        data: {
          currentBossId: nextBoss.id,
          bossHp: nextBoss.maxHp,
          status: 'ACTIVE',
          recentBossIds: [
            nextBoss.id,
            ...((progress.recentBossIds as string[]).filter((id) => id !== progress.currentBossId)),
          ].slice(0, 10),
        },
      }),
    ]);
    return reply.send({ nextBoss: { id: nextBoss.id, name: nextBoss.name }, goldLost: skipPenalty });
  });
}
