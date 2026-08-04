import test from "node:test";
import assert from "node:assert/strict";
import { encodeFrame, decodeFrame } from "@terminay/protocol";
import {
  ConnectionProfileStore,
  DesktopConnectionHost,
  WindowViewRegistry,
  createRemoteProfile,
} from "../dist/main/index.js";

function transport(serverId) {
  const queue = [];
  const waiters = [];
  let state = "opening";
  const push = (frame) => {
    const waiter = waiters.shift();
    if (waiter) waiter({ done: false, value: frame });
    else queue.push(frame);
  };
  const source = {
    get state() { return state; },
    get queuedBytes() { return 0; },
    get bufferedBytes() { return queue.reduce((total, frame) => total + frame.byteLength, 0); },
    incoming: { [Symbol.asyncIterator]() { return { next: () => queue.length ? Promise.resolve({ done: false, value: queue.shift() }) : new Promise((resolve) => waiters.push(resolve)) }; } },
    async open() { state = "open"; },
    async send(frame) {
      const envelope = decodeFrame(frame).envelope;
      if (envelope.type === "client_hello") {
        queueMicrotask(() => push(encodeFrame({ type: "server_hello", protocolVersion: 1, serverId, serverVersion: "test", clientId: envelope.clientId, capabilities: [], limits: { maxFrameBytes: 1024, maxHeaderBytes: 1024, maxBodyBytes: 1024, maxQueuedBytes: 1024, maxStreamChunkBytes: 1024, maxBinaryChunkBytes: 1024, maxCapabilities: 8, maxEventsPerBatch: 8 }, authScope: "write" }, new Uint8Array())));
      }
    },
    async waitForWritable() {},
    async close() { state = "closed"; for (const resolve of waiters.splice(0)) resolve({ done: true, value: undefined }); },
    onStateChange() { return () => {}; },
  };
  return source;
}

function server(serverId, origin) {
  const listeners = new Set();
  return {
    state: "created",
    async start() { this.state = "ready"; for (const listener of listeners) listener("ready"); return { serverId, origin, transport: transport(serverId) }; },
    async stop() { this.state = "stopped"; for (const listener of listeners) listener("stopped"); },
    onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(state) { this.state = state; for (const listener of listeners) listener(state); },
  };
}

test("Desktop host starts on immutable Local and opens remote profiles without fallback", async () => {
  const profiles = new ConnectionProfileStore();
  const local = server("local-identity", "http://127.0.0.1:4311");
  const host = new DesktopConnectionHost({ localServer: local, profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  const changes = [];
  host.onStateChange((change) => changes.push(change.current));
  const started = await host.start();
  assert.equal(started.profile.label, "Local");
  assert.equal(started.profile.immutable, true);
  assert.equal(host.state.currentProfileId, "local:local-identity");
  assert.throws(() => profiles.patch(started.profile.id, { label: "Renamed" }), /immutable/);

  const remote = profiles.add(createRemoteProfile({ id: "remote-prod", serverId: "prod-identity", origin: "https://prod.example", label: "Production", now: "2026-01-01T00:00:00.000Z" }));
  const connection = await host.openProfile(remote.id);
  assert.equal(connection.profile.status, "connected");
  assert.equal(host.currentConnection?.profile.id, remote.id);
  assert.equal(host.profiles.get(started.profile.id)?.status, "connected");
  assert.ok(changes.some((state) => state.phase === "starting"));
  assert.ok(changes.some((state) => state.localServerState === "ready"));
  await host.stop();
});

test("initial Desktop window binds immutable Local and exposes a Local header", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-header", "http://127.0.0.1:4310"), profiles });
  const opened = await host.openInitialWindow({ workspaceViewId: "view-initial", createWindowId: () => "window-initial" });
  assert.equal(opened.selection.action, "open");
  assert.deepEqual(host.windows.get("window-initial"), { windowId: "window-initial", connectionId: "local:local-header", workspaceViewId: "view-initial" });
  assert.deepEqual(host.currentConnectionHeader, { profileId: "local:local-header", serverId: "local-header", label: "Local", kind: "local", status: "connected", local: true });
  assert.deepEqual(host.localMode, { transport: "loopback", internetRequired: false, usesWebRTC: false });
  assert.throws(() => profiles.patch("local:local-header", { label: "Remote" }), /immutable/);
  await host.stop();
});

test("Local starts offline without a remote transport factory", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-offline", "http://127.0.0.1:4316"), profiles });
  const local = await host.start();
  assert.equal(local.profile.kind, "local");
  assert.equal(host.currentConnectionHeader?.label, "Local");
  assert.equal(host.localMode.internetRequired, false);
  assert.equal(host.localMode.usesWebRTC, false);
  const remote = profiles.add(createRemoteProfile({ id: "remote-needs-transport", serverId: "srv-needs-transport", origin: "https://needs-transport.example", label: "Remote", now: "2026-01-01T00:00:00.000Z" }));
  await assert.rejects(host.openProfile(remote.id), /no transport factory/);
  await host.stop();
});

test("current bundle loading is bound to the authenticated connection and rejects late responses", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-bundle", "http://127.0.0.1:4317"), profiles });
  await host.start();
  let resolveBundle;
  const pending = new Promise((resolve) => { resolveBundle = resolve; });
  const load = host.loadCurrentServerBundle(async () => pending);
  await Promise.resolve();
  await host.disconnect("local:local-bundle");
  resolveBundle({ status: 200, finalUrl: "http://127.0.0.1:4317/manifest.json", bytes: new TextEncoder().encode("{}") });
  await assert.rejects(load, /current connection changed/);
  await host.stop();
});

test("Desktop host restores remembered profiles before Local becomes ready", async () => {
  let stored = [];
  const storage = {
    load: async () => stored,
    save: async (profiles) => { stored = profiles; },
  };
  const persisted = new ConnectionProfileStore({ storage });
  persisted.add(createRemoteProfile({ id: "remote-remembered", serverId: "srv-remembered", origin: "https://remembered.example", label: "Remembered", now: "2026-01-01T00:00:00.000Z" }));
  await persisted.flush();

  const profiles = new ConnectionProfileStore({ storage });
  const host = new DesktopConnectionHost({ localServer: server("local-recovered", "http://127.0.0.1:4312"), profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  await host.start();
  assert.equal(host.profiles.get("remote-remembered")?.label, "Remembered");
  assert.equal(host.profiles.get("remote-remembered")?.status, "known");
  await host.stop();
  await profiles.flush();
});

test("Desktop host keeps one Local and three remote windows isolated while focusing repeats", async () => {
  const profiles = new ConnectionProfileStore();
  const remoteTransportRequests = [];
  const host = new DesktopConnectionHost({
    localServer: server("local-multi", "http://127.0.0.1:4313"),
    profiles,
    transports: {
      connect: async (profile) => {
        remoteTransportRequests.push({ id: profile.id, serverId: profile.serverId, origin: profile.origin });
        return transport(profile.serverId);
      },
    },
  });
  await host.start();
  const local = await host.openProfileWindow("local:local-multi", "view-local", { createWindowId: () => "window-local" });
  assert.equal(local.selection.action, "open");

  const remotes = ["one", "two", "three"].map((name) => profiles.add(createRemoteProfile({ id: `remote-${name}`, serverId: `srv-${name}`, origin: `https://${name}.example`, label: name, now: "2026-01-01T00:00:00.000Z" })));
  const opened = [local];
  for (const [index, profile] of remotes.entries()) {
    const next = await host.openProfileWindow(profile.id, `view-${profile.id}`, { createWindowId: () => `window-${index}` });
    assert.equal(next.selection.action, "open");
    assert.equal(next.connection.server.serverId, profile.serverId);
    opened.push(next);
  }

  assert.equal(host.windows.list().length, 4);
  assert.deepEqual(host.windows.list().map(({ windowId, connectionId, workspaceViewId }) => ({ windowId, connectionId, workspaceViewId })), [
    { windowId: "window-local", connectionId: "local:local-multi", workspaceViewId: "view-local" },
    { windowId: "window-0", connectionId: "remote-one", workspaceViewId: "view-remote-one" },
    { windowId: "window-1", connectionId: "remote-two", workspaceViewId: "view-remote-two" },
    { windowId: "window-2", connectionId: "remote-three", workspaceViewId: "view-remote-three" },
  ]);
  assert.deepEqual(remoteTransportRequests, remotes.map((profile) => ({ id: profile.id, serverId: profile.serverId, origin: profile.origin })));
  assert.equal(new Set(opened.map(({ connection }) => connection.client)).size, 4);
  assert.deepEqual(opened.map(({ connection }) => ({ profileId: connection.profile.id, serverId: connection.server.serverId })), [
    { profileId: "local:local-multi", serverId: "local-multi" },
    { profileId: "remote-one", serverId: "srv-one" },
    { profileId: "remote-two", serverId: "srv-two" },
    { profileId: "remote-three", serverId: "srv-three" },
  ]);
  assert.deepEqual(host.profiles.list().map(({ id, origin, status }) => ({ id, origin, status })).sort((left, right) => left.id.localeCompare(right.id)), [
    { id: "local:local-multi", origin: "http://127.0.0.1:4313", status: "connected" },
    { id: "remote-one", origin: "https://one.example", status: "connected" },
    { id: "remote-three", origin: "https://three.example", status: "connected" },
    { id: "remote-two", origin: "https://two.example", status: "connected" },
  ]);
  assert.equal(JSON.stringify(host.profiles.serialize()).includes("reconnectGrant"), false);
  assert.equal(JSON.stringify(host.windows.list()).includes("private"), false);

  const focused = await host.openProfileWindow("remote-one", "view-remote-one", { createWindowId: () => "must-not-open" });
  assert.equal(focused.selection.action, "focus");
  assert.strictEqual(focused.connection, opened[1].connection);
  assert.equal(focused.selection.binding.windowId, "window-0");
  assert.equal(host.windows.list().length, 4);
  const secondView = await host.openProfileWindow("remote-one", "view-remote-one-second", { createWindowId: () => "window-remote-one-second" });
  assert.equal(secondView.selection.action, "open");
  assert.equal(host.windows.list().length, 5);
  await host.stop();
});

test("Desktop pairing deep links consume fragments and persist only the exact origin", () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-pairing", "http://127.0.0.1:4314"), profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  const profile = host.importPairingUrl("https://pair.example.test/session#one-time-pairing-secret", {
    id: "remote-pairing",
    serverId: "srv-pairing",
    label: "Paired",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(profile.origin, "https://pair.example.test");
  assert.equal(JSON.stringify(profiles.serialize()).includes("one-time-pairing-secret"), false);
  assert.equal(JSON.stringify(profiles.serialize()).includes("/session"), false);
  assert.throws(() => host.importPairingUrl("https://pair.example.test/session", { id: "missing-fragment", serverId: "srv", label: "Missing" }), /fragment/);
  assert.throws(() => host.importPairingUrl("https://user:pass@pair.example.test/session#secret", { id: "credentials", serverId: "srv", label: "Credentials" }), /credentials/);
  assert.throws(() => host.importPairingUrl("https://pair.example.test/session?secret=leaked#secret", { id: "query", serverId: "srv", label: "Query" }), /query/);
  assert.throws(() => host.importPairingUrl("http://pair.example.test/session#secret", { id: "http", serverId: "srv", label: "HTTP" }), /HTTPS/);
});

test("failed explicit rebinding restores the previous native window binding", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({
    localServer: server("local-rebind", "http://127.0.0.1:4315"),
    profiles,
    transports: { connect: async (profile) => { if (profile.serverId === "srv-rebind-fails") throw new Error("offline"); return transport(profile.serverId); } },
  });
  await host.start();
  await host.openProfileWindow("local:local-rebind", "view-local", { createWindowId: () => "window-rebind" });
  profiles.add(createRemoteProfile({ id: "remote-rebind-fails", serverId: "srv-rebind-fails", origin: "https://rebind-fails.example", label: "Rebind fails", now: "2026-01-01T00:00:00.000Z" }));
  await assert.rejects(host.openProfileWindow("remote-rebind-fails", "view-remote", { currentWindowId: "window-rebind", rebindCurrent: true }), /offline/);
  assert.deepEqual(host.windows.get("window-rebind"), { windowId: "window-rebind", connectionId: "local:local-rebind", workspaceViewId: "view-local" });
  await host.stop();
});

test("identity mismatch is explicit and never falls back to Local", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-id", "http://localhost:4422"), profiles, transports: { connect: async () => transport("unexpected-id") } });
  await host.start();
  const remote = profiles.add(createRemoteProfile({ id: "remote-other", serverId: "expected-id", origin: "https://other.example", label: "Other", now: "2026-01-01T00:00:00.000Z" }));
  await assert.rejects(host.openProfile(remote.id), /identity mismatch/);
  assert.equal(profiles.get(remote.id)?.status, "identity-mismatch");
  assert.equal(host.currentConnection?.profile.id, "local:local-id");
  await host.stop();
});

test("transport creation failures remain on the selected profile", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-failure", "http://localhost:4423"), profiles, transports: { connect: async () => { throw new Error("offline"); } } });
  await host.start();
  const remote = profiles.add(createRemoteProfile({ id: "remote-offline", serverId: "offline-id", origin: "https://offline.example", label: "Offline", now: "2026-01-01T00:00:00.000Z" }));
  await assert.rejects(host.openProfile(remote.id), /offline/);
  assert.equal(profiles.get(remote.id)?.status, "failed");
  assert.equal(host.currentConnection?.profile.id, "local:local-failure");
  await host.stop();
});

test("Local crash clears the connected workspace instead of showing stale Local", async () => {
  const profiles = new ConnectionProfileStore();
  const local = server("local-crash", "http://localhost:4424");
  const host = new DesktopConnectionHost({ localServer: local, profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  await host.start();
  local.emit("crashed");
  assert.equal(host.currentConnection, undefined);
  assert.equal(host.state.phase, "failed");
  assert.equal(profiles.get("local:local-crash")?.status, "failed");
  assert.deepEqual(host.currentConnectionHeader, { profileId: "local:local-crash", serverId: "local-crash", label: "Local", kind: "local", status: "failed", local: true });
  await host.stop();
});

test("Local bootstrap readiness keeps its private credential out of profiles and host state", async () => {
  let receivedContext;
  const local = {
    state: "created",
    async start() {
      this.state = "ready";
      return {
        serverId: "local-private-bootstrap",
        serverVersion: "2.0.0",
        origin: "http://127.0.0.1:4425",
        endpoint: "loopback:4425",
        bootstrapCredential: "private-bootstrap-credential",
        credentialDigest: "sha256:private-bootstrap",
      };
    },
    async stop() { this.state = "stopped"; },
  };
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({
    localServer: local,
    profiles,
    transports: {
      connect: async (profile, context) => {
        receivedContext = context;
        return transport(profile.serverId);
      },
    },
  });
  await host.start();
  assert.equal(receivedContext.bootstrapCredential, "private-bootstrap-credential");
  assert.equal(receivedContext.endpoint, "loopback:4425");
  assert.equal(Object.isFrozen(receivedContext), true);
  assert.equal(JSON.stringify(profiles.serialize()).includes("private-bootstrap-credential"), false);
  assert.equal(JSON.stringify(host.state).includes("private-bootstrap-credential"), false);
  await host.stop();
});

test("Local restart detaches stale clients and reconnects only after fresh readiness", async () => {
  let starts = 0;
  const listeners = new Set();
  const local = {
    state: "created",
    async start() {
      starts += 1;
      this.state = "ready";
      for (const listener of listeners) listener("ready");
      return { serverId: "local-restart", origin: `http://127.0.0.1:${4426 + starts}`, transport: transport("local-restart") };
    },
    async stop() {
      this.state = "stopped";
      for (const listener of listeners) listener("stopped");
    },
    onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(state) { this.state = state; for (const listener of listeners) listener(state); },
  };
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: local, profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  const changes = [];
  host.onStateChange((change) => changes.push(change.current));
  const first = await host.start();
  assert.equal(starts, 1);
  local.emit("crashed");
  assert.notEqual(first.client.state, "connected");
  assert.equal(host.currentConnection, undefined);
  assert.equal(profiles.get("local:local-restart")?.status, "failed");

  const recovered = await host.restartLocal();
  assert.equal(starts, 2);
  assert.equal(recovered.server.serverId, "local-restart");
  assert.equal(host.currentConnection?.profile.id, "local:local-restart");
  assert.equal(host.state.localServerState, "ready");
  assert.equal(profiles.get("local:local-restart")?.status, "connected");
  assert.ok(changes.some((state) => state.localServerState === "restarting"));
  assert.ok(changes.some((state) => state.localServerState === "stopped"));
  local.emit("migrating");
  assert.equal(host.currentConnection, undefined);
  assert.equal(host.state.phase, "starting");
  assert.equal(profiles.get("local:local-restart")?.status, "connecting");
  local.emit("failed");
  assert.equal(host.state.phase, "failed");
  assert.equal(profiles.get("local:local-restart")?.status, "failed");
  await host.stop();
  await assert.rejects(host.restartLocal(), /stopped/);
});

test("window registry focuses matching connection/view and requires explicit rebinding", () => {
  const windows = new WindowViewRegistry();
  assert.deepEqual(windows.select("local:one", "view-a", { createWindowId: () => "window-a" }), { action: "open", binding: { windowId: "window-a", connectionId: "local:one", workspaceViewId: "view-a" } });
  assert.deepEqual(windows.select("local:one", "view-a", { createWindowId: () => "window-b" }), { action: "focus", binding: { windowId: "window-a", connectionId: "local:one", workspaceViewId: "view-a" } });
  assert.deepEqual(windows.select("remote:two", "view-b", { currentWindowId: "window-a", createWindowId: () => "window-c" }), { action: "open", binding: { windowId: "window-c", connectionId: "remote:two", workspaceViewId: "view-b" } });
  assert.throws(() => windows.bind({ windowId: "window-a", connectionId: "remote:two", workspaceViewId: "view-b" }), /explicit rebind/);
});

test("Desktop host maps logical server views to native bindings independently of native window tokens", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({
    localServer: server("local-view-map", "http://127.0.0.1:4319"),
    profiles,
  });
  await host.start();

  const first = await host.openProfileWindow("local:local-view-map", "workspace-view-alpha", {
    createWindowId: () => "native-window-token-a",
  });
  const focused = await host.openProfileWindow("local:local-view-map", "workspace-view-alpha", {
    createWindowId: () => "native-window-token-b",
  });
  assert.equal(first.selection.action, "open");
  assert.equal(focused.selection.action, "focus");
  assert.equal(focused.selection.binding.windowId, "native-window-token-a");
  assert.equal(focused.selection.binding.workspaceViewId, "workspace-view-alpha");

  const secondView = await host.openProfileWindow("local:local-view-map", "workspace-view-beta", {
    createWindowId: () => "native-window-token-b",
  });
  assert.equal(secondView.selection.action, "open");
  assert.deepEqual(host.windows.list().map(({ windowId, connectionId, workspaceViewId }) => ({ windowId, connectionId, workspaceViewId })), [
    { windowId: "native-window-token-a", connectionId: "local:local-view-map", workspaceViewId: "workspace-view-alpha" },
    { windowId: "native-window-token-b", connectionId: "local:local-view-map", workspaceViewId: "workspace-view-beta" },
  ]);
  await host.stop();
});

test("closing a native window detaches only its view binding and preserves the shared client", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({
    localServer: server("local-window-close", "http://127.0.0.1:4318"),
    profiles,
  });
  await host.start();

  const first = await host.openProfileWindow("local:local-window-close", "view-first", { createWindowId: () => "window-first" });
  const second = await host.openProfileWindow("local:local-window-close", "view-second", { createWindowId: () => "window-second" });
  assert.strictEqual(second.connection, first.connection);

  const closed = host.closeWindow("window-first");
  assert.deepEqual(closed, {
    binding: { windowId: "window-first", connectionId: "local:local-window-close", workspaceViewId: "view-first" },
    logicalViewDeleted: false,
  });
  assert.equal(host.windows.get("window-first"), undefined);
  assert.deepEqual(host.windows.get("window-second"), { windowId: "window-second", connectionId: "local:local-window-close", workspaceViewId: "view-second" });
  assert.strictEqual(host.getConnection("local:local-window-close"), first.connection);
  assert.equal(first.connection.client.state, "connected");

  const reopened = await host.openProfileWindow("local:local-window-close", "view-first", { createWindowId: () => "window-first-reopened" });
  assert.equal(reopened.selection.action, "open");
  assert.equal(reopened.selection.binding.workspaceViewId, "view-first");
  assert.strictEqual(reopened.connection, first.connection);
  assert.equal(host.closeWindow("missing-window"), undefined);
  await host.stop();
});

test("window registry persists host-local mapping and bounded geometry atomically", async () => {
  let stored = [];
  const storage = {
    load: async () => stored,
    save: async (bindings) => { stored = bindings; },
  };
  const windows = new WindowViewRegistry({ storage });
  windows.bind({ windowId: "window-persist", connectionId: "remote:persist", workspaceViewId: "view-persist" });
  windows.updateGeometry("window-persist", { x: 20, y: 30, width: 1200, height: 800, maximized: false });
  await windows.flush();
  assert.deepEqual(stored, [{ windowId: "window-persist", connectionId: "remote:persist", workspaceViewId: "view-persist", geometry: { x: 20, y: 30, width: 1200, height: 800, maximized: false } }]);

  const restored = new WindowViewRegistry({ storage });
  await restored.load();
  assert.deepEqual(restored.get("window-persist")?.geometry, { x: 20, y: 30, width: 1200, height: 800, maximized: false });
  stored = [{ ...stored[0], path: "/must-not-load" }];
  await assert.rejects(restored.load(), /not allowed/);
  assert.deepEqual(restored.get("window-persist")?.geometry, { x: 20, y: 30, width: 1200, height: 800, maximized: false });
  assert.throws(() => windows.updateGeometry("window-persist", { width: 0, height: 800 }), /window width/);
});

test("Local profile identity remains stable when its loopback origin rotates", () => {
  const profiles = new ConnectionProfileStore();
  const first = profiles.ensureLocal({ serverId: "local-stable", origin: "http://127.0.0.1:4010", now: "2026-01-01T00:00:00.000Z" });
  const second = profiles.ensureLocal({ serverId: "local-stable", origin: "http://127.0.0.1:4011", now: "2026-01-02T00:00:00.000Z" });
  assert.equal(first.id, second.id);
  assert.equal(second.origin, "http://127.0.0.1:4011");
  assert.equal(profiles.list().length, 1);
});

test("Local profile rejects an unexpected persisted fingerprint", () => {
  const profiles = new ConnectionProfileStore();
  profiles.ensureLocal({ serverId: "local-fingerprint", origin: "http://127.0.0.1:4012", fingerprint: "sha256:first", now: "2026-01-01T00:00:00.000Z" });
  assert.throws(() => profiles.ensureLocal({ serverId: "local-fingerprint", origin: "http://127.0.0.1:4013", fingerprint: "sha256:unexpected", now: "2026-01-02T00:00:00.000Z" }), /identity changed/);
  assert.equal(profiles.get("local:local-fingerprint")?.origin, "http://127.0.0.1:4012");
});

test("Local profile cannot be replaced by a second embedded server identity", () => {
  const profiles = new ConnectionProfileStore();
  profiles.ensureLocal({ serverId: "local-original", origin: "http://127.0.0.1:4014", now: "2026-01-01T00:00:00.000Z" });
  assert.throws(() => profiles.ensureLocal({ serverId: "local-replacement", origin: "http://127.0.0.1:4015", now: "2026-01-02T00:00:00.000Z" }), /identity changed/);
  assert.equal(profiles.list({ includeArchived: true }).filter((profile) => profile.kind === "local").length, 1);
});

test("Desktop host marks a changed Local identity instead of fabricating a replacement", async () => {
  const profiles = new ConnectionProfileStore();
  profiles.ensureLocal({ serverId: "local-before-restart", origin: "http://127.0.0.1:4016", now: "2026-01-01T00:00:00.000Z" });
  const host = new DesktopConnectionHost({ localServer: server("local-after-restart", "http://127.0.0.1:4017"), profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  await assert.rejects(host.start(), /identity changed/);
  assert.equal(profiles.get("local:local-before-restart")?.status, "identity-mismatch");
  assert.equal(profiles.get("local:local-after-restart"), undefined);
  await host.stop();
});

test("remote revoke is explicit and Local remains immutable", () => {
  const profiles = new ConnectionProfileStore();
  const remote = profiles.add(createRemoteProfile({ id: "remote-revoke", serverId: "srv-revoke", origin: "https://revoke.example", label: "Revoke", now: "2026-01-01T00:00:00.000Z" }));
  assert.throws(() => profiles.revoke(remote.id), /confirmation/);
  assert.equal(profiles.revoke(remote.id, true).status, "revoked");
  assert.throws(() => profiles.revoke("local:srv-revoke", true), /unknown|Local/);
});

test("forget requires confirmation and does not imply server revocation", () => {
  const profiles = new ConnectionProfileStore();
  const remote = profiles.add(createRemoteProfile({ id: "remote-forget", serverId: "srv-forget", origin: "https://forget.example", label: "Forget", now: "2026-01-01T00:00:00.000Z" }));
  assert.throws(() => profiles.forget(remote.id), /confirmation/);
  assert.equal(profiles.get(remote.id)?.status, "known");
  profiles.forget(remote.id, true);
  assert.equal(profiles.get(remote.id), undefined);
  assert.throws(() => profiles.forget("local:srv-forget", true), /unknown|Local/);
});

test("Desktop profile management keeps rename, archive, forget, and revoke separate", async () => {
  const profiles = new ConnectionProfileStore();
  const host = new DesktopConnectionHost({ localServer: server("local-management", "http://127.0.0.1:4430"), profiles, transports: { connect: async (profile) => transport(profile.serverId) } });
  await host.start();
  const remote = profiles.add(createRemoteProfile({ id: "remote-management", serverId: "srv-management", origin: "https://management.example", label: "Original", now: "2026-01-01T00:00:00.000Z" }));
  assert.equal(profiles.rename(remote.id, "Renamed").label, "Renamed");
  assert.throws(() => profiles.rename("local:local-management", "Not Local"), /immutable/);
  assert.equal(profiles.archive(remote.id).status, "archived");
  assert.equal(profiles.list().some((profile) => profile.id === remote.id), false);
  await assert.rejects(host.openProfile(remote.id), /unknown or archived/);
  assert.equal(profiles.patch(remote.id, { status: "known" }).archived, false);
  assert.throws(() => profiles.revoke(remote.id), /confirmation/);
  assert.equal(profiles.revoke(remote.id, true).status, "revoked");
  assert.throws(() => profiles.forget(remote.id), /confirmation/);
  profiles.forget(remote.id, true);
  assert.equal(profiles.get(remote.id), undefined);
  await host.stop();
});

test("profile persistence is sanitized and malformed snapshots do not partially clear state", async () => {
  let stored = [];
  const storage = {
    load: async () => stored,
    save: async (profiles) => { stored = profiles; },
  };
  const source = new ConnectionProfileStore({ storage });
  source.ensureLocal({ serverId: "local-persist", origin: "http://127.0.0.1:4810", now: "2026-01-01T00:00:00.000Z" });
  source.add(createRemoteProfile({ id: "remote-persist", serverId: "srv-persist", origin: "https://persist.example", label: "Persist", now: "2026-01-01T00:00:00.000Z" }));
  await source.flush();
  assert.equal(stored.length, 2);
  assert.equal(Object.hasOwn(stored[0], "reconnectGrant"), false);
  assert.equal(Object.isFrozen(source.serialize()), true);
  assert.equal(Object.isFrozen(source.serialize()[0]), true);

  const loaded = new ConnectionProfileStore({ storage });
  await loaded.load();
  assert.equal(loaded.get("remote-persist")?.label, "Persist");
  stored = [{ ...stored[0], reconnectGrant: "must-not-load" }, ...stored.slice(1)];
  await assert.rejects(loaded.load(), /not allowed/);
  assert.equal(loaded.get("remote-persist")?.label, "Persist");
});
