import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  createOperationDispatcher,
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

function decodeTaskBody(response) {
  assert.ok(response.body instanceof Uint8Array);
  return JSON.parse(new TextDecoder().decode(response.body));
}

test("catalog adapter exposes authenticated list, preview, and task queries", async () => {
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": project().context } });
  const page = await adapter.list({ authorization: authorization(), path: "." });
  assert.deepEqual(page.entries.map((entry) => entry.relativePath), ["src", "README.md"]);
  const preview = await adapter.previewMetadata({ authorization: authorization(), path: "README.md" });
  assert.equal(preview.previewKind, "markdown");
  const tasks = decodeTaskBody(await adapter.tasks({ authorization: authorization(), path: "." }));
  assert.equal(tasks.stats.total, 1);
  assert.equal("bytes" in preview, false);
});

test("catalog adapter compacts recursive task responses for protocol transport", async () => {
  const files = new Map([["/project", { isDirectory: true, size: 0 }]]);
  const children = new Map([["/project", []]]);
  const contents = new Map();
  const encoder = new TextEncoder();
  const bigPath = "/project/aaa-big-task-file.md";
  const bigBytes = encoder.encode(`# Big file\n${Array.from({ length: 200 }, (_, index) => `- [${index % 2 === 0 ? " " : "x"}] ${"large section task ".repeat(20)}${index}`).join("\n")}\n`);
  files.set(bigPath, { isFile: true, size: bigBytes.byteLength, mtimeMs: 1 });
  contents.set(bigPath, bigBytes);
  children.get("/project").push({ name: "aaa-big-task-file.md", isFile: true });
  for (let index = 0; index < 1_700; index += 1) {
    const path = `/project/task-${String(index).padStart(4, "0")}.md`;
    const bytes = encoder.encode(`# Heading ${index}\n- [ ] ${"long task label ".repeat(40)}${index}\n`);
    files.set(path, { isFile: true, size: bytes.byteLength, mtimeMs: index });
    contents.set(path, bytes);
    children.get("/project").push({ name: path.slice("/project/".length), isFile: true });
  }
  for (let index = 0; index < 50; index += 1) {
    const path = `/project/notes-${String(index).padStart(4, "0")}.md`;
    const bytes = encoder.encode(`# Notes ${index}\nNo checkboxes here.\n`);
    files.set(path, { isFile: true, size: bytes.byteLength, mtimeMs: index });
    contents.set(path, bytes);
    children.get("/project").push({ name: path.slice("/project/".length), isFile: true });
  }
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (!files.has(path)) throw missing(path); return path; },
    stat(path) { const stat = files.get(path); if (!stat) throw missing(path); return { ...stat, isFile: stat.isFile === true, isDirectory: stat.isDirectory === true }; },
    lstat(path) { if (!files.has(path)) throw missing(path); return { isSymbolicLink: false }; },
    readDirectory(path) { return children.get(path) ?? (() => { throw missing(path); })(); },
    readRange(path, offset, length) { return (contents.get(path) ?? new Uint8Array()).slice(offset, offset + length); },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  const context = { projectId: "project-a", catalog: new FileCatalog(resolver, storage, { maxEntries: 5_000 }) };
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": context } });
  const response = await adapter.tasks({ authorization: authorization(), path: ".", options: { maxTasks: 100_000, maxTaskLabelLength: 4_096 } });
  const tasks = decodeTaskBody(response);
  assert.equal("tree" in tasks, false);
  assert.equal(response.result.contentType, "application/json");
  assert.equal(tasks.truncated, false);
  assert.equal(tasks.tasks.length, 1_900);
  assert.ok(tasks.files.length <= 5_000);
  assert.equal(tasks.files.some((file) => file.tasks.length === 0), false);
  assert.equal(tasks.files.flatMap((file) => file.tasks).length, tasks.tasks.length);
  assert.ok(Buffer.byteLength(JSON.stringify({ type: "query_result", queryId: "query-tasks", ok: true, result: response.result, bodyLength: response.body.byteLength })) < 64 * 1024);
  assert.equal(response.body.byteLength, Buffer.byteLength(JSON.stringify(tasks)));
});

test("catalog adapter task label compaction does not stop sibling directory scans", async () => {
  const encoder = new TextEncoder();
  const contents = new Map([
    ["/project/active/long.md", `# Active\n- [ ] ${"long label ".repeat(40)}\n`],
    ["/project/completed/done.md", "# Done\n- [x] sibling directory task\n"],
  ]);
  const files = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ["/project/active", { isDirectory: true, size: 0 }],
    ["/project/completed", { isDirectory: true, size: 0 }],
    ...[...contents].map(([path, text]) => [path, { isFile: true, size: encoder.encode(text).byteLength, mtimeMs: 1 }]),
  ]);
  const children = new Map([
    ["/project", [{ name: "active", isDirectory: true }, { name: "completed", isDirectory: true }]],
    ["/project/active", [{ name: "long.md", isFile: true }]],
    ["/project/completed", [{ name: "done.md", isFile: true }]],
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (!files.has(path)) throw missing(path); return path; },
    stat(path) { const stat = files.get(path); if (!stat) throw missing(path); return { ...stat, isFile: stat.isFile === true, isDirectory: stat.isDirectory === true }; },
    lstat(path) { if (!files.has(path)) throw missing(path); return { isSymbolicLink: false }; },
    readDirectory(path) { return children.get(path) ?? (() => { throw missing(path); })(); },
    readRange(path, offset, length) { return encoder.encode(contents.get(path) ?? "").slice(offset, offset + length); },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  const context = { projectId: "project-a", catalog: new FileCatalog(resolver, storage) };
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: { "project-a": context } });

  const tasks = decodeTaskBody(await adapter.tasks({ authorization: authorization(), path: ".", options: { maxTaskLabelLength: 16 } }));

  assert.equal(tasks.truncated, true);
  assert.deepEqual(tasks.files.map((file) => file.relativePath), ["active/long.md", "completed/done.md"]);
  assert.deepEqual(tasks.stats, { total: 2, completed: 1, remaining: 1 });
  assert.equal(tasks.scannedFiles, 2);
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

test("files.list reports typed failures, records bounded diagnostics, and recovers on the next refresh", async () => {
  const projectA = project();
  const originalReadDirectory = projectA.storage.readDirectory.bind(projectA.storage);
  let failRead = true;
  projectA.storage.readDirectory = (path) => {
    if (failRead) throw Object.assign(new Error("EACCES /private/project"), { code: "EACCES" });
    return originalReadDirectory(path);
  };
  const diagnostics = [];
  const adapter = new ServerFileCatalogAdapter({
    serverId: "server-a",
    projects: { "project-a": projectA.context },
    onOperationFailure: (failure) => diagnostics.push(failure),
  });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const request = (queryId) => ({
    envelope: { type: "query", queryId, operation: FILE_CATALOG_OPERATIONS.list, payload: { projectId: "project-a", path: "." } },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "admin", signal: new AbortController().signal },
  });

  const failed = await dispatcher.query(request("list-fails"));
  assert.equal(failed.envelope.ok, false);
  assert.deepEqual(failed.envelope.error, {
    code: "internal",
    message: "file operation could not be completed",
    retryable: false,
  });
  assert.deepEqual(diagnostics, [{ operation: "files.list", code: "read_failed" }]);
  assert.equal(JSON.stringify(diagnostics).includes("/private/project"), false);

  failRead = false;
  const recovered = await dispatcher.query(request("list-recovers"));
  assert.equal(recovered.envelope.ok, true);
  assert.deepEqual(recovered.envelope.result.entries.map((entry) => entry.relativePath), ["src", "README.md"]);
});

test("files.list project-scope rejection is actionable instead of a generic query failure", async () => {
  const adapter = new ServerFileCatalogAdapter({ serverId: "server-a", projects: {} });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const result = await dispatcher.query({
    envelope: { type: "query", queryId: "list-unbound-project", operation: FILE_CATALOG_OPERATIONS.list, payload: { projectId: "missing-project", path: "." } },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "admin", signal: new AbortController().signal },
  });
  assert.equal(result.envelope.ok, false);
  assert.deepEqual(result.envelope.error, {
    code: "forbidden",
    message: "file path is outside the authorized project",
    retryable: false,
  });
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
