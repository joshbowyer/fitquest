import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassName } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import {
  validateSkillTest,
  type SkillTestSpec,
  type SkillTestResult,
} from '../lib/skillTest.js';

export async function skillRoutes(app: FastifyInstance) {
  /**
   * GET /skills/tree — the full SkillTree v1 payload for the
   * logged-in user's class. Used by the SkillTree page to render
   * the calitree.app-style vertical-chain tree. Skills are returned
   * in the canonical order: tier ascending, then position ascending.
   *
   * Each item includes the Skill.test JSON (blurb, description,
   * safety, metric, threshold) so the unlock modal can render the
   * full test without a second round-trip.
   */
  app.get('/tree', async (req) => {
    const me = await requireUser(req);
    if (!me.class) return { error: 'Pick a class first' };
    const [all, unlocked] = await Promise.all([
      prisma.skill.findMany({
        where: { className: me.class },
        orderBy: [{ tier: 'asc' }, { position: 'asc' }],
      }),
      prisma.userSkill.findMany({ where: { userId: me.id } }),
    ]);
    const unlockedIds = new Set(unlocked.map((u) => u.skillId));
    const totalSpent = all.filter((s) => unlockedIds.has(s.id)).reduce((a, s) => a + s.cost, 0);
    return {
      className: me.class,
      skillPoints: Math.max(0, Math.floor((me.level - 1) / 2) - totalSpent),
      items: all.map((s) => ({
        id: s.id,
        name: s.name,
        tier: s.tier,
        // Branch label (e.g. JUGGERNAUT "Squat", PHANTOM "Pull").
        // Set by seedSkills; null for pre-v1 leftover skills which
        // the page falls back to "Other" for.
        branch: s.branch,
        blurb: s.blurb,
        position: s.position,
        cost: s.cost,
        prerequisites: s.prerequisites,
        test: s.test,
        // The in-game perk (effects JSON) is preserved for
        // backward compat with the unlock animation. The SkillTree
        // v1 focuses on the test as the unlock mechanism; the perk
        // is a separate visual cue on the unlock modal.
        effects: s.effects,
        unlocked: unlockedIds.has(s.id),
      })),
    };
  });

  /**
   * POST /skills/unlock — mark a skill as unlocked. Accepts the
   * user's test result (raw values) and validates it against the
   * skill's test JSON before inserting the UserSkill row.
   *
   * Body:
   *   skillId: string
   *   result: Record<string, number>  // raw values per the metric
   *
* For pre-v1 skills (no test JSON), the unlock is permitted with
    * no validation — backward compat. New v1 skills all have a test
    * JSON so the validation always runs.
    */
  app.post('/unlock', async (req, reply) => {
    const me = await requireUser(req);
    const body = z
      .object({
        skillId: z.string(),
        // Raw values keyed by metric field. Examples:
        //   { reps: 5, weight_kg: 100 }         // weight:reps
        //   { duration_sec: 35 }                  // duration
        //   { reps: 5, weight_kg: 35, sides: "each" }  // weighted:reps:each
        //   { rounds: 15 }                        // rounds
        //   { distance_m: 5000 }                  // distance
        result: z.record(z.string(), z.number()).default({}),
      })
      .parse(req.body);
    const skill = await prisma.skill.findUnique({ where: { id: body.skillId } });
    if (!skill) return reply.code(404).send({ error: 'Skill not found' });
    if (skill.className !== me.class) return reply.code(400).send({ error: 'Not your class' });
    const already = await prisma.userSkill.findUnique({
      where: { userId_skillId: { userId: me.id, skillId: skill.id } },
    });
    if (already) return reply.code(400).send({ error: 'Already unlocked' });
    // Prereqs
    const mySkills = await prisma.userSkill.findMany({
      where: { userId: me.id },
      include: { skill: true },
    });
    const myNames = new Set(mySkills.map((s) => s.skill.name));
    for (const pre of skill.prerequisites) {
      if (!myNames.has(pre)) return reply.code(400).send({ error: `Requires: ${pre}` });
    }
    // Test result validation (v1)
    if (skill.test) {
      // Build a real SkillTestSpec from the row. The DB column
      // is `Json?` so we trust the shape (validated at seed time).
      const test = skill.test as unknown as SkillTestSpec;
      if (!test || !test.metric || !test.threshold) {
        return reply.code(500).send({ error: 'Skill test is malformed' });
      }
      const result: SkillTestResult = validateSkillTest(
        test,
        body.result as Record<string, number>,
        me.weightKg ?? 0,
      );
      if (!result.ok) {
        return reply.code(400).send({
          error: 'Test not met',
          reason: result.reason,
          submitted: result.submitted,
        });
      }
    }
    // Skill points (legacy / pre-v1)
    const spent = mySkills.reduce((a, s) => a + s.skill.cost, 0);
    const available = Math.max(0, Math.floor((me.level - 1) / 2) - spent);
    if (skill.cost > available) {
      return reply.code(400).send({ error: 'Not enough skill points' });
    }
    await prisma.userSkill.create({ data: { userId: me.id, skillId: skill.id } });
    return { ok: true };
  });

  /**
   * GET /skills/calisthenics-progress — compact summary of the user's
   * calisthenics skill tree progress for the Dashboard radial.
   *
   * Returns:
   *   className:    the user's current class (null if unclassed)
   *   totalSkills:  count of v1 calisthenics skills (PHANTOM tree)
   *   unlocked:     count the user has passed the unlock test for
   *   pct:          unlocked / total (0..1)
   *   recentUnlocks: last 5 skills the user unlocked (for "latest" tooltip)
   *
   * Notes:
   *   - Always reports against the PHANTOM tree since that's the
   *     calisthenics class. Non-PHANTOM users still get a meaningful
   *     count (their unlock% against the canonical 42 calisthenics
   *     skills — useful as "calisthenics mastery" regardless of class).
   *   - Server-side filter: skills with test IS NOT NULL (v1 only).
   *     Pre-v1 leftovers with test=null don't count toward the total.
   */
  app.get('/calisthenics-progress', async (req) => {
    const me = await requireUser(req);
    const [totalSkills, unlockedRows, recentRows, bestHoldPr, deadHangPr] = await Promise.all([
      prisma.skill.count({ where: { className: 'PHANTOM', test: { not: null } } }),
      prisma.userSkill.findMany({
        where: {
          userId: me.id,
          skill: { className: 'PHANTOM', test: { not: null } },
        },
        select: { skillId: true },
      }),
      prisma.userSkill.findMany({
        where: {
          userId: me.id,
          skill: { className: 'PHANTOM', test: { not: null } },
        },
        orderBy: { unlockedAt: 'desc' },
        take: 5,
        include: { skill: { select: { name: true, branch: true, tier: true } } },
      }),
      // Best HOLD-type PR across all static-hold exercises
      // (Dead Hang, Plank, L-Sit, Side Plank, etc). Falls back to
      // the best hold overall if the user hasn't logged a Dead Hang
      // specifically yet.
      prisma.pr.findFirst({
        where: { userId: me.id, type: 'HOLD' },
        orderBy: { value: 'desc' },
        select: { exercise: true, value: true, achievedAt: true },
      }),
      // Dead Hang specifically. Headline chip on the calisthenics
      // radial. Reads from the Measurement table (the manual
      // log path the user takes from the dashboard) rather than
      // the Pr table (which only catches in-workout HOLD PRs).
      // Users don't typically log Dead Hang inside workouts — they
      // go do one and click the gauge to record it.
      prisma.measurement.findFirst({
        where: { userId: me.id, metric: 'DEAD_HANG' },
        orderBy: { recordedAt: 'desc' },
        select: { value: true, recordedAt: true },
      }),
    ]);
    const unlocked = unlockedRows.length;
    return {
      className: me.class,
      totalSkills,
      unlocked,
      pct: totalSkills > 0 ? unlocked / totalSkills : 0,
      recentUnlocks: recentRows.map((r) => ({
        skillId: r.skillId,
        name: r.skill.name,
        branch: r.skill.branch,
        tier: r.skill.tier,
        achievedAt: r.unlockedAt,
      })),
      bestHoldPr: bestHoldPr
        ? {
            exercise: bestHoldPr.exercise,
            valueSec: bestHoldPr.value,
            achievedAt: bestHoldPr.achievedAt,
          }
        : null,
      deadHangPr: deadHangPr
        ? { valueSec: deadHangPr.value, achievedAt: deadHangPr.recordedAt }
        : null,
    };
  });
}
