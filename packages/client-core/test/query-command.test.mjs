import test from "node:test";
import assert from "node:assert/strict";
import { ClientOperationError, FILE_VIEWER_OPERATIONS, FileViewerClient, SettingsClient, TerminayClientFacade } from "../dist/index.js";

test("TerminayClientFacade adapts query and command envelopes to feature results", async () => {
  const calls = [];
  const facade = new TerminayClientFacade({
    async query(operation, payload) {
      calls.push(["query", operation, payload]);
      return { result: { serverId: "server-a" } };
    },
    async command(operation, payload) {
      calls.push(["command", operation, payload]);
      return { result: { revision: 3 } };
    },
  });
  assert.deepEqual(await facade.query("workspace.snapshot", {}), { serverId: "server-a" });
  assert.deepEqual(await facade.command("workspace.rename", { name: "Editor" }), { revision: 3 });
  assert.deepEqual(calls, [
    ["query", "workspace.snapshot", {}],
    ["command", "workspace.rename", { name: "Editor" }],
  ]);
});

test("TerminayClientFacade retains the failed operation for actionable feature errors", async () => {
  const facade = new TerminayClientFacade({
    async query() { throw new Error("query failed"); },
    async command() { throw new Error("command failed"); },
  });
  await assert.rejects(
    facade.query("files.list", { projectId: "project-1" }),
    (error) => error instanceof ClientOperationError
      && error.kind === "query"
      && error.operation === "files.list"
      && error.message === "query failed",
  );
  await assert.rejects(
    facade.command("settings.update", {}),
    (error) => error instanceof ClientOperationError
      && error.kind === "command"
      && error.operation === "settings.update"
      && error.message === "command failed",
  );
});

test("TerminayClientFacade rejects a query-command-only compatibility transport when an event subscription is requested", async () => {
  const facade = new TerminayClientFacade({
    async query() { return { result: null }; },
    async command() { return { result: null }; },
  });

  assert.throws(
    () => facade.subscribe("settings.changed", () => undefined),
    /canonical event subscriptions are unavailable/,
  );
  await assert.rejects(
    () => facade.subscribeEvents("activity", () => undefined),
    /canonical event subscriptions are unavailable/,
  );
});

test("TerminayClientFacade suppresses rejected pending subscribe after local unsubscribe", async () => {
  const facade = new TerminayClientFacade({
    async query() { return { result: null }; },
    async command() { return { result: null }; },
    async subscribe() {
      throw Object.assign(new Error("client is not connected"), {
        name: "ClientDisconnectedError",
      });
    },
  });

  const unsubscribe = facade.subscribe("workspace.changed", () => undefined);
  unsubscribe();
  await new Promise((resolve) => setImmediate(resolve));
});

test("TerminayClientFacade owns awaited subscriptions, replay gaps, and disposal", async () => {
  const received = [];
  let eventListener;
  let resyncListener;
  let unsubscribed = 0;
  const facade = new TerminayClientFacade({
    async query() { return { result: null }; },
    async command() { return { result: null }; },
    async subscribe(event) {
      assert.equal(event, "activity");
      return {
        id: "subscription-a",
        fromRevision: 0,
        unsubscribe: async () => { unsubscribed += 1; },
        onEvent(listener) { eventListener = listener; return () => { eventListener = undefined; }; },
        onResync(listener) { resyncListener = listener; return () => { resyncListener = undefined; }; },
      };
    },
  });
  let resyncs = 0;
  const close = await facade.subscribeEvents("activity", (payload) => received.push(payload), () => { resyncs += 1; });
  eventListener({ payload: { revision: 1 } });
  resyncListener();
  assert.deepEqual(received, [{ revision: 1 }]);
  assert.equal(resyncs, 1);
  close();
  close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unsubscribed, 1);
  assert.equal(eventListener, undefined);
  assert.equal(resyncListener, undefined);
});

test("FileViewerClient uses a bounded canonical query operation", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push([operation, payload]);
      return { path: payload.path, hunks: [] };
    },
    async command() { return null; },
  });
  assert.deepEqual(await client.getGitDiff("src/App.tsx"), { path: "src/App.tsx", hunks: [] });
  assert.deepEqual(calls, [["file.get-git-diff", { path: "src/App.tsx" }]]);
  await assert.rejects(() => client.getGitDiff(""), /file path/);
  await assert.rejects(() => client.getGitDiff("bad\0path"), /file path/);
});

test("FileViewerClient bounds raw content ranges to the framed response budget", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query() {
      throw new Error("transport marker");
    },
    async queryWithBody(operation, payload) {
      calls.push([operation, payload]);
      throw new Error("transport marker");
    },
    async command() {},
  });
  await assert.rejects(
    client.readContentRange("large.txt", 0, 2 * 1024 * 1024, "project-a"),
    /transport marker/,
  );
  await assert.rejects(
    client.readContentRange("large.txt", 0, 2 * 1024 * 1024 + 1, "project-a"),
    /length/,
  );
  assert.deepEqual(calls, [[
    FILE_VIEWER_OPERATIONS.contentRange,
    { path: "large.txt", offset: 0, length: 2 * 1024 * 1024, projectId: "project-a" },
  ]]);
});

test("FileViewerClient validates binary range metadata against the request and body", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const metadata = { relativePath: "large.txt", kind: "text", contentType: "text/plain", offset: 8, requestedLength: 4, bodyLength: 4, totalSize: 12, truncated: false };
  const client = new FileViewerClient({
    async query() { return null; },
    async queryWithBody() { return { result: metadata, body: bytes }; },
    async command() {},
  });
  assert.deepEqual((await client.readContentRange("large.txt", 8, 4, "project-a")).bytes, bytes);
  const mismatch = new FileViewerClient({
    async query() { return null; },
    async queryWithBody() { return { result: { ...metadata, offset: 7 }, body: bytes }; },
    async command() {},
  });
  await assert.rejects(() => mismatch.readContentRange("large.txt", 8, 4, "project-a"), /identity/);
  const shortBody = new FileViewerClient({
    async query() { return null; },
    async queryWithBody() { return { result: metadata, body: bytes.subarray(0, 3) }; },
    async command() {},
  });
  await assert.rejects(() => shortBody.readContentRange("large.txt", 8, 4, "project-a"), /body/);
});

test("FileViewerClient keeps ranged text metadata and line windows transport-neutral", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "file.text-metadata") return { path: "src/file.txt", indexedByteLength: 12, ino: 4, isComplete: true, lineCount: 2, mtimeMs: 10, size: 12 };
      return { path: "src/file.txt", startLine: 0, lineCount: 2, lines: [{ start: 0, end: 6, lineNumber: 0, text: "first", eol: "\n" }, { start: 6, end: 12, lineNumber: 1, text: "second", eol: "" }] };
    },
    async command() { return null; },
  });
  assert.equal((await client.getServerTextMetadata("src/file.txt", "project-a")).lineCount, 2);
  assert.equal((await client.readTextLines("src/file.txt", "/project", 0, 128)).lines.length, 2);
  assert.deepEqual(calls, [
    ["file.text-metadata", { path: "src/file.txt", projectId: "project-a" }],
    ["file.text-lines", { path: "src/file.txt", projectRoot: "/project", startLine: 0, lineCount: 128 }],
  ]);
  await assert.rejects(() => client.getServerTextMetadata("", "project-a"), /file path/);
  await assert.rejects(() => client.readTextLines("src/file.txt", "/project", 0, 513), /line count/);
});

test("FileViewerClient validates exact server-indexed text windows", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      return {
        indexedByteLength: 19,
        indexComplete: true,
        lineCount: 3,
        lines: [{ start: 11, end: 17, eol: "\n", lineNumber: 1, text: "second" }],
        path: "src/file.txt",
        startLine: 1,
        windowComplete: true,
      };
    },
    async command() {},
  });
  const window = await client.readServerTextLines("src/file.txt", 1, 1, "project-a");
  assert.equal(window.lines[0].start, 11);
  assert.equal(window.windowComplete, true);
  assert.deepEqual(calls[0], {
    operation: FILE_VIEWER_OPERATIONS.textLines,
    payload: { path: "src/file.txt", startLine: 1, lineCount: 1, projectId: "project-a" },
  });
});

test("SettingsClient keeps settings queries, commands, and change events transport-neutral", async () => {
  const calls = [];
  let changed;
  const client = new SettingsClient({
    async query(operation, payload) {
      calls.push(["query", operation, payload]);
      return { cursorStyle: "block" };
    },
    async command(operation, payload) {
      calls.push(["command", operation, payload]);
      return { cursorStyle: "underline" };
    },
    subscribe(event, listener) {
      assert.equal(event, "settings.changed");
      changed = listener;
      return () => { changed = undefined; };
    },
  });
  assert.deepEqual(await client.get(), { cursorStyle: "block" });
  assert.deepEqual(await client.update({ cursorStyle: "underline" }), { cursorStyle: "underline" });
  assert.deepEqual(await client.reset(), { cursorStyle: "underline" });
  const received = [];
  const unsubscribe = client.onChanged((settings) => received.push(settings));
  changed({ cursorStyle: "bar" });
  unsubscribe();
  assert.deepEqual(received, [{ cursorStyle: "bar" }]);
  assert.deepEqual(calls, [
    ["query", "settings.get", {}],
    ["command", "settings.update", { settings: { cursorStyle: "underline" } }],
    ["command", "settings.reset", {}],
  ]);
});

test("SettingsClient refuses a compatibility transport that cannot observe canonical server changes", () => {
  const client = new SettingsClient({
    async query() { return {}; },
    async command() { return {}; },
  });

  assert.throws(
    () => client.onChanged(() => undefined),
    /settings change subscription is unavailable/,
  );
});

test("FileViewerClient bounds sparse saves and uses a canonical command", async () => {
  const calls = [];
  const client = new FileViewerClient({
    async query() { return null; },
    async command(operation, payload) {
      calls.push([operation, payload]);
      return null;
    },
  });
  await client.saveSparseFile({
    edits: [{ dataBase64: "AQI=", start: 0, end: 2 }],
    expectedIno: 7,
    expectedMtimeMs: 10,
    expectedSize: 20,
    path: "src/file.bin",
    projectRoot: "/project",
  });
  assert.deepEqual(calls, [["file.save-sparse", {
    edits: [{ dataBase64: "AQI=", start: 0, end: 2 }],
    expectedIno: 7,
    expectedMtimeMs: 10,
    expectedSize: 20,
    path: "src/file.bin",
    projectRoot: "/project",
  }]]);
  await assert.rejects(() => client.saveSparseFile({ edits: [{ dataBase64: "not base64!", start: 0, end: 1 }], expectedIno: 1, expectedMtimeMs: 1, expectedSize: 1, path: "src/file.bin", projectRoot: "/project" }), /edit/);
});
