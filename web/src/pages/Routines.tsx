import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { Modal } from '@/components/Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { ExerciseAutocomplete } from '@/components/ExerciseAutocomplete';
import { classNames } from '@/lib/format';

// =============================================================================
// Workout template types — match the server's WorkoutTemplate +
// WorkoutTemplateExercise + WorkoutTemplateSet shapes.
// =============================================================================

type TemplateSet = {
  order: number;
  targetReps: number;
  targetDuration: number | null;
};

type TemplateExercise = {
  name: string;
  order: number;
  sets: TemplateSet[];
};

type WorkoutType =
  | 'STRENGTH' | 'HYPERTROPHY' | 'CALISTHENICS'
  | 'CARDIO' | 'MOBILITY' | 'OTHER';

type WorkoutTemplate = {
  id: string;
  name: string;
  type: WorkoutType;
  notes: string | null;
  exerciseCount: number;
  createdAt: string;
  updatedAt: string;
  exercises?: TemplateExercise[];
};

type TemplateDetail = Omit<WorkoutTemplate, 'exerciseCount'> & {
  exercises: TemplateExercise[];
};

const TYPE_OPTIONS: { value: WorkoutType; label: string; color: 'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' }[] = [
  { value: 'STRENGTH', label: 'Strength', color: 'cyan' },
  { value: 'HYPERTROPHY', label: 'Hypertrophy', color: 'magenta' },
  { value: 'CALISTHENICS', label: 'Calisthenics', color: 'lime' },
  { value: 'CARDIO', label: 'Cardio', color: 'amber' },
  { value: 'MOBILITY', label: 'Mobility', color: 'violet' },
  { value: 'OTHER', label: 'Other', color: 'cyan' },
];

function emptyTemplate(): { name: string; type: WorkoutType; notes: string; exercises: TemplateExercise[] } {
  return {
    name: '',
    type: 'STRENGTH',
    notes: '',
    exercises: [
      {
        name: '',
        order: 0,
        sets: [{ order: 0, targetReps: 8, targetDuration: null }],
      },
    ],
  };
}

// =============================================================================
// Page
// =============================================================================
export function RoutinesPage() {
  const { id: editId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ----- List -----
  const listQ = useQuery({
    queryKey: ['workout-templates'],
    queryFn: () => api<{ items: WorkoutTemplate[] }>('/workout-templates'),
  });

  // ----- Edit modal -----
  const [editingId, setEditingId] = useState<string | null>(editId ?? null);
  const [draft, setDraft] = useState(emptyTemplate());

  // Open editor when ?editId is in the URL (deep-link from /activities).
  useEffect(() => {
    if (editId) {
      setEditingId(editId);
    }
  }, [editId]);

  // ----- Create -----
  const createM = useDelayedMutation({
    mutationFn: () => {
      // Re-number orders sequentially so the server doesn't get
      // duplicate 0/1/2/etc. after a deletion.
      const body = {
        ...draft,
        notes: draft.notes || undefined,
        exercises: draft.exercises.map((ex, ei) => ({
          ...ex,
          order: ei,
          sets: ex.sets.map((s, si) => ({
            ...s,
            order: si,
            targetDuration: s.targetDuration || null,
          })),
        })),
      };
      return api<WorkoutTemplate>('/workout-templates', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout-templates'] });
      setEditingId(null);
      setDraft(emptyTemplate());
    },
  }, 800);

  // ----- Update -----
  const updateM = useDelayedMutation({
    mutationFn: (tid: string) => {
      const body = {
        ...draft,
        notes: draft.notes || undefined,
        exercises: draft.exercises.map((ex, ei) => ({
          ...ex,
          order: ei,
          sets: ex.sets.map((s, si) => ({
            ...s,
            order: si,
            targetDuration: s.targetDuration || null,
          })),
        })),
      };
      return api<WorkoutTemplate>(`/workout-templates/${tid}`, {
        method: 'PATCH',
        body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout-templates'] });
      setEditingId(null);
    },
  }, 800);

  // ----- Delete -----
  const deleteM = useDelayedMutation({
    mutationFn: (tid: string) => api(`/workout-templates/${tid}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout-templates'] });
      setDeletingId(null);
    },
  }, 600);

  // ----- Duplicate -----
  const duplicateM = useDelayedMutation({
    mutationFn: (tid: string) => api<WorkoutTemplate>(
      `/workout-templates/${tid}/duplicate`,
      { method: 'POST' },
    ),
    onSuccess: (newTpl) => {
      qc.invalidateQueries({ queryKey: ['workout-templates'] });
      // Open the editor on the new copy so the user can tweak.
      setDraft({
        name: newTpl.name,
        type: newTpl.type,
        notes: newTpl.notes ?? '',
        exercises: newTpl.exercises ?? [],
      });
      setEditingId(newTpl.id);
      navigate(`/routines/${newTpl.id}`);
    },
  }, 600);

  // ----- Load a template into the editor -----
  async function openEdit(tid: string) {
    const t = await api<TemplateDetail>(`/workout-templates/${tid}`);
    setDraft({
      name: t.name,
      type: t.type,
      notes: t.notes ?? '',
      exercises: t.exercises.map((ex) => ({
        name: ex.name,
        order: ex.order,
        sets: ex.sets.map((s) => ({
          order: s.order,
          targetReps: s.targetReps,
          targetDuration: s.targetDuration,
        })),
      })),
    });
    setEditingId(tid);
    navigate(`/routines/${tid}`);
  }

  function openNew() {
    setDraft(emptyTemplate());
    setEditingId('new');
    navigate(`/routines/new`);
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(emptyTemplate());
    navigate('/routines');
  }

  // ----- Confirm delete state -----
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isEditorOpen = editingId !== null;

  return (
    <Layout>
      <PageHeader
        title="// Routines"
        subtitle="Saved workout patterns. Pick one on /activities to prefill exercises + reps."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4 items-start">
        {/* ---------- List of templates ---------- */}
        <Panel
          variant="cyan"
          title="Saved routines"
          action={
            <NeonButton size="sm" variant="cyan" onClick={openNew}>
              + New routine
            </NeonButton>
          }
        >
          {listQ.isLoading && (
            <div className="text-xs text-ink-300 font-mono">⏳ Loading…</div>
          )}
          {listQ.data && listQ.data.items.length === 0 && (
            <div className="text-xs text-ink-300 font-mono py-4 text-center border border-dashed border-ink-700/30">
              No routines yet. Click <span className="text-neon-cyan">+ New routine</span> to start.
            </div>
          )}
          {listQ.data && listQ.data.items.length > 0 && (
            <div className="space-y-2">
              {listQ.data.items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openEdit(t.id)}
                  className={classNames(
                    'w-full text-left p-2 border transition-all hover:border-neon-cyan/60',
                    'border-ink-500/30 bg-bg-700/40',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-display tracking-wider text-sm text-neon-cyan truncate">
                      {t.name}
                    </span>
                    <span className="text-[10px] font-mono text-ink-400 shrink-0">
                      {t.type.toLowerCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-ink-300">
                    <span>{t.exerciseCount} exercises</span>
                    <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(t.id);
                      }}
                      className="px-2 py-0.5 text-[10px] font-mono border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateM.run(t.id);
                      }}
                      className="px-2 py-0.5 text-[10px] font-mono border border-neon-amber/40 text-neon-amber hover:bg-neon-amber/10"
                      title="Create a copy you can edit"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(t.id);
                      }}
                      className="px-2 py-0.5 text-[10px] font-mono border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* ---------- Editor panel ---------- */}
        <Panel
          variant={editingId === 'new' ? 'cyan' : 'magenta'}
          title={editingId === 'new' ? 'New routine' : editingId ? 'Edit routine' : 'Pick a routine to edit'}
        >
          {!isEditorOpen && (
            <div className="text-xs text-ink-300 font-mono py-4 text-center border border-dashed border-ink-700/30">
              Click <span className="text-neon-cyan">Edit</span> on a saved routine or <span className="text-neon-cyan">+ New routine</span> to start.
            </div>
          )}
          {isEditorOpen && (
            <TemplateEditor
              draft={draft}
              setDraft={setDraft}
              isCreate={editingId === 'new'}
              saving={createM.isPending || updateM.isPending}
              error={createM.error || updateM.error}
              onSave={() => {
                if (editingId === 'new') createM.run(undefined);
                else if (editingId) updateM.run(editingId);
              }}
              onCancel={closeEditor}
            />
          )}
        </Panel>
      </div>

      {/* ---------- Delete confirm ---------- */}
      {deletingId && (
        <Modal
          open
          onClose={() => setDeletingId(null)}
          title="Delete this routine?"
        >
          <div className="space-y-3">
            <p className="text-sm text-ink-200">
              This will permanently delete the routine and all its exercises/sets.
              Existing workouts logged against this routine won't be affected.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="px-3 h-9 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteM.run(deletingId)}
                disabled={deleteM.isPending}
                className="px-3 h-9 text-xs font-mono border border-rose-500/60 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-40"
              >
                {deleteM.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

// =============================================================================
// Editor — name + type + notes + exercises-with-sets.
// =============================================================================

function TemplateEditor({
  draft,
  setDraft,
  isCreate,
  saving,
  error,
  onSave,
  onCancel,
}: {
  draft: { name: string; type: WorkoutType; notes: string; exercises: TemplateExercise[] };
  setDraft: (d: typeof draft) => void;
  isCreate: boolean;
  saving: boolean;
  error: Error | null;
  onSave: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
          Routine name
        </label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder='e.g. "Push Day 5x5"'
          className="input-neon mt-1"
          autoFocus
        />
      </div>

      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
          Default type
        </label>
        <div className="flex flex-wrap gap-2 mt-1">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setDraft({ ...draft, type: t.value })}
              className={classNames(
                'px-3 py-1.5 text-xs font-display tracking-widest uppercase border transition-all',
                draft.type === t.value
                  ? `border-neon-${t.color}/80 text-neon-${t.color} bg-neon-${t.color}/10`
                  : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-ink-400 mt-1 font-mono">
          Prefilled when this routine is picked on /activities. You can override per-workout.
        </div>
      </div>

      <div>
        <label className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
          Notes (optional)
        </label>
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Anything you want to see when starting a workout from this routine…"
          className="input-neon mt-1 min-h-[60px] text-xs"
        />
      </div>

      {/* ---------- Exercises ---------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-widest text-neon-cyan/80">
            Exercises
          </div>
          <button
            type="button"
            onClick={() => {
              const lastEx = draft.exercises[draft.exercises.length - 1];
              setDraft({
                ...draft,
                exercises: [
                  ...draft.exercises,
                  {
                    name: '',
                    order: draft.exercises.length,
                    // Carry the previous exercise's rep target so quick
                    // additions don't reset to a generic 8.
                    sets: [{ order: 0, targetReps: lastEx?.sets[0]?.targetReps ?? 8, targetDuration: null }],
                  },
                ],
              });
            }}
            className="px-2 py-1 text-[10px] font-mono border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10"
          >
            + Add exercise
          </button>
        </div>
        {draft.exercises.map((ex, ei) => (
          <div key={ei} className="border border-ink-500/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-ink-400 w-6 shrink-0">#{ei + 1}</span>
              <ExerciseAutocomplete
                className="flex-1 text-sm"
                value={ex.name}
                filterCategory={draft.type as any}
                onChange={(v) => {
                  const copy = [...draft.exercises];
                  copy[ei] = { ...copy[ei], name: v };
                  setDraft({ ...draft, exercises: copy });
                }}
                placeholder="e.g. Bench Press"
              />
              {draft.exercises.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      exercises: draft.exercises.filter((_, i) => i !== ei),
                    });
                  }}
                  className="px-2 h-9 text-[10px] font-mono border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="space-y-1">
              {ex.sets.map((s, si) => (
                <div key={si} className="flex items-center gap-2 text-xs">
                  <span className="text-[10px] font-mono text-ink-400 w-8 shrink-0">set {si + 1}</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={s.targetReps || ''}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const copy = [...draft.exercises];
                      copy[ei] = {
                        ...copy[ei],
                        sets: copy[ei].sets.map((ss, jj) =>
                          jj === si ? { ...ss, targetReps: v } : ss,
                        ),
                      };
                      setDraft({ ...draft, exercises: copy });
                    }}
                    className="input-neon flex-1"
                    placeholder="target reps"
                  />
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={s.targetDuration ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      const copy = [...draft.exercises];
                      copy[ei] = {
                        ...copy[ei],
                        sets: copy[ei].sets.map((ss, jj) =>
                          jj === si ? { ...ss, targetDuration: v } : ss,
                        ),
                      };
                      setDraft({ ...draft, exercises: copy });
                    }}
                    className="input-neon w-24"
                    placeholder="sec (optional)"
                    title="Optional: seconds for timed sets (plank, l-sit)"
                  />
                  {ex.sets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const copy = [...draft.exercises];
                        copy[ei] = {
                          ...copy[ei],
                          sets: copy[ei].sets.filter((_, jj) => jj !== si),
                        };
                        setDraft({ ...draft, exercises: copy });
                      }}
                      className="px-1.5 h-9 text-[10px] font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const lastSet = ex.sets[ex.sets.length - 1];
                  const copy = [...draft.exercises];
                  copy[ei] = {
                    ...copy[ei],
                    sets: [
                      ...copy[ei].sets,
                      {
                        order: ex.sets.length,
                        targetReps: lastSet?.targetReps ?? 8,
                        targetDuration: lastSet?.targetDuration ?? null,
                      },
                    ],
                  };
                  setDraft({ ...draft, exercises: copy });
                }}
                className="px-2 py-1 text-[10px] font-mono border border-neon-cyan/30 text-neon-cyan/80 hover:bg-neon-cyan/10"
              >
                + Add set
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- Save / Cancel ---------- */}
      <div className="border-t border-ink-500/20 pt-3 flex items-center gap-3">
        <NeonButton
          variant="cyan"
          onClick={onSave}
          loading={saving}
          disabled={!draft.name.trim() || draft.exercises.some((e) => !e.name.trim() || e.sets.length === 0)}
        >
          {isCreate ? 'Create routine' : 'Save changes'}
        </NeonButton>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 h-9 text-xs font-mono border border-ink-500/40 text-ink-300 hover:border-ink-300"
        >
          Cancel
        </button>
        {error && (
          <span className="text-xs text-rose-300 font-mono">
            {error instanceof ApiError ? error.message : 'Save failed. Check that every exercise has a name + at least one set.'}
          </span>
        )}
      </div>
    </div>
  );
}