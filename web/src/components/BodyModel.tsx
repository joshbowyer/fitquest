import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Small pulsing dot used for the "recently worked" body-part marker.
 * Sin-based scale + opacity oscillation so the eye is drawn to
 * recently-trained parts on the hologram. Cheap to run (single
 * 12-segment sphere, one useFrame) so we can have many of them
 * on screen at once without affecting framerate.
 */
function PulseDot({
  position,
  radius,
  color,
}: {
  position: [number, number, number];
  radius: number;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Two octaves so the pulse has texture — base rate plus a
    // higher-frequency wobble. Scaled to ~1.3 max so the dot
    // doesn't visibly leave the body part boundary.
    const pulse = 1 + 0.18 * Math.sin(t * 3.2) + 0.06 * Math.sin(t * 7.4);
    ref.current.scale.setScalar(pulse);
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

export type BodyPartId =
  | 'HEAD' | 'NECK' | 'TRAPS'
  | 'PECTORAL' | 'ABS' | 'OBLIQUE_L' | 'OBLIQUE_R'
  | 'BACK_UPPER' | 'BACK_LOWER' | 'LAT_L' | 'LAT_R'
  | 'CHEST' | 'HIP_L' | 'HIP_R'
  | 'SHOULDER_L' | 'SHOULDER_R' | 'ROTATOR_CUFF_L' | 'ROTATOR_CUFF_R'
  | 'BICEP_L' | 'BICEP_R' | 'TRICEP_L' | 'TRICEP_R'
  | 'FOREARM_L' | 'FOREARM_R' | 'WRIST_L' | 'WRIST_R'
  | 'GLUTE_L' | 'GLUTE_R'
  | 'ADDUCTOR_L' | 'ADDUCTOR_R' | 'ABDUCTOR_L' | 'ABDUCTOR_R'
  | 'QUAD_L' | 'QUAD_R' | 'HAMSTRING_L' | 'HAMSTRING_R'
  | 'KNEE_L' | 'KNEE_R' | 'CALF_L' | 'CALF_R'
  | 'ANKLE_L' | 'ANKLE_R' | 'FOOT_L' | 'FOOT_R';

// Each body part has a position (relative to body center, Y-up)
// and a label for the UI. Use this for both rendering and for
// placing pain markers.
export type BodyPartMeta = {
  id: BodyPartId;
  label: string;
  position: [number, number, number];
  // Approximate bone length used for the mesh
  size: [number, number, number];
  // Side: 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' | 'CENTER'
  side: 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' | 'CENTER';
  // Body group (used for grouping in UI)
  group: 'head' | 'torso' | 'arm' | 'leg' | 'core';
};

export const BODY_PARTS: BodyPartMeta[] = [
  // Head + neck
  { id: 'HEAD',    label: 'Head',       position: [0, 2.05, 0],    size: [0.45, 0.5, 0.45],  side: 'CENTER', group: 'head' },
  { id: 'NECK',    label: 'Neck',       position: [0, 1.65, 0],    size: [0.18, 0.18, 0.18], side: 'CENTER', group: 'head' },
  { id: 'TRAPS',   label: 'Traps',      position: [0, 1.5, -0.18], size: [0.55, 0.25, 0.15], side: 'BACK',   group: 'torso' },

  // Torso — front
  { id: 'PECTORAL', label: 'Pectorals', position: [0, 1.2, 0.15],  size: [0.85, 0.45, 0.18], side: 'FRONT',  group: 'torso' },
  { id: 'ABS',      label: 'Abs',       position: [0, 0.7, 0.18],  size: [0.55, 0.4, 0.15],  side: 'FRONT',  group: 'core' },
  { id: 'OBLIQUE_L', label: 'L Oblique', position: [-0.3, 0.75, 0.05], size: [0.18, 0.4, 0.22], side: 'LEFT', group: 'core' },
  { id: 'OBLIQUE_R', label: 'R Oblique', position: [ 0.3, 0.75, 0.05], size: [0.18, 0.4, 0.22], side: 'RIGHT', group: 'core' },

  // Torso — back
  { id: 'BACK_UPPER', label: 'Upper Back', position: [0, 1.1, -0.18], size: [0.85, 0.35, 0.12], side: 'BACK', group: 'torso' },
  { id: 'BACK_LOWER', label: 'Lower Back', position: [0, 0.65, -0.18], size: [0.6, 0.4, 0.12],  side: 'BACK', group: 'core' },
  { id: 'LAT_L',    label: 'L Lat',         position: [-0.35, 1.0, -0.13], size: [0.22, 0.5, 0.18], side: 'LEFT',  group: 'torso' },
  { id: 'LAT_R',    label: 'R Lat',         position: [ 0.35, 1.0, -0.13], size: [0.22, 0.5, 0.18], side: 'RIGHT', group: 'torso' },

  // Legacy overview parts (kept for backward compat; not rendered in BODY_PARTS_UI)
  { id: 'CHEST',    label: 'Chest (legacy)',  position: [0, 1.1, 0.1],   size: [0.85, 0.65, 0.32], side: 'FRONT',  group: 'torso' },
  { id: 'HIP_L',    label: 'L Hip (legacy)',  position: [-0.25, 0.35, 0], size: [0.22, 0.18, 0.25], side: 'LEFT',  group: 'leg' },
  { id: 'HIP_R',    label: 'R Hip (legacy)',  position: [ 0.25, 0.35, 0], size: [0.22, 0.18, 0.25], side: 'RIGHT', group: 'leg' },

  // Shoulders + rotator cuff
  { id: 'SHOULDER_L',     label: 'L Shoulder',      position: [-0.55, 1.4, 0],   size: [0.22, 0.22, 0.22], side: 'LEFT',  group: 'arm' },
  { id: 'SHOULDER_R',     label: 'R Shoulder',      position: [ 0.55, 1.4, 0],   size: [0.22, 0.22, 0.22], side: 'RIGHT', group: 'arm' },
  { id: 'ROTATOR_CUFF_L', label: 'L Rotator Cuff',  position: [-0.5, 1.45, -0.08], size: [0.18, 0.18, 0.18], side: 'LEFT', group: 'arm' },
  { id: 'ROTATOR_CUFF_R', label: 'R Rotator Cuff',  position: [ 0.5, 1.45, -0.08], size: [0.18, 0.18, 0.18], side: 'RIGHT', group: 'arm' },

  // Upper arms — front (biceps) + back (triceps)
  { id: 'BICEP_L',   label: 'L Bicep',   position: [-0.72, 0.95, 0.08], size: [0.2, 0.45, 0.2], side: 'LEFT',  group: 'arm' },
  { id: 'BICEP_R',   label: 'R Bicep',   position: [ 0.72, 0.95, 0.08], size: [0.2, 0.45, 0.2], side: 'RIGHT', group: 'arm' },
  { id: 'TRICEP_L',  label: 'L Tricep',  position: [-0.72, 0.95, -0.08], size: [0.2, 0.45, 0.2], side: 'LEFT',  group: 'arm' },
  { id: 'TRICEP_R',  label: 'R Tricep',  position: [ 0.72, 0.95, -0.08], size: [0.2, 0.45, 0.2], side: 'RIGHT', group: 'arm' },

  // Forearms + wrists
  { id: 'FOREARM_L', label: 'L Forearm', position: [-0.78, 0.4, 0.05], size: [0.17, 0.45, 0.17], side: 'LEFT',  group: 'arm' },
  { id: 'FOREARM_R', label: 'R Forearm', position: [ 0.78, 0.4, 0.05], size: [0.17, 0.45, 0.17], side: 'RIGHT', group: 'arm' },
  { id: 'WRIST_L',   label: 'L Wrist',   position: [-0.8, -0.05, 0.05], size: [0.12, 0.12, 0.12], side: 'LEFT',  group: 'arm' },
  { id: 'WRIST_R',   label: 'R Wrist',   position: [ 0.8, -0.05, 0.05], size: [0.12, 0.12, 0.12], side: 'RIGHT', group: 'arm' },

  // Glutes + hip abductors/adductors
  { id: 'GLUTE_L',     label: 'L Glute',     position: [-0.25, 0.35, -0.15], size: [0.28, 0.3, 0.22],  side: 'LEFT',  group: 'leg' },
  { id: 'GLUTE_R',     label: 'R Glute',     position: [ 0.25, 0.35, -0.15], size: [0.28, 0.3, 0.22],  side: 'RIGHT', group: 'leg' },
  { id: 'ADDUCTOR_L',  label: 'L Adductor',  position: [-0.13, 0.15, 0.05], size: [0.15, 0.35, 0.18], side: 'LEFT',  group: 'leg' },
  { id: 'ADDUCTOR_R',  label: 'R Adductor',  position: [ 0.13, 0.15, 0.05], size: [0.15, 0.35, 0.18], side: 'RIGHT', group: 'leg' },
  { id: 'ABDUCTOR_L',  label: 'L Abductor',  position: [-0.45, 0.3, 0.0],   size: [0.18, 0.25, 0.2],  side: 'LEFT',  group: 'leg' },
  { id: 'ABDUCTOR_R',  label: 'R Abductor',  position: [ 0.45, 0.3, 0.0],   size: [0.18, 0.25, 0.2],  side: 'RIGHT', group: 'leg' },

  // Quads (front) + hamstrings (back)
  { id: 'QUAD_L',     label: 'L Quad',      position: [-0.27, -0.1, 0.1],   size: [0.22, 0.55, 0.22], side: 'LEFT',  group: 'leg' },
  { id: 'QUAD_R',     label: 'R Quad',      position: [ 0.27, -0.1, 0.1],   size: [0.22, 0.55, 0.22], side: 'RIGHT', group: 'leg' },
  { id: 'HAMSTRING_L', label: 'L Hamstring', position: [-0.27, -0.1, -0.12], size: [0.22, 0.55, 0.18], side: 'LEFT',  group: 'leg' },
  { id: 'HAMSTRING_R', label: 'R Hamstring', position: [ 0.27, -0.1, -0.12], size: [0.22, 0.55, 0.18], side: 'RIGHT', group: 'leg' },

  // Knees + calves + ankles + feet
  { id: 'KNEE_L',  label: 'L Knee',  position: [-0.27, -0.7, 0.05],  size: [0.2, 0.18, 0.2],    side: 'LEFT',  group: 'leg' },
  { id: 'KNEE_R',  label: 'R Knee',  position: [ 0.27, -0.7, 0.05],  size: [0.2, 0.18, 0.2],    side: 'RIGHT', group: 'leg' },
  { id: 'CALF_L',  label: 'L Calf',  position: [-0.27, -1.2, -0.05], size: [0.18, 0.5, 0.18],   side: 'LEFT',  group: 'leg' },
  { id: 'CALF_R',  label: 'R Calf',  position: [ 0.27, -1.2, -0.05], size: [0.18, 0.5, 0.18],   side: 'RIGHT', group: 'leg' },
  { id: 'ANKLE_L', label: 'L Ankle', position: [-0.27, -1.7, 0],     size: [0.16, 0.12, 0.16],  side: 'LEFT',  group: 'leg' },
  { id: 'ANKLE_R', label: 'R Ankle', position: [ 0.27, -1.7, 0],     size: [0.16, 0.12, 0.16],  side: 'RIGHT', group: 'leg' },
  { id: 'FOOT_L',  label: 'L Foot',  position: [-0.27, -1.85, 0.15], size: [0.16, 0.1, 0.35],   side: 'LEFT',  group: 'leg' },
  { id: 'FOOT_R',  label: 'R Foot',  position: [ 0.27, -1.85, 0.15], size: [0.16, 0.1, 0.35],   side: 'RIGHT', group: 'leg' },
];

// Filter out legacy parts from the UI rendering — they were
// placeholders that we've now replaced with the muscle-group
// breakdown.
const LEGACY_PARTS: ReadonlyArray<BodyPartId> = ['CHEST', 'HIP_L', 'HIP_R'];
export const BODY_PARTS_UI: BodyPartMeta[] = BODY_PARTS.filter(
  (p) => !LEGACY_PARTS.includes(p.id),
);

export type PainMarker = {
  bodyPart: BodyPartId;
  intensity: number;  // 0-10
  count: number;
  latestAt: string;
};

// Volume intensity band for the avatar palette. Set-count bands
// drive the saturation/opacity of the recovery color so the user
// can see "I worked this muscle lightly vs heavily" at a glance.
export type VolumeBand = 'none' | 'light' | 'moderate' | 'heavy';

export function bandForSetCount(setCount: number): VolumeBand {
  if (setCount <= 0) return 'none';
  if (setCount <= 2) return 'light';
  if (setCount <= 5) return 'moderate';
  return 'heavy';
}

// Recovery band for the avatar palette. Maps the 0-100 recovery
// score to one of 5 named states that drive the HUE of the part.
//
// Naming: NEUTRAL-TO-POSITIVE framing. The "spent" state is the
// natural post-workout state — the user worked the muscle hard
// enough to need 24-48h before stressing it again. That's not a
// problem, it's the training stimulus. Older naming ("overloaded")
// sounded like failure; the new labels describe the cycle the
// user is intentionally going through.
//
//   untrained  90-100   no recent work; this part is cold
//   primed     70-89    past work fully digested; supercompensated (PR-ready)
//   recovering 50-69    recent work, digesting fine
//   fatigued   30-49    recent work, not yet recovered
//   spent      0-29     worked hard; give it a day off
export type RecoveryBand = 'untrained' | 'primed' | 'recovering' | 'fatigued' | 'spent';

export function bandForRecoveryScore(score: number): RecoveryBand {
  if (score >= 90) return 'untrained';
  if (score >= 70) return 'primed';
  if (score >= 50) return 'recovering';
  if (score >= 30) return 'fatigued';
  return 'spent';
}

// Muscle-worked marker: a part was trained at the given time.
// Used to show recent activity on the body. Newer fields
// (`setCount`, `sessions`) drive the 13-state color palette.
// The legacy `intensity` field is kept for back-compat.
export type MuscleWorkedSession = {
  workoutId: string;
  workoutName: string | null;
  performedAt: string;
  setCount: number;
  totalVolumeKg: number;
};

export type MuscleWorkedMarker = {
  bodyPart: BodyPartId;
  workedAt: string;  // ISO timestamp of the latest session
  // Legacy 0-10 volume proxy. New clients should use setCount.
  intensity: number;
  // New: total sets across the 36h window.
  setCount: number;
  // Per-workout breakdown that drives the click-list modal.
  sessions: MuscleWorkedSession[];
};

// Recovery status per body part, 0-100.
// 100 = fully recovered, 0 = maxed out / needs rest.
export type RecoveryMarker = {
  bodyPart: BodyPartId;
  // 0-100
  score: number;
  // Last time this muscle was worked (if any)
  lastWorkedAt: string | null;
};

type Props = {
  painMarkers?: PainMarker[];
  workedMarkers?: MuscleWorkedMarker[];
  recoveryMarkers?: RecoveryMarker[];
  onPartClick: (part: BodyPartMeta) => void;
  onPartHover?: (part: BodyPartMeta | null) => void;
  rotate?: boolean;
  height?: number | string;
  className?: string;
};

/**
 * 3D Tron-style holographic body model. Each body part is a
 * wireframe box mesh. Hovering highlights it; clicking opens
 * the pain log modal. Multiple overlays can be combined:
 *  - Pain markers (intensity-colored spheres) on body parts
 *    that have logged pain.
 *  - Muscle-worked markers (cyan spheres) on parts trained
 *    in the last 48h.
 *  - Recovery status colors the part itself — green when
 *    recovered, yellow when active, red when overworked.
 *
 * The whole model rotates slowly on the Y axis when `rotate` is
 * true. Click events use the R3F event system (PointerEvent).
 */
export function BodyModel({
  painMarkers = [],
  workedMarkers = [],
  recoveryMarkers = [],
  onPartClick,
  onPartHover,
  rotate = true,
  height = 'clamp(360px, 70vh, 600px)',
  className,
}: Props) {
  const painByPart = useMemo(() => {
    const m = new Map<BodyPartId, PainMarker>();
    for (const marker of painMarkers) m.set(marker.bodyPart, marker);
    return m;
  }, [painMarkers]);

  const workedByPart = useMemo(() => {
    const m = new Map<BodyPartId, MuscleWorkedMarker>();
    for (const marker of workedMarkers) m.set(marker.bodyPart, marker);
    return m;
  }, [workedMarkers]);

  const recoveryByPart = useMemo(() => {
    const m = new Map<BodyPartId, RecoveryMarker>();
    for (const marker of recoveryMarkers) m.set(marker.bodyPart, marker);
    return m;
  }, [recoveryMarkers]);

  return (
    <div
      className={className}
      style={{
        height,
        position: 'relative',
        background: 'radial-gradient(ellipse at center, rgba(20,214,232,0.05) 0%, transparent 70%)',
        border: '1px solid rgba(20,214,232,0.15)',
        overflow: 'hidden',
      }}
    >
      <Canvas
        camera={{ position: [0, 0.2, 7.5], fov: 45 }}
        // alpha:false so the scene background fills the canvas
        // solidly. With alpha:true the page bg bleeds through
        // and the wireframe colors wash out. Inline style is a
        // belt-and-suspenders fallback for the renderer startup
        // before the scene mounts.
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#0e1a2b' }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0e1a2b']} />
        <ambientLight intensity={0.3} />
        <pointLight position={[3, 3, 3]} intensity={0.6} color="#14d6e8" />
        <pointLight position={[-3, -2, 2]} intensity={0.4} color="#f55cc4" />

        {/* Floor grid — Tron-style */}
        <FloorGrid />

        <SpinningGroup rotate={rotate}>
          {BODY_PARTS_UI.map((part) => (
            <BodyPartMesh
              key={part.id}
              part={part}
              pain={painByPart.get(part.id) ?? null}
              worked={workedByPart.get(part.id) ?? null}
              recovery={recoveryByPart.get(part.id) ?? null}
              onClick={onPartClick}
              onHover={onPartHover}
            />
          ))}
        </SpinningGroup>

        {/* Pedestal dais */}
        <Pedestal />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={4}
          maxDistance={14}
          minPolarAngle={Math.PI * 0.15}
          maxPolarAngle={Math.PI * 0.85}
        />
      </Canvas>
    </div>
  );
}

function SpinningGroup({ children, rotate }: { children: React.ReactNode; rotate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (rotate && ref.current) {
      ref.current.rotation.y += delta * 0.18;
    }
  });
  return <group ref={ref}>{children}</group>;
}

function FloorGrid() {
  const grid = useMemo(() => {
    const size = 8;
    const divisions = 16;
    return { args: [size, size, divisions, divisions] as [number, number, number, number] };
  }, []);
  return (
    <group position={[0, -2.4, 0]} rotation={[0, 0, 0]}>
      <gridHelper args={grid.args} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[2.2, 64]} />
        <meshBasicMaterial color="#14d6e8" transparent opacity={0.05} />
      </mesh>
    </group>
  );
}

function Pedestal() {
  return (
    <group position={[0, -2.3, 0]}>
      <mesh>
        <cylinderGeometry args={[1.6, 1.8, 0.18, 32]} />
        <meshStandardMaterial
          color="#0e0f1a"
          emissive="#14d6e8"
          emissiveIntensity={0.4}
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <torusGeometry args={[1.65, 0.02, 8, 64]} />
        <meshBasicMaterial color="#14d6e8" />
      </mesh>
    </group>
  );
}

function BodyPartMesh({
  part,
  pain,
  worked,
  recovery,
  onClick,
  onHover,
}: {
  part: BodyPartMeta;
  pain: PainMarker | null;
  worked: MuscleWorkedMarker | null;
  recovery: RecoveryMarker | null;
  onClick: (part: BodyPartMeta) => void;
  onHover?: (part: BodyPartMeta | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // 13-state palette: recovery band drives the hue, volume band
  // drives the brightness/opacity. Hover overrides to cyan.
  const baseColor = bodyPartColor({ recovery, worked, hovered });

  // Volume band drives wireframe opacity too. Light = faint wireframe,
  // heavy = bright wireframe. Lets the user see at a glance which
  // muscles got "real" work vs which were just touched.
  const volumeBand = bandForSetCount(worked?.setCount ?? 0);
  const wireOpacity = hovered
    ? 0.95
    : volumeBand === 'heavy'
    ? 0.85
    : volumeBand === 'moderate'
    ? 0.7
    : volumeBand === 'light'
    ? 0.45
    : 0.3;

  // Recently worked = pulse the wireframe so it draws the eye.
  const recentlyWorked = worked && (Date.now() - new Date(worked.workedAt).getTime()) < 36 * 60 * 60 * 1000;
  const emissiveBoost = hovered
    ? 0.85
    : recentlyWorked
    ? 0.55 + (volumeBand === 'heavy' ? 0.2 : 0)
    : 0.25;

  return (
    <group position={part.position}>
      {/* Wireframe body */}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          onHover?.(part);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          onHover?.(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(part);
        }}
      >
        <boxGeometry args={part.size} />
        <meshStandardMaterial
          color="#1a1c26"
          emissive={baseColor}
          emissiveIntensity={emissiveBoost}
          metalness={0.7}
          roughness={0.3}
          transparent
          opacity={hovered ? 0.95 : 0.78}
        />
      </mesh>

      {/* Outer wireframe outline */}
      <mesh>
        <boxGeometry args={part.size} />
        <meshBasicMaterial
          color={baseColor}
          wireframe
          transparent
          opacity={wireOpacity}
        />
      </mesh>

      {/* Pain marker — magenta/red sphere, ALWAYS shown when pain exists.
          Sits on top of the recovery wireframe so you can see
          "overworked AND hurting" simultaneously. */}
      {pain && (
        <group position={[0, part.size[1] / 2 + 0.18, 0]}>
          <mesh>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color={intensityToColor(pain.intensity)} />
          </mesh>
          {/* Glow halo around the pain marker */}
          <mesh>
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshBasicMaterial
              color={intensityToColor(pain.intensity)}
              transparent
              opacity={0.25}
            />
          </mesh>
        </group>
      )}

      {/* Recently-worked marker — small dot ABOVE the part, color
          matches the recovery band so the visual story is
          consistent. Only shown if no pain marker is taking the
          top spot. Pulses (sin-based scale) so the eye is drawn
          to recently-trained parts on the hologram. */}
      {recentlyWorked && (
        <PulseDot
          position={[pain ? 0.18 : 0, part.size[1] / 2 + (pain ? 0.18 : 0.1), 0]}
          radius={volumeBand === 'heavy' ? 0.07 : volumeBand === 'moderate' ? 0.055 : 0.04}
          color={baseColor}
        />
      )}
    </group>
  );
}

export function intensityToColor(intensity: number): string {
  if (intensity <= 0) return '#14d6e8';
  if (intensity <= 3) return '#ffd28a'; // mild — light orange
  if (intensity <= 6) return '#ff9a3c'; // moderate — orange
  if (intensity <= 8) return '#ff6420'; // high — dark orange
  return '#ff3030';                     // severe — red
}

export function intensityLabel(intensity: number): string {
  if (intensity === 0) return 'none';
  if (intensity <= 3) return 'mild';
  if (intensity <= 6) return 'moderate';
  if (intensity <= 8) return 'high';
  return 'severe';
}

// ============================================================
// 13-state body avatar palette
// ============================================================
//
// Encodes TWO axes into a single color:
//   1. Recovery state (HUE): rested → primed → active → fatigued → overloaded
//   2. Volume intensity (SATURATION/BRIGHTNESS): none → light → moderate → heavy
//
// This lets the user see at a glance:
//   - Was this muscle worked? (intensity > none)
//   - How hard? (light / moderate / heavy)
//   - Is it recovered? (rested = past work fully digested;
//                       active = past work, super-compensating;
//                       fatigued = past work, still digesting;
//                       overloaded = too much, back off)
//   - No work? (rested, none = cool slate)
//
// Pastel/desaturated tones keep the body readable as an
// abstract 3D model — pure-saturated colors would dominate
// and lose the wireframe structure.
//
// CSS hex values are kept in sync with the Tailwind colors used
// elsewhere (cyan-300/400/500, lime-400, amber-300/400/500,
// rose-400/500) so the body avatar matches the rest of the
// dashboard's color language.

export const PALETTE_HEX: Record<RecoveryBand, Record<VolumeBand, string>> = {
  // Cool slate. "I haven't touched this muscle recently."
  // Lighter (slate-400 #94a3b8) so untrained parts read clearly
  // against the deep navy bg without being mistaken for one of
  // the recovery hues.
  untrained: {
    none:     '#94a3b8',  // slate-400
    light:    '#94a3b8',
    moderate: '#94a3b8',
    heavy:    '#94a3b8',
  },
  // Cyan — past work fully digested; you're supercompensated.
  primed: {
    none:     '#67e8f9',
    light:    '#67e8f9',  // cyan-300
    moderate: '#22d3ee',  // cyan-400
    heavy:    '#0891b2',  // cyan-600
  },
  // Green — recent work, digesting fine.
  recovering: {
    none:     '#86efac',
    light:    '#86efac',  // green-300
    moderate: '#4ade80',  // green-400
    heavy:    '#16a34a',  // green-600
  },
  // Amber — recent work, not recovered yet.
  fatigued: {
    none:     '#fcd34d',
    light:    '#fcd34d',  // amber-300
    moderate: '#f59e0b',  // amber-500
    heavy:    '#b45309',  // amber-700
  },
  // Red/rose — spent. The training stimulus landed; this part
  // is now asking for 24-48h before the next session hits it.
  spent: {
    none:     '#fb7185',
    light:    '#fb7185',  // rose-400
    moderate: '#f43f5e',  // rose-500
    heavy:    '#9f1239',  // rose-800
  },
};

/**
 * Single entry point for body-part color. Combines recovery +
 * volume into the 13-state palette. Hover overrides to cyan.
 */
export function bodyPartColor(input: {
  recovery: RecoveryMarker | null;
  worked: MuscleWorkedMarker | null;
  hovered?: boolean;
}): string {
  if (input.hovered) return '#14d6e8';
  if (!input.worked) {
    // No recent work — show untrained color (the only band that
    // matters in the "no work" case).
    return PALETTE_HEX.untrained.none;
  }
  const recoveryBand: RecoveryBand = input.recovery
    ? bandForRecoveryScore(input.recovery.score)
    : 'recovering'; // default: assume recovering when no recovery data
  const volumeBand = bandForSetCount(input.worked.setCount ?? 0);
  return PALETTE_HEX[recoveryBand][volumeBand];
}

/**
 * Recovery score (0-100) to a single hue — used by the hover
 * card and the recovery list where we don't care about volume.
 * Kept for back-compat with any older callers.
 */
export function recoveryToColor(score: number): string {
  // Use the heaviest-intensity row so the color reads as "this
  // muscle's overall state" rather than muted.
  const band = bandForRecoveryScore(score);
  if (band === 'untrained') return PALETTE_HEX.untrained.none;
  if (band === 'primed') return PALETTE_HEX.primed.heavy;
  if (band === 'recovering') return PALETTE_HEX.recovering.heavy;
  if (band === 'fatigued') return PALETTE_HEX.fatigued.heavy;
  return PALETTE_HEX.spent.heavy;
}

export function recoveryLabel(score: number): string {
  return bandForRecoveryScore(score);
}

/**
 * Map a (recovery, volume) pair to a human-readable summary.
 * Used in the hover card + click-list modal.
 */
export function partSummary(input: {
  recovery: RecoveryMarker | null;
  worked: MuscleWorkedMarker | null;
}): string {
  if (!input.worked) return 'untrained · no recent work';
  const r = input.recovery ? bandForRecoveryScore(input.recovery.score) : 'recovering';
  const v = bandForSetCount(input.worked.setCount ?? 0);
  return `${r} · ${v}`;
}
