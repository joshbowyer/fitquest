import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassName } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

export async function skillRoutes(app: FastifyInstance) {
  app.get('/tree', async (req) => {
    const me = await requireUser(req);
    if (!me.class) return { error: 'Pick a class first' };
    const [all, unlocked] = await Promise.all([
      prisma.skill.findMany({ where: { className: me.class }, orderBy: [{ tier: 'asc' }, { position: 'asc' }] }),
      prisma.userSkill.findMany({ where: { userId: me.id } }),
    ]);
    const unlockedIds = new Set(unlocked.map((u) => u.skillId));
    const totalSpent = all.filter((s) => unlockedIds.has(s.id)).reduce((a, s) => a + s.cost, 0);
    return {
      className: me.class,
      skillPoints: Math.max(0, Math.floor((me.level - 1) / 2) - totalSpent),
      items: all.map((s) => ({ ...s, unlocked: unlockedIds.has(s.id) })),
    };
  });

  app.post('/unlock', async (req) => {
    const me = await requireUser(req);
    const body = z.object({ skillId: z.string() }).parse(req.body);
    const skill = await prisma.skill.findUnique({ where: { id: body.skillId } });
    if (!skill) return { error: 'Skill not found' };
    if (skill.className !== me.class) return { error: 'Not your class' };
    const already = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: me.id, skillId: skill.id } },
    });
    if (already) return { error: 'Already unlocked' };
    // Check prereqs
    const mySkills = await prisma.userSkill.findMany({ where: { userId: me.id }, include: { skill: true } });
    const myNames = new Set(mySkills.map((s) => s.skill.name));
    for (const pre of skill.prerequisites) {
      if (!myNames.has(pre)) return { error: `Requires: ${pre}` };
    }
    // Check skill points
    const spent = mySkills.reduce((a, s) => a + s.skill.cost, 0);
    const available = Math.max(0, Math.floor((me.level - 1) / 2) - spent);
    if (skill.cost > available) return { error: 'Not enough skill points' };
    await prisma.userSkill.create({ data: { userId: me.id, skillId: skill.id } });
    return { ok: true };
  });
}
