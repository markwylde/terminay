import test from "node:test";
import assert from "node:assert/strict";
import {
  WEB_PROFILE_STORAGE_KEY,
  WebConnectionHost,
  WebHostBridge,
  sessionUrl,
} from "../dist/index.js";

function memoryStorage(seed = new Map()) {
  return {
    getItem(key) { return seed.has(key) ? seed.get(key) : null; },
    setItem(key, value) { seed.set(key, value); },
    removeItem(key) { seed.delete(key); },
  };
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
  assert.equal("reconnectGrant" in persisted.profiles[0], false);
  assert.equal("terminalOutput" in persisted.profiles[0], false);
  const second = host.addConnection({ id: "home", serverId: "server-home", label: "Home", origin: "https://home.example.test", status: "connected" });
  assert.equal(host.open(second.id).url, "https://home.example.test/?route=workspace");
  assert.equal(host.revoke(second.id, true).status, "revoked");
  assert.equal(host.profiles.get("prod")?.status, "connected");
  assert.equal(host.openManager(), "https://web.terminay.com");
  assert.throws(() => host.addConnection({ id: "local-http", serverId: "srv", label: "Loopback", origin: "http://127.0.0.1" }), /HTTPS/);
});

test("web host restores safe profiles and keeps failure states distinct", () => {
  const seed = new Map([[WEB_PROFILE_STORAGE_KEY, JSON.stringify({
    version: 1,
    currentProfileId: "offline",
    profiles: [
      { id: "offline", serverId: "srv", label: "Home", origin: "https://home.example.test", status: "offline" },
      { id: "bad", serverId: "srv", label: "Bad", origin: "https://bad.example.test", status: "connected", reconnectGrant: "secret" },
    ],
  })]]);
  const host = new WebConnectionHost({ storage: memoryStorage(seed) });
  assert.equal(host.snapshot().current?.id, "offline");
  assert.equal(host.snapshot().current?.status, "offline");
  assert.equal(host.profiles.get("bad"), undefined);
  assert.throws(() => host.forget("offline"), /confirmation/);
  host.forget("offline", true);
  assert.equal(host.snapshot().mode, "disconnected");
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
  assert.throws(() => host.consumePairingUrl("http://pair.example.test/session#secret", { id: "http", serverId: "srv", label: "HTTP" }), /HTTPS/);
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
