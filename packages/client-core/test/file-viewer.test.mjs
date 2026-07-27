import test from "node:test";
import assert from "node:assert/strict";
import { FileViewerClient, chooseFileViewerMode } from "../dist/index.js";

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
  await assert.rejects(() => client.getCapabilities("archive.bin"), /capability is inconsistent/);
});
