import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createDesktopLocalServerSupervisor } from "../dist/main/index.js";

function fakeServer(serverId, counters, bootstrap, onClaim, terminalSessions = []) {
  const listeners = new Set();
  const credential = bootstrap.claim();
  onClaim?.(credential);
  return {
    state: "created",
    async start() {
      counters.starts += 1;
      this.state = "ready";
      for (const listener of listeners) listener("ready");
      return {
        serverId,
        serverVersion: "1.0.0",
        origin: "http://127.0.0.1:4000",
        endpoint: "127.0.0.1:4000",
        bootstrapCredential: credential.value,
        bootstrapCredentialExpiresAt: credential.expiresAt,
        credentialDigest: createHash("sha256").update(credential.value).digest("hex"),
      };
    },
    async stop() {
      counters.stops += 1;
      for (const session of terminalSessions) session.state = "stopped";
      this.state = "stopped";
      for (const listener of listeners) listener("stopped");
    },
    onStateChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(state) { this.state = state; for (const listener of listeners) listener(state); },
  };
}

test("Desktop Local supervisor creates exactly one authority for concurrent starts", async () => {
  const counters = { factories: 0, starts: 0, stops: 0 };
  let claimed;
  const supervisor = createDesktopLocalServerSupervisor({ create: (bootstrap) => {
    counters.factories += 1;
    return fakeServer("local-supervised", counters, bootstrap, (credential) => { claimed = credential; });
  } });
  const [first, second] = await Promise.all([supervisor.start(), supervisor.start()]);
  assert.equal(counters.factories, 1);
  assert.equal(counters.starts, 1);
  assert.equal(first.serverId, second.serverId);
  assert.match(first.bootstrapCredential, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.bootstrapCredentialExpiresAt, claimed.expiresAt);
  assert.ok(first.bootstrapCredentialExpiresAt > Date.now());
  assert.ok(first.bootstrapCredentialExpiresAt <= Date.now() + supervisor.bootstrapCredentialTtlMs);
  assert.equal(supervisor.state, "ready");
  await Promise.all([supervisor.stop(), supervisor.stop()]);
  assert.equal(counters.stops, 1);
  assert.equal(supervisor.state, "stopped");
});

test("Desktop Local supervisor requires explicit recovery after a crash and creates no overlapping child", async () => {
  const counters = { factories: 0, starts: 0, stops: 0 };
  let current;
  const supervisor = createDesktopLocalServerSupervisor({ create: (bootstrap) => {
    counters.factories += 1;
    // The child claims the one-time credential before it starts.
    current = fakeServer(`local-${counters.factories}`, counters, bootstrap);
    return current;
  } });
  await supervisor.start();
  // The underlying child is intentionally exposed only to this test fixture;
  // production callers receive state through the supervisor subscription.
  current.emit("crashed");
  assert.equal(supervisor.state, "crashed");
  const [firstRestart, secondRestart] = await Promise.all([supervisor.restart(), supervisor.restart()]);
  assert.equal(firstRestart.serverId, "local-2");
  assert.equal(secondRestart.serverId, "local-2");
  assert.equal(counters.factories, 2);
  assert.equal(counters.starts, 2);
  // Restart first retires the crashed authority. Concurrent recovery callers
  // coalesce onto one replacement rather than creating overlapping children.
  assert.equal(counters.stops, 1);
  await supervisor.stop();
  assert.equal(counters.stops, 2);
});

test("Desktop Local survives renderer reload and window close until application quit", async () => {
  const counters = { factories: 0, starts: 0, stops: 0 };
  // This session belongs to the embedded server fixture, rather than the
  // renderer lifecycle signals supplied to the supervisor.
  const terminalSessions = [{ sessionId: "default", state: "running" }];
  const supervisor = createDesktopLocalServerSupervisor({
    lifecyclePolicy: "application",
    create: (bootstrap) => {
      counters.factories += 1;
      return fakeServer("local-application-lifecycle", counters, bootstrap, undefined, terminalSessions);
    },
  });

  await supervisor.start();
  await supervisor.handleLifecycle({ type: "renderer-reload" });
  await supervisor.handleLifecycle({ type: "window-closed", remainingWindows: 0 });
  assert.equal(supervisor.state, "ready");
  assert.deepEqual(counters, { factories: 1, starts: 1, stops: 0 });
  assert.deepEqual(terminalSessions, [{ sessionId: "default", state: "running" }]);

  await supervisor.handleLifecycle({ type: "application-quit" });
  assert.equal(supervisor.state, "stopped");
  assert.deepEqual(counters, { factories: 1, starts: 1, stops: 1 });
  assert.deepEqual(terminalSessions, [{ sessionId: "default", state: "stopped" }]);
});

test("Desktop Local last-window policy waits for the final window and does not race reload", async () => {
  const counters = { factories: 0, starts: 0, stops: 0 };
  const supervisor = createDesktopLocalServerSupervisor({
    lifecyclePolicy: "last-window",
    create: (bootstrap) => {
      counters.factories += 1;
      return fakeServer("local-last-window-lifecycle", counters, bootstrap);
    },
  });

  await supervisor.start();
  await supervisor.handleLifecycle({ type: "renderer-reload" });
  await supervisor.handleLifecycle({ type: "window-closed", remainingWindows: 1 });
  assert.equal(supervisor.state, "ready");
  assert.equal(counters.stops, 0);

  await supervisor.handleLifecycle({ type: "window-closed", remainingWindows: 0 });
  assert.equal(supervisor.state, "stopped");
  assert.equal(counters.stops, 1);
  await supervisor.handleLifecycle({ type: "application-quit" });
  assert.equal(counters.stops, 1);
});
