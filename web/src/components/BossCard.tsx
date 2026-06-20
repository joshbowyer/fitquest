import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { useDelayedMutation } from '@/hooks/useDelayedMutation';
import { WORLD_COLOR_HEX } from '@/lib/quest';
import { classNames } from '@/lib/format';

type Boss = {
  id: string;
  worldId: string;
  bossName: string;
  bossGlyph: string;
  bossHp: number;
  bossMaxHp: number;
  status: 'LOCKED' | 'ACTIVE' | 'DEFEATED';
  unlockedAt: string | null;
  defeatedAt: string | null;
};

type Props = {
  worldId: string;
  bossName: string;
  bossGlyph: string;
  worldColor: keyof typeof WORLD_COLOR_HEX;
  allCleared: boolean;
};

export function BossCard({ worldId, bossName, bossGlyph, worldColor, allCleared }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['bosses'],
    queryFn: () => api<{ bosses: Boss[] }>('/bosses'),
  });

  const boss = data?.bosses.find((b) => b.worldId === worldId) ?? null;
  const hex = WORLD_COLOR_HEX[worldColor];

  // Damage presets the user can pick
  const DAMAGE_PRESETS = [50, 100, 250, 500];

  const dealDamage = useDelayedMutation<
    { boss: Boss; actualDamage: number; rewards: { xp: number; gold: number; soulstones: number } | null },
    number
  >({
    mutationFn: (dmg) =>
      api(`/bosses/${worldId}/damage`, {
        method: 'POST',
        body: { damage: dmg },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bosses'] });
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  }, 600);

  if (!allCleared) {
    return (
      <Panel title="Boss (locked)" variant="cyan">
        <div className="text-center py-3">
          <div className="text-3xl text-ink-700 mb-2" style={{ textShadow: '0 0 6px rgba(255,255,255,0.1)' }}>
            🔒
          </div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Boss locked
          </div>
          <div className="text-[10px] font-mono text-ink-500">
            Clear all 5 levels in this world to unlock{' '}
            <span className="text-ink-50">{bossName}</span>.
          </div>
        </div>
      </Panel>
    );
  }

  if (isLoading) {
    return (
      <Panel title="Boss" variant="amber">
        <div className="text-[10px] font-mono text-ink-300">loading…</div>
      </Panel>
    );
  }

  if (!boss) {
    return (
      <Panel title="Boss" variant="amber">
        <div className="text-[10px] font-mono text-ink-300">boss not found</div>
      </Panel>
    );
  }

  if (boss.status === 'DEFEATED') {
    return (
      <Panel
        title="Boss — DEFEATED"
        variant="amber"
        action={<span className="text-base">🏆</span>}
      >
        <div className="text-center py-2">
          <div className="text-3xl mb-1" style={{ color: '#ffc34d', textShadow: '0 0 12px #ffc34d' }}>
            {bossGlyph}
          </div>
          <div className="font-display tracking-widest neon-text-amber text-lg uppercase">
            {boss.bossName}
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-1">
            Defeated {boss.defeatedAt && new Date(boss.defeatedAt).toLocaleDateString()}
          </div>
        </div>
      </Panel>
    );
  }

  // ACTIVE
  const pct = boss.bossHp / boss.bossMaxHp;
  const damageDealt = boss.bossMaxHp - boss.bossHp;

  return (
    <Panel
      title={`Boss — ${boss.bossName}`}
      variant="magenta"
      action={
        <span className="text-[10px] font-mono text-ink-300">
          {damageDealt}/{boss.bossMaxHp} dealt
        </span>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <div
            className="w-20 h-20 grid place-items-center text-4xl border-2 shrink-0"
            style={{
              borderColor: hex,
              color: hex,
              textShadow: `0 0 16px ${hex}`,
              background: `radial-gradient(circle at center, ${hex}33, transparent 70%)`,
            }}
          >
            {bossGlyph}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display tracking-widest text-base neon-text-magenta">
              {boss.bossName}
            </div>
            <div className="text-[10px] font-mono text-ink-400 mt-1">
              HP {boss.bossHp.toLocaleString()} / {boss.bossMaxHp.toLocaleString()}
            </div>
          </div>
        </div>

        {/* HP bar */}
        <div>
          <div className="h-3 bg-bg-700 border border-ink-500/30">
            <div
              className="h-full transition-all"
              style={{
                width: `${pct * 100}%`,
                background: hex,
                boxShadow: `0 0 8px ${hex}`,
              }}
            />
          </div>
          <div className="text-[10px] font-mono text-ink-400 mt-1 text-right">
            {Math.round(pct * 100)}% remaining
          </div>
        </div>

        {/* Damage buttons */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-2">
            Deal damage
          </div>
          <div className="flex flex-wrap gap-2">
            {DAMAGE_PRESETS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  dealDamage.run(d);
                }}
                disabled={dealDamage.isPending}
                className={classNames(
                  'px-3 h-10 text-xs font-mono border transition-all',
                  'border-ink-500/40 text-ink-200 hover:border-neon-magenta hover:text-neon-magenta',
                  dealDamage.isPending && 'opacity-50 cursor-not-allowed',
                )}
              >
                ⚔ {d}
              </button>
            ))}
          </div>
        </div>

        {dealDamage.data?.rewards && (
          <div className="border border-neon-amber/60 bg-neon-amber/10 p-3 text-center">
            <div className="font-display tracking-widest neon-text-amber text-lg">
              🏆 DEFEATED
            </div>
            <div className="text-[11px] font-mono mt-1 space-x-3">
              <span className="text-neon-cyan">+{dealDamage.data.rewards.xp} XP</span>
              <span className="text-neon-amber">+{dealDamage.data.rewards.gold} G</span>
              <span className="text-neon-lime">+{dealDamage.data.rewards.soulstones} ◆</span>
            </div>
          </div>
        )}

        {dealDamage.data && !dealDamage.data.rewards && (
          <div className="text-[10px] font-mono text-neon-amber">
            Dealt {dealDamage.data.actualDamage} damage.
          </div>
        )}
      </div>
    </Panel>
  );
}