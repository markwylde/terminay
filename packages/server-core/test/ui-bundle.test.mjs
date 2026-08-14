import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY, deriveUiBundleId, evaluateUiBundleHostCompatibility, UiBundleError, validateUiBundleManifest, verifyUiBundle } from "../dist/index.js";

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

function makeCurrentManifest() {
  const fixture = makeManifest();
  const hostCompatibility = {
    bootstrap: { minimum: 1, maximum: 1 },
    bundleFormat: { minimum: 1, maximum: 1 },
    hostBridge: { minimum: 1, maximum: 1 },
    byteEndpoint: { minimum: 1, maximum: 1 },
    executionRuntime: { minimum: 120, maximum: 140 },
    requiredCapabilities: { clipboardWrite: { minimum: 1, maximum: 1 } },
    optionalCapabilities: { nativeWindows: { minimum: 1, maximum: 1 } },
  };
  const identity = {
    bundleFormatVersion: 1,
    protocolVersion: fixture.manifest.protocolVersion,
    serverVersion: fixture.manifest.serverVersion,
    hostCompatibility,
  };
  const bundleId = deriveUiBundleId(fixture.manifest.assets, fixture.manifest.bundleId, identity);
  const replace = (path) => path.replace(/\/remote-app\/[^/]+\//u, `/remote-app/${bundleId}/`);
  return {
    ...fixture,
    manifest: {
      ...fixture.manifest,
      bundleId,
      entryPath: replace(fixture.manifest.entryPath),
      bundleFormatVersion: 1,
      hostCompatibility,
      assets: fixture.manifest.assets.map((asset) => ({ ...asset, path: replace(asset.path) })),
    },
  };
}

test("UI bundle verification validates the exact namespace and serves an immutable snapshot", async () => {
  const { manifest, files } = makeManifest();
  const verified = await verifyUiBundle(manifest, { read: (path) => files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) });
  assert.equal(verified.manifest.entryPath, manifest.entryPath);
  assert.equal(verified.manifest.contentSecurityPolicy, DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY);
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
  assert.throws(() => validateUiBundleManifest({ ...manifest, contentSecurityPolicy: "default-src *" }), /content security policy is not supported/);
});

test("UI bundle validation rejects asset-hash substitution under another bundle identity", () => {
  const { manifest } = makeManifest();
  const substituted = {
    ...manifest,
    assets: manifest.assets.map((asset, index) => index === 0
      ? { ...asset, hash: hash(new TextEncoder().encode("attacker-controlled replacement")) }
      : asset),
  };
  assert.throws(
    () => validateUiBundleManifest(substituted),
    (error) => error instanceof UiBundleError && error.code === "integrity" && /bundle id does not match/.test(error.message),
  );
});

test("UI bundle validation rejects a non-HTML session entry document", () => {
  const { manifest } = makeManifest();
  const entryIndex = manifest.assets.findIndex((asset) => asset.path === manifest.entryPath);
  manifest.assets[entryIndex] = { ...manifest.assets[entryIndex], contentType: "application/javascript; charset=utf-8" };
  assert.throws(
    () => validateUiBundleManifest(manifest),
    (error) => error instanceof UiBundleError && error.code === "validation" && /entry path must declare an HTML document/.test(error.message),
  );
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

test("UI bundle verification requires executable entry-document assets to be declared", async () => {
  const { manifest, files } = makeManifest();
  const entry = new TextEncoder().encode("<!doctype html><link rel=\"stylesheet\" href=\"assets/missing.css\"><script src=\"/remote-app/other/app.js\"></script>");
  const entryAsset = manifest.assets.find((asset) => asset.path === manifest.entryPath);
  entryAsset.size = entry.byteLength;
  entryAsset.hash = hash(entry);
  manifest.bundleId = deriveUiBundleId(manifest.assets, manifest.bundleId);
  manifest.entryPath = `/remote-app/${manifest.bundleId}/index.html`;
  manifest.assets = manifest.assets.map((asset) => ({ ...asset, path: asset.path.replace(/\/remote-app\/[^/]+\//u, `/remote-app/${manifest.bundleId}/`) }));
  files.clear();
  files.set(manifest.entryPath, entry);
  for (const asset of manifest.assets.filter((asset) => asset.path !== manifest.entryPath)) files.set(asset.path, new TextEncoder().encode("console.log('terminay');"));
  await assert.rejects(
    verifyUiBundle(manifest, { read: (path) => files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) }),
    (error) => error instanceof UiBundleError && error.code === "integrity" && /undeclared asset/.test(error.message),
  );
});

test("UI bundle verification rejects a malformed UTF-8 session entry document", async () => {
  const { manifest, files } = makeManifest();
  const malformed = new Uint8Array([0xc3, 0x28]);
  const entryAsset = manifest.assets.find((asset) => asset.path === manifest.entryPath);
  entryAsset.size = malformed.byteLength;
  entryAsset.hash = hash(malformed);
  manifest.bundleId = deriveUiBundleId(manifest.assets, manifest.bundleId);
  manifest.entryPath = `/remote-app/${manifest.bundleId}/index.html`;
  manifest.assets = manifest.assets.map((asset) => ({ ...asset, path: asset.path.replace(/\/remote-app\/[^/]+\//u, `/remote-app/${manifest.bundleId}/`) }));
  files.clear();
  files.set(manifest.entryPath, malformed);
  for (const asset of manifest.assets.filter((asset) => asset.path !== manifest.entryPath)) files.set(asset.path, new TextEncoder().encode("console.log('terminay');"));
  await assert.rejects(
    verifyUiBundle(manifest, { read: (path) => files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) }),
    (error) => error instanceof UiBundleError && error.code === "integrity" && /not valid UTF-8/.test(error.message),
  );
});

test("UI bundle id is deterministic over relative paths and content hashes", () => {
  const { manifest } = makeManifest();
  const shuffled = [...manifest.assets].reverse();
  assert.equal(deriveUiBundleId(shuffled, manifest.bundleId), manifest.bundleId);
  const changed = shuffled.map((asset, index) => index === 0 ? { ...asset, hash: hash(new TextEncoder().encode("changed")) } : asset);
  assert.notEqual(deriveUiBundleId(changed, manifest.bundleId), manifest.bundleId);
});

test("bundle compatibility validates the manifest and exact bootstrap before launch", () => {
  const { manifest } = makeCurrentManifest();
  const bootstrap = {
    schemaVersion: 1,
    bootstrapVersion: 1,
    sourceId: "source-a",
    windowId: "window-a",
    serverId: "server-a",
    profileId: "profile-a",
    bundleId: manifest.bundleId,
    applicationProtocolVersion: manifest.protocolVersion,
    hostKind: "desktop",
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    capabilities: { clipboardWrite: 1 },
  };
  const support = {
    bootstrapVersion: 1,
    bundleFormatVersion: 1,
    hostBridgeVersion: 1,
    byteEndpointVersion: 1,
    executionRuntimeVersion: 125,
    capabilities: { clipboardWrite: 1 },
  };
  assert.deepEqual(evaluateUiBundleHostCompatibility(manifest, bootstrap, support), {
    compatible: true,
    unavailableOptionalCapabilities: ["nativeWindows"],
  });
  assert.equal(evaluateUiBundleHostCompatibility(manifest, { ...bootstrap, bundleId: "another_bundle" }, support).component, "bundle-binding");
  assert.equal(evaluateUiBundleHostCompatibility(manifest, { ...bootstrap, applicationProtocolVersion: "2" }, support).component, "application-protocol");
  assert.equal(evaluateUiBundleHostCompatibility({ ...manifest, unexpected: true }, bootstrap, support).component, "bundle-manifest");
});

function hash(bytes) { return createHash("sha256").update(bytes).digest("base64url"); }
