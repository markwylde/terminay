import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GitCommandStream, GitTraceDirectory, MAX_TRACE_FILE_BYTES } from "../dist/index.js";

// ADR-0079: on Windows, Git writes one file per process into a directory the
// server watches. The reader is plain filesystem code, so it is exercised here
// on any host; only the DACL that closes the directory is Windows-only.

const line = (value) => `${JSON.stringify(value)}\n`;
const settle = () => delay(150);

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "tgd-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "run", "git-trace");
}

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(callback) { const id = next++; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); },
    fireAll() { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } },
  };
}

test("a Windows terminal's Git reports worktree add through the directory, with the terminal's token", async (t) => {
  const directory = scratch(t);
  const seen = [];
  const commands = new GitCommandStream({
    socketPath: "unused.sock",
    traceDirectory: directory,
    onWorktreeAdd: (command) => seen.push(command),
    tokenFor: (sessionId) => `tok-${sessionId}`,
  });
  assert.deepEqual(commands.environmentFor("s1"), {}, "nothing is named before it is listening");
  assert.equal(await commands.listen(), true);
  t.after(() => commands.close());
  const env = commands.environmentFor("s1");
  assert.equal(env.GIT_TRACE2_EVENT, directory);
  assert.equal(env.GIT_TRACE2_PARENT_SID, "tok-s1");
  assert.deepEqual(commands.environmentFor("s2", { GIT_TRACE2_EVENT: "C:\\mine" }), {}, "the user's own tracing wins");

  const file = join(directory, "20261030T120000.000000Z-H1234-P00001234");
  writeFileSync(file, line({ event: "version", sid: "tok-s1/1" }));
  await settle();
  appendFileSync(file, line({ event: "start", sid: "tok-s1/1", argv: ["git", "worktree", "add", "-b", "feat", "../feature"] }));
  appendFileSync(file, line({ event: "start", sid: "forged/1", argv: ["git", "worktree", "add", "x"] }));
  await settle();
  assert.deepEqual(seen, [{ sessionId: "s1", directoryName: "feature" }]);
});

test("a file is deleted once its process has exited, and is never read twice", async (t) => {
  const directory = scratch(t);
  const lines = [];
  const timers = manualTimers();
  const reader = new GitTraceDirectory({ path: directory, maxLineBytes: 1024, onLine: (value) => lines.push(value), timers });
  assert.equal(reader.start(), true);
  t.after(() => reader.stop());
  const file = join(directory, "trace-1");
  writeFileSync(file, line({ event: "start" }) + line({ event: "exit" }));
  await settle();
  appendFileSync(file, line({ event: "atexit" }));
  await settle();
  assert.equal(lines.length, 3);
  timers.fireAll();
  assert.equal(existsSync(file), false);
  assert.equal(reader.openFiles, 0);
});

test("a file over the bound is deleted, and a partial line over the line bound is dropped", async (t) => {
  const directory = scratch(t);
  const lines = [];
  const reader = new GitTraceDirectory({ path: directory, maxLineBytes: 1024, onLine: (value) => lines.push(value) });
  assert.equal(reader.start(), true);
  t.after(() => reader.stop());
  writeFileSync(join(directory, "huge"), "x".repeat(MAX_TRACE_FILE_BYTES + 10));
  writeFileSync(join(directory, "long-line"), "y".repeat(2048));
  await settle();
  assert.deepEqual(readdirSync(directory), []);
  assert.deepEqual(lines, []);
});

test("files an earlier run left behind are deleted unread", async (t) => {
  const directory = scratch(t);
  const lines = [];
  const earlier = new GitTraceDirectory({ path: directory, maxLineBytes: 1024, onLine: () => {} });
  earlier.start();
  earlier.stop();
  writeFileSync(join(directory, "left-behind"), line({ event: "start", sid: "tok-s1/1", argv: ["git", "worktree", "add", "x"] }));
  const reader = new GitTraceDirectory({ path: directory, maxLineBytes: 1024, onLine: (value) => lines.push(value) });
  assert.equal(reader.start(), true);
  t.after(() => reader.stop());
  assert.deepEqual(readdirSync(directory), []);
  await settle();
  assert.deepEqual(lines, []);
});

test("a directory that cannot be prepared leaves Git unreported", (t) => {
  const directory = scratch(t);
  const reader = new GitTraceDirectory({ path: directory, maxLineBytes: 1024, onLine: () => {}, prepare: () => false });
  assert.equal(reader.start(), false);
  assert.equal(reader.listening, false);
});
