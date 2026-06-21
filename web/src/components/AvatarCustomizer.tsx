import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { SpriteAvatar } from './SpriteAvatar';
import { classNames } from '@/lib/format';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { hairColorSlug, shirtSlug, type HairColorPreset } from '@/lib/spriteBuckets';
import type { User, UserAvatar } from '@/lib/auth';
import { getFrameArchetype, type FrameArchetype, ARCHETYPE_META } from '@/lib/frame';

type HairStyle = 'SHORT' | 'LONG' | 'MOHAWK' | 'BUZZ' | 'PONYTAIL' | 'PIXIE';

// Hair sprite base names (no color suffix). Map to 6 of our 6 styles.
const HAIR_BASES: Record<HairStyle, string> = {
  SHORT:    'hair_bangs_1',
  LONG:     'hair_base_13',
  MOHAWK:   'hair_bangs_2',
  BUZZ:     'hair_bangs_3',
  PONYTAIL: 'hair_bangs_4',
  PIXIE:    'hair_base_10',
};

const HAIR_COLORS: Array<{ slug: HairColorPreset; hex: string; label: string }> = [
  { slug: 'black',  hex: '#2c2018', label: 'Black' },
  { slug: 'brown',  hex: '#6b4226', label: 'Brown' },
  { slug: 'blond',  hex: '#dcb35c', label: 'Blond' },
  { slug: 'TRUred', hex: '#b1372e', label: 'Red' },
];

const SKIN_TONES = [
  { hex: '#915533', label: 'Tan' },
  { hex: '#c06534', label: 'Warm' },
  { hex: '#ea8349', label: 'Honey' },
  { hex: '#f5a76e', label: 'Fair' },
  { hex: '#ddc994', label: 'Pale' },
  { hex: '#98461a', label: 'Deep' },
] as const;

const SHIRT_COLORS = [
  { slug: 'broad_shirt_blue',   hex: '#14d6e8', label: 'Cyan' },
  { slug: 'broad_shirt_green',  hex: '#56e88e', label: 'Lime' },
  { slug: 'broad_shirt_pink',   hex: '#f55cc4', label: 'Magenta' },
  { slug: 'broad_shirt_yellow', hex: '#daa520', label: 'Gold' },
  { slug: 'broad_shirt_white',  hex: '#d0d0db', label: 'White' },
  { slug: 'broad_shirt_black',  hex: '#2c2f3a', label: 'Black' },
] as const;

// Convenience: pick the hex for a hair preset slug (for storing in API).
function hairHexForSlug(slug: HairColorPreset): string {
  return HAIR_COLORS.find((c) => c.slug === slug)?.hex ?? '#6b4226';
}
function shirtHexForSlug(slug: string): string {
  return SHIRT_COLORS.find((c) => c.slug === slug)?.hex ?? '#14d6e8';
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

  const saveM = useDelayedMutation({
    mutationFn: (next: UserAvatar) =>
      api<{ avatar: UserAvatar }>('/avatar', { method: 'PUT', body: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['avatar'] }),
  }, 1000);

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
          onClick={() => saveM.run(draft)}
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
        {/* Preview — sprite avatar updates live with all picks */}
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
            <SpriteAvatar
              archetype={archetype}
              hairStyle={draft.hairStyle as HairStyle}
              hairColor={draft.hairColor}
              skinTone={draft.skinTone}
              shirtColor={draft.shirtColor}
              weapon="weapon_warrior_2"
              shield="shield_warrior_1"
              accentColor={draft.accentColor}
              classStripe={classColor}
              size={180}
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
        <div className="flex-1 space-y-4">
          <div className="text-[10px] font-mono text-ink-300 leading-relaxed">
            Your sprite is built from layered Habitica pixel art. Pick a hairstyle,
            hair color, skin tone, and shirt — every change shows live in the preview.
            Save to persist.
          </div>

          {/* Hair style */}
          <Section label="Hairstyle">
            <div className="grid grid-cols-3 gap-1.5">
              {(['SHORT', 'MOHAWK', 'BUZZ', 'PONYTAIL', 'LONG', 'PIXIE'] as HairStyle[]).map((s) => (
                <SpriteSwatch
                  key={s}
                  active={draft.hairStyle === s}
                  onClick={() => update({ hairStyle: s })}
                  label={s}
                  preview={<HairThumb hairStyle={s} hairColor={draft.hairColor} />}
                />
              ))}
            </div>
          </Section>

          {/* Hair color */}
          <Section label="Hair color">
            <div className="flex flex-wrap gap-1.5">
              {HAIR_COLORS.map((c) => {
                const slug = hairColorSlug(c.hex);
                const expectedHex = hairHexForSlug(slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    onClick={() => update({ hairColor: c.hex })}
                    className={classNames(
                      'w-7 h-7 border transition-all',
                      draft.hairColor.toLowerCase() === c.hex.toLowerCase()
                        ? 'border-neon-cyan scale-110 shadow-neon-cyan'
                        : 'border-ink-500/40 hover:border-ink-300',
                    )}
                    style={{ background: c.hex, boxShadow: `0 0 6px ${c.hex}66` }}
                    aria-label={`Hair: ${c.label}`}
                    title={`${c.label} → ${slug}`}
                  >
                    {/* Active marker just shows the swatch glow; the
                        preview pane reflects the actual sprite color. */}
                    {expectedHex !== c.hex && (
                      <span className="sr-only">maps to {expectedHex}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Skin tone */}
          <Section label="Skin tone">
            <div className="flex flex-wrap gap-1.5">
              {SKIN_TONES.map((t) => (
                <button
                  key={t.hex}
                  type="button"
                  onClick={() => update({ skinTone: t.hex })}
                  className={classNames(
                    'w-7 h-7 border transition-all',
                    draft.skinTone.toLowerCase() === t.hex.toLowerCase()
                      ? 'border-neon-cyan scale-110 shadow-neon-cyan'
                      : 'border-ink-500/40 hover:border-ink-300',
                  )}
                  style={{ background: t.hex, boxShadow: `0 0 6px ${t.hex}66` }}
                  aria-label={`Skin: ${t.label}`}
                  title={t.label}
                />
              ))}
            </div>
          </Section>

          {/* Shirt */}
          <Section label="Shirt">
            <div className="flex flex-wrap gap-1.5">
              {SHIRT_COLORS.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => update({ shirtColor: c.hex })}
                  className={classNames(
                    'w-7 h-7 border transition-all',
                    draft.shirtColor.toLowerCase() === c.hex.toLowerCase()
                      ? 'border-neon-cyan scale-110 shadow-neon-cyan'
                      : 'border-ink-500/40 hover:border-ink-300',
                  )}
                  style={{ background: c.hex, boxShadow: `0 0 6px ${c.hex}66` }}
                  aria-label={`Shirt: ${c.label}`}
                  title={c.label}
                />
              ))}
            </div>
          </Section>
        </div>
      </div>
    </Panel>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-widest text-ink-300 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function SpriteSwatch({
  active,
  onClick,
  label,
  preview,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  preview: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'relative border transition-all p-1',
        active
          ? 'border-neon-cyan bg-neon-cyan/10 shadow-neon-cyan'
          : 'border-ink-500/40 hover:border-ink-300 bg-bg-900/40',
      )}
      aria-pressed={active}
      title={label}
    >
      <div className="w-full aspect-square flex items-center justify-center overflow-hidden">
        {preview}
      </div>
      <div className="text-[8px] font-mono tracking-widest text-center mt-0.5 text-ink-200">
        {label}
      </div>
    </button>
  );
}

function HairThumb({ hairStyle, hairColor }: { hairStyle: HairStyle; hairColor: string }) {
  // Render the hair sprite alone in a small viewport so users see
  // exactly what they're picking. Uses the shared HSL bucket so the
  // thumbnail always matches the live preview.
  const base = HAIR_BASES[hairStyle];
  const colorSlug = hairColorSlug(hairColor);
  return (
    <svg viewBox="0 0 90 90" width="100%" height="100%" shapeRendering="crispEdges">
      <image href={`/sprites/hair/${base}_${colorSlug}.png`} x="0" y="0" width="90" height="90" />
    </svg>
  );
}

function getClassColor(className: string): string | null {
  switch (className) {
    case 'JUGGERNAUT': return '#dc2626';
    case 'BERSERKER':  return '#f55cc4';
    case 'PHANTOM':    return '#56e88e';
    case 'SCOUT':      return '#daa520';
    case 'TRACER':     return '#ff8c00';
    case 'ORACLE':     return '#8b9eff';
    default: return null;
  }
}