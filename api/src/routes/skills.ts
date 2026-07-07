import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ClassName, PrismaRuntime } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { levelFromXp } from '../lib/xp.js';
import {
  validateSkillTest,
  type SkillTestSpec,
  type SkillTestResult,
} from '../lib/skillTest.js';
import { findEligibleSkillUnlocks } from '../lib/skillMatching.js';

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
    return {
      className: me.class,
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
        // Optional: link this unlock to a PendingSkillUnlock row
        // that the activity→skill matching pass created. When
        // present, the server reads the matched set's snapshot
        // data and uses it as the unlock result, then marks the
        // row UNLOCKED. Also gives the workout + set a +XP/gold
        // nudge via the inbox-creation path's stats.
        pendingUnlockId: z.string().optional(),
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
    // If the request came from a PendingSkillUnlock, the row
    // owns the matched-set result. Pull it in and merge with the
    // caller's explicit result object (the caller's wins if both
    // are present, but typically they're identical).
    if (body.pendingUnlockId) {
      const pending = await prisma.pendingSkillUnlock.findUnique({
        where: { id: body.pendingUnlockId },
      });
      if (!pending || pending.userId !== me.id) {
        return reply.code(404).send({ error: 'Pending unlock not found' });
      }
      if (pending.status !== 'PENDING') {
        return reply.code(400).send({ error: `Pending unlock is ${pending.status}` });
      }
      if (pending.skillId !== body.skillId) {
        return reply.code(400).send({ error: 'Pending unlock is for a different skill' });
      }
      body.result = {
        ...(pending.setReps != null && { reps: pending.setReps }),
        ...(pending.setWeight != null && { weight_kg: pending.setWeight }),
        ...(pending.setDuration != null && { duration_sec: pending.setDuration }),
        ...body.result,
      };
    }
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
    // Skill points gate — REMOVED. The SP economy is gone; the unlock
    // is gated entirely on the test (if defined) + the per-skill
    // prereqs declared in the seed. If you can do the test, you
    // can unlock the skill — no level gate, no point economy.
    // Pre-v1 skills (no test) still get the prereq check but no
    // SP cost.
    await prisma.userSkill.create({ data: { userId: me.id, skillId: skill.id } });
    // If this unlock came from a PendingSkillUnlock row, mark
    // it UNLOCKED + set resolvedAt. The matching pass won't see
    // it on the next run (it filters by status='PENDING').
    // Also auto-DISMISS any sibling PENDING rows for the same
    // skill — the matching pass may have created one per
    // matching workout, and the user only needs to confirm
    // once.
    if (body.pendingUnlockId) {
      await prisma.pendingSkillUnlock.update({
        where: { id: body.pendingUnlockId },
        data: { status: 'UNLOCKED', resolvedAt: new Date() },
      });
      await prisma.pendingSkillUnlock.updateMany({
        where: { userId: me.id, skillId: skill.id, status: 'PENDING' },
        data: { status: 'DISMISSED', resolvedAt: new Date() },
      });
    }
    // Bonus XP + gold for unlocking. Tier-scaled so T3 god-tier
    // skills reward more than T1 entry skills. Modest amounts —
    // skills are a side path, workouts should still be the main
    // XP source. (Pre-v1 skills without a test get the T1 reward.)
    const tierBonus = skill.tier === 'TIER_3'
      ? { xp: 50, gold: 25 }
      : skill.tier === 'TIER_2'
        ? { xp: 30, gold: 15 }
        : { xp: 20, gold: 10 };
    // v1 skills (with a test) get the tier bonus; pre-v1 skills get
    // a slightly smaller flat reward since they're "free" unlocks
    // (no test validation).
    const bonus = skill.test ? tierBonus : { xp: 5, gold: 3 };
    // Centralized award (heart multiplier + level recompute in one
    // place instead of the inline increment-then-maybe-level dance).
    const { awardXpGold } = await import('../lib/award.js');
    const award = await awardXpGold(me.id, { xp: bonus.xp, gold: bonus.gold });
    const updatedUser = { xp: award.totalXp, gold: award.totalGold, level: award.level };
    const prevLevel = award.previousLevel;
    const newLevel = award.level;
    return {
      ok: true,
      // `reward` is the ACTUALLY-GRANTED amount (post Hardcore heart
      // multiplier) — previously this was the raw `bonus` and the
      // toast showed "+20 XP" even when the user's 0-heart Hardcore
      // multiplier paid out ×0. `grantedXp`/`grantedGold` give the
      // same numbers without breaking consumers that keyed off
      // `reward`; `bonusXp`/`bonusGold` keep the raw intent for any
      // debug/display use.
      reward: { xp: award.xp, gold: award.gold },
      grantedXp: award.xp,
      grantedGold: award.gold,
      bonusXp: bonus.xp,
      bonusGold: bonus.gold,
      multiplier: award.mult,
      newXp: updatedUser.xp,
      newGold: updatedUser.gold,
      newLevel: updatedUser.level,
      leveledUp: updatedUser.level > prevLevel,
    };
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
      prisma.skill.count({ where: { className: 'PHANTOM', test: { not: PrismaRuntime.AnyNull } } }),
      prisma.userSkill.findMany({
        where: {
          userId: me.id,
          skill: { className: 'PHANTOM', test: { not: PrismaRuntime.AnyNull } },
        },
        select: { skillId: true },
      }),
      prisma.userSkill.findMany({
        where: {
          userId: me.id,
          skill: { className: 'PHANTOM', test: { not: PrismaRuntime.AnyNull } },
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

  // ===================================================================
  // Pending skill-unlock inbox
  // ===================================================================
  //
  // The activity→skill matching pass (lib/skillMatching.ts) creates
  // PendingSkillUnlock rows when a recent workout's set satisfies a
  // locked skill's test. The SkillTree page shows these one at a
  // time on mount; each modal resolves via POST /unlock (UNLOCKED)
  // or POST /pending-unlocks/dismiss (DISMISSED).

  // POST /skills/check-eligible — run the matching pass for the
  // current user and create PendingSkillUnlock rows. Idempotent
  // on (userId, skillId, workoutId, matchedSetId). Called by the
  // workout commit handler on save, and from the SkillTree page's
  // pull-to-refresh / manual "check again" button.
  app.post('/check-eligible', async (req) => {
    const me = await requireUser(req);
    const weight = me.weightKg ?? 0;
    if (!weight) {
      return { created: 0, note: 'set bodyweight in /profile to enable auto-detection' };
    }
    const eligible = await findEligibleSkillUnlocks(me.id, weight);
    let created = 0;
    for (const e of eligible) {
      try {
        await prisma.pendingSkillUnlock.create({
          data: {
            userId: me.id,
            skillId: e.skillId,
            workoutId: e.matchedSet.workoutId,
            matchedSetId: e.matchedSet.setId,
            setReps: e.matchedSet.reps,
            setWeight: e.matchedSet.weight,
            setDuration: e.matchedSet.duration,
            exerciseName: e.matchedSet.exerciseName,
            workoutDate: e.matchedSet.workoutDate,
          },
        });
        created += 1;
      } catch (err: any) {
        // P2002 = unique violation = already pending. Idempotent.
        if (err?.code !== 'P2002') throw err;
      }
    }
    return { created, scanned: eligible.length };
  });

  // GET /skills/pending-unlocks — list the user's PENDING rows in
  // oldest-first order. The SkillTree page renders them as modals
  // one at a time, so order matters (FIFO).
  //
  // Dedupes by skillId: the matching pass can create multiple
  // rows for the same skill (one per matching workout), but the
  // user only needs to see it once. The sibling rows stay in the
  // DB and are auto-DISMISSED when the user unlocks the skill
  // (see /unlock handler above).
  //
  // Belt-and-suspenders prereq re-check: a pending row could have
  // been created by an older matching pass BEFORE the current
  // explicit per-skill prereqs were seeded (PHANTOM got explicit
  // prereqs first, then JUGGERNAUT/SCOUT/BERSERKER/TRACER/ORACLE
  // were converted to the explicit mode in a follow-up pass). The
  // matching pass at /check-eligible time correctly checks the
  // CURRENT prereqs, so new pending rows are always met. But old
  // rows that predate a prereq update are stale — they'd pop up in
  // the inbox and the /skills/unlock handler would reject them
  // with 400 "Requires: X". Re-check the prereqs here too so the
  // inbox only ever surfaces skills that the user CAN unlock right
  // now, and auto-dismiss any stale rows.
  app.get('/pending-unlocks', async (req) => {
    const me = await requireUser(req);
    const rows = await prisma.pendingSkillUnlock.findMany({
      where: { userId: me.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { skill: { select: { id: true, name: true, branch: true, tier: true, blurb: true, test: true, prerequisites: true } } },
    });
    // Build the unlocked-NAMES set so we can re-check prereqs
    // against the user's CURRENT unlocked set. The matching pass
    // already does this when CREATING a row; we re-do it here so
    // rows created before a prereq update don't keep surfacing.
    const unlockedRows = await prisma.userSkill.findMany({
      where: { userId: me.id },
      select: { skillId: true },
    });
    const allSkills = await prisma.skill.findMany({
      where: { className: me.class ?? undefined },
      select: { id: true, name: true },
    });
    const idToName = new Map(allSkills.map((s) => [s.id, s.name]));
    const unlockedNames = new Set(
      unlockedRows.map((r) => idToName.get(r.skillId)).filter((n): n is string => Boolean(n)),
    );
    const seen = new Set<string>();
    const items: Array<Record<string, unknown>> = [];
    const staleIds: string[] = [];
    for (const r of rows) {
      const unmetPrereqs = (r.skill.prerequisites ?? []).filter(
        (n: string) => !unlockedNames.has(n),
      );
      if (unmetPrereqs.length > 0) {
        // Stale row: the skill's prereqs have changed since this
        // pending row was created. Mark it for dismissal so it
        // doesn't show up on the next page load.
        staleIds.push(r.id);
        continue;
      }
      if (seen.has(r.skillId)) continue;
      seen.add(r.skillId);
      items.push({
        id: r.id,
        skillId: r.skillId,
        skillName: r.skill.name,
        branch: r.skill.branch,
        tier: r.skill.tier,
        blurb: r.skill.blurb,
        test: r.skill.test,
        matchedSet: {
          workoutId: r.workoutId,
          workoutName: null, // not snapshotted; we only need the date
          workoutDate: r.workoutDate,
          exerciseName: r.exerciseName,
          setId: r.matchedSetId,
          reps: r.setReps,
          weight: r.setWeight,
          duration: r.setDuration,
        },
        createdAt: r.createdAt,
      });
    }
    // Fire-and-forget auto-dismissal of stale rows. Don't block
    // the inbox response on this — the user doesn't care that
    // the cleanup happened, only that their inbox is accurate.
    if (staleIds.length > 0) {
      prisma.pendingSkillUnlock
        .updateMany({
          where: { id: { in: staleIds } },
          data: { status: 'DISMISSED', resolvedAt: new Date() },
        })
        .catch((e) => {
          req.log.warn({ err: e, staleIds }, 'failed to auto-dismiss stale pending unlocks');
        });
    }
    return { items };
  });

  // POST /skills/pending-unlocks/:id/dismiss — mark a pending row
  // DISMISSED so it never re-appears in the queue. The user is
  // saying "no, I don't want this unlock right now" — the workout
  // set still exists, the next /check-eligible pass would create
  // a new PENDING row, but the dismiss prevents this specific
  // (skill, workout, set) tuple from re-queuing. (If the user
  // logs the same exercise again, the new workout + new set will
  // re-trigger eligibility.)
  app.post<{ Params: { id: string } }>('/pending-unlocks/:id/dismiss', async (req, reply) => {
    const me = await requireUser(req);
    const id = req.params.id;
    const row = await prisma.pendingSkillUnlock.findUnique({ where: { id } });
    if (!row || row.userId !== me.id) {
      return reply.code(404).send({ error: 'Pending unlock not found' });
    }
    await prisma.pendingSkillUnlock.update({
      where: { id },
      data: { status: 'DISMISSED', resolvedAt: new Date() },
    });
    return { ok: true };
  });
}
