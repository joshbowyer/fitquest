import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

/**
 * Reward event bus. A tiny pub-sub for "things just happened that
 * deserve a celebratory animation": XP gained, level up, raid damage
 * dealt, achievement unlocked, loot dropped.
 *
 * Architecture: a single React context exposes `emit` (called from
 * the page after a successful action) and `subscribe` (used by the
 * global <RewardOverlay />). Events carry enough metadata to drive
 * their own animation — the overlay just renders whatever's in the
 * queue and removes items when their animation completes.
 *
 * The bus is intentionally simple. No batching, no persistence — if
 * the user reloads mid-celebration, the toast just disappears. That's
 * fine; reloads are rare and the reward still landed.
 */

export type XpEvent = {
  kind: 'xp';
  id: string;
  amount: number;
  /// Source label, e.g. "workout" or "raid victory".
  source: string;
  /// Optional anchor — the click target can pass a DOM element and
  /// the floater spawns near it (instead of center-screen).
  anchor?: { x: number; y: number };
};

export type LevelUpEvent = {
  kind: 'levelUp';
  id: string;
  level: number;
  previousLevel: number;
};

export type RaidDamageEvent = {
  kind: 'raidDamage';
  id: string;
  damage: number;
  bossName?: string;
  /// Anchor is the boss card's DOM rect; the floater pops out of it.
  anchor?: { x: number; y: number };
};

export type AchievementEvent = {
  kind: 'achievement';
  id: string;
  name: string;
  description: string;
  points: number;
  glyph?: string | null;
};

export type LootEvent = {
  kind: 'loot';
  id: string;
  itemName: string;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
};

export type RewardEvent = XpEvent | LevelUpEvent | RaidDamageEvent | AchievementEvent | LootEvent;

type Listener = (e: RewardEvent) => void;

let _listeners: Listener[] = [];

export function emitReward(e: RewardEvent) {
  for (const l of _listeners) l(e);
}

/// React-friendly subscription that auto-unmounts on cleanup.
export function useRewardSubscription(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const wrapped = (e: RewardEvent) => ref.current(e);
    _listeners.push(wrapped);
    return () => {
      _listeners = _listeners.filter((l) => l !== wrapped);
    };
  }, []);
}

/**
 * Global reward overlay. Mount once near the app root. Renders all
 * live reward events as floating particles / pulses, auto-removing
 * each one when its animation finishes.
 *
 * The overlay uses CSS animations + portal so the particles can sit
 * above the entire app without z-index gymnastics. Animation timing
 * is encoded in `getDuration()` so the React tree doesn't fight the
 * CSS — the JS just holds the array of "live" events.
 */
export function RewardOverlay() {
  const [events, setEvents] = useState<RewardEvent[]>([]);

  const remove = useCallback((id: string) => {
    setEvents((cur) => cur.filter((e) => e.id !== id));
  }, []);

  useRewardSubscription((e) => {
    setEvents((cur) => [...cur, e]);
    // Auto-remove after the animation duration. We add a small
    // buffer so the animation fully completes before unmount.
    const dur = getDuration(e) + 200;
    setTimeout(() => remove(e.id), dur);
  });

  return (
    <div className="reward-overlay pointer-events-none fixed inset-0 z-[100]">
      {/* Level-up pulse — full-screen glow + centred level number.
          Rendered outside the floating particle container so it can
          sit above everything. */}
      {events.filter((e) => e.kind === 'levelUp').map((e) => (
        <LevelUpPulse key={e.id} event={e} />
      ))}
      {/* Achievement toast — bottom-right slide-in */}
      {events.filter((e) => e.kind === 'achievement').map((e) => (
        <AchievementToast key={e.id} event={e} />
      ))}
      {/* Loot pop — centre-right floating */}
      {events.filter((e) => e.kind === 'loot').map((e) => (
        <LootPop key={e.id} event={e} />
      ))}
      {/* XP + raid-damage floats — anchored to the caller if they
          passed one, otherwise centred. */}
      {events
        .filter((e) => e.kind === 'xp' || e.kind === 'raidDamage')
        .map((e) => (
          <Floater key={e.id} event={e} />
        ))}
    </div>
  );
}

function getDuration(e: RewardEvent): number {
  switch (e.kind) {
    case 'xp': return 1400;
    case 'raidDamage': return 1600;
    case 'levelUp': return 2400;
    case 'achievement': return 4200;
    case 'loot': return 2400;
  }
}

function Floater({ event }: { event: XpEvent | RaidDamageEvent }) {
  const isXp = event.kind === 'xp';
  const text = isXp ? `+${event.amount} XP` : `-${event.damage} dmg`;
  const color = isXp ? '#9bff5c' : '#ff5cff';
  const anchor = (event as { anchor?: { x: number; y: number } }).anchor;
  const style: React.CSSProperties = anchor
    ? { left: anchor.x, top: anchor.y, position: 'absolute' }
    : { left: '50%', top: '40%', position: 'absolute', transform: 'translate(-50%, -50%)' };
  return (
    <div
      style={style}
      className="reward-floater"
    >
      <span
        style={{
          color,
          textShadow: `0 0 12px ${color}, 0 0 24px ${color}`,
          fontFamily: 'Orbitron, sans-serif',
          fontSize: '1.4rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
        }}
      >
        {text}
      </span>
    </div>
  );
}

function LevelUpPulse({ event }: { event: LevelUpEvent }) {
  return (
    <div className="reward-levelup fixed inset-0 flex items-center justify-center">
      <div className="levelup-ring absolute inset-0" />
      <div className="levelup-flash absolute inset-0" />
      <div className="relative text-center">
        <div className="text-[10px] font-display tracking-[0.5em] text-neon-cyan mb-2">
          LEVEL UP
        </div>
        <div className="font-display text-[8rem] leading-none neon-text-cyan levelup-number">
          {event.level}
        </div>
      </div>
    </div>
  );
}

function AchievementToast({ event }: { event: AchievementEvent }) {
  return (
    <div className="reward-achievement fixed bottom-4 right-4 max-w-xs">
      <div className="border border-neon-amber/60 bg-bg-900/90 backdrop-blur-md p-3 shadow-neon-amber/40">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">{event.glyph || '★'}</span>
          <span className="font-display text-sm uppercase tracking-widest text-neon-amber">
            Achievement
          </span>
        </div>
        <div className="font-display text-base neon-text-amber">{event.name}</div>
        <div className="text-[11px] font-mono text-ink-300 leading-snug mt-1">
          {event.description}
        </div>
        <div className="text-[10px] font-mono text-ink-400 mt-1">
          +{event.points} pts
        </div>
      </div>
    </div>
  );
}

function LootPop({ event }: { event: LootEvent }) {
  const rarity = event.rarity;
  const color = {
    COMMON: '#94a3b8',
    UNCOMMON: '#9bff5c',
    RARE: '#14d6e8',
    EPIC: '#ff5cff',
    LEGENDARY: '#ffc34d',
    MYTHIC: '#ff2bd6',
  }[rarity];
  return (
    <div className="reward-loot fixed bottom-4 right-1/2 translate-x-1/2">
      <div
        className="border-2 px-4 py-2 bg-bg-900/90 backdrop-blur-md"
        style={{ borderColor: color, boxShadow: `0 0 16px ${color}` }}
      >
        <div className="text-[10px] font-display tracking-[0.4em] uppercase mb-0.5" style={{ color }}>
          {rarity} drop
        </div>
        <div className="font-display text-base neon-text-cyan">{event.itemName}</div>
      </div>
    </div>
  );
}

/// Stable id generator that doesn't pull in nanoid. The risk of
/// collision is negligible because each emit call site generates
/// one id per user action.
let _idSeq = 0;
export function nextRewardId(prefix: string): string {
  _idSeq += 1;
  return `${prefix}-${Date.now()}-${_idSeq}`;
}