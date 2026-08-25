import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, ExtensionAgentRuntimeRegistry, TerminalActivityService } from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
const provider = Object.freeze({
  id: "com.terminay.agent-test/test",
  displayName: "Test Agent",
  processMatchers: [{ executableName: "test-agent" }],
  mappings: [{ mappingVersion: "test-v1", providerVersionRange: ">=1" }],
  requiredEnvironmentCapabilities: ["process-observation", "filesystem-observation", "agent-journal"],
});

test("extension provider claims one terminal incarnation before host admission", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = [];
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    contextId: (_identity, incarnation) => `context-${incarnation}`,
    reobserveDebounceMs: 0,
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

  // A worker joining the process topology must not cancel the already-proven
  // root observer. Explicit foreground replacement owns that transition.
  registry.topologyChanged(identity);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(admitted.map(({ context }) => context.contextId), ["context-1"]);
  assert.deepEqual(cancelled, []);

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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal(scheduled.length, 1);
  await scheduled.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(admitted.length, 2);
  assert.deepEqual(admitted.map((value) => value.context.providerId), [provider.id, omp.id]);
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted[0].context.providerId, claude.id);
  assert.equal(scheduled.length, 1);
  await scheduled.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted.map((value) => value.context.providerId), [claude.id, codex.id]);
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
    reobserveDebounceMs: 0,
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
    reobserveDebounceMs: 0,
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "node"), true);
  await new Promise((resolve) => setImmediate(resolve));
  const rotate = scheduled.find((timer) => timer.milliseconds === 0);
  assert.ok(rotate, "a throwing unmatched provider must rotate to the next capable provider");
  await rotate.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(admitted, [claude.id, codex.id]);
  registry.terminalExited(identity); await agents.stop();
});

test("a not-bound foreground provider retries its exact terminal until its journal appears", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = [];
  let state = "not-bound";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].milliseconds, 100);
  state = "bound";
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 2);
  assert.deepEqual(cancelled, [{ contextId: admitted[0].context.contextId, reason: "terminal-replaced" }]);
  await agents.stop();
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

  assert.deepEqual(failures, [{
    kind: "agent-admission-failed",
    providerId: provider.id,
    terminal: identity,
    failureClass: "host-failed",
    reason: "agent extension host does not exist: /private/provider-journal",
  }], "a failed admission must be visible even though the sidebar has no provider entry");
  assert.deepEqual(agents.getSnapshot().entries, {}, "the failed provider claim is released instead of leaving a phantom sidebar agent");
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true, "a failing diagnostics sink cannot prevent the terminal from retrying");
  await agents.stop();
});

test("topology polling keeps discovery armed after the fast not-bound window so a late Codex journal still binds", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = [];
  let state = "not-bound";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    reobserveDebounceMs: 0,
    topologyPollIntervalMs: 100,
    topologySignature: async () => "codex-journal-open",
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.terminalStarted(identity, 4321);
  assert.equal(registry.foregroundProcessChanged(identity, "codex"), true);
  await new Promise((resolve) => setImmediate(resolve));
  for (let attempt = 0; attempt < 16 && state === "not-bound"; attempt += 1) {
    const retry = scheduled.find((timer) => timer.milliseconds === 0);
    if (retry === undefined) break;
    scheduled.splice(scheduled.indexOf(retry), 1);
    await retry.callback();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const beforeTopology = admitted.length;
  assert.ok(beforeTopology >= 11, "the fast window must exhaust before topology takes over");
  state = "bound";
  const topology = scheduled.find((timer) => timer.milliseconds === 100);
  assert.ok(topology, "exhausted discovery must arm topology polling");
  scheduled.splice(scheduled.indexOf(topology), 1);
  await topology.callback();
  await new Promise((resolve) => setImmediate(resolve));
  const reobserve = scheduled.find((timer) => timer.milliseconds === 0);
  assert.ok(reobserve, "the first topology sample after exhaustion must reobserve even when the signature is unchanged");
  await reobserve.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(admitted.length > beforeTopology, "a journal that appears after the fast window must still be admitted");
  registry.terminalExited(identity); await agents.stop();
});

test("topology polling is inert after a proven binding, including when workers change the topology", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = []; let signature = "one";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: { agentProviderContributions: () => [provider], async admitAgentTerminal(value) { admitted.push(value); }, async cancelAgentTerminal(value) { cancelled.push(value); return true; }, async drainAgentObservers() {} },
    reobserveDebounceMs: 0,
    topologyPollIntervalMs: 100,
    topologySignature: async () => signature,
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity); registry.foregroundProcessChanged(identity, "test-agent");
  await new Promise((resolve) => setImmediate(resolve));
  // First sample establishes the baseline; its successor finds no change.
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 1); assert.equal(cancelled.length, 0);
  signature = "two";
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 1); assert.deepEqual(cancelled, []);
  registry.terminalExited(identity); await agents.stop();
});

test("a topology change does not tear down a proven writer; terminal replacement still owns retirement", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted = []; const cancelled = []; const scheduled = [];
  let signature = "writer-present";
  let state = "bound";
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: {
      agentProviderContributions: () => [provider],
      async admitAgentTerminal(value) { admitted.push(value); return { state }; },
      async cancelAgentTerminal(value) { cancelled.push(value); return true; },
      async drainAgentObservers() {},
    },
    reobserveDebounceMs: 0,
    topologyPollIntervalMs: 100,
    topologySignature: async () => signature,
    schedule(callback, milliseconds) { const timer = { callback, milliseconds }; scheduled.push(timer); return timer; },
    cancelSchedule() {},
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setImmediate(resolve));
  const binding = { providerSessionId: "writer-session", mappingVersion: "test-v1", fingerprint: { kind: "fixture", process: { id: "writer-1" }, metadata: { source: "test" } } };
  assert.equal((await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", binding, [{ kind: "session.started", title: "Local writer" }])).acceptedEventCount, 1);
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  signature = "writer-left";
  state = "not-bound";
  await scheduled.shift().callback(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelled, []);
  const continued = await agents.ingestExtensionLifecycle(identity, provider.id, "test-v1", undefined, [{ kind: "turn.started", turnId: "same-pty-turn" }]);
  assert.equal(continued.acceptedEventCount, 1);
  registry.terminalExited(identity); await agents.stop();
});

test("remote terminals admit through declared capabilities without a local fallback", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId }); activity.register(identity);
  const agents = new AgentStatusService({ activity }); await agents.start(); agents.register(identity);
  const admitted=[];
  const registry=new ExtensionAgentRuntimeRegistry({agents,projectEnvironmentRouter:{bindProject(){return {serverId:identity.serverId,projectId:identity.projectId,projectEnvironmentId:"remote-1",environmentRevision:9};}},hosts:{agentProviderContributions:()=>[provider],async admitAgentTerminal(value){admitted.push(value);},async cancelAgentTerminal(){return true;},async drainAgentObservers(){}}});
  registry.register(identity); assert.equal(registry.foregroundProcessChanged(identity,"test-agent"),true); await new Promise((resolve)=>setImmediate(resolve));
  assert.equal(admitted[0].context.projectEnvironmentId,"remote-1"); assert.deepEqual(admitted[0].observationCapabilities,provider.requiredEnvironmentCapabilities);
  assert.equal(registry.environmentBinding(admitted[0].context).environmentRevision,9);
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
    ["environment revision",(registry,id)=>registry.environmentRevisionChanged(id.projectId),"terminal-replaced",1],
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
  assert.equal(registry.observationTerminal(admitted[1].context)?.environment,"this-server");
  assert.equal(registry.foregroundProcessChanged(otherIdentity,"other-agent"),true);unblock();await retiring;
  assert.equal(registry.observationTerminal(admitted[1].context)?.environment,"this-server");await agents.stop();
});
