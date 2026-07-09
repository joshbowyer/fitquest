import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';
import { DIFFICULTY_TIERS, tierForRewards, type DifficultyTier } from '@/lib/difficultyTiers';

type Habit = {
  id: string;
  name: string;
  notes: string | null;
  direction: 'POSITIVE' | 'NEGATIVE';
  goldReward: number;
  xpReward: number;
  icon: string | null;
  archived: boolean;
  createdAt: string;
  todayCount: number;
  todayGold: number;
  todayXp: number;
};

type ListResp = { items: Habit[] };

const ICONS_POS = ['✦', '☀', '♥', '◆', '⚡', '☕', '◉', '★', '✓', '☂'];
const ICONS_NEG = ['✕', '☠', '⚠', '✗', '◬', '☢', '✘', '⚞'];

export function HabitsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE'>('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['habits', 'custom'],
    queryFn: () => api<ListResp>('/habits'),
  });

  const list = (data?.items ?? []).filter((h) => {
    if (filter === 'POSITIVE') return h.direction === 'POSITIVE';
    if (filter === 'NEGATIVE') return h.direction === 'NEGATIVE';
    return true;
  });

  const positiveCount = (data?.items ?? []).filter((h) => h.direction === 'POSITIVE').length;
  const negativeCount = (data?.items ?? []).filter((h) => h.direction === 'NEGATIVE').length;
  const todayPositive = (data?.items ?? []).filter((h) => h.direction === 'POSITIVE' && h.todayCount > 0).length;
  const todayNegative = (data?.items ?? []).filter((h) => h.direction === 'NEGATIVE' && h.todayCount > 0).length;

  const logM = useDelayedMutation<
    { goldDelta: number; xpDelta: number; gold: number; xp: number; level: number },
    string
  >({
    mutationFn: (id) => api(`/habits/${id}/log`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['habits', 'custom'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['achievements'] });
    },
  }, 350);

  const archiveM = useDelayedMutation<{ ok: boolean }, string>({
    mutationFn: (id) => api(`/habits/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['habits', 'custom'] }),
  }, 400);

  if (!user) return null;

  const netGoldToday = (data?.items ?? []).reduce((s, h) => s + h.todayGold, 0);

  return (
    <Layout>
      <PageHeader
        title="// Habits"
        subtitle="User-defined behaviors. Positive habits reward gold + XP. Negative habits penalize."
        action={
          <NeonButton onClick={() => setCreating(true)} icon="+">
            New Habit
          </NeonButton>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Active" value={String((data?.items ?? []).length)} accent="#14d6e8" />
        <Stat label="Positive ✓" value={`${todayPositive} / ${positiveCount}`} accent="#9bff5c" />
        <Stat label="Negative ✕" value={`${todayNegative} / ${negativeCount}`} accent="#f55cc4" />
        <Stat label="Net Today" value={`${netGoldToday >= 0 ? '+' : ''}${netGoldToday} g`} accent="#ffc34d" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['ALL', 'POSITIVE', 'NEGATIVE'] as const).map((f) => (
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
            {f === 'ALL' ? `All (${(data?.items ?? []).length})` : f === 'POSITIVE' ? `+ Positive (${positiveCount})` : `− Negative (${negativeCount})`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Panel><div className="text-[10px] font-mono text-ink-300">loading…</div></Panel>
      ) : list.length === 0 ? (
        <Panel>
          <div className="text-center py-6 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300">No habits yet</div>
            <div className="text-xs text-ink-400 font-mono">
              Create your first one — e.g., "+ Drank water" or "− Ate junk food."
            </div>
            <NeonButton onClick={() => setCreating(true)} icon="+" variant="cyan">
              New Habit
            </NeonButton>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              onLog={() => logM.run(h.id)}
              onEdit={() => setEditing(h)}
              onArchive={() => archiveM.run(h.id)}
              logPending={logM.isPending}
              archivePending={archiveM.isPending}
            />
          ))}
        </div>
      )}

      {creating && (
        <HabitEditor
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['habits', 'custom'] });
          }}
        />
      )}
      {editing && (
        <HabitEditor
          mode="edit"
          habit={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['habits', 'custom'] });
          }}
        />
      )}
    </Layout>
  );
}

function HabitCard({
  habit,
  onLog,
  onEdit,
  onArchive,
  logPending,
  archivePending,
}: {
  habit: Habit;
  onLog: () => void;
  onEdit: () => void;
  onArchive: () => void;
  logPending: boolean;
  archivePending: boolean;
}) {
  const isPos = habit.direction === 'POSITIVE';
  const accent = isPos ? '#9bff5c' : '#f55cc4';
  const sign = isPos ? '+' : '−';
  // Visual state:
  //   - Unchecked (todayCount === 0): neutral gray tile, accent
  //     only appears on the icon and the Check button. The previous
  //     behaviour tinted the whole tile with the accent, which read
  //     as "this habit is done" before the user had actually done it.
  //   - Checked (todayCount > 0): full accent tint — border, bg, and
  //     title text all in the accent color. The whole tile lights up
  //     so the user sees their progress at a glance.
  const isChecked = habit.todayCount > 0;
  return (
    <div
      className={classNames(
        'border p-3 transition-all',
        isChecked
          ? 'shadow-md'
          : 'border-ink-500/30 hover:border-ink-300/50',
      )}
      style={isChecked
        ? { borderColor: `${accent}80`, background: `${accent}15`, boxShadow: `0 0 8px ${accent}30` }
        : undefined}
    >
      <div className="flex items-start gap-3">
        <div
          className={classNames(
            'shrink-0 w-12 h-12 grid place-items-center font-display text-2xl border',
            !isChecked && 'border-ink-500/30 text-ink-400',
          )}
          style={isChecked ? {
            color: accent,
            borderColor: `${accent}66`,
            background: `${accent}10`,
            textShadow: `0 0 6px ${accent}`,
          } : undefined}
        >
          {habit.icon ?? (isPos ? '✦' : '✕')}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={classNames(
              'font-display tracking-wider text-sm truncate',
              isChecked ? '' : 'text-ink-100',
            )}
            style={isChecked ? { color: accent, textShadow: `0 0 4px ${accent}` } : undefined}
          >
            {habit.name}
          </div>
          <div className="text-[10px] font-mono text-ink-300 mt-0.5">
            {sign} {habit.goldReward} gold · {sign} {habit.xpReward} XP per check
          </div>
          {habit.notes && (
            <div className="text-[10px] font-mono text-ink-400 italic mt-1 leading-snug">
              "{habit.notes}"
            </div>
          )}
          {habit.todayCount > 0 && (
            <div className="text-[10px] font-mono mt-1" style={{ color: accent }}>
              ✓ {habit.todayCount} today ({habit.todayGold >= 0 ? '+' : ''}{habit.todayGold} gold · {habit.todayXp >= 0 ? '+' : ''}{habit.todayXp} XP)
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <NeonButton
          onClick={onLog}
          loading={logPending}
          variant={isPos ? 'lime' : 'magenta'}
          icon={isPos ? '+' : '−'}
          loadingText="…"
          className="flex-1"
        >
          Check
        </NeonButton>
        <button
          onClick={onEdit}
          className="text-[10px] font-mono px-2 py-2 border border-ink-500/30 text-ink-300 hover:border-ink-300 hover:text-ink-100"
          title="Edit habit"
        >
          ✎
        </button>
        <button
          onClick={onArchive}
          disabled={archivePending}
          className="text-[10px] font-mono px-2 py-2 border border-ink-500/30 text-ink-400 hover:border-neon-magenta hover:text-neon-magenta disabled:opacity-40"
          title="Archive habit"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function HabitEditor({
  mode,
  habit,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  habit?: Habit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(habit?.name ?? '');
  const [direction, setDirection] = useState<'POSITIVE' | 'NEGATIVE'>(habit?.direction ?? 'POSITIVE');
  const [goldReward, setGoldReward] = useState<number>(habit?.goldReward ?? 5);
  const [xpReward, setXpReward] = useState<number>(habit?.xpReward ?? 2);
  const [notes, setNotes] = useState(habit?.notes ?? '');
  const [icon, setIcon] = useState(habit?.icon ?? '');
  // Selected difficulty tier. Used as a preset that auto-fills
  // goldReward + xpReward. The user can still override the inputs
  // directly. On edit, we pre-select the tier that best matches
  // the habit's current (gold, xp) values (if any). For a brand-new
  // habit, default to EASY.
  const initialTier: DifficultyTier = habit
    ? tierForRewards(habit.goldReward, habit.xpReward)
    : DIFFICULTY_TIERS[1]; // EASY
  const [selectedTier, setSelectedTier] = useState<DifficultyTier>(initialTier);
  // When the tier button is clicked, snap the gold/xp inputs to the
  // tier's values. We track this so we can show "Custom" if the user
  // edits the gold/xp inputs away from the tier's values.
  const applyTier = (t: DifficultyTier) => {
    setSelectedTier(t);
    setGoldReward(t.gold);
    setXpReward(t.xp);
  };

  const saveM = useDelayedMutation<unknown, void>({
    mutationFn: () => {
      const body =
        mode === 'create'
          ? { name, direction, goldReward, xpReward, notes: notes || undefined, icon: icon || undefined }
          : { name, goldReward, xpReward, notes: notes || null, icon: icon || null };
      return mode === 'create'
        ? api('/habits', { method: 'POST', body })
        : api(`/habits/${habit!.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => onSaved(),
  }, 400);

  const iconChoices = direction === 'POSITIVE' ? ICONS_POS : ICONS_NEG;

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Habit' : 'Edit Habit'}>
      <div className="space-y-4">
        {mode === 'create' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setDirection('POSITIVE'); setIcon(''); }}
              className={classNames(
                'p-3 border-2 text-left transition-all',
                direction === 'POSITIVE'
                  ? 'border-neon-lime/80 bg-neon-lime/10 text-neon-lime'
                  : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
              )}
            >
              <div className="font-display tracking-wider">+ Positive</div>
              <div className="text-[10px] font-mono mt-0.5">Reward when checked.</div>
            </button>
            <button
              onClick={() => { setDirection('NEGATIVE'); setIcon(''); }}
              className={classNames(
                'p-3 border-2 text-left transition-all',
                direction === 'NEGATIVE'
                  ? 'border-neon-magenta/80 bg-neon-magenta/10 text-neon-magenta'
                  : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
              )}
            >
              <div className="font-display tracking-wider">− Negative</div>
              <div className="text-[10px] font-mono mt-0.5">Penalty when checked.</div>
            </button>
          </div>
        )}

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Name
          </label>
          <input
            className="input-neon w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={direction === 'POSITIVE' ? 'e.g., Drank water' : 'e.g., Ate junk food'}
            autoFocus={mode === 'create'}
          />
        </div>

        {/* Difficulty tier — pick a preset to auto-fill gold + xp. The
            inputs below stay editable so the user can override after
            selecting a tier. */}
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Difficulty
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {DIFFICULTY_TIERS.map((t) => {
              const active = selectedTier.key === t.key
                && goldReward === t.gold
                && xpReward === t.xp;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => applyTier(t)}
                  title={`${t.label} — ${t.hint} (+${direction === 'NEGATIVE' ? '-' : ''}${t.gold}g, +${direction === 'NEGATIVE' ? '-' : ''}${t.xp} XP)`}
                  className={classNames(
                    'flex flex-col items-center justify-center py-2 px-1 border-2 transition-all text-center',
                    active
                      ? 'border-current bg-bg-700'
                      : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
                  )}
                  style={active ? { color: t.color, borderColor: t.color } : undefined}
                >
                  <span className="text-[9px] font-display tracking-widest uppercase">
                    {t.label}
                  </span>
                  <span className="text-[9px] font-mono mt-0.5 opacity-80">
                    {t.gold}g · {t.xp}xp
                  </span>
                </button>
              );
            })}
          </div>
          {selectedTier && (
            <div
              className="text-[10px] font-mono mt-1 italic"
              style={{ color: selectedTier.color }}
            >
              {selectedTier.hint}
            </div>
          )}
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Icon (optional)
          </label>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setIcon('')}
              className={classNames(
                'w-8 h-8 text-xs border font-mono',
                !icon ? 'border-neon-cyan/80 text-neon-cyan' : 'border-ink-500/30 text-ink-300',
              )}
              title="Default"
            >
              {direction === 'POSITIVE' ? '✦' : '✕'}
            </button>
            {iconChoices.map((g) => (
              <button
                key={g}
                onClick={() => setIcon(g)}
                className={classNames(
                  'w-8 h-8 text-base border font-display',
                  icon === g ? 'border-neon-cyan/80 text-neon-cyan' : 'border-ink-500/30 text-ink-200 hover:border-ink-300',
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
            Notes (optional)
          </label>
          <textarea
            className="w-full bg-bg-900/80 border border-ink-500/40 px-2 py-1 text-xs font-mono"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <NeonButton onClick={onClose} variant="cyan">Cancel</NeonButton>
          <NeonButton
            onClick={() => saveM.run()}
            disabled={!name.trim()}
            loading={saveM.isPending}
            icon="⚡"
            loadingText="Saving…"
            variant={direction === 'POSITIVE' ? 'lime' : 'magenta'}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </NeonButton>
        </div>
      </div>
    </Modal>
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