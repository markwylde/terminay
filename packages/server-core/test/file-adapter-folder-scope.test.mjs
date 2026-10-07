import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  createOperationDispatcher,
  FILE_OPERATIONS,
  FileServiceError,
  FolderRootError,
  ServerFileAdapter,
} from "../dist/index.js";

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);

/** An in-memory root holding `notes.txt` with the given text. */
function root(base, text, projectId = "project-a") {
  const files = new Map([[`${base}/notes.txt`, encode(text)]]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (path !== base && !files.has(path)) throw missing(path); return path; },
    stat(path) {
      if (path === base) return { isDirectory: true, size: 0 };
      const bytes = files.get(path);
      if (bytes === undefined) throw missing(path);
      return { isFile: true, size: bytes.byteLength, mode: 0o644, identity: `${bytes.byteLength}` };
    },
    readRange(path, offset, length) { const bytes = files.get(path); if (bytes === undefined) throw missing(path); return bytes.slice(offset, offset + length); },
    readFile(path) { const bytes = files.get(path); if (bytes === undefined) throw missing(path); return bytes.slice(); },
    atomicWrite(path, bytes) { files.set(path, bytes.slice()); },
  };
  return { files, context: { projectId, resolver: new CanonicalProjectPathResolver(base, storage), storage } };
}
const project = () => root("/project", "project text");
/** Stands in for a linked folder's worktree. */
const worktree = () => root("/worktree", "worktree text");
const auth = (scope = "read", projectId = "project-a", serverId = "server-a") => ({ scope, projectId, serverId });
const text = async (adapter, sessionId) => (await adapter.readText({ authorization: auth(), sessionId, offset: 0, length: 64 })).text;

test("a file opened in a folder is the folder root's file, and its session stays in that folder", async () => {
  const main = project();
  const linked = worktree();
  const resolved = [];
  const adapter = new ServerFileAdapter({
    serverId: "server-a",
    projects: { "project-a": main.context },
    folderScope: async (projectId, folderId) => { resolved.push([projectId, folderId]); return linked.context; },
  });
  const inFolder = await adapter.open({ authorization: auth(), folderId: "folder:r3", path: "notes.txt" });
  assert.equal(inFolder.folderId, "folder:r3");
  assert.equal(inFolder.relativePath, "notes.txt");
  // Without a folder the same relative path is the project root's file, in its own session.
  const inProject = await adapter.open({ authorization: auth(), path: "notes.txt" });
  assert.equal("folderId" in inProject, false);
  assert.notEqual(inProject.sessionId, inFolder.sessionId);
  assert.equal(adapter.size, 2);
  assert.equal(await text(adapter, inFolder.sessionId), "worktree text");
  assert.equal(await text(adapter, inProject.sessionId), "project text");

  // Later operations name only the session, and still run in the folder.
  const edited = await adapter.edit({ authorization: auth("write"), sessionId: inFolder.sessionId, bytes: encode("worktree edit"), expectedDraftRevision: 0 });
  assert.equal(edited.ok, true);
  assert.equal((await adapter.save({ authorization: auth("write"), sessionId: inFolder.sessionId })).ok, true);
  assert.equal(decode(linked.files.get("/worktree/notes.txt")), "worktree edit");
  assert.equal(decode(main.files.get("/project/notes.txt")), "project text");
  assert.equal((await adapter.metadata({ authorization: auth(), sessionId: inProject.sessionId })).dirty, false);

  // Opening it again returns the same session, resolving the folder once more and no more.
  const again = await adapter.open({ authorization: auth(), folderId: "folder:r3", path: "notes.txt" });
  assert.equal(again.sessionId, inFolder.sessionId);
  // open, read, edit, save, open: one resolution each. The project session's operations resolve nothing.
  assert.deepEqual(resolved, Array.from({ length: 5 }, () => ["project-a", "folder:r3"]));

  assert.equal((await adapter.close({ authorization: auth("write"), sessionId: inFolder.sessionId })).ok, true);
  assert.equal(adapter.size, 1);
  assert.equal(await text(adapter, inProject.sessionId), "project text");
});

test("the same relative path opened in two folders is two sessions", async () => {
  const roots = { "folder:a": root("/worktree-a", "a text"), "folder:b": root("/worktree-b", "b text") };
  const adapter = new ServerFileAdapter({
    serverId: "server-a",
    projects: { "project-a": project().context },
    // Derived from the canonical path, as a host-supplied generator is.
    generateSessionId: (_projectId, canonicalPath) => `session:${canonicalPath.replaceAll("/", ".")}`,
    folderScope: async (_projectId, folderId) => roots[folderId].context,
  });
  const a = await adapter.open({ authorization: auth(), folderId: "folder:a", path: "notes.txt" });
  const b = await adapter.open({ authorization: auth(), folderId: "folder:b", path: "notes.txt" });
  const main = await adapter.open({ authorization: auth(), path: "notes.txt" });
  assert.equal(new Set([a.sessionId, b.sessionId, main.sessionId]).size, 3);
  assert.equal(await text(adapter, a.sessionId), "a text");
  assert.equal(await text(adapter, b.sessionId), "b text");
  assert.equal(await text(adapter, main.sessionId), "project text");
});

test("a folder session fails closed once its folder no longer resolves to the root it was opened in", async () => {
  const main = project();
  const linked = worktree();
  let resolve = async () => linked.context;
  const adapter = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": main.context }, folderScope: (...input) => resolve(...input) });
  const opened = await adapter.open({ authorization: auth(), folderId: "folder:r3", path: "notes.txt" });
  await adapter.edit({ authorization: auth("write"), sessionId: opened.sessionId, bytes: encode("draft") });
  const save = () => adapter.save({ authorization: auth("write"), sessionId: opened.sessionId });
  const code = (expected) => (error) => error instanceof FileServiceError && error.code === expected;

  resolve = async () => { throw new FolderRootError("folder_worktree_unregistered", "gone"); };
  await assert.rejects(save, code("path_missing"));
  // A folder now pointing at another root is not the file the session holds.
  resolve = async () => main.context;
  await assert.rejects(save, code("revision_conflict"));
  assert.equal(decode(main.files.get("/project/notes.txt")), "project text");
  assert.equal(decode(linked.files.get("/worktree/notes.txt")), "worktree text");

  resolve = async () => linked.context;
  assert.equal((await save()).ok, true);
  assert.equal(decode(linked.files.get("/worktree/notes.txt")), "draft");
});

test("the folder id travels in the open payload and is bounded", async () => {
  const adapter = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => worktree().context });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const context = { authScope: "read", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, claims: { projectId: "project-a" } };
  let serial = 0;
  const query = (operation, payload) => dispatcher.query({ body: new Uint8Array(), context, envelope: { type: "query", queryId: `q${++serial}`, operation, payload } });
  const opened = await query(FILE_OPERATIONS.open, { projectId: "project-a", folderId: "folder:r3", path: "notes.txt" });
  assert.equal(opened.envelope.ok, true);
  assert.equal(opened.envelope.result.folderId, "folder:r3");
  const read = await query(FILE_OPERATIONS.readText, { sessionId: opened.envelope.result.sessionId, offset: 0, length: 64 });
  assert.equal(read.envelope.result.text, "worktree text");
  for (const folderId of ["../etc", "", "x".repeat(129), 7]) {
    const refused = await query(FILE_OPERATIONS.open, { projectId: "project-a", folderId, path: "notes.txt" });
    assert.equal(refused.envelope.ok, false);
  }
});

test("a folder cannot widen the project scope or stand in for a failed resolution", async () => {
  const linked = worktree();
  let calls = 0;
  const scoped = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => { calls += 1; return linked.context; } });
  // Another project's claim, or too little scope, is refused before the folder is looked at.
  await assert.rejects(scoped.open({ authorization: auth("read", "project-b"), projectId: "project-a", folderId: "folder:r3", path: "notes.txt" }), /outside the authorized project/);
  await assert.rejects(scoped.open({ authorization: auth("none"), folderId: "folder:r3", path: "notes.txt" }), /requires read scope/);
  assert.equal(calls, 0);
  const opened = await scoped.open({ authorization: auth(), folderId: "folder:r3", path: "notes.txt" });
  assert.equal(calls, 1);
  await assert.rejects(async () => scoped.edit({ authorization: auth("read"), sessionId: opened.sessionId, bytes: encode("x") }), /requires write scope/);
  await assert.rejects(async () => scoped.metadata({ authorization: auth("read", "project-b"), sessionId: opened.sessionId }), /outside the authorized project/);
  assert.equal(calls, 1);

  const fails = (adapter, code) => assert.rejects(adapter.open({ authorization: auth(), folderId: "folder:r3", path: "notes.txt" }), (error) => error instanceof FileServiceError && error.code === code);
  // A server that does not scope by folder refuses; it never falls back to the project root.
  const unscoped = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project().context } });
  await fails(unscoped, "path_escape");
  assert.equal(unscoped.size, 0);
  for (const [code, expected] of [["folder_not_found", "path_escape"], ["folder_outside_project", "path_escape"], ["folder_worktree_unregistered", "path_missing"], ["folder_root_unavailable", "path_missing"]])
    await fails(new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => { throw new FolderRootError(code, "resolution failed"); } }), expected);
  // A context for a different project is refused even if the resolver returns it.
  await fails(new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project().context }, folderScope: async () => ({ ...linked.context, projectId: "project-b" }) }), "path_escape");
});
