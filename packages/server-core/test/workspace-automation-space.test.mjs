import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTOMATION_SPACE_PROJECT_ID,
  AUTOMATION_SPACE_TERMINAL_LIMIT,
  AUTOMATIONS_FEATURE_CAPABILITY,
  WORKSPACE_OPERATIONS,
  WorkspaceRepository,
  WorkspaceStore,
  automationSpaceSessionGuard,
  createInitialWorkspace,
  createWorkspaceOperationRegistry,
  findAutomationSpace,
  migrateWorkspaceState,
} from "../dist/index.js";
import { FileWorkspaceStateBackend } from "../dist/workspaceRepository.js";
import { restoredProjectsInPresentationOrder } from "../dist/workspaceStartup.js";

const SPACE = AUTOMATION_SPACE_PROJECT_ID;

function storeWithProject() {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const viewId = store.state.viewOrder[0];
  const created = store.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "A" } });
  assert.equal(created.ok, true);
  return { store, viewId };
}

function context(capabilities) {
  return {
    authScope: "write",
    clientId: "client-a",
    connectionId: "connection-a",
    signal: new AbortController().signal,
    ...(capabilities === undefined ? {} : { clientCapabilities: capabilities }),
  };
}

function command(registry, capabilities, commandId, workspaceCommand) {
  return registry.operations.commands[WORKSPACE_OPERATIONS.command]({
    body: new Uint8Array(),
    context: context(capabilities),
    envelope: { commandId, operation: WORKSPACE_OPERATIONS.command, payload: { command: workspaceCommand } },
  });
}

function snapshot(registry, capabilities) {
  return registry.operations.queries[WORKSPACE_OPERATIONS.snapshot]({
    body: new Uint8Array(),
    context: context(capabilities),
    envelope: { operation: WORKSPACE_OPERATIONS.snapshot, payload: {} },
  });
}

function delta(registry, capabilities, revision) {
  return registry.operations.queries[WORKSPACE_OPERATIONS.delta]({
    body: new Uint8Array(),
    context: context(capabilities),
    envelope: { operation: WORKSPACE_OPERATIONS.delta, payload: { revision, cursor: String(revision) } },
  });
}

test("the automation space is created lazily, once, outside every view's project order", () => {
  const { store, viewId } = storeWithProject();
  assert.equal(findAutomationSpace(store.state), undefined);
  const revision = store.state.revision;
  const id = store.ensureAutomationSpace({ root: "/home/server" });
  assert.equal(id, SPACE);
  assert.equal(store.state.revision, revision + 1);
  const space = store.state.projects[SPACE];
  assert.equal(space.kind, "automations");
  assert.equal(space.rootOrigin, "server-default");
  assert.equal(space.viewId, viewId);
  assert.deepEqual(store.state.views[viewId].projectIds, ["project-a"]);
  assert.equal(store.state.views[viewId].activeProjectId, "project-a");
  // Idempotent: no new revision, same identity.
  assert.equal(store.ensureAutomationSpace({ root: "/elsewhere" }), SPACE);
  assert.equal(store.state.revision, revision + 1);
  assert.equal(Object.values(store.state.projects).filter((p) => p.kind === "automations").length, 1);
});

test("the automation space refuses close, rename, edit, reorder, selection, and panel moves", () => {
  const { store } = storeWithProject();
  store.ensureAutomationSpace({ root: "/home/server" });
  assert.equal(store.apply({ commandId: "view-b", command: { type: "view.create", viewId: "view-b", name: "B" } }).ok, true);
  assert.equal(store.apply({ commandId: "t", command: { type: "terminal.createPanel", sessionId: "s-auto", projectId: SPACE, panelId: "p-auto", createdAt: 1 } }).ok, true);
  assert.equal(store.apply({ commandId: "t2", command: { type: "terminal.createPanel", sessionId: "s-a", projectId: "project-a", panelId: "p-a", createdAt: 1 } }).ok, true);
  const refused = [
    [{ type: "project.close", projectId: SPACE }, /cannot be closed/],
    [{ type: "project.rename", projectId: SPACE, name: "Mine" }, /cannot be renamed/],
    [{ type: "project.update", projectId: SPACE, name: "Mine", root: "/tmp" }, /cannot be renamed or edited/],
    [{ type: "project.root.update", projectId: SPACE, root: "/tmp" }, /cannot be renamed or edited/],
    [{ type: "project.move", projectId: SPACE, targetViewId: "view-b" }, /cannot be reordered/],
    [{ type: "project.activate", projectId: SPACE }, /cannot be selected/],
    [{ type: "panel.move", panelId: "p-auto", targetProjectId: "project-a" }, /into or out of the automation space/],
    [{ type: "panel.move", panelId: "p-a", targetProjectId: SPACE }, /into or out of the automation space/],
    [{ type: "project.create", projectId: SPACE, viewId: store.state.viewOrder[0], root: "/tmp" }, /reserved/],
  ];
  for (const [cmd, message] of refused) {
    const before = store.state.revision;
    const result = store.apply({ commandId: `refuse-${cmd.type}-${cmd.panelId ?? ""}`, command: cmd });
    assert.equal(result.ok, false, cmd.type);
    assert.match(result.conflict.message, message, cmd.type);
    assert.ok(result.conflict.message.length <= 128);
    assert.equal(store.state.revision, before);
  }
  assert.equal(store.state.projects[SPACE].name, "Automations");
  // Its own terminals still work as ordinary terminals.
  assert.equal(store.apply({ commandId: "activate-panel", command: { type: "panel.activate", projectId: SPACE, panelId: "p-auto" } }).ok, true);
  assert.equal(store.apply({ commandId: "close-panel", command: { type: "panel.close", panelId: "p-auto" } }).ok, true);
});

test("closing the view that homes the automation space re-homes it instead of failing", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  assert.equal(store.apply({ commandId: "view-b", command: { type: "view.create", viewId: "view-b", name: "B" } }).ok, true);
  store.ensureAutomationSpace({ root: "/home/server" });
  const home = store.state.projects[SPACE].viewId;
  assert.equal(store.apply({ commandId: "close", command: { type: "view.close", viewId: home } }).ok, true);
  assert.equal(store.state.projects[SPACE].viewId, "view-b");
});

test("protocol commands against the automation space fail with bounded, non-retryable errors", async () => {
  const { store } = storeWithProject();
  const registry = createWorkspaceOperationRegistry(store);
  registry.ensureAutomationSpace("/home/server");
  const capable = [AUTOMATIONS_FEATURE_CAPABILITY];
  for (const cmd of [
    { type: "project.close", projectId: SPACE },
    { type: "project.rename", projectId: SPACE, name: "x" },
    { type: "project.move", projectId: SPACE, targetViewId: store.state.viewOrder[0] },
    { type: "project.activate", projectId: SPACE },
  ]) {
    await assert.rejects(command(registry, capable, `c-${cmd.type}`, cmd), (error) => error.code === "forbidden" && error.retryable !== true, cmd.type);
  }
  // A connection that cannot see the space cannot target it either.
  await assert.rejects(
    command(registry, [], "c-hidden", { type: "terminal.create", sessionId: "s-hidden", projectId: SPACE }),
    (error) => error.code === "conflict" && /project not found/.test(error.message),
  );
});

test("connections without automations.v1 never see the space, its panels, or its terminals", () => {
  const { store } = storeWithProject();
  const registry = createWorkspaceOperationRegistry(store);
  const start = store.state.revision;
  registry.ensureAutomationSpace("/home/server");
  registry.applyHostCommand("auto-term", { type: "terminal.createPanel", sessionId: "s-auto", projectId: SPACE, panelId: "p-auto", createdAt: 1 });
  registry.applyHostCommand("user-term", { type: "terminal.createPanel", sessionId: "s-a", projectId: "project-a", panelId: "p-a", createdAt: 1 });

  for (const capabilities of [undefined, [], ["workspace.v1", "terminal.v1"]]) {
    const hidden = snapshot(registry, capabilities);
    assert.deepEqual(Object.keys(hidden.projects), ["project-a"]);
    assert.deepEqual(Object.keys(hidden.panels), ["p-a"]);
    assert.deepEqual(Object.keys(hidden.terminalSessions), ["s-a"]);
    assert.equal(JSON.stringify(hidden).includes(SPACE), false);
    const changes = delta(registry, capabilities, start);
    assert.equal(JSON.stringify(changes).includes(SPACE), false);
    assert.equal(JSON.stringify(changes).includes("s-auto"), false);
    assert.deepEqual(changes.events.map((event) => event.commandId), ["user-term"]);
  }

  const visible = snapshot(registry, ["workspace.v1", AUTOMATIONS_FEATURE_CAPABILITY]);
  assert.equal(visible.projects[SPACE].kind, "automations");
  assert.equal(visible.panels["p-auto"].projectId, SPACE);
  assert.equal(visible.terminalSessions["s-auto"].projectId, SPACE);
  assert.equal(visible.projects["project-a"].kind, undefined);
  assert.equal(delta(registry, [AUTOMATIONS_FEATURE_CAPABILITY], start).events.length, 3);
});

test(`the automation space refuses a live terminal beyond ${AUTOMATION_SPACE_TERMINAL_LIMIT}`, () => {
  const { store } = storeWithProject();
  store.ensureAutomationSpace({ root: "/home/server" });
  for (let index = 0; index < AUTOMATION_SPACE_TERMINAL_LIMIT; index += 1) {
    const created = store.apply({ commandId: `t-${index}`, command: { type: "terminal.createPanel", sessionId: `s-${index}`, projectId: SPACE, panelId: `p-${index}`, createdAt: 1 } });
    assert.equal(created.ok, true, created.ok ? undefined : created.conflict.message);
  }
  for (const cmd of [
    { type: "terminal.createPanel", sessionId: "s-over", projectId: SPACE, panelId: "p-over", createdAt: 1 },
    { type: "terminal.create", sessionId: "s-over", projectId: SPACE, createdAt: 1 },
  ]) {
    const over = store.apply({ commandId: `over-${cmd.type}`, command: cmd });
    assert.equal(over.ok, false);
    assert.match(over.conflict.message, /limit of 50 live terminals/);
  }
  // The pre-spawn guard refuses with a bounded session_limit error.
  const guard = automationSpaceSessionGuard(store);
  assert.throws(() => guard({ context: context([AUTOMATIONS_FEATURE_CAPABILITY]) }, SPACE), (error) => error.code === "session_limit" && error.details.max === 50);
  assert.throws(() => guard({ context: context([]) }, SPACE), (error) => error.code === "forbidden");
  assert.doesNotThrow(() => guard({ context: context([]) }, "project-a"));
  // Ordinary projects are unaffected, and an exited terminal frees a slot.
  assert.equal(store.apply({ commandId: "user", command: { type: "terminal.create", sessionId: "s-user", projectId: "project-a", createdAt: 1 } }).ok, true);
  assert.equal(store.apply({ commandId: "exit", command: { type: "terminal.markExited", sessionId: "s-0", exitCode: 0 } }).ok, true);
  assert.equal(store.apply({ commandId: "again", command: { type: "terminal.create", sessionId: "s-again", projectId: SPACE, createdAt: 1 } }).ok, true);
});

test("the persisted workspace round-trips the automations kind and still loads kindless data", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-automation-space-"));
  try {
    const path = join(root, "workspace.v3.json");
    const backend = new FileWorkspaceStateBackend(path);
    const first = new WorkspaceRepository(backend, "server-a", () => createInitialWorkspace("server-a"));
    await first.load();
    first.workspace.apply({ commandId: "project-a", command: { type: "project.create", projectId: "project-a", viewId: first.workspace.state.viewOrder[0], root: "/tmp/a", name: "A" } });
    first.workspace.ensureAutomationSpace({ root: "/home/server" });
    const persisted = JSON.parse(await readFile(path, "utf8"));
    const persistedState = persisted.state ?? persisted;
    assert.equal(persistedState.projects[SPACE].kind, "automations");
    assert.equal("kind" in persistedState.projects["project-a"], false);

    const second = new WorkspaceRepository(new FileWorkspaceStateBackend(path), "server-a", () => createInitialWorkspace("server-a"));
    await second.load();
    assert.deepEqual(second.workspace.state.projects[SPACE], first.workspace.state.projects[SPACE]);
    assert.equal(second.workspace.ensureAutomationSpace({ root: "/home/server" }), SPACE);
    assert.equal(second.workspace.state.revision, first.workspace.state.revision);
    // Startup restore never seeds a terminal into the automation space.
    assert.deepEqual(restoredProjectsInPresentationOrder(second.workspace.state).map((p) => p.id), ["project-a"]);

    // Existing data written before the kind existed loads unchanged.
    const legacy = structuredClone(first.workspace.state);
    delete legacy.projects[SPACE];
    const loaded = migrateWorkspaceState(JSON.parse(JSON.stringify(legacy)), "server-a");
    assert.equal(loaded.projects["project-a"].kind, undefined);
    // An unknown kind, or a second space, is rejected rather than half-read.
    const bogus = structuredClone(first.workspace.state);
    bogus.projects["project-a"].kind = "other";
    assert.throws(() => migrateWorkspaceState(bogus, "server-a"), /project kind is invalid/);
    const listed = structuredClone(first.workspace.state);
    listed.views[listed.viewOrder[0]].projectIds.push(SPACE);
    assert.throws(() => migrateWorkspaceState(listed, "server-a"), /cannot be a listed project/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
