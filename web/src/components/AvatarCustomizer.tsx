import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar } from './Avatar';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import type { User, UserAvatar } from '@/lib/auth';
import { getFrameArchetype, type FrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { classNames } from '@/lib/format';

const ACCENT_PALETTE = [
  '#14d6e8', '#f55cc4', '#56e88e', '#ffaa3a', '#daa520',
  '#8b9eff', '#9a6cf2', '#d0d0db', '#fafafd',
];

function isValidHex(s: string) {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

export function AvatarCustomizer({ user }: { user: User }) {
  const qc = useQueryClient();
  const archetype: FrameArchetype | null = useMemo(
    () => getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct),
    [user.heightCm, user.weightKg, user.bodyFatPct],
  );
  const classColor = user.class ? getClassColor(user.class) : null;

  const avatarQ = useQuery({
    queryKey: ['avatar'],
    queryFn: () => api<{ avatar: UserAvatar }>('/avatar'),
  });

  const [draft, setDraft] = useState<UserAvatar | null>(null);
  useEffect(() => {
    if (avatarQ.data?.avatar && !draft) setDraft(avatarQ.data.avatar);
  }, [avatarQ.data, draft]);

  const saveM = useMutation({
    mutationFn: (next: UserAvatar) =>
      api<{ avatar: UserAvatar }>('/avatar', { method: 'PUT', body: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['avatar'] }),
  });

  if (!archetype || !draft) {
    return (
      <Panel title="Avatar" variant="cyan">
        <div className="text-[10px] font-mono text-ink-300 italic">
          Set your frame (height, wrist, ankle) to generate your pixel sprite.
        </div>
      </Panel>
    );
  }

  const update = (patch: Partial<UserAvatar>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const dirty = JSON.stringify(draft) !== JSON.stringify(avatarQ.data?.avatar);

  const meta = ARCHETYPE_META[archetype];

  return (
    <Panel
      title="Avatar"
      variant="cyan"
      action={
        <NeonButton
          onClick={() => saveM.mutate(draft)}
          loading={saveM.isPending}
          disabled={!dirty}
          icon="⚡"
          loadingText="Saving…"
        >
          Save
        </NeonButton>
      }
    >
      <div className="flex flex-col md:flex-row gap-4">
        {/* Preview */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div
            className="border border-neon-cyan/30 bg-bg-900 p-3 relative"
            style={{
              backgroundImage:
                'linear-gradient(45deg, rgba(20,214,232,0.06) 25%, transparent 25%, transparent 75%, rgba(20,214,232,0.06) 75%), linear-gradient(45deg, rgba(20,214,232,0.06) 25%, transparent 25%, transparent 75%, rgba(20,214,232,0.06) 75%)',
              backgroundSize: '12px 12px',
              backgroundPosition: '0 0, 6px 6px',
            }}
          >
            <Avatar
              archetype={archetype}
              bodyFatPct={user.bodyFatPct}
              hairStyle={draft.hairStyle}
              hairColor={draft.hairColor}
              skinTone={draft.skinTone}
              shirtColor={draft.shirtColor}
              pantsColor={draft.pantsColor}
              accentColor={draft.accentColor}
              classStripe={classColor}
              size={160}
            />
          </div>
          <div className="text-[10px] font-mono text-ink-300 mt-2 uppercase tracking-widest">
            {meta.label} · {meta.tagline}
          </div>
          {classColor && (
            <div className="text-[10px] font-mono text-ink-300 mt-1 flex items-center gap-1">
              <span>Class stripe</span>
              <span
                className="inline-block w-3 h-3"
                style={{ background: classColor, boxShadow: `0 0 6px ${classColor}` }}
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-3">
          <div className="text-[10px] font-mono text-ink-300 leading-relaxed">
            Your avatar is bound to your <span className="text-ink-50">{meta.label}</span> archetype —
            each of the 9 somatotypes maps to a unique sprite from the Antifarea
            pixel character set. Change your frame (height, wrist, ankle, body fat)
            to swap silhouettes.
          </div>

          <ColorRow
            label="Accent (sprite tint)"
            value={draft.accentColor}
            onChange={(v) => update({ accentColor: v })}
            palette={ACCENT_PALETTE}
          />

          <details className="text-[10px] font-mono">
            <summary className="cursor-pointer text-ink-300 hover:text-ink-50 tracking-widest uppercase">
              ▾ Legacy customization (hair/skin/etc.)
            </summary>
            <div className="mt-2 space-y-2 opacity-60">
              <p className="text-ink-400 leading-relaxed">
                The Antifarea sprites are pre-coloured pixel art — recolouring them
                pixel-by-pixel would lose the original detail. Saved here for
                forward-compat in case we want to overlay hair later.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <Field label="Hair"  v={draft.hairStyle}  />
                <Field label="Skin"  v={draft.skinTone}   />
                <Field label="Shirt" v={draft.shirtColor} />
                <Field label="Pants" v={draft.pantsColor} />
              </div>
            </div>
          </details>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-400 uppercase tracking-widest">{label}</span>
      {v.startsWith('#') ? (
        <span className="inline-block w-4 h-4 border border-ink-700" style={{ background: v }} />
      ) : (
        <span className="text-ink-200">{v}</span>
      )}
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  palette,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  palette: string[];
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isValidHex(text);
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 border border-ink-500/40 bg-transparent cursor-pointer"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (valid) onChange(text);
            else setText(value);
          }}
          className={classNames(
            'flex-1 bg-bg-900/80 border px-2 py-1 text-xs font-mono',
            valid ? 'border-ink-500/40 text-ink-100' : 'border-neon-amber text-neon-amber',
          )}
        />
        <div className="flex flex-wrap gap-1">
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={classNames(
                'w-5 h-5 border',
                value === c ? 'border-ink-50' : 'border-ink-500/40 hover:border-ink-300',
              )}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getClassColor(className: string): string | null {
  switch (className) {
    case 'JUGGERNAUT': return '#f55cc4';
    case 'BERSERKER':  return '#f55cc4';
    case 'PHANTOM':    return '#56e88e';
    case 'SCOUT':      return '#daa520';
    case 'ORACLE':     return '#8b9eff';
    default: return null;
  }
}
