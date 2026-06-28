import { useMemo } from 'react';
import { Panel } from './Panel';
import { Avatar } from './Avatar';
import type { User } from '@/lib/auth';
import { getFrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { primaryColorForClass, WORLD_COLOR_HEX } from '@/lib/quest';

/**
 * Avatar panel — shows the user's Tron identity disc (avatar by
 * archetype) plus the full-body class portrait under
 * /sprites/class-portraits/.
 *
 * The old version let users customize hair / skin / shirt via the
 * Habitica layered sprite system. That art style is gone — the new
 * Tron portraits don't recolor per user. So this panel is now
 * read-only: it just renders whatever class + archetype the user
 * currently has, and tells them to /inventory to swap gear.
 */
export function AvatarCustomizer({ user }: { user: User }) {
  const archetype = useMemo(
    () => getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct),
    [user.heightCm, user.weightKg, user.bodyFatPct],
  );
  const classColor = user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : null;
  const portraitSrc = user.class
    ? `/sprites/class-portraits/${user.class.toLowerCase()}.png`
    : '/sprites/class-portraits/phantom.png';
  const meta = archetype ? ARCHETYPE_META[archetype] : null;

  return (
    <Panel title="Avatar" variant="cyan">
      <div className="flex flex-col md:flex-row gap-4">
        {/* Portrait — class full-body sprite is the primary avatar now.
            Glow tinted to the class color so it visually pairs with the
            identity disc on other screens. */}
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
            <img
              src={portraitSrc}
              alt={user.class ?? 'class portrait'}
              width={180}
              height={180}
              className="block"
              style={{
                width: 180,
                height: 180,
                filter: classColor ? `drop-shadow(0 0 12px ${classColor}88)` : undefined,
                imageRendering: 'pixelated',
              }}
            />
          </div>
          <div className="text-[10px] font-mono text-ink-300 mt-2 uppercase tracking-widest">
            {user.class ?? 'no class selected'}
          </div>
          {meta && (
            <div className="text-[10px] font-mono text-ink-300 mt-1">
              {meta.label} · {meta.tagline}
            </div>
          )}
        </div>

        {/* Side panel: identity disc + brief blurb */}
        <div className="flex-1 space-y-3">
          <div className="flex items-start gap-3">
            {archetype && (
              <Avatar
                archetype={archetype}
                accentColor={classColor ?? undefined}
                classStripe={classColor ?? null}
                size={88}
              />
            )}
            <div className="text-[10px] font-mono text-ink-300 leading-relaxed flex-1">
              Your avatar is your Tron identity disc — the silhouette scales with
              your archetype and the ring color tracks your class. Equip gear in
              /inventory to build out the rest of your loadout.
            </div>
          </div>
          {classColor && (
            <div className="text-[10px] font-mono text-ink-300 flex items-center gap-2">
              <span>Class stripe</span>
              <span
                className="inline-block w-3 h-3"
                style={{ background: classColor, boxShadow: `0 0 6px ${classColor}` }}
              />
              <span className="text-ink-400">{user.class}</span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
