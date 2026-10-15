import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FEATURE_CAPABILITIES, PROJECT_START_OPERATIONS } from "@terminay/protocol";
import {
  MAX_RECENT_PROJECT_FOLDERS,
  OrderedEventJournal,
  RootFolderBrowser,
  WORKSPACE_OPERATIONS,
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceStore,
  createInitialWorkspace,
  createOperationDispatcher,
  createServerCoreComposition,
  createWorkspaceOperationRegistry,
  isRootedProjectOperation,
  migrateWorkspaceState,
  refuseRootlessProjectOperations,
  validateWorkspace,
} from "../dist/index.js";
import { restoreWorkspaceOnStartup } from "../dist/workspaceStartup.js";

const STARTS = [FEATURE_CAPABILITIES.workspace, FEATURE_CAPABILITIES.projectStartChoice];
const OLDER = [FEATURE_CAPABILITIES.workspace];

async function folders() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "terminay-start-")));
  const home = join(base, "home");
  await mkdir(join(home, "alpha"), { recursive: true });
  await mkdir(join(home, "beta"));
  await writeFile(join(home, "notes.txt"), "a file, never listed");
  await symlink(join(home, "alpha"), join(home, "linked-alpha"));
  await symlink(join(home, "notes.txt"), join(home, "linked-file"));
  return { base, home, cleanup: () => rm(base, { recursive: true, force: true }) };
}

let serial = 0;
function harness({ home = tmpdir(), storage, prepare, maxEntries } = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const journal = new OrderedEventJournal();
  let clock = 1_000;
  const prepared = [];
  const registry = createWorkspaceOperationRegistry(workspace, {
    eventJournal: journal,
    defaultProjectRoot: async () => home,
    rootFolders: new RootFolderBrowser({ homeDirectory: async () => home, ...(storage === undefined ? {} : { storage }), ...(maxEntries === undefined ? {} : { maxEntries }) }),
    now: () => (clock += 1),
    ...(prepare === undefined ? {} : {
      prepareProjectRootUpdate: async (projectId, root) => {
        prepared.push({ projectId, root });
        return { canonicalRoot: root, commit: () => prepared.push({ committed: projectId, root }) };
      },
    }),
  });
  const viewId = workspace.state.viewOrder[0];
  const context = (capabilities, extra = {}) => ({
    authScope: "write", clientId: "client-a", connectionId: "connection-a",
    signal: new AbortController().signal, clientCapabilities: capabilities, ...extra,
  });
  const command = async (operation, payload, { capabilities = STARTS, ...extra } = {}) =>
    registry.operations.commands[operation]({
      body: new Uint8Array(), context: context(capabilities, extra),
      envelope: { commandId: `c-${++serial}`, operation, payload },
    });
  const query = async (operation, payload, { capabilities = STARTS, ...extra } = {}) =>
    registry.operations.queries[operation]({
      body: new Uint8Array(), context: context(capabilities, extra),
      envelope: { queryId: `q-${++serial}`, operation, payload },
    });
  const create = (projectId, extra = {}, options) =>
    command(WORKSPACE_OPERATIONS.command, { command: { type: "project.create", projectId, viewId, ...extra } }, options);
  const start = (projectId, choice, options) => command(PROJECT_START_OPERATIONS.start, { projectId, choice }, options);
  return { workspace, journal, registry, viewId, command, query, create, start, prepared };
}

/** A protocol refusal is a plain object; match its code and typed reason. */
async function refused(promise, code, reason) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (reason !== undefined) assert.equal(error.details?.reason, reason, error.message);
    return true;
  });
}

// --- 2.1 model and validator -------------------------------------------------

test("the validator accepts an awaiting project, a no-root project, and recent folders", () => {
  const { workspace, registry, viewId } = harness();
  registry.applyHostCommand("a", { type: "project.create", projectId: "awaiting", viewId, root: "", rootOrigin: "none", start: "awaiting-choice" });
  registry.applyHostCommand("b", { type: "project.create", projectId: "no-root", viewId, root: "", rootOrigin: "none" });
  registry.applyHostCommand("c", { type: "project.root.update", projectId: "no-root", root: "/srv/a", usedAt: 5 });
  assert.equal(workspace.state.projects.awaiting.start, "awaiting-choice");
  assert.deepEqual(workspace.state.recentProjectFolders, [{ path: "/srv/a", usedAt: 5 }]);
  assert.doesNotThrow(() => validateWorkspace(workspace.state));
});

test("the validator rejects a start state with a root, a none origin with a root, and bad recents", () => {
  const { workspace, registry, viewId } = harness();
  registry.applyHostCommand("a", { type: "project.create", projectId: "rooted", viewId, root: "/srv/a" });
  const state = structuredClone(workspace.state);
  const withProject = (patch) => ({ ...state, projects: { ...state.projects, rooted: { ...state.projects.rooted, ...patch } } });
  assert.throws(() => validateWorkspace(withProject({ start: "awaiting-choice" })), /awaiting a start choice has a root/);
  assert.throws(() => validateWorkspace(withProject({ start: "awaiting-choice", rootOrigin: "server-default" })), /awaiting a start choice has a root/);
  assert.throws(() => validateWorkspace(withProject({ rootOrigin: "none" })), /does not match its origin/);
  assert.throws(() => validateWorkspace(withProject({ root: "", rootOrigin: "none", start: "later" })), /start state is invalid/);
  assert.throws(() => validateWorkspace({ ...state, recentProjectFolders: [{ path: "/a", usedAt: 1 }, { path: "/a", usedAt: 2 }] }), /recent project folder is invalid/);
  assert.throws(() => validateWorkspace({ ...state, recentProjectFolders: [{ path: "/a", usedAt: 1, name: "a" }] }), /unknown field/);
  assert.throws(() => validateWorkspace({ ...state, recentProjectFolders: Array.from({ length: 51 }, (_, i) => ({ path: `/f${i}`, usedAt: i })) }), /recent project folders are invalid/);
  assert.throws(() => validateWorkspace({ ...state, recentProjectFolders: undefined }), /recent project folders are invalid/);
});

test("a project awaiting a choice refuses terminals and panels", () => {
  const { workspace, registry, viewId } = harness();
  registry.applyHostCommand("a", { type: "project.create", projectId: "awaiting", viewId, root: "", rootOrigin: "none", start: "awaiting-choice" });
  for (const command of [
    { type: "terminal.createPanel", projectId: "awaiting", sessionId: "s", panelId: "p" },
    { type: "terminal.create", projectId: "awaiting", sessionId: "s2" },
    { type: "panel.create", panel: { id: "f", projectId: "awaiting", type: "file", path: "README.md", createdAt: 1 } },
  ]) {
    const applied = registry.applyHostCommand(`r-${++serial}`, command);
    assert.equal(applied.ok, false);
    assert.match(applied.conflict.message, /awaits a start choice/);
  }
  assert.deepEqual(workspace.state.terminalSessions, {});
});

// --- 2.2 migration -----------------------------------------------------------

test("a schema 6 workspace loads with identical projects and no recent folders", () => {
  const { workspace, registry, viewId } = harness();
  registry.applyHostCommand("a", { type: "project.create", projectId: "project-a", viewId, root: "/srv/a", name: "A", color: "#123456" });
  registry.applyHostCommand("b", { type: "project.create", projectId: "project-b", viewId, root: "/srv/b", rootOrigin: "server-default", name: "B" });
  const { recentProjectFolders: _recents, ...rest } = structuredClone(workspace.state);
  const v6 = { ...rest, schemaVersion: 6 };
  const migrated = migrateWorkspaceState(v6, "server-a");
  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.deepEqual(migrated.projects, v6.projects);
  assert.deepEqual(migrated.recentProjectFolders, []);
  for (const project of Object.values(migrated.projects)) assert.equal("start" in project, false);
  // Rerunning the migration on its own output changes nothing.
  assert.deepEqual(migrateWorkspaceState(structuredClone(migrated), "server-a"), migrated);
});

// --- 3.1 project.create ------------------------------------------------------

test("a client that negotiated the start choice creates a rootless project awaiting it", async () => {
  const { workspace, create, prepared } = harness({ prepare: true });
  await create("project-a");
  const project = workspace.state.projects["project-a"];
  assert.equal(project.start, "awaiting-choice");
  assert.equal(project.rootOrigin, "none");
  assert.equal(project.root, "");
  // No root was bound, so no filesystem, Git, or Documentation service was.
  assert.deepEqual(prepared, []);
});

test("an older client creating without a root gets the server default and starts at once", async () => {
  const { workspace, create } = harness({ home: "/srv/home" });
  await create("project-a", {}, { capabilities: OLDER });
  const project = workspace.state.projects["project-a"];
  assert.equal(project.start, undefined);
  assert.equal(project.rootOrigin, "server-default");
  assert.equal(project.root, "/srv/home");
});

test("an explicit root, a host-created project, and a client asking for a start state never await", async () => {
  const { workspace, registry, create, viewId } = harness();
  await create("explicit", { root: "/srv/explicit" });
  assert.equal(workspace.state.projects.explicit.start, undefined);
  assert.equal(workspace.state.projects.explicit.rootOrigin, "explicit");
  // MCP and a terminal created in an unknown project go through the host.
  registry.applyHostCommand("mcp", { type: "project.create", projectId: "from-mcp", viewId, root: "/srv/mcp" });
  assert.equal(workspace.state.projects["from-mcp"].start, undefined);
  await refused(create("sneaky", { start: "awaiting-choice" }), "validation");
  await refused(create("sneaky", { root: "", rootOrigin: "none" }), "validation");
  await refused((async () => registry.operations.commands[WORKSPACE_OPERATIONS.command]({
    body: new Uint8Array(),
    context: { authScope: "write", clientId: "c", connectionId: "c", signal: new AbortController().signal, clientCapabilities: STARTS },
    envelope: { commandId: "bypass", operation: WORKSPACE_OPERATIONS.command, payload: { command: { type: "project.start", projectId: "explicit", choice: { kind: "home" } } } },
  }))(), "validation");
  assert.equal(workspace.state.projects.sneaky, undefined);
});

test("a connection without the start choice is shown an awaiting project as one with no root", async () => {
  const { create, query } = harness();
  await create("project-a");
  const newer = await query(WORKSPACE_OPERATIONS.snapshot, {});
  const older = await query(WORKSPACE_OPERATIONS.snapshot, {}, { capabilities: OLDER });
  assert.equal(newer.projects["project-a"].start, "awaiting-choice");
  assert.equal("start" in older.projects["project-a"], false);
  assert.equal(older.projects["project-a"].rootOrigin, "none");
});

// --- 3.2 project.start -------------------------------------------------------

test("choosing home starts the project with no root folder and records nothing", async () => {
  const { workspace, create, start } = harness();
  await create("project-a");
  const answer = await start("project-a", { kind: "home" });
  assert.equal(answer.result.rootOrigin, "none");
  assert.equal(answer.result.root, "");
  const project = workspace.state.projects["project-a"];
  assert.equal(project.start, undefined);
  assert.equal(project.rootOrigin, "none");
  assert.deepEqual(workspace.state.recentProjectFolders, []);
});

test("choosing a folder makes its canonical path the explicit root", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, start, prepared } = harness({ home, prepare: true });
    await create("project-a");
    const answer = await start("project-a", { kind: "folder", path: join(home, "linked-alpha") });
    const canonical = join(home, "alpha");
    assert.equal(answer.result.root, canonical);
    assert.equal(answer.result.rootOrigin, "explicit");
    const project = workspace.state.projects["project-a"];
    assert.equal(project.root, canonical);
    assert.equal(project.rootOrigin, "explicit");
    assert.equal(project.start, undefined);
    assert.deepEqual(workspace.state.recentProjectFolders.map((entry) => entry.path), [canonical]);
    // The host bound the root first and committed it after the workspace did.
    assert.deepEqual(prepared, [{ projectId: "project-a", root: canonical }, { committed: "project-a", root: canonical }]);
  } finally {
    await cleanup();
  }
});

test("the first choice wins and a later one is refused with start_conflict", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, start } = harness({ home, prepare: true });
    await create("project-a");
    // Both arrive before either is answered.
    const [first, second] = await Promise.allSettled([
      start("project-a", { kind: "folder", path: join(home, "alpha") }),
      start("project-a", { kind: "home" }),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(second.status, "rejected");
    assert.equal(second.reason.code, "conflict");
    assert.equal(second.reason.details.reason, "start_conflict");
    assert.equal(workspace.state.projects["project-a"].root, join(home, "alpha"));
    const revision = workspace.state.revision;
    await refused(start("project-a", { kind: "home" }), "conflict", "start_conflict");
    assert.equal(workspace.state.revision, revision);
  } finally {
    await cleanup();
  }
});

test("a missing folder or a file leaves the project awaiting its choice", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, start, prepared } = harness({ home, prepare: true });
    await create("project-a");
    const revision = workspace.state.revision;
    await refused(start("project-a", { kind: "folder", path: join(home, "gone") }), "not_found", "path_missing");
    await refused(start("project-a", { kind: "folder", path: join(home, "notes.txt") }), "validation", "not_directory");
    await refused(start("project-a", { kind: "folder", path: "relative/path" }), "validation", "invalid_path");
    await refused(start("project-a", { kind: "nowhere" }), "validation");
    assert.equal(workspace.state.revision, revision);
    assert.equal(workspace.state.projects["project-a"].start, "awaiting-choice");
    assert.deepEqual(prepared, []);
    // A refused choice did not use up the first one.
    await start("project-a", { kind: "folder", path: join(home, "beta") });
    assert.equal(workspace.state.projects["project-a"].root, join(home, "beta"));
  } finally {
    await cleanup();
  }
});

test("a project-claimed connection can start only its own project", async () => {
  const { create, start } = harness();
  await create("project-a");
  await refused(start("project-a", { kind: "home" }, { claims: { projectId: "project-b" } }), "forbidden");
  await start("project-a", { kind: "home" }, { claims: { projectId: "project-a" } });
});

// --- 3.3 recent folders ------------------------------------------------------

test("recent folders are most recent first, unique, bounded, and forgettable", async () => {
  const { workspace, registry, viewId, command } = harness();
  registry.applyHostCommand("p", { type: "project.create", projectId: "project-a", viewId, root: "/srv/start" });
  const root = (path, usedAt) => registry.applyHostCommand(`r-${++serial}`, { type: "project.root.update", projectId: "project-a", root: path, usedAt });
  root("/srv/one", 1);
  root("/srv/two", 2);
  root("/srv/one", 3);
  assert.deepEqual(workspace.state.recentProjectFolders, [{ path: "/srv/one", usedAt: 3 }, { path: "/srv/two", usedAt: 2 }]);
  for (let index = 0; index < MAX_RECENT_PROJECT_FOLDERS; index += 1) root(`/srv/f${index}`, 10 + index);
  assert.equal(workspace.state.recentProjectFolders.length, MAX_RECENT_PROJECT_FOLDERS);
  assert.equal(workspace.state.recentProjectFolders[0].path, `/srv/f${MAX_RECENT_PROJECT_FOLDERS - 1}`);
  // The 51st folder dropped the least recently used ones.
  assert.equal(workspace.state.recentProjectFolders.some((entry) => entry.path === "/srv/two" || entry.path === "/srv/one"), false);
  root("/srv/extra", 1_000);
  assert.equal(workspace.state.recentProjectFolders.length, MAX_RECENT_PROJECT_FOLDERS);
  assert.equal(workspace.state.recentProjectFolders.some((entry) => entry.path === "/srv/f0"), false);

  const before = workspace.state.projects["project-a"];
  const forgotten = await command(PROJECT_START_OPERATIONS.recentForget, { path: "/srv/extra" });
  assert.equal(forgotten.result.forgotten, true);
  assert.equal(workspace.state.recentProjectFolders.some((entry) => entry.path === "/srv/extra"), false);
  // Forgetting changes no project, and forgetting again changes nothing.
  assert.deepEqual(workspace.state.projects["project-a"], before);
  const revision = workspace.state.revision;
  assert.equal((await command(PROJECT_START_OPERATIONS.recentForget, { path: "/srv/extra" })).result.forgotten, false);
  assert.equal(workspace.state.revision, revision);
  await refused(command(PROJECT_START_OPERATIONS.recentForget, { path: "/srv/f1" }, { claims: { projectId: "project-a" } }), "forbidden");
});

test("a forget reaches every client as a change record of the recent folders", async () => {
  const { workspace, registry, viewId, command } = harness();
  registry.applyHostCommand("p", { type: "project.create", projectId: "project-a", viewId, root: "/srv/start" });
  registry.applyHostCommand("r", { type: "project.root.update", projectId: "project-a", root: "/srv/one", usedAt: 1 });
  const recorded = workspace.recordAt(workspace.state.revision);
  assert.deepEqual(recorded.recentProjectFolders, [{ path: "/srv/one", usedAt: 1 }]);
  await command(PROJECT_START_OPERATIONS.recentForget, { path: "/srv/one" });
  assert.deepEqual(workspace.recordAt(workspace.state.revision).recentProjectFolders, []);
  registry.applyHostCommand("rename", { type: "project.rename", projectId: "project-a", name: "Renamed" });
  assert.equal("recentProjectFolders" in workspace.recordAt(workspace.state.revision), false);
});

test("a server default, a home start, and an explicit create record nothing", async () => {
  const { workspace, create, start } = harness({ home: "/srv/home" });
  await create("older", {}, { capabilities: OLDER });
  await create("explicit", { root: "/srv/explicit" });
  await create("awaiting");
  await start("awaiting", { kind: "home" });
  assert.deepEqual(workspace.state.recentProjectFolders, []);
});

test("setting a root on an awaiting project starts it and records the folder", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, command } = harness({ home, prepare: true });
    await create("project-a");
    await command(WORKSPACE_OPERATIONS.projectRootUpdate, { projectId: "project-a", root: join(home, "beta") });
    const project = workspace.state.projects["project-a"];
    assert.equal(project.start, undefined);
    assert.equal(project.rootOrigin, "explicit");
    assert.equal(project.root, join(home, "beta"));
    assert.deepEqual(workspace.state.recentProjectFolders.map((entry) => entry.path), [join(home, "beta")]);
  } finally {
    await cleanup();
  }
});

test("a typed ~ or ~/folder root is expanded against the verified home on the server", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, command, prepared } = harness({ home, prepare: true });
    await create("project-a", { root: join(home, "alpha") });
    const answer = await command(WORKSPACE_OPERATIONS.projectRootUpdate, { projectId: "project-a", root: "~/beta" });
    assert.equal(answer.result.root, join(home, "beta"));
    assert.equal(workspace.state.projects["project-a"].root, join(home, "beta"));
    // The host is handed the expanded path, never the literal tilde.
    assert.ok(prepared.every((entry) => !entry.root.startsWith("~")));
    await command(WORKSPACE_OPERATIONS.projectRootUpdate, { projectId: "project-a", root: "~" });
    assert.equal(workspace.state.projects["project-a"].root, home);
    assert.equal(workspace.state.projects["project-a"].rootOrigin, "explicit");
    assert.deepEqual(workspace.state.recentProjectFolders.map((entry) => entry.path), [home, join(home, "beta")]);
  } finally {
    await cleanup();
  }
});

test("a typed ~ root sets the root of an awaiting project, and ~user is not expanded", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, command, prepared } = harness({ home, prepare: true });
    await create("project-a");
    await command(WORKSPACE_OPERATIONS.projectRootUpdate, { projectId: "project-a", root: "~/alpha" });
    const project = workspace.state.projects["project-a"];
    assert.equal(project.start, undefined);
    assert.equal(project.root, join(home, "alpha"));
    // `~someone` names another account; the server passes it through as typed.
    prepared.length = 0;
    await command(WORKSPACE_OPERATIONS.projectRootUpdate, { projectId: "project-a", root: "~someone" }).catch(() => {});
    assert.equal(prepared[0]?.root, "~someone");
  } finally {
    await cleanup();
  }
});

test("a typed ~ root is refused when the server home is unavailable", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const prepared = [];
  const registry = createWorkspaceOperationRegistry(workspace, {
    eventJournal: new OrderedEventJournal(),
    defaultProjectRoot: async () => tmpdir(),
    rootFolders: new RootFolderBrowser({ homeDirectory: async () => null }),
    prepareProjectRootUpdate: async (_projectId, root) => {
      prepared.push(root);
      return { canonicalRoot: root, commit: () => {} };
    },
  });
  const viewId = workspace.state.viewOrder[0];
  const context = { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, clientCapabilities: STARTS };
  await registry.operations.commands[WORKSPACE_OPERATIONS.command]({
    body: new Uint8Array(), context,
    envelope: { commandId: `c-${++serial}`, operation: WORKSPACE_OPERATIONS.command, payload: { command: { type: "project.create", projectId: "project-a", viewId, root: tmpdir() } } },
  });
  prepared.length = 0;
  await refused(registry.operations.commands[WORKSPACE_OPERATIONS.projectRootUpdate]({
    body: new Uint8Array(), context,
    envelope: { commandId: `c-${++serial}`, operation: WORKSPACE_OPERATIONS.projectRootUpdate, payload: { projectId: "project-a", root: "~/x" } },
  }), "not_found", "path_missing");
  assert.deepEqual(prepared, []);
});

test("a start choice of ~ or ~/folder resolves to the verified home on the server", async () => {
  const { home, cleanup } = await folders();
  try {
    const { workspace, create, start } = harness({ home, prepare: true });
    await create("project-a");
    await create("project-b");
    const answer = await start("project-a", { kind: "folder", path: "~/alpha" });
    assert.equal(answer.result.root, join(home, "alpha"));
    await start("project-b", { kind: "folder", path: "~" });
    assert.equal(workspace.state.projects["project-b"].root, home);
    assert.equal(workspace.state.projects["project-b"].rootOrigin, "explicit");
  } finally {
    await cleanup();
  }
});

test("a project-claimed connection is never shown the server's recent folders", async () => {
  const { registry, viewId, query } = harness();
  registry.applyHostCommand("p", { type: "project.create", projectId: "project-a", viewId, root: "/srv/start" });
  registry.applyHostCommand("r", { type: "project.root.update", projectId: "project-a", root: "/srv/other-project", usedAt: 1 });
  const scoped = await query(WORKSPACE_OPERATIONS.snapshot, {}, { claims: { projectId: "project-a" } });
  assert.deepEqual(scoped.recentProjectFolders, []);
  await refused(query(PROJECT_START_OPERATIONS.recentList, {}, { claims: { projectId: "project-a" } }), "forbidden");
});

// --- 3.8 recent.list availability ---------------------------------------------

test("recent.list marks a folder that is gone as unavailable, with one stat each", async () => {
  const { home, cleanup } = await folders();
  try {
    const stats = [];
    const storage = {
      realpath: async (path) => realpath(path),
      stat: async (path) => { stats.push(path); const { stat } = await import("node:fs/promises"); return { isDirectory: (await stat(path)).isDirectory() }; },
      readDirectory: async () => { throw new Error("recent.list never lists a folder"); },
    };
    const { registry, viewId, query } = harness({ home, storage });
    registry.applyHostCommand("p", { type: "project.create", projectId: "project-a", viewId, root: home });
    registry.applyHostCommand("a", { type: "project.root.update", projectId: "project-a", root: join(home, "alpha"), usedAt: 1 });
    registry.applyHostCommand("b", { type: "project.root.update", projectId: "project-a", root: join(home, "gone"), usedAt: 2 });
    const listed = await query(PROJECT_START_OPERATIONS.recentList, {});
    assert.deepEqual(listed.entries, [
      { path: join(home, "gone"), usedAt: 2, available: false },
      { path: join(home, "alpha"), usedAt: 1, available: true },
    ]);
    assert.deepEqual(stats.sort(), [join(home, "alpha"), join(home, "gone")].sort());
  } finally {
    await cleanup();
  }
});

// --- 3.6 fs.browseRootFolders -------------------------------------------------

test("browsing lists directory names only, from home by default", async () => {
  const { home, cleanup } = await folders();
  try {
    const { query } = harness({ home });
    const listed = await query(PROJECT_START_OPERATIONS.browseRootFolders, {});
    assert.equal(listed.path, home);
    assert.equal(listed.parent, join(home, ".."));
    assert.deepEqual(listed.entries, [{ name: "alpha" }, { name: "beta" }, { name: "linked-alpha" }]);
    assert.equal(listed.truncated, false);
    for (const entry of listed.entries) assert.deepEqual(Object.keys(entry), ["name"]);
    // A path is canonicalized for each request.
    const entered = await query(PROJECT_START_OPERATIONS.browseRootFolders, { path: join(home, "linked-alpha") });
    assert.equal(entered.path, join(home, "alpha"));
    assert.deepEqual(entered.entries, []);
    const tilde = await query(PROJECT_START_OPERATIONS.browseRootFolders, { path: "~/beta" });
    assert.equal(tilde.path, join(home, "beta"));
  } finally {
    await cleanup();
  }
});

test("browsing a very large folder returns the bound and a truncation marker", async () => {
  const { home, cleanup } = await folders();
  try {
    const { query } = harness({ home, maxEntries: 2 });
    const listed = await query(PROJECT_START_OPERATIONS.browseRootFolders, {});
    assert.deepEqual(listed.entries, [{ name: "alpha" }, { name: "beta" }]);
    assert.equal(listed.truncated, true);
  } finally {
    await cleanup();
  }
});

test("browsing a missing, non-directory, or unreadable folder is a typed error", async () => {
  const { home, cleanup } = await folders();
  try {
    const { query } = harness({ home });
    const browse = (path) => query(PROJECT_START_OPERATIONS.browseRootFolders, { path });
    await refused(browse(join(home, "gone")), "not_found", "path_missing");
    await refused(browse(join(home, "notes.txt")), "validation", "not_directory");
    await refused(browse("not/absolute"), "validation", "invalid_path");
    await refused(query(PROJECT_START_OPERATIONS.browseRootFolders, { path: 7 }), "validation", "invalid_path");
    if (process.getuid?.() !== 0) {
      const locked = join(home, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        await refused(browse(locked), "forbidden", "unreadable");
      } finally {
        await chmod(locked, 0o755);
      }
    }
  } finally {
    await cleanup();
  }
});

test("a device without root-change authority is refused before any filesystem access", async () => {
  const touched = [];
  const storage = {
    realpath: async (path) => { touched.push(path); return path; },
    stat: async (path) => { touched.push(path); return { isDirectory: true }; },
    readDirectory: async (path) => { touched.push(path); return []; },
  };
  const { registry } = harness({ home: "/srv/home", storage });
  const dispatcher = createOperationDispatcher(registry.operations);
  const answer = await dispatcher.query({
    body: new Uint8Array(),
    context: { authScope: "read", clientId: "phone", connectionId: "phone", signal: new AbortController().signal, clientCapabilities: STARTS },
    envelope: { type: "query", queryId: "browse", operation: PROJECT_START_OPERATIONS.browseRootFolders, payload: {} },
  });
  assert.equal(answer.envelope.ok, false);
  assert.equal(answer.envelope.error.code, "forbidden");
  assert.deepEqual(touched, []);
  // The same device with write scope may browse.
  const allowed = await dispatcher.query({
    body: new Uint8Array(),
    context: { authScope: "write", clientId: "phone", connectionId: "phone", signal: new AbortController().signal, clientCapabilities: STARTS },
    envelope: { type: "query", queryId: "browse-2", operation: PROJECT_START_OPERATIONS.browseRootFolders, payload: {} },
  });
  assert.equal(allowed.envelope.ok, true);
});

test("a project-claimed connection cannot browse the server's folders", async () => {
  const { query } = harness();
  await refused(query(PROJECT_START_OPERATIONS.browseRootFolders, {}, { claims: { projectId: "project-a" } }), "forbidden");
});

// --- 3.7 rooted features refuse a project with no root ------------------------

test("files, Git, watch, and Documentation operations refuse a project with no root", async () => {
  const { workspace, registry, viewId } = harness();
  registry.applyHostCommand("a", { type: "project.create", projectId: "no-root", viewId, root: "", rootOrigin: "none" });
  registry.applyHostCommand("b", { type: "project.create", projectId: "rooted", viewId, root: "/srv/rooted" });
  const reached = [];
  const handler = (name) => (request) => { reached.push([name, request.envelope.payload.projectId]); return { ok: true }; };
  const operations = ["files.list", "file.read", "files.watch.start", "git.status", "worktree.list", "documentation.catalog", "docs.list", "mdx.compile", "language.open"];
  const guarded = refuseRootlessProjectOperations({
    queries: new Map([...operations.map((name) => [name, handler(name)]), ["terminal.list", handler("terminal.list")]]),
    commands: new Map([["git.commit", handler("git.commit")]]),
  }, () => workspace.state);
  const request = (operation, projectId) => ({ body: new Uint8Array(), context: {}, envelope: { operation, payload: { projectId } } });
  for (const operation of operations) {
    assert.equal(isRootedProjectOperation(operation), true, operation);
    assert.throws(() => guarded.queries.get(operation)(request(operation, "no-root")), (error) => error.code === "conflict" && error.details.reason === "no_project_root");
    guarded.queries.get(operation)(request(operation, "rooted"));
  }
  assert.throws(() => guarded.commands.get("git.commit")(request("git.commit", "no-root")), (error) => error.details.reason === "no_project_root");
  // Terminals are not rooted features: a no-root project still has them.
  assert.equal(isRootedProjectOperation("terminal.list"), false);
  guarded.queries.get("terminal.list")(request("terminal.list", "no-root"));
  assert.deepEqual(reached.map(([name, projectId]) => `${name}:${projectId}`), [...operations.map((name) => `${name}:rooted`), "terminal.list:no-root"]);
});

// --- 3.4 terminal launch in a no-root project --------------------------------

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const process = { pid: 7300 + processes.length, options, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; } };
      processes.push(process);
      return process;
    },
  };
}
const system = { id: "system", name: "System default", target: { kind: "executable", executable: "/bin/sh" }, args: [], startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true } };
const profiles = (cwdPolicy = "project") => ({
  catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy, entries: [system], projectReferences: {} }),
  resolveProfile: async (_id, catalogue) => ({ profile: system, definition: system, settingsRevision: catalogue.settingsRevision, target: system.target }),
});

function composed(cwdPolicy) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const pty = createPtyFactory();
  const DIRECTORIES = new Set(["/srv/home", "/srv/explicit"]);
  const composition = createServerCoreComposition({
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: pty,
    workspace,
    terminalProfiles: profiles(cwdPolicy),
    terminalLaunchPathAuthority: { canonicalDirectory: async (value) => (DIRECTORIES.has(value) ? value : null), homeDirectory: async () => "/srv/home", isRoot: (value) => value === "/" },
  });
  const context = { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, clientCapabilities: STARTS };
  const run = (operation, payload) => composition.operations.commands.get(operation)({ body: new Uint8Array(), context, envelope: { commandId: `k-${++serial}`, operation, payload } });
  return { workspace, pty, composition, run };
}

test("the first terminal of a home start launches in the verified home, and so does the next", async () => {
  for (const cwdPolicy of ["project", "current"]) {
    const { workspace, pty, composition, run } = composed(cwdPolicy);
    try {
      assert.equal(composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.projectStartChoice), true);
      await run(WORKSPACE_OPERATIONS.command, { command: { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0] } });
      // Waiting for its choice, the project has no terminal to launch.
      await assert.rejects(run("terminal.create", { projectId: "project-a", cols: 80, rows: 24 }), (error) => error.code === "project_awaiting_start" || error.details?.reason === "project_awaiting_start");
      assert.equal(pty.processes.length, 0);
      await run(PROJECT_START_OPERATIONS.start, { projectId: "project-a", choice: { kind: "home" } });
      await run("terminal.create", { projectId: "project-a", cols: 80, rows: 24 });
      await run("terminal.create", { projectId: "project-a", cols: 80, rows: 24 });
      assert.deepEqual(pty.processes.map((process) => process.options.cwd), ["/srv/home", "/srv/home"], cwdPolicy);
      // An explicit working directory still wins.
      await run("terminal.create", { projectId: "project-a", cols: 80, rows: 24, cwd: "/srv/explicit" });
      assert.equal(pty.processes.at(-1).options.cwd, "/srv/explicit");
    } finally {
      await composition.shutdown?.();
    }
  }
});

test("the composed server refuses a rooted feature for a no-root project", async () => {
  const { workspace, composition, run } = composed();
  try {
    await run(WORKSPACE_OPERATIONS.command, { command: { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0] } });
    await run(PROJECT_START_OPERATIONS.start, { projectId: "project-a", choice: { kind: "home" } });
    const dispatcher = createOperationDispatcher(composition.operations);
    // A rooted operation the composition did not register is still unknown,
    // and every registered one is guarded; terminal.list is not rooted.
    const rooted = [...composition.operations.queries.keys()].filter(isRootedProjectOperation);
    for (const operation of rooted) {
      const answer = await dispatcher.query({
        body: new Uint8Array(),
        context: { authScope: "write", clientId: "c", connectionId: "c", signal: new AbortController().signal, clientCapabilities: STARTS },
        envelope: { type: "query", queryId: `r-${++serial}`, operation, payload: { projectId: "project-a" } },
      });
      assert.equal(answer.envelope.ok, false, operation);
      assert.equal(answer.envelope.error.details?.reason, "no_project_root", operation);
    }
  } finally {
    await composition.shutdown?.();
  }
});

// --- 3.5 restore -------------------------------------------------------------

test("restore launches one terminal for the started project and none for the awaiting one", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("restore"));
  const viewId = workspace.state.viewOrder[0];
  const apply = (commandId, command) => assert.equal(workspace.apply({ commandId, command }).ok, true);
  apply("started", { type: "project.create", projectId: "started", viewId, root: tmpdir(), name: "Started" });
  apply("awaiting", { type: "project.create", projectId: "awaiting", viewId, root: "", rootOrigin: "none", start: "awaiting-choice", name: "Awaiting" });
  apply("no-root", { type: "project.create", projectId: "no-root", viewId, root: "", rootOrigin: "none", name: "No root" });
  const requests = [];
  await restoreWorkspaceOnStartup({
    workspace,
    firstRun: false,
    liveSessionCount: () => 0,
    hasSession: () => false,
    createTerminal: async (request) => { requests.push(request); },
  });
  assert.deepEqual(requests.map((request) => request.projectId).sort(), ["no-root", "started"]);
  assert.equal(requests.find((request) => request.projectId === "started").cwd, tmpdir());
  // A no-root project names no folder: its terminal starts in the home.
  assert.equal("cwd" in requests.find((request) => request.projectId === "no-root"), false);
  assert.equal(workspace.state.projects.awaiting.start, "awaiting-choice");
});
