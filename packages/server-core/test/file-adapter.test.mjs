import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FILE_OPERATIONS,
  FileServiceError,
  ServerFileAdapter,
} from "../dist/index.js";

function projectContext(projectId = "project-a") {
  const files = new Map([[`/project/${projectId}/notes.txt`, new TextEncoder().encode("hello world")]]);
  let canonicalRoot = `/project/${projectId}`;
  const pathFor = (path) => path === canonicalRoot ? canonicalRoot : path;
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) {
      if (path === `/project/${projectId}`) return canonicalRoot;
      if (files.has(path)) return pathFor(path);
      throw missing(path);
    },
    stat(path) {
      if (path === canonicalRoot) return { isDirectory: true, size: 0 };
      const bytes = files.get(path);
      if (bytes === undefined) throw missing(path);
      return { isFile: true, size: bytes.byteLength, mode: 0o644, identity: `${bytes.byteLength}` };
    },
    readRange(path, offset, length) { const bytes = files.get(path); if (bytes === undefined) throw missing(path); return bytes.slice(offset, offset + length); },
    readFile(path) { const bytes = files.get(path); if (bytes === undefined) throw missing(path); return bytes.slice(); },
    atomicWrite(path, bytes) { files.set(path, bytes.slice()); },
  };
  return {
    storage,
    files,
    setCanonicalRoot(value) { canonicalRoot = value; },
    context: { projectId, resolver: new CanonicalProjectPathResolver(`/project/${projectId}`, storage), storage },
  };
}

const auth = (scope, projectId = "project-a", serverId = "server-a") => ({ serverId, projectId, scope });

test("file adapter binds metadata, ranged text, edit, atomic save, reload, and keep-local to one project session", async () => {
  const project = projectContext();
  const adapter = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project.context }, maxRangeBytes: 8 });
  const opened = await adapter.open({ authorization: auth("read"), path: "notes.txt" });
  assert.equal(opened.projectId, "project-a");
  assert.equal(opened.relativePath, "notes.txt");
  assert.equal("bytes" in opened.metadata, false);
  assert.equal(opened.metadata.size, 11);

  const range = await adapter.readRange({ authorization: auth("read"), sessionId: opened.sessionId, offset: 0, length: 5 });
  assert.equal(new TextDecoder().decode(range.bytes), "hello");
  const text = await adapter.readText({ authorization: auth("read"), sessionId: opened.sessionId, offset: 6, length: 5 });
  assert.equal(text.text, "world");

  const edited = await adapter.edit({ authorization: auth("write"), sessionId: opened.sessionId, bytes: new TextEncoder().encode("HELLO world"), expectedDraftRevision: 0 });
  assert.equal(edited.ok, true);
  assert.equal((await adapter.metadata({ authorization: auth("read"), sessionId: opened.sessionId })).dirty, true);
  const stale = await adapter.edit({ authorization: auth("write"), sessionId: opened.sessionId, bytes: new TextEncoder().encode("stale"), expectedDraftRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "revision_conflict");

  const saved = await adapter.save({ authorization: auth("write"), sessionId: opened.sessionId, expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.dirty, false);
  assert.equal(new TextDecoder().decode(project.files.get("/project/project-a/notes.txt")), "HELLO world");

  const editedAgain = await adapter.edit({ authorization: auth("write"), sessionId: opened.sessionId, bytes: new TextEncoder().encode("discard me"), expectedDraftRevision: 1 });
  assert.equal(editedAgain.ok, true);
  const declined = await adapter.reload({ authorization: auth("write"), sessionId: opened.sessionId, confirm: false, expectedDiskRevision: 2, expectedDraftRevision: 2 });
  assert.equal(declined.ok, false);
  assert.equal(declined.error.code, "confirmation_required");
  const reloaded = await adapter.reload({ authorization: auth("write"), sessionId: opened.sessionId, confirm: true, expectedDiskRevision: 2, expectedDraftRevision: 2 });
  assert.equal(reloaded.ok, true);
  assert.equal((await adapter.metadata({ authorization: auth("read"), sessionId: opened.sessionId })).dirty, false);

  const local = await adapter.edit({ authorization: auth("write"), sessionId: opened.sessionId, bytes: new TextEncoder().encode("keep me"), expectedDraftRevision: 2 });
  assert.equal(local.ok, true);
  assert.equal((await adapter.keepLocal({ authorization: auth("write"), sessionId: opened.sessionId })).ok, true);
});

test("file adapter rejects traversal, cross-project/server/session identities, and stale canonical replacements", async () => {
  const project = projectContext();
  const adapter = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project.context } });
  await assert.rejects(() => adapter.open({ authorization: auth("read"), path: "../secret" }), (error) => error instanceof FileServiceError && (error.code === "invalid_path" || error.code === "path_escape"));
  const opened = await adapter.open({ authorization: auth("read"), path: "notes.txt" });
  await assert.rejects(() => adapter.metadata({ authorization: { serverId: "server-a", scope: "read" }, sessionId: opened.sessionId }), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => adapter.metadata({ authorization: auth("read", "project-b"), sessionId: opened.sessionId }), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => adapter.metadata({ authorization: auth("read", "project-a", "server-b"), sessionId: opened.sessionId }), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => adapter.metadata({ authorization: { ...auth("read"), sessionId: "other-session" }, sessionId: opened.sessionId }), (error) => error instanceof FileServiceError && error.code === "path_escape");
  project.setCanonicalRoot("/project/project-a-replaced");
  await assert.rejects(() => adapter.metadata({ authorization: auth("read"), sessionId: opened.sessionId }), (error) => error instanceof FileServiceError && (error.code === "revision_conflict" || error.code === "path_missing"));
});

test("file adapter exposes bounded JSON handlers and keeps edit bytes in the protocol body", async () => {
  const project = projectContext();
  const adapter = new ServerFileAdapter({ serverId: "server-a", projects: { "project-a": project.context }, maxRangeBytes: 5 });
  const operations = adapter.operations();
  const signal = new AbortController().signal;
  const context = { connectionId: "connection-a", clientId: "client-a", authScope: "read", claims: { projectId: "project-a" }, signal };
  const opened = await operations.queries[FILE_OPERATIONS.open]({ envelope: { type: "query", queryId: "query-open", operation: FILE_OPERATIONS.open, payload: { projectId: "project-a", path: "notes.txt" } }, body: new Uint8Array(), context });
  assert.equal(opened.projectId, "project-a");
  const metadata = await operations.queries[FILE_OPERATIONS.metadata]({ envelope: { type: "query", queryId: "query-meta", operation: FILE_OPERATIONS.metadata, payload: { sessionId: opened.sessionId } }, body: new Uint8Array(), context });
  assert.equal(metadata.size, 11);
  const range = await operations.queries[FILE_OPERATIONS.readRange]({ envelope: { type: "query", queryId: "query-range", operation: FILE_OPERATIONS.readRange, payload: { sessionId: opened.sessionId, offset: 0, length: 5 } }, body: new Uint8Array(), context });
  assert.equal(typeof range.bytes, "string");
  const commandContext = { ...context, authScope: "write" };
  const edited = await operations.commands[FILE_OPERATIONS.edit]({ envelope: { type: "command", commandId: "command-edit", correlationId: "correlation-edit", operation: FILE_OPERATIONS.edit, payload: { sessionId: opened.sessionId, expectedDraftRevision: 0 } }, body: new TextEncoder().encode("protocol edit"), context: commandContext });
  assert.equal(edited.ok, true);
});
