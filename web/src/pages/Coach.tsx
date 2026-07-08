/**
 * AI Coach page — chat-style interface for talking to the configured
 * LLM with a FitQuest-aware personality preset.
 *
 * v1.1 (persistence):
 *   - Personality picker (5 presets, server-driven list) — moved
 *     to /settings in v1.0.39. The chat page no longer shows the
 *     picker on every visit (it was constant visual noise after
 *     the first pick). The header now shows a compact "active
 *     coach" badge + a one-click "change →" link to /settings.
 *   - First-time setup: when `storedPersonality === null` the
 *     page renders a one-time "choose your coach" prompt. Click
 *     any of the 5 to save + drop into the chat. Never re-shown.
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
 * Deliberately NOT yet (deferred per v1.0.39 stop-short list):
 *   - Streaming responses (SSE plumbing)
 *   - Edit/branch chat from message X (server plumbing is in
 *     place; UI not built)
 *   - Cost dashboard (chars/4 proxy is "close enough" for now)
 *   - Incremental compaction (replace-oldest-batch is wasteful but
 *     works)
 *   - Per-personality admin prompt overrides
 *     (LlmConfig.coachSystemPromptOverrides) — REMOVED from
 *     roadmap in v1.0.39. There's exactly one canonical voice
 *     per personality, versioned in api/src/lib/coach.ts.
 *
 * Explicitly out of scope (per v1.0.39):
 *   - Multi-conversation / rename / delete — the user wants a
 *     single rolling conversation per user. Not on the roadmap.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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

  const meta = metaQ.data;
  // The active personality is the effective one (user's choice
  // or DEFAULT_COACH_PERSONALITY). storedPersonality is null
  // when the user has never picked — that's the trigger for the
  // first-time setup flow. The picker itself lives on /settings
  // (see "AI Coach" panel); the chat page only shows a compact
  // badge pointing the user there to change it. See commit
  // history for the v1.0.39 refactor that moved the picker out
  // of the chat panel.
  const activePersonality = meta?.activePersonality;
  const storedPersonality = meta?.storedPersonality ?? null;
  const needsFirstTimeSetup = metaQ.isSuccess && storedPersonality === null;
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
        subtitle="Personal training & habits advisor — ask anything about training, recovery, sleep, or habits."
        // Compact "active coach" badge in the header action slot.
        // Replaces the old left-column personality picker: the
        // picker itself moved to /settings (v1.0.39). The chat
        // page only shows "who am I talking to" + a one-click
        // link to change it, so the user isn't constantly looking
        // at options for "which coach" they already picked.
        action={
          activePersonality && meta ? (
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <ActiveCoachBadge
                active={activePersonality}
                available={meta.available}
                conversation={conversation}
              />
              <Link
                to="/settings"
                className="text-neon-cyan hover:underline shrink-0"
              >
                change →
              </Link>
            </div>
          ) : null
        }
      />

      {/* First-time setup: user has never picked a personality.
          Show a full-page prompt with the 5 options. Clicking
          one saves it and the chat page renders normally. After
          this, the picker lives on /settings; the chat page just
          shows the active-coach badge in the header. */}
      {needsFirstTimeSetup && meta ? (
        <FirstTimeCoachSetup
          available={meta.available}
          defaultPersonality={meta.defaultPersonality}
          onPicked={() => qc.invalidateQueries({ queryKey: ['coach', 'meta'] })}
        />
      ) : (
        <div className="max-w-3xl mx-auto">
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
      )}
    </>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

/**
 * ActiveCoachBadge — small header pill showing "who am I talking
 * to" plus the conversation message count. Replaces the verbose
 * left-column personality picker that the v1.0.39 refactor
 * removed. The full picker lives on /settings.
 */
function ActiveCoachBadge({
  active,
  available,
  conversation,
}: {
  active: import('@/lib/types').CoachPersonality;
  available: import('@/lib/types').CoachPersonalityMeta[];
  conversation: import('@/lib/types').CoachConversationMeta | undefined;
}) {
  const meta = available.find((p) => p.key === active);
  return (
    <div className="flex items-center gap-2 text-ink-300">
      {meta && <span className="text-sm text-neon-violet" aria-hidden>{meta.icon}</span>}
      <span className="text-ink-50">
        {meta?.label ?? active}
      </span>
      {conversation && (
        <span className="text-ink-500">
          · {conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'}
        </span>
      )}
    </div>
  );
}

/**
 * FirstTimeCoachSetup — full-page prompt shown on the user's
 * first visit to /coach. The 5 personality cards; click one
 * saves it and the chat page renders normally. The user can
 * change their choice anytime in /settings.
 */
function FirstTimeCoachSetup({
  available,
  defaultPersonality,
  onPicked,
}: {
  available: import('@/lib/types').CoachPersonalityMeta[];
  defaultPersonality: import('@/lib/types').CoachPersonality;
  onPicked: () => void;
}) {
  // PATCH the personality. Disabled while pending.
  const pick = useMutation<
    { coachPersonality: import('@/lib/types').CoachPersonality | null; effective: import('@/lib/types').CoachPersonality },
    Error,
    import('@/lib/types').CoachPersonality
  >({
    mutationFn: (personality) =>
      api('/coach/personality', {
        method: 'PATCH',
        body: { personality },
      }),
    onSuccess: onPicked,
  });
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Panel variant="violet">
        <div className="space-y-2 text-center mb-4">
          <div className="text-3xl text-neon-violet">✦</div>
          <h2 className="font-display tracking-widest text-lg uppercase text-ink-50">
            Choose your coach
          </h2>
          <p className="text-sm text-ink-300 max-w-md mx-auto">
            One-time setup. Pick the voice that fits — you'll be
            talking to this coach across every conversation. You
            can change your pick anytime in <span className="text-neon-cyan">Settings → AI Coach</span>.
          </p>
        </div>
        <div className="space-y-2">
          {available.map((p) => {
            const isDefault = p.key === defaultPersonality;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pick.mutate(p.key)}
                disabled={pick.isPending}
                className="w-full text-left rounded border p-3 transition-colors disabled:opacity-50 border-ink-700/40 hover:border-neon-violet/40 hover:bg-bg-800/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg text-neon-violet" aria-hidden>{p.icon}</span>
                  <span className="font-display tracking-wide text-xs uppercase text-ink-50">
                    {p.label}
                  </span>
                  {isDefault && (
                    <span className="ml-auto text-[9px] font-mono uppercase tracking-widest text-ink-300">
                      default
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-ink-300 leading-snug">
                  {p.blurb}
                </div>
              </button>
            );
          })}
        </div>
        {pick.error != null && (
          <div className="mt-3 text-[10px] font-mono text-neon-magenta text-center">
            Couldn't save — try again.
          </div>
        )}
      </Panel>
    </div>
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