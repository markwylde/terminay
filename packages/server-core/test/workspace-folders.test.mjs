import assert from "node:assert/strict";
import test from "node:test";
import { OrderedEventJournal, WorkspaceStore, createInitialWorkspace, createWorkspaceOperationRegistry, migrateWorkspaceState, validateWorkspace, WORKSPACE_OPERATIONS, WORKSPACE_SCHEMA_VERSION } from "../dist/index.js";

const LINK = { repositoryId: "repo-1", path: "/project-a/.worktrees/feature" };

/** Two projects. The first holds two terminals and a file panel in General. */
function fixture() {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const rehomed = [];
  const registry = createWorkspaceOperationRegistry(workspace, {
    eventJournal: new OrderedEventJournal(),
    rehomeTerminalSession: (move) => rehomed.push(move),
  });
  const viewId = workspace.state.viewOrder[0];
  for (const projectId of ["project-a", "project-b"]) host(registry, { type: "project.create", projectId, viewId, root: `/${projectId}`, name: projectId });
  host(registry, { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", title: "one", createdAt: 1 });
  host(registry, { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-b", panelId: "panel-b", title: "two", createdAt: 2 });
  host(registry, { type: "panel.create", panel: { id: "panel-file", projectId: "project-a", type: "file", path: "README.md", createdAt: 3 } });
  return { workspace, registry, rehomed };
}

let serial = 0;
function host(registry, command) {
  const applied = registry.applyHostCommand(`host-${++serial}`, command);
  assert.equal(applied.ok, true, applied.ok ? "" : applied.conflict.message);
  return applied;
}
function refused(registry, command, pattern) {
  const before = registry.workspace.state.revision;
  const applied = registry.applyHostCommand(`host-${++serial}`, command);
  assert.equal(applied.ok, false);
  assert.match(applied.conflict.message, pattern);
  assert.equal(registry.workspace.state.revision, before);
}
async function client(registry, command, claims) {
  return registry.operations.commands[WORKSPACE_OPERATIONS.command]({
    body: new Uint8Array(),
    context: { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, ...(claims === undefined ? {} : { claims }) },
    envelope: { commandId: `client-${++serial}`, operation: WORKSPACE_OPERATIONS.command, payload: { command } },
  });
}
/** Protocol refusals are plain objects with a message, not Error instances. */
async function rejectsWith(promise, pattern) {
  await assert.rejects(promise, (error) => pattern.test(error.message));
}
const general = (workspace, projectId) => workspace.state.projects[projectId].folderIds[0];
/** The id of the folder a `folder.create` just made. */
function created(workspace, applied) {
  return applied.event.changedIds.find((id) => workspace.state.folders[id] !== undefined);
}

test("a new project has one General folder and new panels land in it", () => {
  const { workspace } = fixture();
  const project = workspace.state.projects["project-a"];
  assert.equal(project.folderIds.length, 1);
  const folder = workspace.state.folders[project.folderIds[0]];
  assert.equal(folder.kind, "general");
  assert.equal(folder.name, "General");
  assert.deepEqual(folder.panelIds, ["panel-a", "panel-b", "panel-file"]);
  for (const panelId of folder.panelIds) assert.equal(workspace.state.panels[panelId].folderId, folder.id);
  // The project's own panel list is derived from its folders.
  assert.deepEqual(project.panelIds, folder.panelIds);
  assert.equal(workspace.state.projects["project-b"].folderIds.length, 1);
  assert.notEqual(general(workspace, "project-b"), folder.id);
});

test("General cannot be renamed, reordered away from first, or deleted", () => {
  const { workspace, registry } = fixture();
  const generalId = general(workspace, "project-a");
  const plain = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Servers" }));
  refused(registry, { type: "folder.rename", folderId: generalId, name: "Main" }, /General folder cannot be renamed/);
  refused(registry, { type: "folder.delete", folderId: generalId }, /General folder cannot be deleted/);
  refused(registry, { type: "folder.reorder", projectId: "project-a", folderIds: [plain, generalId] }, /General folder stays first/);
});

test("a plain folder can be created, renamed, reordered, and deleted once empty", () => {
  const { workspace, registry } = fixture();
  const servers = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Servers" }));
  const notes = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Notes" }));
  assert.notEqual(servers, notes);
  assert.equal(workspace.state.folders[servers].kind, "plain");
  assert.deepEqual(workspace.state.projects["project-a"].folderIds, [general(workspace, "project-a"), servers, notes]);
  host(registry, { type: "folder.rename", folderId: servers, name: "Dev servers" });
  assert.equal(workspace.state.folders[servers].name, "Dev servers");
  host(registry, { type: "folder.reorder", projectId: "project-a", folderIds: [general(workspace, "project-a"), notes, servers] });
  assert.deepEqual(workspace.state.projects["project-a"].folderIds.slice(1), [notes, servers]);
  host(registry, { type: "panel.moveToFolder", panelId: "panel-b", folderId: servers });
  refused(registry, { type: "folder.delete", folderId: servers }, /folder must be empty/);
  host(registry, { type: "panel.moveToFolder", panelId: "panel-b", folderId: general(workspace, "project-a") });
  host(registry, { type: "folder.delete", folderId: servers });
  assert.equal(workspace.state.folders[servers], undefined);
  assert.deepEqual(workspace.state.projects["project-a"].folderIds, [general(workspace, "project-a"), notes]);
});

test("moving a panel between folders keeps the source layout and never re-homes the terminal", () => {
  const { workspace, registry, rehomed } = fixture();
  const generalId = general(workspace, "project-a");
  const target = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Servers" }));
  const sessionBefore = workspace.state.terminalSessions["session-a"];
  host(registry, { type: "panel.moveToFolder", panelId: "panel-a", folderId: target });
  const state = workspace.state;
  assert.equal(state.panels["panel-a"].folderId, target);
  assert.equal(state.panels["panel-a"].projectId, "project-a");
  assert.deepEqual(state.folders[target].panelIds, ["panel-a"]);
  assert.equal(state.folders[target].activePanelId, "panel-a");
  assert.deepEqual(state.folders[generalId].panelIds, ["panel-b", "panel-file"]);
  // Folder order decides the project's derived panel order.
  assert.deepEqual(state.projects["project-a"].panelIds, ["panel-b", "panel-file", "panel-a"]);
  assert.deepEqual(state.terminalSessions["session-a"], sessionBefore);
  assert.deepEqual(rehomed, []);
});

test("a move to another project lands in its General folder and still re-homes", () => {
  const { workspace, registry, rehomed } = fixture();
  const side = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Side" }));
  host(registry, { type: "panel.moveToFolder", panelId: "panel-a", folderId: side });
  host(registry, { type: "panel.move", panelId: "panel-a", targetProjectId: "project-b" });
  const state = workspace.state;
  assert.equal(state.panels["panel-a"].projectId, "project-b");
  assert.equal(state.panels["panel-a"].folderId, general(workspace, "project-b"));
  assert.deepEqual(state.folders[side].panelIds, []);
  assert.deepEqual(state.projects["project-b"].panelIds, ["panel-a"]);
  assert.deepEqual(rehomed, [{ sessionId: "session-a", sourceProjectId: "project-a", targetProjectId: "project-b" }]);
});

test("a folder command naming another project's folder or panel is refused", async () => {
  const { workspace, registry } = fixture();
  const other = general(workspace, "project-b");
  refused(registry, { type: "panel.moveToFolder", panelId: "panel-a", folderId: other }, /folder is outside the panel project/);
  refused(registry, { type: "terminal.createPanel", projectId: "project-a", folderId: other, sessionId: "session-x", panelId: "panel-x" }, /folder is outside project/);
  refused(registry, { type: "panel.create", panel: { id: "panel-y", projectId: "project-a", folderId: other, type: "file", path: "a", createdAt: 9 } }, /folder is outside project/);
  refused(registry, { type: "panel.update", panelId: "panel-a", patch: { folderId: other } }, /immutable/);
  // A connection scoped to one project cannot touch another project's folder.
  await rejectsWith(client(registry, { type: "folder.rename", folderId: other, name: "x" }, { projectId: "project-a" }), /outside the authenticated project scope/);
  await rejectsWith(client(registry, { type: "panel.moveToFolder", panelId: "panel-a", folderId: other }, { projectId: "project-a" }), /outside the authenticated project scope/);
});

test("split, reorder, activate, and close act on the panel's own folder only", () => {
  const { workspace, registry } = fixture();
  const generalId = general(workspace, "project-a");
  const side = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Side" }));
  host(registry, { type: "terminal.createPanel", projectId: "project-a", folderId: side, sessionId: "session-c", panelId: "panel-c", createdAt: 4 });
  host(registry, { type: "terminal.createPanel", projectId: "project-a", folderId: side, sessionId: "session-d", panelId: "panel-d", createdAt: 5 });
  host(registry, { type: "panel.split", projectId: "project-a", panelId: "panel-a", direction: "horizontal" });
  assert.equal(workspace.state.folders[generalId].layout.kind, "split");
  assert.equal(workspace.state.folders[side].layout.kind, "stack");
  host(registry, { type: "panel.reorder", projectId: "project-a", folderId: side, panelIds: ["panel-d", "panel-c"] });
  assert.deepEqual(workspace.state.folders[side].panelIds, ["panel-d", "panel-c"]);
  assert.equal(workspace.state.folders[generalId].layout.kind, "split");
  refused(registry, { type: "panel.reorder", projectId: "project-a", folderId: side, panelIds: ["panel-a", "panel-c"] }, /crosses folder boundary/);
  host(registry, { type: "panel.activate", projectId: "project-a", panelId: "panel-c" });
  assert.equal(workspace.state.folders[side].activePanelId, "panel-c");
  assert.equal(workspace.state.projects["project-a"].activePanelId, "panel-c");
  host(registry, { type: "panel.close", panelId: "panel-c" });
  assert.deepEqual(workspace.state.folders[side].panelIds, ["panel-d"]);
  assert.equal(workspace.state.projects["project-a"].activePanelId, "panel-d");
  // Closing every panel leaves the project and its folders in place.
  for (const panelId of ["panel-a", "panel-b", "panel-file", "panel-d"]) host(registry, { type: "panel.close", panelId });
  assert.deepEqual(workspace.state.projects["project-a"].panelIds, []);
  assert.deepEqual(workspace.state.projects["project-a"].folderIds, [generalId, side]);
});

test("only the server links a folder, and a client cannot delete a linked folder", async () => {
  const { workspace, registry } = fixture();
  const linked = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "feature", worktree: LINK, createdByPanelId: "panel-a" }));
  assert.equal(workspace.state.folders[linked].kind, "linked");
  assert.deepEqual(workspace.state.folders[linked].worktree, LINK);
  assert.equal(workspace.state.folders[linked].createdByPanelId, "panel-a");
  refused(registry, { type: "folder.create", projectId: "project-a", name: "again", worktree: LINK }, /a worktree has more than one folder/);
  await rejectsWith(client(registry, { type: "folder.create", projectId: "project-a", name: "sneaky", worktree: { repositoryId: "repo-1", path: "/etc" } }), /host-owned/);
  await rejectsWith(client(registry, { type: "folder.create", projectId: "project-a", name: "sneaky", createdByPanelId: "panel-a" }), /host-owned/);
  await rejectsWith(client(registry, { type: "folder.link.update", folderId: linked, worktree: { repositoryId: "repo-1", path: "/etc" } }), /host-owned/);
  await rejectsWith(client(registry, { type: "folder.offer.set", folderId: linked, panelId: "panel-b" }), /host-owned/);
  await rejectsWith(client(registry, { type: "folder.delete", folderId: linked }), /deleting its worktree/);
  // A client may rename it; the link is unchanged.
  await client(registry, { type: "folder.rename", folderId: linked, name: "Feature work" });
  assert.equal(workspace.state.folders[linked].name, "Feature work");
  assert.deepEqual(workspace.state.folders[linked].worktree, LINK);
  host(registry, { type: "folder.link.update", folderId: linked, worktree: { ...LINK, path: "/project-a/.worktrees/renamed" } });
  assert.equal(workspace.state.folders[linked].worktree.path, "/project-a/.worktrees/renamed");
  host(registry, { type: "folder.delete", folderId: linked });
  assert.equal(workspace.state.folders[linked], undefined);
});

test("a capture offer is accepted, declined, and forgotten when its panel leaves", async () => {
  const { workspace, registry, rehomed } = fixture();
  const linked = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "feature", worktree: LINK, createdByPanelId: "panel-a" }));
  host(registry, { type: "folder.offer.set", folderId: linked, panelId: "panel-a" });
  assert.deepEqual(workspace.state.folders[linked].captureOffer, { panelId: "panel-a" });
  await client(registry, { type: "folder.offer.decline", folderId: linked });
  assert.equal(workspace.state.folders[linked].captureOffer, undefined);
  assert.equal(workspace.state.panels["panel-a"].folderId, general(workspace, "project-a"));
  // The creator is still recorded after a decline, so the row can be tagged.
  assert.equal(workspace.state.folders[linked].createdByPanelId, "panel-a");
  await rejectsWith(client(registry, { type: "folder.offer.accept", folderId: linked }), /folder has no offer/);

  host(registry, { type: "folder.offer.set", folderId: linked, panelId: "panel-a" });
  await client(registry, { type: "folder.offer.accept", folderId: linked });
  assert.equal(workspace.state.panels["panel-a"].folderId, linked);
  assert.equal(workspace.state.folders[linked].captureOffer, undefined);
  assert.deepEqual(rehomed, []);

  host(registry, { type: "folder.offer.set", folderId: linked, panelId: "panel-b" });
  host(registry, { type: "panel.close", panelId: "panel-b" });
  assert.equal(workspace.state.folders[linked].captureOffer, undefined);
  host(registry, { type: "panel.close", panelId: "panel-a" });
  assert.equal(workspace.state.folders[linked].createdByPanelId, undefined);
});

test("a state that breaks a folder invariant is rejected", () => {
  const { workspace, registry } = fixture();
  const side = created(workspace, host(registry, { type: "folder.create", projectId: "project-a", name: "Side" }));
  const state = workspace.state;
  const generalId = general(workspace, "project-a");
  const withFolder = (id, patch) => ({ ...state, folders: { ...state.folders, [id]: { ...state.folders[id], ...patch } } });
  assert.throws(() => validateWorkspace({ ...state, panels: { ...state.panels, "panel-a": { ...state.panels["panel-a"], folderId: side } } }), /folder\/panel ownership mismatch|panel is outside its folder/);
  assert.throws(() => validateWorkspace(withFolder(side, { kind: "general" })), /one General folder/);
  assert.throws(() => validateWorkspace(withFolder(generalId, { kind: "plain" })), /one General folder/);
  assert.throws(() => validateWorkspace(withFolder(side, { kind: "linked" })), /worktree link does not match its kind/);
  assert.throws(() => validateWorkspace(withFolder(side, { worktree: LINK })), /worktree link does not match its kind/);
  assert.throws(() => validateWorkspace(withFolder(side, { projectId: "project-b" })), /folder/);
  assert.throws(() => validateWorkspace(withFolder(side, { surprise: true })), /unknown field: surprise/);
  assert.throws(() => validateWorkspace(withFolder(side, { captureOffer: { panelId: "missing" } })), /offers a panel it cannot capture/);
  assert.throws(() => validateWorkspace({ ...state, projects: { ...state.projects, "project-a": { ...state.projects["project-a"], panelIds: ["panel-b", "panel-a", "panel-file"] } } }), /does not match its folders/);
  assert.throws(() => validateWorkspace({ ...state, projects: { ...state.projects, "project-a": { ...state.projects["project-a"], folderIds: [generalId] } } }), /folder crosses project boundary/);
});

/** What a schema 5 server stored: no folders, panels held by the project. */
function schema5() {
  const { workspace, registry } = fixture();
  host(registry, { type: "panel.split", projectId: "project-a", panelId: "panel-a", direction: "vertical" });
  const state = structuredClone(workspace.state);
  for (const project of Object.values(state.projects)) {
    const folder = state.folders[project.folderIds[0]];
    project.layout = folder.layout;
    delete project.folderIds;
  }
  for (const panel of Object.values(state.panels)) delete panel.folderId;
  delete state.folders;
  state.schemaVersion = 5;
  return { stored: state, current: workspace.state };
}

test("a schema 5 workspace gains a General folder per project without losing anything", () => {
  const { stored, current } = schema5();
  const migrated = migrateWorkspaceState(structuredClone(stored), "server-a");
  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  validateWorkspace(migrated);
  assert.deepEqual(Object.keys(migrated.panels).sort(), Object.keys(stored.panels).sort());
  assert.deepEqual(migrated.terminalSessions, stored.terminalSessions);
  for (const [projectId, project] of Object.entries(stored.projects)) {
    const next = migrated.projects[projectId];
    assert.equal(next.folderIds.length, 1);
    const folder = migrated.folders[next.folderIds[0]];
    assert.equal(folder.kind, "general");
    assert.deepEqual(folder.panelIds, project.panelIds);
    assert.deepEqual(folder.layout, project.layout);
    assert.equal(folder.activePanelId, project.activePanelId);
    assert.deepEqual(next.panelIds, project.panelIds);
    for (const panelId of project.panelIds) assert.equal(migrated.panels[panelId].folderId, folder.id);
  }
  // The split the user had is still the layout, and everything else matches a
  // workspace that was always schema 6, folder ids aside.
  assert.equal(migrated.folders[migrated.projects["project-a"].folderIds[0]].layout.kind, "split");
  assert.deepEqual(migrated.projects["project-a"].sidebar, current.projects["project-a"].sidebar);
});

test("the schema 5 migration is repeatable and does not disturb its input", () => {
  const { stored } = schema5();
  const input = structuredClone(stored);
  const first = migrateWorkspaceState(input, "server-a");
  assert.deepEqual(input, stored);
  assert.deepEqual(migrateWorkspaceState(structuredClone(stored), "server-a"), first);
  // Migrating the result again is a no-op.
  assert.deepEqual(migrateWorkspaceState(structuredClone(first), "server-a"), first);
});

test("folders made after a migration never reuse a migrated folder's id", () => {
  const { stored } = schema5();
  const workspace = new WorkspaceStore(migrateWorkspaceState(stored, "server-a"));
  const before = new Set(Object.keys(workspace.state.folders));
  for (let index = 0; index < 5; index += 1) {
    const applied = workspace.apply({ commandId: `folder-${index}`, command: { type: "folder.create", projectId: "project-a", name: `Folder ${index}` } });
    assert.equal(applied.ok, true);
  }
  const after = Object.keys(workspace.state.folders);
  assert.equal(after.length, before.size + 5);
  assert.equal(new Set(after).size, after.length);
});
