import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Layout, PageHeader } from './Layout';
import { Panel } from './Panel';
import { NeonButton } from './NeonButton';
import { Modal } from './Modal';
import { GalaxyMapOverlay } from './GalaxyMapOverlay';
import { PortalLeakCard, PortalLeakBody } from './PortalLeakCard';
import { PenanceTemplatesPanel } from './HomeBaseCard';
import type { PenanceEvent } from '@/lib/types';
import type { World } from '@/lib/quest';

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
 * HomeBasePage — the consolidated command center.
 *
 * Layout (top → bottom):
 *   1. PageHeader with title + shield tier subtitle
 *   2. Compact homebase panel (tier, shield bar) + "Open Galaxy Map"
 *      button + Breach indicator (top-right)
 *   3. Active leak (only renders when shield is below threshold)
 *   4. Penance templates list
 *
 * The constellation map is NOT rendered inline. It's opened as a
 * fullscreen overlay via the "Open Galaxy Map" button.
 *
 * Leaks are inline on this page (not a separate /portal-leak route).
 * Clicking the leak card opens a modal with the full fight UI.
 *
 * Breach appears as a small indicator top-right of the homebase panel.
 *   - Before unlock (level < 12): tiny dot with "?" hint
 *   - After unlock: small black hole with subtle pulse, clickable
 *     to enter the Breach world
 */
export function HomeBasePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mapOpen, setMapOpen] = useState(false);
  const [leakModalOpen, setLeakModalOpen] = useState(false);

  const homeQ = useQuery({
    queryKey: ['home-base'],
    queryFn: () => api<HomeBaseData>('/home-base'),
  });
  const worldsQ = useQuery({
    queryKey: ['quest-worlds'],
    queryFn: () => api<World[]>('/quest/worlds'),
  });
  const breachWorldUnlocked = (user?.level ?? 0) >= 12;
  const breachQ = useQuery({
    queryKey: ['breach'],
    queryFn: () => api<{ progress: BreachProgress; boss: BreachBoss | null }>('/breach'),
    enabled: breachWorldUnlocked,
  });
  const leakQ = useQuery({
    queryKey: ['portal-leak'],
    queryFn: () => api<{ leak: { id: string; status: string; monsterName: string; monsterEmoji: string; monsterColor: string; hp: number; maxHp: number } | null; recent: unknown[] }>('/portal-leak'),
    refetchInterval: 60_000,
  });
  const leak = leakQ.data?.leak ?? null;
  const breachProgress = breachQ.data?.progress;
  const breachBoss = breachQ.data?.boss;
  const breachUnlockedAndActive = breachWorldUnlocked && breachBoss && breachProgress?.status !== 'LOCKED';

  return (
    <div className="space-y-4">
      <Panel
        title="HOME BASE"
        variant="cyan"
        action={
          <NeonButton
            size="sm"
            variant="cyan"
            icon="◇"
            onClick={() => setMapOpen(true)}
          >
            Open Galaxy Map
          </NeonButton>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tier + shield summary */}
          <div className="md:col-span-2">
            {homeQ.data ? (
              <>
                <div className="flex items-baseline gap-4 mb-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                      Tier
                    </div>
                    <div
                      className="text-2xl font-display tracking-widest"
                      style={{ color: homeQ.data.tierColor }}
                    >
                      {homeQ.data.tierLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400">
                      Shield
                    </div>
                    <div className="text-2xl font-display tabular-nums text-slate-100">
                      {homeQ.data.shield}
                      <span className="text-[10px] text-ink-500 ml-1">/ 100</span>
                    </div>
                  </div>
                </div>
                <div className="relative h-3 rounded bg-bg-900 border border-ink-700/40 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, homeQ.data.shield))}%`,
                      backgroundColor: homeQ.data.tierColor,
                    }}
                  />
                </div>
                {homeQ.data.recentEvents?.[0] && (
                  <div className="text-[10px] font-mono text-ink-400 mt-1.5 truncate">
                    Last: {homeQ.data.recentEvents[0].label}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] font-mono text-ink-400">loading…</div>
            )}
          </div>

          {/* Breach indicator — small inline widget top-right */}
          <div className="md:col-span-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                if (breachWorldUnlocked) navigate('/quest/breach');
              }}
              disabled={!breachWorldUnlocked}
              className={`relative w-24 h-24 rounded-full border ${
                breachWorldUnlocked
                  ? 'border-violet-400/60 cursor-pointer hover:border-violet-300'
                  : 'border-ink-700/40 cursor-not-allowed'
              }`}
              title={breachWorldUnlocked ? 'The Breach — open the world' : 'Locked · reaches L12'}
              style={{
                background: breachWorldUnlocked
                  ? 'radial-gradient(circle, rgba(196, 92, 255, 0.25) 0%, rgba(10, 10, 15, 1) 70%)'
                  : 'rgba(10, 10, 15, 0.6)',
                boxShadow: breachWorldUnlocked
                  ? '0 0 24px rgba(196, 92, 255, 0.4)'
                  : 'none',
              }}
            >
              {breachWorldUnlocked ? (
                <>
                  {/* Accretion ring */}
                  <div
                    className="absolute inset-2 rounded-full border border-violet-300/40"
                    style={{
                      animation: 'spin 6s linear infinite',
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-violet-300 text-2xl font-display tracking-widest">✺</div>
                  </div>
                  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono uppercase tracking-widest text-violet-300/80 whitespace-nowrap">
                    The Breach
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-ink-500 text-xl font-display">?</span>
                </div>
              )}
            </button>
          </div>
        </div>
      </Panel>

      {/* Active leak (only renders when there's a leak) */}
      {leak && leak.status === 'ACTIVE' && (
        <div onClick={() => setLeakModalOpen(true)}>
          <PortalLeakCard />
          <div className="text-[10px] font-mono text-ink-400 text-center mt-1">
            (click to open fight modal)
          </div>
        </div>
      )}

      {/* Penance templates */}
      <PenanceTemplatesPanel />

      {/* Fullscreen galaxy map overlay */}
      <GalaxyMapOverlay
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        worlds={worldsQ.data ?? []}
        homeBase={homeQ.data ?? null}
        onSelectWorld={(id) => navigate(`/quest/${id}`)}
      />

      {/* Leak fight modal */}
      {leak && leak.status === 'ACTIVE' && (
        <Modal
          open={leakModalOpen}
          onClose={() => setLeakModalOpen(false)}
          title={
            <div className="flex items-center gap-2">
              <span style={{ color: leak.monsterColor }}>{leak.monsterEmoji}</span>
              <span>{leak.monsterName}</span>
            </div>
          }
          width="max-w-3xl"
        >
          <PortalLeakBody
            leak={{
              id: leak.id,
              userId: user?.id ?? '',
              monsterName: leak.monsterName,
              monsterEmoji: leak.monsterEmoji,
              monsterColor: leak.monsterColor,
              intro: '',
              preferredTags: [],
              bonusTags: [],
              hp: leak.hp,
              maxHp: leak.maxHp,
              status: 'ACTIVE',
              spawnedAt: new Date().toISOString(),
              resolvedAt: null,
              itemDrop: null,
              resolvedReason: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }}
            pct={Math.max(0, Math.min(100, (leak.hp / leak.maxHp) * 100))}
            recent={[]}
          />
        </Modal>
      )}
    </div>
  );
}

export function HomeBaseFullPage() {
  return (
    <Layout>
      <PageHeader
        title="// Home base"
        subtitle="The shield that protects your engagement. Compromise it and the breach escalates."
      />
      <HomeBasePage />
    </Layout>
  );
}