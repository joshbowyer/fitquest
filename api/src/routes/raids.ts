import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

// Predefined raid bosses. Bosses have static stats — the party
// leader picks which boss to summon but can't define the HP.
// Each boss has its own theme + HP + difficulty rating.
export const RAID_BOSSES = [
  { id: 'iron_colossus',   name: 'Iron Colossus',    hp: 5000,  difficulty: 'Easy',   icon: '🗿', description: 'A slow golem of beaten iron. Easy to chip away.' },
  { id: 'cardio_wyrm',     name: 'Cardio Wyrm',      hp: 8000,  difficulty: 'Medium', icon: '🐉', description: 'A serpent of pure stamina. Punishes long rests.' },
  { id: 'plateau',         name: 'The Plateau',      hp: 3000,  difficulty: 'Easy',   icon: '⛰', description: 'Mountains do not move. You must.' },
  { id: 'skeletal_minion', name: 'Skeletal Minion',  hp: 1500,  difficulty: 'Easy',   icon: '💀', description: 'A weakling, but adds up over time.' },
  { id: 'bpm_demon',       name: 'BPM Demon',        hp: 6000,  difficulty: 'Medium', icon: '👹', description: 'It attacks when your heart rate is high. Cycle smart.' },
  { id: 'gravity_titan',   name: 'Gravity Titan',    hp: 10000, difficulty: 'Hard',   icon: '🌑', description: 'The heaviest boss. For parties of strong lifters.' },
  { id: 'phantom_king',    name: 'Phantom King',     hp: 12000, difficulty: 'Hard',   icon: '👻', description: 'Vanishes and reappears. Endurance race.' },
  { id: 'mirror_self',     name: 'The Mirror',       hp: 9000,  difficulty: 'Hard',   icon: '🪞', description: 'Takes your stats and uses them against you.' },
];

const StartSchema = z.object({
  bossId: z.string().min(2).max(40), // boss id from RAID_BOSSES
});

export async function raidRoutes(app: FastifyInstance) {
  app.get('/active', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { raid: null };
    const raid = await prisma.raid.findFirst({
      where: { partyId: membership.partyId, status: 'ACTIVE' },
      include: {
        contributions: {
          include: { user: { select: { id: true, username: true, class: true, level: true } } },
          orderBy: { contributedAt: 'desc' },
        },
      },
    });
    return { raid };
  });

  app.get('/history', async (req) => {
    const me = await requireUser(req);
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { items: [] };
    const items = await prisma.raid.findMany({
      where: { partyId: membership.partyId, status: { not: 'ACTIVE' } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return { items };
  });

  app.post('/start', async (req) => {
    const me = await requireUser(req);
    const body = StartSchema.parse(req.body);
    const boss = RAID_BOSSES.find((b) => b.id === body.bossId);
    if (!boss) return { error: 'Unknown boss' };
    const membership = await prisma.partyMember.findUnique({ where: { userId: me.id } });
    if (!membership) return { error: 'Join a party first' };
    if (membership.role !== 'LEADER' && membership.role !== 'OFFICER') {
      return { error: 'Only leaders/officers can start a raid' };
    }
    const active = await prisma.raid.findFirst({
      where: { partyId: membership.partyId, status: 'ACTIVE' },
    });
    if (active) return { error: 'A raid is already active' };
    const raid = await prisma.raid.create({
      data: {
        partyId: membership.partyId,
        bossName: boss.name,
        bossHp: boss.hp,
        bossMaxHp: boss.hp,
      },
    });
    // Notify every other party member that a raid just kicked
    // off. The leader is excluded — they started it. The
    // notification gives the others enough lead time to log
    // a workout that matches the boss's matchType (each
    // RAID_BOSSES entry implies one — actually the workout
    // hook does the matching server-side, so the body just
    // tells them "go train").
    try {
      const { emitNotification } = await import('../lib/notify.js');
      const others = await prisma.partyMember.findMany({
        where: { partyId: membership.partyId, userId: { not: me.id } },
        select: { userId: true },
      });
      await Promise.all(others.map((o) =>
        emitNotification({
          userId: o.userId,
          category: 'SYSTEM',
          kind: 'raid_started',
          title: `Raid started: ${boss.name}`,
          body: `${me.username} kicked off a ${boss.difficulty} raid. Log a matching workout to deal damage.`,
          link: '/party',
          payload: {
            raidId: raid.id,
            bossName: boss.name,
            bossDifficulty: boss.difficulty,
            leaderUsername: me.username,
            bossMaxHp: boss.hp,
          },
        }),
      ));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[raids] raid_started emit failed', { userId: me.id, err });
    }
    return { raid, boss };
  });

  // GET /bosses — list available raid bosses (for the picker UI)
  app.get('/bosses', async () => {
    return { bosses: RAID_BOSSES };
  });

  // NOTE: POST /:id/contribute was removed. It let any party member
  // POST arbitrary client-chosen damage (no server-side derivation,
  // no heart multiplier), raced the boss HP with read-modify-write,
  // could double-fire victory rewards, and wrote to a User.soulstones
  // column that no longer exists (PrismaClientValidationError). The
  // only sanctioned damage path is the workout commit in
  // routes/workouts.ts, which derives damage server-side.
}
