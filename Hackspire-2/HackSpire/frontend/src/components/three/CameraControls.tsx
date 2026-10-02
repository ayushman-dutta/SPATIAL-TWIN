import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import { useSpatialStore } from "@/store/spatialStore";
import { fitSceneCamera } from "./camera-fit";

/**
 * CameraControls
 *
 * Provides orbit/pan/zoom camera interaction using keyboard and mouse.
 * Similar to how 3D modeling software (Blender, CAD) works.
 *
 * Analogy: Like a drone camera that orbits around the scene.
 * - Mouse wheel: zoom in/out
 * - Middle mouse drag: pan
 * - Right mouse drag: orbit
 * - Keyboard: WASD for quick pan
 */

interface CameraControlsProps {
  /** Loaded geometry bounds after the sceneRoot world transform. */
  bounds?: THREE.Box3 | null;
  /** Initial target to orbit around (world Y-up coordinates). */
  initialTarget?: [number, number, number];
  /** Zoom speed */
  zoomSpeed?: number;
  /** Pan speed */
  panSpeed?: number;
  /** Orbit speed */
  orbitSpeed?: number;
}

export function CameraControls({
  bounds,
  initialTarget = [0, 0, 0],
  zoomSpeed = 5,
  panSpeed = 0.01,
  orbitSpeed = 0.005,
}: CameraControlsProps) {
  const { camera, gl, size, scene, invalidate } = useThree();
  const { setCameraTarget } = useSpatialStore();

  const stateRef = useRef({
    target: new THREE.Vector3(...initialTarget),
    phi: Math.PI / 4, // polar angle
    theta: Math.PI / 4, // azimuthal angle
    radius: 30,
    minRadius: 0.1,
    maxRadius: 200,
    isOrbiting: false,
    isPanning: false,
  });

  const keysRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (
      !bounds ||
      !(camera instanceof THREE.PerspectiveCamera) ||
      size.height === 0 ||
      size.width === 0
    )
      return;
    const fit = fitSceneCamera(bounds, camera.getEffectiveFOV(), size.width / size.height);
    const state = stateRef.current;
    state.target.copy(fit.target);
    state.radius = fit.distance;
    state.minRadius = fit.minDistance;
    state.maxRadius = fit.maxDistance;
    camera.near = fit.near;
    camera.far = fit.far;
    camera.updateProjectionMatrix();
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = fit.distance + fit.radius * 2;
      scene.fog.far = fit.far;
    }
    invalidate();
  }, [bounds, camera, size.width, size.height, scene, invalidate]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      )
        return;
      keysRef.current[e.key.toLowerCase()] = true;
      invalidate();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [invalidate]);

  // Handle mouse input
  useEffect(() => {
    const canvas = gl.domElement;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        stateRef.current.isPanning = true; // Middle click or Shift+Left click pans
      } else if (e.button === 0 || e.button === 2) {
        stateRef.current.isOrbiting = true; // Left click drag or Right click drag orbits!
      }
    };

    const handleMouseUp = () => {
      stateRef.current.isOrbiting = false;
      stateRef.current.isPanning = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const state = stateRef.current;

      if (state.isOrbiting) {
        state.theta += e.movementX * orbitSpeed;
        state.phi += e.movementY * orbitSpeed;
        state.phi = Math.max(0.1, Math.min(Math.PI - 0.1, state.phi)); // clamp
      }

      if (state.isPanning) {
        const right = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        camera.getWorldDirection(right);
        right.cross(up).normalize();

        state.target.addScaledVector(right, -e.movementX * panSpeed);
        state.target.addScaledVector(up, e.movementY * panSpeed);
      }
      if (state.isOrbiting || state.isPanning) invalidate();
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = stateRef.current;
      state.radius += e.deltaY * 0.01 * zoomSpeed;
      state.radius = Math.max(state.minRadius, Math.min(state.maxRadius, state.radius));
      invalidate();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [camera, gl, orbitSpeed, panSpeed, zoomSpeed, invalidate]);

  // Keyboard panning (WASD)
  useFrame(() => {
    const state = stateRef.current;
    const panDelta = 0.5;

    if (keysRef.current["w"]) state.target.z -= panDelta;
    if (keysRef.current["s"]) state.target.z += panDelta;
    if (keysRef.current["a"]) state.target.x -= panDelta;
    if (keysRef.current["d"]) state.target.x += panDelta;
    if (["w", "a", "s", "d"].some((key) => keysRef.current[key])) invalidate();

    // Update camera position based on spherical coords
    const x = state.target.x + state.radius * Math.sin(state.phi) * Math.cos(state.theta);
    const y = state.target.y + state.radius * Math.cos(state.phi);
    const z = state.target.z + state.radius * Math.sin(state.phi) * Math.sin(state.theta);

    camera.position.set(x, y, z);
    camera.lookAt(state.target);

    // Store in state
    setCameraTarget([state.target.x, state.target.y, state.target.z]);
  });

  return null;
}
