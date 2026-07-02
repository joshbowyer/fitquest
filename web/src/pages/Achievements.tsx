import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import type { Achievement } from '@/lib/types';
import { classNames } from '@/lib/format';
import { playSound } from '@/lib/soundBus';

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  CONSISTENCY:   { label: 'Consistency', color: '#ffc34d' },
  STRENGTH:      { label: 'Strength',    color: '#f55cc4' },
  HYPERTROPHY:   { label: 'Hypertrophy', color: '#9bff5c' },
  BODY_COMP:     { label: 'Body Comp',   color: '#14d6e8' },
  ENDURANCE:     { label: 'Endurance',   color: '#56e88e' },
  CALISTHENICS:  { label: 'Calisthenics', color: '#cba6ff' },
  SOCIAL:        { label: 'Social',      color: '#f55cc4' },
};

export function AchievementsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'ALL' | 'UNLOCKED' | 'LOCKED'>('ALL');
  const [category, setCategory] = useState<string>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['achievements'],
    queryFn: () => api<{ items: Achievement[] }>('/achievements'),
  });

  const items = data?.items ?? [];

  const stats = useMemo(() => {
    const total = items.length;
    const unlocked = items.filter((a) => a.unlocked).length;
    const points = items.filter((a) => a.unlocked).reduce((s, a) => s + a.points, 0);
    const totalPoints = items.reduce((s, a) => a.s.points, 0);
    return { total, unlocked, points, totalPoints, pct: total ? Math.round((unlocked / total) * 100) : 0 };
  }, [items]);

  // Achievement-unlock chime. We diff the current unlocked-id
  // set against the one we saw on the previous render and fire
  // the sound for any newly-unlocked IDs. Same React pattern as
  // tracking the "previous" state for animation transitions —
  // standard "fire on diff" idiom.
  //
  // Skips the sound on the very first render (no transition yet)
  // and on the same-IDs case (nothing changed). Capped at 5
  // sounds per diff so a bulk-unlock batch doesn't spam the
  // user's ears.
  const prevUnlockedIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (items.length === 0) return;
    const currentIds = new Set(items.filter((a) => a.unlocked).map((a) => a.id));
    const prev = prevUnlockedIds.current;
    if (prev) {
      const newly = items.filter((a) => a.unlocked && !prev.has(a.id));
      for (const a of newly.slice(0, 5)) {
        playSound('achievement');
      }
    }
    prevUnlockedIds.current = currentIds;
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((a) => {
      if (filter === 'UNLOCKED' && !a.unlocked) return false;
      if (filter === 'LOCKED' && a.unlocked) return false;
      if (category !== 'ALL' && a.category !== category) return false;
      return true;
    });
  }, [items, filter, category]);

  const grouped = useMemo(() => {
    const m = new Map<string, Achievement[]>();
    for (const a of filtered) {
      const arr = m.get(a.category) ?? [];
      arr.push(a);
      m.set(a.category, arr);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const ma = CATEGORY_META[a[0]]?.label ?? a[0];
      const mb = CATEGORY_META[b[0]]?.label ?? b[0];
      return ma.localeCompare(mb);
    });
  }, [filtered]);

  const presentCategories = useMemo(() => {
    const s = new Set(items.map((a) => a.category));
    return Array.from(s).sort();
  }, [items]);

  return (
    <Layout>
      <PageHeader
        title="// Achievements"
        subtitle="Witty callouts for showing up, doing the work, and being a person."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Unlocked" value={`${stats.unlocked} / ${stats.total}`} accent={CATEGORY_META.CONSISTENCY.color} />
        <Stat label="Progress" value={`${stats.pct}%`} accent="#14d6e8" />
        <Stat label="Points" value={`${stats.points}`} accent="#ffc34d" />
        <Stat label="Possible" value={`${stats.totalPoints}`} accent="#cba6ff" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['ALL', 'UNLOCKED', 'LOCKED'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={classNames(
              'px-3 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all',
              filter === f
                ? 'border-neon-cyan/80 text-neon-cyan bg-neon-cyan/10'
                : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
            )}
          >
            {f === 'ALL' ? `All (${stats.total})` : f === 'UNLOCKED' ? `Unlocked (${stats.unlocked})` : `Locked (${stats.total - stats.unlocked})`}
          </button>
        ))}
        <div className="mx-2 h-5 border-l border-ink-500/30" />
        {['ALL', ...presentCategories].map((c) => {
          const meta = c === 'ALL' ? null : CATEGORY_META[c];
          const label = meta?.label ?? 'All cats';
          const color = meta?.color ?? '#cbd5e1';
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={classNames(
                'px-2 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all',
                category === c
                  ? 'border-current'
                  : 'border-ink-500/30 text-ink-300 hover:border-ink-300',
              )}
              style={category === c ? { color, background: `${color}1a` } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      ) : grouped.length === 0 ? (
        <Panel><div className="text-xs text-ink-300 font-mono text-center py-6">No achievements match this filter.</div></Panel>
      ) : (
        <div className="space-y-4">
          {grouped.map(([cat, list]) => {
            const meta = CATEGORY_META[cat] ?? { label: cat, color: '#cbd5e1' };
            const catUnlocked = list.filter((a) => a.unlocked).length;
            return (
              <Panel
                key={cat}
                title={meta.label}
                variant={cat === 'STRENGTH' ? 'magenta' : cat === 'CONSISTENCY' ? 'amber' : cat === 'HYPERTROPHY' ? 'lime' : cat === 'ENDURANCE' ? 'cyan' : cat === 'SOCIAL' ? 'violet' : 'cyan'}
                action={
                  <span className="text-[10px] font-mono text-ink-300">
                    {catUnlocked} / {list.length}
                  </span>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {list.map((a) => (
                    <AchievementCard key={a.id} a={a} accent={meta.color} />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {!user && (
        <div className="mt-4 text-xs text-ink-300 font-mono">Sign in to track achievements.</div>
      )}
    </Layout>
  );
}

function AchievementCard({ a, accent }: { a: Achievement; accent: string }) {
  const isUnlocked = a.unlocked;
  return (
    <div
      className={classNames(
        'border p-2.5 transition-all',
        isUnlocked
          ? 'bg-bg-700/60 hover:border-current'
          : 'bg-bg-800/40 opacity-60 border-ink-700/40',
      )}
      style={isUnlocked ? { borderColor: `${accent}66` } : undefined}
      title={a.description}
    >
      <div className="flex items-start gap-2">
        <div
          className="shrink-0 w-9 h-9 grid place-items-center font-display text-lg border"
          style={
            isUnlocked
              ? { color: accent, borderColor: `${accent}66`, textShadow: `0 0 6px ${accent}`, background: `${accent}10` }
              : { color: '#3f3f46', borderColor: '#27272a', background: '#18181b' }
          }
        >
          {isUnlocked ? glyphFor(a.icon) : '✕'}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={classNames(
              'font-display tracking-wider text-xs truncate',
              isUnlocked ? '' : 'text-ink-500',
            )}
            style={isUnlocked ? { color: accent, textShadow: `0 0 4px ${accent}` } : undefined}
          >
            {a.name}
          </div>
          <div className={classNames('text-[10px] font-mono mt-0.5 leading-tight', isUnlocked ? 'text-ink-300' : 'text-ink-500')}>
            {a.description}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={classNames('text-[9px] font-mono uppercase tracking-widest', isUnlocked ? 'text-ink-100' : 'text-ink-500')}>
              +{a.points} pts
            </span>
            {isUnlocked && a.unlockedAt && (
              <span className="text-[9px] font-mono text-ink-400">
                · {new Date(a.unlockedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border border-ink-500/30 p-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">{label}</div>
      <div className="font-display text-xl" style={{ color: accent, textShadow: `0 0 6px ${accent}` }}>{value}</div>
    </div>
  );
}

// Map icon strings to actual glyphs for the card.
function glyphFor(icon: string): string {
  switch (icon) {
    case 'medal':    return '◆';
    case 'flame':    return '▲';
    case 'crown':    return '♛';
    case 'dumbbell': return '⊞';
    case 'arm':      return '◭';
    case 'body':     return '◇';
    case 'lung':     return '◐';
    case 'shoe':     return '➤';
    case 'core':     return '✦';
    case 'shield':   return '⛨';
    case 'sword':    return '⚔';
    case 'scale':    return '⌖';
    case 'moon':     return '☾';
    case 'apple':    return '◍';
    case 'heart':    return '♡';
    default:         return '✦';
  }
}