import { useEffect } from 'react';
import { ConstellationMap } from './ConstellationMap';
import type { ConstellationMapProps } from './ConstellationMap';
import { WORLD_COLOR_HEX, type World, type WorldColor } from '@/lib/quest';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { getFrameArchetype } from '@/lib/frame';
import { ShieldTier, PenanceEvent } from '@/lib/types';

type HomeBaseData = {
  shield: number;
  tier: string;
  tierLabel: string;
  tierColor: string;
  recentEvents: PenanceEvent[];
};

type BreachProgress = {
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

type BreachBoss = {
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

/**
 * GalaxyMapOverlay — fullscreen overlay around the existing
 * ConstellationMap. Used by both the legacy /quest page and the
 * new homebase "Open Galaxy Map" button.
 *
 * The overlay is a portal-rendered fixed-position div. ESC and
 * backdrop-click both close. Body scroll is locked while open.
 */
export function GalaxyMapOverlay({
  open,
  onClose,
  worlds,
  homeBase,
  onSelectWorld,
}: {
  open: boolean;
  onClose: () => void;
  worlds: World[];
  homeBase?: HomeBaseData | null;
  onSelectWorld: (id: string) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Body scroll lock + ESC handler
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Breach raid data — only fetched when the overlay is open
  const { data: breachData } = useQuery({
    queryKey: ['breach'],
    queryFn: () => api<{ progress: BreachProgress; boss: BreachBoss | null }>('/breach'),
    enabled: open,
  });
  const breachWorldUnlocked = (user?.level ?? 0) >= 12;
  const breachUnlocked = breachData?.progress.status !== 'LOCKED' && breachData?.boss != null;

  if (!open) return null;
  if (!user) return null;

  const archetype = getFrameArchetype(user.heightCm, user.weightKg, user.bodyFatPct) ?? 'SPRITE';
  // The map shows the user's class stripe in the home-base ring.
  // Pick the class-color for the user's selected class.
  const accent = user.class
    ? WORLD_COLOR_HEX[
        // CLASS_META maps classes to their colors; we want the
        // ClassColor type from WORLD_COLOR_HEX. Fall back to cyan.
        ({ JUGGERNAUT: 'red', BERSERKER: 'magenta', PHANTOM: 'lime',
           TRACER: 'orange', SCOUT: 'goldenrod', ORACLE: 'periwinkle' } as Record<string, WorldColor>)[user.class]
        ?? 'cyan'
      ]
    : '#14d6e8';

  // Map shield tier (raw string from API) to the typed enum the
  // map expects. Default to STABLE for the legacy "fallback" path.
  const shieldTierMap: Record<string, ShieldTier> = {
    FORTIFIED: 'FORTIFIED', STABLE: 'STABLE',
    COMPROMISED: 'COMPROMISED', BREACHED: 'BREACHED',
  };
  const shieldTier = homeBase
    ? (shieldTierMap[homeBase.tier] ?? 'STABLE')
    : undefined;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-bg-900/95 backdrop-blur-sm overflow-auto"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 px-3 h-9 text-xs font-mono tracking-widest uppercase border border-ink-500/40 text-ink-200 hover:border-neon-cyan hover:text-neon-cyan bg-bg-800/80"
      >
        ✕ close · esc
      </button>

      {/* Click on the SVG itself doesn't close — only the backdrop */}
      <div
        className="w-full h-full min-h-screen p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <ConstellationMap
          worlds={worlds}
          archetype={archetype}
          playerLevel={user.level ?? 1}
          accentColor={accent}
          classStripe={accent}
          shieldTier={shieldTier}
          shield={homeBase?.shield}
          recentEvents={homeBase?.recentEvents ?? []}
          breach={breachUnlocked && breachData?.boss ? {
            unlocked: true,
            bossName: breachData.boss.name,
            bossHp: breachData.progress.bossHp,
            bossMaxHp: breachData.progress.bossMaxHp,
            status: breachData.progress.status as 'ACTIVE' | 'VICTORY' | 'COOLDOWN',
          } : null}
          onSelect={(id) => {
            onSelectWorld(id);
            onClose();
          }}
          onSelectNexus={(id) => {
            onSelectWorld(id);
            onClose();
          }}
          onSelectHomeBase={() => {
            onClose();
            navigate('/home-base');
          }}
          onSelectBreach={breachWorldUnlocked ? () => {
            onClose();
            navigate('/quest/breach');
          } : undefined}
        />
      </div>
    </div>
  );
}