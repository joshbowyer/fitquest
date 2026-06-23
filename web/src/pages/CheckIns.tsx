import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { CheckInsPanel, QuickLogModal } from '@/components/CheckInsPanel';
import { api } from '@/lib/api';
import { classNames } from '@/lib/format';
import { METRICS } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import {
  CADENCE_LABEL,
  CADENCE_VARIANT,
  CADENCE_GLYPH,
  CADENCES,
  type Cadence,
  type DueMetricDto,
} from '@/lib/checkIns';

type CadenceInfoDto = {
  cadence: Cadence;
  label: string;
  glyph: string;
  dueCount: number;
  totalCount: number;
  metrics: Array<{
    metric: keyof typeof METRICS;
    lastLoggedAt: string | null;
    overdueByDays: number;
    inWindow: boolean;
  }>;
};

type CheckInsAllResponse = { items: CadenceInfoDto[] };

/**
 * Full /check-ins page. Shows every metric in every cadence, sorted
 * with overdue items first. The dashboard panel shows a compact
 * 1-3 card version; this page is where users go when they want to
 * catch up on a backlog or browse what's tracked.
 */
export function CheckInsPage() {
  const { user } = useAuth();
  const timezone = user?.timezone ?? null;
  const qc = useQueryClient();
  const allQ = useQuery({
    queryKey: ['check-ins', 'all'],
    queryFn: () => api<CheckInsAllResponse>('/check-ins/all'),
  });

  const [openMetric, setOpenMetric] = useState<DueMetricDto | null>(null);

  function closeModal() {
    setOpenMetric(null);
    qc.invalidateQueries({ queryKey: ['check-ins'] });
    qc.invalidateQueries({ queryKey: ['measurements'] });
    qc.invalidateQueries({ queryKey: ['measurements', 'latest'] });
  }

  return (
    <Layout>
      <div className="px-4 py-4 md:px-8 md:py-6 max-w-4xl mx-auto pb-24 md:pb-6">
        <PageHeader
          title="Check-ins"
          subtitle="Time-aware prompts for the measurements that change at different rates. AM for post-wakeup signals, PM for end-of-day reflection, WEEKLY for body comp + PRs."
        />

        {/* Quick-prompts at the top mirror the dashboard's
            CheckInsPanel. They fetch the same /check-ins/due endpoint
            so the user has a single source of truth. */}
        <Panel
          variant="cyan"
          title="Due right now"
          className="border-neon-cyan/30 mb-4"
        >
          <CheckInsPanel />
        </Panel>

        {/* Full schedule, grouped by cadence. Each row shows the
            metric, its last-logged timestamp, and a quick-log button. */}
        <div className="space-y-4">
          {allQ.data?.items.map((group) => (
            <CadenceGroup
              key={group.cadence}
              group={group}
              timezone={timezone}
              onQuickLog={(m) =>
                setOpenMetric({
                  metric: m.metric,
                  cadence: group.cadence,
                  lastLoggedAt: m.lastLoggedAt,
                  overdueByDays: m.overdueByDays,
                  inWindow: m.inWindow,
                  isNeverLogged: m.lastLoggedAt === null,
                })
              }
            />
          ))}
          {allQ.isLoading && (
            <div className="text-[10px] font-mono text-ink-400">Loading schedule…</div>
          )}
        </div>

        <QuickLogModal open={openMetric !== null} item={openMetric} onClose={closeModal} />
      </div>
    </Layout>
  );
}

function CadenceGroup({
  group,
  timezone,
  onQuickLog,
}: {
  group: CadenceInfoDto;
  timezone: string | null;
  onQuickLog: (m: CadenceInfoDto['metrics'][number]) => void;
}) {
  const variant = CADENCE_VARIANT[group.cadence];
  const sorted = [...group.metrics].sort((a, b) => {
    // Never-logged first, then most overdue, then alphabetical.
    if (!a.lastLoggedAt && b.lastLoggedAt) return -1;
    if (a.lastLoggedAt && !b.lastLoggedAt) return 1;
    return b.overdueByDays - a.overdueByDays;
  });

  return (
    <section
      className={classNames(
        'panel relative p-4 border',
        `border-neon-${variant}/30`,
      )}
    >
      <header className="flex items-center justify-between mb-3 pb-2 border-b border-current/10">
        <div className="flex items-center gap-2">
          <span className={`text-neon-${variant} text-lg`}>{group.glyph}</span>
          <h2 className={`font-display tracking-widest text-xs uppercase text-neon-${variant}`}>
            {group.label}
          </h2>
        </div>
        <span className="text-[10px] font-mono text-ink-400">
          {group.dueCount} of {group.totalCount} due
        </span>
      </header>

      <ul className="divide-y divide-ink-500/10">
        {sorted.map((m) => {
          const meta = METRICS[m.metric];
          const last = m.lastLoggedAt
            ? new Date(m.lastLoggedAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: timezone ?? undefined,
              })
            : 'never logged';
          const due = m.lastLoggedAt === null || m.overdueByDays >= (group.cadence === 'WEEKLY' ? 7 : 1);
          return (
            <li
              key={m.metric}
              className="py-2 flex items-center gap-3 text-xs font-mono"
            >
              <span className="text-slate-200 truncate flex-1">
                {meta.label}
                <span className="text-ink-400 ml-1">· {meta.unit || '—'}</span>
              </span>
              <span
                className={classNames(
                  'text-[10px] shrink-0',
                  due ? 'text-neon-amber' : 'text-ink-400',
                )}
                title={`Last logged in timezone ${timezone ?? 'UTC'}`}
              >
                {last}
              </span>
              <button
                type="button"
                onClick={() => onQuickLog(m)}
                className={classNames(
                  'px-2 py-0.5 text-[10px] border rounded shrink-0',
                  due
                    ? `border-neon-${variant}/50 text-neon-${variant} hover:bg-neon-${variant}/10`
                    : 'border-ink-500/30 text-ink-400 hover:text-ink-200',
                )}
                title="Quick-log this metric"
              >
                log
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}