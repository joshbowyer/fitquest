/**
 * AI Coach routes.
 *
 *   GET   /coach                 → meta: current personality + available
 *                                  personalities + a tiny summary of
 *                                  what the coach knows (so the UI can
 *                                  surface "hearts: 8 / streak: 12" etc.)
 *                                  + conversation status (message count,
 *                                  has summary) so the page can show
 *                                  "you've been chatting for 12 messages".
 *   POST  /coach                 → send a message, persist user+assistant
 *                                  pair, return the assistant reply +
 *                                  the persisted message IDs.
 *   GET   /coach/messages        → load the user's conversation history
 *                                  (for page-load hydration + future
 *                                  infinite scroll).
 *   DELETE /coach/messages       → wipe the conversation (resets summary).
 *   PATCH /coach/personality     → change the user's personality
 *                                  (persists on User.coachPersonality).
 *
 * Personality SYSTEM_PROMPTs live in `api/src/lib/coach.ts` (code,
 * not DB). Roadmap item: per-personality admin overrides on
 * `LlmConfig.coachSystemPromptOverrides` — when that ships, this
 * route will check the override map first, then fall back to the
 * code-defined prompt.
 *
 * Conversation persistence + sliding-window + LLM summary
 * compaction all live in lib/coachStore.ts (the storage layer).
 * This route is the orchestration: pull context + history → LLM
 * → persist + maybe-compact.
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
import {
  SLIDING_WINDOW_SIZE,
  appendTurn,
  buildPromptMessages,
  clearConversation,
  getOrCreateConversation,
  listMessages,
  maybeGetCompactionBatch,
  trimToSlidingWindow,
  updateSummary,
} from '../lib/coachStore.js';
import { checkChatRate, recordChatSend } from '../lib/rateLimit.js';

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

const MessagesQuerySchema = z.object({
  /// Max messages to return. Default 100 (well over the sliding
  /// window). The UI currently renders all in one shot.
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /// Cursor: only return messages with createdAt < this value.
  /// ISO string. Optional.
  before: z.string().datetime().optional(),
});

export async function coachRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------
  // GET /coach — meta for the page
  // ---------------------------------------------------------------------
  app.get('/', async (req) => {
    const me = await requireUser(req);
    const stored = me.coachPersonality ?? null;
    const active = effectivePersonality(stored);

    // The full context is gathered once and a tiny summary is
    // derived for the page's sidebar chips. Full CoachContext is
    // only sent on POST /coach (chat) — keeps GET cheap for the
    // page-render code path.
    const [ctx, conv] = await Promise.all([
      gatherCoachContext(me.id),
      getOrCreateConversation(me.id),
    ]);
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
      // New in v1.0.29 — chip-side summary of the richer
      // context the coach sees. Surfaced as small text lines under
      // the existing badges so the user can sanity-check what the
      // coach has access to without expanding every section.
      recentWorkoutCount: ctx.recentWorkouts.length,
      pendingSkillsCount: ctx.pendingSkills.count,
      caffeineToday: ctx.substances.caffeineToday,
      yesterdayMealCalories: ctx.nutrition.yesterdayCalories,
      latestWeightKg: ctx.measurements.latestWeight?.value ?? null,
      latestBodyFatPct: ctx.measurements.latestBodyFat?.value ?? null,
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
      /// Conversation status for the page header (so the user can
      /// see "12 messages" + "summarized: yes/no" without opening
      /// the chat panel). Cheap — same row we just fetched.
      conversation: {
        messageCount: conv.messageCount,
        hasSummary: !!conv.summary,
        lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
        createdAt: conv.createdAt.toISOString(),
      },
    };
  });

  // ---------------------------------------------------------------------
  // POST /coach — send a message, persist the turn, get a reply
  // ---------------------------------------------------------------------
  app.post('/', async (req, reply) => {
    const me = await requireUser(req);
    const body = ChatSchema.parse(req.body);

    // ── Rate limit BEFORE the LLM call (so spam never costs
    //    tokens) ───────────────────────────────────────────────
    const rate = checkChatRate(me.id);
    if (!rate.allowed) {
      return reply
        .code(429)
        .header('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)))
        .send({
          error: 'rate_limited',
          retryAfterMs: rate.retryAfterMs,
          hint: "Slow down a bit — the coach has a daily message cap to keep things sustainable.",
        });
    }

    // ── Resolve LLM config + personality (DB-stored, not per-msg) ──
    const config = await getActiveLlmConfig();
    if (!config) {
      return reply.code(422).send({
        error: 'llm_not_configured',
        hint: 'An admin must configure LLM credentials in /admin first.',
      });
    }
    const personality = effectivePersonality(me.coachPersonality ?? null);

    // ── Load conversation + recent turns (will be the sliding
    //    window) ────────────────────────────────────────────────
    const conversation = await getOrCreateConversation(me.id);
    const convWithMessages = await listMessages({ userId: me.id, limit: 500 });
    const allMessages = convWithMessages?.messages ?? [];
    // Trim to sliding window BEFORE the summary injection so the
    // system summary covers what the sliding window DOESN'T.
    const recent = trimToSlidingWindow(allMessages).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // ── Build the prompt: system + summary + recent + new msg + ctx ──
    const context = await gatherCoachContext(me.id);
    const system = coachSystemPrompt(personality);
    // Wrap the user-context JSON as a synthetic user message at the
    // START of the prompt so the LLM treats it as ground truth. (Some
    // providers refuse system→user→assistant alternation beyond a
    // certain depth; prepending as a user turn keeps the message
    // list valid for all providers.)
    const contextTurn = {
      role: 'user' as const,
      content:
        'USER CONTEXT (read-only — do not invent numbers outside this):\n' +
        JSON.stringify(context),
    };
    const historyTurns = buildPromptMessages({
      summary: conversation.summary,
      recentMessages: recent,
      newUserMessage: body.message.trim(),
    });
    // Order: system → context (user turn) → history → new message
    // (already last in historyTurns).
    const promptMessages = [contextTurn, ...historyTurns];

    // ── Single LLM call. Non-streaming — matches every other
    //    LLM-backed endpoint in the codebase. ──────────────────
    const result = await callLlm(
      config,
      {
        system,
        // Reconstruct the prompt as a single string with turn
        // separators. The LLM treats it as a flat conversation.
        prompt: promptMessages
          .map((m) =>
            m.role === 'user' ? `USER: ${m.content}` : `ASSISTANT: ${m.content}`,
          )
          .join('\n\n'),
        maxTokens: 600,
        temperature: 0.5,
        timeoutMs: 60_000,
      },
      'coach',
    );

    if (!result.ok) {
      // Don't persist the user turn on LLM failure — the user
      // sees the 502 and can retry; we don't want half-written
      // turns in the conversation log.
      return reply.code(502).send({
        error: 'coach_unavailable',
        detail: result.error ?? 'LLM call failed',
        latencyMs: result.latencyMs,
        model: result.model,
      });
    }

    // ── Persist the user+assistant pair in one tx + record the
    //    send against the rate limit. ──────────────────────────
    const [turn] = await Promise.all([
      appendTurn({
        conversationId: conversation.id,
        userText: body.message.trim(),
        assistantText: result.text,
        model: result.model,
        latencyMs: result.latencyMs,
        tokensIn: estimateTokens(JSON.stringify(context)) +
                   estimateTokens(conversation.summary ?? '') +
                   recent.reduce((s, m) => s + estimateTokens(m.content), 0),
        tokensOut: estimateTokens(result.text),
      }),
      recordChatSend(me.id),
    ]);

    // ── Maybe trigger compaction. Fire-and-forget (don't block
    //    the response on a 2nd LLM call). The next chat request
    //    will pick up the new summary. ─────────────────────────
    void maybeCompact(me.id, conversation.id);

    return {
      text: result.text,
      personality,
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
      // Echo the persisted message IDs so the client can correlate
      // with its local state if needed. (The UI doesn't use these
      // today; it's here for future "edit last message" or
      // "branch conversation from message X" features.)
      userMessageId: turn.user.id,
      assistantMessageId: turn.assistant.id,
      // Convenience for the UI: number of messages in the convo
      // AFTER this append (i.e. the new count). Lets the page show
      // "this is your 14th message" without a follow-up GET.
      messageCount: conversation.messageCount + 2,
      slidingWindowSize: SLIDING_WINDOW_SIZE,
    };
  });

  // ---------------------------------------------------------------------
  // GET /coach/messages — page-load hydration (and future pagination)
  // ---------------------------------------------------------------------
  app.get('/messages', async (req) => {
    const me = await requireUser(req);
    const q = MessagesQuerySchema.parse(req.query);
    const conv = await listMessages({
      userId: me.id,
      limit: q.limit,
      before: q.before ? new Date(q.before) : undefined,
    });
    if (!conv) {
      return { messages: [], hasSummary: false, messageCount: 0 };
    }
    return {
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        model: m.model,
        latencyMs: m.latencyMs,
        createdAt: m.createdAt.toISOString(),
      })),
      hasSummary: !!conv.summary,
      messageCount: conv.messageCount,
      /// summaryUpdatedAt lets the UI show "summarized 3 messages
      /// ago" without exposing the summary text itself.
      summaryUpdatedAt: conv.summaryUpTo?.toISOString() ?? null,
      slidingWindowSize: SLIDING_WINDOW_SIZE,
    };
  });

  // ---------------------------------------------------------------------
  // DELETE /coach/messages — wipe the conversation (resets summary)
  // ---------------------------------------------------------------------
  app.delete('/messages', async (req) => {
    const me = await requireUser(req);
    await clearConversation(me.id);
    return { ok: true, messageCount: 0 };
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

// =============================================================================
// Helpers
// =============================================================================

/// Rough token estimate. Real model tokenizers are model-specific;
/// for the UI's "(minimax-m3 · 1.2s)" badge + future cost dashboards
/// "chars / 4" is close enough (English averages ~4 chars per token).
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/// Async fire-and-forget compaction. Runs after the chat response
/// is sent so the user doesn't wait on a second LLM call. Errors
/// are logged but don't propagate — the worst case is the
/// conversation grows unbounded, which is bounded by the daily
/// 50-message rate limit anyway.
async function maybeCompact(userId: string, conversationId: string) {
  try {
    const batch = await maybeGetCompactionBatch({ userId, conversationId });
    if (!batch) return;
    const config = await getActiveLlmConfig();
    if (!config) return; // no provider → can't summarize; skip silently
    const summaryPrompt =
      'Summarize the following coaching conversation for future context. ' +
      'Preserve:\n' +
      '- the user\'s stated goals, injuries, and constraints\n' +
      '- any plans or programs the coach prescribed\n' +
      '- recurring themes (e.g. "user keeps asking about squat form")\n' +
      '- specific numbers the user mentioned (weights, dates, PRs)\n' +
      'Skip pleasantries and "see you next time" wrap-ups. Be concise — ' +
      'under 250 words. Output plain prose, no markdown headers or bullets.\n\n' +
      batch.messages
        .map((m) =>
          m.role === 'user' ? `USER: ${m.content}` : `COACH: ${m.content}`,
        )
        .join('\n\n');
    const result = await callLlm(
      config,
      {
        prompt: summaryPrompt,
        maxTokens: 400,
        temperature: 0.2,
        timeoutMs: 45_000,
      },
      'coach',
    );
    if (!result.ok) {
      console.warn(
        `[coach] compaction LLM failed; conversation ${conversationId} will grow unbounded`,
        result.error,
      );
      return;
    }
    await updateSummary({
      conversationId,
      summary: result.text.trim(),
      summaryUpTo: batch.summaryUpTo,
    });
  } catch (err) {
    console.warn('[coach] compaction error', err);
  }
}