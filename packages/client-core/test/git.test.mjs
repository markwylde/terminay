import assert from "node:assert/strict";
import test from "node:test";
import { GitStatusEventStore } from "../dist/index.js";

const progress = (revision, projectId = "project-a", patch = {}) => ({
  revision,
  cursor: String(revision),
  type: "git.progress",
  operation: "status",
  phase: "completed",
  projectId,
  repositoryId: "repo-a",
  worktreeId: "worktree-a",
  state: "ready",
  bounded: false,
  ...patch,
});

const status = (revision, projectId = "project-a", patch = {}) => ({
  revision,
  cursor: String(revision),
  type: "git.status.changed",
  projectId,
  repositoryId: "repo-a",
  worktreeId: "worktree-a",
  state: "ready",
  branch: "main",
  head: "abc123",
  changedFiles: 0,
  bounded: false,
  ...patch,
});

test("Git status client applies contiguous progress/status revisions and requests resync on gaps", () => {
  const store = new GitStatusEventStore({ projectId: "project-a" });
  const seen = [];
  store.subscribe((snapshot, result) => seen.push({ snapshot, result }));
  assert.deepEqual(store.applyEvent(progress(1)), { kind: "applied", revision: 1, changed: true });
  assert.deepEqual(store.applyEvent(status(2, "project-a", { changedFiles: 2 })), { kind: "applied", revision: 2, changed: true });
  assert.deepEqual(store.applyEvent(status(2, "project-a", { changedFiles: 2 })), { kind: "ignored", revision: 2, changed: false });
  assert.deepEqual(store.applyEvent(progress(4)), { kind: "resync_required", afterRevision: 2, receivedRevision: 4 });
  assert.equal(store.snapshot.revision, 2);
  assert.equal(store.snapshot.statuses["project-a\u0000repo-a\u0000worktree-a"].changedFiles, 2);
  assert.equal(seen.length, 2);
});

test("Git status client advances the global cursor without leaking other projects", () => {
  const store = new GitStatusEventStore({ projectId: "project-a" });
  store.applyEvents([progress(1, "project-b"), status(2, "project-b", { changedFiles: 5 }), progress(3, "project-a", { phase: "started" })]);
  assert.equal(store.revision, 3);
  assert.deepEqual(store.snapshot.statuses, {});
  assert.equal(store.snapshot.progress.projectId, "project-a");
  assert.equal(store.snapshot.progress.phase, "started");
});

test("Git status client rejects malformed revisions and unbounded metadata", () => {
  const store = new GitStatusEventStore();
  assert.throws(() => store.applyEvent({ ...progress(1), cursor: "wrong" }), /revision is invalid/);
  assert.throws(() => store.applyEvent({ ...status(1), changedFiles: -1 }), /status event is invalid/);
});
