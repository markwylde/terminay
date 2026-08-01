import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FILE_CONTENT_OPERATIONS,
  FileContentStreamService,
  FileContentError,
  ServerFileContentAdapter,
} from "../dist/index.js";

function contentProject() {
  const bytes = new Map([
    ["/project/README.md", new TextEncoder().encode("# Hello\n")],
    ["/project/blob.bin", new Uint8Array([0, 1, 2, 3])],
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (path !== "/project" && !bytes.has(path)) throw missing(path); return path; },
    stat(path) { if (path === "/project") return { isDirectory: true, size: 0 }; const value = bytes.get(path); if (!value) throw missing(path); return { isFile: true, size: value.byteLength }; },
    readRange(path, offset, length) { const value = bytes.get(path); if (!value) throw missing(path); return value.slice(offset, offset + length); },
  };
  const content = new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: 8, maxPreviewBytes: 32 });
  return { projectId: "project-a", content };
}

const authorization = (scope = "read", projectId = "project-a", serverId = "server-a") => ({ scope, projectId, serverId });

test("content adapter exposes bounded JSON-safe capabilities, ranges, HEX, and previews", async () => {
  const adapter = new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": contentProject() } });
  const capabilities = await adapter.capabilities({ authorization: authorization(), path: "README.md" });
  assert.equal(capabilities.kind, "markdown");
  assert.equal("bytes" in capabilities, false);
  const range = await adapter.readRange({ authorization: authorization(), path: "README.md", offset: 0, length: 4 });
  assert.equal(range.result.bodyLength, 4);
  assert.deepEqual([...range.body], [...new TextEncoder().encode("# He")]);
  const text = await adapter.readText({ authorization: authorization(), path: "README.md", offset: 0, length: 4 });
  assert.equal(text.text, "# He");
  const hex = await adapter.readHex({ authorization: authorization(), path: "blob.bin", offset: 0, length: 4, bytesPerRow: 2 });
  assert.deepEqual(hex.rows.map((row) => row.hex), ["00 01", "02 03"]);
  const preview = await adapter.readPreview({ authorization: authorization(), path: "README.md" });
  assert.equal(preview.kind, "markdown");
  assert.equal(typeof preview.bytes, "string");
  const metadata = await adapter.textMetadata({ authorization: authorization(), path: "README.md" });
  assert.deepEqual({ path: metadata.path, indexed: metadata.indexedByteLength, lines: metadata.lineCount, complete: metadata.isComplete }, { path: "README.md", indexed: 8, lines: 2, complete: true });
});

test("content adapter binds operations to authenticated project claims and propagates cancellation", async () => {
  const project = contentProject();
  const adapter = new ServerFileContentAdapter({ serverId: "server-a", projects: { "project-a": project } });
  await assert.rejects(() => adapter.readRange({ authorization: authorization("read", "project-b"), path: "README.md", offset: 0, length: 1 }), (error) => error instanceof FileContentError);
  const operations = adapter.operations();
  const context = { connectionId: "connection-a", clientId: "client-a", authScope: "read", claims: { projectId: "project-a" }, signal: new AbortController().signal };
  const result = await operations.queries[FILE_CONTENT_OPERATIONS.readText]({
    envelope: { type: "query", queryId: "query-text", operation: FILE_CONTENT_OPERATIONS.readText, payload: { path: "README.md", offset: 0, length: 4 } },
    body: new Uint8Array(),
    context,
  });
  assert.equal(result.text, "# He");
  const metadata = await operations.queries[FILE_CONTENT_OPERATIONS.textMetadata]({
    envelope: { type: "query", queryId: "query-text-index", operation: FILE_CONTENT_OPERATIONS.textMetadata, payload: { path: "README.md" } },
    body: new Uint8Array(), context,
  });
  assert.equal(metadata.path, "README.md");
  const lines = await operations.queries[FILE_CONTENT_OPERATIONS.textLines]({
    envelope: { type: "query", queryId: "query-text-lines", operation: FILE_CONTENT_OPERATIONS.textLines, payload: { path: "README.md", startLine: 0, lineCount: 2 } },
    body: new Uint8Array(), context,
  });
  assert.deepEqual(lines.lines.map((line) => [line.start, line.end, line.text, line.eol]), [
    [0, 7, "# Hello", "\n"],
    [8, 8, "", ""],
  ]);
  assert.equal(lines.windowComplete, true);
  await assert.rejects(() => operations.queries[FILE_CONTENT_OPERATIONS.textMetadata]({
    envelope: { type: "query", queryId: "query-cross-project", operation: FILE_CONTENT_OPERATIONS.textMetadata, payload: { projectId: "project-b", path: "README.md" } },
    body: new Uint8Array(), context,
  }), /authorized project/u);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => operations.queries[FILE_CONTENT_OPERATIONS.readRange]({
    envelope: { type: "query", queryId: "query-abort", operation: FILE_CONTENT_OPERATIONS.readRange, payload: { path: "README.md", offset: 0, length: 1 } },
    body: new Uint8Array(),
    context: { ...context, signal: controller.signal },
  }), /aborted/i);
});
