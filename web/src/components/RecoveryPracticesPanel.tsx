import { useState } from 'react';
import { Panel } from '@/components/Panel';
import { classNames } from '@/lib/format';

/**
 * Recovery practices checklist. Each completed practice grants a small
 * XP bonus (purely local — this is signal, not gamification). State
 * persists in localStorage so it stays in sync across pages (Today,
 * Recovery, etc. — anywhere the panel is rendered).
 *
 * The panel is "today's recovery stack" by design: it's a daily
 * checklist, not a settings page. Lives on Today because that's where
 * the user looks first thing.
 */

const RECOVERY_PRACTICES: Array<{
  id: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
}> = [
  { id: 'stretch',  name: 'Stretch / mobility 10m',  description: 'Ten minutes of stretching, foam rolling, or yoga.', icon: '◇', xp: 5 },
  { id: 'walk',     name: 'Walk (15+ min)',          description: 'Low-intensity movement. Aerobic base without training stress.', icon: '➤', xp: 5 },
  { id: 'hydrate',  name: 'Hydrated (2L+)',          description: 'Hit your daily water target.', icon: '◌', xp: 3 },
  { id: 'cold',     name: 'Cold exposure',           description: 'Cold shower, ice bath, or cold plunge.', icon: '✦', xp: 8 },
  { id: 'breath',   name: 'Box breathing 4-4-4-4',   description: 'One round of box breathing or breathwork.', icon: '◐', xp: 3 },
  { id: 'meditate', name: 'Meditate 10m',            description: 'Ten minutes of seated meditation.', icon: '☾', xp: 5 },
  { id: 'sunlight', name: 'Sunlight (10m)',          description: 'Outdoor sunlight within an hour of waking.', icon: '☀', xp: 3 },
  { id: 'nap',      name: 'Power nap (≤20m)',        description: 'Short restorative nap.', icon: '◍', xp: 3 },
];

const HABIT_LOG_KEY = 'fitquest:recovery:practiceLog';

function loadTodayLog(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HABIT_LOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { date: string; log: Record<string, boolean> };
    if (parsed.date !== new Date().toDateString()) return {};
    return parsed.log ?? {};
  } catch {
    return {};
  }
}

function saveTodayLog(log: Record<string, boolean>) {
  try {
    localStorage.setItem(
      HABIT_LOG_KEY,
      JSON.stringify({ date: new Date().toDateString(), log }),
    );
  } catch {
    /* ignore */
  }
}

export function RecoveryPracticesPanel() {
  const [log, setLog] = useState<Record<string, boolean>>(loadTodayLog);

  function toggle(id: string) {
    const next = { ...log };
    if (next[id]) delete next[id];
    else next[id] = true;
    setLog(next);
    saveTodayLog(next);
  }

  const completed = Object.values(log).filter(Boolean).length;

  return (
    <Panel variant="cyan" title="Today's recovery stack">
      <div className="text-[10px] font-mono text-ink-300 mb-3">
        {completed}/{RECOVERY_PRACTICES.length} practices completed today. Saved locally — pure signal, no penalty.
      </div>
      <div className="space-y-2">
        {RECOVERY_PRACTICES.map((p) => {
          const done = !!log[p.id];
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className={classNames(
                'w-full p-3 border text-left flex items-center gap-3 transition-all',
                done ? 'border-neon-lime/60 bg-neon-lime/10' : 'border-ink-500/30 hover:border-neon-cyan/40',
              )}
            >
              <div className="text-xl w-6 text-center">{done ? '✓' : p.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-ink-100">{p.name}</div>
                <div className="text-[10px] font-mono text-ink-400">{p.description}</div>
              </div>
              <div className="text-[9px] font-mono text-ink-400">+{p.xp} XP</div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}