import assert from "node:assert/strict";
import test from "node:test";
import { createServerControlDispatcher } from "../dist/index.js";

const context = { terminalSessionId: "caller", projectId: "project-a", scope: "write", connectionId: "local", requestId: "one", signal: new AbortController().signal };

test("server control dispatcher invokes operations directly with implicit project/session scope", async () => {
  const calls = [];
  const dispatch = createServerControlDispatcher({ handlers: {
    listTerminals: (received) => ({ terminals: [{ id: received.terminalSessionId, projectId: received.projectId }] }),
    writeTerminal: (params, received) => { calls.push({ params, received }); return { ok: true }; },
  } });
  const listed = await dispatch({ id: "one", version: 1, op: "list_terminals", params: {} }, context);
  assert.deepEqual(listed, { terminals: [{ id: "caller", projectId: "project-a" }] });
  const written = await dispatch({ id: "two", version: 1, op: "write_terminal", params: { terminal: "sibling", text: "echo ok" } }, { ...context, requestId: "two" });
  assert.deepEqual(written, { ok: true });
  assert.equal(calls[0].received.projectId, "project-a");
  assert.equal("token" in calls[0].received, false);
});

test("server control dispatcher enforces scope, bounded params, and unsupported handlers", async () => {
  const dispatch = createServerControlDispatcher({ maxParamsBytes: 16, handlers: { listTerminals: () => [] } });
  const denied = await dispatch({ id: "one", version: 1, op: "write_terminal", params: {} }, { ...context, scope: "read" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "forbidden");
  const limited = await dispatch({ id: "two", version: 1, op: "list_terminals", params: { value: "x".repeat(100) } }, context);
  assert.equal(limited.ok, false);
  assert.equal(limited.error.code, "limit_exceeded");
  const unsupported = await dispatch({ id: "three", version: 1, op: "read_terminal", params: {} }, context);
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "unsupported_op");

  const byteLimited = createServerControlDispatcher({ maxParamsBytes: 13, handlers: { listTerminals: () => [] } });
  const unicode = await byteLimited({ id: "four", version: 1, op: "list_terminals", params: { value: "é" } }, context);
  assert.equal(unicode.ok, false);
  assert.equal(unicode.error.code, "limit_exceeded");
  const unserializable = await byteLimited({ id: "five", version: 1, op: "list_terminals", params: { value: 1n } }, context);
  assert.equal(unserializable.ok, false);
  assert.equal(unserializable.error.code, "bad_request");
});
