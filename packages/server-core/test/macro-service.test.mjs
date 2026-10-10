import test from "node:test";
import assert from "node:assert/strict";
import {
  MacroRepository,
  MacroRunner,
  MacroServiceError,
  normalizeMacro,
  normalizeMacroState,
  renderMacroTemplate,
} from "../dist/macroService/index.js";

const target = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "session-1" });

test("a stored secret step loads as unsupported and carries no secretId", () => {
  const macro = normalizeMacro({
    id: "deploy",
    title: "Deploy",
    template: "echo {{Environment}}",
    steps: [{ id: "s1", type: "secret", secretId: "api-token", value: "plaintext-secret" }],
  });
  assert.deepEqual(macro.steps[0], { id: "s1", type: "unsupported", sourceType: "secret" });
  assert.equal(JSON.stringify(macro).includes("api-token"), false);
  assert.equal(JSON.stringify(macro).includes("plaintext-secret"), false);
  // Normalizing again keeps the original type name rather than "unsupported".
  assert.deepEqual(normalizeMacro(macro).steps[0], macro.steps[0]);
});

test("an unknown step type does not fail the library", () => {
  const state = normalizeMacroState({
    schemaVersion: 2,
    macros: [
      { id: "odd", steps: [{ type: "teleport-somewhere-that-has-a-very-long-type-name", where: "x" }] },
      { id: "fine", steps: [{ type: "type", content: "echo ok" }] },
    ],
  });
  assert.equal(state.macros.length, 2);
  assert.equal(state.macros[0].steps[0].type, "unsupported");
  assert.equal(state.macros[0].steps[0].sourceType.length, 32);
  assert.equal("where" in state.macros[0].steps[0], false);
  assert.equal(state.macros[1].steps[0].type, "type");
});

test("macro normalization migrates template-only definitions", () => {

  const migrated = normalizeMacroState({ macros: [{ id: "legacy", template: "echo {{Name}}" }] });
  assert.equal(migrated.macros[0].steps[0].type, "type");
  assert.equal(migrated.macros[0].fields[0].name, "Name");
  const durationMigrated = normalizeMacro({ id: "wait", steps: [{ type: "wait_time", durationMs: 2500 }] });
  assert.equal(durationMigrated.steps[0].durationSeconds, "2.5");
  assert.equal(renderMacroTemplate("<% if (message === 'one') { %>first<% } else { %>second<% } %>", { message: "one" }), "first");
  assert.equal(renderMacroTemplate("<% if (message === 'one') { %>first<% } else { %>second<% } %>", { message: "two" }), "second");
  assert.throws(() => renderMacroTemplate("<% process.exit() %>", {}), /not allowed/);
});

test("macro normalization collapses duplicate persisted fields before enforcing limits", () => {
  const duplicateFields = Array.from({ length: 129 }, (_value, index) => ({
    id: `field-${index}`,
    name: "Environment",
    label: "Environment",
    type: "text",
  }));
  const state = normalizeMacroState({
    macros: [{ id: "deploy", template: "deploy {{Environment}}", fields: duplicateFields }],
  });

  assert.equal(state.macros[0].fields.length, 1);
  assert.equal(state.macros[0].fields[0].name, "Environment");
  assert.throws(
    () => normalizeMacro({
      id: "too-many-fields",
      fields: Array.from({ length: 129 }, (_value, index) => ({ name: `field_${index}` })),
    }),
    /macro field count exceeds the limit/,
  );
});

test("macro repository persists revisioned updates, rejects stale clients, and resets explicitly", async () => {
  let persisted;
  const repository = new MacroRepository({
    async load() { return persisted; },
    async commit(state) { persisted = state; },
  });
  const first = await repository.load();
  assert.equal(first.revision, 0);
  const created = await repository.upsert({ id: "hello", title: "Hello", steps: [{ type: "type", content: "echo hi" }] }, first.revision, "command-1");
  assert.equal(created.ok, true);
  const repeated = await repository.upsert({ id: "hello", title: "different", steps: [] }, first.revision, "command-1");
  assert.deepEqual(repeated, created);
  const stale = await repository.upsert({ id: "other", steps: [] }, first.revision);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.currentRevision, 1);
  const reset = await repository.reset(1);
  assert.equal(reset.ok, true);
  assert.equal(repository.state.macros.length, 0);
});

test("a macro with an unsupported step is rejected before any PTY write", async () => {
  const macro = normalizeMacro({
    id: "deploy",
    title: "Deploy",
    steps: [
      { type: "type", content: "sudo deploy" },
      { type: "key", key: "Enter" },
      { type: "secret", secretId: "api-token" },
      { type: "key", key: "Enter" },
    ],
  });
  const writes = [];
  const keys = [];
  let resolved = false;
  const runner = new MacroRunner();
  const result = await runner.run(macro, {
    target,
    async write(_candidate, bytes) { writes.push(Buffer.from(bytes).toString()); },
    async key(_candidate, key) { keys.push(key); },
    // A host that still offers a resolver is never asked.
    async resolveSecret() { resolved = true; return Buffer.from("secret-value"); },
  }, { authorization: { target, scope: "write" } });
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "invalid_macro");
  assert.equal(result.bytesWritten, 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(keys, []);
  assert.equal(resolved, false);
});

test("a macro run reads no vault entry", async () => {
  const macro = normalizeMacro({
    id: "everything",
    steps: [
      { type: "type", content: "deploy {{Environment}}" },
      { type: "key", key: "Enter" },
      { type: "wait_time", durationSeconds: "0" },
      { type: "wait_inactivity", durationSeconds: "0" },
      { type: "select_line" },
    ],
  });
  const vault = new Proxy({}, { get() { throw new Error("a macro run touched the vault"); } });
  const runner = new MacroRunner();
  const result = await runner.run(macro, {
    target,
    vault,
    write() {},
    key() {},
    waitForInactivity() {},
    resolveSecret() { throw new Error("a macro run asked for a secret"); },
  }, { authorization: { target, scope: "write" }, values: { Environment: "prod" } });
  assert.equal(result.status, "completed");
});

test("macro runner types rendered text and requires exact target authorization", async () => {
  const macro = normalizeMacro({
    id: "deploy",
    steps: [
      { type: "type", content: "deploy {{Environment}} " },
      { type: "key", key: "Enter" },
    ],
  });
  const writes = [];
  const keys = [];
  const runner = new MacroRunner({ maxOutputBytes: 128 });
  const result = await runner.run(macro, {
    target,
    authorize(candidate) { return candidate.serverId === target.serverId && candidate.projectId === target.projectId && candidate.sessionId === target.sessionId; },
    async write(candidate, bytes) { writes.push({ candidate, text: Buffer.from(bytes).toString() }); },
    async key(candidate, key) { keys.push({ candidate, key }); },
  }, { authorization: { target, scope: "write" }, values: { Environment: "prod" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(writes.map((entry) => entry.text), ["deploy prod "]);
  assert.equal(keys[0].key, "Enter");

  await assert.rejects(
    () => runner.run(macro, { target, write() {} }, { authorization: { target: { ...target, sessionId: "other" }, scope: "write" } }),
    (error) => error instanceof MacroServiceError && error.code === "unauthorized_target",
  );
});

test("macro runner bounds waits and cancellation without retaining completed runs", async () => {
  const macro = normalizeMacro({ id: "wait", steps: [{ type: "wait_time", durationSeconds: "5" }] });
  const runner = new MacroRunner({ maxDelayMs: 10_000 });
  const handle = runner.start(macro, { target, write() {} }, { authorization: { target, scope: "write" } });
  assert.equal(runner.running, 1);
  handle.cancel();
  const result = await handle.promise;
  assert.equal(result.status, "canceled");
  assert.equal(runner.running, 0);
  const tooLong = normalizeMacro({ id: "too-long", steps: [{ type: "wait_time", durationSeconds: "99" }] });
  const limited = new MacroRunner({ maxDelayMs: 100 });
  const failed = await limited.run(tooLong, { target, write() {} }, { authorization: { target, scope: "write" } });
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "limit");
});

test("macro runner uses the server inactivity wait and bounds output and concurrency", async () => {
  const inactivity = normalizeMacro({ id: "inactivity", steps: [{ type: "wait_inactivity", durationSeconds: "2" }] });
  const waits = [];
  const runner = new MacroRunner({ maxConcurrentRuns: 1, maxOutputBytes: 4 });
  const result = await runner.run(inactivity, {
    target,
    write() {},
    waitForInactivity(_target, milliseconds) { waits.push(milliseconds); },
  }, { authorization: { target, scope: "write" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(waits, [2000]);

  const output = normalizeMacro({ id: "output", steps: [{ type: "type", content: "x".repeat(1025) }] });
  const bounded = await runner.run(output, { target, write() {} }, { authorization: { target, scope: "write" } });
  assert.equal(bounded.status, "failed");
  assert.equal(bounded.errorCode, "limit");

  const longWait = normalizeMacro({ id: "concurrent", steps: [{ type: "wait_time", durationSeconds: "5" }] });
  const handle = runner.start(longWait, { target, write() {} }, { authorization: { target, scope: "write" } });
  assert.throws(
    () => runner.start(longWait, { target, write() {} }, { authorization: { target, scope: "write" } }),
    (error) => error instanceof MacroServiceError && error.code === "limit",
  );
  handle.cancel();
  await handle.promise;
});

test("macro runner applies cancel or continue policy when the launching connection disconnects", async () => {
  const wait = normalizeMacro({ id: "disconnect", steps: [{ type: "wait_time", durationSeconds: "5" }] });
  const runner = new MacroRunner({ maxDelayMs: 10_000 });
  const cancelHandle = runner.start(wait, { target, write() {} }, {
    authorization: { target, scope: "write" },
    launcherId: "connection-cancel",
    disconnectPolicy: "cancel",
  });
  runner.launcherDisconnected("connection-cancel");
  assert.equal((await cancelHandle.promise).status, "canceled");

  const continueMacro = normalizeMacro({ id: "continue", steps: [{ type: "type", content: "done" }] });
  const continueHandle = runner.start(continueMacro, { target, write() {} }, {
    authorization: { target, scope: "write" },
    launcherId: "connection-continue",
    disconnectPolicy: "continue",
  });
  runner.launcherDisconnected("connection-continue");
  assert.equal((await continueHandle.promise).status, "completed");
});

test("duplicate and empty category names are dropped", () => {
  const state = normalizeMacroState({
    schemaVersion: 2,
    categories: ["  Deploy  ", "deploy", "", 7, "x".repeat(65), "bad\u0007name", "Review"],
    macros: [],
  });
  assert.deepEqual(state.categories, ["Deploy", "Review"]);
});

test("a macro in an unknown category has none", () => {
  const state = normalizeMacroState({
    schemaVersion: 2,
    categories: ["Deploy"],
    macros: [
      { id: "a", title: "A", category: "deploy", steps: [] },
      { id: "b", title: "B", category: "Gone", steps: [] },
    ],
  });
  // A case-only difference resolves to the listed name.
  assert.equal(state.macros[0].category, "Deploy");
  assert.equal(state.macros[1].category, "");
});

test("an empty category persists across a commit", async () => {
  let persisted;
  const repository = new MacroRepository({
    async load() { return persisted; },
    async commit(state) { persisted = state; },
  });
  await repository.load();
  const saved = await repository.replace([{ id: "a", title: "A", category: "Used", steps: [] }], 0, undefined, ["Used", "Empty"]);
  assert.equal(saved.ok, true);
  assert.deepEqual(persisted.categories, ["Used", "Empty"]);
  const reopened = new MacroRepository({ async load() { return persisted; }, async commit() {} });
  assert.deepEqual((await reopened.load()).categories, ["Used", "Empty"]);

  // A client that knows nothing about categories cannot erase them.
  const legacy = await repository.replace([{ id: "a", title: "A", category: "Used", steps: [] }]);
  assert.deepEqual(legacy.state.categories, ["Used", "Empty"]);
  assert.equal(legacy.state.macros[0].category, "Used");

  // An upsert naming an unlisted category lands with none.
  const upserted = await repository.upsert({ id: "b", title: "B", category: "Nowhere", steps: [] });
  assert.equal(upserted.state.macros.find((macro) => macro.id === "b").category, "");

  const reset = await repository.reset();
  assert.deepEqual(reset.state.categories, []);
});

test("version 1 state gains prefix categories once", () => {
  const v1 = {
    schemaVersion: 1,
    revision: 4,
    macros: [
      { id: "1", title: "pr:create", steps: [] },
      { id: "2", title: "pr:create-and-green", steps: [] },
      { id: "3", title: "spec:create", steps: [] },
      { id: "4", title: "Say thing", steps: [] },
      { id: "5", title: ":odd", steps: [] },
    ],
  };
  const migrated = normalizeMacroState(v1);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.revision, 4);
  assert.deepEqual(migrated.categories, ["pr"]);
  assert.deepEqual(migrated.macros.map((macro) => macro.category), ["pr", "pr", "", "", ""]);

  // Once at the current version nothing is derived again, even after the user
  // has emptied the list and a shared prefix still exists.
  assert.deepEqual(normalizeMacroState(migrated), migrated);
  const cleared = normalizeMacroState({ ...migrated, categories: [], macros: migrated.macros.map((macro) => ({ ...macro, category: "" })) });
  assert.deepEqual(cleared.categories, []);
});
