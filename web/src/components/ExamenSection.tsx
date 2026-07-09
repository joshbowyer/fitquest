import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { Modal } from './Modal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { classNames } from '@/lib/format';
import { formatRelative } from '@/lib/format';
import type { ExamenList, ExamenResponse } from '@/lib/types';

/**
 * Sunday-evening Ignatian examen reflection. One row per user per
 * week (UPSERT). Renders three textareas in a modal for the current
 * week + a list of recent weeks below. Empty state nudges the user
 * to try it once — short, low-stakes; the form takes ~2 min.
 *
 * Surfaced in the morning report's spiritual section ("you logged
 * your examen 4 of last 5 Sundays") via the examenTrend rollup in
 * the morning-report gather — see api/src/lib/morningReport.ts.
 */
export function ExamenSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const q = useQuery({
    queryKey: ['examen', 'list'],
    queryFn: () => api<ExamenList>('/examen'),
  });

  // When the user opens the modal for the current week, prefill
  // with whatever they already have so editing feels continuous
  // rather than "start over". For past weeks, they get a
  // read-only view (Edit button hidden — past responses are
  // historical data, not drafts).
  const currentWeekResponse = q.data?.items.find((it) => it.isCurrentWeek) ?? null;
  const pastItems = q.data?.items.filter((it) => !it.isCurrentWeek) ?? [];

  return (
    <>
      <Panel
        title="Weekly Examen"
        variant="violet"
        action={
          currentWeekResponse ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] font-mono uppercase tracking-widest text-violet-300 hover:underline"
            >
              ✎ Edit this week
            </button>
          ) : (
            <NeonButton variant="violet" size="sm" onClick={() => setEditing(true)}>
              ✦ Begin this week
            </NeonButton>
          )
        }
      >
        <div className="space-y-2">
          <p className="text-[11px] font-mono text-ink-300 leading-relaxed">
            Sunday-evening review of the week. Three prompts:
            what consoled you, what desolated you, and where was God
            in all this. One paragraph each is plenty.
          </p>
          {currentWeekResponse ? (
            <CurrentWeekSummary r={currentWeekResponse} />
          ) : (
            <div className="text-[11px] font-mono text-ink-400 italic py-2">
              You haven't logged an examen for this week yet.
            </div>
          )}
          {pastItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-violet-500/20 space-y-2">
              <div className="text-[10px] font-display tracking-widest uppercase text-violet-400">
                Previous weeks
              </div>
              {pastItems.slice(0, 6).map((it) => (
                <PastEntry key={it.id} r={it} />
              ))}
            </div>
          )}
        </div>
      </Panel>

      {editing && (
        <ExamenModal
          initial={currentWeekResponse}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ['examen'] });
          }}
        />
      )}
    </>
  );
}

function CurrentWeekSummary({ r }: { r: ExamenResponse }) {
  return (
    <div className="border border-violet-500/20 rounded p-3 space-y-2 bg-violet-500/5">
      <div className="text-[10px] font-mono text-violet-300 uppercase tracking-widest">
        This week · {r.weekStart}
      </div>
      <ExamenLine label="Consoled" text={r.consoled} accent="lime" />
      <ExamenLine label="Desolated" text={r.desolated} accent="red" />
      <ExamenLine label="God in all this" text={r.godsPresence} accent="cyan" />
      {r.notes && (
        <div className="pt-2 mt-2 border-t border-violet-500/15 text-[11px] font-mono text-ink-300 italic leading-relaxed">
          {r.notes}
        </div>
      )}
    </div>
  );
}

function ExamenLine({ label, text, accent }: { label: string; text: string; accent: 'lime' | 'red' | 'cyan' }) {
  const tone =
    accent === 'lime' ? 'text-neon-lime' :
    accent === 'red' ? 'text-neon-red' :
    'text-neon-cyan';
  const dot =
    accent === 'lime' ? 'bg-neon-lime' :
    accent === 'red' ? 'bg-neon-red' :
    'bg-neon-cyan';
  return (
    <div className="text-[11px] font-mono leading-relaxed">
      <span className={classNames('inline-block w-2 h-2 rounded-full mr-1.5 align-middle', dot)} />
      <span className={classNames('uppercase tracking-widest text-[10px] mr-2', tone)}>{label}</span>
      <span className="text-ink-100">{text}</span>
    </div>
  );
}

function PastEntry({ r }: { r: ExamenResponse }) {
  return (
    <details className="border border-ink-500/15 rounded p-2 group">
      <summary className="cursor-pointer text-[11px] font-mono text-ink-300 list-none flex items-center justify-between">
        <span>
          <span className="text-violet-300">▸</span> {r.weekStart}
        </span>
        <span className="text-[10px] text-ink-500">
          {formatRelative(r.updatedAt)}
        </span>
      </summary>
      <div className="mt-2 pt-2 border-t border-ink-500/15 space-y-1.5">
        <ExamenLine label="Consoled" text={r.consoled} accent="lime" />
        <ExamenLine label="Desolated" text={r.desolated} accent="red" />
        <ExamenLine label="God in all this" text={r.godsPresence} accent="cyan" />
        {r.notes && (
          <div className="text-[10px] font-mono text-ink-400 italic mt-1">{r.notes}</div>
        )}
      </div>
    </details>
  );
}

function ExamenModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: ExamenResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [consoled, setConsoled] = useState(initial?.consoled ?? '');
  const [desolated, setDesolated] = useState(initial?.desolated ?? '');
  const [godsPresence, setGodsPresence] = useState(initial?.godsPresence ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);

  // Reset fields when the modal opens for a different week. The
  // parent only mounts one modal at a time so the initial prop
  // won't change mid-edit — this useEffect handles the rare
  // "open modal A → close → open modal B with new initial" case
  // if it ever happens.
  useEffect(() => {
    setConsoled(initial?.consoled ?? '');
    setDesolated(initial?.desolated ?? '');
    setGodsPresence(initial?.godsPresence ?? '');
    setNotes(initial?.notes ?? '');
  }, [initial?.id]);

  const saveM = useDelayedMutation({
    mutationFn: () =>
      api('/examen', {
        method: 'POST',
        body: {
          consoled: consoled.trim(),
          desolated: desolated.trim(),
          godsPresence: godsPresence.trim(),
          notes: notes.trim() || undefined,
        },
      }),
    onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
    onSuccess: () => onSaved(),
  }, 500);

  const valid =
    consoled.trim().length > 0 &&
    desolated.trim().length > 0 &&
    godsPresence.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={initial ? 'Edit this week\'s examen' : 'Begin this week\'s examen'}>
      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        <ExamenField
          label="What consoled you this week?"
          accent="lime"
          value={consoled}
          onChange={setConsoled}
          placeholder="Moments of peace, breakthroughs, surprises that landed well…"
        />
        <ExamenField
          label="What desolated you?"
          accent="red"
          value={desolated}
          onChange={setDesolated}
          placeholder="Struggles, frustrations, times you felt distant…"
        />
        <ExamenField
          label="Where was God in all this?"
          accent="cyan"
          value={godsPresence}
          onChange={setGodsPresence}
          placeholder="In the quiet, in the work, in other people, in the ordinary…"
        />
        <label className="block">
          <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
            Notes (optional, overflow)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full bg-bg-900 border border-ink-500/30 rounded px-2 py-1.5 text-[11px] font-mono"
            placeholder="Anything else worth noting"
          />
        </label>

        {err && (
          <div className="text-[11px] font-mono text-rose-300">{err}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-ink-500/15">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[10px] font-display tracking-widest uppercase border border-ink-700/40 text-ink-300 hover:border-neon-cyan/40 rounded"
          >
            Cancel
          </button>
          <NeonButton
            variant="violet"
            onClick={() => {
              setErr(null);
              saveM.run();
            }}
            loading={saveM.isPending}
            disabled={!valid}
          >
            {initial ? 'Update' : 'Save'}
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}

function ExamenField({
  label,
  accent,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  accent: 'lime' | 'red' | 'cyan';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const borderColor =
    accent === 'lime' ? 'focus-within:border-neon-lime/60' :
    accent === 'red' ? 'focus-within:border-neon-red/60' :
    'focus-within:border-neon-cyan/60';
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-widest text-ink-400 block mb-1">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={classNames(
          'w-full bg-bg-900 border border-ink-500/30 rounded px-2 py-1.5 text-[11px] font-mono',
          borderColor,
        )}
        placeholder={placeholder}
        maxLength={2000}
      />
    </label>
  );
}
