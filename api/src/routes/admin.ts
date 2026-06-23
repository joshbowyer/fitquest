import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
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

const LlmTaskOverrideSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'MINIMAX']),
  model: z.string().min(1).max(200),
  // Optional per-task credentials. Null/empty = reuse the primary's
  // (most useful for a local Ollama setup where all models share
  // one baseUrl + no apiKey).
  apiKey: z.string().max(500).optional().nullable(),
  baseUrl: baseUrlSchema,
});

// Per-task overrides. Stored as JSON on the LlmConfig row.
// Missing tasks fall back to the default primary.
const TaskOverridesSchema = z.object({
  food: LlmTaskOverrideSchema.optional().nullable(),
  foodSaved: LlmTaskOverrideSchema.optional().nullable(),
  morningReport: LlmTaskOverrideSchema.optional().nullable(),
  spiritualDirector: LlmTaskOverrideSchema.optional().nullable(),
}).optional().nullable();

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
  // ---- Per-task model overrides ----
  taskOverrides: TaskOverridesSchema,
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
      taskOverrides: {
        food: null,
        foodSaved: null,
        morningReport: null,
        spiritualDirector: null,
      },
      systemPrompt: null,
    };
  }
  // taskOverrides is stored as JSON. Older rows may have it null
  // (the column was added later). Always return the canonical
  // 4-key shape so the web form doesn't crash on the edit screen.
  const stored = (row as any).taskOverrides as Record<string, any> | null | undefined;
  return {
    ...row,
    // Redact apiKey: only show last 4 chars
    apiKey: row.apiKey ? `••••${row.apiKey.slice(-4)}` : null,
    fallbackApiKey: row.fallbackApiKey ? `••••${row.fallbackApiKey.slice(-4)}` : null,
    taskOverrides: {
      food: stored?.food ?? null,
      foodSaved: stored?.foodSaved ?? null,
      morningReport: stored?.morningReport ?? null,
      spiritualDirector: stored?.spiritualDirector ?? null,
    },
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

  // Delete a user (admin override). The User model cascades on most
  // relations (workouts, measurements, raid contributions, etc.) so a
  // single delete cleans up the user. Sessions cascade too. Refuses
  // to delete yourself — that's almost always a misclick with a
  // destructive, hard-to-reverse outcome.
  app.delete('/users/:id', async (req, reply) => {
    const me = await requireUser(req);
    const { id } = req.params as { id: string };
    if (id === me.id) {
      return reply.code(400).send({ error: "You can't delete your own account from here" });
    }
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, isAdmin: true },
    });
    if (!target) return reply.code(404).send({ error: 'User not found' });
    // Belt-and-suspenders: kill sessions first (cascade handles it
    // but we want the auth gate to fail immediately for any in-flight
    // request from this user).
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
    return { ok: true, deleted: { id: target.id, username: target.username } };
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
      // Persist per-task overrides. We strip any redacted apiKey
      // markers (••••) so the form round-trip doesn't accidentally
      // overwrite the real key with a redaction string. Per-task
      // apiKey is currently unused in the UI but we still strip it
      // defensively for forward-compat.
      taskOverrides: body.taskOverrides
        ? {
            food: redactOverrideApiKey(body.taskOverrides.food),
            foodSaved: redactOverrideApiKey(body.taskOverrides.foodSaved),
            morningReport: redactOverrideApiKey(body.taskOverrides.morningReport),
            spiritualDirector: redactOverrideApiKey(body.taskOverrides.spiritualDirector),
          }
        : null,
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

  /// Strip the redaction marker (••••) from a per-task override's
  /// apiKey so the form round-trip doesn't accidentally write the
  /// redaction string back to the DB. The override is stored as a
  /// plain object on the JSON column; passing null/undefined in
  /// means "no override for this task" (caller cleared it).
  function redactOverrideApiKey(o: any): any {
    if (!o) return null;
    const out = { ...o };
    if (typeof out.apiKey === 'string' && out.apiKey.startsWith('••••')) {
      delete out.apiKey;
    }
    return out;
  }

  // Expose provider presets so the web form can auto-fill baseUrl + model
  // when the admin switches providers.
  app.get('/llm-providers', async () => {
    return { providers: LLM_PROVIDER_PRESETS };
  });

  // POST /admin/llm-test - send a tiny prompt to verify the saved
  // config actually works end-to-end. The prompt asks the model to
  // self-identify so the response confirms the right model answered.
  //
  // Body:
  //   { which?: 'primary' | 'fallback' }   defaults to 'primary'
  //   { override?: { ...LlmConfig-shaped fields } }   when present, used
  //     INSTEAD of the saved row. Lets the admin test a form they're
  //     still filling in (e.g. they just toggled Fallback Enabled and
  //     don't want to Save first). The override is also persisted to
  //     the DB if the form is dirty, so the next /llm-config GET
  //     reflects the new value.
  app.post('/llm-test', async (req, reply) => {
    const Body = z.object({
      which: z.enum(['primary', 'fallback']).default('primary'),
      // Optional override: full or partial LLM config. Anything
      // missing is filled in from the saved row. If `override` is
      // present we save it to the DB first (so the test always
      // matches what the form will eventually commit).
      override: z
        .object({
          provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'MINIMAX']).optional(),
          apiKey: z.string().optional().nullable(),
          baseUrl: z.string().optional().nullable(),
          model: z.string().optional(),
          enabled: z.boolean().optional(),
          fallbackEnabled: z.boolean().optional(),
          fallbackProvider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'MINIMAX']).optional().nullable(),
          fallbackApiKey: z.string().optional().nullable(),
          fallbackBaseUrl: z.string().optional().nullable(),
          fallbackModel: z.string().optional().nullable(),
        })
        .optional(),
    });
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Bad request: ' + parsed.error.message });
    }
    const { which, override } = parsed.data;
    const existing = await prisma.llmConfig.findFirst();

    // Persist the override first (if provided) so the test reflects
    // what the user just typed. The previous behaviour was to read
    // the saved row, which made the test button useless for changes
    // the user hadn't yet committed.
    if (override) {
      const merge = (cur: any, ov: any) => {
        const out: any = { ...cur };
        for (const [k, v] of Object.entries(ov)) {
          if (v === undefined) continue;
          out[k] = v;
        }
        return out;
      };
      const merged = merge(existing ?? {}, override);
      // Same redacted-key rules as the PUT handler: don't overwrite
      // a real key with the redacted mask "••••last4".
      if (override.apiKey && String(override.apiKey).startsWith('••••')) {
        delete merged.apiKey;
      }
      if (override.fallbackApiKey && String(override.fallbackApiKey).startsWith('••••')) {
        delete merged.fallbackApiKey;
      }
      if (existing) {
        await prisma.llmConfig.update({ where: { id: existing.id }, data: merged });
      } else {
        await prisma.llmConfig.create({ data: merged });
      }
    }

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
