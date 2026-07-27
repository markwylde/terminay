import test from "node:test";
import assert from "node:assert/strict";
import { FileViewerClient, SettingsClient, TerminayClientFacade } from "../dist/index.js";

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
  assert.throws(() => client.getGitDiff(""), /file path/);
  assert.throws(() => client.getGitDiff("bad\0path"), /file path/);
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
  assert.equal((await client.getTextMetadata("src/file.txt", "/project")).lineCount, 2);
  assert.equal((await client.readTextLines("src/file.txt", "/project", 0, 128)).lines.length, 2);
  assert.deepEqual(calls, [
    ["file.text-metadata", { path: "src/file.txt", projectRoot: "/project" }],
    ["file.text-lines", { path: "src/file.txt", projectRoot: "/project", startLine: 0, lineCount: 128 }],
  ]);
  await assert.rejects(() => client.getTextMetadata("", "/project"), /file path/);
  await assert.rejects(() => client.readTextLines("src/file.txt", "/project", 0, 513), /line count/);
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
