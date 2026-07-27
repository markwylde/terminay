import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deriveUiBundleId, UiBundleError, validateUiBundleManifest, verifyUiBundle } from "../dist/index.js";

function makeManifest() {
  const files = new Map([
    ["index.html", new TextEncoder().encode("<!doctype html><script src=\"/assets/app.js\"></script>")],
    ["assets/app.js", new TextEncoder().encode("console.log('terminay');")],
  ]);
  const provisional = [...files].map(([relative, body]) => ({
    contentType: relative.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8",
    hash: hash(body),
    path: `/remote-app/provisional/${relative}`,
    size: body.byteLength,
  }));
  const bundleId = deriveUiBundleId(provisional);
  const assets = provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) }));
  return {
    manifest: {
      schemaVersion: 1,
      bundleId,
      entryPath: `/remote-app/${bundleId}/index.html`,
      protocolVersion: "1",
      serverVersion: "1.2.3",
      assets,
    },
    files: new Map([...files].map(([relative, body]) => [`/remote-app/${bundleId}/${relative}`, body])),
  };
}

test("UI bundle verification validates the exact namespace and serves an immutable snapshot", async () => {
  const { manifest, files } = makeManifest();
  const verified = await verifyUiBundle(manifest, { read: (path) => files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) });
  assert.equal(verified.manifest.entryPath, manifest.entryPath);
  assert.deepEqual([...verified.manifest.assets].map((asset) => asset.path), [...manifest.assets].map((asset) => asset.path));

  const first = verified.read(manifest.entryPath);
  first[0] = first[0] ^ 0xff;
  assert.equal(new TextDecoder().decode(verified.read(manifest.entryPath)), "<!doctype html><script src=\"/assets/app.js\"></script>");
  assert.throws(() => verified.read(`${manifest.entryPath}.missing`), (error) => error instanceof UiBundleError && error.code === "not_found");
});

test("UI bundle validation rejects traversal, duplicate, and namespace escape paths", () => {
  const { manifest } = makeManifest();
  assert.throws(() => validateUiBundleManifest({ ...manifest, assets: [{ ...manifest.assets[0], path: `/remote-app/${manifest.bundleId}/assets/../secret` }, manifest.assets[1]] }), /unsafe segment/);
  assert.throws(() => validateUiBundleManifest({ ...manifest, assets: [manifest.assets[0], manifest.assets[0]] }), /duplicate/);
  assert.throws(() => validateUiBundleManifest({ ...manifest, entryPath: "/remote-app/other/index.html" }), /outside its bundle namespace/);
});

test("UI bundle verification enforces byte limits and detects replacement content", async () => {
  const { manifest, files } = makeManifest();
  assert.throws(() => validateUiBundleManifest(manifest, { maxAssetBytes: 1 }), /exceeds the 1-byte limit/);
  const replacement = new TextEncoder().encode("different");
  const original = files.get(manifest.entryPath);
  files.set(manifest.entryPath, replacement);
  await assert.rejects(
    verifyUiBundle(manifest, { read: (path) => files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) }),
    (error) => error instanceof UiBundleError && error.code === "integrity" && /size mismatch|hash mismatch/.test(error.message),
  );
  files.set(manifest.entryPath, original);
});

test("UI bundle id is deterministic over relative paths and content hashes", () => {
  const { manifest } = makeManifest();
  const shuffled = [...manifest.assets].reverse();
  assert.equal(deriveUiBundleId(shuffled, manifest.bundleId), manifest.bundleId);
  const changed = shuffled.map((asset, index) => index === 0 ? { ...asset, hash: hash(new TextEncoder().encode("changed")) } : asset);
  assert.notEqual(deriveUiBundleId(changed, manifest.bundleId), manifest.bundleId);
});

function hash(bytes) { return createHash("sha256").update(bytes).digest("base64url"); }
