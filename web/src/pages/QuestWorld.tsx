import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { EquippedAvatar as Avatar } from '@/components/EquippedAvatar';
import { BossCard } from '@/components/BossCard';
import { BossUnlockModal, useBossUnlock } from '@/components/BossUnlockModal';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import {
  type World,
  type WorldLevel,
  WORLD_COLOR_HEX,
  type RequirementProgress,
  primaryColorForClass,
} from '@/lib/quest';
import { getFrameArchetype, ARCHETYPE_META } from '@/lib/frame';
import { classNames } from '@/lib/format';

/**
 * /quest/:worldId  → world landing page (level list)
 * /quest/:worldId/:levelId → single level detail (progress against threshold)
 *
 * Levels are auto-completed when their threshold is met by logged
 * data — no BEGIN button needed. The user can manually re-trigger
 * the check via the "Re-check" button if they've just logged a
 * workout/sleep log that might cross a threshold.
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

  const recheck = useDelayedMutation<{ results: unknown[] }, void>({
    mutationFn: () =>
      api(`/quest/check`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quest-worlds'] });
      qc.invalidateQueries({ queryKey: ['quest-world'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  }, 800);

  // One-time unlock celebration when all 5 levels are first cleared.
  // Called BEFORE the early-return below so the hooks order is
  // stable across renders (Rules of Hooks). `useBossUnlock` only
  // reads worldId + allCleared; both are defined here.
  const allLevelsCompleted =
    !!world && world.levels.length > 0 && world.levels.every((l) => l.completed);
  const unlock = useBossUnlock(worldId ?? '', allLevelsCompleted);

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
  const completed = world.levels.filter((l) => l.completed).length;
  const activeLevel = levelId ? world.levels.find((l) => l.id === levelId) : null;

  return (
    <Layout>
      <PageHeader
        title={world.name}
        subtitle={
          <span className="flex items-center gap-3 flex-wrap">
            <Link to="/quest" className="text-neon-cyan hover:underline">← overworld</Link>
            <span style={{ color: hex }}>{world.theme}</span>
            <span className="text-ink-400">·</span>
            <span className="text-ink-400">{completed}/{world.levels.length} cleared</span>
            <button
              onClick={() => recheck.run()}
              disabled={recheck.isPending}
              className="text-[10px] font-mono text-neon-cyan hover:underline ml-auto"
            >
              {recheck.isPending ? '⟳ checking…' : '⟳ re-check thresholds'}
            </button>
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
        <div className="space-y-4">
          {/* Class portrait — shows the user's current class at a
              glance. New sprite set sits in /sprites/class-portraits/.
              Sits above the world description so the relationship
              between class + world is obvious. */}
          {user.class && (
            <Panel title="Your class" variant={worldColorToVariant(world.color)}>
              <div className="flex items-center gap-4">
                <img
                  src={`/sprites/class-portraits/${user.class.toLowerCase()}.png`}
                  alt={user.class}
                  width={96}
                  height={96}
                  className="block shrink-0"
                  style={{
                    width: 96,
                    height: 96,
                    filter: `drop-shadow(0 0 8px ${hex}88)`,
                    imageRendering: 'pixelated',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display tracking-widest text-base uppercase">
                    {user.class}
                  </div>
                  <div className="text-[10px] font-mono text-ink-400 mt-0.5">
                    {meta.tagline}
                  </div>
                </div>
              </div>
            </Panel>
          )}
          <Panel title={world.affiliation} variant={worldColorToVariant(world.color)}>
            <p className="text-xs text-ink-200 font-mono leading-relaxed">{world.description}</p>
          </Panel>

          {activeLevel ? (
            <LevelDetail
              world={world}
              level={activeLevel}
            />
          ) : (
            <Panel title="Levels" variant={worldColorToVariant(world.color)}>
              <div className="space-y-2">
                {world.levels.map((lvl) => {
                  const prev = lvl.requiredLevelId
                    ? world.levels.find((l) => l.id === lvl.requiredLevelId)
                    : null;
                  const prevDone = prev ? prev.completed : true;
                  const unlocked = user.level >= lvl.playerLevelRequired && prevDone;
                  return (
                    <button
                      key={lvl.id}
                      onClick={() => unlocked && navigate(`/quest/${world.id}/${lvl.id}`)}
                      disabled={!unlocked}
                      className={classNames(
                        'w-full text-left p-3 border transition-all',
                        lvl.completed
                          ? 'border-neon-amber/40 bg-bg-800/50 hover:border-neon-amber'
                          : unlocked
                          ? 'border-ink-500 hover:border-neon-cyan/40 cursor-pointer'
                          : 'border-bg-700 opacity-40 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 grid place-items-center font-display text-base border-2 shrink-0"
                          style={{ borderColor: hex, color: hex, textShadow: `0 0 6px ${hex}` }}
                        >
                          {String(lvl.order).padStart(2, '0')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="text-base text-ink-50 font-display tracking-wide">
                              {lvl.name}
                            </div>
                            {lvl.completed && <span className="text-neon-amber text-sm">✓</span>}
                            {!unlocked && !lvl.completed && <span className="text-ink-400">🔒</span>}
                          </div>
                          <div className="text-[10px] font-mono text-ink-300 mb-2">
                            <span style={{ color: hex }}>+{lvl.xp} XP</span>
                            <span className="text-ink-500"> · </span>
                            <span className="text-neon-amber">+{lvl.gold} G</span>
                          </div>
                          {/* Threshold progress */}
                          {lvl.progress && unlocked && (
                            <div>
                              <div className="text-[10px] font-mono text-ink-400 leading-relaxed">
                                {lvl.requirementSummary}
                              </div>
                              <ProgressBar progress={lvl.progress} />
                            </div>
                          )}
                        </div>
                        <div className="text-2xl shrink-0" style={{ color: hex, textShadow: `0 0 8px ${hex}` }}>
                          {lvl.enemyGlyph}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="YOU" variant="amber">
            <div className="flex items-center gap-3">
              {/* New Tron-style class portrait from /sprites/class-portraits/.
                  Replaces the layered EquippedAvatar for the YOU panel —
                  the avatar remains in use for the 3D body hologram. */}
              <img
                src={`/sprites/class-portraits/${(user.class || 'PHANTOM').toLowerCase()}.png`}
                alt={user.class || 'no class'}
                width={64}
                height={64}
                className="block shrink-0"
                style={{
                  width: 64,
                  height: 64,
                  filter: `drop-shadow(0 0 8px ${hex}88)`,
                  imageRendering: 'pixelated',
                }}
              />
              <div className="text-xs font-mono">
                <div className="text-ink-50 font-display tracking-widest">{user.username}</div>
                <div className="text-ink-300">Lvl {user.level}</div>
                <div className="text-ink-400 text-[10px] mt-1">
                  {user.class} · {meta.tagline}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="REWARDS" variant="cyan">
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-ink-300">Remaining XP</span>
                <span className="text-neon-cyan">
                  +{world.levels.filter((l) => !l.completed).reduce((s, l) => s + l.xp, 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-300">Remaining Gold</span>
                <span className="text-neon-amber">
                  +{world.levels.filter((l) => !l.completed).reduce((s, l) => s + l.gold, 0)}
                </span>
              </div>
            </div>
          </Panel>

          {/* Boss — unlocks once all 5 levels are cleared. The
              one-time unlock modal fires on the first such view. */}
          <BossCard
            worldId={world.id}
            bossName={world.boss.name}
            bossGlyph={world.boss.glyph}
            bossLore={world.boss.lore}
            worldColor={world.color}
            allCleared={completed === world.levels.length}
          />
          <BossUnlockModal
            worldId={world.id}
            bossName={world.boss.name}
            bossGlyph={world.boss.glyph}
            lore={world.boss.lore}
            color={WORLD_COLOR_HEX[world.color]}
            portraitSrc={`/sprites/bosses/${world.id}.png`}
            open={unlock.shouldShow}
            onClose={unlock.ack}
          />

          <Panel title="HOW IT WORKS" variant="violet">
            <div className="text-[10px] font-mono text-ink-300 leading-relaxed space-y-2">
              <p>
                Each level has a <span className="text-ink-50">threshold</span> — a
                specific achievement you need to hit in your training.
              </p>
              <p>
                Log the relevant workout, sleep, or recovery data and the
                level clears automatically. No more clicking BEGIN.
              </p>
              <p>
                <span className="text-ink-50">Thresholds scale with your
                frame</span> — bodyweight multipliers for lifts, absolute
                times for cardio, day-counts for sleep/recovery.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </Layout>
  );
}

function LevelDetail({ world, level }: { world: World; level: WorldLevel }) {
  const { user } = useAuth();
  const units: 'METRIC' | 'IMPERIAL' = (user?.units === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC');
  const hex = WORLD_COLOR_HEX[world.color];
  return (
    <Panel title={level.name} variant={worldColorToVariant(world.color)}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            className="w-20 h-20 grid place-items-center text-5xl border-2 shrink-0"
            style={{
              borderColor: hex,
              color: hex,
              textShadow: `0 0 16px ${hex}`,
              background: `radial-gradient(circle at center, ${hex}22, transparent 70%)`,
            }}
          >
            {level.enemyGlyph}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest text-ink-300">
              Encounter
            </div>
            <div className="text-xl text-ink-50 font-display tracking-wide">
              {level.enemy}
            </div>
            <div className="text-[10px] font-mono text-ink-400 mt-1">
              Level {level.order}
              {level.completed && level.completedAt && (
                <span> · Cleared {new Date(level.completedAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
          {level.completed && (
            <div className="text-3xl neon-text-amber" style={{ textShadow: '0 0 12px #ffaa3a' }}>
              ✓
            </div>
          )}
        </div>

        <blockquote
          className="border-l-2 pl-3 italic text-sm font-mono leading-relaxed"
          style={{ borderColor: hex, color: '#d0d0db' }}
        >
          {level.description}
        </blockquote>

        {/* Threshold */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
            Requirement
          </div>
          <div
            className="text-sm font-mono p-3 border"
            style={{
              borderColor: hex,
              background: `${hex}11`,
              color: '#fafafd',
            }}
          >
            {level.requirementSummary}
          </div>
          {level.progress && (
            <div className="mt-3">
              <ProgressBar progress={level.progress} large />
              <div className="mt-2 text-[10px] font-mono text-ink-400 leading-relaxed">
                {progressSummary(level.progress, level.requirementSummary, units)}
              </div>
            </div>
          )}
        </div>

        {/* Rewards */}
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="border border-ink-700/50 p-2">
            <div className="text-ink-400 text-[10px] uppercase tracking-widest">XP on Clear</div>
            <div className="text-lg font-display text-neon-cyan">+{level.xp}</div>
          </div>
          <div className="border border-ink-700/50 p-2">
            <div className="text-ink-400 text-[10px] uppercase tracking-widest">Gold on Clear</div>
            <div className="text-lg font-display text-neon-amber">+{level.gold}</div>
          </div>
        </div>

        {level.completed && (
          <div className="border border-neon-amber/40 bg-neon-amber/5 p-3 text-center">
            <div className="font-display tracking-widest neon-text-amber text-lg">CLEARED</div>
            <div className="text-[10px] font-mono text-ink-300 mt-1">
              Level auto-cleared when your data met the threshold.
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ProgressBar({ progress, large = false }: { progress: RequirementProgress; large?: boolean }) {
  const pct = Math.min(1, Math.max(0, progress.pct));
  const pctText = `${Math.round(pct * 100)}%`;
  const color = progress.cleared ? '#ffc34d' : pct > 0.7 ? '#9bff5c' : pct > 0.3 ? '#14d6e8' : '#585868';
  return (
    <div className="flex items-center gap-2">
      <div
        className={classNames('flex-1 bg-bg-700 border border-ink-500/30', large ? 'h-3' : 'h-1.5')}
      >
        <div
          className="h-full transition-all"
          style={{
            width: `${pct * 100}%`,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      </div>
      <span className="text-[10px] font-mono shrink-0" style={{ color }}>
        {pctText}
      </span>
    </div>
  );
}

function progressSummary(p: RequirementProgress, summary: string, units: 'METRIC' | 'IMPERIAL' = 'METRIC'): string {
  if (p.cleared) return `✓ threshold met — ${summary}`;
  if (p.current == null) return `No data yet. Log a relevant workout to start tracking.`;
  return `Progress: ${formatProgress(p.current, p.target, units)} of target. Keep going!`;
}

function formatProgress(current: number, target: number, units: 'METRIC' | 'IMPERIAL' = 'METRIC'): string {
  // If target looks like seconds (> 100), format as time
  if (target >= 60 && target <= 60 * 60 * 4) {
    return `${Math.round(current / 60)}min / ${Math.round(target / 60)}min`;
  }
  // If kg / volume range (use user's unit preference)
  if (target >= 20 && target <= 2000) {
    const u = units === 'IMPERIAL' ? 'lb' : 'kg';
    return `${Math.round(current)}${u} / ${Math.round(target)}${u}`;
  }
  // If reps
  if (target >= 5 && target <= 200) {
    return `${Math.round(current)} / ${Math.round(target)} reps`;
  }
  // If days
  if (target >= 1 && target <= 100) {
    return `${Math.round(current)} / ${Math.round(target)} days`;
  }
  // If meters
  if (target >= 100) {
    return `${Math.round(current)}m / ${Math.round(target)}m`;
  }
  return `${Math.round(current)} / ${Math.round(target)}`;
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