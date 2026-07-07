/**
 * AI Coach page — chat-style interface for talking to the configured
 * LLM with a FitQuest-aware personality preset.
 *
 * v1 (scaffold):
 *   - Personality selector (5 presets, server-driven list)
 *   - Simple conversation: local-state message list, non-streaming
 *     POST /coach per send (matches every other LLM endpoint)
 *   - Context chips: hearts / streak / week / recovery surfaced from
 *     GET /coach so the user knows what the coach is looking at
 *
 * Deliberately NOT in this scaffold:
 *   - Conversation persistence (server doesn't store history yet;
 *     each page load starts fresh — fine for v1, the use case is
 *     "ask one focused question")
 *   - Streaming responses (would need SSE plumbing; out of scope)
 *   - Per-message personality override (use the global picker)
 *
 * Future additions (roadmap items already noted):
 *   - Server-side conversation history (CoachMessage table)
 *   - Admin LlmConfig.coachSystemPromptOverrides per personality
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import type {
  CoachMeta,
  CoachChatRequest,
  CoachChatResponse,
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

  // Meta: current personality + available list + context summary.
  // 5-min stale time so quick tab-switches don't re-fetch; manually
  // invalidated after a successful PATCH /coach/personality.
  const metaQ = useQuery({
    queryKey: ['coach', 'meta'],
    queryFn: () => api<CoachMeta>('/coach'),
    staleTime: 5 * 60 * 1000,
  });

  // Conversation is local-state only in v1. Each entry is one
  // turn; the user's text + the assistant's reply. Server has no
  // history of any of this yet — that's the next milestone.
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; ts: string }>
  >([]);

  // Scroll to bottom on every new message. Smooth-scroll keeps
  // it from feeling jumpy on a long assistant reply.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Send mutation. Wraps the POST + appends both the user message
  // and the assistant reply to the conversation in one place.
  // 1200ms min delay keeps the spinner visible long enough to
  // feel deliberate (matches SpiritualDirectorCard's pattern).
  const sendM = useDelayedMutation<CoachChatResponse, string>({
    mutationFn: (message: string) =>
      api<CoachChatResponse>('/coach', {
        method: 'POST',
        body: { message } satisfies CoachChatRequest,
      }),
    onSuccess: (res, vars) => {
      const now = new Date().toISOString();
      setMessages((m) => [
        ...m,
        { role: 'user', text: vars, ts: now },
        { role: 'assistant', text: res.text, ts: now },
      ]);
      setDraft('');
    },
  }, 1200);

  // Personality PATCH. Updates the server, invalidates the meta
  // query so the picker reflects the change immediately.
  const personalityM = useDelayedMutation<
    { coachPersonality: CoachPersonality | null; effective: CoachPersonality },
    CoachPersonality | null
  >({
    mutationFn: (personality) =>
      api('/coach/personality', {
        method: 'PATCH',
        body: { personality },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach', 'meta'] }),
  }, 600);

  const meta = metaQ.data;
  const activePersonality = meta?.activePersonality;
  const summary = meta?.contextSummary;

  return (
    <>
      <PageHeader
        title="AI Coach"
        subtitle="Personal training & habits advisor — pick a personality, ask anything"
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
                      onClick={() => personalityM.run(p.key)}
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
            title={activePersonality ? 'Conversation' : 'Conversation'}
            variant="violet"
          >
            <div className="flex flex-col gap-3 min-h-[400px] max-h-[60vh] overflow-y-auto pr-1">
              {messages.length === 0 && (
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
              {messages.map((m, i) => (
                <ChatBubble key={i} role={m.role} text={m.text} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            <form
              className="mt-4 flex gap-2 border-t border-ink-700/30 pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                if (!text || sendM.isPending) return;
                sendM.run(text);
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter adds a newline. Standard
                  // chat pattern; keeps power users from losing their
                  // line breaks on muscle memory.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = draft.trim();
                    if (!text || sendM.isPending) return;
                    sendM.run(text);
                  }
                }}
                placeholder={
                  metaQ.error
                    ? 'Coach unavailable — admin must configure LLM first.'
                    : 'Ask anything…  (Enter to send · Shift+Enter for newline)'
                }
                disabled={!!metaQ.error || sendM.isPending}
                rows={2}
                className="flex-1 bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm font-mono text-ink-50 placeholder:text-ink-300/60 focus:outline-none focus:border-neon-violet/60 disabled:opacity-50 resize-none"
              />
              <NeonButton
                type="submit"
                variant="violet"
                disabled={!draft.trim() || sendM.isPending}
                loading={sendM.isPending}
                loadingText="Asking…"
              >
                Send
              </NeonButton>
            </form>

            {sendM.error != null && (
              <div className="mt-2 text-[10px] font-mono text-neon-magenta">
                The coach didn't answer. Try again — it might be a transient provider hiccup.
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

function ChatBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
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