import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  APP_WINDOW_RESTART_CANCELLATION,
  AppWindowService,
  AppWindowStore,
} from "../dist/index.js";

const temporaryDirectory = () => mkdtemp(join(tmpdir(), "app-window-store-"));
const files = async (directory) => (await readdir(directory).catch(() => [])).sort();
const readRecord = async (directory, id) => JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));

function service(directory, overrides = {}) {
  let now = 1000;
  let next = 0;
  const errors = [];
  const windows = new AppWindowService({
    isPresentationHolder: () => true,
    now: () => now++,
    generateId: () => `win_test_${++next}`,
    store: { directory, onError: (error, id) => errors.push({ error, id }) },
    ...overrides,
  });
  return { windows, errors };
}

const agentWindow = (overrides = {}) => ({
  terminalSessionId: "session-1",
  projectId: "project-1",
  title: "Hello",
  source: { kind: "agent" },
  html: "<h1>Hello</h1>",
  ...overrides,
});

const mcpAppWindow = (overrides = {}) => agentWindow({
  title: "Chart",
  source: { kind: "mcp-app", server: "charts", tool: "draw", resourceUri: "ui://charts/draw" },
  html: "<canvas></canvas>",
  toolInput: { points: 3 },
  ...overrides,
});

const running = (sessions) => ({ runningProject: (sessionId) => sessions[sessionId] });

test("the store writes, overwrites, and removes one file per window", async () => {
  const directory = await temporaryDirectory();
  const store = new AppWindowStore({ directory, parse: (value) => value });
  store.write({ id: "win_a", n: 1 });
  store.write({ id: "win_b", n: 1 });
  await store.flush();
  assert.deepEqual(await files(directory), ["win_a.json", "win_b.json"]);
  store.write({ id: "win_a", n: 2 });
  store.remove("win_b");
  await store.flush();
  assert.deepEqual(await files(directory), ["win_a.json"]);
  assert.deepEqual(await readRecord(directory, "win_a"), { id: "win_a", n: 2 });
});

test("a burst of writes of one window ends with the latest record and nothing left over", async () => {
  const directory = await temporaryDirectory();
  const store = new AppWindowStore({ directory, parse: (value) => value });
  for (let n = 1; n <= 50; n += 1) store.write({ id: "win_a", n });
  store.remove("win_a");
  store.write({ id: "win_a", n: 51 });
  await store.flush();
  assert.deepEqual(await files(directory), ["win_a.json"]);
  assert.equal((await readRecord(directory, "win_a")).n, 51);
});

test("loading discards a damaged or foreign file and what an interrupted write left, and keeps the rest", async () => {
  const directory = await temporaryDirectory();
  const errors = [];
  const store = new AppWindowStore({
    directory,
    parse: (value) => (value.ok === true ? value : undefined),
    onError: (_error, id) => errors.push(id),
  });
  await writeFile(join(directory, "win_good.json"), JSON.stringify({ id: "win_good", ok: true }));
  await writeFile(join(directory, "win_torn.json"), "{\"id\":\"win_to");
  await writeFile(join(directory, "win_bad.json"), JSON.stringify({ id: "win_bad", ok: false }));
  await writeFile(join(directory, "win_renamed.json"), JSON.stringify({ id: "win_other", ok: true }));
  await writeFile(join(directory, "win_good.json.abc.tmp"), "partial");
  const records = await store.load();
  assert.deepEqual(records.map((record) => record.id), ["win_good"]);
  assert.deepEqual(errors.sort(), ["win_bad", "win_renamed", "win_torn"]);
  assert.deepEqual(await files(directory), ["win_good.json"]);
});

test("a missing directory loads as no windows, and an id that is not a file name is never written", async () => {
  const directory = join(await temporaryDirectory(), "absent");
  const errors = [];
  const store = new AppWindowStore({ directory, parse: (value) => value, onError: (_error, id) => errors.push(id) });
  assert.deepEqual(await store.load(), []);
  store.write({ id: "../escape" });
  await store.flush();
  assert.deepEqual(errors, ["../escape"]);
  assert.deepEqual(await files(directory), []);
});

test("every change to a window is written, and only what a view starts from", async () => {
  const directory = await temporaryDirectory();
  const { windows } = service(directory);
  const first = windows.open(agentWindow({ data: { region: "eu" } }));
  const second = windows.open(agentWindow({ title: "Second" }));
  await windows.flush();
  assert.equal((await readRecord(directory, first.id)).state, "minimised");
  assert.equal((await readRecord(directory, second.id)).state, "open");

  windows.replace("session-1", first.id, { title: "First again", html: "<p>again</p>" });
  await windows.flush();
  const record = await readRecord(directory, first.id);
  assert.deepEqual(
    { title: record.title, html: record.html, state: record.state, data: record.data },
    { title: "First again", html: "<p>again</p>", state: "open", data: undefined },
  );
  assert.deepEqual(Object.keys(record).sort(), [
    "contentRevision", "createdAt", "html", "id", "projectId", "source", "state", "terminalSessionId", "title", "version",
  ]);

  const app = windows.open(mcpAppWindow());
  windows.setToolResult(app.id, { content: [{ type: "text", text: "drawn" }] });
  await windows.flush();
  assert.deepEqual((await readRecord(directory, app.id)).toolResult, { content: [{ type: "text", text: "drawn" }] });
});

test("a window that ends is removed; releasing keeps every record, ending removes them", async () => {
  const directory = await temporaryDirectory();
  const { windows } = service(directory);
  const closed = windows.open(agentWindow());
  windows.open(agentWindow({ terminalSessionId: "session-2" }));
  windows.open(agentWindow({ terminalSessionId: "session-3" }));
  windows.close("session-1", closed.id);
  windows.endSession("session-2");
  await windows.flush();
  assert.deepEqual(await files(directory), ["win_test_3.json"]);

  await windows.release();
  assert.deepEqual(windows.list(), []);
  assert.deepEqual(await files(directory), ["win_test_3.json"]);

  const next = service(directory).windows;
  await next.restore(running({ "session-3": "project-1" }));
  assert.equal(next.list().length, 1);
  next.endAll();
  await next.flush();
  assert.deepEqual(await files(directory), []);
});

test("a restart restores the windows of running sessions by the same id and discards the rest", async () => {
  const directory = await temporaryDirectory();
  const before = service(directory).windows;
  const minimised = before.open(agentWindow({ title: "Minimised", data: { n: 1 } }));
  const open = before.open(agentWindow({ title: "Open" }));
  const gone = before.open(agentWindow({ terminalSessionId: "session-gone" }));
  await before.release();

  const { windows: after } = service(directory, { generateId: () => open.id });
  await after.restore(running({ "session-1": "project-moved" }));
  const restored = after.list();
  assert.deepEqual(restored.map(({ id, state, title, projectId }) => ({ id, state, title, projectId })), [
    { id: minimised.id, state: "minimised", title: "Minimised", projectId: "project-moved" },
    { id: open.id, state: "open", title: "Open", projectId: "project-moved" },
  ]);
  assert.ok(restored[1].contentRevision > open.contentRevision);
  await after.flush();
  assert.deepEqual(await files(directory), [`${minimised.id}.json`, `${open.id}.json`]);
  assert.equal(after.list().some((window) => window.id === gone.id), false);

  // The agent's handle works on the restored window.
  after.replace("session-1", minimised.id, { title: "Replaced", html: "<p>new</p>" });
  assert.equal(after.list().find((window) => window.id === minimised.id).title, "Replaced");
  assert.equal(after.close("session-1", open.id), true);
  await after.flush();
  assert.deepEqual(await files(directory), [`${minimised.id}.json`]);
});

test("a new window after a restore never takes a restored window's id", async () => {
  const directory = await temporaryDirectory();
  const before = service(directory).windows;
  const kept = before.open(agentWindow());
  await before.release();
  let next = 0;
  const after = service(directory, { generateId: () => (next++ === 0 ? kept.id : "win_fresh") }).windows;
  await after.restore(running({ "session-1": "project-1" }));
  next = 0;
  const fresh = after.open(agentWindow({ title: "Fresh" }));
  assert.equal(fresh.id, "win_fresh");
  assert.equal(after.list().length, 2);
});

test("an MCP App window whose tool call had not returned comes back cancelled; one that had returned keeps its result", async () => {
  const directory = await temporaryDirectory();
  const before = service(directory).windows;
  const pending = before.open(mcpAppWindow({ title: "Pending" }));
  const done = before.open(mcpAppWindow({ title: "Done", terminalSessionId: "session-2" }));
  before.setToolResult(done.id, { content: [] });
  await before.release();

  const after = service(directory).windows;
  await after.restore(running({ "session-1": "project-1", "session-2": "project-1" }));
  await after.flush();
  assert.equal((await readRecord(directory, pending.id)).toolCancelled, APP_WINDOW_RESTART_CANCELLATION);
  const kept = await readRecord(directory, done.id);
  assert.deepEqual(kept.toolResult, { content: [] });
  assert.equal(kept.toolCancelled, undefined);
});

test("a written record that carries more than a view starts from, or breaks a limit, is not restored", async () => {
  const directory = await temporaryDirectory();
  const before = service(directory).windows;
  const window = before.open(agentWindow());
  await before.release();
  const written = await readRecord(directory, window.id);
  const variants = {
    win_extra: { ...written, id: "win_extra", pendingContext: "secret" },
    win_huge: { ...written, id: "win_huge", html: "x".repeat(600 * 1024) },
    win_version: { ...written, id: "win_version", version: 99 },
    win_state: { ...written, id: "win_state", state: "maximised" },
    win_source: { ...written, id: "win_source", source: { kind: "agent", extra: true } },
  };
  for (const [id, value] of Object.entries(variants))
    await writeFile(join(directory, `${id}.json`), JSON.stringify(value));

  const { windows: after, errors } = service(directory);
  await after.restore(running({ "session-1": "project-1" }));
  await after.flush();
  assert.deepEqual(after.list().map((restored) => restored.id), [window.id]);
  assert.deepEqual(errors.map(({ id }) => id).sort(), Object.keys(variants).sort());
  assert.deepEqual(await files(directory), [`${window.id}.json`]);
});
