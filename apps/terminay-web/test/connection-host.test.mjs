import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_WEB_MANAGER_ORIGIN,
  MemoryWebReconnectVault,
  WEB_PROFILE_STORAGE_KEY,
  WEB_MANAGER_ORIGIN,
  WebConnectionHost,
  WebHostBridge,
  createWebFileSelectionActionModel,
  createWebWorkspaceRouteRenderModel,
  sessionUrl,
} from "../dist/index.js";
import { RemoteReconnectGrantStore, createRemoteReconnectProof } from "@terminay/server-core";

function memoryStorage(seed = new Map()) {
  return {
    getItem(key) { return seed.has(key) ? seed.get(key) : null; },
    setItem(key, value) { seed.set(key, value); },
    removeItem(key) { seed.delete(key); },
  };
}

/** Browser-origin fixture: reconnect material belongs to the exact session
 * origin, not to either manager's storage. */
function originBoundReconnectFixture(origin, handle, grant) {
  const grantsByOrigin = new Map([[origin, new Map([[handle, grant]])]]);
  return {
    reconnect(requestOrigin, requestHandle) {
      const stored = grantsByOrigin.get(requestOrigin)?.get(requestHandle);
      if (stored === undefined) throw new Error("reconnect grant is unavailable for this origin");
      return stored;
    },
  };
}

function reconnectSigningInput({
  origin = "https://pair.example.test",
  handle,
  serverId = "server-pair",
  attemptId = "attempt-0123456789abcdef",
  clientNonce = "browser-client-nonce-0123456789",
  nonce = "server-challenge-nonce-0123456789",
  issuedAt = 1_000,
  expiresAt = 2_000,
} = {}) {
  return `terminay\u0000v1\u0000remote-reconnect-challenge\u0000${JSON.stringify({
    action: "reconnect",
    attemptId,
    clientNonce,
    expiresAt,
    handle,
    issuedAt,
    nonce,
    origin,
    protocolVersion: "v1",
    serverId,
  })}`;
}

test("web host starts disconnected, persists only profile metadata, and opens the selected server", () => {
  const storage = memoryStorage();
  const opened = [];
  const host = new WebConnectionHost({ storage, openWindow: (url, target) => opened.push({ url, target }) });
  assert.equal(host.snapshot().mode, "disconnected");
  assert.equal(host.snapshot().profiles.profiles.some((profile) => profile.isLocal), false);
  const profile = host.addConnection({ id: "prod", serverId: "server-prod", label: "Production", origin: "https://prod.example.test", status: "connected" });
  const result = host.open(profile.id, { route: "settings", projectId: "project-a", newTab: true });
  assert.equal(result.target, "_blank");
  assert.equal(result.url, "https://prod.example.test/?route=settings&project=project-a");
  assert.deepEqual(opened, [{ url: result.url, target: "_blank" }]);
  const persisted = JSON.parse(storage.getItem(WEB_PROFILE_STORAGE_KEY));
  assert.equal(persisted.profiles[0].origin, "https://prod.example.test");
  assert.deepEqual(Object.keys(persisted.profiles[0]).sort(), ["createdAt", "id", "label", "lastOpenedAt", "origin", "serverId", "status"]);
  assert.equal("reconnectGrant" in persisted.profiles[0], false);
  assert.equal("pairingFragment" in persisted.profiles[0], false);
  assert.equal("token" in persisted.profiles[0], false);
  assert.equal("terminalOutput" in persisted.profiles[0], false);
  const second = host.addConnection({ id: "home", serverId: "server-home", label: "Home", origin: "https://home.example.test", status: "connected" });
  assert.equal(host.open(second.id).url, "https://home.example.test/?route=workspace");
  assert.equal(host.snapshot().current?.id, second.id);
  const productionLastOpenedAt = host.profiles.get(profile.id)?.lastOpenedAt;
  assert.throws(() => host.open(profile.id, { route: "javascript:alert(1)" }), /route/);
  assert.equal(host.snapshot().current?.id, second.id);
  assert.equal(host.profiles.get(profile.id)?.lastOpenedAt, productionLastOpenedAt);
  assert.equal(host.revoke(second.id, true).status, "revoked");
  assert.equal(host.profiles.get("prod")?.status, "connected");
  assert.equal(host.openManager(), "https://web.terminay.com");
  assert.deepEqual(opened.at(-1), { url: WEB_MANAGER_ORIGIN, target: "_self" });
  host.openManager(true);
  assert.deepEqual(opened.at(-1), { url: WEB_MANAGER_ORIGIN, target: "_blank" });
  const localHttp = host.addConnection({ id: "local-http", serverId: "srv-local", label: "Loopback", origin: "http://127.0.0.1:4317" });
  assert.equal(localHttp.origin, "http://localhost:4317");
  assert.throws(() => host.addConnection({ id: "plain-http", serverId: "srv", label: "Plain", origin: "http://server.example.test" }), /HTTPS or loopback HTTP/);
});

test("web host upserts a fresh pairing for the exact saved origin without persisting secrets", () => {
  const storage = memoryStorage();
  const host = new WebConnectionHost({ storage });
  const first = host.addConnection({ id: "first", serverId: "server-one", label: "Local", origin: "http://localhost:4317", status: "connecting" });
  const refreshed = host.addConnection({ id: "fresh-random-id", serverId: "server-one", label: "Local server", origin: "http://localhost:4317", status: "connected" });

  assert.equal(refreshed.id, first.id);
  assert.equal(host.snapshot().profiles.profiles.length, 1);
  assert.equal(host.snapshot().profiles.profiles[0].status, "connected");
  const persisted = storage.getItem(WEB_PROFILE_STORAGE_KEY);
  assert.equal(persisted.includes("fresh-random-id"), false);
  assert.equal(persisted.includes("pairingToken"), false);
  assert.equal(persisted.includes("pairingSecret"), false);
});

test("loopback aliases share one saved profile and reconnect credential identity", async () => {
  const host = new WebConnectionHost();
  const first = host.addConnection({
    id: "loopback-server",
    serverId: "server-loopback",
    label: "Loopback",
    origin: "http://127.0.0.1:4317",
  });
  const second = host.addConnection({
    id: "duplicate-loopback-server",
    serverId: "server-loopback",
    label: "Loopback",
    origin: "http://localhost:4317",
  });
  assert.equal(first.id, second.id);
  assert.equal(second.origin, "http://localhost:4317");
  assert.equal(host.snapshot().profiles.profiles.length, 1);

  const vault = new MemoryWebReconnectVault();
  await vault.enroll({
    origin: "http://127.0.0.1:4317",
    handle: "loopback-reconnect-handle-0123456789abcdef",
    grant: "reconnect-grant-0123456789abcdef",
    signingOrigin: "https://server-loopback.remote.terminay.test",
  });
  assert.deepEqual(
    await vault.credential("http://localhost:4317"),
    await vault.credential("http://127.0.0.1:4317"),
  );
  await vault.forget("http://localhost:4317");
  assert.equal(await vault.credential("http://127.0.0.1:4317"), undefined);
});

test("web imports canonicalize one saved identity per session origin", () => {
  const host = new WebConnectionHost({ storage: memoryStorage() });
  const saved = host.addConnection({
    id: "saved-local",
    serverId: "server-local",
    label: "Local server",
    origin: "http://localhost:4317",
    status: "offline",
  });

  const refreshed = host.importConnection({
    id: "imported-local",
    serverId: "server-local",
    label: "Local server refreshed",
    origin: "http://LOCALHOST:4317",
    status: "connected",
  });

  assert.equal(refreshed.id, saved.id);
  assert.equal(refreshed.origin, "http://localhost:4317");
  assert.equal(host.snapshot().profiles.profiles.length, 1);
  assert.equal(host.snapshot().profiles.profiles[0].label, "Local server refreshed");
  assert.throws(() => host.importConnection({
    id: "wrong-server",
    serverId: "server-other",
    label: "Wrong identity",
    origin: "http://localhost:4317",
    status: "connected",
  }), /identity.*canonical origin/);
  assert.equal(host.snapshot().profiles.profiles[0].serverId, "server-local");
});

test("web host renders shared route components in-page", () => {
  const model = createWebWorkspaceRouteRenderModel("settings");
  assert.equal(model.presentation, "in-page");
  assert.equal(model.component.id, "shared.route.settings");
  assert.deepEqual(model.component.regions, ["settings-sections", "settings-editor"]);
});

test("web file selection remains in-page when no native picker capability is present", () => {
  const model = createWebFileSelectionActionModel();
  assert.equal(model.presentation, "in-page");
  assert.equal(model.route, "file");
  assert.equal(model.fallback.presentation, "in-page");
});

test("legacy manager migration redirects metadata without copying secrets or changing session origins", () => {
  const storage = memoryStorage();
  const host = new WebConnectionHost({ storage });
  const migration = host.migrateLegacyManagerRecord({ profiles: [{
    id: "legacy-prod",
    serverId: "server-prod",
    label: "Production",
    origin: "https://session-prod.terminay.com",
    status: "known",
    reconnectGrant: "must-not-copy",
    pairingFragment: "must-not-copy",
    projectRoot: "/private",
  }] });
  assert.equal(migration.sourceOrigin, LEGACY_WEB_MANAGER_ORIGIN);
  assert.equal(migration.destinationOrigin, WEB_MANAGER_ORIGIN);
  assert.equal(migration.profiles[0].origin, "https://session-prod.terminay.com");
  assert.equal(migration.profiles[0].status, "offline");
  const persisted = storage.getItem(WEB_PROFILE_STORAGE_KEY);
  assert.equal(persisted.includes("must-not-copy"), false);
  assert.equal(persisted.includes("projectRoot"), false);
  const localRecord = host.migrateLegacyManagerRecord({ profiles: [{ id: "legacy-local", serverId: "local", label: "Local", origin: "https://local.example.test", kind: "local" }] });
  assert.deepEqual(localRecord.profiles, []);
  assert.throws(() => host.migrateLegacyManagerRecord({ profiles: [] }, { sourceOrigin: "https://evil.example.test" }), /not supported/);
  assert.throws(() => host.migrateLegacyManagerRecord({ profiles: [{ id: "bad", serverId: "srv", label: "Bad", origin: "https://session-prod.terminay.com/path#secret" }] }), /origin/);
  const atomicHost = new WebConnectionHost();
  assert.throws(() => atomicHost.migrateLegacyManagerRecord({ profiles: [
    { id: "valid-first", serverId: "srv", label: "Valid", origin: "https://valid.example.test" },
    { id: "invalid-second", serverId: "srv", label: "Invalid\nname", origin: "https://invalid.example.test" },
  ] }), /label/);
  assert.equal(atomicHost.profiles.get("valid-first"), undefined);
});

test("legacy migration keeps an existing session-origin reconnect grant usable", () => {
  const sessionOrigin = "https://existing-session.terminay.com";
  const reconnect = originBoundReconnectFixture(sessionOrigin, "handle-existing", "grant-existing");
  const managerStorage = memoryStorage();
  const host = new WebConnectionHost({ storage: managerStorage });
  const migration = host.migrateLegacyManagerRecord({ profiles: [{
    id: "existing-session",
    serverId: "server-existing",
    label: "Existing session",
    origin: sessionOrigin,
    status: "connected",
    reconnectGrant: "must-remain-at-session-origin",
  }] });

  assert.equal(migration.profiles[0].origin, sessionOrigin);
  assert.equal(host.open("existing-session").url, "https://existing-session.terminay.com/?route=workspace");
  assert.equal(reconnect.reconnect(sessionOrigin, "handle-existing"), "grant-existing");
  assert.throws(() => reconnect.reconnect(WEB_MANAGER_ORIGIN, "handle-existing"), /origin/);
  assert.equal(managerStorage.getItem(WEB_PROFILE_STORAGE_KEY).includes("grant-existing"), false);
  assert.equal(managerStorage.getItem(WEB_PROFILE_STORAGE_KEY).includes("must-remain-at-session-origin"), false);
});

test("web host restores safe profiles and keeps failure states distinct", () => {
  const seed = new Map([[WEB_PROFILE_STORAGE_KEY, JSON.stringify({
    version: 1,
    currentProfileId: "offline",
    profiles: [
      { id: "offline", serverId: "srv", label: "Home", origin: "https://home.example.test", status: "offline" },
      { id: "bad", serverId: "srv", label: "Bad", origin: "https://bad.example.test", status: "connected", reconnectGrant: "secret" },
      { id: "case-bad", serverId: "srv", label: "Bad", origin: "https://bad.example.test", status: "connected", Token: "secret" },
      { id: "query-bad", serverId: "srv", label: "Bad", origin: "https://bad.example.test/?token=secret", status: "connected" },
      { id: "fragment-bad", serverId: "srv", label: "Bad", origin: "https://bad.example.test/#secret", status: "connected" },
    ],
  })]]);
  const host = new WebConnectionHost({ storage: memoryStorage(seed) });
  assert.equal(host.snapshot().current?.id, "offline");
  assert.equal(host.snapshot().current?.status, "offline");
  assert.equal(host.profiles.get("bad"), undefined);
  assert.equal(host.profiles.get("case-bad"), undefined);
  assert.equal(host.profiles.get("query-bad"), undefined);
  assert.equal(host.profiles.get("fragment-bad"), undefined);
  assert.throws(() => host.forget("offline"), /confirmation/);
  host.forget("offline", true);
  assert.equal(host.snapshot().mode, "disconnected");
});

test("web host restore preserves one saved identity per canonical origin", () => {
  const storage = memoryStorage(new Map([[WEB_PROFILE_STORAGE_KEY, JSON.stringify({
    version: 1,
    currentProfileId: "duplicate-origin",
    profiles: [
      { id: "first", serverId: "server-local", label: "Local", origin: "http://localhost:4317", status: "connected" },
      { id: "duplicate-origin", serverId: "server-local", label: "Stale duplicate", origin: "http://127.0.0.1:4317", status: "offline" },
      { id: "first", serverId: "server-other", label: "Duplicate id", origin: "https://other.example.test", status: "connected" },
      { id: "second", serverId: "server-second", label: "Second", origin: "https://second.example.test", status: "connected" },
    ],
  })]]));

  const host = new WebConnectionHost({ storage });

  assert.deepEqual(host.snapshot().profiles.profiles.map((profile) => profile.id), ["first", "second"]);
  assert.equal(host.profiles.get("first")?.origin, "http://localhost:4317");
  assert.equal(host.snapshot().current?.id, "first");
  assert.equal(host.open("second").url, "https://second.example.test/?route=workspace");
});

test("web host keeps archived profiles recoverable but never opens them", () => {
  const host = new WebConnectionHost();
  const profile = host.addConnection({ id: "archived", serverId: "srv-archived", label: "Archived", origin: "https://archived.example", status: "connected" });
  host.open(profile.id);
  assert.equal(host.snapshot().mode, "connected");
  assert.throws(() => host.archive(profile.id), /confirmation/);
  const archived = host.archive(profile.id, true);
  assert.equal(archived.archived, true);
  assert.equal(archived.status, "offline");
  assert.equal(host.snapshot().mode, "disconnected");
  assert.throws(() => host.open(profile.id), /archived/);
  assert.equal(host.unarchive(profile.id).archived, false);
  assert.equal(host.open(profile.id).url, "https://archived.example/?route=workspace");
});

test("web menu retains archived and transport failure states without conflating activity", () => {
  const host = new WebConnectionHost();
  for (const [id, status] of [
    ["offline", "offline"],
    ["relay", "relay-unavailable"],
    ["webrtc", "webrtc-failed"],
    ["expired", "expired"],
    ["revoked", "revoked"],
    ["unreachable", "unreachable"],
  ]) host.addConnection({ id, serverId: `srv-${id}`, label: id, origin: `https://${id}.example.test`, status, archived: id === "expired" });
  const statuses = host.snapshot().profiles.profiles.map((profile) => profile.status);
  assert.deepEqual(statuses, ["offline", "relay-unavailable", "webrtc-failed", "expired", "revoked", "unreachable"]);
  assert.equal(host.snapshot().mode, "disconnected");
  assert.throws(() => host.revoke("relay"), /confirmation/);
  assert.equal(host.revoke("relay", true).status, "revoked");
});

test("pairing fragments are consumed in memory and never enter a session URL", () => {
  const host = new WebConnectionHost();
  const profile = host.consumePairingUrl("https://pair.example.test/session#one-time-secret", { id: "pair", serverId: "srv", label: "Pair" });
  assert.equal(profile.origin, "https://pair.example.test");
  assert.equal(sessionUrl(profile.origin, { route: "workspace" }), "https://pair.example.test/?route=workspace");
  assert.throws(() => host.consumePairingUrl("https://pair.example.test/session", { id: "missing", serverId: "srv", label: "Missing" }), /fragment/);
  assert.throws(() => host.consumePairingUrl("http://pair.example.test/session#secret", { id: "http", serverId: "srv", label: "HTTP" }), /HTTPS or loopback HTTP/);
});

test("browser reconnect vault keeps a non-extractable proof key origin-bound and never retains the pairing grant", async () => {
  const origin = "https://pair.example.test";
  const signingOrigin = "https://server-pair.remote.terminay.test";
  const store = new RemoteReconnectGrantStore({ serverId: "server-pair", sessionOrigin: signingOrigin });
  const issued = store.issue({ deviceId: "browser-device", lifetime: "until-revoked" });
  const vault = new MemoryWebReconnectVault();
  await vault.enroll({ origin, handle: issued.handle, grant: issued.grant, signingOrigin: issued.sessionOrigin });
  assert.deepEqual(await vault.credential(origin), { origin, handle: issued.handle, signingOrigin });
  assert.equal(await vault.credential("https://other.example.test"), undefined);

  const pending = store.createChallenge({
    handle: issued.handle,
    origin: signingOrigin,
    clientNonce: "browser-client-nonce-0123456789",
  });
  const proof = await vault.sign({ origin, handle: issued.handle, signingInput: pending.signingInput });
  assert.equal(proof, createRemoteReconnectProof(issued.grant, pending.signingInput));
  assert.equal(store.verifyProof({
    attemptId: pending.challenge.attemptId,
    handle: issued.handle,
    origin: signingOrigin,
    clientNonce: pending.challenge.clientNonce,
    proof,
  }).deviceId, "browser-device");
  await vault.forget(origin);
  assert.equal(await vault.credential(origin), undefined);
});

test("browser reconnect vault never releases an in-flight proof after fresh pairing replaces it", async () => {
  const nativeCrypto = globalThis.crypto;
  let releaseSignature;
  const signatureStarted = Promise.withResolvers();
  const signingGate = new Promise(resolve => { releaseSignature = resolve; });
  const delayedCrypto = {
    getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    subtle: {
      importKey: (...args) => nativeCrypto.subtle.importKey(...args),
      deriveKey: (...args) => nativeCrypto.subtle.deriveKey(...args),
      async sign(...args) {
        signatureStarted.resolve();
        await signingGate;
        return nativeCrypto.subtle.sign(...args);
      },
    },
  };
  const origin = "https://pair.example.test";
  const vault = new MemoryWebReconnectVault(delayedCrypto);
  const oldHandle = "old-reconnect-handle-0123456789abcdef";
  const newHandle = "new-reconnect-handle-0123456789abcdef";
  const signingInput = reconnectSigningInput({ origin, handle: oldHandle });

  await vault.enroll({ origin, handle: oldHandle, grant: "old-reconnect-grant-0123456789abcdef", signingOrigin: origin });
  const staleProof = vault.sign({ origin, handle: oldHandle, signingInput });
  await signatureStarted.promise;
  await vault.enroll({ origin, handle: newHandle, grant: "new-reconnect-grant-0123456789abcdef", signingOrigin: origin });
  releaseSignature();

  await assert.rejects(staleProof, /credential changed while signing/);
  await assert.rejects(vault.sign({ origin, handle: oldHandle, signingInput }), /credential is unavailable/);
  assert.equal((await vault.credential(origin))?.handle, newHandle);
});

test("browser reconnect vault signs only the canonical exact-origin challenge", async () => {
  const origin = "https://pair.example.test";
  const handle = "reconnect-handle-0123456789abcdef";
  const vault = new MemoryWebReconnectVault();
  await vault.enroll({ origin, handle, grant: "reconnect-grant-0123456789abcdef", signingOrigin: origin });

  const signingInput = reconnectSigningInput({ origin, handle });
  assert.match(await vault.sign({ origin, handle, signingInput }), /^[A-Za-z0-9_-]+$/u);
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: "arbitrary signing input that must never reach the proof key" }),
    /reconnect credential is unavailable/,
  );
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: reconnectSigningInput({ origin: "https://other.example.test", handle }) }),
    /reconnect credential is unavailable/,
  );
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: reconnectSigningInput({ origin, handle: "other-reconnect-handle-0123456789abcdef" }) }),
    /reconnect credential is unavailable/,
  );
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: `${signingInput}{}` }),
    /reconnect credential is unavailable/,
  );
  const canonicalBody = signingInput.slice("terminay\u0000v1\u0000remote-reconnect-challenge\u0000".length);
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: `terminay\u0000v1\u0000remote-reconnect-challenge\u0000${JSON.stringify(JSON.parse(canonicalBody), null, 2)}` }),
    /reconnect credential is unavailable/,
  );
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: reconnectSigningInput({ origin, handle, nonce: "server:challenge:nonce" }) }),
    /reconnect credential is unavailable/,
  );
  await assert.rejects(
    vault.sign({ origin, handle, signingInput: reconnectSigningInput({ origin, handle, issuedAt: 1_000, expiresAt: 1_000 }) }),
    /reconnect credential is unavailable/,
  );
});

test("host bridge requires exact workspace origin and source", () => {
  const source = { calls: [], postMessage(message, origin) { this.calls.push({ message, origin }); } };
  const target = source;
  const bridge = new WebHostBridge({ workspaceOrigin: "https://server.example.test", workspaceSource: source });
  const message = { type: "host.profile", payload: { serverLabel: "Production", status: "connected" } };
  assert.deepEqual(bridge.receive({ origin: "https://server.example.test", source, data: message }), message);
  assert.equal(bridge.receive({ origin: "https://evil.example.test", source, data: message }), undefined);
  assert.equal(bridge.receive({ origin: "https://server.example.test", source: {}, data: message }), undefined);
  assert.equal(bridge.receive({ origin: "https://server.example.test", source, data: { type: "host.profile", payload: { token: "secret" } } }), undefined);
  bridge.send(target, message);
  assert.deepEqual(target.calls, [{ message, origin: "https://server.example.test" }]);
  assert.throws(() => bridge.send({ postMessage() {} }, message), /target window mismatch/);
  assert.throws(() => bridge.send(target, { type: "host.profile", payload: { path: "/private" } }), /invalid/);
});
