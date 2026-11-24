import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCountingRunner,
  createFakeWatcher,
  createManualTimers,
  createReportLog,
  createRepository,
  eventually,
  git,
} from "./fixtures/git-observation.mjs";

/**
 * ADR-0141 and the readiness contract (design Decisions 1–4): a watched root
 * that goes away is a removal, not a failure; a listing is cached only under
 * watches that cover their whole scope; a lost observation re-arms only when a
 * client asks; and a status change is published whenever anything a listing
 * shows changed.
 */

// ---------------------------------------------------------------- native watch

/** An injectable stand-in for `fs.watch` and `lstat` on a native (kernel) watch. */
function fakeNativeFs({ stats } = {}) {
  const watchers = [];
  const state = {
    watchers,
    /** What `lstat` answers next: a stat, or an error to reject with. */
    stat: stats ?? { dev: 1, ino: 10, birthtimeMs: 5 },
    /** Holds `lstat` answers until `release()`, to race a close against them. */
    held: null,
    throwOnWatch: null,
  };
  const answer = () =>
    state.stat instanceof Error
      ? Promise.reject(state.stat)
      : Promise.resolve({ isDirectory: () => true, ...state.stat });
  return {
    state,
    release() {
      const held = state.held;
      state.held = null;
      for (const resolve of held ?? []) resolve();
    },
    hold() {
      state.held = [];
    },
    watch(_path, _options, listener) {
      if (state.throwOnWatch) throw state.throwOnWatch;
      const watcher = new EventEmitter();
      watcher.listener = listener;
      watcher.closed = false;
      watcher.close = () => {
        if (watcher.closed) return;
        watcher.closed = true;
        watcher.emit("close");
      };
      watchers.push(watcher);
      return watcher;
    },
    lstat() {
      if (state.held === null) return answer();
      return new Promise((resolve) => state.held.push(resolve)).then(answer);
    },
  };
}

const enoent = () => Object.assign(new Error("gone"), { code: "ENOENT" });

async function nativeWatch(t, fs, root = "/repo/worktree") {
  const { NodeGitStateWatcher } = await import("../dist/gitService/index.js");
  const changes = [];
  const errors = [];
  let ready = 0;
  const handle = new NodeGitStateWatcher({ platform: "darwin", nativeFs: fs }).watch(root, {
    recursive: true,
    onChange: (entry) => changes.push(entry),
    onError: (error) => errors.push(error),
    onReady: () => {
      ready += 1;
    },
  });
  t.after(() => handle.close());
  // Let the identity stat and the ready notification land.
  await new Promise((resolve) => setImmediate(resolve));
  return { handle, changes, errors, ready: () => ready, watcher: fs.state.watchers.at(-1) };
}

const settleNative = () => new Promise((resolve) => setImmediate(resolve));

test("native watch: ready once open, and never after close", async (t) => {
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  assert.equal(watch.ready(), 1);
  const closedEarly = await (async () => {
    const { NodeGitStateWatcher } = await import("../dist/gitService/index.js");
    let ready = 0;
    const handle = new NodeGitStateWatcher({ platform: "darwin", nativeFs: fs }).watch("/x", {
      recursive: true,
      onChange() {},
      onError() {},
      onReady: () => {
        ready += 1;
      },
    });
    handle.close();
    await settleNative();
    return ready;
  })();
  assert.equal(closedEarly, 0);
});

test("native watch: a rename of the root that is gone reports the root gone", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.state.stat = enoent();
  watch.watcher.listener("rename", "worktree");
  await settleNative();
  assert.equal(watch.errors.length, 1);
  assert.ok(isWatchedRootGone(watch.errors[0]));
  assert.deepEqual(watch.changes, []);
});

test("native watch: a rename with no name, onto a replaced root, reports the root gone", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.state.stat = { dev: 1, ino: 11, birthtimeMs: 5 };
  watch.watcher.listener("rename", null);
  await settleNative();
  assert.ok(isWatchedRootGone(watch.errors[0]));
});

test("native watch: a same-inode root recreated later (new birth time) is replaced", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.state.stat = { dev: 1, ino: 10, birthtimeMs: 6 };
  watch.watcher.listener("rename", "worktree");
  await settleNative();
  assert.ok(isWatchedRootGone(watch.errors[0]));
});

test("native watch: a rename naming the root while the root is still there is a change", async (t) => {
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  watch.watcher.listener("rename", "worktree");
  watch.watcher.listener("rename", "src/a.txt");
  await settleNative();
  assert.deepEqual(watch.errors, []);
  assert.deepEqual(watch.changes.sort(), ["src/a.txt", "worktree"]);
});

test("native watch: an error with the root still there is reported as that error", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  const error = Object.assign(new Error("stream broke"), { code: "EIO" });
  watch.watcher.emit("error", error);
  await settleNative();
  assert.equal(watch.errors.length, 1);
  assert.equal(watch.errors[0], error);
  assert.equal(isWatchedRootGone(watch.errors[0]), false);
});

test("native watch: an unexpected close with the root gone reports the root gone", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.state.stat = enoent();
  watch.watcher.emit("close");
  await settleNative();
  assert.ok(isWatchedRootGone(watch.errors[0]));
});

test("native watch: an unexpected close with the root still there is a failure", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  watch.watcher.emit("close");
  await settleNative();
  assert.equal(watch.errors.length, 1);
  assert.equal(isWatchedRootGone(watch.errors[0]), false);
  assert.match(watch.errors[0].message, /watch closed/u);
});

test("native watch: a root check that cannot stat for another reason reports the original error", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.state.stat = Object.assign(new Error("denied"), { code: "EACCES" });
  const error = Object.assign(new Error("stream broke"), { code: "EIO" });
  watch.watcher.emit("error", error);
  await settleNative();
  assert.equal(watch.errors[0], error);
  assert.equal(isWatchedRootGone(watch.errors[0]), false);
});

test("native watch: closing it reports nothing, even with a root check in flight", async (t) => {
  const fs = fakeNativeFs();
  const watch = await nativeWatch(t, fs);
  fs.hold();
  fs.state.stat = enoent();
  watch.watcher.listener("rename", "worktree");
  watch.handle.close();
  fs.release();
  await settleNative();
  await settleNative();
  assert.deepEqual(watch.errors, []);
  assert.deepEqual(watch.changes, []);
});

test("native watch: a root already gone when watched reports the root gone", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const fs = fakeNativeFs();
  fs.state.throwOnWatch = enoent();
  const watch = await nativeWatch(t, fs);
  assert.equal(watch.errors.length, 1);
  assert.ok(isWatchedRootGone(watch.errors[0]));
});

test("host watch: deleting the watched root reports the root gone", async (t) => {
  const { NodeGitStateWatcher, isWatchedRootGone } = await import("../dist/gitService/index.js");
  const parent = await realpath(await mkdtemp(join(tmpdir(), "terminay-root-gone-")));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "worktree");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.txt"), "a\n");
  const errors = [];
  let ready = false;
  const handle = new NodeGitStateWatcher().watch(root, {
    recursive: true,
    onChange() {},
    onError: (error) => errors.push(error),
    onReady: () => {
      ready = true;
    },
  });
  t.after(() => handle.close());
  await eventually(() => ready, "the watch became ready");
  await rm(root, { recursive: true, force: true });
  await eventually(() => errors.length > 0, "the deletion was reported");
  assert.ok(isWatchedRootGone(errors[0]), `reported as root gone: ${errors[0]}`);
});

// ------------------------------------------------------------------ tree watch

async function treeWatch(t, { layout, fs: fsOverride } = {}) {
  const { createTreeWatch } = await import("../dist/gitService/treeWatch.js");
  const nodeFs = await import("node:fs");
  const fsp = await import("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "terminay-tree-ready-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of layout ?? []) await mkdir(join(root, dir), { recursive: true });
  const armed = [];
  const fs = {
    watch(path, options, listener) {
      if (fsOverride?.watch) fsOverride.watch(path);
      armed.push(path);
      return nodeFs.watch(path, options, listener);
    },
    lstat: (path) => fsp.lstat(path),
    opendir: (path, options) => fsp.opendir(path, options),
  };
  const errors = [];
  const readyAt = [];
  const handle = createTreeWatch(
    root,
    {
      recursive: true,
      onChange() {},
      onError: (error) => errors.push(error),
      onReady: () => readyAt.push(armed.length),
    },
    { fs },
  );
  t.after(() => handle.close());
  return { root, handle, errors, readyAt, armed };
}

test("tree watch: ready once, only after every directory is armed", async (t) => {
  const layout = ["a", "a/b", "a/b/c", "d", "d/e"];
  const watch = await treeWatch(t, { layout });
  await eventually(() => watch.readyAt.length > 0, "the watch became ready");
  assert.deepEqual(watch.readyAt, [layout.length + 1], "every directory and the root were armed first");
  await mkdir(join(watch.root, "f"));
  await eventually(() => watch.armed.length === layout.length + 2, "a new directory is armed");
  assert.equal(watch.readyAt.length, 1, "readiness is reported once");
  assert.deepEqual(watch.errors, []);
});

test("tree watch: a root gone before it is armed reports the root gone", async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const watch = await treeWatch(t, {
    fs: {
      watch() {
        throw enoent();
      },
    },
  });
  await eventually(() => watch.errors.length > 0, "the failure was reported");
  assert.ok(isWatchedRootGone(watch.errors[0]));
  assert.deepEqual(watch.readyAt, []);
});

test("tree watch: deleting the root after it is ready reports the root gone", { skip: process.platform !== "linux" && "inotify only" }, async (t) => {
  const { isWatchedRootGone } = await import("../dist/gitService/index.js");
  const watch = await treeWatch(t, { layout: ["a"] });
  await eventually(() => watch.readyAt.length > 0, "the watch became ready");
  await rm(watch.root, { recursive: true, force: true });
  await eventually(() => watch.errors.length > 0, "the deletion was reported");
  assert.ok(isWatchedRootGone(watch.errors[0]));
});

// --------------------------------------------------------------------- service

async function observedService(t, { holdReady = false } = {}) {
  const { GitService, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const fixture = await createRepository();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const runner = createCountingRunner(NodeGitCommandRunner);
  const watcher = createFakeWatcher({ holdReady });
  const timers = createManualTimers();
  const log = createReportLog();
  const service = new GitService({
    runner,
    watcher,
    timers,
    refreshRampMs: [0],
    onObservation: (report) => log.onObservation(report),
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => {
    if (event.type === "git.status.changed") events.push(event);
  });
  return { service, runner, watcher, timers, log, fixture, events };
}

async function addLinked(fixture, name = "linked") {
  const path = join(fixture.root, name);
  await git(["worktree", "add", "-b", name, path], fixture.main);
  await writeFile(join(path, "b.txt"), "1\n2\n");
  await git(["add", "."], path);
  await git(["commit", "-m", name], path);
  return path;
}

const measuredReports = (log) => log.reports.filter((report) => report.kind === "measurement.completed");

test("the listed-summary fingerprint changes with every field and only then", async () => {
  const { listedSummaryFingerprint } = await import("../dist/gitService/index.js");
  const base = {
    id: "w1",
    repositoryId: "r1",
    path: "/repo",
    branch: "main",
    detached: false,
    head: "abc",
    isMain: true,
    isBare: false,
    isPrunable: false,
    locked: false,
    state: "ready",
    aheadOfDefaultBranchCount: 0,
    lineAdditions: 0,
    lineDeletions: 0,
    hasCommittedChanges: false,
    hasUnpushedCommits: false,
    unpushedLineAdditions: 0,
    unpushedLineDeletions: 0,
    entries: [],
  };
  const fingerprint = listedSummaryFingerprint(base);
  assert.equal(listedSummaryFingerprint({ ...base }), fingerprint, "equal summaries match");
  const variants = {
    id: "w2",
    repositoryId: "r2",
    path: "/other",
    branch: "feature",
    detached: true,
    head: "def",
    isMain: false,
    isBare: true,
    isPrunable: true,
    locked: true,
    state: "error",
    aheadOfDefaultBranchCount: 1,
    lineAdditions: 1,
    lineDeletions: 1,
    hasCommittedChanges: true,
    hasUnpushedCommits: true,
    unpushedLineAdditions: 1,
    unpushedLineDeletions: 1,
    entries: [{ path: "a.txt", state: "modified" }],
    error: { code: "x", message: "y" },
  };
  for (const [field, value] of Object.entries(variants))
    assert.notEqual(listedSummaryFingerprint({ ...base, [field]: value }), fingerprint, `${field} is compared`);
});

test("re-measuring an unchanged worktree publishes nothing, however status and listings interleave", async (t) => {
  const context = await observedService(t);
  await addLinked(context.fixture);
  await context.service.bindProject("project-a", context.fixture.main);
  const first = await context.service.worktrees({ projectId: "project-a" });
  const interleave = async () => {
    for (const worktree of first.worktrees) {
      await context.service.status({ projectId: "project-a", repositoryId: worktree.repositoryId, worktreeId: worktree.id });
      await context.service.worktrees({ projectId: "project-a", fresh: true });
    }
  };
  // Each worktree's first status() announces it once; after that, nothing.
  await interleave();
  const before = context.events.length;
  await interleave();
  const measured = context.log.next("measurement.completed", (report) => report.raisedBy === "watch");
  context.watcher.emit(context.fixture.main, "a.txt");
  await measured;
  assert.equal(context.events.length, before, "nothing shown changed, so nothing was published");
});

test("a working tree whose root is gone when its watch arms leaves the repository observed", async (t) => {
  const { WatchedRootGoneError } = await import("../dist/gitService/index.js");
  const context = await observedService(t);
  const linked = await addLinked(context.fixture);
  await context.service.bindProject("project-a", context.fixture.main);
  await context.service.worktrees({ projectId: "project-a" });
  assert.ok(context.watcher.isWatching(linked));

  const remeasured = context.log.next("measurement.completed", (report) => report.raisedBy === "watch");
  context.watcher.fail(linked, new WatchedRootGoneError());
  assert.equal(context.watcher.isWatching(linked), false, "only the gone root's watch is closed");
  assert.ok(context.watcher.isWatching(context.fixture.gitDir), "the Git directory is still watched");
  assert.ok(context.watcher.isWatching(context.fixture.main), "the main working tree is still watched");
  const report = await remeasured;
  assert.equal(report.claim, "all", "the whole repository is re-listed");
  assert.deepEqual(context.log.reports.filter((entry) => entry.kind === "watch.failed"), []);
  assert.equal(report.cached, true, "the observation is still trusted");
});

test("a listing waits for its watches to be ready, and is measured once and cached", async (t) => {
  const context = await observedService(t, { holdReady: true });
  await context.service.bindProject("project-a", context.fixture.main);
  await context.watcher.opened(context.fixture.gitDir);
  let settled = false;
  const listing = context.service.worktrees({ projectId: "project-a" }).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the listing waits while a watch is still arming");
  assert.equal(context.runner.statusAgainst(context.fixture.main), 0, "nothing is measured before the watches are ready");

  // A file written before the watch covers it is in the measurement.
  await writeFile(join(context.fixture.main, "early.txt"), "early\n");
  context.watcher.ready(context.fixture.gitDir);
  context.watcher.ready(context.fixture.main);
  const result = await listing;
  assert.ok(result.worktrees[0].entries.some((entry) => entry.path === "early.txt"));

  await context.service.worktrees({ projectId: "project-a" });
  const measured = measuredReports(context.log);
  assert.equal(measured.length, 1, "the second listing is answered from the cache");
  assert.equal(measured[0].cached, true);
});

test("a watch that fails after it was ready drops the cache, and the next listing is measured", async (t) => {
  const context = await observedService(t);
  await context.service.bindProject("project-a", context.fixture.main);
  await context.service.worktrees({ projectId: "project-a" });
  context.watcher.refuse();
  context.watcher.fail(context.fixture.main);
  context.runner.calls.length = 0;
  await context.service.worktrees({ projectId: "project-a" });
  assert.ok(context.runner.statusAgainst(context.fixture.main) > 0, "measured, not served from the dropped cache");
});

test("each listing against a host that cannot watch makes one re-arm attempt, and nothing runs in between", async (t) => {
  const context = await observedService(t);
  await context.service.bindProject("project-a", context.fixture.main);
  await context.service.worktrees({ projectId: "project-a" });
  context.watcher.refuse();
  context.watcher.fail(context.fixture.gitDir);
  const opened = () => context.watcher.entries.length;

  const attempts = [];
  for (let round = 0; round < 3; round++) {
    const before = opened();
    await context.service.worktrees({ projectId: "project-a" });
    // One attempt per request: the first refused watch ends it.
    attempts.push(opened() - before);
    assert.ok(attempts[round] >= 1, `round ${round} attempted a re-arm`);
    assert.equal(attempts[round], attempts[0], "every request makes the same single attempt");
    assert.deepEqual(context.timers.pending(), [], "no timer stands in for the watch");
    const idle = context.runner.calls.length;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.runner.calls.length, idle, "no Git runs between requests");
  }
});

test("tree watch: ready while files keep changing, once every directory is armed", async (t) => {
  const layout = ["a", "a/b", "c"];
  const watch = await treeWatch(t, { layout });
  // Writes start before discovery finishes and never stop while readiness is awaited.
  let writing = true;
  const writer = (async () => {
    for (let round = 0; writing; round++)
      await Promise.all(Array.from({ length: 20 }, (_, index) => writeFile(join(watch.root, `f${index}.txt`), `${round}`)));
  })();
  t.after(async () => {
    writing = false;
    await writer;
  });
  await eventually(() => watch.readyAt.length > 0, "readiness waited for writes to stop");
  assert.ok(writing, "ready while the writes were still running");
  assert.deepEqual(watch.readyAt, [layout.length + 1]);
  writing = false;
  await writer;
});

test("a listing that waits through a rebind waits for the new binding's watches", async (t) => {
  const context = await observedService(t, { holdReady: true });
  const other = await createRepository();
  t.after(() => rm(other.root, { recursive: true, force: true }));
  await context.service.bindProject("project-a", context.fixture.main);
  await context.watcher.opened(context.fixture.gitDir);
  let settled = false;
  const listing = context.service.worktrees({ projectId: "project-a" }).then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));

  await context.service.bindProject("project-a", other.main);
  await context.watcher.opened(other.gitDir);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the listing still waits: the new binding's watches are not ready");
  assert.equal(context.runner.statusAgainst(other.main), 0, "nothing is measured under unready watches");

  context.watcher.ready(other.gitDir);
  context.watcher.ready(other.main);
  const result = await listing;
  assert.equal(result.worktrees[0].path, other.main);
});

test("a re-arm reached through a scoped request re-measures every worktree", async (t) => {
  const context = await observedService(t);
  const linked = await addLinked(context.fixture);
  await context.service.bindProject("project-a", context.fixture.main);
  const first = await context.service.worktrees({ projectId: "project-a" });
  const main = first.worktrees.find((worktree) => worktree.path === context.fixture.main);

  context.watcher.refuse();
  context.watcher.fail(context.fixture.gitDir);
  // Measured on demand while nothing watches; that consumes what was owed.
  await context.service.worktrees({ projectId: "project-a" });
  // A change nobody sees: the watches are still refused.
  await writeFile(join(linked, "missed.txt"), "missed\n");

  context.watcher.refuse(null);
  await context.service.worktrees({ projectId: "project-a", worktreeId: main.id });
  const after = await context.service.worktrees({ projectId: "project-a" });
  const sibling = after.worktrees.find((worktree) => worktree.path === linked);
  assert.ok(
    sibling.entries.some((entry) => entry.path === "missed.txt"),
    "the sibling changed while unwatched is re-measured, not carried forward",
  );
});
