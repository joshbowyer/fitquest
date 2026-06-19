import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { NeonButton } from '@/components/NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { Avatar } from '@/components/Avatar';
import {
  type World,
  type WorldLevel,
  WORLD_COLOR_HEX,
} from '@/lib/quest';
import { getFrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { classNames } from '@/lib/format';

/**
 * /quest/:worldId  → world landing page (level list)
 * /quest/:worldId/:levelId → single level detail with enemy + attempt
 */
export function QuestWorldPage() {
  const { worldId, levelId } = useParams<{ worldId: string; levelId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: world, isLoading } = useQuery({
    queryKey: ['quest-world', worldId],
    queryFn: () => api<World>(`/quest/worlds/${worldId}`),
    enabled: !!worldId,
  });

  if (isLoading || !user || !world) {
    return (
      <Layout>
        <div className="text-ink-300 font-mono">loading world…</div>
      </Layout>
    );
  }

  const hex = WORLD_COLOR_HEX[world.color];
  const archetype = getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE';
  const meta = ARCHETYPE_META[archetype];
  const completed = world.levels.filter((l) => l.progress?.completed).length;
  const activeLevel = levelId ? world.levels.find((l) => l.id === levelId) : null;

  const attempt = useDelayedMutation<
    { level: WorldLevel; result: { won: boolean; score: number; xpAwarded: number; goldAwarded: number; attempts: number; bestScore: number; completed: boolean } },
    string
  >({
    mutationFn: (lid: string) =>
      api(`/quest/levels/${lid}/attempt`, { method: 'POST', body: { score: 100 } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quest-worlds'] });
      qc.invalidateQueries({ queryKey: ['quest-world'] });
    },
  }, 600);

  return (
    <Layout>
      <PageHeader
        title={world.name}
        subtitle={
          <span className="flex items-center gap-3">
            <Link to="/quest" className="text-neon-cyan hover:underline">← overworld</Link>
            <span style={{ color: hex }}>{world.theme}</span>
            <span className="text-ink-400">·</span>
            <span className="text-ink-400">{completed}/{world.levels.length} cleared</span>
          </span>
        }
      />

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          {/* World flavor */}
          <Panel title={world.affiliation} variant={worldColorToVariant(world.color)}>
            <p className="text-xs text-ink-200 font-mono leading-relaxed">{world.description}</p>
          </Panel>

          {activeLevel ? (
            <LevelDetail
              world={world}
              level={activeLevel}
              onAttempt={(lid) => attempt.run(lid)}
              attemptPending={attempt.isPending}
              attemptResult={attempt.data}
            />
          ) : (
            <Panel title="Levels" variant={worldColorToVariant(world.color)}>
              <div className="space-y-2">
                {world.levels.map((lvl) => {
                  const prev = lvl.requiredLevelId
                    ? world.levels.find((l) => l.id === lvl.requiredLevelId)
                    : null;
                  const prevDone = prev ? !!prev.progress?.completed : true;
                  const unlocked = user.level >= lvl.playerLevelRequired && prevDone;
                  const done = !!lvl.progress?.completed;
                  return (
                    <button
                      key={lvl.id}
                      onClick={() => unlocked && navigate(`/quest/${world.id}/${lvl.id}`)}
                      disabled={!unlocked}
                      className={classNames(
                        'w-full text-left p-3 border transition-all',
                        done
                          ? 'border-neon-amber/40 bg-bg-800/50 hover:border-neon-amber'
                          : unlocked
                          ? 'border-ink-500 hover:border-neon-cyan/60 hover:bg-bg-700 cursor-pointer'
                          : 'border-bg-700 opacity-40 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 grid place-items-center font-display text-base border-2"
                          style={{ borderColor: hex, color: hex, textShadow: `0 0 6px ${hex}` }}
                        >
                          {String(lvl.order).padStart(2, '0')}
                        </div>
                        <div className="flex-1">
                          <div className="text-base text-ink-50 font-display tracking-wide">
                            {lvl.name}
                          </div>
                          <div className="text-[10px] text-ink-300 font-mono mt-1">
                            {lvl.enemy} · diff {lvl.difficulty} ·{' '}
                            <span style={{ color: hex }}>+{lvl.xp} XP</span>
                            {' · '}
                            <span className="text-neon-amber">+{lvl.gold} G</span>
                          </div>
                        </div>
                        <div className="text-2xl" style={{ color: hex, textShadow: `0 0 8px ${hex}` }}>
                          {lvl.enemyGlyph}
                        </div>
                        {done && <span className="text-neon-amber text-xl">✓</span>}
                        {!unlocked && !done && <span className="text-ink-400">🔒</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>

        {/* Sidebar: player avatar + completion status */}
        <div className="space-y-4">
          <Panel title="YOU" variant="amber">
            <div className="flex items-center gap-3">
              <Avatar
                archetype={archetype}
                accentColor={user.class ? WORLD_COLOR_HEX[primaryColorForClass(user.class)] : '#14d6e8'}
                size={80}
              />
              <div className="text-xs font-mono leading-relaxed">
                <div className="text-ink-50 font-display tracking-widest">{user.username}</div>
                <div className="text-ink-300">Lvl {user.level}</div>
                <div className="text-ink-400 text-[10px] mt-1">
                  {meta.label} · {meta.tagline}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="REWARDS" variant="cyan">
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-ink-300">Remaining XP</span>
                <span className="text-neon-cyan">
                  +{world.levels.filter((l) => !l.progress?.completed).reduce((s, l) => s + l.xp, 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-300">Remaining Gold</span>
                <span className="text-neon-amber">
                  +{world.levels.filter((l) => !l.progress?.completed).reduce((s, l) => s + l.gold, 0)}
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}

function LevelDetail({
  world,
  level,
  onAttempt,
  attemptPending,
  attemptResult,
}: {
  world: World;
  level: WorldLevel;
  onAttempt: (levelId: string) => void;
  attemptPending: boolean;
  attemptResult: { level: WorldLevel; result: { won: boolean; score: number; xpAwarded: number; goldAwarded: number; attempts: number; bestScore: number; completed: boolean } } | undefined;
}) {
  const hex = WORLD_COLOR_HEX[world.color];
  const done = !!level.progress?.completed;
  return (
    <Panel title={level.name} variant={worldColorToVariant(world.color)}>
      <div className="space-y-4">
        {/* Enemy encounter */}
        <div className="flex items-center gap-4">
          <div
            className="w-20 h-20 grid place-items-center text-5xl border-2"
            style={{
              borderColor: hex,
              color: hex,
              textShadow: `0 0 16px ${hex}`,
              background: `radial-gradient(circle at center, ${hex}22, transparent 70%)`,
            }}
          >
            {level.enemyGlyph}
          </div>
          <div className="flex-1">
            <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
              Encounter
            </div>
            <div className="text-xl text-ink-50 font-display tracking-wide">
              {level.enemy}
            </div>
            <div className="text-[10px] font-mono text-ink-400 mt-1">
              Difficulty {level.difficulty} · Level {level.order}
            </div>
          </div>
        </div>

        {/* Flavor text */}
        <blockquote
          className="border-l-2 pl-3 italic text-sm font-mono leading-relaxed"
          style={{ borderColor: hex, color: '#d0d0db' }}
        >
          {level.description}
        </blockquote>

        {/* Rewards */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="border border-ink-700/50 p-2">
            <div className="text-ink-400 text-[10px] uppercase tracking-widest">XP Reward</div>
            <div className="text-lg text-neon-cyan font-display">+{level.xp}</div>
          </div>
          <div className="border border-ink-700/50 p-2">
            <div className="text-ink-400 text-[10px] uppercase tracking-widest">Gold Reward</div>
            <div className="text-lg text-neon-amber font-display">+{level.gold}</div>
          </div>
        </div>

        {/* Progress */}
        {level.progress && (
          <div className="text-[10px] font-mono text-ink-300">
            <div>Attempts: <span className="text-ink-50">{level.progress.attempts}</span></div>
            <div>Best score: <span className="text-ink-50">{level.progress.bestScore}</span></div>
            {level.progress.completedAt && (
              <div>Completed: <span className="text-ink-50">{new Date(level.progress.completedAt).toLocaleDateString()}</span></div>
            )}
          </div>
        )}

        {/* Action */}
        <div className="flex items-center gap-3">
          <NeonButton
            variant={worldColorToVariant(world.color)}
            loading={attemptPending}
            onClick={() => onAttempt(level.id)}
          >
            {done ? 'REPLAY' : 'BEGIN'}
          </NeonButton>
          {attemptResult && (
            <div
              className="text-sm font-display tracking-widest"
              style={{
                color: attemptResult.result.won ? '#9bff5c' : '#f55cc4',
                textShadow: attemptResult.result.won ? '0 0 8px #9bff5c' : '0 0 8px #f55cc4',
              }}
            >
              {attemptResult.result.won
                ? `VICTORY · +${attemptResult.result.xpAwarded} XP · +${attemptResult.result.goldAwarded} G`
                : 'DEFEAT'}
            </div>
          )}
        </div>
      </div>
    </Panel>
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
