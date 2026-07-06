/**
 * Tests for the /skills/unlock route. Verifies:
 *  - test result validation (per the skillTest validators)
 *  - already-unlocked → 400
 *  - wrong class → 400
 *  - not found → 404
 *  - prereq missing → 400
 *  - happy path → 200
 *
 * Note: the SP economy is gone (commit that removed it). The api
 * no longer gates unlocks on a points cost — only the test
 * (if defined) and the per-skill prereqs declared in the seed.
 * Pre-v1 skills (no test) get the prereq check only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock prisma ---
const skills: any[] = [];
const userSkills: any[] = [];
const users: any[] = [];
let currentUser: any = null;

vi.mock('../lib/prisma', () => ({
  prisma: {
    skill: {
      findUnique: vi.fn(async ({ where }: any) => skills.find((s) => s.id === where.id) ?? null),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const u = users.find((u) => u.id === where.id);
        if (u) Object.assign(u, data);
        return u;
      }),
    },
    userSkill: {
      findUnique: vi.fn(async ({ where }: any) =>
        userSkills.find((us) => us.userId === where.userId_skillId.userId && us.skillId === where.userId_skillId.skillId) ?? null,
      ),
      findMany: vi.fn(async ({ where, include }: any) => {
        const rows = userSkills.filter((us) => us.userId === where.userId);
        if (include?.skill) {
          // Attach the joined skill row so routes that read
          // `r.skill.name` etc. don't blow up.
          return rows.map((us) => {
            const s = skills.find((s) => s.id === us.skillId);
            return { ...us, skill: s ?? { name: '(missing)', id: us.skillId, branch: null, tier: 'TIER_1' } };
          });
        }
        return rows;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `us-${userSkills.length + 1}`, ...data };
        userSkills.push(row);
        return row;
      }),
    },
  },
  __addSkill: (s: any) => skills.push(s),
  __addUser: (u: any) => users.push(u),
  __setCurrentUser: (u: any) => { currentUser = u; },
  __getSkills: () => skills,
  __getUserSkills: () => userSkills,
}));
vi.mock('../lib/auth.js', () => ({
  // Returns whatever the test has set as the current user via
  // __setCurrentUser. If unset, returns null (which the route
  // would treat as 401 — but our tests always set it first).
  requireUser: vi.fn(async () => currentUser),
}));

import Fastify from 'fastify';
import { skillRoutes } from '../routes/skills.js';

const __: any = (await import('../lib/prisma'));

beforeEach(() => {
  skills.length = 0;
  userSkills.length = 0;
  users.length = 0;
  currentUser = null;
});

function setupUser(me: { id: string; class: any; level: number; weightKg: number }) {
  users.push({ ...me, weightKg: me.weightKg ?? 0 });
  __.__setCurrentUser(users[users.length - 1]);
}

function setupSkill(s: any) {
  skills.push({ ...s, id: s.id ?? `s-${skills.length + 1}` });
}

async function call(req: any) {
  const app = Fastify();
  await app.register(skillRoutes);
  return app.inject({ ...req, headers: { ...(req.headers ?? {}), 'content-type': 'application/json' } });
}

describe('POST /skills/unlock', () => {
  it('400 when not found', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 'missing', result: {} }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(404);
  });

  it('400 when skill is not the user\'s class', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    setupSkill({ id: 's-jugg', className: 'JUGGERNAUT', tier: 'TIER_1', name: 'Squat', cost: 1, prerequisites: [] });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's-jugg', result: { reps: 5 } }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Not your class/);
  });

  it('400 when already unlocked', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    setupSkill({ id: 's1', className: 'PHANTOM', tier: 'TIER_1', name: 'Plank', cost: 1, prerequisites: [] });
    userSkills.push({ id: 'us-1', userId: 'u1', skillId: 's1' });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's1', result: {} }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Already unlocked/);
  });

  it('400 when prereqs missing', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    setupSkill({ id: 's1', className: 'PHANTOM', tier: 'TIER_2', name: 'Wall HSPU', cost: 1, prerequisites: ['Plank'] });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's1', result: { reps: 5 } }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Requires: Plank/);
  });

  it('SCOUT explicit prereq chain: 10K < 55:00 requires 5K < 25:00', async () => {
    // SCOUT was the second class to ship the explicit per-skill
    // prereq treatment (PHANTOM first, then SCOUT). Each skill
    // declares its own prereqs in seedSkills.ts; the seed loop
    // reads the field verbatim. This test guards the chain so a
    // future "simplify the prereqs" refactor can't silently
    // remove the linear dependency.
    setupUser({ id: 'u1', class: 'SCOUT', level: 5, weightKg: 70 });
    setupSkill({
      id: 's1',
      className: 'SCOUT',
      tier: 'TIER_2',
      name: '10K < 55:00',
      cost: 1,
      prerequisites: ['5K < 25:00'],
      test: {
        metric: 'duration',
        description: '10K in under 55 minutes',
        safety: 'Hydrate + electrolytes',
        threshold: { duration_sec: 3300 },
      },
    });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 3000 } },
      user: { id: 'u1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Requires: 5K < 25:00/);
  });

  it('SCOUT T1 with empty prereqs unlocks cleanly (regression guard)', async () => {
    // T1 SCOUT skills declare `prereqs: []` (not omitted) so the
    // seed loop's "any skill has prereqs" detection picks up
    // SCOUT for explicit mode. A future "let's only define
    // prereqs for T2+" simplification would break this. Empty
    // array on T1 must unlock like an undefined prereqs would.
    //
    // Note on the test setup: the duration validator is "s >= need"
    // (designed for hold-time tests). We pass duration_sec=700
    // (>=600 threshold) so the test focus is the prereq logic,
    // not the duration-validator-vs-"less-than" mismatch that's
    // a separate pre-existing concern (the seed's "1 Mile < 10:00"
    // uses the duration metric but the test name implies "less than
    // 10:00" — a separate ROADMAP item to add a true "max duration"
    // metric).
    setupUser({ id: 'u1', class: 'SCOUT', level: 5, weightKg: 70 });
    setupSkill({
      id: 's1',
      className: 'SCOUT',
      tier: 'TIER_1',
      name: '1 Mile < 10:00',
      cost: 1,
      prerequisites: [],
      test: {
        metric: 'duration',
        description: '1 mile in under 10 minutes',
        safety: 'Stay hydrated',
        threshold: { duration_sec: 600 },
      },
    });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 700 } },
      user: { id: 'u1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('BERSERKER weaving prereq: 100 KB Long Cycle requires both swing volume + snatches', async () => {
    // Kettlebell T3 has TWO T2 prereqs (swing volume + snatches)
    // — a weaving merge point. The route reports the FIRST
    // missing prereq and 400s; unlock only succeeds once all
    // listed prereqs are present. This test exercises the
    // missing-prereq error path.
    setupUser({ id: 'u1', class: 'BERSERKER', level: 5, weightKg: 80 });
    setupSkill({
      id: 's1',
      className: 'BERSERKER',
      tier: 'TIER_3',
      name: '100 KB Long Cycle < 5:00',
      cost: 1,
      prerequisites: ['200 KB Swings < 20:00', '100 KB Snatches < 10:00'],
      test: {
        metric: 'duration',
        description: '100 KB long cycle at 24kg in under 5 minutes',
        safety: 'Build up to long cycle gradually',
        threshold: { duration_sec: 300 },
      },
    });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 250 } },
      user: { id: 'u1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Requires: 200 KB Swings < 20:00/);
  });

  it('BERSERKER weaving prereq: unlock succeeds once all listed prereqs are present', async () => {
    // Counterpart to the previous test. Seed the listed prereqs
    // into the mock's userSkill table so the route sees them as
    // unlocked; the same T3 unlock should then succeed.
    setupUser({ id: 'u1', class: 'BERSERKER', level: 5, weightKg: 80 });
    setupSkill({
      id: 'pre1',
      className: 'BERSERKER',
      tier: 'TIER_2',
      name: '200 KB Swings < 20:00',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 'pre2',
      className: 'BERSERKER',
      tier: 'TIER_2',
      name: '100 KB Snatches < 10:00',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 's1',
      className: 'BERSERKER',
      tier: 'TIER_3',
      name: '100 KB Long Cycle < 5:00',
      cost: 1,
      prerequisites: ['200 KB Swings < 20:00', '100 KB Snatches < 10:00'],
      test: {
        metric: 'duration',
        description: '100 KB long cycle at 24kg in under 5 minutes',
        safety: 'Build up to long cycle gradually',
        threshold: { duration_sec: 300 },
      },
    });
    // Mark both prereqs as unlocked.
    const prismaMod = await import('../lib/prisma.js') as any;
    prismaMod.__addUser({ id: 'u1', class: 'BERSERKER', level: 5, weightKg: 80 });
    await prismaMod.prisma.userSkill.create({ data: { userId: 'u1', skillId: 'pre1' } });
    await prismaMod.prisma.userSkill.create({ data: { userId: 'u1', skillId: 'pre2' } });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 350 } },
      user: { id: 'u1' },
    });
    expect({ status: res.statusCode, body: res.json() }).toEqual({ status: 200, body: expect.objectContaining({ ok: true }) });
  });

  it('TRACER linear prereq: 200m < 25s requires BOTH 100m < 14s AND 200m < 30s (weaving)', async () => {
    // TRACER Sprint T3 weaving — single test that needs both T2
    // path prereqs (faster 100m + 200m). Mirrors the BERSERKER
    // weaving test so each class's prereq mode has a guard.
    setupUser({ id: 'u1', class: 'TRACER', level: 5, weightKg: 70 });
    setupSkill({
      id: 'pre1',
      className: 'TRACER',
      tier: 'TIER_2',
      name: '100m < 14s',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 'pre2',
      className: 'TRACER',
      tier: 'TIER_2',
      name: '200m < 30s',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 's1',
      className: 'TRACER',
      tier: 'TIER_3',
      name: '200m < 25s',
      cost: 1,
      prerequisites: ['100m < 14s', '200m < 30s'],
      test: {
        metric: 'duration',
        description: '200m in under 25 seconds',
        safety: 'Same as T3',
        threshold: { duration_sec: 25 },
      },
    });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 24 } },
      user: { id: 'u1' },
    });
    expect(res.statusCode).toBe(400);
    // The route reports the first missing prereq only.
    expect(res.json().error).toMatch(/Requires: 100m < 14s/);
  });

  it('ORACLE linear prereq: 30min Ignatian Meditation requires BOTH 10min + 20min (weaving)', async () => {
    // ORACLE Ignatian Meditation T3 weaving — the user has done
    // both shorter sits before the long one unlocks.
    setupUser({ id: 'u1', class: 'ORACLE', level: 5, weightKg: 70 });
    setupSkill({
      id: 'pre1',
      className: 'ORACLE',
      tier: 'TIER_2',
      name: '10min Ignatian Meditation',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 'pre2',
      className: 'ORACLE',
      tier: 'TIER_2',
      name: '20min Ignatian Meditation',
      cost: 1,
      prerequisites: [],
      test: null,
    });
    setupSkill({
      id: 's1',
      className: 'ORACLE',
      tier: 'TIER_3',
      name: '30min Ignatian Meditation',
      cost: 1,
      prerequisites: ['10min Ignatian Meditation', '20min Ignatian Meditation'],
      test: {
        metric: 'duration',
        description: '30min seated Ignatian meditation',
        safety: 'Same as T1',
        threshold: { duration_sec: 1800 },
      },
    });
    const res = await call({
      method: 'POST',
      url: '/unlock',
      payload: { skillId: 's1', result: { duration_sec: 1900 } },
      user: { id: 'u1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Requires: 10min Ignatian Meditation/);
  });

  it('400 when test result doesn\'t meet threshold', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    setupSkill({
      id: 's1',
      className: 'PHANTOM',
      tier: 'TIER_1',
      name: '5 Incline Push-Ups',
      cost: 1,
      prerequisites: [],
      test: {
        metric: 'reps',
        description: '5 incline push-ups',
        safety: 'Keep elbows tracked',
        threshold: { reps: 5 },
      },
    });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's1', result: { reps: 3 } }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Test not met/);
    expect(res.json().reason).toMatch(/Need ≥5 reps/);
  });

  it('200 on happy path (test passes, no prereq)', async () => {
    setupUser({ id: 'u1', class: 'PHANTOM', level: 5, weightKg: 100 });
    setupSkill({
      id: 's1',
      className: 'PHANTOM',
      tier: 'TIER_1',
      name: '5 Incline Push-Ups',
      cost: 1,
      prerequisites: [],
      test: {
        metric: 'reps',
        description: '5 incline push-ups',
        safety: 'Keep elbows tracked',
        threshold: { reps: 5 },
      },
    });
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's1', result: { reps: 5 } }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // UserSkill row inserted
    expect(userSkills.length).toBe(1);
  });

  it('200 on weight:reps with bodyweight met', async () => {
    setupUser({ id: 'u1', class: 'JUGGERNAUT', level: 5, weightKg: 100 });
    setupSkill({
      id: 's1',
      className: 'JUGGERNAUT',
      tier: 'TIER_1',
      name: 'BW Squat',
      cost: 1,
      prerequisites: [],
      test: {
        metric: 'weight:reps',
        description: '5 reps at BW',
        safety: 'Squat safely',
        threshold: { reps: 5, weight_kg_mult_of_bw: 1.0 },
      },
    });
    // 100kg / 100kg BW = 1.0× ✓
    const res = await call({ method: 'POST', url: '/unlock', payload: { skillId: 's1', result: { reps: 5, weight_kg: 100 } }, user: { id: 'u1' } });
    expect(res.statusCode).toBe(200);
  });
});
