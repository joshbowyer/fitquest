import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';
import type { HomeBase as HomeBaseData, PenanceEvent, ShieldTier } from '@/lib/types';

/**
 * Home-base shield widget for the dashboard. Shows:
 *  - Tier name + color (FORTIFIED / STABLE / COMPROMISED / BREECHED)
 *  - Shield value (0-100) as a horizontal bar
 *  - Last 5 penance events (newest first)
 *  - Link to /home-base for full history + penance management
 *
 * The shield is the engagement foundation that Breach builds on:
 * a Breeched shield (≤29) doubles incoming boss damage; FORTIFIED
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

  return (
    <div className="space-y-4">
      <Panel title="Home base" variant="cyan">
        {q.data ? (
          <HomeBaseDetail data={q.data} />
        ) : (
          <div className="text-[10px] font-mono text-ink-400">loading…</div>
        )}
      </Panel>
      <PenanceTemplatesPanel />
    </div>
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

function PenanceTemplatesPanel() {
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
    onSuccess: () => {
      // Trigger a refetch on the parent query so the home-base
      // detail re-renders with fresh defaults.
    },
  }, 400);

  const items = q.data?.items ?? [];
  return (
    <Panel title="Penance templates" variant="violet">
      <div className="space-y-1">
        {items.map((t) => (
          <PenanceToggleRow
            key={t.key}
            row={t}
            onToggle={(enabled) => toggleM.run({ key: t.key, enabled })}
            pending={toggleM.isPending}
          />
        ))}
      </div>
    </Panel>
  );
}

function PenanceToggleRow({
  row,
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
  onToggle: (enabled: boolean) => void;
  pending: boolean;
}) {
  const isDamage = row.shieldDelta < 0;
  return (
    <label className="flex items-start gap-2 py-1.5 px-1 text-[11px] font-mono border border-ink-700/20 hover:border-ink-500/40 rounded cursor-pointer">
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={pending}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-200">{row.label}</span>
          {row.isUserOverride && (
            <span className="text-[9px] font-mono uppercase tracking-widest text-violet-300 border border-violet-500/30 px-1 rounded">
              custom
            </span>
          )}
          <span
            className={classNames(
              'ml-auto tabular-nums text-[10px] shrink-0',
              isDamage ? 'text-rose-300' : 'text-emerald-300',
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
    </label>
  );
}
