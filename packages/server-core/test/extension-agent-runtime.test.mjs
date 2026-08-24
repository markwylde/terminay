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

function inertJournal() {
  return { async start() {}, async stop() {}, setEnabled() {}, registerTerminal() {}, terminalStarted() {}, foregroundProcessChanged() {}, unregisterTerminal() {} };
}

test("extension provider claims one terminal incarnation before host admission and blocks legacy journal publication", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, journalSource: inertJournal() });
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
  assert.equal(await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "legacy", cli_version: "0.2.0" } }), false);

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

test("non-matching or remote-routed terminals do not suppress legacy providers", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, journalSource: inertJournal() });
  await agents.start(); agents.register(identity);
  const registry = new ExtensionAgentRuntimeRegistry({
    agents,
    hosts: { agentProviderContributions: () => [provider], async admitAgentTerminal() {}, async cancelAgentTerminal() { return false; }, async drainAgentObservers() {} },
  });
  registry.register(identity);
  assert.equal(registry.foregroundProcessChanged(identity, "other-agent"), false);
  assert.equal(await agents.ingestJournalRecord(identity, "codex", { type: "session_meta", payload: { id: "legacy", cli_version: "0.2.0" } }), true);
  await agents.stop();
});
