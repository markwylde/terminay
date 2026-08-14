import test from "node:test";
import assert from "node:assert/strict";
import { FileViewerClient, chooseFileViewerMode } from "../dist/index.js";

const encode = (bytes) => Buffer.from(bytes).toString("base64");

function capability(overrides = {}) {
  return {
    relativePath: "archive.bin",
    size: 10,
    previewKind: "hex",
    preferredMode: "hex",
    isBinary: true,
    isLargeFile: false,
    safePreview: false,
    canEditText: false,
    canEditHex: true,
    inspectedBytes: 10,
    inspectionTruncated: false,
    ...overrides,
  };
}

test("FileViewerClient consumes server-authorized capability metadata and resolves modes deterministically", async () => {
  const calls = [];
  const transport = {
    async query(operation, payload) {
      calls.push({ operation, payload });
      if (operation === "files.preview-metadata") return capability();
      throw new Error(`unexpected query ${operation}`);
    },
    async command() { return null; },
  };
  const client = new FileViewerClient(transport);
  const capabilities = await client.getCapabilities("archive.bin", "project-a");
  assert.equal(capabilities.preferredMode, "hex");
  assert.deepEqual(calls[0], { operation: "files.preview-metadata", payload: { path: "archive.bin", projectId: "project-a" } });
  assert.deepEqual(chooseFileViewerMode(capabilities, "preview"), { mode: "hex", requestedMode: "preview", reason: "unavailable" });
  assert.deepEqual(chooseFileViewerMode({ ...capability(), preferredMode: "text", canEditText: true }, "diff"), { mode: "text", requestedMode: "diff", reason: "unavailable" });
});

test("FileViewerClient lists a bounded server-authorized folder page", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      return { root: "docs", offset: 0, truncated: false, entries: [{ name: "guide.md", relativePath: "docs/guide.md", kind: "file", isSymbolicLink: false, accessible: true, size: 42, mtimeMs: 1, mode: 33188 }] };
    },
    async command() { return null; },
  });
  const page = await client.listFolder("docs", "project-a");
  assert.equal(page.entries[0].relativePath, "docs/guide.md");
  assert.deepEqual(calls, [{ operation: "files.list", payload: { path: "docs", projectId: "project-a" } }]);
});

test("FileViewerClient rejects unscoped Explorer queries before transport", async () => {
  let transportCalls = 0;
  const client = new FileViewerClient({
    async query() { transportCalls += 1; throw new Error("must not reach transport"); },
    async command() { transportCalls += 1; throw new Error("must not reach transport"); },
  });
  await assert.rejects(() => client.listFolder("docs"), /project id is required/);
  await assert.rejects(() => client.searchFolder("docs", "readme"), /project id is required/);
  await assert.rejects(() => client.createDirectory("docs"), /project id is required/);
  assert.equal(transportCalls, 0);
});

test("FileViewerClient sends canonical catalog mutation commands", async () => {
  const commands = [];
  const client = new FileViewerClient({
    async query() { throw new Error("unexpected query"); },
    async command(operation, payload) { commands.push({ operation, payload }); return null; },
  });
  await client.renameEntry("docs/old.md", "docs/new.md", "project-a");
  await client.deleteEntry("tmp", true, "project-a");
  await client.createDirectory("docs/guides", "project-a");
  assert.deepEqual(commands, [
    { operation: "files.rename", payload: { path: "docs/old.md", destination: "docs/new.md", projectId: "project-a" } },
    { operation: "files.delete", payload: { path: "tmp", recursive: true, projectId: "project-a" } },
    { operation: "files.create-directory", payload: { path: "docs/guides", projectId: "project-a" } },
  ]);
  await assert.rejects(() => client.renameEntry("", "docs/new.md"), /file path/);
});

test("FileViewerClient creates bounded files and searches within an exact project", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      return { root: "src", query: "app", results: [{ name: "App.tsx", relativePath: "src/App.tsx", kind: "file", isSymbolicLink: false, accessible: true, size: 10, score: 4 }], scannedEntries: 3, truncated: false };
    },
    async command(operation, payload) { calls.push({ operation, payload }); return null; },
  });
  await client.createFile("src/new.ts", new TextEncoder().encode("x"), "project-a");
  const result = await client.searchFolder("src", "app", "project-a", { limit: 20 });
  assert.equal(result.results[0].relativePath, "src/App.tsx");
  assert.deepEqual(calls, [
    { operation: "files.create", payload: { path: "src/new.ts", bytesBase64: "eA==", projectId: "project-a" } },
    { operation: "files.search", payload: { path: "src", query: "app", options: { limit: 20 }, projectId: "project-a" } },
  ]);
});

test("FileViewerClient validates bounded session ranges and sends revisioned draft commands", async () => {
  const commands = [];
  const transport = {
    async query(operation) {
      if (operation === "files.open") return { serverId: "server-a", projectId: "project-a", sessionId: "session-1", relativePath: "notes.txt", metadata: { canonicalPath: "/project/notes.txt", diskRevision: 1, draftRevision: 0, dirty: false, conflict: false, watchState: "watching" } };
      if (operation === "files.read-range") return { canonicalPath: "/project/notes.txt", offset: 0, requestedLength: 3, bytes: "YWJj", totalSize: 3, diskRevision: 1, draftRevision: 0, dirty: false, conflict: false };
      throw new Error(`unexpected query ${operation}`);
    },
    async command(operation, payload) { commands.push({ operation, payload }); return { ok: true }; },
  };
  const client = new FileViewerClient(transport);
  const opened = await client.openFile("notes.txt", "project-a");
  assert.equal(opened.sessionId, "session-1");
  assert.deepEqual([...((await client.readSessionRange("session-1", 0, 3)).bytes)], [97, 98, 99]);
  await client.editSession("session-1", "draft", 0);
  await client.saveSession("session-1", 1, 1);
  assert.deepEqual(commands, [
    { operation: "files.edit", payload: { sessionId: "session-1", text: "draft", expectedDraftRevision: 0 } },
    { operation: "files.save", payload: { sessionId: "session-1", expectedDiskRevision: 1, expectedDraftRevision: 1 } },
  ]);
});

test("capability validation rejects an unsafe server snapshot that claims preview support", async () => {
  const client = new FileViewerClient({
    async query() { return capability({ previewKind: "unsupported", safePreview: true }); },
    async command() { return null; },
  });
  await assert.rejects(() => client.getCapabilities("archive.bin", "project-a"), /capability is inconsistent/);
});

test("FileViewerClient streams bounded large-text and binary ranges with resumable offsets", async () => {
  const source = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const calls = [];
  const capabilities = {
    relativePath: "large.log",
    size: source.byteLength,
    kind: "text",
    contentType: "text/plain",
    isLarge: true,
    canPreview: false,
    canText: true,
    canHex: true,
    maxDecodedImagePixels: 16_000_000,
  };
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      if (operation === "files.content-capabilities") return capabilities;
      throw new Error(`unexpected query ${operation}`);
    },
    async queryWithBody(operation, payload) {
      calls.push({ operation, payload });
      if (operation === "files.content-range") {
        const body = source.slice(payload.offset, payload.offset + payload.length);
        return { result: {
          relativePath: "large.log",
          kind: "text",
          contentType: "text/plain",
          offset: payload.offset,
          requestedLength: payload.length,
          bodyLength: body.byteLength,
          totalSize: source.byteLength,
          truncated: body.byteLength < payload.length,
        }, body };
      }
      throw new Error(`unexpected query ${operation}`);
    },
    async command() { return null; },
  });

  const stream = await client.openContentStream("large.log", "project-a", { mode: "range", chunkBytes: 3, maxBytes: 7 });
  const firstChunks = [];
  for await (const chunk of stream.chunks) firstChunks.push(chunk);
  assert.deepEqual(firstChunks.map((chunk) => chunk.offset), [0, 3, 6]);
  assert.deepEqual([...firstChunks.flatMap((chunk) => [...chunk.bytes])], [...source.slice(0, 7)]);
  assert.equal(firstChunks.at(-1).decodedImagePixelLimit, 16_000_000);
  assert.equal(firstChunks.at(-1).streamTruncated, true);
  assert.deepEqual(stream.state, { nextOffset: 7, bytesTransferred: 7, complete: false, truncated: true });

  const resumed = await client.openContentStream("large.log", "project-a", { mode: "range", startOffset: stream.state.nextOffset, chunkBytes: 4, maxBytes: 10 });
  const resumedChunks = [];
  for await (const chunk of resumed.chunks) resumedChunks.push(chunk);
  assert.deepEqual([...resumedChunks.flatMap((chunk) => [...chunk.bytes])], [...source.slice(7)]);
  assert.deepEqual(resumed.state, { nextOffset: source.byteLength, bytesTransferred: 3, complete: true, truncated: false });
  assert.deepEqual(calls.filter((call) => call.operation === "files.content-range").map((call) => call.payload.offset), [0, 3, 6, 7]);
});

test("FileViewerClient exposes capped Markdown, image, and PDF preview assets as chunks", async () => {
  for (const [kind, contentType] of [["markdown", "text/markdown"], ["image", "image/png"], ["pdf", "application/pdf"]]) {
    const calls = [];
    const client = new FileViewerClient({
      async query(operation, payload) {
        calls.push({ operation, payload });
        if (operation === "files.content-capabilities") return {
          relativePath: `asset.${kind}`,
          size: 5,
          kind,
          contentType,
          isLarge: false,
          canPreview: true,
          canText: kind === "markdown",
          canHex: true,
          maxDecodedImagePixels: 12_345,
        };
        if (operation === "files.content-preview") return {
          relativePath: `asset.${kind}`,
          kind,
          contentType,
          offset: 0,
          requestedLength: 5,
          bytes: encode(new Uint8Array([1, 2, 3, 4, 5])),
          totalSize: 5,
          truncated: false,
          decodedImagePixelLimit: 12_345,
        };
        throw new Error(`unexpected query ${operation}`);
      },
      async command() { return null; },
    });

    const stream = await client.openContentStream(`asset.${kind}`, "project-a", { chunkBytes: 2, maxBytes: 5 });
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);
    assert.deepEqual(chunks.map((chunk) => chunk.offset), [0, 2, 4]);
    assert.deepEqual([...chunks.flatMap((chunk) => [...chunk.bytes])], [1, 2, 3, 4, 5]);
    assert.equal(chunks.every((chunk) => chunk.decodedImagePixelLimit === 12_345), true);
    assert.equal(stream.state.complete, true);
    assert.equal(stream.state.truncated, false);
    assert.deepEqual(calls.map((call) => call.operation), ["files.content-capabilities", "files.content-preview"]);

    const resumed = await client.openContentStream(`asset.${kind}`, "project-a", { startOffset: 2, chunkBytes: 2, maxBytes: 3 });
    const resumedChunks = [];
    for await (const chunk of resumed.chunks) resumedChunks.push(chunk);
    assert.deepEqual([...resumedChunks.flatMap((chunk) => [...chunk.bytes])], [3, 4, 5]);
    assert.deepEqual(resumed.state, { nextOffset: 5, bytesTransferred: 3, complete: true, truncated: false });
  }
});

test("FileViewerClient stops a stream when the server returns a non-contiguous range", async () => {
  const client = new FileViewerClient({
    async query(operation) {
      if (operation === "files.content-capabilities") return {
        relativePath: "broken.txt",
        size: 4,
        kind: "text",
        contentType: "text/plain",
        isLarge: false,
        canPreview: false,
        canText: true,
        canHex: true,
        maxDecodedImagePixels: 16_000_000,
      };
      throw new Error(`unexpected query ${operation}`);
    },
    async queryWithBody() {
      const body = new Uint8Array([1, 2]);
      return { result: {
        relativePath: "broken.txt",
        kind: "text",
        contentType: "text/plain",
        offset: 1,
        requestedLength: 2,
        bodyLength: body.byteLength,
        totalSize: 4,
        truncated: false,
      }, body };
    },
    async command() { return null; },
  });
  const stream = await client.openContentStream("broken.txt", "project-a", { mode: "range", chunkBytes: 2, maxBytes: 4 });
  await assert.rejects(async () => {
    for await (const _chunk of stream.chunks) { /* consume */ }
  }, /identity|not contiguous/);
});

test("FileViewerClient cancels before requesting the next content chunk", async () => {
  const controller = new AbortController();
  let rangeRequests = 0;
  const client = new FileViewerClient({
    async query(operation) {
      if (operation === "files.content-capabilities") return {
        relativePath: "cancel.txt",
        size: 4,
        kind: "text",
        contentType: "text/plain",
        isLarge: false,
        canPreview: false,
        canText: true,
        canHex: true,
        maxDecodedImagePixels: 16_000_000,
      };
      rangeRequests += 1;
      return {
        relativePath: "cancel.txt",
        kind: "text",
        contentType: "text/plain",
        offset: 0,
        requestedLength: 2,
        bytes: encode(new Uint8Array([1, 2])),
        totalSize: 4,
        truncated: false,
      };
    },
    async command() { return null; },
  });
  const stream = await client.openContentStream("cancel.txt", "project-a", { mode: "range", chunkBytes: 2, maxBytes: 4, signal: controller.signal });
  controller.abort();
  await assert.rejects(async () => {
    for await (const _chunk of stream.chunks) { /* consume */ }
  }, /aborted/i);
  assert.equal(rangeRequests, 0);
});

test("FileViewerClient queries server-owned folder Markdown task aggregation", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      if (operation !== "files.tasks") throw new Error(`unexpected query ${operation}`);
      return {
        root: "specs",
        files: [{
          relativePath: "specs/tasks.md",
          size: 42,
          mtimeMs: 12,
          sections: [{
            id: "specs/tasks.md:section-0",
            title: "Tasks",
            level: 1,
            tasks: [{
              id: "specs/tasks.md:task-1",
              relativePath: "specs/tasks.md",
              lineNumber: 2,
              label: "move aggregation",
              checked: false,
              depth: 0,
              sectionPath: ["Tasks"],
            }],
            children: [],
          }],
          tasks: [{
            id: "specs/tasks.md:task-1",
            relativePath: "specs/tasks.md",
            lineNumber: 2,
            label: "move aggregation",
            checked: false,
            depth: 0,
            sectionPath: ["Tasks"],
          }],
          stats: { total: 1, completed: 0, remaining: 1 },
          truncated: false,
          invalidEncoding: false,
        }],
        tasks: [{
          id: "specs/tasks.md:task-1",
          relativePath: "specs/tasks.md",
          lineNumber: 2,
          label: "move aggregation",
          checked: false,
          depth: 0,
          sectionPath: ["Tasks"],
        }],
        stats: { total: 1, completed: 0, remaining: 1 },
        scannedEntries: 3,
        scannedFiles: 1,
        readBytes: 42,
        truncated: false,
      };
    },
    async command() { return null; },
  });

  const result = await client.getFolderMarkdownTasks("specs", "project-a", {
    ignoredDirectories: ["node_modules", "dist"],
    maxFiles: 50,
  });
  assert.equal(result.files[0].sections[0].tasks[0].label, "move aggregation");
  assert.deepEqual(calls, [{
    operation: "files.tasks",
    payload: {
      path: "specs",
      projectId: "project-a",
      options: { ignoredDirectories: ["node_modules", "dist"], maxFiles: 50 },
    },
  }]);
  await assert.rejects(() => client.getFolderMarkdownTasks("specs", "project-a", { ignoredDirectories: ["nested/path"] }), /ignored directory is invalid/);
});

test("FileViewerClient accepts folder Markdown task aggregation in a binary query body", async () => {
  const aggregate = {
    root: "specs",
    files: [],
    tasks: [],
    stats: { total: 0, completed: 0, remaining: 0 },
    scannedEntries: 31,
    scannedFiles: 3,
    readBytes: 2048,
    truncated: false,
  };
  const calls = [];
  const client = new FileViewerClient({
    async query() {
      throw new Error("JSON query path should not be used");
    },
    async queryWithBody(operation, payload) {
      calls.push({ operation, payload });
      return {
        result: { contentType: "application/json", bodyLength: JSON.stringify(aggregate).length },
        body: new TextEncoder().encode(JSON.stringify(aggregate)),
      };
    },
    async command() { return null; },
  });

  const result = await client.getFolderMarkdownTasks("specs", "project-a");
  assert.equal(result.scannedEntries, 31);
  assert.equal(result.truncated, false);
  assert.deepEqual(calls, [{
    operation: "files.tasks",
    payload: { path: "specs", projectId: "project-a", options: {} },
  }]);
});
