import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_OPERATIONS, AgentStatusService, OrderedEventJournal, TerminalActivityService, createAgentEventProjector, createAgentOperationRegistry } from "../dist/index.js";

const context = Object.freeze({ connectionId: "connection-a", clientId: "client-a", authScope: "admin", signal: new AbortController().signal });
const query = (operation, payload = {}) => ({ envelope: { operation, payload }, body: new Uint8Array(), context });
const command = (operation, payload, claims) => ({ envelope: { operation, commandId: "command-a", correlationId: "correlation-a", payload }, body: new Uint8Array(), context: claims === undefined ? context : { ...context, claims } });
const providerId = "example.agent/test";
/** A bound, waiting root as the session-source bridge would reduce it. */
async function publish(agents, identity, title = "Provider session") {
  return agents.applyEntries([{
    entryId: `entry-${identity.sessionId}`,
    kind: "root",
    provider: providerId,
    harness: "fixture",
    agentId: `agent-${identity.sessionId}`,
    sessionId: `agent-${identity.sessionId}`,
    activationTerminalSessionId: identity.sessionId,
    external: false,
    projectIds: [identity.projectId],
    displayName: title,
    state: "waiting",
    waitingReason: "approval",
    stateStartedAt: 100,
    createdAt: 100,
    updatedAt: 100,
    active: true,
    activeTools: [],
    unread: true,
    terminalSessionId: identity.sessionId,
    inProcess: false,
    openSubagents: 0,
  }]);
}

test("agent protocol exposes only reduced extension lifecycle state and acknowledgement", async () => {
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
  const activity = new TerminalActivityService({ serverId: identity.serverId, now: () => 100 }); activity.register(identity);
  const agents = new AgentStatusService({ activity, now: () => 100 });
  const journal = new OrderedEventJournal(); await agents.start(); agents.register(identity);
  const registry = createAgentOperationRegistry({ service: agents, eventJournal: journal });
  try {
    await publish(agents, identity);
    const snapshot = registry.operations.queries[AGENT_OPERATIONS.snapshot](query(AGENT_OPERATIONS.snapshot));
    const entry = Object.values(snapshot.entries)[0];
    assert.equal(typeof snapshot.processInstanceId, "string");
    assert.ok(snapshot.processInstanceId.length > 0);
    assert.equal(entry.activationTerminalSessionId, identity.sessionId);
    assert.doesNotMatch(JSON.stringify(snapshot), /fingerprint|transcript/u);
    assert.equal(journal.replay(0).events.at(-1).event, AGENT_OPERATIONS.event);
    const acknowledged = registry.operations.commands[AGENT_OPERATIONS.acknowledge](command(AGENT_OPERATIONS.acknowledge, { projectId: identity.projectId, sessionId: identity.sessionId, entryId: entry.entryId }));
    assert.equal(acknowledged.acknowledged, true);
  } finally { registry.close(); await agents.stop(); }
});

test("project claims scope snapshots and journal projection", async () => {
  const activity = new TerminalActivityService({ serverId: "scope-server", now: () => 100 });
  // An external session of project A, bound to no terminal.
  const agents = new AgentStatusService({ activity }); const journal = new OrderedEventJournal(); await agents.start();
  const projectA = { serverId: "scope-server", projectId: "project-a", sessionId: "session-a" };
  const projectB = { serverId: "scope-server", projectId: "project-b", sessionId: "session-b" };
  activity.register(projectA); activity.register(projectB); agents.register(projectA); agents.register(projectB);
  const registry = createAgentOperationRegistry({ service: agents, eventJournal: journal });
  try {
    await publish(agents, projectA, "Project A");
    await publish(agents, projectB, "Project B");
    agents.applyEntries([{ ...agents.getSnapshot().entries["entry-session-a"], entryId: "external-a", sessionId: "external-a", agentId: "external-a", activationTerminalSessionId: null, terminalSessionId: null, external: true, unread: false }]);
    const scopedContext = { ...context, claims: { projectId: "project-a" } };
    const scoped = registry.operations.queries[AGENT_OPERATIONS.snapshot]({ envelope: { operation: AGENT_OPERATIONS.snapshot, payload: {} }, body: new Uint8Array(), context: scopedContext });
    assert.deepEqual(Object.values(scoped.entries).map((entry) => entry.activationTerminalSessionId).sort(), [null, "session-a"].sort());
    const projected = createAgentEventProjector(agents)(journal.replay(0).events.at(-1), { clientId: "a", authScope: "read", claims: { projectId: "project-a" } });
    assert.deepEqual(Object.values(projected.payload.entries).map((entry) => entry.agentId).sort(), ["agent-session-a", "external-a"]);
  } finally { registry.close(); await agents.stop(); }
});
