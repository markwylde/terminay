import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  AUTOMATION_SPACE_PROJECT_ID,
  AUTOMATIONS_FEATURE_CAPABILITY,
  WorkspaceStore,
  createAutomationSpaceEventProjector,
  createAutomationSpaceVisibility,
  createInitialWorkspace,
  createServerCoreComposition,
  withholdAutomationSpaceOperations,
} from "../dist/index.js";

const SPACE = AUTOMATION_SPACE_PROJECT_ID;
const notFound = (error) => /not found/.test(error.message);

function createPtyFactory() {
  let next = 0;
  return {
    spawn() {
      next += 1;
      return {
        pid: 40_000 + next,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit() { return () => {}; },
      };
    },
  };
}

async function connect(composition, clientId, capabilities) {
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId, capabilities });
  await pair.open();
  await client.connect();
  return { client, serverTask };
}

function workspaceWithSpace() {
  const workspace = new WorkspaceStore(createInitialWorkspace("visibility-server"));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "p", command: { type: "project.create", projectId: "project-a", viewId, root: "/repo/a", name: "A" } }).ok, true);
  workspace.ensureAutomationSpace({ root: "/home/server" });
  return workspace;
}

test("terminal.list, attach, and events withhold automation-space sessions from connections without automations.v1", async () => {
  const workspace = workspaceWithSpace();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "visibility-server",
    serverVersion: "test",
    capabilities: ["workspace", "terminal"],
    ptyFactory: createPtyFactory(),
    workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const capable = await connect(composition, "capable", ["workspace.v1", AUTOMATIONS_FEATURE_CAPABILITY]);
  const legacy = await connect(composition, "legacy", ["workspace.v1"]);
  const legacyEvents = [];
  const subscription = await legacy.client.subscribe("workspace.changed");
  subscription.onEvent((event) => legacyEvents.push(event.payload));
  try {
    const created = await capable.client.command("terminal.create", { projectId: SPACE, cwd: "/home/server", cols: 80, rows: 24 }, { commandId: "auto-term" });
    const sessionId = created.result.sessionId;
    await legacy.client.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "user-term" });

    const visible = await capable.client.query("terminal.list", { projectId: SPACE });
    assert.deepEqual(visible.result.sessions.map((session) => session.sessionId), [sessionId]);

    await assert.rejects(legacy.client.query("terminal.list", { projectId: SPACE }), notFound);
    await assert.rejects(
      legacy.client.command("terminal.attach", { identity: { serverId: "visibility-server", projectId: SPACE, sessionId }, clientId: "legacy", fromPosition: 0 }, { commandId: "legacy-attach" }),
      /not found/,
    );
    await assert.rejects(
      legacy.client.command("terminal.create", { projectId: SPACE, cols: 80, rows: 24 }, { commandId: "legacy-create" }),
      /not found/,
    );
    const userList = await legacy.client.query("terminal.list", { projectId: "project-a" });
    assert.equal(userList.result.sessions.length, 1);

    // workspace.changed hints never name the automation space for a legacy client.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(legacyEvents.length > 0);
    assert.equal(legacyEvents.some((payload) => payload.projectId === SPACE), false);
  } finally {
    await subscription.unsubscribe().catch(() => undefined);
    await Promise.all([capable.client.close().catch(() => undefined), legacy.client.close().catch(() => undefined)]);
    await Promise.all([capable.serverTask.catch(() => undefined), legacy.serverTask.catch(() => undefined)]);
    await composition.shutdown();
  }
});

test("activity and agent snapshots, deltas, events, and targeted commands withhold automation-space sessions", async () => {
  const workspace = workspaceWithSpace();
  const live = [
    { projectId: SPACE, sessionId: "auto-1" },
    { projectId: "project-a", sessionId: "user-1" },
  ];
  const visibility = createAutomationSpaceVisibility(workspace, () => live);
  const activitySession = (projectId, sessionId) => ({ projectId, sessionId, serverId: "visibility-server" });
  const agentEntry = (overrides) => ({ kind: "root", agentId: "a", sessionId: "agent", activationTerminalSessionId: null, terminalSessionId: null, projectIds: [], ...overrides });
  const operations = withholdAutomationSpaceOperations({
    queries: new Map([
      ["activity.snapshot", () => ({ revision: 3, cursor: "3", sessions: { "auto-1": activitySession(SPACE, "auto-1"), "user-1": activitySession("project-a", "user-1") } })],
      ["activity.delta", () => ({ kind: "events", events: [
        { type: "activity.changed", sessionId: "auto-1", snapshot: activitySession(SPACE, "auto-1") },
        { type: "activity.removed", sessionId: "auto-1" },
        { type: "activity.changed", sessionId: "user-1", snapshot: activitySession("project-a", "user-1") },
      ] })],
      ["agent.snapshot", () => ({ revision: 1, cursor: "1", entries: {
        inAuto: agentEntry({ activationTerminalSessionId: "auto-1", terminalSessionId: "auto-1", projectIds: [SPACE, "project-a"] }),
        onlyAuto: agentEntry({ projectIds: [SPACE] }),
        both: agentEntry({ projectIds: [SPACE, "project-a"] }),
        user: agentEntry({ activationTerminalSessionId: "user-1", terminalSessionId: "user-1", projectIds: ["project-a"] }),
      } })],
      ["activity.closePreflight", () => ({ sessions: [] })],
      ["other.query", () => ({ untouched: SPACE })],
    ]),
    commands: new Map([["agent.acknowledge", () => ({ acknowledged: true })]]),
    policies: new Map(),
  }, visibility);
  const request = (operation, capabilities, payload = {}) => ({
    body: new Uint8Array(),
    envelope: { operation, payload },
    context: { authScope: "write", clientId: "c", connectionId: "k", signal: new AbortController().signal, clientCapabilities: capabilities },
  });
  const query = (operation, capabilities, payload) => operations.queries.get(operation)(request(operation, capabilities, payload));

  const legacy = ["workspace.v1"];
  assert.deepEqual(Object.keys((await query("activity.snapshot", legacy)).sessions), ["user-1"]);
  assert.deepEqual((await query("activity.delta", legacy)).events.map((event) => event.sessionId), ["user-1"]);
  const agents = (await query("agent.snapshot", legacy)).entries;
  assert.deepEqual(Object.keys(agents).sort(), ["both", "user"]);
  assert.deepEqual(agents.both.projectIds, ["project-a"]);
  await assert.rejects(query("activity.closePreflight", legacy, { projectId: SPACE }), notFound);
  await assert.rejects(query("activity.closePreflight", legacy, { projectId: "project-a", sessionId: "auto-1" }), notFound);
  assert.throws(() => operations.commands.get("agent.acknowledge")(request("agent.acknowledge", legacy, { projectId: SPACE, sessionId: "auto-1" })), notFound);
  assert.deepEqual(await query("other.query", legacy), { untouched: SPACE });

  const capable = [AUTOMATIONS_FEATURE_CAPABILITY];
  assert.deepEqual(Object.keys((await query("activity.snapshot", capable)).sessions).sort(), ["auto-1", "user-1"]);
  assert.equal(Object.keys((await query("agent.snapshot", capable)).entries).length, 4);
  assert.deepEqual(await query("activity.closePreflight", capable, { projectId: SPACE }), { sessions: [] });

  // Journal events, projected per connection before delivery.
  const project = createAutomationSpaceEventProjector(visibility);
  const event = (name, payload) => ({ revision: 1, cursor: "1", event: name, payload });
  const legacyConnection = { clientCapabilities: legacy };
  assert.equal(project(event("activity", { sessionId: "auto-1", snapshot: activitySession(SPACE, "auto-1") }), undefined, legacyConnection), undefined);
  assert.equal(project(event("activity", { type: "activity.removed", sessionId: "auto-1" }), undefined, legacyConnection), undefined);
  assert.ok(project(event("activity", { sessionId: "user-1" }), undefined, legacyConnection));
  assert.equal(project(event("terminal", { projectId: SPACE, sessionId: "auto-1" }), undefined, legacyConnection), undefined);
  assert.equal(project(event("workspace.changed", { revision: 1, projectId: SPACE }), undefined, legacyConnection).payload.projectId, null);
  const agentEvent = project(event("agent", { revision: 1, cursor: "1", entries: { a: agentEntry({ projectIds: [SPACE] }), b: agentEntry({ projectIds: ["project-a"] }) } }), undefined, legacyConnection);
  assert.deepEqual(Object.keys(agentEvent.payload.entries), ["b"]);
  const capableEvent = event("activity", { sessionId: "auto-1" });
  assert.equal(project(capableEvent, undefined, { clientCapabilities: capable }), capableEvent);
});
