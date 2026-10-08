import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  createOperationDispatcher,
  FILE_CATALOG_OPERATIONS,
  FileCatalog,
  FileServiceError,
  FolderRootError,
  ServerFileCatalogAdapter,
} from "../dist/index.js";

/** An in-memory root holding the named files. */
function root(base, names) {
  const files = new Map([[base, { isDirectory: true, size: 0 }]]);
  const entries = [];
  for (const name of names) {
    files.set(`${base}/${name}`, { isFile: true, size: 1, mtimeMs: 1 });
    entries.push({ name, isFile: true });
  }
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (!files.has(path)) throw missing(path); return path; },
    stat(path) { const stat = files.get(path); if (!stat) throw missing(path); return { ...stat }; },
    lstat(path) { if (!files.has(path)) throw missing(path); return { isSymbolicLink: false }; },
    readDirectory(path) { if (path !== base) throw missing(path); return entries; },
    readRange() { return new Uint8Array(); },
    atomicWrite(path, bytes) { files.set(path, { isFile: true, size: bytes?.byteLength ?? 0 }); entries.push({ name: path.split("/").at(-1), isFile: true }); },
    makeDirectory() {},
    rename() {},
    remove() {},
  };
  return { context: { projectId: "project-a", catalog: new FileCatalog(new CanonicalProjectPathResolver(base, storage), storage) }, files };
}
const project = () => root("/project", ["README.md"]);
/** Stands in for a linked folder's worktree. */
const worktree = () => root("/worktree", ["feature.ts"]);
const authorization = (scope = "read", projectId = "project-a", serverId = "server-a") => ({ scope, projectId, serverId });
const names = (page) => page.entries.map((entry) => entry.relativePath);

test("a request naming a folder runs in the root the server resolves for it, once per operation", async () => {
  const linked = worktree();
  const resolved = [];
  const adapter = new ServerFileCatalogAdapter({
    serverId: "server-a",
    projects: { "project-a": project().context },
    folderScope: async (projectId, folderId) => { resolved.push([projectId, folderId]); return linked.context; },
  });
  assert.deepEqual(names(await adapter.list({ authorization: authorization(), folderId: "folder:r3", path: "." })), ["feature.ts"]);
  // Without a folder the same project still lists its own root.
  assert.deepEqual(names(await adapter.list({ authorization: authorization(), path: "." })), ["README.md"]);
  await adapter.createFile({ authorization: authorization("write"), folderId: "folder:r3", path: "new.ts", bytes: new Uint8Array([1]) });
  assert.equal(linked.files.has("/worktree/new.ts"), true);
  assert.deepEqual(resolved, [["project-a", "folder:r3"], ["project-a", "folder:r3"]]);
});

test("the folder id travels in the protocol payload and is bounded", async () => {
  const linked = worktree();
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => linked.context });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const context = { authScope: "read", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, claims: { projectId: "project-a" } };
  let serial = 0;
  const query = (payload) => dispatcher.query({ body: new Uint8Array(), context, envelope: { type: "query", queryId: `q${++serial}`, operation: FILE_CATALOG_OPERATIONS.list, payload } });
  const listed = await query({ projectId: "project-a", folderId: "folder:r3", path: "." });
  assert.equal(listed.envelope.ok, true);
  assert.deepEqual(names(listed.envelope.result), ["feature.ts"]);
  for (const folderId of ["../etc", "", "x".repeat(129), 7]) {
    const refused = await query({ projectId: "project-a", folderId, path: "." });
    assert.equal(refused.envelope.ok, false);
  }
});

test("a folder cannot widen the project scope or stand in for a failed resolution", async () => {
  const linked = worktree();
  let calls = 0;
  const scoped = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => { calls += 1; return linked.context; } });
  // Another project's claim, or too little scope, is refused before the folder is looked at.
  await assert.rejects(scoped.list({ authorization: authorization("read", "project-b"), projectId: "project-a", folderId: "folder:r3", path: "." }), /outside the authorized project/);
  await assert.rejects(scoped.createFile({ authorization: authorization("read"), folderId: "folder:r3", path: "x.ts", bytes: new Uint8Array() }), /requires write scope/);
  assert.equal(calls, 0);

  const fails = (adapter, code) => assert.rejects(adapter.list({ authorization: authorization(), folderId: "folder:r3", path: "." }), (error) => error instanceof FileServiceError && error.code === code);
  // A server that does not scope by folder refuses; it never falls back to the project root.
  await fails(new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context } }), "path_escape");
  for (const [code, expected] of [["folder_not_found", "path_escape"], ["folder_outside_project", "path_escape"], ["folder_worktree_unregistered", "path_missing"], ["folder_root_unavailable", "path_missing"]])
    await fails(new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => { throw new FolderRootError(code, "resolution failed"); } }), expected);
  // A context for a different project is refused even if the resolver returns it.
  await fails(new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => ({ ...linked.context, projectId: "project-b" }) }), "path_escape");
});
