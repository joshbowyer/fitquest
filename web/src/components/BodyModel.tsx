import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export type BodyPartId =
  | 'HEAD' | 'NECK' | 'CHEST'
  | 'BACK_UPPER' | 'BACK_LOWER'
  | 'SHOULDER_L' | 'SHOULDER_R'
  | 'BICEP_L' | 'BICEP_R'
  | 'FOREARM_L' | 'FOREARM_R'
  | 'WRIST_L' | 'WRIST_R'
  | 'HIP_L' | 'HIP_R'
  | 'QUAD_L' | 'QUAD_R'
  | 'HAMSTRING_L' | 'HAMSTRING_R'
  | 'KNEE_L' | 'KNEE_R'
  | 'CALF_L' | 'CALF_R'
  | 'ANKLE_L' | 'ANKLE_R'
  | 'FOOT_L' | 'FOOT_R';

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
};

export const BODY_PARTS: BodyPartMeta[] = [
  // Head + neck
  { id: 'HEAD',       label: 'Head',       position: [0,    2.0,  0],   size: [0.5, 0.55, 0.5], side: 'CENTER' },
  { id: 'NECK',       label: 'Neck',       position: [0,    1.55, 0],   size: [0.18, 0.18, 0.18], side: 'CENTER' },
  // Torso
  { id: 'CHEST',      label: 'Chest',      position: [0,    1.15, 0.1], size: [0.85, 0.7, 0.35], side: 'FRONT' },
  { id: 'BACK_UPPER', label: 'Upper Back', position: [0,    1.2, -0.18], size: [0.85, 0.4, 0.1], side: 'BACK' },
  { id: 'BACK_LOWER', label: 'Lower Back', position: [0,    0.6, -0.18], size: [0.6, 0.5, 0.1], side: 'BACK' },
  // Shoulders + arms
  { id: 'SHOULDER_L', label: 'Left Shoulder',  position: [-0.55, 1.35, 0],   size: [0.22, 0.22, 0.22], side: 'LEFT' },
  { id: 'SHOULDER_R', label: 'Right Shoulder', position: [ 0.55, 1.35, 0],   size: [0.22, 0.22, 0.22], side: 'RIGHT' },
  { id: 'BICEP_L',    label: 'Left Bicep',     position: [-0.7,  0.95, 0.05], size: [0.18, 0.45, 0.18], side: 'LEFT' },
  { id: 'BICEP_R',    label: 'Right Bicep',    position: [ 0.7,  0.95, 0.05], size: [0.18, 0.45, 0.18], side: 'RIGHT' },
  { id: 'FOREARM_L',  label: 'Left Forearm',   position: [-0.75, 0.4, 0.05],  size: [0.16, 0.45, 0.16], side: 'LEFT' },
  { id: 'FOREARM_R',  label: 'Right Forearm',  position: [ 0.75, 0.4, 0.05],  size: [0.16, 0.45, 0.16], side: 'RIGHT' },
  { id: 'WRIST_L',    label: 'Left Wrist',     position: [-0.78, -0.05, 0.05], size: [0.12, 0.12, 0.12], side: 'LEFT' },
  { id: 'WRIST_R',    label: 'Right Wrist',    position: [ 0.78, -0.05, 0.05], size: [0.12, 0.12, 0.12], side: 'RIGHT' },
  // Hips + legs
  { id: 'HIP_L',      label: 'Left Hip',       position: [-0.25, 0.35, 0],   size: [0.22, 0.18, 0.25], side: 'LEFT' },
  { id: 'HIP_R',      label: 'Right Hip',      position: [ 0.25, 0.35, 0],   size: [0.22, 0.18, 0.25], side: 'RIGHT' },
  { id: 'QUAD_L',     label: 'Left Quad',      position: [-0.27, -0.05, 0.1], size: [0.22, 0.55, 0.22], side: 'LEFT' },
  { id: 'QUAD_R',     label: 'Right Quad',     position: [ 0.27, -0.05, 0.1], size: [0.22, 0.55, 0.22], side: 'RIGHT' },
  { id: 'HAMSTRING_L', label: 'Left Hamstring', position: [-0.27, -0.05, -0.12], size: [0.22, 0.55, 0.18], side: 'LEFT' },
  { id: 'HAMSTRING_R', label: 'Right Hamstring', position: [ 0.27, -0.05, -0.12], size: [0.22, 0.55, 0.18], side: 'RIGHT' },
  { id: 'KNEE_L',     label: 'Left Knee',      position: [-0.27, -0.65, 0.05], size: [0.2, 0.2, 0.2], side: 'LEFT' },
  { id: 'KNEE_R',     label: 'Right Knee',     position: [ 0.27, -0.65, 0.05], size: [0.2, 0.2, 0.2], side: 'RIGHT' },
  { id: 'CALF_L',     label: 'Left Calf',      position: [-0.27, -1.15, -0.05], size: [0.18, 0.45, 0.18], side: 'LEFT' },
  { id: 'CALF_R',     label: 'Right Calf',     position: [ 0.27, -1.15, -0.05], size: [0.18, 0.45, 0.18], side: 'RIGHT' },
  { id: 'ANKLE_L',    label: 'Left Ankle',     position: [-0.27, -1.65, 0],   size: [0.16, 0.12, 0.16], side: 'LEFT' },
  { id: 'ANKLE_R',    label: 'Right Ankle',    position: [ 0.27, -1.65, 0],   size: [0.16, 0.12, 0.16], side: 'RIGHT' },
  { id: 'FOOT_L',     label: 'Left Foot',      position: [-0.27, -1.78, 0.15], size: [0.16, 0.1, 0.35], side: 'LEFT' },
  { id: 'FOOT_R',     label: 'Right Foot',     position: [ 0.27, -1.78, 0.15], size: [0.16, 0.1, 0.35], side: 'RIGHT' },
];

export type PainMarker = {
  bodyPart: BodyPartId;
  intensity: number;  // 0-10
  count: number;
  latestAt: string;
};

type Props = {
  markers: PainMarker[];
  onPartClick: (part: BodyPartMeta) => void;
  onPartHover?: (part: BodyPartMeta | null) => void;
  rotate?: boolean;
  height?: number;
  className?: string;
};

/**
 * 3D Tron-style holographic body model. Each body part is a
 * wireframe box mesh. Hovering highlights it; clicking opens
 * the pain log modal. Pain markers (intensity-colored spheres)
 * overlay on body parts that have logged pain.
 *
 * The whole model rotates slowly on the Y axis when `rotate` is
 * true. Click events use the R3F event system (PointerEvent).
 */
export function BodyModel({
  markers,
  onPartClick,
  onPartHover,
  rotate = true,
  height = 480,
  className,
}: Props) {
  const markerByPart = useMemo(() => {
    const m = new Map<BodyPartId, PainMarker>();
    for (const marker of markers) m.set(marker.bodyPart, marker);
    return m;
  }, [markers]);

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
          {BODY_PARTS.map((part) => (
            <BodyPartMesh
              key={part.id}
              part={part}
              marker={markerByPart.get(part.id) ?? null}
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
  marker,
  onClick,
  onHover,
}: {
  part: BodyPartMeta;
  marker: PainMarker | null;
  onClick: (part: BodyPartMeta) => void;
  onHover?: (part: BodyPartMeta | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Pain intensity color: green -> yellow -> red
  const intensityColor = marker ? intensityToColor(marker.intensity) : '#14d6e8';

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
          emissive={hovered ? '#14d6e8' : intensityColor}
          emissiveIntensity={hovered ? 0.7 : 0.35}
          metalness={0.7}
          roughness={0.3}
          transparent
          opacity={hovered ? 0.95 : 0.75}
          wireframe={false}
        />
      </mesh>

      {/* Outer wireframe outline (always visible) */}
      <mesh>
        <boxGeometry args={part.size} />
        <meshBasicMaterial
          color={hovered ? '#14d6e8' : intensityColor}
          wireframe
          transparent
          opacity={hovered ? 0.9 : 0.55}
        />
      </mesh>

      {/* Pain marker (glowing sphere) */}
      {marker && (
        <mesh position={[0, part.size[1] / 2 + 0.12, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshBasicMaterial color={intensityToColor(marker.intensity)} />
        </mesh>
      )}
    </group>
  );
}

export function intensityToColor(intensity: number): string {
  if (intensity <= 0) return '#14d6e8';
  if (intensity <= 3) return '#9bff5c'; // mild — lime
  if (intensity <= 6) return '#ffc34d'; // moderate — goldenrod
  if (intensity <= 8) return '#f55cc4'; // high — magenta
  return '#ff3060';                     // severe — red
}

export function intensityLabel(intensity: number): string {
  if (intensity === 0) return 'none';
  if (intensity <= 3) return 'mild';
  if (intensity <= 6) return 'moderate';
  if (intensity <= 8) return 'high';
  return 'severe';
}
