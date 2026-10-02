import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Frustum, Group, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { fitSceneCamera } from "../src/components/three/camera-fit.ts";
import {
  isSceneAssetUpdate,
  loadSplatData,
  parseSplatBuffers,
} from "../src/components/three/splat-data.ts";

function splat(x = 12, alpha = 255) {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  [x, 20, 7].forEach((value, axis) => view.setFloat32(axis * 4, value, true));
  [100, 150, 200, alpha].forEach((value, channel) => view.setUint8(24 + channel, value));
  return buffer;
}

for (const aspect of [0.4, 1, 2]) {
  test(`camera includes every scene corner at aspect ${aspect}`, () => {
    // Current scene's approximate extent: the old distance 30 and zoom cap 200 fail.
    const raw = new Box3(new Vector3(-80, -74, -2), new Vector3(77, 66, 33));
    const root = new Group();
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const bounds = raw.clone().applyMatrix4(root.matrixWorld);
    const fit = fitSceneCamera(bounds, 42, aspect);
    assert.ok(fit.distance > 200);
    assert.ok(fit.maxDistance > fit.distance);
    assert.ok(
      fit.target.distanceTo(raw.getCenter(new Vector3()).applyMatrix4(root.matrixWorld)) < 1e-9,
    );
    const camera = new PerspectiveCamera(42, aspect, fit.near, fit.far);
    camera.position
      .copy(fit.target)
      .add(new Vector3(1, 1, 1).normalize().multiplyScalar(fit.distance));
    camera.lookAt(fit.target);
    camera.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          assert.ok(frustum.containsPoint(new Vector3(x, y, z)));
        }
      }
    }
  });
}

test("small scenes have finite camera limits and invalid bounds are rejected", () => {
  const bounds = new Box3(new Vector3(1, 1, 1), new Vector3(1, 1, 1));
  const fit = fitSceneCamera(bounds, 42, 1);
  assert.ok(fit.near > 0 && fit.minDistance < fit.distance && fit.distance < fit.far);
  assert.throws(() => fitSceneCamera(new Box3(), 42, 1), /invalid/);
  assert.throws(() => fitSceneCamera(bounds, 42, 0), /invalid/);
  assert.throws(() => fitSceneCamera(bounds, NaN, 1), /invalid/);
});

test("splat parser retains coordinates, class order and source opacity", () => {
  const data = parseSplatBuffers(splat(12, 128), new Uint8Array([3]).buffer);
  assert.deepEqual([...data.positions], [12, 20, 7]);
  assert.deepEqual([...data.classes], [3]);
  assert.ok(Math.abs(data.alphas[0]! - 128 / 255) < 1e-6);
});

test("splat parser rejects empty/truncated records, mismatched sidecars and NaN", () => {
  assert.throws(() => parseSplatBuffers(new ArrayBuffer(0), new ArrayBuffer(0)), /32-byte/);
  assert.throws(() => parseSplatBuffers(new ArrayBuffer(33), new ArrayBuffer(1)), /32-byte/);
  assert.throws(() => parseSplatBuffers(splat(), new ArrayBuffer(2)), /sidecar/);
  assert.throws(() => parseSplatBuffers(splat(NaN), new ArrayBuffer(1)), /coordinates/);
});

test("scene replacement reloads while normal edits do not invalidate the asset", () => {
  assert.equal(isSceneAssetUpdate({ updated: ["all"] }), true);
  assert.equal(isSceneAssetUpdate({ updated: ["1", "2"] }), false);
  assert.equal(isSceneAssetUpdate({ updated: "all" }), false);
  assert.equal(isSceneAssetUpdate({}), false);
});

test("repeated loads fetch fresh scene AND sidecar and pass cancellation signal", async (t) => {
  let revision = 1;
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls.push(options);
    return new Response(url.endsWith(".splat") ? splat(revision) : new Uint8Array([revision]));
  });
  const controller = new AbortController();
  const first = await loadSplatData("/scene.splat", "/scene.classes.u8", controller.signal);
  revision = 2;
  const second = await loadSplatData("/scene.splat", "/scene.classes.u8", controller.signal);
  assert.equal(first.positions[0], 1);
  assert.equal(second.positions[0], 2);
  assert.equal(second.classes[0], 2);
  assert.equal(calls.length, 4);
  assert.ok(
    calls.every((options) => options.cache === "no-store" && options.signal === controller.signal),
  );
});

test("asset HTTP errors do not masquerade as valid scene data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  await assert.rejects(loadSplatData("/scene.splat", "/classes.u8"), /HTTP 404/);
});
