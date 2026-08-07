import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalActivityReducer } from "../dist/activity/index.js";

test("structured signals reduce to ordered revisions and progress expires", () => {
  const reducer = createTerminalActivityReducer({ progressStaleMs: 10, now: () => 0 });
  const working = reducer.applySignal("session-a", { kind: "progress", state: 3 }, { projectId: "project-a", now: 0 });
  assert.equal(working.revision, 1);
  assert.equal(working.snapshot.status, "working");
  assert.equal(working.snapshot.claimed, true);
  assert.equal(reducer.snapshot().sessions["session-a"].projectId, "project-a");
  const expired = reducer.tick(10);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].revision, 2);
  assert.equal(reducer.snapshot().sessions["session-a"].status, "idle");
});

test("an isolated OSC progress completion claims canonical idle against raw fallback", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  const completion = reducer.applySignal("session-a", { kind: "progress", state: 0 }, {
    projectId: "project-a",
    now: 1,
  });
  assert.equal(completion.snapshot.status, "idle");
  assert.equal(completion.snapshot.claimed, true);
  assert.equal(completion.snapshot.authority, "structured");
  assert.equal(completion.snapshot.source, "structured:progress");
  assert.equal(reducer.applyRawOutput("session-a", { projectId: "project-a", now: 1 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"].status, "idle");
});

test("provider activity has precedence over structured and raw fallback", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  const provider = reducer.applyProviderActivity("session-a", {
    provider: "codex",
    state: "waiting",
    sequence: 4,
    agentId: "root",
  }, { now: 1 });
  assert.equal(provider.snapshot.authority, "provider");
  assert.equal(provider.snapshot.providerState, "waiting");
  assert.equal(provider.snapshot.attention, true);

  // Fallback signals are observed but cannot overwrite provider state/revision.
  assert.equal(reducer.applySignal("session-a", { kind: "progress", state: 3 }, { now: 2 }), undefined);
  assert.equal(reducer.applyRawOutput("session-a", { now: 3 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"].providerState, "waiting");
  assert.deepEqual(reducer.tick(60_000), []);
  assert.equal(reducer.snapshot().sessions["session-a"].providerState, "waiting");
  assert.equal(reducer.snapshot().sessions["session-a"].status, "idle");

  // Close protection remains tied to the real PTY foreground process even
  // when provider state owns presentation activity.
  const foreground = reducer.applySignal("session-a", { kind: "foreground", busy: true, processName: "codex" }, { now: 4 });
  assert.equal(foreground.snapshot.providerState, "waiting");
  assert.equal(foreground.snapshot.foregroundBusy, true);
  const shell = reducer.applySignal("session-a", { kind: "foreground", busy: false, processName: "zsh" }, { now: 5 });
  assert.equal(shell.snapshot.foregroundBusy, false);

  // Reordered and cross-run updates are fenced.
  assert.equal(reducer.applyProviderActivity("session-a", { provider: "codex", state: "working", sequence: 3 }, { now: 6 }), undefined);
  assert.equal(reducer.applyProviderActivity("session-a", { provider: "codex", state: "working", sequence: 5, agentId: "other" }, { now: 7 }), undefined);
});

test("terminal exit removes only its session and fences stale updates", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  reducer.applySignal("session-a", { kind: "command", phase: "executing" }, { projectId: "project-a", now: 1 });
  reducer.applySignal("session-b", { kind: "bell" }, { projectId: "project-b", now: 2 });
  const removed = reducer.markTerminalExit("session-a", { now: 3 });
  assert.equal(removed.type, "activity.removed");
  assert.deepEqual(Object.keys(reducer.snapshot().sessions), ["session-b"]);
  assert.equal(reducer.applyProviderActivity("session-a", { provider: "codex", state: "working" }, { now: 4 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"], undefined);
  const replay = reducer.replay(0);
  assert.equal(replay.kind, "events");
  assert.deepEqual(replay.events.map((event) => event.revision), [1, 2, 3]);
});

test("activity events are monotonic and cannot cross the immutable project binding", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  const first = reducer.applySignal("session-a", { kind: "command", phase: "executing" }, {
    projectId: "project-a",
    now: 20,
  });
  assert.equal(first.revision, 1);

  // A delayed PTY/fallback event must not rewind the canonical timestamp or
  // create a second revision after a newer event has already been committed.
  assert.equal(reducer.applyRawOutput("session-a", { projectId: "project-a", now: 19 }), undefined);
  assert.equal(reducer.tick(19).length, 0);
  assert.equal(reducer.snapshot().revision, 1);
  assert.equal(reducer.snapshot().sessions["session-a"].updatedAt, 20);

  // A caller with a copied session id cannot retarget activity to another
  // project. The rejected update must leave both state and revision intact.
  assert.equal(reducer.applySignal("session-a", { kind: "bell" }, { projectId: "project-b", now: 21 }), undefined);
  assert.equal(reducer.markViewed("session-a", { projectId: "project-b", now: 22 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"].projectId, "project-a");
  assert.equal(reducer.snapshot().revision, 1);
});

test("project-scoped terminal exit cannot fence or remove another project", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  reducer.register("session-a", "project-a", 1);
  assert.equal(reducer.markTerminalExit("session-a", { projectId: "project-b", now: 2 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"].projectId, "project-a");
  assert.equal(reducer.markTerminalExit("session-a", { projectId: "project-a", now: 3 }).type, "activity.removed");
  assert.equal(reducer.applySignal("session-a", { kind: "bell" }, { projectId: "project-a", now: 4 }), undefined);
});

test("provider hooks reject delayed and unsequenced updates after a claim", () => {
  const reducer = createTerminalActivityReducer({ now: () => 0 });
  const first = reducer.applyProviderActivity("session-a", {
    provider: "codex",
    state: "working",
    sequence: 10,
    agentId: "agent-a",
  }, { projectId: "project-a", now: 20 });
  assert.equal(first.revision, 1);
  assert.equal(reducer.applyProviderActivity("session-a", {
    provider: "codex",
    state: "waiting",
    sequence: 11,
    agentId: "agent-a",
  }, { projectId: "project-a", now: 19 }), undefined);
  assert.equal(reducer.applyProviderActivity("session-a", {
    provider: "codex",
    state: "waiting",
    agentId: "agent-a",
  }, { projectId: "project-a", now: 21 }), undefined);
  assert.equal(reducer.snapshot().sessions["session-a"].providerState, "working");
  assert.equal(reducer.snapshot().revision, 1);
});

test("bounded replay returns a complete snapshot when the delta is too old", () => {
  const reducer = createTerminalActivityReducer({ maxEvents: 2, now: () => 0 });
  reducer.applyRawOutput("a", { now: 1 });
  reducer.applyRawOutput("b", { now: 2 });
  reducer.applyRawOutput("c", { now: 3 });
  const replay = reducer.replay(0);
  assert.equal(replay.kind, "resync");
  assert.equal(replay.snapshot.revision, reducer.revision);
  assert.deepEqual(Object.keys(replay.snapshot.sessions), ["a", "b", "c"]);
});

test("raw PTY throughput refreshes expiry without publishing timestamp-only transitions", () => {
  const reducer = createTerminalActivityReducer({ rawActivityMs: 10, now: () => 0 });
  const first = reducer.applyRawOutput("session-a", { projectId: "project-a", now: 1 });
  assert.equal(first.revision, 1);
  assert.equal(first.snapshot.status, "working");
  for (let now = 2; now <= 2_000; now += 1) {
    assert.equal(reducer.applyRawOutput("session-a", { projectId: "project-a", now }), undefined);
  }
  assert.equal(reducer.revision, 1);
  assert.equal(reducer.get("session-a").updatedAt, 1);
  assert.deepEqual(reducer.tick(2_009), []);
  const idle = reducer.tick(2_010);
  assert.equal(idle.length, 1);
  assert.equal(idle[0].revision, 2);
  assert.equal(idle[0].snapshot.status, "idle");
  assert.equal(idle[0].snapshot.updatedAt, 2_010);
});
