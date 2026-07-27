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

test("macro normalization migrates template-only definitions and never serializes secret values", () => {
  const macro = normalizeMacro({
    id: "deploy",
    title: "Deploy",
    template: "echo {{Environment}}",
    steps: [{ type: "secret", secretId: "api-token", value: "plaintext-secret" }],
  });
  assert.equal(macro.steps[0].type, "secret");
  assert.equal(macro.steps[0].secretId, "api-token");
  assert.equal("value" in macro.steps[0], false);
  assert.equal(JSON.stringify(macro).includes("plaintext-secret"), false);

  const migrated = normalizeMacroState({ macros: [{ id: "legacy", template: "echo {{Name}}" }] });
  assert.equal(migrated.macros[0].steps[0].type, "type");
  assert.equal(migrated.macros[0].fields[0].name, "Name");
  const durationMigrated = normalizeMacro({ id: "wait", steps: [{ type: "wait_time", durationMs: 2500 }] });
  assert.equal(durationMigrated.steps[0].durationSeconds, "2.5");
  assert.equal(renderMacroTemplate("<% if (message === 'one') { %>first<% } else { %>second<% } %>", { message: "one" }), "first");
  assert.equal(renderMacroTemplate("<% if (message === 'one') { %>first<% } else { %>second<% } %>", { message: "two" }), "second");
  assert.throws(() => renderMacroTemplate("<% process.exit() %>", {}), /not allowed/);
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

test("macro runner resolves secrets at the PTY boundary and requires exact target authorization", async () => {
  const macro = normalizeMacro({
    id: "deploy",
    steps: [
      { type: "type", content: "deploy {{Environment}} " },
      { type: "secret", secretId: "api-token" },
      { type: "key", key: "Enter" },
    ],
  });
  const writes = [];
  const keys = [];
  let resolverTarget;
  const runner = new MacroRunner({ maxOutputBytes: 128 });
  const result = await runner.run(macro, {
    target,
    authorize(candidate) { return candidate.serverId === target.serverId && candidate.projectId === target.projectId && candidate.sessionId === target.sessionId; },
    async write(candidate, bytes) { writes.push({ candidate, text: Buffer.from(bytes).toString() }); },
    async key(candidate, key) { keys.push({ candidate, key }); },
    async resolveSecret(candidate, id) { resolverTarget = { candidate, id }; return Buffer.from("secret-value"); },
  }, { authorization: { target, scope: "write" }, values: { Environment: "prod" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(writes.map((entry) => entry.text), ["deploy prod ", "secret-value"]);
  assert.equal(keys[0].key, "Enter");
  assert.deepEqual(resolverTarget.candidate, target);
  assert.equal(resolverTarget.id, "api-token");
  assert.equal(JSON.stringify(result).includes("secret-value"), false);

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

test("macro runner applies cancel or continue policy when the launching client disconnects", async () => {
  const wait = normalizeMacro({ id: "disconnect", steps: [{ type: "wait_time", durationSeconds: "5" }] });
  const runner = new MacroRunner({ maxDelayMs: 10_000 });
  const cancelHandle = runner.start(wait, { target, write() {} }, {
    authorization: { target, scope: "write" },
    launcherId: "client-cancel",
    disconnectPolicy: "cancel",
  });
  runner.clientDisconnected("client-cancel");
  assert.equal((await cancelHandle.promise).status, "canceled");

  const continueMacro = normalizeMacro({ id: "continue", steps: [{ type: "type", content: "done" }] });
  const continueHandle = runner.start(continueMacro, { target, write() {} }, {
    authorization: { target, scope: "write" },
    launcherId: "client-continue",
    disconnectPolicy: "continue",
  });
  runner.clientDisconnected("client-continue");
  assert.equal((await continueHandle.promise).status, "completed");
});
