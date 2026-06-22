import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

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

// Muscle-worked marker: a part was trained at the given time.
// Used to show recent activity on the body.
export type MuscleWorkedMarker = {
  bodyPart: BodyPartId;
  workedAt: string;  // ISO timestamp
  // Rough intensity of the work (0-10). Volume-based proxy.
  intensity: number;
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
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0e0f1a']} />
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

  // Color priority: hovered > recovery > cyan default
  // Pain is shown ONLY as an overlay marker (red/magenta sphere)
  // so the user can see "overworked AND has pain" at the same time.
  let baseColor = '#14d6e8'; // default cyan
  if (recovery) baseColor = recoveryToColor(recovery.score);
  if (hovered) baseColor = '#14d6e8';

  // Recently worked + recovery data = keep recovery color but pulse
  const recentlyWorked = worked && (Date.now() - new Date(worked.workedAt).getTime()) < 48 * 60 * 60 * 1000;
  const emissiveBoost = hovered
    ? 0.85
    : recentlyWorked
    ? 0.6
    : 0.3;

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
          opacity={hovered ? 0.95 : 0.55}
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

      {/* Recently-worked marker — small cyan dot ABOVE the part.
          Only shown if no pain marker is taking the top spot. */}
      {recentlyWorked && (
        <mesh position={[pain ? 0.18 : 0, part.size[1] / 2 + (pain ? 0.18 : 0.1), 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color="#14d6e8" />
        </mesh>
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

/**
 * Recovery score (0-100) to color. 100 = fully recovered (lime),
 * 50 = active / mid-recovery (goldenrod), 25 = fatigued (magenta),
 * 0 = overworked (deep purple). Deep purple reads as "too fatigued
 * to train" — distinct from "in pain" which uses the warm pain
 * palette below.
 */
export function recoveryToColor(score: number): string {
  if (score >= 80) return '#9bff5c';
  if (score >= 50) return '#ffc34d';
  if (score >= 25) return '#f55cc4';
  return '#6b1fb8';   // overworked — deep purple
}

export function recoveryLabel(score: number): string {
  if (score >= 80) return 'recovered';
  if (score >= 50) return 'active';
  if (score >= 25) return 'fatigued';
  return 'overworked';
}
