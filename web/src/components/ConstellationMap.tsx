import { useMemo, useState } from 'react';
import type { FrameArchetype } from '@/lib/frame';
import type { World } from '@/lib/quest';
import { WORLD_COLOR_HEX, type WorldColor } from '@/lib/quest';
import { CLASS_META, type ClassName } from '@/lib/types';
import type { ShieldTier, PenanceEvent } from '@/lib/types';
import { Avatar } from './Avatar';

/**
 * ConstellationMap — the overworld, redrawn as a Starfox / Mario Galaxy
 * constellation. Home base sits on the left with the avatar inside a
 * shield ring; the right side is a starfield with Nexus at the center
 * and the class portals arranged in a pentagon around it. Pulsating
 * lines connect Nexus to each portal.
 *
 * Pentagon is computed at viewBox 1000x600 with the right half centered
 * at (620, 300). The left half (x: 0..340) is the home base panel.
 */

type Props = {
  worlds: World[];
  archetype: FrameArchetype;
  playerLevel: number;
  accentColor: string;
  classStripe: string | null;
  onSelect: (worldId: string) => void;
  /** Called when the user clicks the Nexus center node (only if a NEUTRAL world exists). */
  onSelectNexus?: (worldId: string) => void;
  /** Real shield tier from the home-base engine. When provided, the
   *  home-base ring color + label reflect the user's actual state
   *  (not the level-based placeholder). */
  shieldTier?: ShieldTier;
  /** Shield value 0-100. Displayed in the home-base tooltip on hover. */
  shield?: number;
  /** Recent penance events. Used to show "last fired: X" in the
   *  home-base tooltip. */
  recentEvents?: PenanceEvent[];
  /** Click on home base opens the full home-base modal. */
  onSelectHomeBase?: () => void;
  /** Breach unlock state. When the user is at or above level 10
   *  and has not yet entered, the black hole overlay should fade
   *  in at the Nexus center with a click handler that routes to
   *  /breach. When locked (default), nothing renders. */
  breach?: {
    unlocked: boolean;
    bossName?: string;
    bossHp?: number;
    bossMaxHp?: number;
    status?: 'LOCKED' | 'ACTIVE' | 'VICTORY' | 'COOLDOWN';
  } | null;
  /** When the user clicks the breach overlay. */
  onSelectBreach?: () => void;
};

// Portal iconography per class. Falls back to the world's `icon` glyph
// if we don't have a class-specific override.
const CLASS_PORTAL_ICON: Record<ClassName, string> = {
  JUGGERNAUT: '⚖', // barbell / scales — heavy
  PHANTOM:    '✒', // feather quill — lean, swift
  SCOUT:      '✦', // compass star — explorer
  BERSERKER:  '✷', // burst / flame
  TRACER:     '⚡', // lightning — burst
  ORACLE:     '❀', // lotus
};

// Stable seed for the starfield so positions don't shift between renders.
function seededStars(count: number, seed: number): Array<{ x: number; y: number; r: number; o: number }> {
  const out: Array<{ x: number; y: number; r: number; o: number }> = [];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < count; i++) {
    out.push({
      x: rand() * 1000,
      y: rand() * 600,
      r: 0.4 + rand() * 1.6,
      o: 0.15 + rand() * 0.55,
    });
  }
  return out;
}

// Pentagon positions around the Nexus. 5 slots, top-down clockwise.
// Each slot is `{ x, y, angle }` so we can place icons and draw
// connecting lines to the Nexus. Six nodes arranged hexagonally
// (60° intervals) around Nexus.
const NEXUS_CX = 620;
const NEXUS_CY = 300;
const NEXUS_R = 180;
// Breach node sits to the right of the Nexus, outside the
// hexagonal portal arrangement. The thin pulsing line from
// Nexus → Breach only renders when the user is unlocked
// (level 10+). Distance from Nexus ~300 — clearly separate
// but visually connected.
const BREACH_X = 920;
const BREACH_Y = 300;

const HEXAGON_SLOTS = [
  { id: 'JUGGERNAUT', angle: -90, label: 'The Spire',     color: 'red'        as WorldColor, energy: 'POWER'      },
  { id: 'BERSERKER',  angle: -30, label: 'Iron Citadel',  color: 'magenta'    as WorldColor, energy: 'INTENSITY'  },
  { id: 'PHANTOM',    angle:  30, label: 'Shadow Glade',  color: 'lime'       as WorldColor, energy: 'CONTROL'    },
  { id: 'SCOUT',      angle:  90, label: 'The Long Path', color: 'goldenrod'  as WorldColor, energy: 'AEROBIC'    },
  { id: 'ORACLE',     angle: 150, label: 'Mind Sanctum',  color: 'periwinkle' as WorldColor, energy: 'RECOVERY'   },
  { id: 'TRACER',     angle: 210, label: 'The Gap',       color: 'orange'     as WorldColor, energy: 'ANAEROBIC'  },
];

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function ConstellationMap({
  worlds,
  archetype,
  playerLevel,
  accentColor,
  classStripe,
  onSelect,
  onSelectNexus,
  shieldTier: shieldTierProp,
  shield,
  recentEvents,
  onSelectHomeBase,
  breach,
  onSelectBreach,
}: Props) {
  const stars = useMemo(() => seededStars(110, 7919), []);
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
  const [hoveredHomeBase, setHoveredHomeBase] = useState(false);

  // Match each pentagon slot to a world by class affiliation.
  // Slots without a matching world render as a dim "unmapped" node.
  // The Nexus (NEUTRAL affiliation) is NOT a slot — it lives at the
  // center of the constellation and is rendered separately.
  const worldByClass = useMemo(() => {
    const m = new Map<string, World>();
    for (const w of worlds) {
      if (w.affiliation !== 'NEUTRAL') m.set(w.affiliation, w);
    }
    return m;
  }, [worlds]);

  // The central Nexus hub prefers the Nexus world (post-game
  // convergence). Falls back to any NEUTRAL world for legacy
  // layouts where Nexus doesn't exist yet.
  const nexusWorld = useMemo(
    () => worlds.find((w) => w.id === 'nexus')
      ?? worlds.find((w) => w.affiliation === 'NEUTRAL')
      ?? null,
    [worlds],
  );

  // Shield tier. When the parent passes the real tier (from
  // /home-base), use it. Otherwise fall back to a level-based
  // placeholder so the ring still has a color before the home-base
  // endpoint resolves.
  const shieldTier = shieldTierProp
    ?? (playerLevel >= 25 ? 'FORTIFIED' : playerLevel >= 10 ? 'STABLE' : 'COMPROMISED');
  const shieldColor =
    shieldTier === 'FORTIFIED'   ? '#9bff5c' :
    shieldTier === 'STABLE'      ? '#14d6e8' :
    shieldTier === 'COMPROMISED' ? '#ffc34d' :
                                   '#dc2626';

  const ringHex = classStripe ?? accentColor ?? '#14d6e8';

  return (
    <div className="w-full">
      <svg
        viewBox="0 0 1000 600"
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Overworld constellation"
      >
        <defs>
          <filter id="constellation-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="nebula" cx="62%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#1a2238" stopOpacity="0.5" />
            <stop offset="60%" stopColor="#0e0f1a" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#06070d" stopOpacity="1" />
          </radialGradient>
          <radialGradient id="nexus-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#fafafd" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#9bff5c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#14d6e8" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nexus-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#f55cc4" />
            <stop offset="25%"  stopColor="#ffc34d" />
            <stop offset="50%"  stopColor="#9bff5c" />
            <stop offset="75%"  stopColor="#14d6e8" />
            <stop offset="100%" stopColor="#7d7bff" />
          </linearGradient>
        </defs>

        {/* Background nebula + stars */}
        <rect width="1000" height="600" fill="url(#nebula)" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fafafd" opacity={s.o} />
        ))}

        {/* Subtle vertical divider between home base and constellation */}
        <line x1="360" y1="60" x2="360" y2="540" stroke={ringHex} strokeOpacity="0.08" strokeWidth="1" strokeDasharray="2 4" />

        {/* Pulsating lines: Nexus → each portal slot. When a portal
            is hovered, its line brightens while the rest dim. */}
        {HEXAGON_SLOTS.map((slot, i) => {
          const pos = polar(NEXUS_CX, NEXUS_CY, NEXUS_R, slot.angle);
          const world = worldByClass.get(slot.id);
          const color = WORLD_COLOR_HEX[slot.color];
          const delay = i * 0.6;
          const isHovered = hoveredSlot === slot.id;
          const isOtherHovered = hoveredSlot !== null && hoveredSlot !== slot.id;
          const baseOpacity = world ? 0.5 : 0.18;
          const opacity = isHovered ? 0.95 : isOtherHovered ? 0.08 : baseOpacity;
          return (
            <line
              key={`line-${slot.id}`}
              x1={NEXUS_CX}
              y1={NEXUS_CY}
              x2={pos.x}
              y2={pos.y}
              stroke={world ? color : '#5c5f70'}
              strokeWidth={isHovered ? 2.5 : world ? 1.5 : 0.8}
              strokeOpacity={opacity}
              filter="url(#constellation-glow)"
              style={{ transition: 'stroke-opacity 200ms, stroke-width 200ms' }}
            >
              {world && !isOtherHovered && (
                <animate
                  attributeName="stroke-opacity"
                  values="0.2;0.85;0.2"
                  dur="3.2s"
                  begin={`${delay}s`}
                  repeatCount="indefinite"
                />
              )}
            </line>
          );
        })}

        {/* Nexus node — the neutral hub at center. Clickable when
            a NEUTRAL world exists. Hover speeds up the ring spin,
            brightens the halo, scales the core, and surfaces a
            tooltip with the world name + completion count (or a
            "coming soon" hint when no NEUTRAL world exists yet). */}
        <g
          onClick={nexusWorld && onSelectNexus ? () => onSelectNexus(nexusWorld.id) : undefined}
          onMouseEnter={() => setHoveredSlot('__nexus__')}
          onMouseLeave={() => setHoveredSlot(null)}
          style={{
            cursor: nexusWorld && onSelectNexus ? 'pointer' : 'default',
            transform: `translate(${NEXUS_CX}px, ${NEXUS_CY}px) scale(${hoveredSlot === '__nexus__' ? 1.12 : 1})`,
            transformOrigin: '0 0',
            transition: 'transform 200ms ease-out',
          }}
        >
          {/* Soft halo — expands on hover */}
          <circle cx="0" cy="0" r={hoveredSlot === '__nexus__' ? 84 : 68} fill="url(#nexus-grad)" opacity={hoveredSlot === '__nexus__' ? 0.95 : 0.7} style={{ transition: 'r 200ms, opacity 200ms' }}>
            <animate attributeName="r" values={hoveredSlot === '__nexus__' ? '76;92;76' : '64;72;64'} dur={hoveredSlot === '__nexus__' ? '2s' : '4s'} repeatCount="indefinite" />
          </circle>
          {/* Rotating rainbow ring — speeds up on hover (20s → 5s) */}
          <circle cx="0" cy="0" r="36" fill="none" stroke="url(#nexus-ring)" strokeWidth={hoveredSlot === '__nexus__' ? 3 : 2} filter="url(#constellation-glow)" style={{ transition: 'stroke-width 200ms' }}>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 0 0"
              to="360 0 0"
              dur={hoveredSlot === '__nexus__' ? '5s' : '20s'}
              repeatCount="indefinite"
            />
          </circle>
          {/* Inner core — scales + brightens on hover */}
          <circle cx="0" cy="0" r="22" fill="#0e0f1a" stroke="#fafafd" strokeOpacity={hoveredSlot === '__nexus__' ? 1 : 0.6} strokeWidth={hoveredSlot === '__nexus__' ? 1.5 : 0.5} style={{ transition: 'stroke-opacity 200ms, stroke-width 200ms' }} />
          <text x="0" y="4" textAnchor="middle" fill="#fafafd" fontSize="10" fontFamily="monospace" letterSpacing="2">
            NEXUS
          </text>
          {/* World name + hint when available */}
          {nexusWorld ? (
            <text x="0" y="70" textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#cbd5e1" opacity={hoveredSlot === '__nexus__' ? 1 : 0.85} style={{ transition: 'opacity 200ms' }}>
              {nexusWorld.name.toUpperCase()}
            </text>
          ) : (
            <text x="0" y="70" textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#585868" opacity="0.6">
              hub
            </text>
          )}
          {/* Hover tooltip — only when a world exists (no "tap
              to enter" for placeholder hubs) */}
          {hoveredSlot === '__nexus__' && nexusWorld && (
            <g transform="translate(-90, -100)">
              <rect
                width="180"
                height="34"
                rx="3"
                fill="#0e0f1a"
                stroke="#f55cc4"
                strokeOpacity="0.6"
                strokeWidth="0.5"
              />
              <text x="90" y="14" textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#fafafd">
                {nexusWorld.name.toUpperCase()}
              </text>
              <text x="90" y="26" textAnchor="middle" fontSize="7" fontFamily="monospace" letterSpacing="1" fill="#a8a8b8">
                TAP TO ENTER
              </text>
            </g>
          )}
        </g>

        {/* Portal nodes — pentagon. Hover scales the disc 1.18x,
            bumps the glow opacity, and shows a label tooltip with
            the class + theme + completion count. */}
        {/* Breach — separate node to the right of the Nexus. Only
            renders when the user has unlocked it (level 10+). A
            thin pulsing line connects the Nexus to the Breach —
            a "leak" in the constellation fabric. Click routes to
            /breach. Position (920, 300) keeps it clearly outside
            the hexagonal portal arrangement so the Nexus stays
            visible as the central hub. */}
        {breach?.unlocked && (
          <>
            {/* Connecting line: Nexus → Breach. Faint dashed cyan
                with animated dashoffset to feel like data being
                siphoned from the Nexus into the void. */}
            <line
              x1={NEXUS_CX + 36}
              y1={NEXUS_CY}
              x2={BREACH_X - 30}
              y2={BREACH_Y}
              stroke="#7dd3fc"
              strokeOpacity={hoveredSlot === '__breach__' ? 0.7 : 0.35}
              strokeWidth={hoveredSlot === '__breach__' ? 1.2 : 0.8}
              strokeDasharray="4 6"
              style={{ transition: 'stroke-opacity 200ms, stroke-width 200ms' }}
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="2s" repeatCount="indefinite" />
            </line>
            <g
              onClick={onSelectBreach}
              onMouseEnter={() => setHoveredSlot('__breach__')}
              onMouseLeave={() => setHoveredSlot(null)}
              style={{
                cursor: onSelectBreach ? 'pointer' : 'default',
                transform: `translate(${BREACH_X}px, ${BREACH_Y}px) scale(${hoveredSlot === '__breach__' ? 1.18 : 1})`,
                transformOrigin: '0 0',
                transition: 'transform 200ms ease-out',
              }}
            >
              {/* Faint outer halo so the black hole has a gravitational
                  pull visible against the nebula. */}
              <circle cx="0" cy="0" r="42" fill="url(#nexus-grad)" opacity={hoveredSlot === '__breach__' ? 0.7 : 0.45} style={{ transition: 'opacity 200ms' }} />
              {/* Outer accretion disk — counter-rotating dashed ellipses */}
              <ellipse cx="0" cy="0" rx="36" ry="13" fill="none" stroke="#7dd3fc" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3 5">
                <animateTransform attributeName="transform" type="rotate" from="0" to="-360" dur="22s" repeatCount="indefinite" />
              </ellipse>
              <ellipse cx="0" cy="0" rx="30" ry="10" fill="none" stroke="#fbbf24" strokeWidth="1" strokeOpacity="0.7" strokeDasharray="2 4">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="14s" repeatCount="indefinite" />
              </ellipse>
              {/* Event horizon — pure black core */}
              <circle cx="0" cy="0" r={hoveredSlot === '__breach__' ? 17 : 15} fill="#000000" style={{ transition: 'r 200ms' }} />
              {/* Photon ring */}
              <circle cx="0" cy="0" r="15" fill="none" stroke={hoveredSlot === '__breach__' ? '#a3e635' : '#7dd3fc'} strokeWidth="1" strokeOpacity="0.9" style={{ transition: 'stroke 200ms' }} />
              {/* BREACH label */}
              <text x="0" y="2" textAnchor="middle" fill="#fafafd" fontSize="6.5" fontFamily="monospace" letterSpacing="2" style={{ pointerEvents: 'none' }}>
                BREACH
              </text>
              {/* HP% subline */}
              {breach.bossHp != null && breach.bossMaxHp != null && breach.bossMaxHp > 0 && (
                <text x="0" y="28" textAnchor="middle" fill="#94a3b8" fontSize="6" fontFamily="monospace" letterSpacing="1" style={{ pointerEvents: 'none' }}>
                  {Math.round((breach.bossHp / breach.bossMaxHp) * 100)}%
                </text>
              )}
              {/* Tooltip on hover */}
              {hoveredSlot === '__breach__' && (
                <g transform="translate(-90, -88)" style={{ pointerEvents: 'none' }}>
                  <rect width="180" height="34" rx="3" fill="#0e0f1a" stroke="#7dd3fc" strokeOpacity="0.6" strokeWidth="0.5" />
                  <text x="90" y="14" textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#fafafd">
                    {breach.status === 'VICTORY' ? 'CLAIM YOUR VICTORY' : breach.bossName?.toUpperCase() ?? 'THE BREACH'}
                  </text>
                  <text x="90" y="26" textAnchor="middle" fontSize="7" fontFamily="monospace" letterSpacing="1" fill="#a8a8b8">
                    TAP TO ENTER
                  </text>
                </g>
              )}
            </g>
          </>
        )}
        {HEXAGON_SLOTS.map((slot) => {
          const pos = polar(NEXUS_CX, NEXUS_CY, NEXUS_R, slot.angle);
          const world = worldByClass.get(slot.id);
          const color = WORLD_COLOR_HEX[slot.color];
          const classMeta = CLASS_META[slot.id as ClassName];
          const icon = classMeta ? CLASS_PORTAL_ICON[slot.id as ClassName] : '◆';
          const hasWorld = !!world;
          const isHovered = hoveredSlot === slot.id;
          const scale = isHovered ? 1.18 : 1;
          const completed = world ? world.levels.filter((l) => l.completed).length : 0;
          const total = world ? world.levels.length : 0;
          return (
            <g
              key={slot.id}
              transform={`translate(${pos.x}, ${pos.y}) scale(${scale})`}
              onClick={hasWorld ? () => onSelect(world!.id) : undefined}
              onMouseEnter={() => setHoveredSlot(slot.id)}
              onMouseLeave={() => setHoveredSlot(null)}
              style={{
                cursor: hasWorld ? 'pointer' : 'not-allowed',
                transition: 'transform 200ms ease-out',
              }}
            >
              {/* Outer glow ring — brightens on hover */}
              <circle r="34" fill={color} opacity={isHovered ? 0.32 : hasWorld ? 0.12 : 0.04}>
                {hasWorld && !isHovered && (
                  <animate attributeName="opacity" values="0.06;0.22;0.06" dur="2.8s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Portal disc — scales with parent */}
              <circle r="26" fill="#0e0f1a" stroke={color} strokeWidth={isHovered ? 2.5 : hasWorld ? 1.5 : 1} strokeOpacity={hasWorld ? 0.95 : 0.4} filter="url(#constellation-glow)" />
              {/* Class icon */}
              <text textAnchor="middle" dominantBaseline="central" fontSize={isHovered ? 24 : 20} fill={color} opacity={hasWorld ? 1 : 0.35}>
                {icon}
              </text>
              {/* Label below */}
              <text textAnchor="middle" y="48" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill={color} opacity={hasWorld ? 0.95 : 0.4}>
                {(world?.name ?? slot.label).toUpperCase()}
              </text>
              {/* Class tag */}
              <text textAnchor="middle" y="60" fontSize="7" fontFamily="monospace" letterSpacing="1" fill="#a8a8b8" opacity={hasWorld ? 0.6 : 0.3}>
                {slot.id}
              </text>
              {/* Hover tooltip */}
              {isHovered && hasWorld && (
                <g transform="translate(0, -50)">
                  <rect
                    x="-90"
                    y="-12"
                    width="180"
                    height="34"
                    rx="3"
                    fill="#0e0f1a"
                    stroke={color}
                    strokeOpacity="0.6"
                    strokeWidth="0.5"
                  />
                  <text textAnchor="middle" y="0" fontSize="8" fontFamily="monospace" letterSpacing="1.5" fill="#fafafd" opacity="0.95">
                    {world.theme.toUpperCase()} · {completed}/{total} CLEARED
                  </text>
                  <text textAnchor="middle" y="12" fontSize="7" fontFamily="monospace" letterSpacing="1" fill="#a8a8b8" opacity="0.7">
                    TAP TO ENTER
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* HOME BASE — left half. Hover speeds up the shield ring
            (60s → 8s rotation) + shows a tooltip with the actual
            shield value + last-fired penance. Clicking opens the
            full home-base modal (parent-provided onSelectHomeBase). */}
        <g
          transform="translate(170, 300)"
          onMouseEnter={() => setHoveredHomeBase(true)}
          onMouseLeave={() => setHoveredHomeBase(false)}
          onClick={onSelectHomeBase}
          style={{
            cursor: onSelectHomeBase ? 'pointer' : 'default',
            transition: 'transform 200ms ease-out',
            transform: 'translate(170px, 300px) scale(' + (hoveredHomeBase ? 1.04 : 1) + ')',
            transformOrigin: '170px 300px',
          }}
        >
          {/* Outer shield ring (tier-colored). Spin duration speeds
              up on hover (60s → 8s) for a "waking up" feel. */}
          <circle r="120" fill="none" stroke={shieldColor} strokeOpacity={hoveredHomeBase ? 0.85 : 0.4} strokeWidth={hoveredHomeBase ? 2.5 : 1.5} strokeDasharray="6 4" filter="url(#constellation-glow)">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur={hoveredHomeBase ? '8s' : '60s'} repeatCount="indefinite" />
          </circle>
          {/* Inner glow — pulse stronger on hover */}
          <circle r="92" fill="#0e0f1a" stroke={ringHex} strokeOpacity="0.6" strokeWidth="1">
            <animate attributeName="r" values="92;96;92" dur={hoveredHomeBase ? '1.6s' : '4s'} repeatCount="indefinite" />
          </circle>
          {/* Avatar inset */}
          <g transform="translate(-60, -60)">
            <Avatar
              archetype={archetype}
              size={120}
              accentColor={accentColor}
              classStripe={classStripe ?? undefined}
            />
          </g>
          {/* Shield tier label */}
          <text textAnchor="middle" y="108" fontSize="9" fontFamily="monospace" letterSpacing="2" fill={shieldColor}>
            HOME BASE
          </text>
          <text textAnchor="middle" y="122" fontSize="7" fontFamily="monospace" letterSpacing="1.5" fill="#a8a8b8">
            SHIELD · {shieldTier.toUpperCase()}
            {shield != null ? ` · ${shield}/100` : ''}
          </text>
          {/* Hover tooltip — shield value + last event */}
          {hoveredHomeBase && (shield != null || (recentEvents && recentEvents.length > 0)) && (
            <g transform="translate(-130, -148)">
              <rect
                width="260"
                height="46"
                rx="3"
                fill="#0e0f1a"
                stroke={shieldColor}
                strokeOpacity="0.6"
                strokeWidth="0.5"
              />
              {shield != null && (
                <text x="10" y="16" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill={shieldColor}>
                  SHIELD {shield}/100 · {shieldTier}
                </text>
              )}
              {recentEvents && recentEvents[0] && (
                <text x="10" y="32" fontSize="8" fontFamily="monospace" fill="#a8a8b8">
                  LAST: {recentEvents[0].label} {recentEvents[0].shieldDelta > 0 ? '+' : ''}{recentEvents[0].shieldDelta}
                </text>
              )}
            </g>
          )}
        </g>
      </svg>

      {/* Below-SVG legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[9px] font-mono tracking-widest text-ink-300">
        {HEXAGON_SLOTS.map((slot) => {
          const color = WORLD_COLOR_HEX[slot.color];
          const world = worldByClass.get(slot.id);
          return (
            <span key={slot.id} className="flex items-center gap-1.5" title={world?.name ?? `${slot.id} (no world yet)`}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              <span style={{ color: world ? color : '#787888' }}>
                {slot.id}
              </span>
              <span className="text-ink-400">·</span>
              <span className="text-ink-300">{slot.energy}</span>
            </span>
          );
        })}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-gradient-to-r from-fuchsia-400 via-yellow-300 to-cyan-400" />
          <span>NEXUS</span>
          <span className="text-ink-400">·</span>
          <span className="text-ink-300">HUB</span>
        </span>
      </div>
    </div>
  );
}