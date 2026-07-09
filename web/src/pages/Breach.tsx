// ============================================================
// Breach page — The Breach boss combat surface
// ============================================================
//
// Shows the current Breach boss, HP bar, recent damage log, and
// skip/claim controls. The boss appears as a black hole with an
// accretion disk; HP is shown as a glowing arc around the hole.
// On kill, surfaces a VICTORY modal with the reward preview + claim.

import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api, postJson } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from '@/components/Layout';
import { Panel } from '@/components/Panel';
import { Modal } from '@/components/Modal';
import { PetCombatCard } from '@/components/PetCombatCard';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useValueChange, emitNotification } from '@/lib/notifyBus';
import { randomUuid } from '@/lib/uuid';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export type BreachBoss = {
  id: string;
  name: string;
  lore: string | null;
  intro: string | null;
  tier: 'MINOR' | 'ELITE' | 'LEGENDARY' | 'APEX';
  difficulty: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  classAffinity: string;
  preferredTags: string[];
  bonusTags: string[];
  spriteEmoji: string;
  spriteColor: string;
};

export type BreachProgress = {
  status: 'LOCKED' | 'ACTIVE' | 'VICTORY' | 'COOLDOWN';
  unlockedAt: string | null;
  bossHp: number;
  bossMaxHp: number;
  damageToday: number;
  damageDayKey: string | null;
  kills: number;
  soulstones: number;
  deaths: number;
  recentBossIds: string[];
  lastDeathAt: string | null;
};

export type BreachRecentDamage = {
  id: string;
  createdAt: string;
  damage: number;
  bossHpAfter: number;
  matchType: string;
  bossName: string;
  bossSprite: string;
  bossColor: string;
};

export type BreachResponse = {
  progress: BreachProgress;
  boss: BreachBoss | null;
  recentDamage: BreachRecentDamage[];
  unlockLevel: number;
  userLevel: number;
  userClass: string;
};

const TIER_LABEL: Record<string, string> = {
  MINOR: 'Minor',
  ELITE: 'Elite',
  LEGENDARY: 'Legendary',
  APEX: 'Apex',
};

const DIFFICULTY_STARS: Record<string, string> = {
  ONE: '★',
  TWO: '★★',
  THREE: '★★★',
  FOUR: '★★★★',
  FIVE: '★★★★★',
};

function classAffinityColor(affinity: string): string {
  switch (affinity) {
    case 'JUGGERNAUT': return '#dc2626';
    case 'BERSERKER': return '#d946ef';
    case 'PHANTOM': return '#a3e635';
    case 'SCOUT': return '#daa520';
    case 'TRACER': return '#fb923c';
    case 'ORACLE': return '#818cf8';
    default: return '#a8a8b8';
  }
}

export function BreachPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['breach'],
    queryFn: () => api<BreachResponse>('/breach'),
    refetchInterval: 30_000,
  });

  // Pet roster — we display the deployed combat pet below the boss
  // HP bar so the user can see their pet's HP during the fight.
  // Refetched alongside the breach query.
  const petQ = useQuery({
    queryKey: ['pet'],
    queryFn: () =>
      api<{ pets: Array<{
        id: string;
        name: string;
        spritePath: string;
        level: number;
        stage: string;
        currentHp: number;
        maxHp: number;
        attack: number;
        deployed: boolean;
        faintedAt: string | null;
        injuredAt: string | null;
      }> }>('/pet'),
    refetchInterval: 30_000,
  });
  const deployedPet = petQ.data?.pets.find((p) => p.deployed) ?? null;

  // Breach-defeat notification. Polled every 30s + on invalidation
  // (which the claim/skip mutations trigger). Fires a system
  // notification when the breach status transitions from ACTIVE
  // to VICTORY or COOLDOWN (i.e. the Maw just died). Also fires
  // bossKill + lootDrop for the "the Maw is down, loot incoming"
  // combo since the breach page already detects this.
  useValueChange(data?.progress.status, (newStatus, oldStatus) => {
    if (oldStatus === 'ACTIVE' && (newStatus === 'VICTORY' || newStatus === 'COOLDOWN')) {
      emitNotification('breachDefeat');
      emitNotification('bossKill');
      emitNotification('lootDrop');
    }
  });

  // NOTE: options object goes straight into useDelayedMutation below.
  // This was previously a standalone useMutation whose RESULT was
  // passed to useDelayedMutation — which reads it as an options bag
  // with no mutationFn, so `run()` rejected with "No mutationFn
  // found" and the claim POST never fired. Claim victory was dead.
  const claimDelayed = useDelayedMutation<{ reward: BreachReward }>({
    mutationFn: () => postJson<{ reward: BreachReward }>('/breach/claim', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach'] });
      queryClient.invalidateQueries({ queryKey: ['users/me'] });
    },
  });

  const skip = useMutation({
    mutationFn: () => postJson<{ nextBoss: { id: string; name: string }; goldLost: number }>('/breach/skip', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breach'] });
      queryClient.invalidateQueries({ queryKey: ['users/me'] });
    },
  });

  // Pull-to-refresh: invalidate the breach query (boss + HP + damage
  // log) and the pet roster (in case the deployed companion's HP
  // changed since the user last opened the page). Placed before
  // the early returns below so the hooks order stays stable across
  // renders (Rules of Hooks).
  const { pulledPx, refreshing } = usePullToRefresh<HTMLDivElement>({
    scrollSelector: 'main',
    onRefresh: () => {
      queryClient.invalidateQueries({ queryKey: ['breach'] });
      queryClient.invalidateQueries({ queryKey: ['pet'] });
    },
  });

  if (isLoading) {
    return (
      <Layout>
        <PageHeader title="The Breach" subtitle="Loading the seal…" />
        <div className="text-center text-ink-300 font-mono text-xs py-12">PROBING THE EVENT HORIZON…</div>
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout>
        <PageHeader title="The Breach" />
        <div className="text-center text-rose-400 font-mono text-xs py-12">
          {(error as Error)?.message ?? 'Failed to reach the Breach.'}
        </div>
      </Layout>
    );
  }

  if (!data || !user) {
    return (
      <Layout>
        <PageHeader title="The Breach" />
        <div className="text-center text-ink-300 font-mono text-xs py-12">NO DATA</div>
      </Layout>
    );
  }

  // ===== LOCKED STATE =====
  if (data.progress.status === 'LOCKED' || !data.boss) {
    const remaining = Math.max(0, data.unlockLevel - data.userLevel);
    return (
      <Layout>
        <PageHeader
          title="The Breach"
          subtitle={`Sealed. Returns at level ${data.unlockLevel}. (Currently ${data.userLevel}.)`}
          action={
            pulledPx > 4 ? (
              <span
                aria-hidden
                className="text-[10px] font-mono uppercase tracking-widest text-ink-300"
              >
                {refreshing
                  ? 'Refreshing…'
                  : pulledPx > 0
                    ? `Release to refresh (${Math.round(pulledPx)}px)`
                    : 'Pull to refresh'}
              </span>
            ) : null
          }
        />
        <div className="space-y-4">
          <Panel title="SEALED" variant="default">
            <div className="flex flex-col items-center gap-6 py-8">
              <ErrorBoundary>
                <BlackHoleSVG size={200} unlocked={false} hp={1} maxHp={1} tier={undefined} animated={false} />
              </ErrorBoundary>
              <div className="text-center space-y-2 max-w-md">
                <p className="text-sm text-ink-200">
                  Somewhere beneath the Nexus, something breathes. You can almost hear it
                  through the floor of your routine.
                </p>
                <p className="text-xs text-ink-400 font-mono">
                  Reach level {data.unlockLevel} to crack the seal. {remaining} level{remaining === 1 ? '' : 's'} to go.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </Layout>
    );
  }

  // ===== UNLOCKED STATE =====
  const { progress, boss } = data;
  const hpRatio = Math.max(0, Math.min(1, progress.bossHp / progress.bossMaxHp));
  const isVictory = progress.status === 'VICTORY';
  const isCooldown = progress.status === 'COOLDOWN';
  const affinityColor = classAffinityColor(boss.classAffinity);
  const tierLabel = TIER_LABEL[boss.tier] ?? boss.tier;
  const stars = DIFFICULTY_STARS[boss.difficulty] ?? '?';

  return (
    <Layout>
      <PageHeader
        title="The Breach"
        subtitle={`Boss #${progress.kills + 1} · ${progress.kills} killed · ${progress.soulstones} ◈ soulstones`}
        action={
          pulledPx > 4 ? (
            <span
              aria-hidden
              className="text-[10px] font-mono uppercase tracking-widest text-ink-300"
            >
              {refreshing
                ? 'Refreshing…'
                : pulledPx > 0
                  ? `Release to refresh (${Math.round(pulledPx)}px)`
                  : 'Pull to refresh'}
            </span>
          ) : null
        }
      />
      <div className="space-y-4">
        {/* Hero: black hole + boss info side by side on desktop, stacked on mobile */}
        <Panel
          title={boss.name.toUpperCase()}
          variant="violet"
          action={
            <span
              className="text-[10px] font-mono uppercase tracking-widest"
              style={{ color: affinityColor }}
            >
              {tierLabel} · {stars}
            </span>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 items-center">
            {/* Black hole visual */}
            <div className="flex justify-center">
              <ErrorBoundary>
                <BlackHoleSVG
                  size={240}
                  unlocked={true}
                  hp={progress.bossHp}
                  maxHp={progress.bossMaxHp}
                  tier={boss.tier}
                  animated={!isVictory && !isCooldown}
                />
              </ErrorBoundary>
            </div>
            {/* Boss info */}
            <div className="space-y-3">
              {boss.intro && (
                <p className="text-sm text-ink-200 italic">"{boss.intro}"</p>
              )}
              {boss.lore && (
                <p className="text-xs text-ink-400">{boss.lore}</p>
              )}
              <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-widest">
                <span
                  className="px-2 py-0.5 rounded border"
                  style={{ borderColor: affinityColor, color: affinityColor }}
                >
                  {boss.classAffinity}
                </span>
                {boss.preferredTags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded bg-bg-800 text-ink-300 border border-bg-700">
                    {tag.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>

              {/* Status banner */}
              {isVictory && (
                <div className="rounded border-2 border-emerald-500 bg-emerald-900/30 px-4 py-3 text-emerald-200 font-mono text-sm uppercase tracking-widest text-center">
                  ⚡ VICTORY ⚡ — claim your drops
                </div>
              )}
              {isCooldown && (
                <div className="rounded border-2 border-rose-700 bg-rose-900/30 px-4 py-3 text-rose-200 font-mono text-sm uppercase tracking-widest text-center">
                  ◈ WOUNDED · {boss.name} regroups
                </div>
              )}

              {/* HP bar */}
              <div>
                <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
                  <span>BOSS HP</span>
                  <span className="text-ink-200">
                    {progress.bossHp.toLocaleString()} / {progress.bossMaxHp.toLocaleString()}
                  </span>
                </div>
                <div className="h-3 bg-bg-800 rounded overflow-hidden border border-bg-700">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${hpRatio * 100}%`,
                      background: `linear-gradient(90deg, ${affinityColor}, ${affinityColor}80)`,
                      boxShadow: `0 0 12px ${affinityColor}80`,
                    }}
                  />
                </div>
                {progress.damageToday > 0 && (
                  <div className="text-[10px] font-mono text-ink-400 mt-1">
                    Damage today: {progress.damageToday.toLocaleString()} (cap {Math.round(progress.bossMaxHp * 1.5).toLocaleString()})
                  </div>
                )}
              </div>

              {/* Pet HP — the deployed pet in this fight. */}
              {deployedPet && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mb-1">
                    Companion · {deployedPet.name}
                  </div>
                  <PetCombatCard pet={deployedPet} />
                </div>
              )}
              {!deployedPet && petQ.data && petQ.data.pets.length > 0 && (
                <Link
                  to="/pet"
                  className="block text-[10px] font-mono uppercase tracking-widest text-ink-400 hover:text-ink-200"
                >
                  No companion deployed. Visit /pet to deploy one →
                </Link>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {isVictory ? (
                  <button
                    onClick={() => claimDelayed.run(undefined as never)}
                    disabled={claimDelayed.isPending}
                    className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs uppercase tracking-widest disabled:opacity-50"
                  >
                    {claimDelayed.isPending ? 'Claiming…' : '⚡ Claim victory'}
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/workouts/new')}
                    className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white font-mono text-xs uppercase tracking-widest"
                  >
                    Train for this boss
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Skip ${boss.name} for 10 gold? The next boss will rotate in.`)) {
                      skip.mutate();
                    }
                  }}
                  disabled={skip.isPending || (user.gold ?? 0) < 10}
                  className="px-4 py-2 rounded border border-bg-600 hover:border-amber-500 text-ink-200 hover:text-amber-400 font-mono text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  Skip · 10 gold
                </button>
              </div>
            </div>
          </div>
        </Panel>

        {/* Damage log */}
        {data.recentDamage.length > 0 && (
          <Panel title="DAMAGE LOG" variant="default">
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {data.recentDamage.map((d) => {
                const color = d.bossColor || '#a8a8b8';
                const sign = d.damage > 0 ? '-' : '+';
                const cls =
                  d.matchType === 'kill' ? 'text-emerald-400 font-bold' :
                  d.matchType === 'mismatched' ? 'text-rose-400' :
                  d.matchType === 'bonus' ? 'text-amber-300' :
                  d.matchType === 'matched' ? 'text-violet-300' :
                  'text-ink-200';
                return (
                  <div key={d.id} className="flex items-baseline justify-between text-xs font-mono py-1 border-b border-bg-700">
                    <div className="flex items-center gap-2">
                      <span style={{ color }}>{d.bossSprite || '◉'}</span>
                      <span className="text-ink-400">
                        {new Date(d.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-ink-500">·</span>
                      <span className="text-ink-300 text-[10px] uppercase">{d.matchType}</span>
                    </div>
                    <span className={cls}>
                      {sign}{Math.abs(d.damage).toLocaleString()}
                      <span className="text-ink-500 text-[10px] ml-2">→ {d.bossHpAfter.toLocaleString()} HP</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>

      {/* Victory modal */}
      {claimDelayed.data && (
        <Modal open={true} onClose={() => { claimDelayed.reset(); }} title="VICTORY">
          <div className="space-y-4">
            <p className="text-sm text-ink-200">
              <span style={{ color: affinityColor }}>{boss.name}</span> has been defeated.
            </p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <div className="text-2xl font-mono text-amber-400">+{claimDelayed.data.reward.gold}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">gold</div>
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-mono text-violet-300">+{claimDelayed.data.reward.soulstones}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">soulstones</div>
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-mono text-emerald-400">+{claimDelayed.data.reward.xp}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">XP</div>
              </div>
            </div>
            {claimDelayed.data.reward.itemTier && (
              <div className="text-center">
                <div className="text-xs text-ink-300 mb-2">ITEM DROP</div>
                <div className="inline-block px-3 py-1 rounded bg-bg-800 border border-bg-700 text-xs font-mono uppercase">
                  {claimDelayed.data.reward.itemTier} item
                </div>
              </div>
            )}
            <button
              onClick={() => { claimDelayed.reset(); }}
              className="w-full px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white font-mono text-xs uppercase tracking-widest"
            >
              Enter the next breach
            </button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

type BreachReward = {
  gold: number;
  soulstones: number;
  xp: number;
  itemTier: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | null;
  itemDropChance: number;
};

// ============================================================
// BlackHoleSVG — event horizon + accretion disk
// ============================================================

function BlackHoleSVG({
  size,
  unlocked,
  hp,
  maxHp,
  tier,
  animated,
}: {
  size: number;
  unlocked: boolean;
  hp: number;
  maxHp: number;
  tier?: string;
  animated: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const horizonR = size * 0.18;
  const diskOuterR = size * 0.42;
  const gradientId = randomUuid();
  const innerGlowId = randomUuid();

  // HP arc: outer ring shows boss HP % remaining. As HP drops
  // the arc shrinks (counterclockwise to feel like "draining").
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const arcR = size * 0.46;
  const arcCircumference = 2 * Math.PI * arcR;
  const dashLength = arcCircumference * ratio;
  const arcColor =
    tier === 'APEX' ? '#fbbf24' :
    tier === 'LEGENDARY' ? '#d946ef' :
    tier === 'ELITE' ? '#a3e635' :
    '#7dd3fc';

  if (!unlocked) {
    // Sealed: faint dark circle, no disk
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <defs>
          <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={diskOuterR} fill={`url(#${gradientId})`} opacity="0.3" />
        <circle cx={cx} cy={cy} r={horizonR} fill="#0e0f1a" stroke="#1f2937" strokeWidth="1" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#475569" fontSize={size * 0.05} fontFamily="monospace" letterSpacing="2">
          SEALED
        </text>
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="1" />
          <stop offset="60%" stopColor="#1a0f1f" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#2c2f3a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={innerGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={arcColor} stopOpacity="0" />
          <stop offset="80%" stopColor={arcColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={arcColor} stopOpacity="0" />
        </radialGradient>
        <filter id={`glow-${gradientId}`}>
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer glow */}
      <circle cx={cx} cy={cy} r={diskOuterR * 1.2} fill={`url(#${innerGlowId})`} />

      {/* Accretion disk — rotates around the hole */}
      <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: 'rotate(0deg)' }}>
        <g transform={`translate(${cx} ${cy})`}>
          <ellipse
            cx="0" cy="0" rx={diskOuterR} ry={diskOuterR * 0.35}
            fill="none"
            stroke={arcColor}
            strokeWidth="1.5"
            strokeOpacity="0.5"
            strokeDasharray="3 6"
            filter={`url(#glow-${gradientId})`}
          >
            {animated && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0"
                to="360"
                dur="18s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
          <ellipse
            cx="0" cy="0" rx={diskOuterR * 0.85} ry={diskOuterR * 0.28}
            fill="none"
            stroke={arcColor}
            strokeWidth="1"
            strokeOpacity="0.7"
            strokeDasharray="2 4"
          >
            {animated && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="360"
                to="0"
                dur="12s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
        </g>
      </g>

      {/* Event horizon */}
      <circle cx={cx} cy={cy} r={horizonR} fill={`url(#${gradientId})`} />

      {/* Photon ring (very thin glow at the horizon edge) */}
      <circle
        cx={cx} cy={cy} r={horizonR}
        fill="none"
        stroke={arcColor}
        strokeWidth="1"
        strokeOpacity="0.9"
        filter={`url(#glow-${gradientId})`}
      />

      {/* HP arc */}
      <circle
        cx={cx} cy={cy} r={arcR}
        fill="none"
        stroke={arcColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${dashLength} ${arcCircumference - dashLength}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeOpacity="0.8"
      />

      {/* BREACH label */}
      <text
        x={cx} y={cy + 4}
        textAnchor="middle"
        fill="#fafafd"
        fontSize={size * 0.045}
        fontFamily="monospace"
        letterSpacing="3"
      >
        BREACH
      </text>

      {/* HP text */}
      <text
        x={cx} y={cy + arcR + size * 0.07}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={size * 0.04}
        fontFamily="monospace"
      >
        {Math.round(ratio * 100)}%
      </text>
    </svg>
  );
}
