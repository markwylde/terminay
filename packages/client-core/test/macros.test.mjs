import assert from "node:assert/strict";
import test from "node:test";
import { MACRO_EVENTS, MACRO_OPERATIONS, MacroClient } from "../dist/index.js";

const target = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const state = {
  schemaVersion: 1,
  revision: 2,
  cursor: "2",
  macros: [{
    id: "deploy",
    title: "Deploy",
    description: "",
    fields: [],
    steps: [{ id: "secret-step", type: "secret", secretId: "api-token" }],
  }],
};

test("MacroClient keeps editing, execution, and event names transport-neutral", async () => {
  const calls = [];
  let changed;
  let runChanged;
  const client = new MacroClient({
    async query(operation, payload) {
      calls.push(["query", operation, payload]);
      return operation === MACRO_OPERATIONS.get ? state : [{ runId: "deploy:1", macroId: "deploy", target, status: "running", stepIndex: 0, bytesWritten: 0, startedAt: 10 }];
    },
    async command(operation, payload, options) {
      calls.push(["command", operation, payload, options]);
      if (operation === MACRO_OPERATIONS.run) return { runId: "deploy:1", macroId: "deploy", target, status: "running", stepIndex: 0, bytesWritten: 0, startedAt: 10 };
      if (operation === MACRO_OPERATIONS.cancel) return { runId: "deploy:1", canceled: false };
      return state;
    },
    subscribe(event, listener) {
      if (event === MACRO_EVENTS.changed) changed = listener;
      if (event === MACRO_EVENTS.runChanged) runChanged = listener;
      return () => undefined;
    },
  });

  assert.deepEqual(await client.get(), state);
  assert.deepEqual(await client.replace(state.macros, { expectedRevision: 2 }), state);
  assert.deepEqual(await client.upsert(state.macros[0], { expectedRevision: 2 }), state);
  assert.deepEqual(await client.remove("deploy", { expectedRevision: 2 }), state);
  assert.deepEqual(await client.reset({ expectedRevision: 2 }), state);
  const run = await client.run("deploy", target, { Environment: "prod" }, { disconnectPolicy: "continue" });
  assert.equal(run.runId, "deploy:1");
  assert.deepEqual(await client.runs(), [run]);
  assert.deepEqual(await client.cancel("deploy:1", target), { runId: "deploy:1", canceled: false });

  const receivedStates = [];
  const receivedRuns = [];
  const removeChanged = client.onChanged((value) => receivedStates.push(value));
  const removeRunChanged = client.onRunChanged((value) => receivedRuns.push(value));
  changed({ ...state, revision: 3, cursor: "3" });
  runChanged(run);
  removeChanged();
  removeRunChanged();
  assert.equal(receivedStates[0].revision, 3);
  assert.equal(receivedRuns[0].runId, "deploy:1");
  assert.equal(JSON.stringify(receivedStates).includes("secret-value"), false);
  assert.deepEqual(calls.map(([kind, operation]) => [kind, operation]), [
    ["query", MACRO_OPERATIONS.get],
    ["command", MACRO_OPERATIONS.replace],
    ["command", MACRO_OPERATIONS.upsert],
    ["command", MACRO_OPERATIONS.remove],
    ["command", MACRO_OPERATIONS.reset],
    ["command", MACRO_OPERATIONS.run],
    ["query", MACRO_OPERATIONS.runs],
    ["command", MACRO_OPERATIONS.cancel],
  ]);
  assert.deepEqual(calls[5][2], {
    macroId: "deploy",
    target,
    values: { Environment: "prod" },
    disconnectPolicy: "continue",
  });
});

test("MacroClient rejects unsafe target and field values before transport", async () => {
  const client = new MacroClient({ async query() { return state; }, async command() { return state; } });
  await assert.rejects(() => client.run("deploy", { ...target, sessionId: "bad\nidentity" }), /target session id/);
  await assert.rejects(() => client.run("deploy", target, { Environment: /** @type {any} */ (undefined) }), /macro value/);
  await assert.rejects(() => client.remove("bad\nmacro"), /macro id/);
});

test("MacroClient fails closed when a compatibility transport cannot subscribe", () => {
  const client = new MacroClient({ async query() { return state; }, async command() { return state; } });
  assert.throws(() => client.onChanged(() => undefined), /macro change subscription is unavailable/u);
  assert.throws(() => client.onRunChanged(() => undefined), /macro run subscription is unavailable/u);
});
