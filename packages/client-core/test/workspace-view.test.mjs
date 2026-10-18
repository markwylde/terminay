import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_VIEW_EVENTS, WORKSPACE_VIEW_OPERATIONS, WorkspaceViewRefusal, serveWorkspaceView } from "../dist/index.js";

function transport() {
  const listeners = new Map();
  const commands = [];
  const waiters = [];
  return {
    commands,
    /** Resolves once `count` commands have been sent. */
    commandsReach(count) {
      if (commands.length >= count) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },
    emit(event, payload) { for (const listener of listeners.get(event) ?? []) listener(payload); },
    subscribe(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    async query() { throw new Error("unused"); },
    async command(operation, payload) {
      commands.push({ operation, payload });
      for (const waiter of waiters.filter((entry) => commands.length >= entry.count)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
      return {};
    },
  };
}

test("attaches once and answers a request with the handler's result", async () => {
  const wire = transport();
  const seen = [];
  serveWorkspaceView(wire, async (request) => { seen.push(request); return { root: { pane: "g1", tabs: [] } }; });
  assert.deepEqual(wire.commands[0], { operation: WORKSPACE_VIEW_OPERATIONS.attach, payload: {} });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r1", op: "layout", params: { projectId: "p1" } });
  await wire.commandsReach(2);
  assert.deepEqual(seen, [{ requestId: "r1", op: "layout", params: { projectId: "p1" } }]);
  assert.deepEqual(wire.commands[1], { operation: WORKSPACE_VIEW_OPERATIONS.respond, payload: { requestId: "r1", ok: true, result: { root: { pane: "g1", tabs: [] } } } });
});

test("a refusal is answered with its code, and any other failure as failed", async () => {
  const wire = transport();
  serveWorkspaceView(wire, async (request) => {
    if (request.requestId === "r1") throw new WorkspaceViewRefusal("not_found", "No such tab.");
    throw new Error("boom");
  });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r1", op: "focus", params: {} });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r2", op: "focus", params: {} });
  await wire.commandsReach(3);
  assert.deepEqual(wire.commands.slice(1).map((c) => c.payload), [
    { requestId: "r1", ok: false, error: { code: "not_found", message: "No such tab." } },
    { requestId: "r2", ok: false, error: { code: "failed", message: "boom" } },
  ]);
});

test("a malformed or unknown request is ignored", async () => {
  const wire = transport();
  const seen = [];
  serveWorkspaceView(wire, async (request) => { seen.push(request.requestId); return null; });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r1", op: "deleteEverything", params: {} });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { op: "layout" });
  wire.emit(WORKSPACE_VIEW_EVENTS.request, "nope");
  // A good request sent after them is answered; the bad ones before it were not.
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r2", op: "layout", params: {} });
  await wire.commandsReach(2);
  assert.deepEqual(seen, ["r2"]);
  assert.deepEqual(wire.commands.slice(1).map((c) => c.payload.requestId), ["r2"]);
});

test("nothing is answered after stopping", async () => {
  const wire = transport();
  let called = 0;
  const stop = serveWorkspaceView(wire, async () => { called += 1; return null; });
  stop();
  // A server still attached hears the same request and answers it; the
  // stopped one, given the request in the same emit, did not.
  serveWorkspaceView(wire, async () => null);
  wire.emit(WORKSPACE_VIEW_EVENTS.request, { requestId: "r1", op: "layout", params: {} });
  await wire.commandsReach(3);
  assert.equal(called, 0);
  assert.deepEqual(wire.commands.map((c) => c.operation), [
    WORKSPACE_VIEW_OPERATIONS.attach, WORKSPACE_VIEW_OPERATIONS.attach, WORKSPACE_VIEW_OPERATIONS.respond,
  ]);
});
