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
    },
    userSkill: {
      findUnique: vi.fn(async ({ where }: any) =>
        userSkills.find((us) => us.userId === where.userId_skillId.userId && us.skillId === where.userId_skillId.skillId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: any) => userSkills.filter((us) => us.userId === where.userId)),
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
