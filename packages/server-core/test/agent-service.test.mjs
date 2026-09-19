import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService } from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });

const entry = (overrides = {}) => ({
  entryId: "e1",
  kind: "root",
  provider: "com.example/agents",
  harness: "claude-code",
  agentId: "s1",
  sessionId: "s1",
  activationTerminalSessionId: identity.sessionId,
  external: false,
  projectIds: [identity.projectId],
  state: "working",
  stateStartedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  active: true,
  activeTools: [],
  unread: false,
  terminalSessionId: identity.sessionId,
  inProcess: false,
  openSubagents: 0,
  ...overrides,
});

async function fixture(options = {}) {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, now: () => 1_000, ...options });
  await agents.start();
  agents.register(identity);
  return { activity, agents };
}

test("terminal lifecycle edges reach observers with the PTY shell pid", async () => {
  const { agents } = await fixture();
  const edges = [];
  agents.observeTerminals((edge) => edges.push({ kind: edge.kind, shellPid: edge.terminal.shellPid, shellForeground: edge.shellForeground }));
  agents.terminalStarted(identity, 4242);
  agents.foregroundProcessChanged(identity, "claude", false);
  agents.foregroundProcessChanged({ ...identity, projectId: "other" }, "claude", true);
  agents.terminalExited(identity);
  assert.deepEqual(edges, [
    { kind: "started", shellPid: 4242, shellForeground: undefined },
    { kind: "foreground", shellPid: 4242, shellForeground: false },
    { kind: "exited", shellPid: 4242, shellForeground: undefined },
  ]);
  assert.equal(agents.terminal(identity.sessionId), undefined);
  await agents.stop();
});

test("a bound root drives terminal activity; unbinding returns the terminal to idle", async () => {
  const { activity, agents } = await fixture();
  agents.applyEntries([entry()]);
  assert.equal(activity.snapshot().sessions[identity.sessionId].providerState, "working");
  agents.applyEntries([entry({ activationTerminalSessionId: null, terminalSessionId: null, external: true })]);
  assert.equal(activity.snapshot().sessions[identity.sessionId].providerState, "idle");
  await agents.stop();
});

test("acknowledgement is scoped to the entry's own terminal", async () => {
  const { agents } = await fixture();
  agents.applyEntries([entry({ state: "done", unread: true })]);
  assert.equal(agents.acknowledge({ ...identity }, "e1"), true);
  assert.equal(agents.getSnapshot().entries.e1.unread, false);
  assert.throws(() => agents.acknowledge({ ...identity, projectId: "other" }, "e1"), /not active/);
  await agents.stop();
});

test("project snapshots include only entries stamped with that project", async () => {
  const { agents } = await fixture();
  agents.applyEntries([
    entry(),
    entry({ entryId: "e2", sessionId: "s2", agentId: "s2", external: true, activationTerminalSessionId: null, terminalSessionId: null, projectIds: ["project-2"] }),
  ]);
  assert.deepEqual(Object.keys(agents.getSnapshotForProject("project-1").entries), ["e1"]);
  assert.deepEqual(Object.keys(agents.getSnapshotForProject("project-2").entries), ["e2"]);
  assert.equal(Object.keys(agents.getSnapshotForProject(undefined).entries).length, 2);
  await agents.stop();
});

test("disabling agent status clears entries, notifies observers, and refuses writes", async () => {
  const { agents } = await fixture();
  const observed = [];
  agents.observeIntegrationEnabled((enabled) => observed.push(enabled));
  agents.applyEntries([entry()]);
  assert.equal(agents.setIntegrationEnabled(false), true);
  assert.deepEqual(agents.getSnapshot().entries, {});
  assert.equal(agents.applyEntries([entry()]), false);
  assert.equal(agents.setIntegrationEnabled(true), true);
  assert.deepEqual(observed, [false, true]);
  assert.deepEqual(agents.getSnapshot().entries, {});
  await agents.stop();
});

test("agent snapshots are stamped with the constructing process instance id", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const first = new AgentStatusService({ activity, now: () => 1_000, processInstanceId: "process-a" });
  const second = new AgentStatusService({ activity, now: () => 1_000, processInstanceId: "process-b" });
  await first.start(); await second.start();
  first.register(identity); second.register(identity);
  assert.equal(first.getSnapshot().processInstanceId, "process-a");
  assert.equal(second.getSnapshot().processInstanceId, "process-b");
  assert.notEqual(new AgentStatusService({ activity }).processId, first.processId);
  await first.stop(); await second.stop();
});
