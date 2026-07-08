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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          {/* Breach indicator — small inline widget top-right.
              Two distinct visual states:
                - LOCKED: unstable — wavy circle, pulsating, "almost
                  there" feel suggesting the breach is leaking
                  through. 2 rotating sine waves at different speeds
                  create a non-circular wobble.
                - UNLOCKED: full black hole — spinning accretion
                  ring + 2 electron-like orbital arcs + a dark
                  event-horizon disc at center + violet halo. */}
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
              title={breachWorldUnlocked
                ? 'The Breach — open the world'
                : 'The Breach · reaches L12 (locked)'}
              style={{
                background: breachWorldUnlocked
                  ? 'radial-gradient(circle, rgba(196, 92, 255, 0.25) 0%, rgba(10, 10, 15, 1) 70%)'
                  : 'rgba(10, 10, 15, 0.6)',
                boxShadow: breachWorldUnlocked
                  ? '0 0 24px rgba(196, 92, 255, 0.4)'
                  : 'none',
              }}
            >
              {breachWorldUnlocked ? <BreachUnlockedGraphic /> : <BreachLockedGraphic />}

              <div
                className={`absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono uppercase tracking-widest whitespace-nowrap ${
                  breachWorldUnlocked ? 'text-violet-300/80' : 'text-ink-500/60'
                }`}
              >
                {breachWorldUnlocked ? 'The Breach' : 'L12'}
              </div>
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
          hideCloseButton
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

/**
 * BreachLockedGraphic — the Breach is "almost there". A wavy
 * circle suggests it's leaking through: two rotating sine waves
 * at different speeds create a non-circular wobble. The whole
 * shape pulses to convey instability.
 *
 * No real "breach" yet — just the promise of one. 96×96 viewBox
 * so the indicator renders crisp at the 96px button size.
 */
function BreachLockedGraphic() {
  return (
    <svg
      viewBox="0 0 96 96"
      className="absolute inset-0 w-full h-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="breachLockedStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7d7bff" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#c45cff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#7d7bff" stopOpacity="0.6" />
        </linearGradient>
        <filter id="breachLockedBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>

      {/* Outer wavy ring — drawn as a sine-wave path, rotated slowly.
          The path is the path of a circle but each Y is offset by
          a sin(theta) so the shape "breathes". */}
      <g transform="translate(48 48)">
        <path
          fill="none"
          stroke="url(#breachLockedStroke)"
          strokeWidth="1.2"
          filter="url(#breachLockedBlur)"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0"
            to="360"
            dur="14s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="d"
            dur="3.2s"
            repeatCount="indefinite"
            values="
              M 30 0
              C 30 -10, 22 -16, 12 -16
              C 4 -16, -2 -12, -8 -4
              C -14 4, -16 14, -10 22
              C -4 30, 4 32, 12 32
              C 20 32, 28 26, 32 18
              C 36 10, 34 4, 30 0 Z;
              M 30 0
              C 28 -12, 18 -18, 8 -16
              C -2 -14, -10 -8, -14 0
              C -18 8, -14 18, -6 24
              C 2 30, 12 30, 22 26
              C 30 22, 36 14, 34 6
              C 32 0, 30 0, 30 0 Z;
              M 30 0
              C 30 -10, 22 -16, 12 -16
              C 4 -16, -2 -12, -8 -4
              C -14 4, -16 14, -10 22
              C -4 30, 4 32, 12 32
              C 20 32, 28 26, 32 18
              C 36 10, 34 4, 30 0 Z"
          />
        </path>
        {/* A second counter-rotating wave at higher frequency for
            the "wobble" feel. */}
        <path
          fill="none"
          stroke="#9bff5c"
          strokeOpacity="0.25"
          strokeWidth="0.8"
          filter="url(#breachLockedBlur)"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360"
            to="0"
            dur="9s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="d"
            dur="2.4s"
            repeatCount="indefinite"
            values="
              M 24 0
              C 24 -8, 16 -14, 8 -12
              C 0 -10, -6 -4, -8 4
              C -10 12, -4 18, 4 18
              C 12 18, 20 14, 24 8
              C 28 2, 26 0, 24 0 Z;
              M 26 0
              C 24 -10, 14 -14, 4 -12
              C -6 -10, -12 -2, -10 6
              C -8 14, 0 20, 10 18
              C 18 16, 26 10, 28 4
              C 30 0, 28 0, 26 0 Z;
              M 24 0
              C 24 -8, 16 -14, 8 -12
              C 0 -10, -6 -4, -8 4
              C -10 12, -4 18, 4 18
              C 12 18, 20 14, 24 8
              C 28 2, 26 0, 24 0 Z"
          />
        </path>
      </g>

      {/* Pulsating inner glow — the "leak" */}
      <circle cx="48" cy="48" r="14" fill="#7d7bff" fillOpacity="0.15" filter="url(#breachLockedBlur)">
        <animate attributeName="r" values="10;18;10" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="fillOpacity" values="0.25;0.05;0.25" dur="2.6s" repeatCount="indefinite" />
      </circle>

      {/* Tiny "?" floating in the center */}
      <text
        x="48"
        y="55"
        textAnchor="middle"
        fontSize="20"
        fontFamily="monospace"
        fill="#cbd5e1"
        fillOpacity="0.7"
      >
        ?
        <animate attributeName="fillOpacity" values="0.4;0.9;0.4" dur="2.6s" repeatCount="indefinite" />
      </text>
    </svg>
  );
}

/**
 * BreachUnlockedGraphic — full black hole. Three layers:
 *   1. Outer violet halo (radial gradient + slow rotation)
 *   2. Two electron-like orbital arcs at different angles, counter-
 *      rotating — the visual signature of an atom / black hole
 *   3. The dark event-horizon disc at center, with a bright
 *      accretion ring around it
 *   4. A subtle gravity-lens distortion ring
 *
 * Pulsates the radius of the accretion ring so the hole "breathes"
 * as it sucks in light.
 */
function BreachUnlockedGraphic() {
  return (
    <svg
      viewBox="0 0 96 96"
      className="absolute inset-0 w-full h-full"
      aria-hidden
    >
      <defs>
        <radialGradient id="breachUnlockedHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#c45cff" stopOpacity="0.5" />
          <stop offset="60%"  stopColor="#7d7bff" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7d7bff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="breachUnlockedAccretion" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#7d7bff" />
          <stop offset="50%"  stopColor="#fafafd" />
          <stop offset="100%" stopColor="#7d7bff" />
        </linearGradient>
        <filter id="breachUnlockedGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>

      {/* Outer halo — slow rotation, gentle pulse */}
      <g transform="translate(48 48)">
        <circle r="38" fill="url(#breachUnlockedHalo)">
          <animate attributeName="r" values="36;44;36" dur="3.2s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Two electron-like orbital arcs at 0° and 60° tilt, counter-
          rotating. Each is an ellipse with a bright dot at the
          "electron" position. */}
      <g transform="translate(48 48)">
        {/* Orbit 1 — 0° tilt, 32×14 ellipse */}
        <g>
          <ellipse cx="0" cy="0" rx="32" ry="14" fill="none" stroke="#7d7bff" strokeWidth="0.6" strokeOpacity="0.5" strokeDasharray="2 4" />
          <ellipse cx="32" cy="0" rx="3" ry="3" fill="#fafafd" filter="url(#breachUnlockedGlow)">
            <animate attributeName="cx" values="32;-32;32" dur="2.2s" repeatCount="indefinite" />
          </ellipse>
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="6s" repeatCount="indefinite" />
        </g>
        {/* Orbit 2 — 60° tilt, 28×10 ellipse, counter-rotating */}
        <g transform="rotate(60)">
          <ellipse cx="0" cy="0" rx="28" ry="10" fill="none" stroke="#9bff5c" strokeWidth="0.5" strokeOpacity="0.4" strokeDasharray="1 3" />
          <ellipse cx="28" cy="0" rx="2.5" ry="2.5" fill="#fafafd" filter="url(#breachUnlockedGlow)">
            <animate attributeName="cx" values="28;-28;28" dur="1.6s" repeatCount="indefinite" />
          </ellipse>
          <animateTransform attributeName="transform" type="rotate" from="60" to="-300" dur="5s" repeatCount="indefinite" additive="sum" />
        </g>
      </g>

      {/* Event horizon — dark disc, slight glow at the edge */}
      <g transform="translate(48 48)">
        <circle r="20" fill="#0a0a0f">
          <animate attributeName="r" values="19;21;19" dur="2.4s" repeatCount="indefinite" />
        </circle>
        {/* Accretion ring — bright at the edge of the event horizon */}
        <circle r="20" fill="none" stroke="url(#breachUnlockedAccretion)" strokeWidth="1.4" filter="url(#breachUnlockedGlow)">
          <animate attributeName="r" values="19;21;19" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="strokeWidth" values="1.2;2;1.2" dur="2.4s" repeatCount="indefinite" />
        </circle>
        {/* Photon ring — thin inner ring at half the horizon radius,
            suggests gravitational lensing */}
        <circle r="14" fill="none" stroke="#c45cff" strokeOpacity="0.3" strokeWidth="0.4" />
      </g>
    </svg>
  );
}