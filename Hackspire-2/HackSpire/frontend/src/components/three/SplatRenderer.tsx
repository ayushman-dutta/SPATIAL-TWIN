import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useSpatialStore } from "@/store/spatialStore";
import { API_BASE_URL } from "@/lib/api";
import { loadSplatData } from "./splat-data";

/**
 * SplatRenderer
 *
 * Binary splat loader with a point-cloud preview renderer (not full 3DGS).
 *
 * Beginner Analogy:
 * A 3D digital camera reel:
 * It reads the binary .splat file (which packs 3D positions, scales, and colors into 32 bytes per point)
 * and the .classes.u8 semantic sidecar (1 byte per point identifying whether it is a building, road, tree, or ground).
 * It then renders all 60,000+ points as soft Gaussian splat particles that respect layer visibility toggles.
 *
 * Design Decisions implemented:
 * - D6: Order-preserving binary export + 1:1 index-matched sidecar.
 * - D10 (Plan B): CPU-side alpha masking for instant, bulletproof layer filtering (<2ms).
 * - D11: Child of sceneRoot (Z-up pipeline coordinates).
 */

interface SplatRendererProps {
  splatUrl?: string;
  classesUrl?: string;
  pointSize?: number;
  onBounds?: (bounds: THREE.Box3) => void;
  onError?: (message: string | null) => void;
}

// Custom Gaussian Points Shader
const SplatShader = {
  vertexShader: `
    attribute vec3 color;
    attribute float alpha;
    varying vec3 vColor;
    varying float vAlpha;
    uniform float pointSize;

    void main() {
      vColor = color;
      vAlpha = alpha;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      // Size attenuation based on distance from camera
      gl_PointSize = max(2.0, pointSize * (150.0 / -mvPosition.z));
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      // Soft circular Gaussian splat profile
      vec2 coord = gl_PointCoord - vec2(0.5);
      float distSq = dot(coord, coord);
      if (distSq > 0.25) discard;
      float gaussianAlpha = exp(-distSq * 8.0) * vAlpha;
      if (gaussianAlpha < 0.02) discard;
      gl_FragColor = vec4(vColor, gaussianAlpha);
    }
  `,
};

export function SplatRenderer({
  splatUrl = "/static/scene.splat",
  classesUrl = "/static/scene.classes.u8",
  pointSize = 3.5,
  onBounds,
  onError,
}: SplatRendererProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [material, setMaterial] = useState<THREE.ShaderMaterial | null>(null);

  const classesRef = useRef<Uint8Array | null>(null);
  const alphasRef = useRef<Float32Array | null>(null);
  const baseAlphasRef = useRef<Float32Array | null>(null);

  const { layerVisibility, layerOpacity, soloLayerId, hiddenBboxes, assetVersion } =
    useSpatialStore();

  // 1. Fetch & parse real binary .splat and .classes.u8 files
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    onError?.(null);

    const loadData = async () => {
      try {
        console.log(`[SplatRenderer] Fetching ${splatUrl} and ${classesUrl}...`);

        // Resolve absolute URL if relative to ensure dev server & API proxy work
        const resolvedSplatUrl = splatUrl.startsWith("http")
          ? splatUrl
          : `${API_BASE_URL}${splatUrl}`;
        const resolvedClassesUrl = classesUrl.startsWith("http")
          ? classesUrl
          : `${API_BASE_URL}${classesUrl}`;

        const data = await loadSplatData(resolvedSplatUrl, resolvedClassesUrl, controller.signal);
        if (isCancelled) return;

        const { positions, colors, alphas } = data;
        classesRef.current = data.classes;
        baseAlphasRef.current = alphas.slice();
        alphasRef.current = alphas;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geom.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

        const mat = new THREE.ShaderMaterial({
          vertexShader: SplatShader.vertexShader,
          fragmentShader: SplatShader.fragmentShader,
          uniforms: {
            pointSize: { value: pointSize },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
        });

        setGeometry(geom);
        setMaterial(mat);
        console.log("[SplatRenderer] Successfully loaded and initialized scene splats!");
      } catch (err) {
        if (isCancelled) return;
        setGeometry(null);
        setMaterial(null);
        const message = err instanceof Error ? err.message : "Could not load the scene.";
        onError?.(message);
        console.error("[SplatRenderer] Error loading splats:", err);
      }
    };

    loadData();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [splatUrl, classesUrl, pointSize, assetVersion, onError]);

  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );
  useEffect(
    () => () => {
      material?.dispose();
    },
    [material],
  );

  useEffect(() => {
    const points = pointsRef.current;
    if (!geometry || !points) return;
    geometry.computeBoundingBox();
    points.updateWorldMatrix(true, false);
    // Use the actual sceneRoot transform once, rather than duplicating axis math.
    if (geometry.boundingBox) {
      onBounds?.(geometry.boundingBox.clone().applyMatrix4(points.matrixWorld));
    }
  }, [geometry, onBounds]);

  // 2. CPU-side Semantic Layer Filtering (Decision D10 Plan B)
  useFrame(() => {
    if (!geometry || !classesRef.current || !alphasRef.current) return;

    const alphaAttr = geometry.attributes["alpha"] as THREE.BufferAttribute | undefined;
    if (!alphaAttr) return;

    const classes = classesRef.current;
    const alphas = alphasRef.current;
    let changed = false;

    // Semantic class mapping:
    // 0: Structure/Buildings
    // 1: Terrain
    // 2: Road
    // 3: Vegetation
    const buildingsVisible = soloLayerId
      ? soloLayerId === "buildings"
      : (layerVisibility.buildings ?? true);
    const terrainVisible = soloLayerId
      ? soloLayerId === "terrain"
      : (layerVisibility.terrain ?? true);
    const roadsVisible = soloLayerId ? soloLayerId === "roads" : (layerVisibility.roads ?? true);
    const vegVisible = soloLayerId
      ? soloLayerId === "vegetation"
      : (layerVisibility.vegetation ?? true);

    const bOpacity = layerOpacity.buildings ?? 1.0;
    const tOpacity = layerOpacity.terrain ?? 1.0;
    const rOpacity = layerOpacity.roads ?? 1.0;
    const vOpacity = layerOpacity.vegetation ?? 1.0;

    const positions = geometry.attributes["position"] as THREE.BufferAttribute | undefined;

    // Mask splats that fall inside hidden bounding boxes (edited structures)
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      let targetAlpha = 1.0;

      if (cls === 0) {
        targetAlpha = buildingsVisible ? bOpacity : 0.0;
        // If building splat falls inside an edited structure's bounding box, mask it out
        if (targetAlpha > 0.0 && hiddenBboxes && hiddenBboxes.length > 0 && positions) {
          const px = positions.getX(i);
          const py = positions.getY(i);
          for (const bbox of hiddenBboxes) {
            if (px >= bbox.min_x && px <= bbox.max_x && py >= bbox.min_y && py <= bbox.max_y) {
              targetAlpha = 0.0;
              break;
            }
          }
        }
      } else if (cls === 1) {
        targetAlpha = terrainVisible ? tOpacity : 0.0;
      } else if (cls === 2) {
        targetAlpha = roadsVisible ? rOpacity : 0.0;
      } else if (cls === 3) {
        targetAlpha = vegVisible ? vOpacity : 0.0;
      }

      targetAlpha *= baseAlphasRef.current?.[i] ?? 1;
      if (alphas[i] !== targetAlpha) {
        alphas[i] = targetAlpha;
        changed = true;
      }
    }

    if (changed) {
      alphaAttr.needsUpdate = true;
    }
  });

  if (!geometry || !material) {
    return null;
  }

  return (
    <group name="splatRenderer">
      <points ref={pointsRef} geometry={geometry} material={material} />
    </group>
  );
}
