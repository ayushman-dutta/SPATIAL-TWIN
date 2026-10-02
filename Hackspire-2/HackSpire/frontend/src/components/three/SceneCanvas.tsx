import { Canvas, type CanvasProps } from "@react-three/fiber";
import { useInView, useReducedMotion } from "motion/react";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { SCENE_COLORS } from "./scene-utils";

interface SceneCanvasProps {
  children: ReactNode;
  className?: string;
  camera?: CanvasProps["camera"];
  /** Render even when offscreen (rarely needed). */
  alwaysOn?: boolean;
  /** When true, converts pipeline Z-up (PostGIS SRID 0) to Three.js Y-up via rotation */
  zUp?: boolean;
}

/**
 * Canvas wrapper that only renders while visible — keeps the landing page
 * light on laptops and phones.
 */
export function SceneCanvas({
  children,
  className,
  camera,
  alwaysOn = false,
  zUp = false,
}: SceneCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const inView = useInView(host, { margin: "160px" });
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const frameloop = alwaysOn || inView ? (reduced ? "demand" : "always") : "demand";

  return (
    <div ref={host} className={className}>
      {mounted && (
        <Canvas
          frameloop={frameloop}
          dpr={[1, 2]}
          gl={{
            antialias: true,
            powerPreference: "high-performance",
            alpha: true,
          }}
          camera={camera ?? { position: [0, 8, 22], fov: 42 }}
        >
          <color attach="background" args={[SCENE_COLORS.background]} />
          <fog attach="fog" args={[SCENE_COLORS.background, 20, 75]} />
          <ambientLight intensity={0.85} color="#c8e6dc" />
          <directionalLight position={[12, 22, 14]} intensity={1.4} color="#ffffff" />
          <directionalLight
            position={[-14, 8, -10]}
            intensity={0.7}
            color={SCENE_COLORS.accent}
          />
          <pointLight position={[0, 4, 0]} intensity={0.5} color={SCENE_COLORS.accent} distance={25} />

          {/* Frame Contract: Only rotate if data is pipeline Z-up */}
          {zUp ? (
            <group name="sceneRoot" rotation={[Math.PI / -2, 0, 0]}>
              <Suspense fallback={null}>{children}</Suspense>
            </group>
          ) : (
            <Suspense fallback={null}>{children}</Suspense>
          )}
        </Canvas>
      )}
    </div>
  );
}
