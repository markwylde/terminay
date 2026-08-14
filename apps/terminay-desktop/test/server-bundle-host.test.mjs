import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY, deriveUiBundleId } from "@terminay/server-core/ui-bundle";
import { DesktopServerBundleHost, LocalServerUiSession, migrateDesktopHostState } from "../dist/index.js";
import { createBrowserManagerBundleHost, createDirectBrowserBundleHost } from "@terminay/web";

class MemoryCache { constructor() { this.records = new Map(); } async match(request) { return this.records.get(request.url)?.clone(); } async put(request, response) { this.records.set(request.url, response.clone()); } }
class MemoryCacheStorage { constructor() { this.caches = new Map(); } async open(name) { if (!this.caches.has(name)) this.caches.set(name, new MemoryCache()); return this.caches.get(name); } async delete(name) { return this.caches.delete(name); } }
const endpoint = { async send() {}, subscribe() { return () => {}; } };

const compatibility = { bootstrap: { minimum: 1, maximum: 1 }, bundleFormat: { minimum: 1, maximum: 1 }, hostBridge: { minimum: 1, maximum: 1 }, byteEndpoint: { minimum: 1, maximum: 1 }, requiredCapabilities: {}, optionalCapabilities: { notifications: { minimum: 1, maximum: 1 } } };
function fixture(text = "<!doctype html><title>server bundle</title>") {
  const bytes = Buffer.from(text); const provisional = [{ path: "/remote-app/provisional/index.html", contentType: "text/html; charset=utf-8", hash: createHash("sha256").update(bytes).digest("base64url"), size: bytes.length }];
  const bundleId = deriveUiBundleId(provisional, "provisional", { bundleFormatVersion: 1, protocolVersion: "1", serverVersion: "1.0.0", hostCompatibility: compatibility });
  const path = `/remote-app/${bundleId}/index.html`;
  return { bytes, manifest: { schemaVersion: 1, bundleId, entryPath: path, protocolVersion: "1", serverVersion: "1.0.0", contentSecurityPolicy: DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY, bundleFormatVersion: 1, hostCompatibility: compatibility, assets: [{ ...provisional[0], path }] } };
}

test("Local and remote use one verified preparation boundary with server-isolated cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-bundle-host-"));
  try {
    const host = new DesktopServerBundleHost({ cacheRoot: join(root, "cache"), capabilities: {} }); const one = fixture();
    const localRoot = join(root, "local"); await mkdir(localRoot); await writeFile(join(localRoot, "manifest.json"), JSON.stringify(one.manifest)); await writeFile(join(localRoot, "index.html"), one.bytes);
    const local = await host.prepareLocal({ profileId: "local:one", serverId: "server-one", origin: "http://127.0.0.1:1234", windowId: "window-one", artifact: { rootDirectory: localRoot } });
    assert.equal(local.source, "embedded"); assert.equal(local.context.serverId, "server-one"); assert.equal(local.compatibility.unavailableOptionalCapabilities[0], "notifications");
    const remote = await host.prepareRemote({ profileId: "remote:one", serverId: "server-two", origin: "https://two.example", windowId: "window-two", lane: { manifest: async () => one.manifest, read: async () => one.bytes } });
    assert.equal(remote.source, "remote-cache"); assert.notEqual(remote.partitionKey, local.partitionKey); assert.equal(remote.context.bundleId, one.manifest.bundleId);
    const recovered = await host.prepareRemote({ profileId: "remote:one", serverId: "server-two", origin: "https://two.example", windowId: "window-three", lane: { manifest: async () => { throw new Error("interrupted"); }, read: async () => { throw new Error("interrupted"); } } });
    assert.equal(recovered.source, "remote-cache-recovery");
    await assert.rejects(host.prepareRemote({ profileId: "remote:other", serverId: "server-other", origin: "https://other.example", windowId: "window-four", lane: { manifest: async () => { throw new Error("offline"); }, read: async () => one.bytes } }), /offline/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Local UI session verifies once per window and never owns a listener or credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-local-ui-session-"));
  try {
    const selected = fixture(); const localRoot = join(root, "local"); await mkdir(localRoot); await writeFile(join(localRoot, "manifest.json"), JSON.stringify(selected.manifest)); await writeFile(join(localRoot, "index.html"), selected.bytes);
    const session = new LocalServerUiSession({ bundleRoot: localRoot, cacheRoot: join(root, "cache"), serverId: "desktop-local" });
    const first = await session.prepare(41); const repeated = await session.prepare(41);
    assert.equal(first, repeated); assert.equal(first.source, "embedded"); assert.equal(first.context.profileId, "local:embedded"); assert.equal(session.launchFor(41), first);
    assert.equal("authToken" in session, false); assert.equal("listener" in session, false);
    session.release(41); assert.equal(session.launchFor(41), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("host-state migration discards server authority and rejects unclassified persistence", () => {
  const migrated = migrateDesktopHostState({ workspaceSnapshot: { projects: ["secret"] }, terminalState: ["secret"], credentialReferences: ["credential:one"], devicePreferences: { reduceMotion: true } });
  assert.equal("workspaceSnapshot" in migrated, false); assert.deepEqual(migrated.credentialReferences, ["credential:one"]);
  assert.throws(() => migrateDesktopHostState({ mysteryFeatureState: {} }), /not classified/);
});

test("Desktop has no second host action/context schema", async () => {
  const legacy = await readFile(new URL("../src/main/hostBridge.ts", import.meta.url), "utf8");
  const electronContract = await readFile(new URL("../../../electron/serverUiHostContract.ts", import.meta.url), "utf8");
  assert.doesNotMatch(legacy, /clipboard\.read|export interface DesktopHostContext|export type DesktopHostAction\s*=\s*\{/u);
  assert.doesNotMatch(electronContract, /export type ServerUiHostContext|export type ServerUiHostAction/u);
});

test("normal packaged Desktop startup launches the verified bundle through the canonical narrow preload", async () => {
  const [main, vite, host, endpoint] = await Promise.all([
    readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../electron/serverUiHost.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../electron/serverUiDocumentEndpoint.ts", import.meta.url), "utf8"),
  ]);
  assert.match(main, /new LocalServerUiSession/u);
  assert.match(main, /bindServerUiWindow\(\{/u);
  assert.match(main, /pathToFileURL\(path\.join\(launch\.assetRoot, launch\.entryPath\)\)/u);
  assert.match(main, /serverUiPreload\.cjs/u);
  assert.doesNotMatch(main, /localServerUiSession[\s\S]{0,500}loadFile\([\s\S]{0,100}RENDERER_DIST/u);
  assert.doesNotMatch(vite, /serverUiPreload:\s*path\.join/u);
  assert.match(host, /path\.relative\(allowedFileRoot, candidate\)/u);
  const preload = await readFile(new URL("../../../electron/serverUiPreload.ts", import.meta.url), "utf8");
  assert.match(preload, /exposeInMainWorld\('terminayBytes'/u);
  assert.match(
    preload,
    /parseTerminayHostBytePacket\(\s*message\.data,\s*bound\.serverId,?\s*\)/u,
  );
  assert.match(endpoint, /server-ui-host:byte-endpoint/u);
});

test("actual Local Desktop, remote Desktop, direct browser, and manager compositions launch one server identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-four-host-paths-"));
  try {
    const selected = fixture(); const serverId = "server-shared"; const profileId = "profile-shared";
    const localRoot = join(root, "local"); await mkdir(localRoot); await writeFile(join(localRoot, "manifest.json"), JSON.stringify(selected.manifest)); await writeFile(join(localRoot, "index.html"), selected.bytes);
    const desktop = new DesktopServerBundleHost({ cacheRoot: join(root, "cache"), capabilities: {} });
    const local = await desktop.prepareLocal({ profileId, serverId, origin: "http://localhost:4317", windowId: "local-window", artifact: { rootDirectory: localRoot } });
    const remote = await desktop.prepareRemote({ profileId, serverId, origin: "https://shared.example", windowId: "remote-window", lane: { manifest: async () => selected.manifest, read: async () => selected.bytes } });
    const browserContext = (sourceId) => ({ schemaVersion: 1, bootstrapVersion: 1, sourceId, windowId: `${sourceId}-window`, serverId, profileId, bundleId: selected.manifest.bundleId, applicationProtocolVersion: selected.manifest.protocolVersion, hostKind: "browser", hostBridgeVersion: 1, byteEndpointVersion: 1, capabilities: { notifications: 1, clipboardWrite: 1 } });
    const direct = await createDirectBrowserBundleHost(new MemoryCacheStorage(), 1).installAndPrepare({ manifest: selected.manifest, expectedServerId: serverId, sessionOrigin: "https://shared.example", context: browserContext("direct-browser"), endpoint, readAsset: async () => selected.bytes });
    const manager = await createBrowserManagerBundleHost(new MemoryCacheStorage(), 1).installAndPrepare({ manifest: selected.manifest, expectedServerId: serverId, sessionOrigin: "https://shared.example", context: browserContext("browser-manager"), endpoint, readAsset: async () => selected.bytes });
    const identities = [local.context, remote.context, direct.context, manager.context].map(({ bundleId, serverId, profileId, applicationProtocolVersion }) => ({ bundleId, serverId, profileId, applicationProtocolVersion }));
    assert.deepEqual(identities, Array.from({ length: 4 }, () => identities[0]));
  } finally { await rm(root, { recursive: true, force: true }); }
});
