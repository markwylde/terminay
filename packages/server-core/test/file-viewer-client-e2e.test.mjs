import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileViewerClient, TerminayClient, TerminayClientFacade } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  CanonicalProjectPathResolver,
  FileCatalog,
  FileContentStreamService,
  ServerFileAdapter,
  ServerFileCatalogAdapter,
  ServerFileContentAdapter,
  createServerCoreComposition,
} from "../dist/index.js";

function createFilesystemStorage() {
  return {
    async realpath(path) { return realpath(path); },
    async stat(path) {
      const value = await stat(path);
      return {
        isDirectory: value.isDirectory(),
        isFile: value.isFile(),
        isSymbolicLink: false,
        size: value.size,
        mtimeMs: value.mtimeMs,
        mode: value.mode,
        identity: `${value.dev}:${value.ino}`,
      };
    },
    async lstat(path) {
      const value = await lstat(path);
      return { isDirectory: value.isDirectory(), isFile: value.isFile(), isSymbolicLink: value.isSymbolicLink() };
    },
    async readDirectory(path) {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
      }));
    },
    async readRange(path, offset, length) {
      const bytes = await readFile(path);
      return new Uint8Array(bytes.subarray(offset, offset + length));
    },
    async readFile(path) { return new Uint8Array(await readFile(path)); },
    async atomicWrite(path, bytes) {
      const temporaryPath = `${path}.terminay-e2e-${process.pid}`;
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, path);
    },
  };
}

function mergeOperationRecords(...records) {
  return records.reduce((merged, record) => ({
    queries: { ...merged.queries, ...record.queries },
    commands: { ...merged.commands, ...record.commands },
  }), { queries: {}, commands: {} });
}

test("file explorer, folder tasks, and FileViewerClient use one TerminayClient server path", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "terminay-file-viewer-e2e-"));
  const docsRoot = join(projectRoot, "docs");
  const nestedDocsRoot = join(docsRoot, "nested");
  await mkdir(docsRoot);
  await mkdir(nestedDocsRoot);
  await writeFile(join(docsRoot, "README.md"), "# Remote files\n- [ ] verify shared viewer\n");
  await writeFile(join(nestedDocsRoot, "tasks.md"), "# Nested tasks\n- [ ] verify recursive aggregation\n");
  await writeFile(join(docsRoot, "guide.txt"), "line one\nline two\n");
  await writeFile(join(projectRoot, "blob.bin"), Uint8Array.from([0, 1, 2, 3, 254, 255]));
  const largeBytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, index) => index % 251);
  await writeFile(join(projectRoot, "large.bin"), largeBytes);

  const storage = createFilesystemStorage();
  const resolver = new CanonicalProjectPathResolver(projectRoot, storage);
  const catalog = new FileCatalog(resolver, storage, { maxPreviewInspectionBytes: 256 });
  const content = new FileContentStreamService(resolver, storage, { maxPreviewBytes: 256, largeFileBytes: 8 });
  const project = { projectId: "project-a", resolver, storage };
  const catalogAdapter = new ServerFileCatalogAdapter({ serverId: "file-e2e-server", projects: { "project-a": { projectId: "project-a", catalog } } });
  const contentAdapter = new ServerFileContentAdapter({ serverId: "file-e2e-server", projects: { "project-a": { projectId: "project-a", content } } });
  const fileAdapter = new ServerFileAdapter({
    serverId: "file-e2e-server",
    projects: { "project-a": project },
    generateSessionId: () => "file-session-e2e",
    maxRangeBytes: 256,
  });
  const adapterOperations = mergeOperationRecords(catalogAdapter.operations(), contentAdapter.operations(), fileAdapter.operations());
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "file-e2e-server",
    serverVersion: "test",
    capabilities: ["files"],
    ptyFactory: { spawn() { throw new Error("PTY is not part of this file test"); } },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write", claims: { projectId: "project-a" } }),
    operations: adapterOperations,
  });
  const pair = createInMemoryTransportPair();
  const connection = composition.core.accept(pair.server);
  const serverTask = connection.start();
  const client = new TerminayClient({ transport: pair.client, clientId: "file-e2e-client", capabilities: ["files"] });
  const facade = new TerminayClientFacade(client);
  const viewer = new FileViewerClient(facade);

  try {
    await pair.open();
    const hello = await client.connect();
    assert.equal(hello.serverId, "file-e2e-server");

    const listing = await viewer.listFolder(".", "project-a");
    assert.deepEqual(listing.entries.map((entry) => entry.relativePath), ["docs", "blob.bin", "large.bin"]);
    const folderTasks = await viewer.getFolderMarkdownTasks("docs", "project-a");
    assert.equal(folderTasks.stats.total, 2);
    assert.deepEqual(folderTasks.files.map((file) => file.relativePath), ["docs/README.md", "docs/nested/tasks.md"]);

    const capabilities = await viewer.getCapabilities("docs/README.md", "project-a");
    assert.equal(capabilities.previewKind, "markdown");
    assert.equal(capabilities.preferredMode, "preview");
    const contentCapabilities = await viewer.getContentCapabilities("docs/README.md", "project-a");
    const stream = await viewer.openContentStream("docs/README.md", "project-a", { mode: "preview", chunkBytes: 7, maxBytes: 256 });
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);
    assert.equal(stream.state.complete, true);
    assert.equal(new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk.bytes]))), "# Remote files\n- [ ] verify shared viewer\n");
    assert.equal(chunks.every((chunk) => chunk.decodedImagePixelLimit === contentCapabilities.maxDecodedImagePixels), true);

    const hex = await viewer.readContentHex("blob.bin", 0, 6, 3, "project-a");
    assert.deepEqual(hex.rows.map((row) => row.hex), ["00 01 02", "03 fe ff"]);
    assert.equal(hex.kind, "binary");
    const largeRange = await viewer.readContentRange("large.bin", 0, largeBytes.byteLength, "project-a");
    assert.equal(largeRange.bytes.byteLength, largeBytes.byteLength);
    assert.deepEqual(largeRange.bytes.subarray(largeRange.bytes.byteLength - 16), largeBytes.subarray(largeBytes.byteLength - 16));

    const session = await viewer.openFile("docs/guide.txt", "project-a");
    const beforeEdit = await viewer.readSessionText(session.sessionId, 0, 256);
    assert.equal(beforeEdit.text, "line one\nline two\n");
    const edited = await viewer.editSession(session.sessionId, "updated through shared client\n", 0);
    assert.equal(edited.ok, true);
    const saved = await viewer.saveSession(session.sessionId, 1, 1);
    assert.equal(saved.ok, true);
    assert.equal(await readFile(join(docsRoot, "guide.txt"), "utf8"), "updated through shared client\n");
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
