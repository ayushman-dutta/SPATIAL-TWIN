import { Line, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { LayerId, SpatialObject } from "@/types/spatial";
import {
  M_PER_UNIT,
  SCENE_COLORS,
  clamp01,
  hash,
  lerp,
  terrainHeight,
} from "./scene-utils";

export type NumberRef = RefObject<number>;

const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

/* ------------------------------------------------------------------ */
/* Point cloud (Gaussian Splat Representation)                        */
/* ------------------------------------------------------------------ */

interface PointCloudProps {
  progressRef?: NumberRef;
  count?: number;
  spreadX?: number;
  spreadZ?: number;
  size?: number;
  drift?: number;
  convergeSpeed?: number;
}

export function PointCloud({
  progressRef,
  count = 3800,
  spreadX = 42,
  spreadZ = 34,
  size = 0.05,
  drift = 0.08,
}: PointCloudProps) {
  const points = useRef<THREE.Points>(null);
  const mountTime = useRef<number | null>(null);

  const { positions, targets, scatter, colors } = useMemo(() => {
    const targets = new Float32Array(count * 3);
    const scatter = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cyan = new THREE.Color("#06b6d4");
    const emerald = new THREE.Color("#10b981");
    const amber = new THREE.Color("#f59e0b");
    const slate = new THREE.Color("#475569");

    for (let i = 0; i < count; i++) {
      const x = (hash(i * 1.7) - 0.5) * spreadX;
      const z = (hash(i * 3.1 + 5) - 0.5) * spreadZ;
      const y = terrainHeight(x, z) + hash(i * 7.3) * 0.4;
      targets[i * 3] = x;
      targets[i * 3 + 1] = y;
      targets[i * 3 + 2] = z;

      scatter[i * 3] = x + (hash(i * 11.2) - 0.5) * 4;
      scatter[i * 3 + 1] = y + (hash(i * 13.7) - 0.2) * 4;
      scatter[i * 3 + 2] = z + (hash(i * 17.9) - 0.5) * 4;

      // Color mapping: elevation & density gradient
      const normY = (y + 1) / 3.5;
      let c = slate;
      if (normY > 0.6) {
        c = hash(i * 9.2) > 0.4 ? cyan : amber;
      } else if (normY > 0.2) {
        c = hash(i * 9.2) > 0.3 ? emerald : cyan;
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions: targets.slice(), targets, scatter, colors };
  }, [count, spreadX, spreadZ]);

  useFrame((state) => {
    const mesh = points.current;
    if (!mesh) return;
    if (mountTime.current === null) mountTime.current = state.clock.elapsedTime;

    const t = state.clock.elapsedTime;
    const timeSinceMount = Math.min(1, (t - mountTime.current) * 1.5);
    const scrollP = progressRef ? easeOut(progressRef.current ?? 1) : 1;
    const p = Math.max(timeSinceMount, scrollP);

    const attr = mesh.geometry.attributes["position"] as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const wob = Math.sin(t * 0.5 + i * 0.17) * drift * (1 - p * 0.6);
      arr[i3] = lerp(scatter[i3]!, targets[i3]!, p);
      arr[i3 + 1] = lerp(scatter[i3 + 1]!, targets[i3 + 1]!, p) + wob;
      arr[i3 + 2] = lerp(scatter[i3 + 2]!, targets[i3 + 2]!, p);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.88}
        depthWrite={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* Elevation contours                                                  */
/* ------------------------------------------------------------------ */

export function ElevationContours({
  progressRef,
  rows = 24,
  spreadX = 42,
  spreadZ = 32,
}: {
  progressRef?: NumberRef;
  rows?: number;
  spreadX?: number;
  spreadZ?: number;
}) {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const pts: number[] = [];
    const cols = 60;
    for (let r = 0; r <= rows; r++) {
      const z = -spreadZ / 2 + (spreadZ * r) / rows;
      for (let c = 0; c < cols; c++) {
        const x0 = -spreadX / 2 + (spreadX * c) / cols;
        const x1 = -spreadX / 2 + (spreadX * (c + 1)) / cols;
        pts.push(x0, terrainHeight(x0, z) - 0.02, z);
        pts.push(x1, terrainHeight(x1, z) - 0.02, z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [rows, spreadX, spreadZ]);

  useFrame(() => {
    const mat = ref.current?.material as THREE.LineBasicMaterial | undefined;
    if (mat) {
      const p = progressRef ? easeOut(progressRef.current ?? 1) : 1;
      mat.opacity = 0.15 + p * 0.25;
    }
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial
        color={SCENE_COLORS.accentDim}
        transparent
        opacity={0.25}
        depthWrite={false}
      />
    </lineSegments>
  );
}

/* ------------------------------------------------------------------ */
/* Ground grid                                                         */
/* ------------------------------------------------------------------ */

export function GroundGrid({ size = 64, divisions = 32 }: { size?: number; divisions?: number }) {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(
      size,
      divisions,
      "#06b6d4",
      "#1e293b",
    );
    const mat = g.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = 0.45;
    return g;
  }, [size, divisions]);

  return <primitive object={grid} position={[0, -0.05, 0]} />;
}

/* ------------------------------------------------------------------ */
/* Buildings + semantic objects                                        */
/* ------------------------------------------------------------------ */

interface ObjectsProps {
  objects: SpatialObject[];
  progressRef?: NumberRef;
  extrudeRef?: NumberRef;
  extrudeIds?: string[];
  extrudeMeters?: number;
  highlightIds?: string[];
  visibleLayers?: LayerId[];
  selectedId?: string | null;
  interactive?: boolean;
  onSelect?: (o: SpatialObject | null) => void;
  onHover?: (o: SpatialObject | null) => void;
}

export function SpatialObjects({
  objects,
  progressRef,
  extrudeRef,
  extrudeIds = [],
  extrudeMeters = 0,
  highlightIds = [],
  visibleLayers,
  selectedId,
  interactive = false,
  onSelect,
  onHover,
}: ObjectsProps) {
  const shown = useMemo(
    () =>
      objects.filter((o) => !visibleLayers || visibleLayers.includes(o.layer)),
    [objects, visibleLayers],
  );

  return (
    <group>
      {shown.map((o) => (
        <ObjectMesh
          key={o.id}
          object={o}
          progressRef={progressRef}
          extrudeRef={extrudeIds.includes(o.id) ? extrudeRef : undefined}
          extrudeMeters={extrudeMeters}
          highlighted={highlightIds.includes(o.id) || selectedId === o.id}
          interactive={interactive}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </group>
  );
}

function ObjectMesh({
  object,
  progressRef,
  extrudeRef,
  extrudeMeters = 0,
  highlighted,
  interactive,
  onSelect,
  onHover,
}: {
  object: SpatialObject;
  progressRef?: NumberRef | undefined;
  extrudeRef?: NumberRef | undefined;
  extrudeMeters?: number | undefined;
  highlighted: boolean;
  interactive?: boolean | undefined;
  onSelect?: ((o: SpatialObject | null) => void) | undefined;
  onHover?: ((o: SpatialObject | null) => void) | undefined;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);
  const footprintRef = useRef<THREE.LineLoop>(null);

  const baseY = terrainHeight(object.x, object.z);
  const unitHeight = Math.max(0.6, object.height / M_PER_UNIT);
  const seed = hash(object.x * 3.3 + object.z * 7.7);

  const color = useMemo(() => {
    if (object.layer === "vegetation") return "#059669";
    if (object.layer === "infrastructure") return "#3b82f6";
    return "#0f766e"; // High-tech cyan-teal
  }, [object.layer]);

  // Edges geometry for architectural wireframe
  const edgesGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(object.width, 1, object.depth);
    return new THREE.EdgesGeometry(box);
  }, [object.width, object.depth]);

  // Ground footprint points
  const footprintPts = useMemo(() => {
    const hw = object.width / 2;
    const hd = object.depth / 2;
    return [
      [-hw, 0.02, -hd],
      [hw, 0.02, -hd],
      [hw, 0.02, hd],
      [-hw, 0.02, hd],
    ] as [number, number, number][];
  }, [object.width, object.depth]);

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;

    const p = progressRef ? clamp01(progressRef.current * 1.5 + 0.4 - seed * 0.2) : 1;
    const extra = (extrudeRef?.current ?? 0) * (extrudeMeters / M_PER_UNIT);
    const target = Math.max(0.4, unitHeight * easeOut(p) + extra);

    m.scale.y = lerp(m.scale.y, target, 1 - Math.exp(-8 * delta));
    m.position.y = baseY + m.scale.y / 2;

    const mat = m.material as THREE.MeshStandardMaterial;
    if (highlighted) {
      const pulse = 0.7 + Math.sin(state.clock.elapsedTime * 4) * 0.3;
      mat.color.set("#f59e0b");
      mat.emissive.set("#f59e0b");
      mat.emissiveIntensity = pulse * 0.9;
      mat.opacity = 0.85;
    } else {
      mat.color.set(color);
      mat.emissive.set("#06b6d4");
      mat.emissiveIntensity = 0.12;
      mat.opacity = 0.55;
    }
  });

  return (
    <group position={[object.x, 0, object.z]}>
      {/* Ground Footprint Ring (PostGIS representation) */}
      <group position={[0, baseY, 0]}>
        <Line
          points={footprintPts}
          color={highlighted ? "#f59e0b" : "#06b6d4"}
          lineWidth={highlighted ? 2.5 : 1}
          transparent
          opacity={highlighted ? 0.9 : 0.4}
        />
      </group>

      {/* Building Body */}
      <mesh
        ref={mesh}
        position={[0, baseY + unitHeight / 2, 0]}
        scale={[1, unitHeight, 1]}
        onPointerOver={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onHover?.(object);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          if (!interactive) return;
          onHover?.(null);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelect?.(object);
        }}
      >
        <boxGeometry args={[object.width, 1, object.depth]} />
        <meshStandardMaterial
          color={color}
          emissive="#06b6d4"
          emissiveIntensity={0.12}
          roughness={0.25}
          metalness={0.4}
          transparent
          opacity={0.65}
        />

        {/* Architectural Edges */}
        <lineSegments ref={edgesRef} geometry={edgesGeometry}>
          <lineBasicMaterial
            color={highlighted ? "#fef08a" : "#67e8f9"}
            transparent
            opacity={highlighted ? 1 : 0.65}
            linewidth={highlighted ? 2 : 1}
          />
        </lineSegments>
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Roads                                                               */
/* ------------------------------------------------------------------ */

export function Roads({ progressRef }: { progressRef?: NumberRef }) {
  const group = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    const out: { pts: [number, number, number][]; key: string }[] = [];
    for (let i = -3; i <= 3; i++) {
      const z = i * 2.6 - 1.3;
      const pts: [number, number, number][] = [];
      for (let x = -18; x <= 18; x += 1.5)
        pts.push([x, terrainHeight(x, z) + 0.04, z]);
      out.push({ pts, key: `h${i}` });
    }
    for (let i = -2; i <= 2; i++) {
      const x = i * 2.6 - 1.3;
      const pts: [number, number, number][] = [];
      for (let z = -14; z <= 14; z += 1.5)
        pts.push([x, terrainHeight(x, z) + 0.04, z]);
      out.push({ pts, key: `v${i}` });
    }
    return out;
  }, []);

  useFrame(() => {
    if (!group.current) return;
    const p = progressRef ? easeOut(progressRef.current ?? 1) : 1;
    group.current.children.forEach((c) => {
      const mat = (c as THREE.Mesh).material as THREE.Material & {
        opacity: number;
      };
      if (mat) mat.opacity = 0.15 + p * 0.45;
    });
  });

  return (
    <group ref={group}>
      {lines.map((l) => (
        <Line
          key={l.key}
          points={l.pts}
          color="#38bdf8"
          lineWidth={1.5}
          transparent
          opacity={0.4}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Drone Model & Flight Path                                           */
/* ------------------------------------------------------------------ */

export function FlightPath({ speed = 0.05 }: { speed?: number }) {
  const droneGroup = useRef<THREE.Group>(null);
  const rotors = useRef<(THREE.Mesh | null)[]>([]);

  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        Array.from({ length: 40 }, (_, i) => {
          const t = i / 39;
          const a = t * Math.PI * 2;
          return new THREE.Vector3(
            Math.sin(a) * (14 - t * 4),
            5.8 + Math.sin(a * 2) * 0.9,
            Math.cos(a) * (11 - t * 3),
          );
        }),
        true,
      ),
    [],
  );

  const pts = useMemo(
    () => curve.getPoints(160).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [curve],
  );

  useFrame((state) => {
    if (!droneGroup.current) return;
    const t = (state.clock.elapsedTime * speed) % 1;
    const p = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);

    droneGroup.current.position.copy(p);
    droneGroup.current.lookAt(p.clone().add(tangent));

    // Spin rotors
    rotors.current.forEach((r) => {
      if (r) r.rotation.y += 0.4;
    });
  });

  return (
    <group>
      {/* Flight Trajectory Ribbon */}
      <Line
        points={pts}
        color="#38bdf8"
        lineWidth={1.2}
        transparent
        opacity={0.45}
        dashed
        dashSize={0.8}
        gapSize={0.4}
      />

      {/* Drone Rig */}
      <group ref={droneGroup}>
        {/* Chassis */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.35, 0.08, 0.35]} />
          <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Camera Sensor Pod */}
        <mesh position={[0, -0.06, 0.08]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#06b6d4" emissive="#06b6d4" emissiveIntensity={0.8} />
        </mesh>

        {/* 4 Rotor Arms */}
        {[
          [-0.22, 0.02, -0.22],
          [0.22, 0.02, -0.22],
          [-0.22, 0.02, 0.22],
          [0.22, 0.02, 0.22],
        ].map(([rx, ry, rz], idx) => (
          <group key={idx} position={[rx, ry, rz]}>
            {/* Motor arm */}
            <mesh position={[-rx * 0.3, 0, -rz * 0.3]}>
              <cylinderGeometry args={[0.015, 0.015, 0.28]} />
              <meshBasicMaterial color="#334155" />
            </mesh>
            {/* Spinning Rotor */}
            <mesh ref={(el) => (rotors.current[idx] = el)}>
              <cylinderGeometry args={[0.14, 0.14, 0.005, 8]} />
              <meshBasicMaterial color="#67e8f9" transparent opacity={0.6} />
            </mesh>
          </group>
        ))}

        {/* Downward Sensor Scan Cone */}
        <mesh position={[0, -1.8, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[1.4, 3.6, 16, 1, true]} />
          <meshBasicMaterial
            color="#06b6d4"
            transparent
            opacity={0.07}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Camera rig                                                          */
/* ------------------------------------------------------------------ */

interface CameraRigProps {
  progressRef?: NumberRef | undefined;
  from?: [number, number, number];
  to?: [number, number, number];
  lookAt?: [number, number, number];
  sway?: number;
}

export function CameraRig({
  progressRef,
  from = [0, 8, 22],
  to = [0, 4.5, 12],
  lookAt = [0, 1, 0],
  sway = 0.5,
}: CameraRigProps) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(...lookAt), [lookAt]);

  useFrame((state, delta) => {
    const p = progressRef ? easeOut(progressRef.current ?? 0) : 0;
    const t = state.clock.elapsedTime;
    const x = lerp(from[0], to[0], p) + Math.sin(t * 0.12) * sway;
    const y = lerp(from[1], to[1], p) + Math.sin(t * 0.09) * sway * 0.25;
    const z = lerp(from[2], to[2], p);
    camera.position.x = lerp(camera.position.x, x, 1 - Math.exp(-4 * delta));
    camera.position.y = lerp(camera.position.y, y, 1 - Math.exp(-4 * delta));
    camera.position.z = lerp(camera.position.z, z, 1 - Math.exp(-4 * delta));
    camera.lookAt(target);
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Interactive Orbit Camera Controls                                   */
/* ------------------------------------------------------------------ */

export function InteractiveOrbitControls({
  autoRotate = false,
  autoRotateSpeed = 0.6,
  target = [0, 1, 0],
}: {
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  target?: [number, number, number];
}) {
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.7}
      panSpeed={0.7}
      zoomSpeed={0.8}
      minDistance={6}
      maxDistance={45}
      maxPolarAngle={Math.PI / 2 - 0.05} // Keep camera above ground
      autoRotate={autoRotate}
      autoRotateSpeed={autoRotateSpeed}
      target={target}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Coordinate markers                                                  */
/* ------------------------------------------------------------------ */

export function CoordinateMarkers({ count = 7 }: { count?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const x = (hash(i * 5.5) - 0.5) * 30;
        const z = (hash(i * 9.1 + 3) - 0.5) * 22;
        return { x, z, y: terrainHeight(x, z), key: i };
      }),
    [count],
  );

  return (
    <group>
      {items.map((m) => (
        <group key={m.key} position={[m.x, m.y, m.z]}>
          <Line
            points={[
              [0, 0, 0],
              [0, 1.8, 0],
            ]}
            color="#06b6d4"
            lineWidth={1.2}
            transparent
            opacity={0.5}
          />
          <mesh position={[0, 1.8, 0]}>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
