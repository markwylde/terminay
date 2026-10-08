import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileWorkspaceStateBackend, WorkspaceRepository, WorkspaceStore, createInitialWorkspace, WORKSPACE_SCHEMA_VERSION } from "../dist/index.js";

/** A workspace as a schema 5 server stored it: one project, one terminal. */
function schema5(projectName) {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-a", viewId: store.state.viewOrder[0], root: "/tmp/a", name: projectName } });
  store.apply({ commandId: "terminal", command: { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", createdAt: 1 } });
  const state = structuredClone(store.state);
  for (const project of Object.values(state.projects)) delete project.folderIds;
  for (const panel of Object.values(state.panels)) delete panel.folderId;
  delete state.folders;
  state.schemaVersion = 5;
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function withStateFile(run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-upgrade-"));
  try {
    await run(join(directory, "workspace.json"), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const open = (path) => new WorkspaceRepository(new FileWorkspaceStateBackend(path), "server-a", () => createInitialWorkspace("server-a"));

test("the stored workspace is kept aside, byte for byte, before a schema upgrade rewrites it", async () => {
  await withStateFile(async (path) => {
    const stored = schema5("Before");
    await writeFile(path, stored);
    const state = await open(path).load();
    assert.equal(state.schemaVersion, WORKSPACE_SCHEMA_VERSION);
    assert.equal(await readFile(`${path}.schema-5.backup`, "utf8"), stored);
    assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, WORKSPACE_SCHEMA_VERSION);
  });
});

test("a later start, or a later upgrade from the same schema, never replaces the kept copy", async () => {
  await withStateFile(async (path) => {
    const first = schema5("First");
    await writeFile(path, first);
    await open(path).load();
    // An ordinary restart on the upgraded file keeps nothing new.
    await open(path).load();
    assert.equal(await readFile(`${path}.schema-5.backup`, "utf8"), first);
    // Even if a schema 5 file is put back and upgraded again.
    await writeFile(path, schema5("Second"));
    await open(path).load();
    assert.equal(await readFile(`${path}.schema-5.backup`, "utf8"), first);
  });
});

test("a fresh server and a current-schema workspace keep no copy", async () => {
  await withStateFile(async (path, directory) => {
    await open(path).load();
    await open(path).load();
    assert.deepEqual(await readdir(directory), ["workspace.json"]);
  });
});

test("an upgrade is not written when the stored workspace cannot be kept aside", async () => {
  await withStateFile(async (path) => {
    const stored = schema5("Before");
    await writeFile(path, stored);
    const backend = new FileWorkspaceStateBackend(path);
    backend.preserveBeforeUpgrade = async () => {
      throw new Error("disk full");
    };
    const repository = new WorkspaceRepository(backend, "server-a");
    await assert.rejects(repository.load(), (error) => error.code === "persistence_uncommittable");
    assert.equal(await readFile(path, "utf8"), stored);
  });
});
