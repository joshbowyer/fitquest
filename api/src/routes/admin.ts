import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/auth.js';
import { hashPassword } from '../lib/auth.js';

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
});

const ToggleAdminSchema = z.object({
  isAdmin: z.boolean(),
});

const LlmConfigSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA']),
  apiKey: z.string().max(500).optional().nullable(),
  baseUrl: z.string().url().optional().nullable(),
  model: z.string().max(200),
  enabled: z.boolean().default(false),
  // System prompt / persona. Optional.
  systemPrompt: z.string().max(4000).optional().nullable(),
});

// GET /admin/users - list all users (no password hashes, no 2FA secrets)
async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      isAdmin: true,
      twoFactorEnabled: true,
      class: true,
      level: true,
      xp: true,
      gold: true,
      soulstones: true,
      createdAt: true,
      _count: { select: { sessions: true, workouts: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

// GET /admin/llm-config - return current LLM config (redact apiKey)
async function getLlmConfig() {
  const row = await prisma.llmConfig.findFirst();
  if (!row) {
    return {
      provider: 'OPENAI',
      apiKey: null,
      baseUrl: null,
      model: 'gpt-4o-mini',
      enabled: false,
      systemPrompt: null,
    };
  }
  return {
    ...row,
    // Redact apiKey: only show last 4 chars
    apiKey: row.apiKey ? `••••${row.apiKey.slice(-4)}` : null,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  // All admin routes require the caller to be isAdmin.
  app.addHook('preHandler', async (req) => {
    await requireAdmin(req);
  });

  // List all users
  app.get('/users', async () => {
    const users = await listUsers();
    return { users };
  });

  // Reset a user's password (admin override)
  app.post('/users/:id/reset-password', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = ResetPasswordSchema.parse(req.body);
    const passwordHash = await hashPassword(body.newPassword);
    const user = await prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, username: true },
    });
    // Invalidate all their existing sessions so they have to log in fresh.
    await prisma.session.deleteMany({ where: { userId: id } });
    return { ok: true, user };
  });

  // Clear a user's 2FA secret + recovery codes (admin override)
  app.post('/users/:id/clear-2fa', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.update({
      where: { id },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
        twoFactorBackupCodes: null,
      },
      select: { id: true, username: true },
    });
    return { ok: true, user };
  });

  // Toggle another user's admin status
  app.post('/users/:id/toggle-admin', async (req) => {
    const { id } = req.params as { id: string };
    const body = ToggleAdminSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id },
      data: { isAdmin: body.isAdmin },
      select: { id: true, username: true, isAdmin: true },
    });
    return { ok: true, user };
  });

  // Get current LLM config (single-row table)
  app.get('/llm-config', async () => {
    const config = await getLlmConfig();
    return { config };
  });

  // Upsert LLM config
  app.put('/llm-config', async (req) => {
    const body = LlmConfigSchema.parse(req.body);
    const existing = await prisma.llmConfig.findFirst();
    const data: any = {
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      enabled: body.enabled,
      systemPrompt: body.systemPrompt,
    };
    // Only update apiKey if a real (non-redacted) value is passed.
    if (body.apiKey && !body.apiKey.startsWith('••••')) {
      data.apiKey = body.apiKey;
    }
    const config = existing
      ? await prisma.llmConfig.update({ where: { id: existing.id }, data })
      : await prisma.llmConfig.create({ data });
    return { config: await getLlmConfig().then(c => ({ ...c, id: config.id })) };
  });
}
