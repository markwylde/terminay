import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_SPACE_PROJECT_ID,
  AutomationRepository,
  AutomationTriggers,
  OrderedEventJournal,
  PROJECT_CLOSED_EVENT,
  PROJECT_OPENED_EVENT,
  RemoteConnectionManager,
  WorkspaceStore,
  createInitialWorkspace,
  createWorkspaceOperationRegistry,
  projectLifecycleEventProjector,
} from "../dist/index.js";

function memoryBackend() {
  let persisted;
  return {
    async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
    async commit(state) { persisted = structuredClone(state); },
    async backup() {},
  };
}

function source() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

const event = (id, name) => ({
  id,
  name: id,
  trigger: { kind: "event", event: name },
  action: { kind: "runCommand", command: "true" },
});

const TERMINALS = {
  "s-project": { projectId: "project-a", title: "Terminal 1", projectTitle: "A", sessionCreatedAt: 11 },
  "s-run": { projectId: AUTOMATION_SPACE_PROJECT_ID, title: "Run", projectTitle: "Automations", sessionCreatedAt: 12 },
  "s-mcp": { projectId: AUTOMATION_SPACE_PROJECT_ID, title: "Spawned agent", projectTitle: "Automations", sessionCreatedAt: 13 },
};

async function setup(automations) {
  const repository = new AutomationRepository(memoryBackend(), { now: () => 1_000 });
  await repository.load();
  for (const automation of automations) await repository.upsert(automation);
  const agents = source();
  const activity = source();
  const eventJournal = new OrderedEventJournal();
  const requests = [];
  const controller = { async start(request) { requests.push(request); return {}; }, async stop() { return false; } };
  const triggers = new AutomationTriggers({
    serverId: "server-a",
    repository,
    controller: () => controller,
    agents,
    activity,
    eventJournal,
    describeTerminal: (sessionId) => TERMINALS[sessionId],
    now: () => 5_000,
    onError: (error) => { throw error; },
  });
  await triggers.start();
  return { repository, agents, activity, eventJournal, requests, triggers };
}

function agentEntry(sessionId, state, extra = {}) {
  return {
    entryId: `entry-${sessionId}`,
    kind: "root",
    provider: "example/sessions",
    harness: "example-cli",
    agentId: `agent-${sessionId}`,
    sessionId: `provider-${sessionId}`,
    activationTerminalSessionId: sessionId,
    terminalSessionId: sessionId,
    external: false,
    projectIds: [],
    state,
    ...extra,
  };
}

const agentSnapshot = (...entries) => ({ revision: 1, entries: Object.fromEntries(entries.map((entry) => [entry.entryId, entry])) });

function activity(sessionId, patch) {
  return {
    type: "activity.changed",
    sessionId,
    snapshot: { sessionId, status: "idle", attention: false, source: "init", ...patch },
  };
}

test("an agent fires only on the transition into the named state, never on a repeated report", async () => {
  const { agents, requests } = await setup([event("needs", "agent.needsInput"), event("done", "agent.finished")]);
  agents.emit(agentSnapshot(agentEntry("s-project", "working")));
  agents.emit(agentSnapshot(agentEntry("s-project", "waiting")));
  agents.emit(agentSnapshot(agentEntry("s-project", "waiting")));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].automation.id, "needs");
  assert.equal(requests[0].event, "agent.needsInput");
  assert.equal(requests[0].startedBy, "trigger");
  assert.deepEqual(requests[0].subject, {
    kind: "terminal", serverId: "server-a", projectId: "project-a", sessionId: "s-project",
    sessionCreatedAt: 11, title: "Terminal 1", projectTitle: "A",
  });
  assert.deepEqual(requests[0].context, { agentProvider: "example-cli", agentState: "waiting" });
  agents.emit(agentSnapshot(agentEntry("s-project", "done", { completionOutcome: "error" })));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].context, { agentProvider: "example-cli", agentState: "done", agentOutcome: "error" });
});

test("the first report after start only seeds state", async () => {
  const { agents, activity: activitySource, requests } = await setup([
    event("done", "agent.finished"),
    event("attention", "terminal.needsAttention"),
  ]);
  agents.emit(agentSnapshot(agentEntry("s-project", "done")));
  activitySource.emit(activity("s-project", { attention: true }));
  assert.equal(requests.length, 0);
  // The next genuine transition fires.
  agents.emit(agentSnapshot(agentEntry("s-project", "working")));
  agents.emit(agentSnapshot(agentEntry("s-project", "done")));
  activitySource.emit(activity("s-project", { attention: false }));
  activitySource.emit(activity("s-project", { attention: true }));
  assert.deepEqual(requests.map((request) => request.event), ["agent.finished", "terminal.needsAttention"]);
});

test("command finished carries the exit code, and idle fires on working to idle", async () => {
  const { activity: activitySource, requests } = await setup([
    event("finished", "terminal.commandFinished"),
    event("idle", "terminal.idle"),
  ]);
  activitySource.emit(activity("s-project", { status: "idle" }));
  activitySource.emit(activity("s-project", { status: "working", source: "structured:command" }));
  activitySource.emit(activity("s-project", { status: "idle", source: "structured:command", exitCode: 2 }));
  activitySource.emit(activity("s-project", { status: "idle", source: "structured:command", exitCode: 2 }));
  assert.deepEqual(requests.map((request) => request.event), ["terminal.commandFinished", "terminal.idle"]);
  assert.deepEqual(requests[0].context, { exitCode: 2 });
});

test("run terminals never raise events; automation-space terminals opened through MCP do", async () => {
  const { agents, activity: activitySource, requests, triggers } = await setup([
    event("finished", "terminal.commandFinished"),
    event("needs", "agent.needsInput"),
  ]);
  triggers.markRunTerminal("s-run");
  activitySource.emit(activity("s-run", { status: "working" }));
  activitySource.emit(activity("s-run", { status: "idle", source: "structured:command", exitCode: 0 }));
  agents.emit(agentSnapshot(agentEntry("s-run", "working"), agentEntry("s-mcp", "working")));
  agents.emit(agentSnapshot(agentEntry("s-run", "waiting"), agentEntry("s-mcp", "waiting")));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].event, "agent.needsInput");
  assert.equal(requests[0].subject.sessionId, "s-mcp");
  assert.equal(requests[0].subject.projectId, AUTOMATION_SPACE_PROJECT_ID);
  // A removed terminal forgets its run-terminal mark.
  activitySource.emit({ type: "activity.removed", sessionId: "s-run" });
  assert.equal(triggers.isRunTerminal("s-run"), false);
});

test("disabled automations and other event kinds never fire", async () => {
  const { agents, repository, requests } = await setup([event("needs", "agent.needsInput"), event("blocked", "agent.blocked")]);
  await repository.setEnabled("needs", false);
  agents.emit(agentSnapshot(agentEntry("s-project", "working")));
  agents.emit(agentSnapshot(agentEntry("s-project", "waiting")));
  assert.equal(requests.length, 0);
});

test("project and device events fan out with their subjects", async () => {
  const { eventJournal, requests, triggers } = await setup([
    event("opened", "project.opened"),
    event("closed", "project.closed"),
    event("device", "device.connected"),
  ]);
  eventJournal.append(PROJECT_OPENED_EVENT, { serverId: "server-a", projectId: "project-b", name: "B", revision: 3 });
  eventJournal.append(PROJECT_CLOSED_EVENT, { serverId: "server-a", projectId: "project-b", name: "B", revision: 4 });
  triggers.deviceConnected({ connectionId: "peer-1", deviceId: "device-1", deviceName: "Mark's phone" });
  assert.deepEqual(requests.map((request) => [request.automation.id, request.subject]), [
    ["opened", { kind: "project", projectId: "project-b", title: "B" }],
    ["closed", { kind: "project", projectId: "project-b", title: "B" }],
    ["device", { kind: "device", deviceId: "device-1", name: "Mark's phone" }],
  ]);
});

// --- 6.3: typed project lifecycle events and the admission hook ---

function lifecycleEvents(journal) {
  const seen = [];
  journal.subscribe((entry) => {
    if (entry.event === PROJECT_OPENED_EVENT || entry.event === PROJECT_CLOSED_EVENT) seen.push([entry.event, entry.payload.projectId]);
  });
  return seen;
}

test("project.create and project.close each emit exactly one typed journal event", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const eventJournal = new OrderedEventJournal();
  const seen = lifecycleEvents(eventJournal);
  const registry = createWorkspaceOperationRegistry(store, { eventJournal });
  const viewId = store.state.viewOrder[0];
  const create = { type: "project.create", projectId: "project-b", viewId, root: "/tmp/b", name: "B" };
  assert.equal(registry.applyHostCommand("create-b", create).ok, true);
  // An idempotent replay of the same command reports nothing new.
  registry.applyHostCommand("create-b", create);
  const context = { authScope: "write", clientId: "c", connectionId: "k", signal: new AbortController().signal };
  await registry.operations.commands["workspace.command"]({
    body: new Uint8Array(),
    context,
    envelope: { commandId: "close-b", operation: "workspace.command", payload: { command: { type: "project.close", projectId: "project-b" } } },
  });
  // Neither the automation space nor an unrelated command is reported.
  registry.ensureAutomationSpace("/home/server");
  registry.applyHostCommand("rename", { type: "view.rename", viewId, name: "Main" });
  assert.deepEqual(seen, [[PROJECT_OPENED_EVENT, "project-b"], [PROJECT_CLOSED_EVENT, "project-b"]]);
});

test("a project-claimed client only sees its own project's lifecycle events", () => {
  const opened = { revision: 1, cursor: "1", event: PROJECT_OPENED_EVENT, payload: { projectId: "project-b" } };
  assert.equal(projectLifecycleEventProjector(opened, undefined), opened);
  assert.equal(projectLifecycleEventProjector(opened, { claims: { projectId: "project-b" } }), opened);
  assert.equal(projectLifecycleEventProjector(opened, { claims: { projectId: "project-a" } }), undefined);
});

test("the remote transport reports each admitted connection exactly once", () => {
  const admitted = [];
  const manager = new RemoteConnectionManager({
    serverId: "srv",
    sessionOrigin: "https://session.example.test",
    now: () => 100,
    onConnectionAdmitted: (admission) => admitted.push(admission),
  });
  manager.expose(200);
  const proof = { ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", deviceName: "Phone", expiresAt: 150, authenticated: true };
  const peer = manager.admit(proof);
  assert.throws(() => manager.admit(proof), /already been used/);
  assert.throws(() => manager.admit({ ...proof, ticketId: "ticket-2", authenticated: false }), /authenticated/);
  assert.deepEqual(admitted, [{ connectionId: peer.peerId, deviceId: "device-1", deviceName: "Phone" }]);
});
