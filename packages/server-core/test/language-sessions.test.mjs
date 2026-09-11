import test from "node:test";
import assert from "node:assert/strict";
import { LanguageSessionManager } from "../dist/index.js";

function contribution(id = "stub") {
  return { id, displayName: "Stub", languageIds: ["typescript"], fileExtensions: [".ts"] };
}

function bridge(options = {}) {
  const calls = [];
  const diagnosticsListeners = new Set();
  const exitListeners = new Set();
  const stateListeners = new Set();
  const provider = {
    extensionId: "example.language",
    languageServerId: "example.language:stub",
    contribution: contribution(),
  };
  return {
    calls,
    provider,
    emitDiagnostics: (notification) => {
      for (const listener of diagnosticsListeners) listener(notification);
    },
    emitExit: (exit) => {
      for (const listener of exitListeners) listener(exit);
    },
    emitState: (status) => {
      for (const listener of stateListeners) listener(status);
    },
    languageServersFor: (selector) =>
      selector === ".ts" || selector === "typescript" ? [provider] : [],
    async invokeLanguage(extensionId, invocation) {
      calls.push({ extensionId, method: invocation.method, input: invocation.input });
      if (options.fail?.(invocation) === true) throw new Error("language server refused");
      return options.result?.(invocation) ?? { ok: true };
    },
    onLanguageDiagnostics(listener) {
      diagnosticsListeners.add(listener);
      return () => diagnosticsListeners.delete(listener);
    },
    onLanguageSessionExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onHostStateChanged(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
}

function manager(extensions, overrides = {}) {
  return new LanguageSessionManager({
    extensions,
    projectRoot: async (projectId) => `/tmp/projects/${projectId}`,
    ...overrides,
  });
}

test("one session serves every client of a project and language", async () => {
  const extensions = bridge();
  const sessions = manager(extensions);
  await sessions.openDocument("default", "a.ts", "typescript", "const a = 1;", 1);
  await sessions.openDocument("default", "b.ts", "typescript", "const b = 2;", 1);
  await sessions.positionRequest("default", "a.ts", "language.hover", { line: 0, character: 0 });
  const starts = extensions.calls.filter((call) => call.method === "language.session.start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].input.languageServerId, "stub");
  assert.equal(starts[0].input.projectRoot, "/tmp/projects/default");
  assert.deepEqual(sessions.states(), [
    {
      projectId: "default",
      languageServerId: "example.language:stub",
      state: "ready",
      openDocuments: 2,
    },
  ]);
  await sessions.shutdown();
});

test("an idle session with nothing open is reaped", async () => {
  const extensions = bridge();
  let now = 1_000;
  const timers = [];
  const sessions = manager(extensions, {
    idleMs: 500,
    now: () => now,
    schedule: (callback) => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    cancelSchedule: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  await sessions.openDocument("default", "a.ts", "typescript", "const a = 1;", 1);
  await sessions.closeDocument("default", "a.ts");
  now += 1_000;
  for (const timer of [...timers]) timer.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(extensions.calls.some((call) => call.method === "language.session.stop"));
  assert.deepEqual(sessions.states(), []);
  await sessions.shutdown();
});

test("a request beyond the session cap returns a typed unavailable outcome", async () => {
  const extensions = bridge();
  const sessions = manager(extensions, { maxSessions: 1 });
  await sessions.openDocument("default", "a.ts", "typescript", "const a = 1;", 1);
  const failure = await sessions
    .openDocument("second", "a.ts", "typescript", "const a = 1;", 1)
    .then(() => undefined, (error) => error);
  assert.equal(failure.code, "unavailable");
  assert.match(failure.message, /capacity/u);
  assert.equal(extensions.calls.filter((call) => call.method === "language.session.start").length, 1);
  await sessions.shutdown();
});

test("a session that cannot start is unavailable rather than retried on every keystroke", async () => {
  const extensions = bridge({ fail: (invocation) => invocation.method === "language.session.start" });
  const sessions = manager(extensions, { failureCooldownMs: 60_000 });
  await assert.rejects(
    sessions.positionRequest("default", "a.ts", "language.hover", { line: 0, character: 0 }),
    // The reason a client sees is from a fixed vocabulary: the failure text can
    // name host paths and never crosses the wire.
    /launch-failed/u,
  );
  await assert.rejects(
    sessions.positionRequest("default", "a.ts", "language.hover", { line: 0, character: 0 }),
  );
  assert.equal(extensions.calls.filter((call) => call.method === "language.session.start").length, 1);
  assert.equal(sessions.describe("default", "a.ts").state, "unavailable");
  await sessions.shutdown();
});

test("capabilities report no provider without an error and start on first ask", async () => {
  const extensions = bridge();
  const sessions = manager(extensions);
  assert.deepEqual(sessions.describe("default", "notes.md"), { state: "none" });
  const first = sessions.describe("default", "a.ts");
  assert.equal(first.state, "starting");
  assert.equal(first.languageServerId, "example.language:stub");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessions.describe("default", "a.ts").state, "ready");
  await sessions.shutdown();
});

test("diagnostics are attributed to the project and revision of their session", async () => {
  const events = [];
  const extensions = bridge();
  const sessions = manager(extensions, { onDiagnostics: (event) => events.push(event) });
  await sessions.openDocument("default", "a.ts", "typescript", "const a = 1;", 7);
  const sessionId = extensions.calls[0].input.sessionId;
  extensions.emitDiagnostics({
    sessionId,
    path: "a.ts",
    diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: "error", message: "bad" }],
    isTruncated: false,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].projectId, "default");
  assert.equal(events[0].revision, 7);
  assert.equal(events[0].languageServerId, "example.language:stub");
  await sessions.shutdown();
});

test("an extension that stops ends its sessions", async () => {
  const extensions = bridge();
  const sessions = manager(extensions);
  await sessions.openDocument("default", "a.ts", "typescript", "const a = 1;", 1);
  extensions.emitState({ extensionId: "example.language", state: "quarantined", consecutiveCrashes: 5 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sessions.states(), []);
  await sessions.shutdown();
});

test("a session that is still starting is told to stop rather than orphaned", async () => {
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const extensions = bridge();
  const started = extensions.invokeLanguage.bind(extensions);
  extensions.invokeLanguage = async (extensionId, invocation) => {
    if (invocation.method === "language.session.start") await gate;
    return started(extensionId, invocation);
  };
  const sessions = manager(extensions);
  // `describe` starts a session fire-and-forget; shutdown lands mid-start.
  assert.equal(sessions.describe("default", "a.ts").state, "starting");
  const shutdown = sessions.shutdown();
  release();
  await shutdown;
  assert.ok(
    extensions.calls.some((call) => call.method === "language.session.stop"),
    "a starting session must still be stopped",
  );
  assert.deepEqual(sessions.states(), []);
});
