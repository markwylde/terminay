import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  createOperationDispatcher,
  FILE_CONTENT_OPERATIONS,
  FileContentStreamService,
  FileServiceError,
  FolderRootError,
  ServerFileContentAdapter,
} from "../dist/index.js";

/** An in-memory root holding `README.md` with the given text. */
function root(base, text, projectId = "project-a") {
  const bytes = new Map([[`${base}/README.md`, new TextEncoder().encode(text)]]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (path !== base && !bytes.has(path)) throw missing(path); return path; },
    stat(path) { if (path === base) return { isDirectory: true, size: 0 }; const value = bytes.get(path); if (!value) throw missing(path); return { isFile: true, size: value.byteLength }; },
    readRange(path, offset, length) { const value = bytes.get(path); if (!value) throw missing(path); return value.slice(offset, offset + length); },
  };
  return { projectId, content: new FileContentStreamService(new CanonicalProjectPathResolver(base, storage), storage, { maxRangeBytes: 64, maxPreviewBytes: 64 }) };
}
const project = () => root("/project", "# Project\n");
/** Stands in for a linked folder's worktree. */
const worktree = () => root("/worktree", "# Worktree\nsecond\n");
const authorization = (scope = "read", projectId = "project-a", serverId = "server-a") => ({ scope, projectId, serverId });
const decode = (bytes) => new TextDecoder().decode(bytes);

test("a request naming a folder reads the root the server resolves for it, once per operation", async () => {
  const linked = worktree();
  const resolved = [];
  const adapter = new ServerFileContentAdapter({
    serverId: "server-a",
    projects: { "project-a": project() },
    folderScope: async (projectId, folderId) => { resolved.push([projectId, folderId]); return linked; },
  });
  const inFolder = { authorization: authorization(), folderId: "folder:r3", path: "README.md" };
  const inProject = { authorization: authorization(), path: "README.md" };
  assert.equal((await adapter.readText({ ...inFolder, offset: 0, length: 64 })).text, "# Worktree\nsecond\n");
  // Without a folder the same path is still the project root's file.
  assert.equal((await adapter.readText({ ...inProject, offset: 0, length: 64 })).text, "# Project\n");
  assert.equal(decode((await adapter.readRange({ ...inFolder, offset: 2, length: 8 })).body), "Worktree");
  assert.equal((await adapter.capabilities(inFolder)).size, 18);
  assert.equal((await adapter.readHex({ ...inFolder, offset: 0, length: 1 })).rows[0].hex, "23");
  assert.equal(decode(Uint8Array.from(atob((await adapter.readPreview(inFolder)).bytes), (character) => character.charCodeAt(0))), "# Worktree\nsecond\n");
  // The line index of one root never answers for the same path in another.
  assert.equal((await adapter.textMetadata(inProject)).lineCount, 2);
  assert.equal((await adapter.textMetadata(inFolder)).lineCount, 3);
  assert.deepEqual((await adapter.textLines({ ...inFolder, startLine: 0, lineCount: 2 })).lines.map((line) => line.text), ["# Worktree", "second"]);
  assert.deepEqual((await adapter.textLines({ ...inProject, startLine: 0, lineCount: 1 })).lines.map((line) => line.text), ["# Project"]);
  assert.deepEqual(resolved, Array.from({ length: 7 }, () => ["project-a", "folder:r3"]));
});

test("the folder id travels in the protocol payload and is bounded", async () => {
  const adapter = new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project() }, folderScope: async () => worktree() });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const context = { authScope: "read", clientId: "client-a", connectionId: "connection-a", signal: new AbortController().signal, claims: { projectId: "project-a" } };
  let serial = 0;
  const query = (payload) => dispatcher.query({ body: new Uint8Array(), context, envelope: { type: "query", queryId: `q${++serial}`, operation: FILE_CONTENT_OPERATIONS.readText, payload } });
  const read = await query({ projectId: "project-a", folderId: "folder:r3", path: "README.md", offset: 0, length: 10 });
  assert.equal(read.envelope.ok, true);
  assert.equal(read.envelope.result.text, "# Worktree");
  assert.equal((await query({ projectId: "project-a", path: "README.md", offset: 0, length: 9 })).envelope.result.text, "# Project");
  for (const folderId of ["../etc", "", "x".repeat(129), 7]) {
    const refused = await query({ projectId: "project-a", folderId, path: "README.md", offset: 0, length: 10 });
    assert.equal(refused.envelope.ok, false);
  }
});

test("a folder cannot widen the project scope or stand in for a failed resolution", async () => {
  const linked = worktree();
  let calls = 0;
  const scoped = new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project() }, folderScope: async () => { calls += 1; return linked; } });
  // Another project's claim, or too little scope, is refused before the folder is looked at.
  await assert.rejects(scoped.readPreview({ authorization: authorization("read", "project-b"), projectId: "project-a", folderId: "folder:r3", path: "README.md" }), /outside the authorized project/);
  await assert.rejects(scoped.readPreview({ authorization: authorization("none"), folderId: "folder:r3", path: "README.md" }), /requires read scope/);
  await assert.rejects(scoped.textMetadata({ authorization: authorization("none"), folderId: "folder:r3", path: "README.md" }), /requires read scope/);
  assert.equal(calls, 0);

  const fails = async (adapter, code) => {
    const refused = (error) => error instanceof FileServiceError && error.code === code;
    await assert.rejects(adapter.readPreview({ authorization: authorization(), folderId: "folder:r3", path: "README.md" }), refused);
    await assert.rejects(adapter.textMetadata({ authorization: authorization(), folderId: "folder:r3", path: "README.md" }), refused);
  };
  // A server that does not scope by folder refuses; it never falls back to the project root.
  await fails(new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project() } }), "path_escape");
  for (const [code, expected] of [["folder_not_found", "path_escape"], ["folder_outside_project", "path_escape"], ["folder_worktree_unregistered", "path_missing"], ["folder_root_unavailable", "path_missing"]])
    await fails(new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project() }, folderScope: async () => { throw new FolderRootError(code, "resolution failed"); } }), expected);
  // A context for a different project is refused even if the resolver returns it.
  await fails(new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project() }, folderScope: async () => ({ ...linked, projectId: "project-b" }) }), "path_escape");
});
