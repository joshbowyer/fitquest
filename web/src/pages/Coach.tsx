/**
 * AI Coach page — chat-style interface for talking to the configured
 * LLM with a FitQuest-aware personality preset.
 *
 * v1.1 (persistence):
 *   - Personality selector (5 presets, server-driven list)
 *   - Persistent conversation: GET /coach/messages hydrates on
 *     page load so the user can close the browser and come back
 *     tomorrow with their context intact.
 *   - Sliding window: the page renders every persisted message;
 *     the server only sends the last 20 to the LLM at any time
 *     (older turns get folded into a summary block on the 30th
 *     message).
 *   - Rate limits: 5/min burst + 50/day cost cap; UI surfaces the
 *     429 with a friendly retry message.
 *   - "Clear conversation" button in the panel header so the user
 *     can wipe history (saves the personality choice).
 *
 * Deliberately NOT yet:
 *   - Streaming responses (SSE plumbing — out of scope)
 *   - Multi-conversation list / "New chat" / rename / delete
 *   - Per-message personality override
 *
 * Future additions (roadmap items already noted):
 *   - Admin LlmConfig.coachSystemPromptOverrides per personality
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import type {
  CoachChatRequest,
  CoachChatResponse,
  CoachMessagesResponse,
  CoachMetaWithConversation,
  CoachMessage,
  CoachPersonality,
  CoachPersonalityMeta,
} from '@/lib/types';

// =============================================================================
// Inner page — assumes Layout wrapper. The default export below wraps it
// in RequireAuth (App.tsx); splitting it this way keeps the testable surface
// focused on state + chat logic.
// =============================================================================
function CoachInner() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Meta: current personality + available list + context summary +
  // conversation stats. 5-min stale time so quick tab-switches
  // don't re-fetch; manually invalidated after personality change
  // or message append.
  const metaQ = useQuery({
    queryKey: ['coach', 'meta'],
    queryFn: () => api<CoachMetaWithConversation>('/coach'),
    staleTime: 5 * 60 * 1000,
  });

  // Persisted messages for the current conversation. Hydrated from
  // GET /coach/messages on page load; mutated locally on send.
  // React Query handles cache invalidation so a reload sees the
  // latest server state.
  const messagesQ = useQuery({
    queryKey: ['coach', 'messages'],
    queryFn: () => api<CoachMessagesResponse>('/coach/messages'),
    staleTime: 30 * 1000,
  });

  const [rateLimitRetryMs, setRateLimitRetryMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // The messages panel has its own overflow-y-auto div inside
  // the Panel (max-h-[60vh]). On FIRST render we scroll it to
  // the top so the user sees the start of the conversation (or
  // the empty state). On SUBSEQUENT renders — i.e. the user
  // sent a new message — we scroll to the bottom to show the
  // latest reply. Without this split, navigating to /coach
  // always lands at the bottom (because the auto-scroll-to-bottom
  // effect fires on initial mount), and the ScrollToTop helper
  // on Layout's <main> doesn't help because the messages div is
  // an independent scroller.
  //
  // We track the previous count via a ref so the effect can
  // distinguish "first load" (count == 0 before, then > 0) from
  // "new message appended" (count strictly greater than before).
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);

  // Initial render: scroll messages panel to top so the user
  // sees the start of the conversation (or the empty state).
  // Subsequent renders where the message count grew: scroll to
  // bottom so the latest reply is visible. See the long comment
  // on messagesContainerRef above for the full rationale.
  useEffect(() => {
    const msgs = messagesQ.data?.messages;
    if (!msgs) return; // still loading — wait until the next render
    const count = msgs.length;
    if (!initializedRef.current) {
      // First time messages have loaded — scroll the messages div
      // to its top. The Layout-level ScrollToTop already handled
      // the page-level scroll by the time this fires, so this
      // handles just the inner scroller.
      messagesContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
      initializedRef.current = true;
    } else if (count > prevMsgCountRef.current) {
      // New messages appended (e.g. user sent a turn) — scroll to
      // bottom so the new reply is visible.
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCountRef.current = count;
  }, [messagesQ.data?.messages.length]);

  // Send mutation. Wraps the POST + invalidates the messages
  // query so the new turn appears (server is the source of truth
  // for message IDs + creation timestamps).
  const sendM = useMutation<CoachChatResponse, Error, string>({
    mutationFn: async (message: string) => {
      try {
        return await api<CoachChatResponse>('/coach', {
          method: 'POST',
          body: { message } satisfies CoachChatRequest,
        });
      } catch (err: any) {
        // Surface rate-limit details so the UI can render a
        // friendly retry hint instead of "unknown error".
        const status = err?.status ?? err?.response?.status;
        if (status === 429) {
          const ra = err?.response?.headers?.get?.('Retry-After')
            ?? err?.response?.headers?.get?.('retry-after');
          setRateLimitRetryMs(ra ? Number(ra) * 1000 : null);
          setLastError('Too many messages — slow down a bit.');
        } else if (status === 502) {
          setLastError("The coach didn't answer — try again, it might be a transient provider hiccup.");
        } else if (status === 422) {
          setLastError("The LLM isn't configured yet — an admin needs to set it up in /admin.");
        } else {
          setLastError(err?.message ?? 'Something went wrong.');
        }
        throw err;
      }
    },
    onSuccess: () => {
      setRateLimitRetryMs(null);
      setLastError(null);
      void qc.invalidateQueries({ queryKey: ['coach', 'messages'] });
      void qc.invalidateQueries({ queryKey: ['coach', 'meta'] });
      setDraft('');
    },
  });

  // Clear conversation — wipes messages + summary. Personality
  // choice is preserved.
  const clearM = useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => api('/coach/messages', { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coach', 'messages'] });
      void qc.invalidateQueries({ queryKey: ['coach', 'meta'] });
    },
  });

  // Personality PATCH. Updates the server, invalidates the meta
  // query so the picker reflects the change immediately.
  const personalityM = useMutation<
    { coachPersonality: CoachPersonality | null; effective: CoachPersonality },
    Error,
    CoachPersonality | null
  >({
    mutationFn: (personality) =>
      api('/coach/personality', {
        method: 'PATCH',
        body: { personality },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach', 'meta'] }),
  });

  const meta = metaQ.data;
  const activePersonality = meta?.activePersonality;
  const summary = meta?.contextSummary;
  const conversation = meta?.conversation;
  const messages = messagesQ.data?.messages ?? [];
  const isSending = sendM.isPending;

  const onSubmit = () => {
    const text = draft.trim();
    if (!text || isSending || rateLimitRetryMs) return;
    sendM.mutate(text);
  };

  return (
    <>
      <PageHeader
        title="AI Coach"
        subtitle="Personal training & habits advisor — pick a personality, ask anything"
        // Conversation status badges in the header action slot.
        action={
          conversation ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-ink-300">
              <span>
                {conversation.messageCount}{' '}
                {conversation.messageCount === 1 ? 'message' : 'messages'}
              </span>
              {conversation.hasSummary && (
                <span className="px-1.5 py-0.5 rounded border border-neon-violet/40 text-neon-violet">
                  summarized
                </span>
              )}
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Personality picker + context summary — sticky on desktop */}
        <div className="lg:col-span-1 space-y-4">
          <Panel title="Personality" variant="violet">
            {metaQ.isLoading && (
              <div className="text-xs font-mono text-ink-300">Loading…</div>
            )}
            {meta && (
              <div className="space-y-2">
                {meta.available.map((p: CoachPersonalityMeta) => {
                  const active = p.key === activePersonality;
                  const isStored = meta.storedPersonality === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => personalityM.mutate(p.key)}
                      disabled={personalityM.isPending}
                      className={
                        'w-full text-left rounded border p-3 transition-colors disabled:opacity-50 ' +
                        (active
                          ? 'border-neon-violet/60 bg-neon-violet/10'
                          : 'border-ink-700/40 hover:border-neon-violet/30 hover:bg-bg-800/50')
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg text-neon-violet" aria-hidden>{p.icon}</span>
                        <span className="font-display tracking-wide text-xs uppercase text-ink-50">
                          {p.label}
                        </span>
                        {isStored && (
                          <span className="ml-auto text-[9px] font-mono text-neon-cyan/80">
                            saved
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-ink-300 leading-snug">
                        {p.blurb}
                      </div>
                    </button>
                  );
                })}
                {personalityM.error != null && (
                  <div className="text-[10px] font-mono text-neon-magenta mt-2">
                    Couldn't save — try again.
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="What the coach sees" variant="default">
            {summary && (
              <div className="space-y-2 text-xs font-mono">
                <SummaryRow
                  label="Class"
                  value={summary.className ?? '— unclassed —'}
                />
                <SummaryRow label="Level" value={String(summary.level)} />
                <SummaryRow
                  label="Mode"
                  value={summary.mode}
                  tone={summary.mode === 'HARDCORE' ? 'magenta' : 'cyan'}
                />
                <SummaryRow
                  label="Hearts"
                  value={`${summary.hearts} / ${summary.maxHearts}`}
                  tone={summary.hearts <= 2 ? 'magenta' : 'lime'}
                />
                <SummaryRow
                  label="Streak"
                  value={`${summary.currentStreak} day${summary.currentStreak === 1 ? '' : 's'}`}
                />
                <SummaryRow
                  label="This week"
                  value={`${summary.thisWeekCount} / ${summary.weeklyGoal}`}
                />
                <SummaryRow
                  label="Recovery"
                  value={
                    summary.recoveryToday == null
                      ? '—'
                      : `${summary.recoveryToday} / 100`
                  }
                  tone={
                    summary.recoveryToday == null
                      ? 'cyan'
                      : summary.recoveryToday < 50
                        ? 'magenta'
                        : 'lime'
                  }
                />
                <div className="pt-2 mt-2 border-t border-ink-700/30">
                  <div className="text-[10px] font-display tracking-widest uppercase text-ink-300 mb-1">
                    Last 7 days
                  </div>
                  <SummaryRow label="Workouts" value={String(summary.last7Days.workoutCount)} />
                  <SummaryRow
                    label="Avg sleep"
                    value={
                      summary.last7Days.avgSleepHours == null
                        ? '—'
                        : `${summary.last7Days.avgSleepHours} h`
                    }
                  />
                  <SummaryRow label="PRs" value={String(summary.last7Days.prCount)} />
                </div>
                <div className="pt-2 mt-2 border-t border-ink-700/30">
                  <div className="text-[10px] font-display tracking-widest uppercase text-ink-300 mb-1">
                    Coach also sees
                  </div>
                  <SummaryRow
                    label="Recent workouts"
                    value={`${summary.recentWorkoutCount}`}
                  />
                  <SummaryRow
                    label="Pending skills"
                    value={String(summary.pendingSkillsCount)}
                    tone={summary.pendingSkillsCount > 0 ? 'cyan' : undefined}
                  />
                  <SummaryRow
                    label="Caffeine today"
                    value={String(summary.caffeineToday)}
                    tone={
                      summary.caffeineToday >= 3
                        ? 'magenta'
                        : summary.caffeineToday === 0
                          ? 'lime'
                          : undefined
                    }
                  />
                  <SummaryRow
                    label="Yesterday's kcal"
                    value={
                      summary.yesterdayMealCalories == null
                        ? '—'
                        : `${summary.yesterdayMealCalories}`
                    }
                  />
                  <SummaryRow
                    label="Latest weight"
                    value={
                      summary.latestWeightKg == null
                        ? '—'
                        : `${summary.latestWeightKg} kg`
                    }
                  />
                  <SummaryRow
                    label="Body fat"
                    value={
                      summary.latestBodyFatPct == null
                        ? '—'
                        : `${summary.latestBodyFatPct}%`
                    }
                  />
                </div>
              </div>
            )}
          </Panel>

          {meta && (
            <div className="text-[10px] font-mono text-ink-300 text-center">
              model: {meta.modelLabel}
            </div>
          )}
        </div>

        {/* Conversation */}
        <div className="lg:col-span-2">
          <Panel
            title="Conversation"
            variant="violet"
            action={
              // Clear button — only show when there's something
              // to clear, and confirm before wiping (it's not
              // destructive per se, but loses context the coach
              // has accumulated).
              <button
                type="button"
                onClick={() => {
                  if (confirm('Clear this conversation? Your personality choice is kept.')) {
                    clearM.mutate();
                  }
                }}
                disabled={clearM.isPending || messages.length === 0}
                className="text-[10px] font-mono text-ink-300 hover:text-neon-magenta disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {clearM.isPending ? 'clearing…' : 'clear conversation'}
              </button>
            }
          >
            <div
              ref={messagesContainerRef}
              className="flex flex-col gap-3 min-h-[400px] max-h-[60vh] overflow-y-auto pr-1"
            >
              {messagesQ.isLoading && (
                <div className="flex-1 flex items-center justify-center text-xs font-mono text-ink-300">
                  Loading conversation…
                </div>
              )}
              {!messagesQ.isLoading && messages.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center max-w-md space-y-2">
                    <div className="text-3xl text-neon-violet/50 mb-2">✦</div>
                    <div className="text-sm text-ink-300">
                      Ask the coach anything about your training, recovery, habits, or what
                      to do next.
                    </div>
                    {activePersonality && (
                      <div className="text-[10px] font-mono text-ink-300 mt-3">
                        You'll be talking to{' '}
                        <span className="text-neon-violet">
                          {meta!.available.find((p) => p.key === activePersonality)?.label}
                        </span>
                        .
                      </div>
                    )}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <ChatBubble key={m.id} role={m.role} text={m.content} />
              ))}
              {isSending && (
                <div className="flex justify-start">
                  <div className="bg-bg-800/60 border border-ink-700/40 rounded-lg px-3 py-2 text-xs font-mono text-ink-300 animate-pulse-slow">
                    thinking…
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              className="mt-4 flex gap-2 border-t border-ink-700/30 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder={
                  metaQ.error
                    ? 'Coach unavailable — admin must configure LLM first.'
                    : isSending
                      ? 'Coach is thinking…'
                      : 'Ask anything…  (Enter to send · Shift+Enter for newline)'
                }
                disabled={!!metaQ.error || isSending || !!rateLimitRetryMs}
                rows={2}
                className="flex-1 bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm font-mono text-ink-50 placeholder:text-ink-300/60 focus:outline-none focus:border-neon-violet/60 disabled:opacity-50 resize-none"
              />
              <NeonButton
                type="submit"
                variant="violet"
                disabled={!draft.trim() || isSending || !!rateLimitRetryMs}
                loading={isSending}
                loadingText="Asking…"
              >
                Send
              </NeonButton>
            </form>

            {rateLimitRetryMs != null && (
              <div className="mt-2 text-[10px] font-mono text-neon-magenta">
                Slow down a bit — try again in{' '}
                {Math.ceil(rateLimitRetryMs / 1000)}s.
              </div>
            )}
            {lastError && rateLimitRetryMs == null && (
              <div className="mt-2 text-[10px] font-mono text-neon-magenta">
                {lastError}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// Small subcomponents — kept inline so the page is one file the user
// can scroll through end-to-end without flipping between tabs.
// =============================================================================

function ChatBubble({ role, text }: { role: 'user' | 'assistant' | 'system'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={'flex ' + (isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={
          'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ' +
          (isUser
            ? 'bg-neon-violet/10 border border-neon-violet/40 text-ink-50'
            : 'bg-bg-800/60 border border-ink-700/40 text-ink-50')
        }
      >
        {text}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'lime' | 'magenta' | 'cyan';
}) {
  const colorClass =
    tone === 'lime'
      ? 'text-neon-lime'
      : tone === 'magenta'
        ? 'text-neon-magenta'
        : tone === 'cyan'
          ? 'text-neon-cyan'
          : 'text-ink-50';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-300">{label}</span>
      <span className={'text-right ' + colorClass}>{value}</span>
    </div>
  );
}

// Default export — wrapped in Layout so the page fits the standard
// shell (sidebar + top bar). The App.tsx route also passes
// RequireAuth, but Layout doesn't itself auth-guard.
export default function CoachPage() {
  return (
    <Layout>
      <CoachInner />
    </Layout>
  );
}