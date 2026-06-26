import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
});

export async function exerciseRoutes(app: FastifyInstance) {
  app.get('/catalog', async () => {
    // Built-in canonical exercises; user can also create their own.
    const builtin = [
      { name: 'Bench Press', category: 'STRENGTH', primaryMetric: 'BENCH_1RM' },
      { name: 'Squat', category: 'STRENGTH', primaryMetric: 'SQUAT_1RM' },
      { name: 'Deadlift', category: 'STRENGTH', primaryMetric: 'DEADLIFT_1RM' },
      { name: 'Overhead Press', category: 'STRENGTH', primaryMetric: 'OHP_1RM' },
      { name: 'Weighted Pull-up', category: 'STRENGTH', primaryMetric: 'PULLUP_1RM' },
      { name: 'Bicep Curl', category: 'HYPERTROPHY' },
      { name: 'Tricep Pushdown', category: 'HYPERTROPHY' },
      { name: 'Lateral Raise', category: 'HYPERTROPHY' },
      { name: 'Incline Press', category: 'HYPERTROPHY' },
      { name: 'Romanian Deadlift', category: 'HYPERTROPHY' },
      { name: 'Single Leg RDL', category: 'HYPERTROPHY' },
      { name: 'Leg Press', category: 'HYPERTROPHY' },
      { name: 'Calf Raise', category: 'HYPERTROPHY' },
      { name: 'Plank', category: 'CALISTHENICS' },
      { name: 'L-Sit', category: 'CALISTHENICS' },
      { name: 'Muscle-Up', category: 'CALISTHENICS' },
      { name: 'Push-up', category: 'CALISTHENICS' },
      { name: 'Dip', category: 'CALISTHENICS' },
      { name: 'Pistol Squat', category: 'CALISTHENICS' },
      { name: 'Run', category: 'CARDIO' },
      { name: 'Bike', category: 'CARDIO' },
      { name: 'Row', category: 'CARDIO' },
      { name: 'Swim', category: 'CARDIO' },
    ];
    return { items: builtin };
  });
}
