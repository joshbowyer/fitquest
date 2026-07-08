/**
 * Notification inbox. Aggregates the persistent Notification rows the
 * server writes for skill unlocks, level-ups, penance events, shop
 * purchases, etc. — events that previously only fired as ephemeral
 * modals and could be missed.
 *
 * Supports: category filter tabs, per-row mark-read + dismiss,
 * mark-all-read, and clear-all. Clicking a row marks it read and
 * (if it has a link) navigates there. The unread-count badge in the
 * top bar reads the same /notifications/unread-count endpoint.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';

type NotificationCategory =
  | 'SKILL' | 'PENANCE' | 'SHOP' | 'SYSTEM' | 'ACHIEVEMENT' | 'LEVEL';

type Notification = {
  id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; icon: string; color: string }
> = {
  SKILL: { label: 'Skills', icon: '✦', color: 'text-neon-cyan' },
  LEVEL: { label: 'Level', icon: '▲', color: 'text-neon-amber' },
  PENANCE: { label: 'Penance', icon: '◉', color: 'text-neon-magenta' },
  SHOP: { label: 'Shop', icon: '⚞', color: 'text-neon-lime' },
  ACHIEVEMENT: { label: 'Achieve', icon: '◆', color: 'text-neon-amber' },
  SYSTEM: { label: 'System', icon: '☰', color: 'text-ink-200' },
};

const FILTERS: { key: NotificationCategory | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'SKILL', label: 'Skills' },
  { key: 'LEVEL', label: 'Level' },
  { key: 'PENANCE', label: 'Penance' },
  { key: 'SHOP', label: 'Shop' },
  { key: 'ACHIEVEMENT', label: 'Achieve' },
  { key: 'SYSTEM', label: 'System' },
];

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationCategory | 'ALL'>('ALL');

  const listQ = useQuery({
    queryKey: ['notifications', 'list', filter],
    queryFn: () =>
      api<{ items: Notification[] }>('/notifications', {
        query: filter === 'ALL' ? { limit: 100 } : { category: filter, limit: 100 },
      }),
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markReadM = useDelayedMutation<unknown, { id: string }>({
    mutationFn: ({ id }) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const dismissM = useDelayedMutation<unknown, { id: string }>({
    mutationFn: ({ id }) => api(`/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const readAllM = useDelayedMutation<unknown, void>({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: invalidate,
  });
  const clearAllM = useDelayedMutation<unknown, void>({
    mutationFn: () => api('/notifications', { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const items = listQ.data?.items ?? [];
  const unreadCount = items.filter((n) => n.readAt == null).length;

  const onRowClick = (n: Notification) => {
    if (n.readAt == null) markReadM.run({ id: n.id });
    if (n.link) navigate(n.link);
  };

  return (
    <Layout>
      <PageHeader
        title="// Notifications"
        subtitle="Skill unlocks, level-ups, penance events, and shop purchases — all in one place."
      />

      <Panel
        title="Inbox"
        action={
          <div className="flex gap-2">
            <NeonButton
              variant="cyan"
              onClick={() => readAllM.run()}
              disabled={readAllM.isPending || items.every((n) => n.readAt != null)}
              className="text-[10px]"
            >
              Mark all read
            </NeonButton>
            <NeonButton
              variant="magenta"
              onClick={() => clearAllM.run()}
              disabled={clearAllM.isPending || items.length === 0}
              className="text-[10px]"
            >
              Clear all
            </NeonButton>
          </div>
        }
      >
        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-1 mb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={classNames(
                'px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest border transition-colors',
                filter === f.key
                  ? 'text-neon-cyan border-neon-cyan/60'
                  : 'text-ink-400 border-ink-500/30 hover:text-ink-200',
              )}
            >
              {f.label}
            </button>
          ))}
          {unreadCount > 0 && (
            <span className="ml-auto text-[10px] font-mono text-neon-amber self-center">
              {unreadCount} unread
            </span>
          )}
        </div>

        {listQ.isLoading ? (
          <div className="text-[11px] font-mono text-ink-400 py-6 text-center">loading…</div>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-ink-700/40 text-center text-[11px] font-mono text-ink-400 py-8">
            No notifications{filter !== 'ALL' ? ` in ${filter.toLowerCase()}` : ''} yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((n) => {
              const meta = CATEGORY_META[n.category];
              const unread = n.readAt == null;
              return (
                <li
                  key={n.id}
                  className={classNames(
                    'group flex items-start gap-2 px-2 py-2 border transition-colors cursor-pointer',
                    unread
                      ? 'border-neon-cyan/30 bg-bg-800/60'
                      : 'border-ink-700/30 bg-transparent hover:border-ink-500/40',
                  )}
                  onClick={() => onRowClick(n)}
                >
                  <span className={classNames('text-sm leading-5 shrink-0', meta.color)} title={meta.label}>
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {unread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan shrink-0" aria-label="unread" />
                      )}
                      <span
                        className={classNames(
                          'text-[12px] font-mono truncate',
                          unread ? 'text-ink-50' : 'text-ink-300',
                        )}
                      >
                        {n.title}
                      </span>
                    </div>
                    {n.body && (
                      <p className="text-[10px] font-mono text-ink-400 mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <span className="text-[9px] font-mono text-ink-500">{relTime(n.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissM.run({ id: n.id });
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-500 hover:text-neon-magenta text-xs px-1 shrink-0"
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Layout>
  );
}
