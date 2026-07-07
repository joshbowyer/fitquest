/**
 * AI Coach routes.
 *
 *   GET  /coach                 → meta: current personality + available
 *                                 personalities + a tiny summary of
 *                                 what the coach knows (so the UI can
 *                                 surface "hearts: 8 / streak: 12" etc.)
 *   POST /coach                 → send a message, get a single
 *                                 response. Non-streaming JSON
 *                                 (matches every other LLM-backed
 *                                 endpoint in this codebase).
 *   PATCH /coach/personality    → change the user's personality
 *                                 (persists on User.coachPersonality).
 *
 * Personality SYSTEM_PROMPTs live in `api/src/lib/coach.ts` (code,
 * not DB). Roadmap item: per-personality admin overrides on
 * `LlmConfig.coachSystemPromptOverrides` — when that ships, this
 * route will check the override map first, then fall back to the
 * code-defined prompt.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, CoachPersonality } from '../lib/prisma.js';
import { requireUser } from '../lib/auth.js';
import { getActiveLlmConfig, callLlm } from '../lib/llm.js';
import {
  COACH_PERSONALITIES,
  DEFAULT_COACH_PERSONALITY,
  coachSystemPrompt,
  effectivePersonality,
  gatherCoachContext,
  type CoachContext,
} from '../lib/coach.js';

/// Body schemas.
const ChatSchema = z.object({
  /// The user's message. 1-2000 chars; LLM context budget is
  /// the real ceiling, but 2000 is plenty for any realistic
  /// fitness question.
  message: z.string().min(1).max(2000),
});

const PersonalitySchema = z.object({
  /// Pass null to clear (user returns to "no preference" →
  /// server uses DEFAULT_COACH_PERSONALITY for the next chat).
  /// Pass a valid enum value to set.
  personality: z.union([z.nativeEnum(CoachPersonality), z.null()]),
});

export async function coachRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------
  // GET /coach — meta for the page
  // ---------------------------------------------------------------------
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const stored = me.coachPersonality ?? null;
    const active = effectivePersonality(stored);

    // Tiny context summary so the UI can show "Hearts 8/10 · 12-day
    // streak" badges next to the chat without making a second
    // request. Full CoachContext is only built on POST (chat), not
    // here — keeps GET cheap for the page-render code path.
    const ctx = await gatherCoachContext(me.id);
    const summary = {
      hearts: ctx.user.hearts,
      maxHearts: 10,
      mode: ctx.user.mode,
      level: ctx.user.level,
      className: ctx.user.class,
      currentStreak: ctx.routine.currentStreak,
      thisWeekCount: ctx.routine.thisWeekCount,
      weeklyGoal: ctx.routine.weeklyGoal,
      recoveryToday: ctx.recovery.todayScore,
      last7Days: {
        workoutCount: ctx.last7Days.workoutCount,
        avgSleepHours: ctx.last7Days.avgSleepHours,
        prCount: ctx.last7Days.prCount,
      },
    };

    return {
      activePersonality: active,
      /// Returns the stored value (null if unset) so the UI can
      /// distinguish "I picked GENERIC explicitly" from "I never
      /// picked anything". The `activePersonality` field above is
      /// the effective one — what the server will use for the
      /// next chat if the user doesn't change it.
      storedPersonality: stored,
      defaultPersonality: DEFAULT_COACH_PERSONALITY,
      available: COACH_PERSONALITIES,
      contextSummary: summary,
      modelLabel: 'minimax-m3 (system default)',
    };
  });

  // ---------------------------------------------------------------------
  // POST /coach — send a message, get a reply
  // ---------------------------------------------------------------------
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = ChatSchema.parse(req.body);

    // Personality comes from the DB (user's persisted choice), not
    // from the request body — v1 doesn't support per-message
    // personality override. The PATCH endpoint changes the stored
    // value; subsequent chats see it.
    const personality = effectivePersonality(me.coachPersonality ?? null);

    const config = await getActiveLlmConfig();
    if (!config) {
      return reply.code(422).send({
        error: 'llm_not_configured',
        hint: 'An admin must configure LLM credentials in /admin first.',
      });
    }

    // Gather user context + compose the prompt. Single LLM call
    // per chat turn; no streaming (matches every other LLM
    // endpoint in the codebase).
    const context = await gatherCoachContext(me.id);
    const system = coachSystemPrompt(personality);
    const userPrompt = [
      'USER MESSAGE:',
      body.message.trim(),
      '',
      'USER CONTEXT (JSON, read-only — do not invent numbers outside this):',
      JSON.stringify(context, null, 0),
    ].join('\n');

    const result = await callLlm(
      config,
      {
        system,
        prompt: userPrompt,
        maxTokens: 600,
        temperature: 0.5,
        // Coach chats are user-initiated; longer timeout than the
        // 30s default so a slow provider doesn't drop the response
        // mid-paragraph.
        timeoutMs: 60_000,
      },
      'coach',
    );

    if (!result.ok) {
      return reply.code(502).send({
        error: 'coach_unavailable',
        detail: result.error ?? 'LLM call failed',
        latencyMs: result.latencyMs,
        model: result.model,
      });
    }

    return {
      text: result.text,
      personality,
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
    };
  });

  // ---------------------------------------------------------------------
  // PATCH /coach/personality — set/clear the user's personality
  // ---------------------------------------------------------------------
  app.patch('/personality', async (req) => {
    const me = await requireUser(req);
    const body = PersonalitySchema.parse(req.body);
    await prisma.user.update({
      where: { id: me.id },
      data: { coachPersonality: body.personality },
    });
    return {
      coachPersonality: body.personality,
      /// Effective personality after the change — what the next
      /// chat will use. Lets the UI show "now talking to Father
      /// Iron" without a second GET.
      effective: effectivePersonality(body.personality),
    };
  });
}