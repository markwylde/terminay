import assert from "node:assert/strict";
import test from "node:test";
import { createServerCoreComposition, FolderRootError, WorkspaceStore, createInitialWorkspace } from "../dist/index.js";

function createPtyFactory({ fail = false } = {}) {
  const processes = [];
  return {
    processes,
    spawn(options) {
      if (fail) throw new Error("spawn failed");
      const process = { pid: 7100 + processes.length, options, write() {}, resize() {}, kill() {}, onData() { return () => {}; }, onExit() { return () => {}; } };
      processes.push(process);
      return process;
    },
  };
}

const system = { id: "system", name: "System default", target: { kind: "executable", executable: "/bin/sh" }, args: [], startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true } };
const profiles = {
  catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy: "current", entries: [system], projectReferences: {} }),
  resolveProfile: async (_id, catalogue) => ({ profile: system, definition: system, settingsRevision: catalogue.settingsRevision, target: system.target }),
};
/** The create handler answers with the session itself or a wrapped result. */
const unwrap = (answer) => answer.result ?? answer;
const DIRECTORIES = new Set(["/project", "/worktree", "/home"]);
const pathAuthority = { canonicalDirectory: async (value) => (DIRECTORIES.has(value) ? value : null), homeDirectory: async () => "/home", isRoot: (value) => value === "/" };

/** One project with General, a linked folder for /worktree, and a plain folder. */
function fixture(options = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const pty = createPtyFactory(options);
  const composition = createServerCoreComposition({
    serverId: "server-a",
    serverVersion: "1.0.0",
    capabilities: [],
    ptyFactory: pty,
    workspace,
    terminalProfiles: profiles,
    terminalLaunchPathAuthority: pathAuthority,
    folderRoots: {
      resolve: async (projectId, folderId) => {
        const folder = workspace.state.folders[folderId];
        if (folder === undefined) throw new FolderRootError("folder_not_found", "missing");
        return { projectId, folderId, root: folder.worktree?.path ?? "/project", worktree: folder.worktree !== undefined };
      },
    },
  });
  const host = (command) => {
    const applied = composition.workspaceOperations.applyHostCommand(`h${workspace.state.revision}`, command);
    assert.equal(applied.ok, true, applied.ok ? "" : applied.conflict.message);
    return applied.event.changedIds.find((id) => workspace.state.folders[id] !== undefined);
  };
  host({ type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: "/project", name: "A" });
  const linked = host({ type: "folder.create", projectId: "project-a", name: "feature", worktree: { repositoryId: "repo", path: "/worktree" } });
  const plain = host({ type: "folder.create", projectId: "project-a", name: "Servers" });
  let serial = 0;
  const create = (payload) =>
    composition.operations.commands.get("terminal.create")({
      body: new Uint8Array(),
      context: { authScope: "write", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal },
      envelope: { commandId: `create-${++serial}`, operation: "terminal.create", payload: { projectId: "project-a", cols: 80, rows: 24, ...payload } },
    });
  const panelOf = (sessionId) => Object.values(workspace.state.panels).find((panel) => panel.type === "terminal" && panel.sessionId === sessionId);
  return { composition, workspace, pty, create, panelOf, host, linked, plain, general: workspace.state.projects["project-a"].folderIds[0] };
}

test("a terminal created in a folder lands in that folder and starts in its root", async () => {
  const { composition, workspace, pty, create, panelOf, linked, plain, general } = fixture();
  try {
    const inLinked = unwrap(await create({ folderId: linked }));
    assert.equal(panelOf(inLinked.sessionId).folderId, linked);
    assert.equal(pty.processes.at(-1).options.cwd, "/worktree");
    assert.deepEqual(workspace.state.folders[linked].panelIds, [panelOf(inLinked.sessionId).id]);

    const inPlain = unwrap(await create({ folderId: plain }));
    assert.equal(panelOf(inPlain.sessionId).folderId, plain);
    assert.equal(pty.processes.at(-1).options.cwd, "/project");

    // No folder named: General, at the project root.
    const inGeneral = unwrap(await create({}));
    assert.equal(panelOf(inGeneral.sessionId).folderId, general);
    assert.equal(pty.processes.at(-1).options.cwd, "/project");
  } finally {
    await composition.shutdown?.();
  }
});

test("a terminal created with no folder launches in General when General is last in the order", async () => {
  const { composition, workspace, pty, create, panelOf, host, linked, plain, general } = fixture();
  try {
    host({ type: "folder.reorder", projectId: "project-a", folderIds: [linked, plain, general] });
    const made = unwrap(await create({}));
    assert.equal(panelOf(made.sessionId).folderId, general);
    assert.equal(pty.processes.at(-1).options.cwd, "/project");
    assert.deepEqual(workspace.state.folders[linked].panelIds, []);
  } finally {
    await composition.shutdown?.();
  }
});

test("a folder of another project is refused before anything is spawned", async () => {
  const { composition, workspace, pty, create } = fixture();
  try {
    composition.workspaceOperations.applyHostCommand("other", { type: "project.create", projectId: "project-b", viewId: workspace.state.viewOrder[0], root: "/project", name: "B" });
    const foreign = workspace.state.projects["project-b"].folderIds[0];
    await assert.rejects(create({ folderId: foreign }));
    await assert.rejects(create({ folderId: "not a folder id" }));
    assert.equal(pty.processes.length, 0);
    assert.equal(Object.keys(workspace.state.panels).length, 0);
  } finally {
    await composition.shutdown?.();
  }
});

test("a spawn that fails leaves no panel and no placement behind", async () => {
  const { composition, workspace, create, linked } = fixture({ fail: true });
  try {
    await assert.rejects(create({ folderId: linked }));
    assert.deepEqual(workspace.state.folders[linked].panelIds, []);
    assert.equal(Object.keys(workspace.state.terminalSessions).length, 0);
  } finally {
    await composition.shutdown?.();
  }
});
