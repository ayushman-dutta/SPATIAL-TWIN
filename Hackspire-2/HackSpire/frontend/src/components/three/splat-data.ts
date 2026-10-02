/** Binary point preview data; this is not a covariance-based Gaussian renderer. */
export function parseSplatBuffers(splatBuffer: ArrayBuffer, classesBuffer: ArrayBuffer) {
  if (splatBuffer.byteLength === 0 || splatBuffer.byteLength % 32 !== 0) {
    throw new Error("Invalid .splat file: expected non-empty 32-byte records.");
  }
  const count = splatBuffer.byteLength / 32;
  if (classesBuffer.byteLength !== count) {
    throw new Error("Scene and class sidecar do not match. Re-export both files together.");
  }
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const view = new DataView(splatBuffer);
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = view.getFloat32(i * 32 + axis * 4, true);
      if (!Number.isFinite(value)) {
        throw new Error("Scene contains invalid point coordinates. Reconstruct or re-export it.");
      }
      positions[i * 3 + axis] = value;
      colors[i * 3 + axis] = view.getUint8(i * 32 + 24 + axis) / 255;
    }
    alphas[i] = view.getUint8(i * 32 + 27) / 255;
  }
  return { positions, colors, alphas, classes: new Uint8Array(classesBuffer) };
}

export async function loadSplatData(splatUrl: string, classesUrl: string, signal?: AbortSignal) {
  const options: RequestInit = { cache: "no-store", ...(signal ? { signal } : {}) };
  const [splat, classes] = await Promise.all([
    fetch(splatUrl, options),
    fetch(classesUrl, options),
  ]);
  if (!splat.ok || !classes.ok) {
    throw new Error(
      `Could not load scene assets (scene HTTP ${splat.status}, classes HTTP ${classes.status}).`,
    );
  }
  return parseSplatBuffers(await splat.arrayBuffer(), await classes.arrayBuffer());
}

/** Object edits change overlays, not the underlying scene asset. */
export function isSceneAssetUpdate(diff: { updated?: unknown }) {
  return Array.isArray(diff.updated) && diff.updated.includes("all");
}
