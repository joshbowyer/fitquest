import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, type UserAvatar } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { Avatar } from '@/components/Avatar';
import { ConstellationMap } from '@/components/ConstellationMap';
import { HomeBasePage } from '@/components/HomeBaseCard';
import type { HomeBase as HomeBaseData } from '@/lib/types';
import {
  type World,
  type WorldColor,
  WORLD_COLOR_HEX,
} from '@/lib/quest';
import { CLASS_META, type ClassName } from '@/lib/types';
import { getFrameArchetype, getFrameSize } from '@/lib/frame';
import { classNames } from '@/lib/format';

export function QuestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Home-base modal state. Opens when the user clicks the home-base
  // panel on the right OR the home-base node on the constellation
  // map. Closes on backdrop click or Escape.
  const [homeBaseOpen, setHomeBaseOpen] = useState(false);

  const { data: worlds, isLoading } = useQuery({
    queryKey: ['quest-worlds'],
    queryFn: () => api<World[]>('/quest/worlds'),
  });

  // Real home-base state for the constellation map's tooltip +
  // shield ring color. Same query the dashboard uses.
  const { data: homeBase } = useQuery({
    queryKey: ['home-base'],
    queryFn: () => api<HomeBaseData>('/home-base'),
  });

  const { data: avatarData } = useQuery({
    queryKey: ['avatar'],
    queryFn: () => api<{ avatar: UserAvatar }>('/avatar'),
  });
  const avatar = avatarData?.avatar ?? null;

  // Breach state for the constellation black hole overlay.
  // Only fetched when the user is at or near the unlock level —
  // saves a round trip for early-game users.
  const { data: breach } = useQuery({
    queryKey: ['breach'],
    queryFn: () => api<{ progress: { status: string; bossHp: number; bossMaxHp: number }; boss: { name: string } | null }>('/breach'),
    enabled: !!user && user.level >= 8,
    staleTime: 60_000,
  });
  const breachUnlocked = breach?.progress.status !== 'LOCKED' && breach?.boss != null;

  const portals = worlds ?? [];
  const archetype = user ? (getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE') : 'SPRITE';
  const sizeLabel = user ? getFrameSize(user.wristCm, user.ankleCm) : 'MEDIUM';
  const frameSizeLabel = sizeLabel.charAt(0) + sizeLabel.slice(1).toLowerCase();
  const bf = user?.bodyFatPct ?? 15;

  return (
    <Layout>
      <PageHeader
        title="Quest"
        subtitle="From the home base, paths reach out to other worlds. Each portal, a different test."
      />

      {isLoading || !user ? (
        <div className="text-ink-300 font-mono">scanning grid…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
          <Panel
            title="OVERWORLD"
            variant="cyan"
            action={
              <span className="text-[10px] font-mono text-ink-300 tracking-widest">
                {user.xp.toLocaleString()} XP · {user.gold.toLocaleString()} GOLD
              </span>
            }
          >
            <ConstellationMap
              worlds={portals}
              archetype={archetype}
              avatar={avatar}
              playerLevel={user.level}
              accentColor={avatar?.accentColor ?? '#14d6e8'}
              classStripe={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : null}
              onSelect={(id) => navigate(`/quest/${id}`)}
              onSelectNexus={(id) => navigate(`/quest/${id}`)}
              shieldTier={homeBase?.tier}
              shield={homeBase?.shield}
              recentEvents={homeBase?.recentEvents}
              onSelectHomeBase={() => setHomeBaseOpen(true)}
              breach={breachUnlocked ? {
                unlocked: true,
                bossName: breach!.boss!.name,
                bossHp: breach!.progress.bossHp,
                bossMaxHp: breach!.progress.bossMaxHp,
                status: breach!.progress.status as 'ACTIVE' | 'VICTORY' | 'COOLDOWN',
              } : null}
              onSelectBreach={() => navigate('/breach')}
            />
          </Panel>

          <div className="space-y-4">
            {/* HOME BASE — clickable card. Avatar preview + a thin
                shield bar showing the current tier. Click anywhere
                on the card to open the full home-base modal (shield
                value + event feed + penance toggle list). Wrapped in
                a button so the whole panel is clickable. */}
            <button
              type="button"
              onClick={() => setHomeBaseOpen(true)}
              className="block w-full text-left cursor-pointer hover:border-amber-500/50 transition-colors rounded"
            >
              <Panel
                title="HOME BASE"
                variant="amber"
                action={
                  homeBase ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-widest"
                      style={{ color: homeBase.tierColor }}
                    >
                      {homeBase.tierLabel} · {homeBase.shield}/100
                    </span>
                  ) : null
                }
              >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-20 shrink-0">
                    {avatar && (
                      <Avatar
                        archetype={archetype}
                        bodyFatPct={bf}
                        hairStyle={avatar.hairStyle}
                        hairColor={avatar.hairColor}
                        skinTone={avatar.skinTone}
                        shirtColor={avatar.shirtColor}
                        pantsColor={avatar.pantsColor}
                        accentColor={avatar.accentColor}
                        classStripe={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : null}
                        size={80}
                        sprites
                      />
                    )}
                  </div>
                  <div className="text-xs font-mono leading-relaxed flex-1 min-w-0">
                    <div className="text-ink-50 font-display tracking-widest">{user.username}</div>
                    <div className="text-ink-300">Lvl {user.level} {user.class ? `· ${user.class}` : ''}</div>
                    <div className="text-ink-400 text-[10px] mt-1">
                      {frameSizeLabel} · {archetype}
                    </div>
                  </div>
                </div>
                {/* Compact shield bar — mirrors the dashboard widget
                    so the user sees the tier color + value inline. */}
                {homeBase && (
                  <div>
                    <div className="relative h-1.5 rounded bg-bg-900 border border-ink-700/30 overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(100, homeBase.shield))}%`,
                          backgroundColor: homeBase.tierColor,
                        }}
                      />
                    </div>
                    {homeBase.recentEvents[0] && (
                      <div className="text-[10px] font-mono text-ink-400 mt-1.5 truncate">
                        Last: {homeBase.recentEvents[0].label}{' '}
                        <span style={{ color: homeBase.recentEvents[0].shieldDelta < 0 ? '#fca5a5' : '#86efac' }}>
                          {homeBase.recentEvents[0].shieldDelta > 0 ? '+' : ''}{homeBase.recentEvents[0].shieldDelta}
                        </span>
                      </div>
                    )}
                    <div className="text-[10px] font-mono text-amber-300 mt-1.5 tracking-widest uppercase opacity-70">
                      Tap for shield details →
                    </div>
                  </div>
                )}
              </div>
              </Panel>
            </button>

            <Panel title="WORLDS" variant="cyan">
              <div className="space-y-2">
                {portals.map((w) => {
                  const completed = w.levels.filter((l) => l.completed).length;
                  const unlocked = user.level >= w.levelRequired;
                  return (
                    <button
                      key={w.id}
                      onClick={() => unlocked && navigate(`/quest/${w.id}`)}
                      disabled={!unlocked}
                      className={classNames(
                        'w-full text-left px-3 py-2 border transition-all',
                        unlocked
                          ? 'border-ink-500 hover:border-neon-cyan/60 hover:bg-bg-700 cursor-pointer'
                          : 'border-bg-700 opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="text-lg"
                          style={{ color: WORLD_COLOR_HEX[w.color], textShadow: `0 0 8px ${WORLD_COLOR_HEX[w.color]}` }}
                        >
                          {w.icon}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm font-display tracking-widest text-ink-50">{w.name.toUpperCase()}</div>
                          <div className="text-[10px] text-ink-300 font-mono">
                            {w.theme} · {completed}/{w.levels.length} cleared
                          </div>
                        </div>
                        {!unlocked && (
                          <span className="text-[10px] font-mono text-ink-400">LVL {w.levelRequired}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
            </div>
          </div>
        )}

      {/* Home-base modal — full shield view + event feed + penance
          toggle list. Opens from clicking the home-base panel on
          the right OR the home-base node on the constellation map. */}
      {homeBaseOpen && (
        <Modal open onClose={() => setHomeBaseOpen(false)} title="Home base" width="max-w-3xl">
          <HomeBasePage />
        </Modal>
      )}
     </Layout>
   );
}

function primaryColorForClass(c: string): WorldColor {
  // Use the actual CLASS_META color so it stays in sync with the
  // source of truth. Falls back to goldenrod if class is unknown.
  const meta = CLASS_META[c as ClassName];
  if (!meta) return 'goldenrod';
  return meta.color as WorldColor;
}

function worldColorToVariant(c: WorldColor):
  'cyan' | 'red' | 'magenta' | 'lime' | 'amber' | 'violet' {
  switch (c) {
    case 'magenta':    return 'magenta';
    case 'lime':       return 'lime';
    case 'goldenrod':  return 'amber';
    case 'periwinkle': return 'violet';
    case 'cyan':       return 'cyan';
    case 'violet':     return 'violet';
    case 'red':        return 'red';
  }
}

