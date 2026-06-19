import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, type UserAvatar } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { Avatar } from '@/components/Avatar';
import {
  type World,
  type WorldLevel,
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
  const qc = useQueryClient();
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);

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
        <div className="grid grid-cols-[1fr_320px] gap-6">
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
              playerLevel={user.level}
              onSelect={(id) => setSelectedWorldId(id)}
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

            {selectedWorldId ? (
              <SelectedWorldPanel
                worldId={selectedWorldId}
                worlds={worlds ?? []}
                playerLevel={user.level}
                onClose={() => setSelectedWorldId(null)}
              />
            ) : (
              <Panel title="WORLDS" variant="cyan">
                <div className="space-y-2">
                  {portals.map((p) => {
                    const completed = p.world.levels.filter((l) => l.progress?.completed).length;
                    const unlocked = user.level >= p.world.levelRequired;
                    return (
                      <button
                        key={p.world.id}
                        onClick={() => unlocked && setSelectedWorldId(p.world.id)}
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
            )}
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
  playerLevel,
  onSelect,
}: {
  portals: PortalTile[];
  archetype: 'WISP' | 'SPRITE' | 'DRAKE' | 'STRIKER' | 'FORGE' | 'GOLEM' | 'WIRED' | 'BEAR' | 'BEHEMOTH';
  playerLevel: number;
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

  return (
    <div
      className="grid gap-px bg-bg-700 border border-neon-cyan/15"
      style={{
        gridTemplateColumns: `repeat(${MAP_TILES_X}, minmax(0, 1fr))`,
        width: 'fit-content',
        maxWidth: '100%',
        margin: '0 auto',
      }}
    >
      {grid.flatMap((row, y) =>
        row.map((cell, x) => {
          const cellStyle: React.CSSProperties = {
            width: 'clamp(28px, 4.5vw, 48px)',
            height: 'clamp(28px, 4.5vw, 48px)',
            minWidth: 0,
          };
          if (cell.kind === 'home') {
            return (
              <div
                key={`${x}-${y}`}
                className="relative flex items-center justify-center"
                style={{
                  ...cellStyle,
                  background: 'radial-gradient(circle at center, rgba(255,195,77,0.25), rgba(255,195,77,0.05) 60%, transparent 90%)',
                  boxShadow: 'inset 0 0 0 1px rgba(255, 195, 77, 0.5)',
                }}
                title="Home Base"
              >
                <span
                  className="text-base"
                  style={{ color: '#ffc34d', textShadow: '0 0 6px #ffc34d' }}
                >
                  ◉
                </span>
              </div>
            );
          }
          if (cell.kind === 'path') {
            const c = colorByWorld.get(cell.worldId)!;
            const hex = WORLD_COLOR_HEX[c];
            return (
              <div
                key={`${x}-${y}`}
                style={{
                  ...cellStyle,
                  background: `linear-gradient(${hex}44, ${hex}88)`,
                  boxShadow: `inset 0 0 0 1px ${hex}66`,
                }}
              />
            );
          }
          if (cell.kind === 'portal') {
            const portal = portals.find((p) => p.pathCells[p.pathCells.length - 1].x === x && p.pathCells[p.pathCells.length - 1].y === y)!;
            const unlocked = playerLevel >= portal.world.levelRequired;
            const completed = portal.world.levels.filter((l) => l.progress?.completed).length;
            const c = portal.world.color;
            const hex = WORLD_COLOR_HEX[c];
            return (
              <button
                key={`${x}-${y}`}
                onClick={() => onSelect(portal.world.id)}
                disabled={!unlocked}
                className={classNames(
                  'flex items-center justify-center transition-all',
                  unlocked
                    ? 'hover:scale-110 cursor-pointer'
                    : 'opacity-40 cursor-not-allowed',
                )}
                style={{
                  ...cellStyle,
                  background: `radial-gradient(circle at center, ${hex}aa, ${hex}33 50%, transparent 80%)`,
                  boxShadow: unlocked ? `0 0 12px ${hex}, inset 0 0 0 2px ${hex}` : `inset 0 0 0 1px ${hex}55`,
                }}
                title={unlocked ? `${portal.world.name} (${completed}/${portal.world.levels.length})` : `Unlocks at Lvl ${portal.world.levelRequired}`}
              >
                <span
                  className="text-lg font-bold"
                  style={{ color: hex, textShadow: `0 0 6px ${hex}` }}
                >
                  {portal.world.icon}
                </span>
              </button>
            );
          }
          // empty: subtle dot
          return (
            <div
              key={`${x}-${y}`}
              style={{
                ...cellStyle,
                background: 'rgba(20, 25, 35, 0.6)',
                backgroundImage: 'radial-gradient(circle, rgba(20, 214, 232, 0.12) 1px, transparent 1px)',
                backgroundSize: '50% 50%',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }}
            />
          );
        }),
      )}
    </div>
  );
}

function SelectedWorldPanel({
  worldId,
  worlds,
  playerLevel,
  onClose,
}: {
  worldId: string;
  worlds: World[];
  playerLevel: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const world = worlds.find((w) => w.id === worldId);
  if (!world) return null;
  const hex = WORLD_COLOR_HEX[world.color];
  const completed = world.levels.filter((l) => l.progress?.completed).length;
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);

  const attempt = useDelayedMutation<
    { level: WorldLevel; result: { won: boolean; score: number; xpAwarded: number; goldAwarded: number; attempts: number; bestScore: number; completed: boolean } },
    string
  >({
    mutationFn: (levelId: string) =>
      api(`/quest/levels/${levelId}/attempt`, {
        method: 'POST',
        body: { score: 100 },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quest-worlds'] }),
  }, 600);

  return (
    <Panel
      title={world.name.toUpperCase()}
      variant={worldColorToVariant(world.color)}
      action={
        <button onClick={onClose} className="text-ink-300 hover:text-ink-50 text-xs font-mono">
          ← back
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: hex }}>
            {world.theme} · {world.affiliation}
          </div>
          <div className="text-xs text-ink-300 font-mono mt-1 leading-relaxed">{world.description}</div>
        </div>
        <div className="text-[10px] font-mono text-ink-400 tracking-widest">
          {completed}/{world.levels.length} cleared
        </div>
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {world.levels.map((lvl) => {
            const prev = lvl.requiredLevelId
              ? world.levels.find((l) => l.id === lvl.requiredLevelId)
              : null;
            const prevDone = prev ? !!prev.progress?.completed : true;
            const unlocked = playerLevel >= lvl.playerLevelRequired && prevDone;
            const done = !!lvl.progress?.completed;
            return (
              <div
                key={lvl.id}
                className={classNames(
                  'p-2 border transition-all',
                  activeLevelId === lvl.id
                    ? 'border-neon-cyan/60 bg-bg-700'
                    : done
                    ? 'border-neon-amber/40 bg-bg-800/50'
                    : unlocked
                    ? 'border-ink-500 hover:border-neon-cyan/40 cursor-pointer'
                    : 'border-bg-700 opacity-50',
                )}
                onClick={() => unlocked && setActiveLevelId(lvl.id === activeLevelId ? null : lvl.id)}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 grid place-items-center text-xs font-mono border"
                    style={{ borderColor: hex, color: hex }}
                  >
                    {lvl.order}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-ink-50 font-display tracking-wide">{lvl.name}</div>
                    <div className="text-[10px] text-ink-300 font-mono">
                      {lvl.enemy} · diff {lvl.difficulty} · {lvl.xp} XP · {lvl.gold} G
                    </div>
                  </div>
                  {done && <span className="text-neon-amber">✓</span>}
                  {!unlocked && !done && (
                    <span className="text-[10px] text-ink-400 font-mono">🔒</span>
                  )}
                </div>
                {activeLevelId === lvl.id && (
                  <div className="mt-2 pt-2 border-t border-ink-700/50 space-y-2">
                    <p className="text-xs text-ink-200 font-mono leading-relaxed">{lvl.description}</p>
                    {lvl.progress && (
                      <p className="text-[10px] text-ink-400 font-mono">
                        Attempts: {lvl.progress.attempts} · Best: {lvl.progress.bestScore}
                      </p>
                    )}
                    <NeonButton
                      variant={worldColorToVariant(world.color)}
                      loading={attempt.isPending}
                      onClick={() => attempt.run(lvl.id)}
                    >
                      {done ? 'REPLAY' : 'BEGIN'}
                    </NeonButton>
                    {attempt.data && (
                      <p className="text-[10px] font-mono" style={{ color: attempt.data.result.won ? '#9bff5c' : '#f55cc4' }}>
                        {attempt.data.result.won
                          ? `Victory! +${attempt.data.result.xpAwarded} XP, +${attempt.data.result.goldAwarded} G`
                          : 'Defeat. Try again.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
