import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusStore, makeAgentStatusEntryId } from "../dist/index.js";

const BASE = Object.freeze({
  provider: "example.agent/test",
  sessionId: "root-session",
  activationTerminalSessionId: "terminal-1",
});

const ROOT_ENTRY_ID = makeAgentStatusEntryId("terminal-1", "root-session");

function event(kind, sequence, occurredAt, details = {}) {
  return { ...BASE, kind, sequence, occurredAt, ...details };
}

function rootOf(store) {
  return store.getSnapshot().entries[ROOT_ENTRY_ID];
}

function childOf(store, subagentId) {
  return store.getSnapshot().entries[
    makeAgentStatusEntryId("terminal-1", "root-session", subagentId)
  ];
}

/** Root with two working children, its own turn open. */
function rootWithTwoWorkingChildren() {
  const store = new AgentStatusStore();
  store.dispatch(event("session.started", 1, 100));
  store.dispatch(event("turn.started", 2, 200, { turnId: "turn-1" }));
  store.dispatch(event("subagent.started", 3, 300, { subagentId: "child-a" }));
  store.dispatch(event("subagent.started", 4, 400, { subagentId: "child-b" }));
  assert.equal(childOf(store, "child-a").state, "working");
  assert.equal(childOf(store, "child-b").state, "working");
  assert.equal(rootOf(store).state, "working");
  return store;
}

test("a root that completes while children work stays working until the last child completes", () => {
  const store = rootWithTwoWorkingChildren();

  // (a) the root's own turn completes while both children are still working.
  store.dispatch(
    event("agent.done", 5, 500, { outcome: "success", summary: "root turn" }),
  );
  let root = rootOf(store);
  assert.equal(root.state, "working");
  assert.equal(root.completionOutcome, "success");
  assert.equal(root.summary, "root turn");
  assert.equal(root.unread, false);

  // (b) the first child completes; one child is still working.
  store.dispatch(
    event("subagent.stopped", 6, 600, {
      subagentId: "child-a",
      outcome: "success",
    }),
  );
  assert.equal(childOf(store, "child-a").state, "done");
  root = rootOf(store);
  assert.equal(root.state, "working");
  assert.equal(root.stateStartedAt, 200);

  // (c) the last child completes; the held completion is released.
  store.dispatch(
    event("subagent.stopped", 7, 700, {
      subagentId: "child-b",
      outcome: "success",
    }),
  );
  assert.equal(childOf(store, "child-b").state, "done");
  root = rootOf(store);
  assert.equal(root.state, "done");
  assert.equal(root.completionOutcome, "success");
  assert.equal(root.summary, "root turn");
  assert.equal(root.stateStartedAt, 700);
  assert.equal(root.unread, true);
});

test("a repeated root completion while children work never flips the root done early", () => {
  const store = rootWithTwoWorkingChildren();
  store.dispatch(event("subagent.started", 5, 500, { subagentId: "child-c" }));

  // The real CLI records a turn and an `agent.done` per task notification.
  store.dispatch(event("agent.done", 6, 600, { outcome: "success" }));
  store.dispatch(
    event("subagent.stopped", 7, 700, { subagentId: "child-a" }),
  );
  store.dispatch(event("turn.started", 8, 800, { turnId: "turn-2" }));
  store.dispatch(event("agent.done", 9, 900, { outcome: "success" }));
  store.dispatch(
    event("subagent.stopped", 10, 1000, { subagentId: "child-b" }),
  );
  assert.equal(rootOf(store).state, "working");

  store.dispatch(
    event("subagent.stopped", 11, 1100, {
      subagentId: "child-c",
      outcome: "error",
    }),
  );
  const root = rootOf(store);
  assert.equal(root.state, "done");
  // The root carries the outcome its own `agent.done` recorded, not the
  // child's.
  assert.equal(root.completionOutcome, "success");
});

test("a child completing while the root's turn is still open leaves the root working", () => {
  const store = rootWithTwoWorkingChildren();

  store.dispatch(
    event("subagent.stopped", 5, 500, {
      subagentId: "child-a",
      outcome: "success",
    }),
  );
  store.dispatch(
    event("subagent.stopped", 6, 600, {
      subagentId: "child-b",
      outcome: "success",
    }),
  );

  const root = rootOf(store);
  assert.equal(root.state, "working");
  assert.equal(root.completionOutcome, undefined);
  assert.equal(root.lastEventKind, "turn.started");
});

test("a root completing with no working child is done immediately", () => {
  const store = new AgentStatusStore();
  store.dispatch(event("turn.started", 1, 100));
  store.dispatch(event("subagent.started", 2, 200, { subagentId: "child-a" }));
  store.dispatch(event("subagent.stopped", 3, 300, { subagentId: "child-a" }));
  store.dispatch(event("agent.done", 4, 400, { outcome: "success" }));

  const root = rootOf(store);
  assert.equal(root.state, "done");
  assert.equal(root.stateStartedAt, 400);
  assert.equal(root.unread, true);
});

test("observational metadata does not discard a completion held for working children", () => {
  const store = rootWithTwoWorkingChildren();
  store.dispatch(event("agent.done", 5, 500, { outcome: "success" }));
  store.dispatch(
    event("agent.metadata", 6, 600, {
      displayName: "Renamed root",
      model: { id: "model-2" },
    }),
  );
  assert.equal(rootOf(store).state, "working");

  store.dispatch(event("subagent.stopped", 7, 700, { subagentId: "child-a" }));
  store.dispatch(event("subagent.stopped", 8, 800, { subagentId: "child-b" }));
  const root = rootOf(store);
  assert.equal(root.state, "done");
  assert.equal(root.displayName, "Renamed root");
});

test("an inferred wait survives to the snapshot and clears when an explicit record supersedes it", () => {
  const store = new AgentStatusStore();
  store.dispatch(event("turn.started", 1, 100));
  assert.equal(rootOf(store).inferred, false);

  store.dispatch(
    event("wait.started", 2, 200, {
      state: "waiting",
      reason: "approval",
      inferred: true,
    }),
  );
  let root = rootOf(store);
  assert.equal(root.state, "waiting");
  assert.equal(root.inferred, true);

  store.dispatch(
    event("tool.started", 3, 300, { tool: { id: "tool-1", name: "shell" } }),
  );
  root = rootOf(store);
  assert.equal(root.state, "working");
  assert.equal(root.inferred, false);

  // An explicit (non-inferred) wait record also leaves the flag clear.
  store.dispatch(
    event("wait.started", 4, 400, { state: "blocked", reason: "approval" }),
  );
  root = rootOf(store);
  assert.equal(root.state, "blocked");
  assert.equal(root.inferred, false);
});
