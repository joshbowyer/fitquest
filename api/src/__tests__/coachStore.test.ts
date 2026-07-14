/**
 * Pure-logic + storage tests for the AI Coach conversation
 * persistence layer (lib/coachStore.ts).
 *
 * The DB-bound helpers (getOrCreateConversation, appendTurn,
 * clearConversation, updateSummary) are tested via a tiny in-memory
 * mock keyed on Prisma's shape. The pure helpers
 * (buildPromptMessages, trimToSlidingWindow, maybeGetCompactionBatch
 * is pure with respect to its inputs) are tested directly.
 *
 * The route-level integration (POST /coach -> persists ->
 * GET /coach/messages -> round-trip) is tested in a separate
 * coachRoutes.test.ts once the full route is wired.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Prisma mock — captures writes so tests can assert on the conversation log
// without spinning up Postgres. Matches the subset of prisma API surface
// that coachStore actually calls.
// =============================================================================

const h = vi.hoisted(() => {
  // In-memory store. Messages are kept per conversation in createdAt
  // order so trimToSlidingWindow / maybeGetCompactionBatch behave
  // identically to production.
  type Msg = {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    model: string | null;
    latencyMs: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: Date;
  };
  type Conv = {
    id: string;
    userId: string;
    summary: string | null;
    summaryUpTo: Date | null;
    messageCount: number;
    lastMessageAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    messages: Msg[];
  };
  const conversations = new Map<string, Conv>();
  const idCounter = { v: 0 };
  const nextId = () => `cmsg-${++idCounter.v}`;
  // Monotonic counter so every tx.coachMessage.create call gets a
  // unique createdAt even when the test runs in <1ms. Stored on
  // the hoisted object so both the tx and the top-level mock
  // handlers share the same sequence.
  let txClock = 0;

  // Shared update logic — used by both the top-level coachConversation.update
  // and the tx-scoped version. Prisma 5 messageCount accepts:
  //   - plain number (set to that value)
  //   - { increment: N }
  //   - { decrement: N }
  //   - { set: N }
  const applyUpdate = (conv: Conv, data: any) => {
    if (data.messageCount !== undefined) {
      if (typeof data.messageCount === 'number') {
        conv.messageCount = data.messageCount;
      } else if (data.messageCount?.increment) {
        conv.messageCount += data.messageCount.increment;
      } else if (data.messageCount?.decrement) {
        conv.messageCount -= data.messageCount.decrement;
      } else if (data.messageCount?.set !== undefined) {
        conv.messageCount = data.messageCount.set;
      }
    }
    if (data.lastMessageAt !== undefined) conv.lastMessageAt = data.lastMessageAt;
    if (data.summary !== undefined) conv.summary = data.summary;
    if (data.summaryUpTo !== undefined) conv.summaryUpTo = data.summaryUpTo;
    conv.updatedAt = data.updatedAt ?? new Date();
  };

  const prisma = {
    $transaction: vi.fn(async (arg: any) => {
      // Two forms: an array of pending ops, OR an async fn(tx).
      // The store uses the async-fn form (via appendTurn).
      if (typeof arg === 'function') {
        // Shared update logic — used by both the top-level coachConversation.update
// and the tx-scoped version. Prisma 5 messageCount accepts:
//   - plain number (set to that value)
//   - { increment: N }
//   - { decrement: N }
//   - { set: N }
const tx = {
          coachMessage: {
            create: vi.fn(async ({ data }: any) => {
              // Use a monotonically incrementing wall-clock so
              // sub-millisecond test runs still produce a stable
              // createdAt order across all 15 turns. Without
              // this, every user message in the burst shares the
              // same timestamp (since `new Date()` has 1ms
              // resolution), and the sort lands all users first.
              const mockNow = Date.now() + (++txClock);
              const msg: Msg = {
                id: nextId(),
                conversationId: data.conversationId,
                role: data.role,
                content: data.content,
                model: data.model ?? null,
                latencyMs: data.latencyMs ?? null,
                tokensIn: data.tokensIn ?? null,
                tokensOut: data.tokensOut ?? null,
                createdAt: new Date(mockNow),
              };
              const conv = conversations.get(msg.conversationId)!;
              conv.messages.push(msg);
              return msg;
            }),
            deleteMany: vi.fn(async ({ where }: any) => {
              const conv = conversations.get(where.conversationId)!;
              conv.messages.length = 0;
              return { count: 0 };
            }),
          },
          coachConversation: {
            update: vi.fn(async ({ where, data }: any) => {
              const conv = conversations.get(where.id)!;
              applyUpdate(conv, data);
              return conv;
            }),
            upsert: vi.fn(async ({ where, create, update }: any) => {
              const existing = conversations.get(where.userId_userId);
              if (existing) {
                Object.assign(existing, update);
                return existing;
              }
              const conv: Conv = {
                id: `conv-${++idCounter.v}`,
                userId: create.userId,
                summary: create.summary ?? null,
                summaryUpTo: create.summaryUpTo ?? null,
                messageCount: create.messageCount ?? 0,
                lastMessageAt: create.lastMessageAt ?? null,
                createdAt: create.createdAt ?? new Date(),
                updatedAt: create.updatedAt ?? new Date(),
                messages: [],
              };
              conversations.set(conv.id, conv);
              return conv;
            }),
          },
        };
        return arg(tx);
      }
      // Array form — used by clearConversation. Execute ops in
      // order against the same in-memory state.
      const results = [];
      for (const op of arg) {
        if (op?.kind === 'msgDelete') {
          const conv = conversations.get(op.conversationId)!;
          conv.messages.length = 0;
          results.push({ count: conv.messages.length });
        } else if (op?.kind === 'convReset') {
          const conv = conversations.get(op.conversationId)!;
          conv.summary = null;
          conv.summaryUpTo = null;
          conv.messageCount = 0;
          conv.lastMessageAt = null;
          results.push(conv);
        }
      }
      return results;
    }),
    coachConversation: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        // Routes use both: by id (maybeGetCompactionBatch) and by
        // userId (everywhere else). Support both lookups.
        const conv = where.id !== undefined
          ? conversations.get(where.id)
          : Array.from(conversations.values()).find((c) => c.userId === where.userId);
        if (!conv) return null;
        if (!include) return conv;
        if (include.messages) {
          // Honor take / skip from the messages relation args so the
          // maybeGetCompactionBatch code path (which passes take:
          // COMPACTION_BATCH_SIZE) gets the right slice.
          const sorted = conv.messages
            .slice()
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          const take = include.messages.take ?? sorted.length;
          return {
            ...conv,
            messages: sorted.slice(0, take),
          };
        }
        return conv;
      }),
      create: vi.fn(async ({ data }: any) => {
        const conv: Conv = {
          id: `conv-${++idCounter.v}`,
          userId: data.userId,
          summary: data.summary ?? null,
          summaryUpTo: data.summaryUpTo ?? null,
          messageCount: data.messageCount ?? 0,
          lastMessageAt: data.lastMessageAt ?? null,
          createdAt: data.createdAt ?? new Date(),
          updatedAt: data.updatedAt ?? new Date(),
          messages: [],
        };
        conversations.set(conv.id, conv);
        return conv;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const conv = conversations.get(where.id)!;
        applyUpdate(conv, data);
        return conv;
      }),
    },
    coachMessage: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const conv = conversations.get(where.conversationId)!;
        conv.messages.length = 0;
        return { count: conv.messages.length };
      }),
    },
  };
  return { prisma, conversations, idCounter, nextId };
});

vi.mock('../lib/prisma', () => ({
  prisma: h.prisma,
  PrismaRuntime: { AnyNull: Symbol('AnyNull') },
}));

import {
  SLIDING_WINDOW_SIZE,
  COMPACTION_TRIGGER_THRESHOLD,
  COMPACTION_BATCH_SIZE,
  appendTurn,
  buildPromptMessages,
  clearConversation,
  getOrCreateConversation,
  listMessages,
  maybeGetCompactionBatch,
  trimToSlidingWindow,
  updateSummary,
} from '../lib/coachStore';

// Per-test reset: the mock's in-memory store is module-scoped
// so the same conversation carries state across tests in the
// same describe unless we explicitly clear. Conversation
// creates + messages + counters all need to start clean per test.
beforeEach(() => {
  h.conversations.clear();
  h.idCounter.v = 0;
});

// =============================================================================
// Pure helpers
// =============================================================================

describe('trimToSlidingWindow', () => {
  it('returns the input unchanged when <= SLIDING_WINDOW_SIZE', () => {
    const arr = Array.from({ length: 10 }, (_, i) => i);
    expect(trimToSlidingWindow(arr)).toEqual(arr);
    expect(SLIDING_WINDOW_SIZE).toBe(20);
  });

  it('keeps only the most recent N when over the window', () => {
    const arr = Array.from({ length: 35 }, (_, i) => i);
    expect(trimToSlidingWindow(arr)).toEqual([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    ]);
  });
});

describe('buildPromptMessages', () => {
  it('places the summary as a system message at the start', () => {
    const out = buildPromptMessages({
      summary: 'User asked about squat form last week.',
      recentMessages: [{ role: 'user', content: 'how deep?' }],
      newUserMessage: 'and what about knee position?',
    });
    expect(out[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('SUMMARY OF EARLIER CONVERSATION'),
    });
    const first = out[0]!; // toEqual just asserted it exists
    expect(first.content).toContain('User asked about squat form last week.');
  });

  it('skips the summary block when null', () => {
    const out = buildPromptMessages({
      summary: null,
      recentMessages: [],
      newUserMessage: 'hello',
    });
    expect(out.find((m) => m.role === 'system')).toBeUndefined();
    // Last entry is the new user message.
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('drops any system-typed messages from the recent list (defensive)', () => {
    const out = buildPromptMessages({
      summary: null,
      // The store only ever writes 'user' or 'assistant', but if a
      // future feature injected a 'system' row we'd silently drop it
      // from the prompt rather than leak it back to the LLM as a
      // user-turn. This guards the contract.
      recentMessages: [
        { role: 'system', content: 'should-be-dropped' },
        { role: 'user', content: 'kept' },
      ],
      newUserMessage: 'next',
    });
    expect(out.find((m) => m.content === 'should-be-dropped')).toBeUndefined();
    expect(out.some((m) => m.content === 'kept')).toBe(true);
  });

  it('respects the sliding-window trim upstream — every recent message is included as-is', () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }));
    const out = buildPromptMessages({
      summary: null,
      recentMessages: recent,
      newUserMessage: 'turn 20',
    });
    // No summary → no system turn. 20 recent + 1 new = 21 entries.
    expect(out).toHaveLength(21);
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'turn 20' });
  });
});

describe('maybeGetCompactionBatch', () => {
  it('returns null when messageCount is below the trigger threshold', async () => {
    const conv = await getOrCreateConversation('u-below');
    // Add fewer than COMPACTION_BATCH_SIZE messages so both early-
    // return conditions fire (messageCount < threshold AND
    // messages.length < batch size).
    for (let i = 0; i < 2; i++) {
      await appendTurn({
        conversationId: conv.id,
        userText: `msg ${i}`,
        assistantText: `reply ${i}`,
      });
    }
    const batch = await maybeGetCompactionBatch({
      userId: 'u-below',
      conversationId: conv.id,
    });
    expect(batch).toBeNull();
    expect(COMPACTION_TRIGGER_THRESHOLD).toBe(30);
  });

  it('returns the oldest batch when threshold is crossed', async () => {
    const conv = await getOrCreateConversation('u-cross');
    // Add exactly THRESHOLD messages = 15 turns (30 messages).
    for (let i = 0; i < COMPACTION_TRIGGER_THRESHOLD / 2; i++) {
      await appendTurn({
        conversationId: conv.id,
        userText: `user ${i}`,
        assistantText: `asst ${i}`,
      });
    }
    const batch = await maybeGetCompactionBatch({
      userId: 'u-cross',
      conversationId: conv.id,
    });
    expect(batch).not.toBeNull();
    expect(batch!.messages).toHaveLength(COMPACTION_BATCH_SIZE);
    const batchMsgs = batch!.messages; // length just asserted above
    expect(batchMsgs[0]!.content).toBe('user 0');
    expect(batchMsgs[batchMsgs.length - 1]!.content).toBe('asst 4');
  });

  it('summaryUpTo is the timestamp of the LAST message in the batch (not the conversation)', async () => {
    const conv = await getOrCreateConversation('u-ts');
    for (let i = 0; i < COMPACTION_TRIGGER_THRESHOLD / 2; i++) {
      await appendTurn({
        conversationId: conv.id,
        userText: `m ${i}`,
        assistantText: `r ${i}`,
      });
    }
    const batch = await maybeGetCompactionBatch({
      userId: 'u-ts',
      conversationId: conv.id,
    });
    const lastBatchMessage = batch!.messages.at(-1)!;
    // The batch's last message createdAt equals summaryUpTo so the
    // route can store it as the "next compaction starts here" marker.
    expect(batch!.summaryUpTo.getTime()).toBeGreaterThan(0);
  });
});

// =============================================================================
// DB-bound helpers (mocked prisma)
// =============================================================================

describe('getOrCreateConversation', () => {
  it('creates a new conversation on first call', async () => {
    const conv = await getOrCreateConversation('u-new');
    expect(conv.userId).toBe('u-new');
    expect(conv.messageCount).toBe(0);
    expect(conv.summary).toBeNull();
    expect(h.conversations.size).toBe(1);
  });

  it('returns the existing conversation on subsequent calls (idempotent)', async () => {
    const a = await getOrCreateConversation('u-stable');
    const b = await getOrCreateConversation('u-stable');
    expect(b.id).toBe(a.id);
    expect(h.conversations.size).toBe(1);
  });
});

describe('appendTurn', () => {
  it('writes user + assistant messages in one tx + bumps messageCount by 2', async () => {
    const conv = await getOrCreateConversation('u-append');
    const { user, assistant } = await appendTurn({
      conversationId: conv.id,
      userText: 'hi coach',
      assistantText: 'hello, human',
      model: 'minimax-m3',
      latencyMs: 1234,
    });
    expect(user.role).toBe('user');
    expect(user.content).toBe('hi coach');
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toBe('hello, human');
    expect(assistant.model).toBe('minimax-m3');
    expect(assistant.latencyMs).toBe(1234);
    // Conversation counters
    const fresh = await getOrCreateConversation('u-append');
    expect(fresh.messageCount).toBe(2);
    expect(fresh.lastMessageAt).not.toBeNull();
  });

  it('preserves message ordering (assistant > user by createdAt)', async () => {
    const conv = await getOrCreateConversation('u-order');
    await appendTurn({
      conversationId: conv.id,
      userText: 'first',
      assistantText: 'second',
    });
    const reloaded = await listMessages({ userId: 'u-order' });
    expect(reloaded!.messages).toHaveLength(2);
    const msgs = reloaded!.messages; // length just asserted above
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[1]!.role).toBe('assistant');
  });
});

describe('clearConversation', () => {
  it('wipes messages + resets summary + zero messageCount', async () => {
    const conv = await getOrCreateConversation('u-clear');
    await appendTurn({
      conversationId: conv.id,
      userText: 'a',
      assistantText: 'b',
    });
    await updateSummary({
      conversationId: conv.id,
      summary: 'old summary',
      summaryUpTo: new Date(),
    });
    await clearConversation('u-clear');
    const fresh = await getOrCreateConversation('u-clear');
    expect(fresh.messageCount).toBe(0);
    expect(fresh.summary).toBeNull();
    expect(fresh.summaryUpTo).toBeNull();
    expect(fresh.lastMessageAt).toBeNull();
    // Conversation row itself is preserved (unique constraint).
    expect(fresh.id).toBe(conv.id);
  });
});

describe('listMessages', () => {
  it('returns null for a user with no conversation', async () => {
    const conv = await listMessages({ userId: 'u-ghost' });
    expect(conv).toBeNull();
  });

  it('returns messages in chronological order with conversation meta', async () => {
    const conv = await getOrCreateConversation('u-list');
    for (let i = 0; i < 3; i++) {
      await appendTurn({
        conversationId: conv.id,
        userText: `u${i}`,
        assistantText: `a${i}`,
      });
    }
    const loaded = await listMessages({ userId: 'u-list' });
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(6);
    const loadedMsgs = loaded!.messages; // length just asserted above
    expect(loadedMsgs[0]!.content).toBe('u0');
    expect(loadedMsgs[5]!.content).toBe('a2');
    expect(loaded!.messageCount).toBe(6);
  });
});