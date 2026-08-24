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

  // A second matching topology signal cancels the old observer before a new
  // incarnation is admitted; no two child observers own this terminal.
  assert.equal(registry.foregroundProcessChanged(identity, "test-agent"), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(admitted.map(({ context }) => context.contextId), ["context-1", "context-2"]);
  assert.deepEqual(cancelled, [{ contextId: "context-1", reason: "terminal-replaced" }]);

  registry.terminalExited(identity);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelled, [
    { contextId: "context-1", reason: "terminal-replaced" },
    { contextId: "context-2", reason: "terminal-closed" },
  ]);
  await agents.stop();
});

test("non-matching terminals do not create an extension-owned sidebar run", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start(); agents.register(identity);
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: { agentProviderContributions: () => [provider], async admitAgentTerminal() {}, async cancelAgentTerminal() { return false; }, async drainAgentObservers() {} },
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "other-agent"), false);
  assert.equal(await agents.ingestJournalRecord(identity, "untrusted-provider", { type: "untrusted-record" }), false);
  await agents.stop();
});

test("topology polling is inert for an unchanged signature and rebinds exactly once when it changes", async () => {
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
  const reobserve = scheduled.find((timer) => timer.milliseconds === 0);
  await reobserve.callback(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted.length, 2); assert.deepEqual(cancelled, [{ contextId: admitted[0].context.contextId, reason: "terminal-replaced" }]);
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
