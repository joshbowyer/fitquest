/**
 * One-shot TODO list. Separate from Habits (recurring tick) and
 * Dailies (scheduled check-ins). Marking complete awards XP
 * scaled by priority (LOW=10, MEDIUM=20, HIGH=30).
 *
 * Sort order: OPEN first (sorted by due date asc nulls last,
 * priority desc, then createdAt desc), then DONE (most recent
 * first). The server enforces this; the page renders the
 * returned order as-is.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';
import type { TodoItem, TodoPriority, TodoStatus } from '@/lib/types';

type ListResp = { items?: TodoItem[]; created?: TodoItem } | TodoItem[];
type PatchResp = { todo: TodoItem; award: { xp: number; gold: number; leveledUp: boolean; newLevel: number } | null };

const PRIORITY_LABEL: Record<TodoPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Med',
  HIGH: 'High',
};
const PRIORITY_COLOR: Record<TodoPriority, string> = {
  LOW: 'text-ink-300 border-ink-700/40',
  MEDIUM: 'text-neon-cyan border-neon-cyan/40',
  HIGH: 'text-neon-magenta border-neon-magenta/50',
};

function priorityDot(p: TodoPriority): string {
  return p === 'HIGH' ? '●' : p === 'MEDIUM' ? '◐' : '○';
}

function dueLabel(iso: string | null): { text: string; tone: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const now = new Date();
  // Compare calendar days, not absolute ms
  const aMid = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const bMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDiff = Math.round((aMid - bMid) / 86_400_000);
  if (dayDiff < 0) return { text: `${-dayDiff}d overdue`, tone: 'text-neon-magenta' };
  if (dayDiff === 0) return { text: 'due today', tone: 'text-neon-amber' };
  if (dayDiff <= 3) return { text: `in ${dayDiff}d`, tone: 'text-neon-cyan' };
  return { text: `in ${dayDiff}d`, tone: 'text-ink-300' };
}

function TodoPageInner() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'OPEN' | 'DONE' | 'ALL'>('OPEN');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'lime' | 'magenta' } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['todos'],
    queryFn: () => api<TodoItem[]>('/todos'),
  });

  // GET /todos returns a flat array. The server's order is
  // OPEN-by-due/priority then DONE-by-recency. Filter client-side.
  const all: TodoItem[] = Array.isArray(data) ? data : (data as any)?.items ?? [];
  const filtered: TodoItem[] = all.filter((t: TodoItem) => {
    if (filter === 'OPEN') return t.status === 'OPEN';
    if (filter === 'DONE') return t.status === 'DONE';
    return true;
  });
  const openCount = all.filter((t: TodoItem) => t.status === 'OPEN').length;
  const doneCount = all.filter((t: TodoItem) => t.status === 'DONE').length;

  const completeM = useMutation<PatchResp, Error, string>({
    mutationFn: (id) => api(`/todos/${id}`, { method: 'PATCH', body: { status: 'DONE' } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      if (res.award) {
        const tone = res.award.leveledUp ? 'lime' : 'lime';
        setToast({ text: `+${res.award.xp} XP${res.award.leveledUp ? ` · level ${res.award.newLevel}!` : ''}`, tone });
        setTimeout(() => setToast(null), 2500);
      }
    },
  });

  const reopenM = useMutation<PatchResp, Error, string>({
    mutationFn: (id) => api(`/todos/${id}`, { method: 'PATCH', body: { status: 'OPEN' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });

  const deleteM = useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (id) => api(`/todos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });

  return (
    <Layout>
      <PageHeader
        title="Todos"
        subtitle="One-shot tasks — finish them, earn XP"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Filter pills */}
          <div className="flex items-center gap-2 text-xs font-mono">
            {(['OPEN', 'DONE', 'ALL'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={classNames(
                  'px-3 py-1 rounded border transition-colors',
                  filter === f
                    ? 'border-neon-violet/60 bg-neon-violet/10 text-ink-50'
                    : 'border-ink-700/40 text-ink-300 hover:border-neon-violet/40',
                )}
              >
                {f} ({f === 'OPEN' ? openCount : f === 'DONE' ? doneCount : all.length})
              </button>
            ))}
            <div className="flex-1" />
            <NeonButton
              type="button"
              variant="violet"
              onClick={() => setCreating(true)}
            >
              + New todo
            </NeonButton>
          </div>

          <Panel title={filter === 'DONE' ? 'Completed' : 'Open'}>
            {isLoading && (
              <div className="text-xs font-mono text-ink-300">Loading…</div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="text-sm text-ink-300 text-center py-8">
                {filter === 'OPEN'
                  ? 'No open todos. Click + New todo to add one.'
                  : filter === 'DONE'
                    ? 'No completed todos yet.'
                    : 'No todos yet.'}
              </div>
            )}
            <div className="space-y-1">
              {filtered.map((t: TodoItem) => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  onComplete={() => completeM.mutate(t.id)}
                  onReopen={() => reopenM.mutate(t.id)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => {
                    if (confirm(`Delete "${t.title}"?`)) deleteM.mutate(t.id);
                  }}
                  busy={
                    completeM.isPending || reopenM.isPending || deleteM.isPending
                  }
                />
              ))}
            </div>
          </Panel>
        </div>

        {/* Right column: simple stats / hints */}
        <div className="space-y-4">
          <Panel title="About">
            <div className="text-xs text-ink-300 space-y-2">
              <p>
                One-shot tasks, separate from{' '}
                <a href="/habits" className="text-neon-cyan hover:underline">
                  Habits
                </a>{' '}
                (recurring) and{' '}
                <a href="/dailies" className="text-neon-cyan hover:underline">
                  Dailies
                </a>{' '}
                (scheduled check-ins).
              </p>
              <p>
                Marking complete grants XP scaled by priority:
                <br />· Low = 10 XP<br />· Med = 20 XP<br />· High = 30 XP
              </p>
              <p className="text-ink-300/70">
                Use for things like "Schedule PT appt",
                "Register for the marathon", "Buy new running shoes".
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {(creating || editing) && (
        <TodoEditor
          todo={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['todos'] });
          }}
        />
      )}

      {toast && (
        <div
          className={classNames(
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded border font-mono text-sm',
            toast.tone === 'lime'
              ? 'border-neon-lime/60 bg-neon-lime/10 text-neon-lime'
              : 'border-neon-magenta/60 bg-neon-magenta/10 text-neon-magenta',
          )}
        >
          {toast.text}
        </div>
      )}
    </Layout>
  );
}

function TodoRow({
  todo, onComplete, onReopen, onEdit, onDelete, busy,
}: {
  todo: TodoItem;
  onComplete: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const due = dueLabel(todo.dueDate);
  const isDone = todo.status === 'DONE';
  return (
    <div
      className={classNames(
        'flex items-start gap-2 px-3 py-2 rounded border transition-colors',
        isDone
          ? 'border-ink-700/30 bg-bg-800/30 opacity-60'
          : 'border-ink-700/40 hover:border-neon-violet/40',
      )}
    >
      {isDone ? (
        <button
          type="button"
          onClick={onReopen}
          disabled={busy}
          className="mt-0.5 w-5 h-5 rounded border border-neon-lime/50 bg-neon-lime/20 text-neon-lime text-xs leading-none flex items-center justify-center hover:bg-neon-lime/30 disabled:opacity-50"
          title="Mark open"
        >
          ✓
        </button>
      ) : (
        <button
          type="button"
          onClick={onComplete}
          disabled={busy}
          className="mt-0.5 w-5 h-5 rounded border border-ink-500/50 text-ink-500 text-xs leading-none flex items-center justify-center hover:border-neon-lime/60 hover:text-neon-lime disabled:opacity-50"
          title="Mark complete"
          aria-label="Mark complete"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={classNames(
              'font-display tracking-wide text-sm',
              isDone && 'line-through text-ink-400',
            )}
          >
            {todo.title}
          </span>
          <span
            className={classNames(
              'text-[9px] font-mono px-1 rounded border',
              PRIORITY_COLOR[todo.priority],
            )}
          >
            {priorityDot(todo.priority)} {PRIORITY_LABEL[todo.priority]}
          </span>
          {due && (
            <span className={classNames('text-[9px] font-mono', due.tone)}>
              {due.text}
            </span>
          )}
        </div>
        {todo.description && (
          <div className="text-[11px] text-ink-300 mt-0.5 whitespace-pre-wrap">
            {todo.description}
          </div>
        )}
        {isDone && todo.completedAt && (
          <div className="text-[10px] text-ink-400 font-mono mt-0.5">
            done {new Date(todo.completedAt).toLocaleString()}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="text-[10px] font-mono text-ink-300 hover:text-neon-cyan disabled:opacity-30 px-1"
        >
          edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="text-[10px] font-mono text-ink-300 hover:text-neon-magenta disabled:opacity-30 px-1"
        >
          delete
        </button>
      </div>
    </div>
  );
}

function TodoEditor({
  todo, onClose, onSaved,
}: {
  todo: TodoItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!todo;
  const [title, setTitle] = useState(todo?.title ?? '');
  const [description, setDescription] = useState(todo?.description ?? '');
  const [dueDate, setDueDate] = useState(todo?.dueDate ? todo.dueDate.slice(0, 10) : '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'MEDIUM');
  const [error, setError] = useState<string | null>(null);

  const saveM = useMutation<
    TodoItem, Error, { method: string; url: string; body: any }
  >({
    mutationFn: async (req) => api(req.url, { method: req.method, body: req.body }),
    onSuccess: onSaved,
    onError: (err: any) => {
      setError(err?.message ?? 'Save failed');
    },
  });

  const submit = () => {
    if (!title.trim()) { setError('Title required'); return; }
    setError(null);
    const body: any = {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    };
    if (dueDate) {
      // Server expects full ISO. Send midnight UTC of that day.
      const iso = new Date(dueDate + 'T00:00:00.000Z').toISOString();
      body.dueDate = iso;
    }
    if (isEdit && todo) {
      // PATCH: send only changed fields. Title/due/priority/
      // description are editable; status changes via the
      // complete/reopen buttons in the row.
      const patch: any = {};
      if (title.trim() !== todo.title) patch.title = title.trim();
      if ((description.trim() || null) !== (todo.description ?? null)) {
        patch.description = description.trim() ? description.trim() : null;
      }
      if (priority !== todo.priority) patch.priority = priority;
      const newDueIso = dueDate ? new Date(dueDate + 'T00:00:00.000Z').toISOString() : null;
      const oldDueIso = todo.dueDate ?? null;
      if (newDueIso !== oldDueIso) patch.dueDate = newDueIso;
      saveM.mutate({ method: 'PATCH', url: `/todos/${todo.id}`, body: patch });
    } else {
      saveM.mutate({ method: 'POST', url: '/todos', body });
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={isEdit ? 'Edit todo' : 'New todo'}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="space-y-3"
      >
        <div>
          <label className="block text-[10px] font-mono uppercase text-ink-300 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
            className="w-full bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm text-ink-50 placeholder:text-ink-300/60 focus:outline-none focus:border-neon-violet/60"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase text-ink-300 mb-1">Description (optional)</label>
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm text-ink-50 placeholder:text-ink-300/60 focus:outline-none focus:border-neon-violet/60 resize-none"
            placeholder="Notes, links, anything you'll need when you tackle this"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-mono uppercase text-ink-300 mb-1">Due date (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm text-ink-50 focus:outline-none focus:border-neon-violet/60"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase text-ink-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TodoPriority)}
              className="w-full bg-bg-900 border border-ink-700/40 rounded px-3 py-2 text-sm text-ink-50 focus:outline-none focus:border-neon-violet/60"
            >
              <option value="LOW">Low — 10 XP</option>
              <option value="MEDIUM">Med — 20 XP</option>
              <option value="HIGH">High — 30 XP</option>
            </select>
          </div>
        </div>
        {error && (
          <div className="text-[10px] font-mono text-neon-magenta">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <NeonButton type="button" onClick={onClose}>
            Cancel
          </NeonButton>
          <NeonButton type="submit" variant="violet" loading={saveM.isPending} loadingText="Saving…">
            {isEdit ? 'Save' : 'Create'}
          </NeonButton>
        </div>
      </form>
    </Modal>
  );
}

export default function TodoPage() {
  return (
    <Layout>
      <TodoPageInner />
    </Layout>
  );
}