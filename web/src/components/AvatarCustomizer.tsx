import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar, type AvatarHairStyle } from './Avatar';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import type { User, UserAvatar } from '@/lib/auth';
import { getFrameArchetype, type FrameArchetype } from '@/lib/frame';
import { classNames } from '@/lib/format';

const HAIR_STYLES: { value: AvatarHairStyle; label: string }[] = [
  { value: 'SHORT', label: 'Short' },
  { value: 'BUZZ', label: 'Buzz' },
  { value: 'LONG', label: 'Long' },
  { value: 'MOHAWK', label: 'Mohawk' },
  { value: 'PONYTAIL', label: 'Ponytail' },
  { value: 'PIXIE', label: 'Pixie' },
];

const COLORS = [
  '#14d6e8', '#f55cc4', '#56e88e', '#ffaa3a', '#daa520',
  '#8b9eff', '#9a6cf2', '#d0d0db', '#a8a8b8', '#585868',
  '#d0a878', '#e8c89a', '#8d5524', '#fafafd', '#1a1a1a',
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
          <div className="border border-neon-cyan/30 bg-bg-900 p-3 rounded">
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
            {archetype} · {draft.hairStyle.toLowerCase()}
          </div>
          {classColor && (
            <div className="text-[10px] font-mono text-ink-300 mt-1">
              Class stripe: <span style={{ color: classColor }}>●</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-1 space-y-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-ink-300 block mb-1">
              Hair style
            </label>
            <div className="flex flex-wrap gap-1">
              {HAIR_STYLES.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => update({ hairStyle: h.value })}
                  className={classNames(
                    'px-2 py-1 text-[10px] font-mono uppercase tracking-widest border transition-all',
                    draft.hairStyle === h.value
                      ? 'border-neon-cyan/80 text-neon-cyan bg-neon-cyan/10'
                      : 'border-ink-500/40 text-ink-300 hover:border-ink-300',
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <ColorRow
            label="Hair color"
            value={draft.hairColor}
            onChange={(v) => update({ hairColor: v })}
          />
          <ColorRow
            label="Skin tone"
            value={draft.skinTone}
            onChange={(v) => update({ skinTone: v })}
          />
          <ColorRow
            label="Shirt color"
            value={draft.shirtColor}
            onChange={(v) => update({ shirtColor: v })}
          />
          <ColorRow
            label="Pants color"
            value={draft.pantsColor}
            onChange={(v) => update({ pantsColor: v })}
          />
          <ColorRow
            label="Accent (eyes + outline)"
            value={draft.accentColor}
            onChange={(v) => update({ accentColor: v })}
          />
        </div>
      </div>
    </Panel>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
          {COLORS.slice(0, 6).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="w-5 h-5 border border-ink-500/40 hover:border-ink-100"
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
    case 'JUGGERNAUT': return '#f55cc4'; // magenta (STR)
    case 'BERSERKER':  return '#f55cc4';
    case 'PHANTOM':    return '#56e88e'; // lime (AGI)
    case 'SCOUT':      return '#daa520'; // goldenrod (CONST)
    case 'ORACLE':     return '#8b9eff'; // periwinkle (MIND)
    default: return null;
  }
}
