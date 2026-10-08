import assert from "node:assert/strict";
import test from "node:test";
import { OrderedEventJournal, WorkspaceStore, createInitialWorkspace, createWorkspaceOperationRegistry, WORKSPACE_EVENT, WORKSPACE_OPERATIONS } from "../dist/index.js";

/** Two projects, a terminal panel and a file panel in the first. */
function fixture() {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const journal = new OrderedEventJournal();
  const order = [];
  journal.subscribe((event) => {
    if (event.event === WORKSPACE_EVENT) order.push(`published:${event.payload.revision}`);
  });
  const rehomed = [];
  const registry = createWorkspaceOperationRegistry(workspace, {
    eventJournal: journal,
    rehomeTerminalSession: (move) => {
      // The commit is already visible to the server when the terminal follows.
      order.push(`rehomed:${workspace.state.revision}:${workspace.state.terminalSessions[move.sessionId].projectId}`);
      rehomed.push(move);
    },
  });
  const viewId = workspace.state.viewOrder[0];
  for (const projectId of ["project-a", "project-b"])
    assert.equal(registry.applyHostCommand(projectId, { type: "project.create", projectId, viewId, root: `/${projectId}`, name: projectId }).ok, true);
  assert.equal(registry.applyHostCommand("terminal-a", { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", title: "Terminal 1", cwd: "/project-a", createdAt: 1 }).ok, true);
  assert.equal(registry.applyHostCommand("file-a", { type: "panel.create", panel: { id: "panel-file", projectId: "project-a", type: "file", path: "README.md", createdAt: 2 } }).ok, true);
  order.length = 0;
  return { workspace, registry, rehomed, order };
}

function clientCommand(registry, commandId, command, expectedRevision) {
  return registry.operations.commands[WORKSPACE_OPERATIONS.command]({
    body: new Uint8Array(),
    context: { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal },
    envelope: { commandId, operation: WORKSPACE_OPERATIONS.command, payload: { command }, ...(expectedRevision === undefined ? {} : { expectedRevision }) },
  });
}

const MOVE = { type: "panel.move", panelId: "panel-a", targetProjectId: "project-b" };
const REHOME = { sessionId: "session-a", sourceProjectId: "project-a", targetProjectId: "project-b" };

test("a terminal panel move names the moved session among its changed ids", () => {
  const { workspace } = fixture();
  const events = [];
  workspace.subscribe((event) => events.push(event));
  assert.equal(workspace.apply({ commandId: "move", command: MOVE }).ok, true);
  const folders = ["project-a", "project-b"].map((id) => workspace.state.projects[id].folderIds[0]);
  assert.deepEqual([...events.at(-1).changedIds].sort(), [...folders, "panel-a", "project-a", "project-b", "session-a"].sort());
});

test("a client panel move re-homes the terminal after the commit and before the revision is published", async () => {
  const { workspace, registry, rehomed, order } = fixture();
  await clientCommand(registry, "move", MOVE);
  const revision = workspace.state.revision;
  assert.deepEqual(rehomed, [REHOME]);
  assert.deepEqual(order, [`rehomed:${revision}:project-b`, `published:${revision}`]);
});

test("a host panel move re-homes the terminal after the commit and before the revision is published", () => {
  const { workspace, registry, rehomed, order } = fixture();
  assert.equal(registry.applyHostCommand("move", MOVE).ok, true);
  const revision = workspace.state.revision;
  assert.deepEqual(rehomed, [REHOME]);
  assert.deepEqual(order, [`rehomed:${revision}:project-b`, `published:${revision}`]);
});

test("a move that cannot be committed re-homes nothing", async () => {
  const { workspace, registry, rehomed } = fixture();
  await assert.rejects(clientCommand(registry, "stale-move", MOVE, workspace.state.revision - 1));
  assert.equal(registry.applyHostCommand("stale-host-move", MOVE, workspace.state.revision - 1).ok, false);
  await assert.rejects(clientCommand(registry, "missing-target", { ...MOVE, targetProjectId: "project-missing" }));
  assert.deepEqual(rehomed, []);
  assert.equal(workspace.state.panels["panel-a"].projectId, "project-a");
  assert.equal(workspace.state.terminalSessions["session-a"].projectId, "project-a");
});

test("moving a file panel, or a terminal within its own project, re-homes nothing", async () => {
  const { registry, rehomed } = fixture();
  await clientCommand(registry, "move-file", { type: "panel.move", panelId: "panel-file", targetProjectId: "project-b" });
  await clientCommand(registry, "move-in-place", { type: "panel.move", panelId: "panel-a", targetProjectId: "project-a", index: 0 });
  assert.deepEqual(rehomed, []);
});
