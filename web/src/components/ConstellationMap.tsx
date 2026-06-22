import { useMemo } from 'react';
import type { FrameArchetype } from '@/lib/frame';
import type { UserAvatar } from '@/lib/auth';
import type { World } from '@/lib/quest';
import { WORLD_COLOR_HEX, type WorldColor } from '@/lib/quest';
import { CLASS_META, type ClassName } from '@/lib/types';
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
  avatar: UserAvatar | null;
  playerLevel: number;
  accentColor: string;
  classStripe: string | null;
  onSelect: (worldId: string) => void;
  /** Called when the user clicks the Nexus center node (only if a NEUTRAL world exists). */
  onSelectNexus?: (worldId: string) => void;
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
  avatar,
  playerLevel,
  accentColor,
  classStripe,
  onSelect,
  onSelectNexus,
}: Props) {
  const stars = useMemo(() => seededStars(110, 7919), []);

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

  const nexusWorld = useMemo(
    () => worlds.find((w) => w.affiliation === 'NEUTRAL') ?? null,
    [worlds],
  );

  // Shield tier — placeholder until shield+penance lands. Show the
  // ring color based on a tier derived from playerLevel (so it's
  // visibly alive without lying about real shield state).
  const shieldTier = playerLevel >= 25 ? 'fortified' : playerLevel >= 10 ? 'stable' : 'compromised';
  const shieldColor =
    shieldTier === 'fortified'  ? '#9bff5c' :
    shieldTier === 'stable'     ? '#14d6e8' :
    shieldTier === 'compromised' ? '#ffc34d' :
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

        {/* Pulsating lines: Nexus → each portal slot */}
        {HEXAGON_SLOTS.map((slot, i) => {
          const pos = polar(NEXUS_CX, NEXUS_CY, NEXUS_R, slot.angle);
          const world = worldByClass.get(slot.id);
          const color = WORLD_COLOR_HEX[slot.color];
          const delay = i * 0.6;
          return (
            <line
              key={`line-${slot.id}`}
              x1={NEXUS_CX}
              y1={NEXUS_CY}
              x2={pos.x}
              y2={pos.y}
              stroke={world ? color : '#5c5f70'}
              strokeWidth={world ? 1.5 : 0.8}
              strokeOpacity={world ? 0.5 : 0.18}
              filter="url(#constellation-glow)"
            >
              {world && (
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

        {/* Nexus node — the neutral hub at center. Clickable when a NEUTRAL world exists. */}
        <g
          onClick={nexusWorld && onSelectNexus ? () => onSelectNexus(nexusWorld.id) : undefined}
          style={{ cursor: nexusWorld && onSelectNexus ? 'pointer' : 'default' }}
        >
          {/* Soft halo */}
          <circle cx={NEXUS_CX} cy={NEXUS_CY} r="68" fill="url(#nexus-grad)">
            <animate attributeName="r" values="64;72;64" dur="4s" repeatCount="indefinite" />
          </circle>
          {/* Rotating rainbow ring */}
          <circle cx={NEXUS_CX} cy={NEXUS_CY} r="36" fill="none" stroke="url(#nexus-ring)" strokeWidth="2" filter="url(#constellation-glow)">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${NEXUS_CX} ${NEXUS_CY}`}
              to={`360 ${NEXUS_CX} ${NEXUS_CY}`}
              dur="20s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Inner core */}
          <circle cx={NEXUS_CX} cy={NEXUS_CY} r="22" fill="#0e0f1a" stroke="#fafafd" strokeOpacity="0.6" strokeWidth="0.5" />
          <text x={NEXUS_CX} y={NEXUS_CY + 4} textAnchor="middle" fill="#fafafd" fontSize="10" fontFamily="monospace" letterSpacing="2">
            NEXUS
          </text>
          {/* World name + hint when available */}
          {nexusWorld ? (
            <text x={NEXUS_CX} y={NEXUS_CY + 70} textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#cbd5e1" opacity="0.85">
              {nexusWorld.name.toUpperCase()}
            </text>
          ) : (
            <text x={NEXUS_CX} y={NEXUS_CY + 70} textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1.5" fill="#585868" opacity="0.6">
              hub
            </text>
          )}
        </g>

        {/* Portal nodes — pentagon */}
        {HEXAGON_SLOTS.map((slot) => {
          const pos = polar(NEXUS_CX, NEXUS_CY, NEXUS_R, slot.angle);
          const world = worldByClass.get(slot.id);
          const color = WORLD_COLOR_HEX[slot.color];
          const classMeta = CLASS_META[slot.id as ClassName];
          const icon = classMeta ? CLASS_PORTAL_ICON[slot.id as ClassName] : '◆';
          const hasWorld = !!world;
          return (
            <g
              key={slot.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={hasWorld ? () => onSelect(world!.id) : undefined}
              style={{ cursor: hasWorld ? 'pointer' : 'not-allowed' }}
            >
              {/* Outer glow ring */}
              <circle r="34" fill={color} opacity={hasWorld ? 0.12 : 0.04}>
                {hasWorld && (
                  <animate attributeName="opacity" values="0.06;0.22;0.06" dur="2.8s" repeatCount="indefinite" />
                )}
              </circle>
              {/* Portal disc */}
              <circle r="26" fill="#0e0f1a" stroke={color} strokeWidth={hasWorld ? 1.5 : 1} strokeOpacity={hasWorld ? 0.9 : 0.4} filter="url(#constellation-glow)" />
              {/* Class icon */}
              <text textAnchor="middle" dominantBaseline="central" fontSize="20" fill={color} opacity={hasWorld ? 1 : 0.35}>
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
            </g>
          );
        })}

        {/* HOME BASE — left half */}
        <g transform="translate(170, 300)">
          {/* Outer shield ring (tier-colored) */}
          <circle r="120" fill="none" stroke={shieldColor} strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="6 4" filter="url(#constellation-glow)">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="60s" repeatCount="indefinite" />
          </circle>
          {/* Inner glow */}
          <circle r="92" fill="#0e0f1a" stroke={ringHex} strokeOpacity="0.6" strokeWidth="1" />
          {/* Avatar inset */}
          <g transform="translate(-60, -60)">
            <Avatar
              archetype={archetype}
              hairStyle={avatar?.hairStyle ?? 'SHORT'}
              hairColor={avatar?.hairColor ?? 'brown'}
              skinTone={avatar?.skinTone ?? '#915533'}
              shirtColor={avatar?.shirtColor ?? '#14d6e8'}
              sprites
              weapon="weapon_warrior_2"
              shield="shield_warrior_1"
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
          </text>
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