import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, type UserAvatar } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Avatar } from '@/components/Avatar';
import {
  type World,
  type PortalTile,
  portalLayoutFor,
  HOME_TILE,
  MAP_TILES_X,
  MAP_TILES_Y,
  WORLD_COLOR_HEX,
} from '@/lib/quest';
import { getFrameArchetype, getFrameSize } from '@/lib/frame';
import { classNames } from '@/lib/format';

export function QuestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: worlds, isLoading } = useQuery({
    queryKey: ['quest-worlds'],
    queryFn: () => api<World[]>('/quest/worlds'),
  });

  const { data: avatarData } = useQuery({
    queryKey: ['avatar'],
    queryFn: () => api<{ avatar: UserAvatar }>('/avatar'),
  });
  const avatar = avatarData?.avatar ?? null;

  const portals = worlds ? portalLayoutFor(worlds) : [];
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
            <OverworldMap
              portals={portals}
              archetype={archetype}
              avatar={avatar}
              playerLevel={user.level}
              accentColor={avatar?.accentColor ?? '#14d6e8'}
              classStripe={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : null}
              onSelect={(id) => navigate(`/quest/${id}`)}
            />
          </Panel>

          <div className="space-y-4">
            <Panel title="HOME BASE" variant="amber">
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
                    />
                  )}
                </div>
                <div className="text-xs font-mono leading-relaxed">
                  <div className="text-ink-50 font-display tracking-widest">{user.username}</div>
                  <div className="text-ink-300">Lvl {user.level} {user.class ? `· ${user.class}` : ''}</div>
                  <div className="text-ink-400 text-[10px] mt-1">
                    {frameSizeLabel} · {archetype}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="WORLDS" variant="cyan">
              <div className="space-y-2">
                {portals.map((p) => {
                  const completed = p.world.levels.filter((l) => l.completed).length;
                  const unlocked = user.level >= p.world.levelRequired;
                  return (
                    <button
                      key={p.world.id}
                      onClick={() => unlocked && navigate(`/quest/${p.world.id}`)}
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
                          style={{ color: WORLD_COLOR_HEX[p.world.color], textShadow: `0 0 8px ${WORLD_COLOR_HEX[p.world.color]}` }}
                        >
                          {p.world.icon}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm font-display tracking-widest text-ink-50">{p.world.name.toUpperCase()}</div>
                          <div className="text-[10px] text-ink-300 font-mono">
                            {p.world.theme} · {completed}/{p.world.levels.length} cleared
                          </div>
                        </div>
                        {!unlocked && (
                          <span className="text-[10px] font-mono text-ink-400">LVL {p.world.levelRequired}</span>
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
    </Layout>
  );
}

function primaryColorForClass(c: string): 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' {
  switch (c) {
    case 'JUGGERNAUT':
    case 'BERSERKER': return 'magenta';
    case 'PHANTOM':
    case 'SCOUT':     return 'lime';
    case 'ORACLE':    return 'periwinkle';
    default:          return 'goldenrod';
  }
}

function worldColorToVariant(c: 'magenta' | 'lime' | 'goldenrod' | 'periwinkle' | 'violet' | 'cyan'):
  'cyan' | 'magenta' | 'lime' | 'amber' | 'violet' {
  switch (c) {
    case 'magenta':    return 'magenta';
    case 'lime':       return 'lime';
    case 'goldenrod':  return 'amber';
    case 'periwinkle': return 'violet';
    case 'cyan':       return 'cyan';
    case 'violet':     return 'violet';
  }
}

function OverworldMap({
  portals,
  archetype,
  avatar,
  playerLevel,
  accentColor,
  classStripe,
  onSelect,
}: {
  portals: PortalTile[];
  archetype: 'WISP' | 'SPRITE' | 'DRAKE' | 'STRIKER' | 'FORGE' | 'GOLEM' | 'WIRED' | 'BEAR' | 'BEHEMOTH';
  avatar: UserAvatar | null;
  playerLevel: number;
  accentColor: string;
  classStripe: string | null;
  onSelect: (worldId: string) => void;
}) {
  // Build a 2D grid of cells.
  const grid: Array<Array<{ kind: 'empty' } | { kind: 'home' } | { kind: 'path'; worldId: string } | { kind: 'portal'; worldId: string }>> =
    Array.from({ length: MAP_TILES_Y }, () =>
      Array.from({ length: MAP_TILES_X }, () => ({ kind: 'empty' as const })),
    );
  grid[HOME_TILE.y][HOME_TILE.x] = { kind: 'home' };
  for (const p of portals) {
    for (const cell of p.pathCells.slice(1, -1)) {
      grid[cell.y][cell.x] = { kind: 'path', worldId: p.world.id };
    }
    const last = p.pathCells[p.pathCells.length - 1];
    grid[last.y][last.x] = { kind: 'portal', worldId: p.world.id };
  }

  // Color lookup by worldId
  const colorByWorld = new Map(portals.map((p) => [p.world.id, p.world.color]));

  // For each path, compute the cell's distance from home (0 = adjacent,
  // increasing toward portal). Used to stagger the energy flow animation
  // so the energy appears to flow FROM home TO portal.
  const pathDistance: Map<string, number> = new Map();
  for (const p of portals) {
    p.pathCells.forEach((cell, i) => {
      if (i === 0 || i === p.pathCells.length - 1) return;
      pathDistance.set(`${cell.x},${cell.y}`, i);
    });
  }

  // Use a CSS variable so we can scale the map responsively via
  // .map-cell-size set on the wrapper.
  const cellSize = 44;
  const cellStyle: React.CSSProperties = {
    width: 'var(--map-cell-size, 44px)',
    height: 'var(--map-cell-size, 44px)',
    minWidth: 'var(--map-cell-size, 44px)',
    minHeight: 'var(--map-cell-size, 44px)',
    flexShrink: 0,
  };

  return (
    <div className="map-grid">
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${MAP_TILES_X}, var(--map-cell-size, ${cellSize}px))`,
        gridTemplateRows: `repeat(${MAP_TILES_Y}, var(--map-cell-size, ${cellSize}px))`,
        gap: '1px',
        background: '#1a1c26',
        border: '1px solid rgba(20,214,232,0.3)',
        padding: '4px',
        width: 'fit-content',
        margin: '0 auto',
      }}
    >
      {grid.flatMap((row, y) =>
        row.map((cell, x) => {
          if (cell.kind === 'home') {
            // Tron-style disc avatar at the home base. The Avatar
            // component is an SVG so we can drop it into a cell
            // easily. The wrapper has a gentle bobbing animation.
            return (
              <div
                key={`${x}-${y}`}
                style={{
                  ...cellStyle,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  background: '#0e0f1a',
                  boxShadow: `inset 0 0 0 2px ${accentColor}, 0 0 8px ${accentColor}`,
                }}
                title="Home Base"
              >
                <div
                  style={{
                    width: '88%',
                    height: '88%',
                    animation: 'avatarBob 3s ease-in-out infinite',
                  }}
                >
                  <Avatar
                    archetype={archetype}
                    accentColor={accentColor}
                    classStripe={classStripe}
                  />
                </div>
              </div>
            );
          }
          if (cell.kind === 'path') {
            const c = colorByWorld.get(cell.worldId)!;
            const hex = WORLD_COLOR_HEX[c];
            // Energy flow: each cell pulses at a different phase based on
            // its distance from home. Uses a CSS keyframe animation.
            const dist = pathDistance.get(`${x},${y}`) ?? 0;
            const delay = dist * 0.18;
            return (
              <div
                key={`${x}-${y}`}
                style={{
                  ...cellStyle,
                  background: hex,
                  opacity: 0.7,
                  boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.3)`,
                  animation: `energyFlow 2.4s ease-in-out ${delay}s infinite`,
                }}
              />
            );
          }
          if (cell.kind === 'portal') {
            const portal = portals.find((p) => p.pathCells[p.pathCells.length - 1].x === x && p.pathCells[p.pathCells.length - 1].y === y)!;
            const unlocked = playerLevel >= portal.world.levelRequired;
            const completed = portal.world.levels.filter((l) => l.completed).length;
            const c = portal.world.color;
            const hex = WORLD_COLOR_HEX[c];
            return (
              <button
                key={`${x}-${y}`}
                onClick={() => unlocked && onSelect(portal.world.id)}
                disabled={!unlocked}
                style={{
                  ...cellStyle,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: unlocked ? 'pointer' : 'not-allowed',
                  opacity: unlocked ? 1 : 0.35,
                  background: '#0e0f1a',
                  boxShadow: `inset 0 0 0 3px ${hex}, 0 0 12px ${hex}`,
                  border: 'none',
                  padding: 0,
                  color: hex,
                  animation: unlocked ? 'portalPulse 2.6s ease-in-out infinite' : 'none',
                }}
                title={unlocked ? `${portal.world.name} (${completed}/${portal.world.levels.length})` : `Unlocks at Lvl ${portal.world.levelRequired}`}
                onMouseEnter={(e) => { if (unlocked) e.currentTarget.style.transform = 'scale(1.15)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <span
                  style={{
                    fontSize: 20,
                    fontWeight: 'bold',
                    color: hex,
                    textShadow: `0 0 6px ${hex}`,
                  }}
                >
                  {portal.world.icon}
                </span>
              </button>
            );
          }
          // empty
          return (
            <div
              key={`${x}-${y}`}
              style={{
                ...cellStyle,
                background: '#2a2d3a',
                backgroundImage:
                  'radial-gradient(circle, rgba(20,214,232,0.5) 1px, transparent 1px)',
                backgroundSize: '12px 12px',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }}
            />
          );
        }),
      )}
    </div>
    </div>
  );
}
