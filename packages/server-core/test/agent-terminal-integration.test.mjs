import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, ExtensionAgentRuntimeRegistry, TerminalActivityService, TerminalService, composeActivityLifecycle } from "../dist/index.js";

test("terminal lifecycle registers the exact spawned session with the generic agent projection", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  const agents = new AgentStatusService({ activity }); await agents.start();
  const process = { pid: 9876, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; } };
  const terminal = new TerminalService({ serverId: "server-1", ptyFactory: { spawn: () => process }, sessionLifecycle: composeActivityLifecycle(activity, agents, undefined) });
  await terminal.createSession({ projectId: "project-1", sessionId: "terminal-1", shellPath: "/bin/sh", cols: 80, rows: 24 });
  assert.equal(agents.isSessionActive({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }), true);
  await terminal.shutdown(); await agents.stop();
});

test("foreground PTY lifecycle reaches the exact canonical activity session", async () => {
  const activity = new TerminalActivityService({ serverId: "server-1" });
  let foregroundListener;
  const process = {
    write() {}, resize() {}, kill() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    onForegroundProcess(listener) { foregroundListener = listener; return () => { foregroundListener = undefined; }; },
  };
  const terminal = new TerminalService({
    serverId: "server-1",
    ptyFactory: { spawn: () => process },
    sessionLifecycle: composeActivityLifecycle(activity, undefined, undefined),
  });
  await terminal.createSession({
    projectId: "project-1",
    sessionId: "terminal-1",
    shellPath: "/bin/sh",
    cols: 80,
    rows: 24,
  });

  foregroundListener({ processName: "sleep", shellForeground: false });

  assert.deepEqual(activity.get({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }), {
    acknowledged: true,
    attention: false,
    authority: "structured",
    claimed: false,
    foregroundBusy: true,
    foregroundObservation: "available",
    projectId: "project-1",
    sessionId: "terminal-1",
    source: "structured:foreground",
    status: "working",
    updatedAt: activity.get({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" }).updatedAt,
  });
  await terminal.shutdown();
  assert.equal(foregroundListener, undefined);
});

test("a shell foreground event revokes an extension observer through the composed PTY lifecycle", async () => {
  const identity = { serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" };
  const provider = {
    id: "com.terminay.agent-codex/cli",
    displayName: "Codex",
    processMatchers: [{ executableName: "codex" }],
    mappings: [{ mappingVersion: "test-v1", providerVersionRange: ">=1" }],
    requiredEnvironmentCapabilities: ["process-observation", "filesystem-observation", "agent-journal"],
  };
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  const agents = new AgentStatusService({ activity }); await agents.start();
  const admitted = []; const cancelled = [];
  const extensionAgents = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
  });
  let foregroundListener;
  const process = {
    write() {}, resize() {}, kill() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    onForegroundProcess(listener) { foregroundListener = listener; return () => { foregroundListener = undefined; }; },
  };
  const terminal = new TerminalService({
    serverId: identity.serverId,
    ptyFactory: { spawn: () => process },
    sessionLifecycle: composeActivityLifecycle(activity, agents, undefined, extensionAgents),
  });
  await terminal.createSession({ ...identity, shellPath: "/bin/sh", cols: 80, rows: 24 });

  foregroundListener({ processName: "codex", shellForeground: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 1);
  const binding = {
    providerSessionId: "global-resumed-session",
    mappingVersion: "test-v1",
    fingerprint: { kind: "fixture", process: { id: "owner-one" }, metadata: { source: "test" } },
  };
  assert.equal((await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [{ kind: "session.started", title: "Original Codex" }])).acceptedEventCount, 1);

  // This is the exact previously-missing route: a PTY shell return must reach
  // the extension runtime, even though it is not a busy foreground process.
  foregroundListener({ processName: "zsh", shellForeground: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelled, [{ contextId: admitted[0].context.contextId, reason: "terminal-replaced" }]);
  const stale = await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", undefined, [{ kind: "turn.started", turnId: "late-global-resume" }]);
  assert.equal(stale.acceptedEventCount, 0);

  await terminal.shutdown(); await agents.stop();
});
