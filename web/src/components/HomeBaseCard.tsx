import { useQuery } from '@tanstack/react-query';
import { useValueChange, emitNotification } from '@/lib/notifyBus';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Layout, PageHeader } from './Layout';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { PortalLeakCard } from './PortalLeakCard';
import { classNames } from '@/lib/format';
import type { HomeBase as HomeBaseData, PenanceEvent, ShieldTier } from '@/lib/types';

/**
 * Home-base shield widget for the dashboard. Shows:
 *  - Tier name + color (FORTIFIED / STABLE / COMPROMISED / BREACHED)
 *  - Shield value (0-100) as a horizontal bar
 *  - Last 5 penance events (newest first)
 *  - Link to /home-base for full history + penance management
 *
 * The shield is the engagement foundation that Breach builds on:
 * a Breached shield (≤29) doubles incoming boss damage; FORTIFIED
 * (≥90) halves it. For now, the widget is purely informational —
 * no Breach bosses exist yet, but the user can already see their
 * tier and what moved it.
 */
export function HomeBaseCard() {
  const q = useQuery({
    queryKey: ['home-base'],
    queryFn: () => api<HomeBaseData>('/home-base'),
    staleTime: 60_000,
  });

  // Shield-drop notification. Polled every staleTime (60s) +
  // whenever the component re-mounts. Fires a system notification
  // when the shield value DECREASES (anything that damages the
  // home base — penance, breach escape, etc.). Skipped when the
  // user hasn't opted in (emitNotification no-ops).
  useValueChange(q.data?.shield, (newShield, oldShield) => {
    if (newShield != null && oldShield != null && newShield < oldShield) {
      emitNotification('shieldDrop');
    }
  });

  const data = q.data;
  if (!data) {
    return (
      <Panel title="Home base" variant="cyan" className="border-neon-cyan/20">
        <div className="text-[10px] font-mono text-ink-400">loading shield…</div>
      </Panel>
    );
  }

  const pct = Math.max(0, Math.min(100, data.shield));
  const ringColor = data.tierColor;

  return (
    <Panel
      title="Home base"
      variant="cyan"
      action={
        <a
          href="/home-base"
          className="text-[10px] font-mono uppercase tracking-widest text-ink-300 hover:text-neon-cyan hover:underline"
        >
          Details →
        </a>
      }
    >
      <div className="space-y-3">
        {/* Tier badge + shield number */}
        <div className="flex items-baseline justify-between">
          <span
            className="text-xs font-display tracking-widest uppercase"
            style={{ color: ringColor }}
          >
            {data.tierLabel}
          </span>
          <span className="text-2xl font-display tabular-nums text-slate-100">
            {data.shield}
            <span className="text-[10px] text-ink-500 ml-1">/ 100</span>
          </span>
        </div>

        {/* Shield bar */}
        <div className="relative h-2 rounded bg-bg-900 border border-ink-700/40 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: ringColor,
              boxShadow: pct > 50 ? `0 0 8px ${ringColor}88` : 'none',
            }}
          />
          {/* Tier markers along the bar */}
          <div className="absolute inset-y-0 left-[30%] w-px bg-ink-700/60" />
          <div className="absolute inset-y-0 left-[60%] w-px bg-ink-700/60" />
          <div className="absolute inset-y-0 left-[90%] w-px bg-ink-700/60" />
        </div>

        {/* Recent events */}
        {data.recentEvents.length > 0 ? (
          <div className="space-y-1 pt-1">
            {data.recentEvents.slice(0, 4).map((e) => (
              <PenanceRow key={e.id} e={e} />
            ))}
          </div>
        ) : (
          <div className="text-[10px] font-mono text-ink-400 italic pt-1">
            No penance events yet. Start by logging a workout — a
            MOBILITY session repairs the shield by +8.
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * One row in the home-base feed. Color-codes the shield delta
 * (red for damage, lime for repair) and shows the shield value
 * after the event fired.
 */
function PenanceRow({ e }: { e: PenanceEvent }) {
  const isDamage = e.shieldDelta < 0;
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono leading-tight">
      <span
        className={classNames(
          'inline-block w-2 h-2 rounded-full shrink-0',
          isDamage ? 'bg-rose-400' : 'bg-emerald-400',
        )}
      />
      <span className="text-slate-200 truncate flex-1">{e.label}</span>
      <span className={classNames(
        'tabular-nums shrink-0',
        isDamage ? 'text-rose-300' : 'text-emerald-300',
      )}>
        {e.shieldDelta > 0 ? '+' : ''}{e.shieldDelta}
      </span>
      <span className="text-ink-500 tabular-nums shrink-0">
        → {e.shieldAfter}
      </span>
    </div>
  );
}

/**
 * Full /home-base page. Shows the shield state + all recent
 * events + the penance template list with toggle controls.
 */
export function HomeBasePage() {
  const q = useQuery({
    queryKey: ['home-base'],
    queryFn: () => api<HomeBaseData>('/home-base'),
  });

  // The page renders inside the full Layout (top bar + sidebar) when
  // navigated to directly, and inside a Modal on the Quest page. The
  // caller decides which — we just render the content. The Quest
  // modal passes a width="max-w-3xl" prop, and our content scales
  // gracefully to either container.
  //
  // We embed <PortalLeakCard /> inline so the active leak is
  // visible right under the shield tier — a leak is "something is
  // happening in your home base", so it belongs on this page, not
  // buried in a separate /portal-leak route.
  return (
    <div className="space-y-4">
      <Panel title="Home base" variant="cyan">
        {q.data ? (
          <HomeBaseDetail data={q.data} />
        ) : (
          <div className="text-[10px] font-mono text-ink-400">loading…</div>
        )}
      </Panel>
      {/* Leak sits above the penance templates list. The penance list
          is the longest section on this page; without the leak above
          it, users who finish editing the shield tier can scroll past
          the list and miss an active encounter entirely. */}
      <PortalLeakCard />
      <PenanceTemplatesPanel />
    </div>
  );
}

/**
 * /home-base as a full page (used when navigated to directly via the
 * sidebar nav). Wraps HomeBasePage in <Layout> so the top bar +
 * sidebar are visible — without this the page renders bare and
 * there's no way to navigate away except browser-back.
 */
export function HomeBaseFullPage() {
  return (
    <Layout>
      <PageHeader
        title="// Home base"
        subtitle="The shield that protects your engagement. Compromise it and the breach escalates."
      />
      <HomeBasePage />
    </Layout>
  );
}

function HomeBaseDetail({ data }: { data: HomeBaseData }) {
  const pct = Math.max(0, Math.min(100, data.shield));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
            Tier
          </div>
          <div
            className="text-2xl font-display tracking-widest"
            style={{ color: data.tierColor }}
          >
            {data.tierLabel}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
            Shield
          </div>
          <div className="text-2xl font-display tabular-nums text-slate-100">
            {data.shield}<span className="text-[10px] text-ink-500 ml-1">/ 100</span>
          </div>
        </div>
      </div>

      <div className="relative h-3 rounded bg-bg-900 border border-ink-700/40 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 transition-all"
          style={{ width: `${pct}%`, backgroundColor: data.tierColor }}
        />
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-2">
          Recent events
        </div>
        {data.recentEvents.length === 0 ? (
          <div className="text-[11px] font-mono text-ink-400 italic">
            No penance events yet.
          </div>
        ) : (
          <div className="space-y-1">
            {data.recentEvents.map((e) => (
              <PenanceRow key={e.id} e={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PenanceTemplatesPanel() {
  const q = useQuery({
    queryKey: ['home-base', 'penances'],
    queryFn: () => api<{
      items: Array<{
        id: string;
        key: string;
        label: string;
        flavor: string | null;
        shieldDelta: number;
        enabled: boolean;
        isUserOverride: boolean;
      }>;
    }>('/home-base/penances'),
  });

  const toggleM = useDelayedMutation<{ id: string; enabled: boolean }, {
    key: string;
    enabled: boolean;
  }>({
    mutationFn: (body) =>
      api(`/home-base/penances/${body.key}/toggle`, {
        method: 'PATCH',
        body: { enabled: body.enabled },
      }),
  }, 400);

  // Split into the two semantic buckets the user cares about
  // ("what hurts me" vs "what heals me"). The raw `items` may
  // be in any order; we sort by shieldDelta so the most-impactful
  // entry in each bucket sits at the top of the expanded list.
  const items = q.data?.items ?? [];
  const damage = items
    .filter((t) => t.shieldDelta < 0)
    .sort((a, b) => a.shieldDelta - b.shieldDelta);
  const repair = items
    .filter((t) => t.shieldDelta > 0)
    .sort((a, b) => b.shieldDelta - a.shieldDelta);

  return (
    <Panel title="Penance templates" variant="violet">
      <PenanceSubBlock
        label="Shield damage"
        accent="rose"
        items={damage}
        onToggle={(key, enabled) => toggleM.run({ key, enabled })}
        pending={toggleM.isPending}
        startOpen={false}
      />
      <div className="h-3" />
      <PenanceSubBlock
        label="Shield repair"
        accent="emerald"
        items={repair}
        onToggle={(key, enabled) => toggleM.run({ key, enabled })}
        pending={toggleM.isPending}
        startOpen={false}
      />
    </Panel>
  );
}

/**
 * One collapsed-by-default sub-block. Shows a compact header
 * (label + count of currently-active items) when closed; the
 * full list when open. The per-row "active now" badge is the
 * primary signal of state — the original checkbox-toggle read
 * as a "click to enable" affordance, which it isn't (these are
 * server-tracked flags, not just local preferences).
 */
function PenanceSubBlock({
  label,
  accent,
  items,
  onToggle,
  pending,
  startOpen,
}: {
  label: string;
  accent: 'rose' | 'emerald';
  items: Array<{
    key: string;
    label: string;
    flavor: string | null;
    shieldDelta: number;
    enabled: boolean;
    isUserOverride: boolean;
  }>;
  onToggle: (key: string, enabled: boolean) => void;
  pending: boolean;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const activeCount = items.filter((t) => t.enabled).length;
  const totalDelta = items.reduce((sum, t) => sum + (t.enabled ? t.shieldDelta : 0), 0);
  return (
    <div className="border border-ink-700/30 rounded">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-bg-800/40"
      >
        <span
          className={classNames(
            'text-[9px] font-mono inline-block w-3 transition-transform',
            open ? 'rotate-90' : '',
            'text-ink-400',
          )}
          aria-hidden
        >
          ▶
        </span>
        <span className="text-[10px] font-display tracking-widest uppercase text-ink-50">
          {label}
        </span>
        <span className="text-[9px] font-mono text-ink-400">
          {items.length} total · {activeCount} active
        </span>
        {totalDelta !== 0 && (
          <span
            className={classNames(
              'ml-auto tabular-nums text-[10px]',
              accent === 'rose' ? 'text-rose-300' : 'text-emerald-300',
            )}
          >
            active net {totalDelta > 0 ? '+' : ''}{totalDelta}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-ink-700/30 p-2 space-y-1">
          {items.length === 0 && (
            <div className="text-[10px] font-mono text-ink-500 italic">
              No penances in this bucket.
            </div>
          )}
          {items.map((t) => (
            <PenanceRow
              key={t.key}
              row={t}
              accent={accent}
              onToggle={(enabled) => onToggle(t.key, enabled)}
              pending={pending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PenanceRow({
  row,
  accent,
  onToggle,
  pending,
}: {
  row: {
    key: string;
    label: string;
    flavor: string | null;
    shieldDelta: number;
    enabled: boolean;
    isUserOverride: boolean;
  };
  accent: 'rose' | 'emerald';
  onToggle: (enabled: boolean) => void;
  pending: boolean;
}) {
  // Each row is a clickable button. The whole row toggles when
  // clicked. The "active now" pill on the right is the
  // primary state signal — the original checkbox read as a
  // "click here to enable" affordance and was confusing; this
  // is clearer: enabled items are visibly highlighted.
  return (
    <button
      type="button"
      onClick={() => onToggle(!row.enabled)}
      disabled={pending}
      className={classNames(
        'w-full text-left flex items-start gap-2 py-1.5 px-2 text-[11px] font-mono rounded border transition-colors',
        row.enabled
          ? accent === 'rose'
            ? 'border-rose-500/40 bg-rose-500/5 text-slate-100'
            : 'border-emerald-500/40 bg-emerald-500/5 text-slate-100'
          : 'border-ink-700/30 text-ink-300 hover:border-ink-500/50',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span>{row.label}</span>
          {row.enabled && (
            <span
              className={classNames(
                'text-[9px] font-mono uppercase tracking-widest px-1 rounded border',
                accent === 'rose'
                  ? 'text-rose-200 border-rose-500/40'
                  : 'text-emerald-200 border-emerald-500/40',
              )}
            >
              active now
            </span>
          )}
          {row.isUserOverride && (
            <span className="text-[9px] font-mono uppercase tracking-widest text-violet-300 border border-violet-500/30 px-1 rounded">
              custom
            </span>
          )}
          <span
            className={classNames(
              'ml-auto tabular-nums text-[10px] shrink-0',
              row.shieldDelta < 0 ? 'text-rose-300' : 'text-emerald-300',
            )}
          >
            {row.shieldDelta > 0 ? '+' : ''}{row.shieldDelta}
          </span>
        </div>
        {row.flavor && (
          <div className="text-[10px] text-ink-400 italic mt-0.5 leading-snug">
            {row.flavor}
          </div>
        )}
      </div>
    </button>
  );
}
