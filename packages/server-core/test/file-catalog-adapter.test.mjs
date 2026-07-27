import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FILE_CATALOG_OPERATIONS,
  FileCatalog,
  FileServiceError,
  ServerFileCatalogAdapter,
} from "../dist/index.js";

function project() {
  const files = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ["/project/README.md", { isFile: true, size: 19, mtimeMs: 1 }],
    ["/project/src", { isDirectory: true, size: 0 }],
    ["/project/src/app.ts", { isFile: true, size: 5, mtimeMs: 2 }],
  ]);
  const children = new Map([
    ["/project", [{ name: "README.md", isFile: true }, { name: "src", isDirectory: true }]],
    ["/project/src", [{ name: "app.ts", isFile: true }]],
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (!files.has(path)) throw missing(path); return path; },
    stat(path) { const stat = files.get(path); if (!stat) throw missing(path); return { ...stat }; },
    lstat(path) { if (!files.has(path)) throw missing(path); return { isSymbolicLink: false }; },
    readDirectory(path) { return children.get(path) ?? (() => { throw missing(path); })(); },
    readRange(path, offset, length) {
      const bytes = path.endsWith("README.md") ? new TextEncoder().encode("# Tasks\n- [ ] one\n") : new TextEncoder().encode("const x\n");
      return bytes.slice(offset, offset + length);
    },
    atomicWrite(path, bytes) { files.set(path, { isFile: true, size: bytes.byteLength }); },
    makeDirectory(path) { files.set(path, { isDirectory: true, size: 0 }); children.set(path, []); },
    rename(from, to) { const value = files.get(from); if (!value) throw missing(from); files.delete(from); files.set(to, value); },
    remove(path) { files.delete(path); children.delete(path); },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  return { context: { projectId: "project-a", catalog: new FileCatalog(resolver, storage) }, storage };
}

const authorization = (scope = "read", projectId = "project-a", serverId = "server-a") => ({ scope, projectId, serverId });

test("catalog adapter exposes authenticated list, preview, and task queries", async () => {
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context } });
  const page = await adapter.list({ authorization: authorization(), path: "." });
  assert.deepEqual(page.entries.map((entry) => entry.relativePath), ["src", "README.md"]);
  const preview = await adapter.previewMetadata({ authorization: authorization(), path: "README.md" });
  assert.equal(preview.previewKind, "markdown");
  const tasks = await adapter.tasks({ authorization: authorization(), path: "." });
  assert.equal(tasks.stats.total, 1);
  assert.equal("bytes" in preview, false);
});

test("catalog adapter operation handlers keep project authorization in authenticated claims", async () => {
  const projectA = project();
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": projectA.context } });
  const operations = adapter.operations();
  const context = { connectionId: "connection-a", clientId: "client-a", authScope: "read", claims: { projectId: "project-a" }, signal: new AbortController().signal };
  const result = await operations.queries[FILE_CATALOG_OPERATIONS.list]({
    envelope: { type: "query", queryId: "query-list", operation: FILE_CATALOG_OPERATIONS.list, payload: { projectId: "project-a", path: "." } },
    body: new Uint8Array(),
    context,
  });
  assert.equal(result.root, ".");
  await assert.rejects(
    () => adapter.list({ authorization: authorization("read", "project-b"), path: "." }),
    (error) => error instanceof FileServiceError && error.code === "path_escape",
  );
  await assert.rejects(
    () => operations.queries[FILE_CATALOG_OPERATIONS.list]({
      envelope: { type: "query", queryId: "query-cross", operation: FILE_CATALOG_OPERATIONS.list, payload: { projectId: "project-b", path: "." } },
      body: new Uint8Array(),
      context,
    }),
    (error) => error instanceof FileServiceError && error.code === "path_escape",
  );
});

test("catalog adapter commands require write scope and retain bounded body bytes", async () => {
  const projectA = project();
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": projectA.context } });
  await assert.rejects(() => adapter.createDirectory({ authorization: authorization("read"), path: "new" }), (error) => error instanceof FileServiceError && error.code === "path_escape");
  const operations = adapter.operations();
  const result = await operations.commands[FILE_CATALOG_OPERATIONS.createFile]({
    envelope: { type: "command", commandId: "create-1", correlationId: "corr-1", operation: FILE_CATALOG_OPERATIONS.createFile, payload: { path: "created.txt" } },
    body: new TextEncoder().encode("created"),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "write", claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  assert.equal(result, null);
});
