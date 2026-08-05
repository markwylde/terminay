import assert from "node:assert/strict";
import test from "node:test";
import { ActivitySnapshotStore } from "../dist/index.js";

const session = (sessionId, projectId = "project-a", patch = {}) => ({
  sessionId,
  projectId,
  status: "idle",
  attention: false,
  acknowledged: true,
  claimed: false,
  authority: "none",
  source: "init",
  updatedAt: 1,
  ...patch,
});

const snapshot = (revision, sessions) => ({ revision, cursor: String(revision), sessions });

test("activity client applies snapshots/events, surfaces replay gaps, and resyncs without duplicate transitions", () => {
  const store = new ActivitySnapshotStore({ projectId: "project-a" });
  const changes = [];
  store.subscribe((value, result) => changes.push({ value, result }));

  assert.equal(store.applySnapshot(snapshot(1, { "session-a": session("session-a") })).kind, "applied");
  const event = { revision: 2, cursor: "2", type: "activity.changed", sessionId: "session-a", snapshot: session("session-a", "project-a", { status: "working", authority: "provider", claimed: true, source: "journal:codex", provider: "codex", providerState: "working", agentId: "agent-a", updatedAt: 2 }) };
  assert.deepEqual(store.applyEvent(event), { kind: "applied", revision: 2, changed: true });
  assert.deepEqual(store.applyEvent(event), { kind: "ignored", revision: 2, changed: false });
  const gap = store.applyEvent({ ...event, revision: 4, cursor: "4" });
  assert.deepEqual(gap, { kind: "resync_required", afterRevision: 2, receivedRevision: 4 });
  assert.equal(store.snapshot.revision, 2);

  assert.deepEqual(store.applyReplay({ kind: "resync", events: [], snapshot: snapshot(4, { "session-a": event.snapshot }) }), { kind: "applied", revision: 4, changed: true });
  assert.equal(store.snapshot.sessions["session-a"].provider, "codex");
  assert.equal(changes.length, 3);
});

test("activity client filters other projects, keeps global cursor, and removes only exited sessions", () => {
  const store = new ActivitySnapshotStore({ projectId: "project-a" });
  store.applySnapshot(snapshot(1, {
    "session-a": session("session-a", "project-a"),
    "session-b": session("session-b", "project-b", { status: "working" }),
  }));
  assert.deepEqual(Object.keys(store.snapshot.sessions), ["session-a"]);

  const crossProject = store.applyEvent({ revision: 2, cursor: "2", type: "activity.changed", sessionId: "session-b", snapshot: session("session-b", "project-b", { status: "idle", updatedAt: 2 }) });
  assert.deepEqual(crossProject, { kind: "ignored", revision: 2, changed: false });
  assert.equal(store.revision, 2);
  assert.deepEqual(Object.keys(store.snapshot.sessions), ["session-a"]);

  const exit = store.applyEvent({ revision: 3, cursor: "3", type: "activity.removed", sessionId: "session-a" });
  assert.deepEqual(exit, { kind: "applied", revision: 3, changed: true });
  assert.deepEqual(Object.keys(store.snapshot.sessions), []);
  assert.equal(store.applyEvent({ revision: 2, cursor: "2", type: "activity.removed", sessionId: "session-b" }).kind, "ignored");
});

test("activity client rejects malformed or cross-project retargeting snapshots", () => {
  const store = new ActivitySnapshotStore({ projectId: "project-a" });
  assert.throws(() => store.applySnapshot({ revision: 1, cursor: "wrong", sessions: {} }), /snapshot is invalid/);
  assert.throws(() => store.applyEvent({ revision: 1, cursor: "1", type: "activity.changed", sessionId: "session-a", snapshot: session("session-b") }), /session mismatch/);
});
