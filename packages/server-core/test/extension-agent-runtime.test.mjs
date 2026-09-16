import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, ExtensionAgentRuntimeRegistry, TerminalActivityService } from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
/** Let a chain of admissions, cancellations, and re-admissions settle. */
const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const provider = Object.freeze({
  id: "com.terminay.agent-test/test",
  displayName: "Test Agent",
  processMatchers: [{ executableName: "test-agent" }],
  mappings: [{ mappingVersion: "test-v1", providerVersionRange: ">=1" }],
});

test("extension provider claims one terminal incarnation before host admission", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "bound" }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    contextId: (_identity, incarnation) => `context-${incarnation}`,
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, close() {} }; watchers.push(watcher); return watcher; },
  });

  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "/usr/local/bin/test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted.map(({ context }) => ({ id: context.contextId, providerId: context.providerId, incarnation: context.terminalIncarnationId })), [{
    id: "context-1", providerId: provider.id, incarnation: "1",
  }]);
  assert.equal(await agents.ingestJournalRecord(identity, "untrusted-provider", { type: "untrusted-record" }), false);
  const projected = await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", {
    providerSessionId: "provider-session-1",
    mappingVersion: "test-v1",
    fingerprint: { kind: "fixture", process: { id: "process-1" }, metadata: { source: "test" } },
  }, [
    { kind: "session.started", title: "Extension session" },
    { kind: "turn.started", turnId: "turn-1", promptText: "Hello from the extension" },
  ]);
  assert.deepEqual(projected, { acceptedEventCount: 2, rejectedEventCount: 0 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.provider, provider.id);
  assert.equal(entry.displayName, "Extension session");
  assert.equal(entry.promptText, "Hello from the extension");

  // Repeated foreground samples for the same live provider do not tear down
  // its root observer while collaboration processes are starting.
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(admitted.map(({ context }) => context.contextId), ["context-1"]);
  assert.deepEqual(cancelled, []);

  // A bound terminal waits on nothing: no watch is open and nothing is
  // scheduled, so nothing can re-run discovery beneath the proven root.
  assert.equal(watchers.length, 0);

  registry.terminalExited(identity);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelled, [
    { contextId: "context-1", reason: "terminal-closed" },
  ]);
  await agents.stop();
});

test("non-matching terminals still arm discovery so a wrapper can bind, without creating a sidebar run until the provider publishes", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "not-bound" }; },
      async cancelAgentTerminal() { return false; },
      async drainAgentObservers() {},
    },
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "other-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 1);
  assert.deepEqual(agents.getSnapshot().entries, {});
  await agents.stop();
});

test("an empty foreground name does not admit the first capable provider", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, ""), false);
  assert.equal(registry.foregroundProcessChanged(identity, "   "), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 0);
  await agents.stop();
});

test("an admission throw retries discovery instead of giving up on the foreground incarnation", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = []; const scheduled = [];
  let attempts = 0;
  const omp = { ...provider, id: "com.terminay.agent.omp/cli", displayName: "OMP", processMatchers: [{ executableName: "omp" }] };
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider, omp],
      async admitAgentTerminal(value) {
        admitted.push(value);
        attempts += 1;
        if (attempts === 1) throw new Error("agent IPC send failed");
        return { state: "bound" };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await settle();
  assert.equal(attempts, 2);
  assert.equal(admitted.length, 2);
  assert.deepEqual(admitted.map((value) => value.context.providerId), [provider.id, omp.id]);
  assert.equal(scheduled.length, 0, "a wrapper walks its providers on the edge, not on a timer");
  await agents.stop();
});

test("a node wrapper foreground still admits the capable agent provider", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted[0].context.providerId, provider.id);
  await agents.stop();
});

test("a node wrapper does not stay on the first alphabetical provider when a later one binds", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const claude = { ...provider, id: "com.terminay.agent.claude-code/cli", displayName: "Claude Code", processMatchers: [{ executableName: "claude" }] };
  const codex = { ...provider, id: "com.terminay.agent.codex/cli", displayName: "Codex", processMatchers: [{ executableName: "codex" }] };
  const admitted = [];
  const scheduled = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [claude, codex],
      async admitAgentTerminal(value) {
        admitted.push(value);
        return { state: value.context.providerId === codex.id ? "bound" : "not-bound" };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await settle();
  assert.deepEqual(admitted.map((value) => value.context.providerId), [claude.id, codex.id]);
  assert.equal(scheduled.length, 0);
  await agents.stop();
});

test("a prefixed Codex executable matches the Codex provider instead of the first capable one", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const claude = { ...provider, id: "com.terminay.agent.claude-code/cli", displayName: "Claude Code", processMatchers: [{ executableName: "claude" }] };
  const codex = { ...provider, id: "com.terminay.agent.codex/cli", displayName: "Codex", processMatchers: [{ executableName: "codex" }] };
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [claude, codex],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "bound" }; },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "codex-tui"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted[0].context.providerId, codex.id);
  await agents.stop();
});

test("a shell return revokes the exact observer before a globally resumed journal can publish again", async () => {
  // Separate desktop/server authorities can legitimately observe the same
  // Codex journal path after `/resume`. Only the authority whose PTY still
  // owns the provider process may retain the observer.
  const createAuthority = async () => {
    const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
    const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
    const admitted = []; const cancelled = [];
    const registry = new ExtensionAgentRuntimeRegistry({
      agents,
      hosts: {
        agentProviderContributions: () => [provider],
        async admitAgentTerminal(value) { admitted.push(value); },
        async cancelAgentTerminal(value) { cancelled.push(value); return true; },
        async drainAgentObservers() {},
      },
    });
    registry.register(identity);
    return { agents, admitted, cancelled, registry };
  };
  const first = await createAuthority();
  const second = await createAuthority();
  first.registry.foregroundProcessChanged(identity, "test-agent");
  await new Promise((resolve) => setImmediate(resolve));
  const firstContext = first.admitted[0].context.contextId;
  const binding = { providerSessionId: "shared-resumed-session", mappingVersion: "test-v1", fingerprint: { kind: "fixture", process: { id: "first-process" }, metadata: { source: "test" } } };
  assert.equal((await first.agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [{ kind: "session.started", title: "First owner" }])).acceptedEventCount, 1);

  // The first PTY returned to its shell before the second authority resumed
  // the same provider session. Its old context is cancelled and can no longer
  // mutate the first sidebar, even if the shared journal receives new bytes.
  assert.equal(first.registry.foregroundProcessChanged(identity, "zsh", true), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(first.cancelled, [{ contextId: firstContext, reason: "terminal-replaced" }]);
  const stale = await first.agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", undefined, [{ kind: "turn.started", turnId: "second-turn" }]);
  assert.equal(stale.acceptedEventCount, 0);
  assert.match(stale.failure ?? "", /own|claimed|bound/u);

  second.registry.foregroundProcessChanged(identity, "test-agent");
  await new Promise((resolve) => setImmediate(resolve));
  const secondContext = second.admitted[0].context.contextId;
  assert.notEqual(firstContext, secondContext, "same restored server/project/session labels must not mint a cross-instance context capability");
  const secondBinding = { ...binding, fingerprint: { kind: "fixture", process: { id: "second-process" }, metadata: { source: "test" } } };
  assert.equal((await second.agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", secondBinding, [{ kind: "session.started", title: "Second owner" }, { kind: "turn.started", turnId: "second-turn" }])).acceptedEventCount, 2);
  assert.equal(Object.values(first.agents.getSnapshot().entries)[0].displayName, "First owner");
  assert.equal(Object.values(second.agents.getSnapshot().entries)[0].displayName, "Second owner");
  await first.agents.stop(); await second.agents.stop();
});

test("a same-terminal resume re-admits an exited provider when the shell edge was missed", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    contextId: (_identity, incarnation) => `resume-context-${incarnation}`,
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  const binding = { providerSessionId: "resumed-session", mappingVersion: "test-v1", fingerprint: { kind: "fixture", process: { id: "process-1" }, metadata: { source: "test" } } };
  assert.equal((await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [
    { kind: "session.started", title: "Original session" },
    { kind: "agent.exited", exitCode: 0 },
  ])).acceptedEventCount, 2);

  // Process sampling saw `test-agent` again but missed the intervening shell.
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(admitted.map(({ context }) => context.contextId), ["resume-context-1", "resume-context-2"]);
  assert.deepEqual(cancelled, [{ contextId: "resume-context-1", reason: "terminal-replaced" }]);
  await agents.stop();
});

test("a same-terminal quit then resume re-admits after an explicit shell return", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value.context.contextId); },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    contextId: (_identity, incarnation) => `quit-resume-${incarnation}`,
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  const binding = { providerSessionId: "quit-resume-session", mappingVersion: "test-v1", fingerprint: { kind: "fixture", process: { id: "process-1" }, metadata: { source: "test" } } };
  assert.equal((await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [
    { kind: "session.started", title: "Original session" },
  ])).acceptedEventCount, 1);
  assert.equal(registry.foregroundProcessChanged(identity, "zsh", true), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted, ["quit-resume-1", "quit-resume-2"]);
  await agents.stop();
});

test("a throwing unmatched provider does not pin discovery away from a later binder", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const claude = { ...provider, id: "com.terminay.agent.claude-code/cli", displayName: "Claude Code", processMatchers: [{ executableName: "claude" }] };
  const codex = { ...provider, id: "com.terminay.agent.codex/cli", displayName: "Codex", processMatchers: [{ executableName: "codex" }] };
  const admitted = []; const scheduled = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [claude, codex],
      async admitAgentTerminal(value) {
        admitted.push(value.context.providerId);
        if (value.context.providerId === claude.id) throw new Error("claude observe failed");
        return { state: "bound" };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await settle();
  assert.deepEqual(admitted, [claude.id, codex.id]);
  assert.equal(scheduled.length, 0);
  registry.terminalExited(identity); await agents.stop();
});

test("a not-bound provider's named directory is watched, and its first change re-admits with no timer", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = []; const watchers = [];
  let state = "not-bound";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state, awaiting: ["/home/user/.test-agent/sessions"] }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, closed: false, close() { watcher.closed = true; } }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await settle();
  assert.equal(admitted.length, 1);
  assert.deepEqual(watchers.map((watcher) => watcher.path), ["/home/user/.test-agent/sessions"]);
  assert.equal(scheduled.length, 0, "nothing re-runs discovery but the directory changing");
  state = "bound";
  watchers[0].onChange();
  await settle();
  assert.equal(admitted.length, 2);
  assert.deepEqual(cancelled, [{ contextId: admitted[0].context.contextId, reason: "terminal-replaced" }]);
  assert.ok(watchers.every((watcher) => watcher.closed), "binding closes the wait set");
  assert.equal(scheduled.length, 0);
  await agents.stop();
});

test("a provider that names a tree gets a recursive watch, a plain directory a shallow one, and the same path is watched once", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal() {
        return { state: "not-bound", awaiting: [
          { path: "/home/user/.codex/sessions", recursive: true },
          { path: "/home/user/.codex", recursive: false },
          "/home/user/.codex",
          { path: "relative/path", recursive: true },
        ] };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange, recursive) => { const watcher = { path, recursive, onChange, close() {} }; watchers.push(watcher); return watcher; },
    schedule() { throw new Error("nothing may be scheduled"); },
    cancelSchedule() {},
  });
  registry.register(identity);
  registry.foregroundProcessChanged(identity, "test-agent");
  await settle();
  assert.deepEqual(
    watchers.map((watcher) => [watcher.path, watcher.recursive]),
    [["/home/user/.codex/sessions", true], ["/home/user/.codex", false]],
    "a relative path is dropped, and a directory named twice is watched once",
  );
  registry.terminalExited(identity); await agents.stop();
});

test("a not-bound provider that names nothing ends discovery until the next foreground edge", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const scheduled = []; const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "not-bound" }; },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, close() {} }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await settle();
  assert.equal(admitted.length, 1);
  assert.equal(watchers.length, 0);
  assert.equal(scheduled.length, 0);
  // Only a new foreground edge starts discovery again.
  registry.foregroundProcessChanged(identity, "zsh", true);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await settle();
  assert.equal(admitted.length, 2);
  registry.terminalExited(identity); await agents.stop();
});

test("a late-published agent provider re-admits an already-running matching terminal", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const providers = []; const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => providers,
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal() { return false; },
      async drainAgentObservers() {},
    },
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "codex"), false);
  providers.push({ ...provider, id: "com.terminay.agent.codex/cli", displayName: "Codex", processMatchers: [{ executableName: "codex" }] });
  assert.equal(registry.reobserveExistingTerminals(), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted.map(({ context }) => context.providerId), ["com.terminay.agent.codex/cli"]);
  await agents.stop();
});

test("a disabled then re-enabled provider immediately reclaims its live terminal", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const providers = [provider]; const admitted = []; const cancelled = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => providers,
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    contextId: (_identity, incarnation) => `context-${incarnation}`,
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 1);

  providers.splice(0);
  assert.equal(await registry.reconcileProviderInventory(), 1);
  assert.deepEqual(cancelled, [{ contextId: "context-1", reason: "provider-disabled" }]);

  providers.push(provider);
  assert.equal(registry.reobserveExistingTerminals(), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted.map(({ context }) => context.contextId), ["context-1", "context-2"]);
  await agents.stop();
});

test("a failed agent admission is observable before the sidebar falls back to no agent entries", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const failures = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal() { throw new Error("agent extension host does not exist: /private/provider-journal"); },
      async cancelAgentTerminal() { return false; },
      async drainAgentObservers() {},
    },
    onAdmissionFailure(failure) { failures.push(failure); throw new Error("diagnostics unavailable"); },
  });

  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true, "the matched provider is claimed before asynchronous admission");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(failures.length, 1, "a failed admission must be visible even though the sidebar has no provider entry");
  const { error, ...metadata } = failures[0];
  assert.deepEqual(metadata, {
    kind: "agent-admission-failed",
    providerId: provider.id,
    terminal: identity,
    failureClass: "host-failed",
    reason: "agent extension host does not exist: /private/provider-journal",
  });
  assert.equal(error.name, "Error");
  assert.equal(error.message, "agent extension host does not exist: /private/provider-journal");
  assert.match(error.stack, /agent extension host does not exist/u, "the reported error is recorded as it was raised");
  assert.deepEqual(agents.getSnapshot().entries, {}, "the failed provider claim is released instead of leaving a phantom sidebar agent");
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true, "a failing diagnostics sink cannot prevent the terminal from retrying");
  await agents.stop();
});

test("churn in a watched directory re-observes at most once per ramp interval, widens to the ceiling, and resets after quiet", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const scheduled = []; const watchers = [];
  let now = 1_000_000;
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "not-bound", awaiting: ["/home/user/.codex/sessions"] }; },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    rampIntervalsMs: [100, 200, 400],
    now: () => now,
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, close() {} }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "codex"), true);
  await settle();
  assert.equal(admitted.length, 1);
  assert.equal(watchers.length, 1, "the wait set is one directory, however often it is named");

  // The first change after a quiet period is acted on at once.
  const change = watchers[0].onChange;
  change(); await settle();
  assert.equal(admitted.length, 2);
  assert.equal(scheduled.length, 0);

  // Changes inside the floor collapse into one run at its end, and each such
  // run widens the floor: 100, 200, 400, then held at 400.
  const waits = [];
  for (const expected of [100, 200, 400, 400]) {
    now += 10;
    change(); change(); change();
    assert.equal(scheduled.length, 1, "changes inside an interval collapse into one pending run");
    const timer = scheduled.shift();
    waits.push(timer.milliseconds);
    now += timer.milliseconds;
    timer.callback(); await settle();
    void expected;
  }
  assert.deepEqual(waits, [90, 190, 390, 390]);
  assert.equal(admitted.length, 6);
  assert.equal(watchers.length, 1, "re-observation never opens a second watch on the same directory");

  // Quiet for the whole interval: back to the floor, and prompt again.
  now += 1_000;
  change(); await settle();
  assert.equal(admitted.length, 7);
  assert.equal(scheduled.length, 0);
  registry.terminalExited(identity); await agents.stop();
});

test("returning to the shell closes the wait set, and a late change on it re-runs nothing", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const scheduled = []; const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "not-bound", awaiting: ["/home/user/.codex/sessions"] }; },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, closed: false, close() { watcher.closed = true; } }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  registry.foregroundProcessChanged(identity, "codex");
  await settle();
  assert.equal(watchers.length, 1);

  registry.foregroundProcessChanged(identity, "zsh", true);
  assert.ok(watchers[0].closed, "the shell coming back ends this incarnation's wait");
  watchers[0].onChange();
  await settle();
  assert.equal(admitted.length, 1, "a change on a closed watch is not evidence for anything");
  assert.equal(scheduled.length, 0);

  // Whatever runs next gets its own wait set.
  registry.foregroundProcessChanged(identity, "codex");
  await settle();
  assert.equal(admitted.length, 2);
  assert.equal(watchers.length, 2);
  assert.equal(watchers[1].closed, false);
  registry.terminalExited(identity); await agents.stop();
});

test("a wrapper's providers each name their wait set, and a change re-walks the queue from its head", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const claude = { ...provider, id: "com.terminay.agent.claude-code/cli", displayName: "Claude Code", processMatchers: [{ executableName: "claude" }] };
  const codex = { ...provider, id: "com.terminay.agent.codex/cli", displayName: "Codex", processMatchers: [{ executableName: "codex" }] };
  const admitted = []; const scheduled = []; const watchers = [];
  let codexState = "not-bound";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [claude, codex],
      async admitAgentTerminal(value) {
        admitted.push(value.context.providerId);
        return value.context.providerId === codex.id
          ? { state: codexState, awaiting: ["/home/user/.codex/sessions"] }
          : { state: "not-bound", awaiting: ["/home/user/.claude/sessions"] };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, closed: false, close() { watcher.closed = true; } }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await settle();
  assert.deepEqual(admitted, [claude.id, codex.id], "every capable provider gets one look per edge");
  assert.deepEqual(watchers.map((watcher) => watcher.path).sort(), ["/home/user/.claude/sessions", "/home/user/.codex/sessions"]);
  assert.equal(scheduled.length, 0);

  // The rollout Codex was waiting on appears: the walk starts again, and this
  // time Codex proves its binding.
  codexState = "bound";
  watchers.find((watcher) => watcher.path === "/home/user/.codex/sessions").onChange();
  await settle();
  assert.deepEqual(admitted, [claude.id, codex.id, claude.id, codex.id]);
  assert.ok(watchers.every((watcher) => watcher.closed));
  registry.terminalExited(identity); await agents.stop();
});

test("a bound terminal holds no watch and nothing scheduled, so nothing can re-run discovery beneath its root", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = []; const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: { agentProviderContributions: () => [provider], async admitAgentTerminal(value) { admitted.push(value); return { state: "bound" }; }, async cancelAgentTerminal(value) { cancelled.push(value); return true; }, async drainAgentObservers() {} },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, close() {} }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.foregroundProcessChanged(identity, "test-agent");
  await settle();
  assert.equal(admitted.length, 1); assert.equal(cancelled.length, 0);
  assert.equal(watchers.length, 0); assert.equal(scheduled.length, 0);
  // A worker joining the process tree is ordinary activity beneath the root.
  assert.equal(registry.foregroundProcessChanged(identity, "worker"), true);
  await settle();
  assert.equal(admitted.length, 1); assert.deepEqual(cancelled, []);
  registry.terminalExited(identity); await agents.stop();
});

test("two terminals of the same provider both keep an active root", async () => {
  const left = identity;
  const right = Object.freeze({ serverId: identity.serverId, projectId: "project-2", sessionId: "terminal-2" });
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(left); activity.register(right);
  const agents = new AgentStatusService({ activity }); await agents.start();
  agents.register(left); agents.register(right);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value.context.terminalSessionId); return { state: "bound" }; },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
  });
  registry.register(left); registry.register(right);
  registry.terminalStarted(left, 19049); registry.terminalStarted(right, 44903);
  assert.equal(registry.foregroundProcessChanged(left, "test-agent"), true);
  assert.equal(registry.foregroundProcessChanged(right, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted.sort(), ["terminal-1", "terminal-2"]);
  const binding = (sessionId) => ({
    providerSessionId: `provider-${sessionId}`,
    mappingVersion: "test-v1",
    fingerprint: { kind: "fixture", process: { id: sessionId }, metadata: { source: "test" } },
  });
  assert.equal((await agents.ingestExtensionLifecycle(left, provider.id, "test-v1", binding("terminal-1"), [
    { kind: "session.started", title: "Books Grok" },
    { kind: "turn.started", turnId: "turn-1" },
    { kind: "agent.done", outcome: "success" },
  ])).acceptedEventCount, 3);
  assert.equal((await agents.ingestExtensionLifecycle(right, provider.id, "test-v1", binding("terminal-2"), [
    { kind: "session.started", title: "Terminay Grok" },
    { kind: "turn.started", turnId: "turn-1" },
  ])).acceptedEventCount, 2);
  const entries = Object.values(agents.getSnapshot().entries);
  assert.equal(entries.filter((entry) => entry.active && entry.kind === "root").length, 2);
  assert.equal((await agents.ingestExtensionLifecycle(left, provider.id, "test-v1", undefined, [
    { kind: "turn.started", turnId: "turn-2" },
  ])).acceptedEventCount, 1);
  const books = Object.values(agents.getSnapshot().entries).find((entry) => entry.displayName === "Books Grok");
  assert.equal(books.state, "working");
  assert.equal(books.active, true);
  registry.terminalExited(left); registry.terminalExited(right); await agents.stop();
});

test("a proven writer's terminal is retired only by terminal replacement, never by discovery", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = []; const watchers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state: "bound" }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    watchDirectory: (path, onChange) => { const watcher = { path, onChange, close() {} }; watchers.push(watcher); return watcher; },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await settle();
  const binding = { providerSessionId: "writer-session", mappingVersion: "test-v1", fingerprint: { kind: "fixture", process: { id: "writer-1" }, metadata: { source: "test" } } };
  assert.equal((await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [{ kind: "session.started", title: "Local writer" }])).acceptedEventCount, 1);
  assert.equal(watchers.length, 0); assert.equal(scheduled.length, 0);
  assert.deepEqual(cancelled, []);
  const continued = await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", undefined, [{ kind: "turn.started", turnId: "same-pty-turn" }]);
  assert.equal(continued.acceptedEventCount, 1);
  registry.foregroundProcessChanged(identity, "zsh", true);
  assert.deepEqual(cancelled, [{ contextId: admitted[0].context.contextId, reason: "terminal-replaced" }]);
  registry.terminalExited(identity); await agents.stop();
});

test("every terminal admits with the server's full observation capability set", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted=[];
  const registry=new ExtensionAgentRuntimeRegistry({agents,hosts:{agentProviderContributions:()=>[provider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(){return true;},async drainAgentObservers(){}}});
  registry.register(identity); assert.equal(registry.foregroundProcessChanged(identity,"test-agent"),true); await new Promise((resolve)=>setImmediate(resolve));
  assert.deepEqual(admitted[0].observationCapabilities,["process-observation","filesystem-observation","agent-journal"]);
  registry.terminalExited(identity); await agents.stop();
});

test("provider retirement and project teardown are exact and idempotent", async () => {
  const secondIdentity={...identity,sessionId:"terminal-2"};
  const otherProvider={...provider,id:"com.terminay.agent-other/test"};
  const activity=new TerminalActivityService({serverId:identity.serverId}); activity.register(identity);activity.register(secondIdentity);
  const agents=new AgentStatusService({activity});await agents.start();agents.register(identity);agents.register(secondIdentity);
  const admitted=[];const cancelled=[];
  const registry=new ExtensionAgentRuntimeRegistry({agents,hosts:{agentProviderContributions:()=>[provider,otherProvider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(value){cancelled.push(value);return true;},async drainAgentObservers(){}}});
  registry.register(identity);registry.register(secondIdentity);
  registry.foregroundProcessChanged(identity,"test-agent");
  // Select the unrelated provider deterministically through its unique matcher.
  otherProvider.processMatchers=[{executableName:"other-agent"}]; registry.foregroundProcessChanged(secondIdentity,"other-agent");
  await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(await registry.retireProvider(provider.id),1);assert.equal(await registry.retireProvider(provider.id),0);
  assert.deepEqual(cancelled,[{contextId:admitted[0].context.contextId,reason:"provider-disabled"}]);
  registry.projectRemoved(identity.projectId);await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(cancelled.length,2);assert.equal(cancelled[1].contextId,admitted[1].context.contextId);
  registry.projectRemoved(identity.projectId);await new Promise((resolve)=>setImmediate(resolve));assert.equal(cancelled.length,2);
  await agents.stop();
});

test("a host-originated child retirement clears only its exact runtime context", async()=>{
  const activity=new TerminalActivityService({serverId:identity.serverId});activity.register(identity);
  const agents=new AgentStatusService({activity});await agents.start();agents.register(identity);const admitted=[];
  const registry=new ExtensionAgentRuntimeRegistry({agents,hosts:{agentProviderContributions:()=>[provider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(){throw new Error("must not echo cancellation");},async drainAgentObservers(){}}});
  registry.register(identity);registry.foregroundProcessChanged(identity,"test-agent");await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(registry.contextRetired(admitted[0].context.contextId,provider.id),true);
  assert.equal(registry.contextRetired(admitted[0].context.contextId,provider.id),false);
  assert.equal(registry.foregroundProcessChanged(identity,"test-agent"),true);
  await new Promise((resolve)=>setImmediate(resolve));assert.equal(admitted.length,2);await agents.stop();
});

test("teardown causes retire each context exactly once", async (t) => {
  const scenarios=[
    ["terminal exit",(registry,id,_context)=>registry.terminalExited(id),"terminal-closed",1],
    ["provider disable",(registry,_id,context)=>registry.retireProvider(context.providerId,"provider-disabled"),"provider-disabled",1],
    ["provider update",(registry,_id,context)=>registry.retireProvider(context.providerId,"extension-stopped"),"extension-stopped",1],
    ["project removal",(registry,id)=>registry.projectRemoved(id.projectId),"terminal-closed",1],
    ["child crash",(registry,_id,context)=>registry.contextRetired(context.contextId,context.providerId),undefined,0],
    ["server shutdown",(registry)=>registry.drain("server-stopping"),undefined,0],
  ];
  for(const [name,action,reason,cancelCount] of scenarios) await t.test(name,async()=>{
    const activity=new TerminalActivityService({serverId:identity.serverId});activity.register(identity);
    const agents=new AgentStatusService({activity});await agents.start();agents.register(identity);const admitted=[];const cancelled=[];let drains=0;
    const registry=new ExtensionAgentRuntimeRegistry({agents,hosts:{agentProviderContributions:()=>[provider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(value){cancelled.push(value);return true;},async drainAgentObservers(){drains++;}}});
    registry.register(identity);registry.foregroundProcessChanged(identity,"test-agent");await new Promise((resolve)=>setImmediate(resolve));const context=admitted[0].context;
    await action(registry,identity,context);await action(registry,identity,context);await new Promise((resolve)=>setImmediate(resolve));
    assert.equal(cancelled.length,cancelCount);if(reason!==undefined)assert.equal(cancelled[0].reason,reason);
    assert.equal(drains,name==="server shutdown"?1:0);await agents.stop();
  });
});

test("a stalled provider retirement does not disturb a healthy provider context",async()=>{
  const otherIdentity={...identity,projectId:"project-2",sessionId:"terminal-2"};const otherProvider={...provider,id:"com.terminay.agent-other/test",processMatchers:[{executableName:"other-agent"}]};
  const activity=new TerminalActivityService({serverId:identity.serverId});activity.register(identity);activity.register(otherIdentity);
  const agents=new AgentStatusService({activity});await agents.start();agents.register(identity);agents.register(otherIdentity);const admitted=[];let unblock;
  const registry=new ExtensionAgentRuntimeRegistry({agents,hosts:{agentProviderContributions:()=>[provider,otherProvider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(value){if(value.contextId===admitted[0].context.contextId)await new Promise((resolve)=>{unblock=resolve;});return true;},async drainAgentObservers(){}}});
  registry.register(identity);registry.register(otherIdentity);registry.foregroundProcessChanged(identity,"test-agent");registry.foregroundProcessChanged(otherIdentity,"other-agent");await new Promise((resolve)=>setImmediate(resolve));
  const retiring=registry.retireProvider(provider.id);await new Promise((resolve)=>setImmediate(resolve));
  assert.notEqual(registry.observationTerminal(admitted[1].context),undefined);
  assert.equal(registry.foregroundProcessChanged(otherIdentity,"other-agent"),true);unblock();await retiring;await settle();
  // The repeated match found no live root and re-admitted the other terminal
  // at once; its newest context, not the stalled retirement, owns it.
  const latest=admitted.filter((value)=>value.context.terminalSessionId===otherIdentity.sessionId).at(-1);
  assert.notEqual(registry.observationTerminal(latest.context),undefined);await agents.stop();
});

/**
 * Two terminals of one project each running the same provider's CLI. The
 * privileged host admits exactly one context per context id and refuses a
 * repeat, so the id it issues must depend on which terminal it is for. This
 * double enforces that refusal the way `ExtensionHost.admitAgentTerminal`
 * does, which the other doubles in this file do not.
 */
const secondIdentity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-2" });

function admittingHost(admitted, cancelled) {
  const contexts = new Set();
  return {
    agentProviderContributions: () => [provider],
    async admitAgentTerminal(value) {
      if (contexts.has(value.context.contextId))
        throw new Error("agent terminal context is already admitted");
      contexts.add(value.context.contextId);
      admitted.push(value);
    },
    async cancelAgentTerminal(value) { cancelled.push(value); contexts.delete(value.contextId); return true; },
    async drainAgentObservers() {},
  };
}

test("two terminals running one provider are each admitted with their own context", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity); activity.register(secondIdentity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity); agents.register(secondIdentity);
  const admitted = []; const cancelled = [];
  // No `contextId` override: this must exercise the shipped default, because
  // an injected double can carry the same collision and hide it.
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: admittingHost(admitted, cancelled),
  });

  for (const [terminal, shellPid] of [[identity, 4321], [secondIdentity, 4322]]) {
    registry.register(terminal);
    registry.terminalStarted(terminal, shellPid);
    assert.equal(registry.foregroundProcessChanged(terminal, "/usr/local/bin/test-agent"), true);
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(
    admitted.map(({ context }) => context.terminalSessionId),
    [identity.sessionId, secondIdentity.sessionId],
    "both terminals must be admitted; the second is refused when the context id ignores terminal identity",
  );
  const [first, second] = admitted.map(({ context }) => context.contextId);
  assert.notEqual(first, second, "two live terminals must not share one context id");
});

test("observation records tell a bound terminal apart from one that never binds", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity); activity.register(secondIdentity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity); agents.register(secondIdentity);
  const observations = [];
  // A terminal the provider never binds is swept again on the registry's own
  // timers, and each sweep records `released` and re-admits. This test is about
  // the transitions one observation produces, so the schedule is held: nothing
  // fires unless this test fires it. With real timers a loaded runner slipped a
  // sweep into the window and the exact sequence below became unprovable.
  const heldTimers = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      // The first terminal's provider finds its session; the second's does not.
      async admitAgentTerminal(value) {
        return value.context.terminalSessionId === identity.sessionId
          ? { state: "bound" }
          : { state: "not-bound" };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    onObservation: (record) => observations.push(record),
    schedule: (callback, milliseconds) => {
      const timer = { callback, milliseconds };
      heldTimers.push(timer);
      return timer;
    },
    cancelSchedule: (timer) => {
      const at = heldTimers.indexOf(timer);
      if (at !== -1) heldTimers.splice(at, 1);
    },
  });

  const forSession = (sessionId) => observations
    .filter((record) => record.terminal.sessionId === sessionId)
    .map((record) => record.transition);

  for (const [terminal, shellPid, settled] of [
    [identity, 5321, ["matched", "admitted", "bound"]],
    [secondIdentity, 5322, ["matched", "admitted"]],
  ]) {
    registry.register(terminal);
    registry.terminalStarted(terminal, shellPid);
    registry.foregroundProcessChanged(terminal, "test-agent");
    // Admission is several awaits deep, so wait for the observation to land
    // rather than for a fixed number of turns.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (forSession(terminal.sessionId).length >= settled.length) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  assert.deepEqual(forSession(identity.sessionId), ["matched", "admitted", "bound"]);
  assert.deepEqual(forSession(secondIdentity.sessionId), ["matched", "admitted"], "a terminal that never binds is distinguishable from one that was never matched");
  assert.deepEqual(forSession("terminal-that-never-ran"), []);
  for (const record of observations) {
    assert.equal(record.providerId, provider.id);
    assert.deepEqual(Object.keys(record.terminal).sort(), ["projectId", "serverId", "sessionId"]);
    assert.equal(typeof record.at, "number");
  }
  await agents.stop();
});

test("observation records carry no journal, prompt, tool input, tool result, or observed-project path", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const observations = [];
  const failures = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      // Everything a provider could hand back that must never be copied into a
      // record: the journal it opened, the prompt it read, and a tool result.
      async admitAgentTerminal() {
        return {
          state: "bound",
          journalPath: "/Users/canary/project/.claude/projects/session-canary.jsonl",
          promptText: "prompt-canary",
          tool: { input: "tool-input-canary", result: "tool-result-canary" },
        };
      },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
    onObservation: (record) => observations.push(record),
    onAdmissionFailure: (failure) => failures.push(failure),
  });

  registry.register(identity);
  registry.terminalStarted(identity, 7321);
  registry.foregroundProcessChanged(identity, "test-agent");
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(observations.length > 0, "the terminal produced records to check");
  const encoded = JSON.stringify([...observations, ...failures]);
  for (const canary of ["session-canary", "prompt-canary", "tool-input-canary", "tool-result-canary", "/Users/canary"]) {
    assert.equal(encoded.includes(canary), false, canary);
  }
  for (const record of observations) {
    assert.deepEqual(
      Object.keys(record).filter((key) => !["failureClass", "reason", "error"].includes(key)).sort(),
      ["at", "providerId", "terminal", "transition"],
    );
  }
  await agents.stop();
});

test("releasing an observer is recorded with the reason it was released", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const observations = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: admittingHost([], []),
    onObservation: (record) => observations.push(record),
  });

  registry.register(identity);
  registry.terminalStarted(identity, 6321);
  registry.foregroundProcessChanged(identity, "test-agent");
  await new Promise((resolve) => setImmediate(resolve));
  registry.foregroundProcessChanged(identity, "zsh", true);

  const released = observations.filter((record) => record.transition === "released");
  assert.equal(released.length, 1, "the terminal returning to its shell releases its observer");
  assert.equal(released[0].reason, "shell-foreground");
  await agents.stop();
});

test("the issued context id distinguishes terminals at the same incarnation", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity); activity.register(secondIdentity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity); agents.register(secondIdentity);
  const admitted = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal() { return true; },
      async drainAgentObservers() {},
    },
  });

  for (const [terminal, shellPid] of [[identity, 4321], [secondIdentity, 4322]]) {
    registry.register(terminal);
    registry.terminalStarted(terminal, shellPid);
    registry.foregroundProcessChanged(terminal, "/usr/local/bin/test-agent");
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Both are the first incarnation of their own terminal.
  assert.deepEqual(admitted.map(({ context }) => context.terminalIncarnationId), ["1", "1"]);
  assert.equal(new Set(admitted.map(({ context }) => context.contextId)).size, 2);
});
