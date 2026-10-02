import { Box3, Sphere } from "three";

/** Fit the whole scene, not a fixed-size demo. Bounds must be in world space. */
export function fitSceneCamera(bounds: Box3, verticalFov: number, aspect: number) {
  if (
    bounds.isEmpty() ||
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) ||
    !Number.isFinite(verticalFov) ||
    verticalFov <= 0 ||
    verticalFov >= 180 ||
    !Number.isFinite(aspect) ||
    aspect <= 0
  ) {
    throw new Error("Cannot fit camera to invalid scene bounds or viewport.");
  }
  const sphere = bounds.getBoundingSphere(new Sphere());
  const radius = Math.max(sphere.radius, 0.01);
  const halfVertical = (verticalFov * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const distance = (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * 1.15;
  const maxDistance = distance * 5;
  return {
    target: sphere.center,
    radius,
    distance,
    minDistance: radius * 0.02,
    maxDistance,
    near: Math.max(0.0001, radius / 10000),
    far: maxDistance + radius * 4,
  };
}
