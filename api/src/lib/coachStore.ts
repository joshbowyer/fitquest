/**
 * AI Coach conversation storage — the persistence layer for
 * /coach/* v1.1. Wraps the prisma calls behind a small surface so
 * the route file stays readable and the storage shape is unit-
 * testable in isolation.
 *
 * Design:
 * - One rolling conversation per user (CoachConversation.userId is
 *   @unique). Auto-spawned by getOrCreateConversation on first
 *   chat. Renaming / multi-conversation is a future P3 item.
 * - Append-only message log (CoachMessage) ordered by createdAt.
 *   Each POST writes a user + assistant pair in one transaction so
 *   the conversation never has a half-written turn.
 * - Compaction: when messageCount crosses THIRTY, the route asks
 *   us to trigger compaction (via maybeTriggerCompaction), which
 *   summarizes the oldest 10 messages via a separate LLM call and
 *   stores the result on CoachConversation.summary. Subsequent
 *   compactions append to the existing summary (so very long
 *   conversations stay bounded).
 * - Reset: clearConversation() deletes messages + resets summary
 *   fields. The row itself is kept (cheap) — the unique constraint
 *   preserves "one per user" semantics.
 *
 * Why this isn't in lib/coach.ts: coach.ts already mixes prompt
 * composition + context gathering; adding storage on top makes
 * the file too big to navigate. Splitting gives each a clear
 * responsibility.
 */
import { prisma } from './prisma.js';

// =============================================================================
// Constants
// =============================================================================

/// Maximum messages sent in the LLM prompt. Older messages are
/// either dropped (sliding window) or folded into the conversation
/// summary on CoachConversation. 20 fits comfortably in the
/// provider's default context window with the ~2k token user
/// context + ~500 token summary + ~500 token response budget.
export const SLIDING_WINDOW_SIZE = 20;

/// When `messageCount` crosses this threshold, trigger an LLM
/// summarization of the oldest N messages and store on the
/// conversation. 30 is the conservative lower bound — below it
/// the full history fits in SLIDING_WINDOW_SIZE + a small buffer
/// and summarizing costs more than it saves.
export const COMPACTION_TRIGGER_THRESHOLD = 30;

/// Number of oldest messages summarized per compaction event.
/// Picked to be a meaningful chunk (not too small to be noisy)
/// but leave enough newer messages in the sliding window to give
/// the LLM verbatim context for the recent conversation.
export const COMPACTION_BATCH_SIZE = 10;

// =============================================================================
// Conversation lifecycle
// =============================================================================

/**
 * Get the user's single conversation, creating it on first call.
 * Idempotent — safe to call on every POST /coach.
 */
export async function getOrCreateConversation(userId: string) {
  const existing = await prisma.coachConversation.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return prisma.coachConversation.create({
    data: { userId },
  });
}

/**
 * Append a message to the conversation and bump the cheap counters.
 * Caller is responsible for the surrounding transaction (used by
 * appendMessages which persists user + assistant + counters in
 * one tx so a failed assistant write doesn't leave an orphan user
 * turn).
 */
export async function appendMessage(args: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}) {
  const ts = new Date();
  return prisma.$transaction(async (tx) => {
    const msg = await tx.coachMessage.create({
      data: {
        conversationId: args.conversationId,
        role: args.role,
        content: args.content,
        model: args.model ?? null,
        latencyMs: args.latencyMs ?? null,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        createdAt: ts,
      },
    });
    await tx.coachConversation.update({
      where: { id: args.conversationId },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: ts,
        updatedAt: ts,
      },
    });
    return msg;
  });
}

/**
 * Append a user+assistant pair + the assistant's metadata in a
 * single tx. The caller passes the assistant's resolved text +
 * model + latency so we capture them on the CoachMessage row for
 * the UI's "(minimax-m3 · 1.2s)" badge.
 *
 * Why a single tx: if the assistant write fails, we don't want a
 * user turn with no response — it makes the conversation look
 * broken on reload.
 */
export async function appendTurn(args: {
  conversationId: string;
  userText: string;
  assistantText: string;
  model?: string | null;
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const ts = new Date();
    const user = await tx.coachMessage.create({
      data: {
        conversationId: args.conversationId,
        role: 'user',
        content: args.userText,
        createdAt: ts,
      },
    });
    const assistant = await tx.coachMessage.create({
      data: {
        conversationId: args.conversationId,
        role: 'assistant',
        content: args.assistantText,
        model: args.model ?? null,
        latencyMs: args.latencyMs ?? null,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        createdAt: new Date(ts.getTime() + 1), // ensure stable ordering
      },
    });
    await tx.coachConversation.update({
      where: { id: args.conversationId },
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: assistant.createdAt,
        updatedAt: new Date(),
      },
    });
    return { user, assistant };
  });
}

/**
 * List messages for the user's conversation, oldest-first. The
 * UI gets the full history on page-load hydration; pagination is
 * only relevant if the user has thousands of messages (rare).
 *
 * `limit` defaults to 100 (well over the sliding window). `before`
 * is a cursor: when set, only returns messages with createdAt <
 * that value. The UI doesn't currently use pagination (the chat
 * panel renders everything in order) but the shape is here for
 * future infinite-scroll support.
 */
export async function listMessages(args: {
  userId: string;
  limit?: number;
  before?: Date;
}) {
  const conv = await prisma.coachConversation.findUnique({
    where: { userId: args.userId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: args.limit ?? 100,
        ...(args.before ? { cursor: { id: '' }, skip: 0, where: { createdAt: { lt: args.before } } } : {}),
      },
    },
  });
  return conv;
}

/**
 * Drop all messages + reset summary fields. The conversation row
 * itself is kept (idempotent reset; cheap; preserves the
 * "one per user" unique constraint without a recreate cycle).
 */
export async function clearConversation(userId: string) {
  const conv = await getOrCreateConversation(userId);
  return prisma.$transaction(async (tx) => {
    await tx.coachMessage.deleteMany({
      where: { conversationId: conv.id },
    });
    await tx.coachConversation.update({
      where: { id: conv.id },
      data: {
        summary: null,
        summaryUpTo: null,
        messageCount: 0,
        lastMessageAt: null,
        updatedAt: new Date(),
      },
    });
  });
}

/**
 * Store (or replace) the conversation summary. Called by the
 * compaction flow after the LLM produces a summary string.
 * summaryUpTo is set to the latest message included in the
 * summary so future re-summarizations can pick up where we left off.
 */
export async function updateSummary(args: {
  conversationId: string;
  summary: string;
  summaryUpTo: Date;
}) {
  return prisma.coachConversation.update({
    where: { id: args.conversationId },
    data: {
      summary: args.summary,
      summaryUpTo: args.summaryUpTo,
      updatedAt: new Date(),
    },
  });
}

// =============================================================================
// Compaction
// =============================================================================

/**
 * Decide whether to trigger compaction. Returns the messages to
 * summarize (oldest N, oldest-first) if the threshold has been
 * crossed, or null if no compaction is needed yet.
 *
 * Single-shot compaction (v1.1): triggered the first time
 * messageCount crosses 30. The summary grows by re-running this
 * function on the next threshold. Future: incremental summaries
 * that append to the existing summary instead of replacing it.
 */
export async function maybeGetCompactionBatch(args: {
  userId: string;
  conversationId: string;
}): Promise<{ messages: Array<{ id: string; role: string; content: string }>; summaryUpTo: Date } | null> {
  const conv = await prisma.coachConversation.findUnique({
    where: { id: args.conversationId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: COMPACTION_BATCH_SIZE,
      },
    },
  });
  if (!conv) return null;
  if (conv.messageCount < COMPACTION_TRIGGER_THRESHOLD) return null;
  // For v1.1, do single-shot compaction: re-summarize the oldest
  // batch each time and append to the existing summary. Cheap
  // enough at this scale (1 LLM call per 30 messages) that the
  // alternative — incremental — isn't worth the complexity yet.
  if (conv.messages.length < COMPACTION_BATCH_SIZE) return null;
  const lastMessage = conv.messages[conv.messages.length - 1];
  if (!lastMessage) return null;
  return {
    messages: conv.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    })),
    summaryUpTo: lastMessage.createdAt,
  };
}

/**
 * Compose the prompt-block the route sends alongside the system
 * prompt + sliding window. Includes:
 *   - The conversation summary (if any)
 *   - Then the most recent SLIDING_WINDOW_SIZE messages in
 *     [role]: [content] format
 *
 * Pure function — no DB calls, no LLM. The route calls this
 * AFTER loading the conversation's messages from listMessages
 * and trimming to the sliding window.
 */
export function buildPromptMessages(args: {
  summary: string | null;
  recentMessages: Array<{ role: string; content: string }>;
  newUserMessage: string;
}): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

  // Prepend the summary as a system message so the LLM treats it
  // as authoritative context, not as user input. Falls back to
  // nothing if no summary yet.
  if (args.summary) {
    out.push({
      role: 'system',
      content:
        'SUMMARY OF EARLIER CONVERSATION (older than the most recent ' +
        `${SLIDING_WINDOW_SIZE} messages — do NOT repeat these topics unless the user brings them up):\n` +
        args.summary,
    });
  }

  // The recent turns. Filter to only user/assistant (defensive —
  // any system messages in the stored log are from a future
  // feature and shouldn't be re-fed).
  for (const m of args.recentMessages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    out.push({ role: m.role, content: m.content });
  }

  // The current turn. The LLM call expects the user's message last.
  out.push({ role: 'user', content: args.newUserMessage });

  return out;
}

/**
 * Apply the sliding-window trim to a list of messages. Keeps the
 * most recent N. Pure — no DB.
 */
export function trimToSlidingWindow<T>(messages: T[]): T[] {
  if (messages.length <= SLIDING_WINDOW_SIZE) return messages;
  return messages.slice(-SLIDING_WINDOW_SIZE);
}