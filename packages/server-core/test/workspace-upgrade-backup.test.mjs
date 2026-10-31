import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileWorkspaceStateBackend, WorkspaceRepository, WorkspaceStore, createInitialWorkspace, isStateUnreadableError, takeStateRecoveryNotices, WORKSPACE_SCHEMA_VERSION } from "../dist/index.js";

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

// ADR-0088: a commit keeps the last good file as `.previous`, and a corrupt
// workspace falls back to it or stops with a typed, path-free error.
const corruptShapes = (good) => [
  ["zero-filled", Buffer.alloc(Buffer.byteLength(good))],
  ["truncated", good.slice(0, Math.floor(good.length / 2))],
  ["invalid JSON", "{not json"],
];

async function committedTwice(path) {
  const repository = open(path);
  await repository.load();
  const viewId = repository.state.viewOrder[0];
  const result = await repository.apply({ commandId: "p1", command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "Kept" } });
  assert.equal(result.ok, true);
  return readFile(`${path}.previous`, "utf8");
}

test("a corrupt workspace with a good .previous loads that copy, says so once, and keeps the bad file", async () => {
  for (const [shape, bytes] of corruptShapes("x".repeat(400))) {
    await withStateFile(async (path, directory) => {
      const previous = await committedTwice(path);
      takeStateRecoveryNotices();
      await writeFile(path, bytes);
      const state = await open(path).load();
      assert.deepEqual(state.serverId, JSON.parse(previous).serverId, shape);
      assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "restored", store: "workspace" }], shape);
      const names = await readdir(directory);
      assert.equal(names.filter((name) => name.startsWith("workspace.json.corrupt-")).length, 1, shape);
      assert.equal(JSON.parse(await readFile(path, "utf8")).serverId, "server-a", shape);
    });
  }
});

test("a corrupt workspace with no good copy stops as state_unreadable and changes nothing on disk", async () => {
  for (const withPrevious of [false, true]) {
    await withStateFile(async (path, directory) => {
      const zeros = Buffer.alloc(512);
      await writeFile(path, zeros);
      if (withPrevious) await writeFile(`${path}.previous`, zeros);
      const before = (await readdir(directory)).sort();
      await assert.rejects(open(path).load(), (error) => {
        assert.equal(error.code, "persistence_unreadable");
        assert.equal(error.retryable, true);
        assert.equal(error.store, "workspace");
        assert.ok(isStateUnreadableError(error.cause));
        assert.equal(error.cause.store, "workspace");
        assert.equal(error.message.includes(directory), false);
        return true;
      });
      // Retry changes nothing: both files stay exactly where they were.
      assert.deepEqual((await readdir(directory)).sort(), before);
      assert.deepEqual(await readFile(path), zeros);
    });
  }
});

test("a commit refreshes .previous with the last committed workspace", async () => {
  await withStateFile(async (path, directory) => {
    const previous = await committedTwice(path);
    assert.equal(JSON.parse(previous).projects["project-a"], undefined);
    assert.ok(JSON.parse(await readFile(path, "utf8")).projects["project-a"]);
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
  });
});
