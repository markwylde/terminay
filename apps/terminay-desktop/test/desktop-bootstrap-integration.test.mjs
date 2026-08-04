import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { decodeFrame, encodeFrame } from "@terminay/protocol";
import {
  ConnectionProfileStore,
  createDesktopLocalServerSupervisor,
  DesktopConnectionHost,
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
  return {
    get state() { return state; },
    get queuedBytes() { return 0; },
    get bufferedBytes() { return queue.reduce((total, frame) => total + frame.byteLength, 0); },
    incoming: {
      [Symbol.asyncIterator]() {
        return {
          next: () => queue.length
            ? Promise.resolve({ done: false, value: queue.shift() })
            : new Promise((resolve) => waiters.push(resolve)),
        };
      },
    },
    async open() { state = "open"; },
    async send(frame) {
      const envelope = decodeFrame(frame).envelope;
      if (envelope.type === "client_hello") {
        queueMicrotask(() => push(encodeFrame({
          type: "server_hello",
          protocolVersion: 1,
          serverId,
          serverVersion: "test",
          clientId: envelope.clientId,
          capabilities: [],
          limits: {
            maxFrameBytes: 1024,
            maxHeaderBytes: 1024,
            maxBodyBytes: 1024,
            maxQueuedBytes: 1024,
            maxStreamChunkBytes: 1024,
            maxBinaryChunkBytes: 1024,
            maxCapabilities: 8,
            maxEventsPerBatch: 8,
          },
          authScope: "write",
        }, new Uint8Array())));
      }
    },
    async waitForWritable() {},
    async close() {
      state = "closed";
      for (const resolve of waiters.splice(0)) resolve({ done: true, value: undefined });
    },
    onStateChange() { return () => {}; },
  };
}

function bootstrapAuthority(counters, bootstrap) {
  const listeners = new Set();
  const credential = bootstrap.claim();
  const authority = {
    state: "created",
    async start() {
      counters.starts += 1;
      authority.state = "starting";
      for (const listener of listeners) listener("starting");
      authority.state = "migrating";
      for (const listener of listeners) listener("migrating");
      authority.state = "ready";
      for (const listener of listeners) listener("ready");
      return {
        serverId: "local-bootstrap",
        serverVersion: "1.0.0",
        origin: "http://127.0.0.1:4317",
        endpoint: "127.0.0.1:4317",
        bootstrapCredential: credential.value,
        bootstrapCredentialExpiresAt: credential.expiresAt,
        credentialDigest: createHash("sha256").update(credential.value).digest("hex"),
      };
    },
    async stop() {
      counters.stops += 1;
      authority.state = "stopped";
      for (const listener of listeners) listener("stopped");
    },
    onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(state) {
      authority.state = state;
      for (const listener of listeners) listener(state);
    },
  };
  return authority;
}

test("Desktop supervisor composes Local bootstrap state with the connection host", async () => {
  const counters = { factories: 0, starts: 0, stops: 0 };
  let authority;
  const supervisor = createDesktopLocalServerSupervisor({
    create: (bootstrap) => {
      counters.factories += 1;
      authority = bootstrapAuthority(counters, bootstrap);
      return authority;
    },
  });
  const localStates = [];
  supervisor.onStateChange((state) => localStates.push(state));

  let localContext;
  const host = new DesktopConnectionHost({
    localServer: supervisor,
    profiles: new ConnectionProfileStore(),
    transports: {
      connect: async (profile, context) => {
        assert.equal(profile.kind, "local");
        localContext = context;
        return transport(profile.serverId);
      },
    },
  });

  const opened = await host.openInitialWindow({ workspaceViewId: "view-local", createWindowId: () => "window-local" });
  assert.equal(counters.factories, 1);
  assert.equal(counters.starts, 1);
  assert.equal(opened.connection.profile.id, "local:local-bootstrap");
  assert.equal(host.currentConnectionHeader?.label, "Local");
  assert.equal(host.state.localServerState, "ready");
  assert.ok(localStates.includes("migrating"), "bootstrap migration must cross the Desktop supervisor");
  assert.equal(localContext.serverId, "local-bootstrap");
  assert.equal(localContext.serverVersion, "1.0.0");
  assert.equal(localContext.origin, "http://127.0.0.1:4317");
  assert.equal(localContext.endpoint, "127.0.0.1:4317");
  assert.match(localContext.bootstrapCredential, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(localContext.bootstrapCredentialExpiresAt > Date.now());
  assert.equal(localContext.credentialDigest, createHash("sha256").update(localContext.bootstrapCredential).digest("hex"));
  assert.equal(JSON.stringify(host.profiles.serialize()).includes(localContext.bootstrapCredential), false);
  assert.equal(JSON.stringify(host.state).includes(localContext.bootstrapCredential), false);

  authority.emit("crashed");
  assert.equal(host.currentConnection, undefined);
  assert.equal(host.state.phase, "failed");
  assert.equal(host.currentConnectionHeader?.status, "failed");

  await host.stop();
  assert.equal(counters.stops, 1);
});
