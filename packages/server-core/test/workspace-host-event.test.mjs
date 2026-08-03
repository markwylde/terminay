import test from "node:test";
import assert from "node:assert/strict";
import { OrderedEventJournal, WorkspaceStore, createInitialWorkspace, createWorkspaceOperationRegistry, WORKSPACE_EVENT, WORKSPACE_OPERATIONS } from "../dist/index.js";

test("host terminal panel creation applies one workspace revision and publishes its exact invalidation event", () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const journal = new OrderedEventJournal();
  const registry = createWorkspaceOperationRegistry(workspace, { eventJournal: journal });
  const viewId = workspace.state.viewOrder[0];
  assert.equal(registry.applyHostCommand("project-a", { type: "project.create", projectId: "project-a", viewId, root: "/project-a", name: "Project A" }).ok, true);
  const applied = registry.applyHostCommand("terminal-a", { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", title: "Terminal 1", cwd: "/project-a", createdAt: 1 }, workspace.state.revision);
  assert.equal(applied.ok, true);
  assert.equal(workspace.state.terminalSessions["session-a"].projectId, "project-a");
  assert.equal(workspace.state.panels["panel-a"].sessionId, "session-a");
  assert.deepEqual(workspace.state.projects["project-a"].panelIds, ["panel-a"]);
  assert.deepEqual(journal.replay(0).events.at(-1), {
    revision: 2,
    cursor: "2",
    event: WORKSPACE_EVENT,
    payload: { serverId: "server-a", revision: 2, cursor: "2", projectId: "project-a" },
  });
});

test("workspace mutations publish workspace.changed coverage for project and panel operations", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const journal = new OrderedEventJournal();
  const registry = createWorkspaceOperationRegistry(workspace, {
    eventJournal: journal,
    prepareProjectRootUpdate: async (_projectId, root) => ({
      canonicalRoot: `${root}/canonical`,
      commit: () => undefined,
    }),
  });
  const viewId = workspace.state.viewOrder[0];
  const seen = [];
  const expectEvent = async (operation, apply) => {
    const before = journal.revision;
    const result = await apply();
    assert.equal(result.ok ?? true, true, operation);
    const event = journal.replay(before).events.at(-1);
    assert.equal(event.event, WORKSPACE_EVENT, operation);
    assert.equal(event.payload.revision, workspace.state.revision, operation);
    assert.equal(event.payload.cursor, workspace.state.cursor, operation);
    seen.push(operation);
  };

  await expectEvent("project.create", () => registry.applyHostCommand("cmd-project-a", { type: "project.create", projectId: "project-a", viewId, root: "/project-a", name: "Project A" }));
  await expectEvent("project.root.update", () => registry.operations.commands[WORKSPACE_OPERATIONS.projectRootUpdate]({
    body: new Uint8Array(),
    context: { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal },
    envelope: {
      commandId: "cmd-root-a",
      operation: WORKSPACE_OPERATIONS.projectRootUpdate,
      payload: { projectId: "project-a", root: "/next-root" },
    },
  }));
  await expectEvent("terminal.create", () => registry.applyHostCommand("cmd-terminal-a", { type: "terminal.create", projectId: "project-a", sessionId: "session-a", createdAt: 1 }));
  await expectEvent("panel.create", () => registry.applyHostCommand("cmd-panel-a", { type: "panel.create", panel: { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "session-a", title: "Terminal A", createdAt: 1 } }));
  await expectEvent("panel.activate", () => registry.applyHostCommand("cmd-panel-activate", { type: "panel.activate", projectId: "project-a", panelId: "panel-a" }));

  await expectEvent("project.create target", () => registry.applyHostCommand("cmd-project-b", { type: "project.create", projectId: "project-b", viewId, root: "/project-b", name: "Project B" }));
  await expectEvent("project.activate", () => registry.applyHostCommand("cmd-project-activate", { type: "project.activate", projectId: "project-a" }));
  assert.equal(workspace.state.views[viewId].activeProjectId, "project-a");
  await expectEvent("panel.move", () => registry.applyHostCommand("cmd-panel-move", { type: "panel.move", panelId: "panel-a", targetProjectId: "project-b" }));
  await expectEvent("panel.update", () => registry.applyHostCommand("cmd-panel-update", { type: "panel.update", panelId: "panel-a", patch: { title: "Renamed terminal", emoji: "⚡", color: "#123456", inheritsProjectColor: false, activityIndicatorsEnabled: false } }));
  assert.deepEqual(
    (({ title, emoji, color, inheritsProjectColor, activityIndicatorsEnabled }) => ({ title, emoji, color, inheritsProjectColor, activityIndicatorsEnabled }))(workspace.state.panels["panel-a"]),
    { title: "Renamed terminal", emoji: "⚡", color: "#123456", inheritsProjectColor: false, activityIndicatorsEnabled: false },
  );
  await expectEvent("panel.close", () => registry.applyHostCommand("cmd-panel-close", { type: "panel.close", panelId: "panel-a" }));
  await expectEvent("terminal.createPanel", () => registry.applyHostCommand("cmd-terminal-panel-b", { type: "terminal.createPanel", projectId: "project-b", sessionId: "session-b", panelId: "panel-b", title: "Terminal B", createdAt: 2 }));

  assert.deepEqual(seen, [
    "project.create",
    "project.root.update",
    "terminal.create",
    "panel.create",
    "panel.activate",
    "project.create target",
    "project.activate",
    "panel.move",
    "panel.update",
    "panel.close",
    "terminal.createPanel",
  ]);
});
