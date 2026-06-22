import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/auth.js';
import { hashPassword } from '../lib/auth.js';
import { callLlm } from '../lib/llm.js';

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
});

const ToggleAdminSchema = z.object({
  isAdmin: z.boolean(),
});

// Permissive URL check: empty string or null is valid (means "use provider
// default baseUrl"). Otherwise must start with http:// or https://.
const baseUrlSchema = z
  .string()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/.+/.test(v), {
    message: 'Must be empty or start with http(s)://',
  })
  .optional()
  .nullable();

const LlmConfigSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'MINIMAX']),
  apiKey: z.string().max(500).optional().nullable(),
  baseUrl: baseUrlSchema,
  model: z.string().min(1).max(200),
  enabled: z.boolean().default(false),
  // ---- Secondary / fallback ----
  fallbackEnabled: z.boolean().default(false),
  fallbackProvider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'MINIMAX']).optional().nullable(),
  fallbackApiKey: z.string().max(500).optional().nullable(),
  fallbackBaseUrl: baseUrlSchema,
  fallbackModel: z.string().min(1).max(200).optional().nullable(),
  // ---- Shared ----
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

// Presets per provider. Used by the web form to auto-fill baseUrl + a
// sensible default model when the admin changes provider. Minimax
// uses the Anthropic Messages API at api.minimax.io/anthropic with
// the x-api-key auth header (set up in callLlm).
export const LLM_PROVIDER_PRESETS: Record<string, { baseUrl: string | null; defaultModel: string }> = {
  OPENAI:    { baseUrl: null,                        defaultModel: 'gpt-4o-mini' },
  ANTHROPIC: { baseUrl: null,                        defaultModel: 'claude-3-5-sonnet-20241022' },
  OLLAMA:    { baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.2' },
  MINIMAX:   { baseUrl: 'https://api.minimax.io/anthropic', defaultModel: 'MiniMax-M3' },
};

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
      fallbackEnabled: false,
      fallbackProvider: null,
      fallbackApiKey: null,
      fallbackBaseUrl: null,
      fallbackModel: null,
      systemPrompt: null,
    };
  }
  return {
    ...row,
    // Redact apiKey: only show last 4 chars
    apiKey: row.apiKey ? `••••${row.apiKey.slice(-4)}` : null,
    fallbackApiKey: row.fallbackApiKey ? `••••${row.fallbackApiKey.slice(-4)}` : null,
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
      fallbackEnabled: body.fallbackEnabled,
      fallbackProvider: body.fallbackProvider || null,
      fallbackBaseUrl: body.fallbackBaseUrl || null,
      fallbackModel: body.fallbackModel || null,
      systemPrompt: body.systemPrompt,
    };
    // Only update apiKey if a real (non-redacted) value is passed.
    // We can't tell "user wants to clear" from "no change" without
    // a separate flag, so we treat the redacted prefix as "leave
    // alone" and any other value (including empty string) as
    // "set to this value".
    if (body.apiKey && !body.apiKey.startsWith('••••')) {
      data.apiKey = body.apiKey || null;
    } else if (body.apiKey === '') {
      // Explicit empty string = "clear the key"
      data.apiKey = null;
    }
    if (body.fallbackApiKey && !body.fallbackApiKey.startsWith('••••')) {
      data.fallbackApiKey = body.fallbackApiKey || null;
    } else if (body.fallbackApiKey === '') {
      data.fallbackApiKey = null;
    }
    const config = existing
      ? await prisma.llmConfig.update({ where: { id: existing.id }, data })
      : await prisma.llmConfig.create({ data });
    return { config: await getLlmConfig().then(c => ({ ...c, id: config.id })) };
  });

  // Expose provider presets so the web form can auto-fill baseUrl + model
  // when the admin switches providers.
  app.get('/llm-providers', async () => {
    return { providers: LLM_PROVIDER_PRESETS };
  });

  // POST /admin/llm-test - send a tiny prompt to verify the saved
  // config actually works end-to-end. The prompt asks the model to
  // self-identify so the response confirms the right model answered.
  // Uses the SAVED config (not anything in the form), so the admin
  // can verify persistence without saving first.
  //
  // Body: { which?: 'primary' | 'fallback' }. Defaults to 'primary'.
  // The two test buttons in the UI call this once each.
  app.post('/llm-test', async (req, reply) => {
    const body = z.object({ which: z.enum(['primary', 'fallback']).default('primary') })
      .safeParse(req.body ?? {});
    const which = body.success ? body.data.which : 'primary';
    const row = await prisma.llmConfig.findFirst();
    if (!row) {
      return reply.code(400).send({
        ok: false,
        error: 'No LLM config saved yet. Fill the form and click Save first.',
      });
    }
    if (which === 'primary') {
      if (!row.enabled) {
        return reply.code(400).send({
          ok: false,
          error: 'Primary is saved but disabled. Toggle "Enabled" and save again.',
        });
      }
    } else {
      if (!row.fallbackEnabled) {
        return reply.code(400).send({
          ok: false,
          error: 'Fallback is saved but disabled. Toggle "Fallback enabled" and save again.',
        });
      }
      if (!row.fallbackProvider || !row.fallbackModel) {
        return reply.code(400).send({
          ok: false,
          error: 'Fallback is enabled but missing provider or model. Fill the form and save again.',
        });
      }
    }
    const config = which === 'primary'
      ? {
          provider: row.provider as 'OPENAI' | 'OLLAMA' | 'MINIMAX' | 'ANTHROPIC',
          apiKey: row.apiKey,
          baseUrl: row.baseUrl,
          model: row.model,
          enabled: row.enabled,
          systemPrompt: row.systemPrompt,
        }
      : {
          provider: row.fallbackProvider as 'OPENAI' | 'OLLAMA' | 'MINIMAX' | 'ANTHROPIC',
          apiKey: row.fallbackApiKey,
          baseUrl: row.fallbackBaseUrl,
          model: row.fallbackModel!,
          enabled: true,
          systemPrompt: row.systemPrompt,
        };
    // The model name is interpolated server-side so the test verifies
    // the dynamic substitution works (e.g. if MINIMAX is set, the
    // model name in the prompt is "MiniMax-M3", not "MINIMAX").
    const prompt = `Only say: 'Connection to ${config.model} successful. Hello!' Do not say anything else.`;
    const result = await callLlm(config, {
      prompt,
      // 200 to give the model room after any internal reasoning /
      // thinking blocks (Minimax M2.5 burns tokens on planning).
      maxTokens: 200,
      temperature: 0.1,
      timeoutMs: 30_000,
    });
    return { ...result, which };
  });
}
