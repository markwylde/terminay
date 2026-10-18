import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createCountingRunner,
  createFakeWatcher,
  createManualTimers,
  createReportLog,
  createRepository,
  git,
} from "./fixtures/git-observation.mjs";

/**
 * Git status follows watch events (ADR-0028). These count spawned Git commands
 * through the injectable runner and drive events through a fake watcher, so
 * "idle costs nothing" and "closed costs nothing" are exact assertions. The
 * service's timers are held by the test, so nothing it arms fires unseen, and
 * each wait is on the report the service makes when it has finished.
 */
const FLUSH_MS = 5_000;

async function observedService(t, { ramp = [0] } = {}) {
  const { GitService, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const fixture = await createRepository();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const runner = createCountingRunner(NodeGitCommandRunner);
  const watcher = createFakeWatcher();
  const timers = createManualTimers();
  const log = createReportLog();
  const service = new GitService({
    runner,
    watcher,
    timers,
    refreshRampMs: ramp,
    observationFlushMs: FLUSH_MS,
    onObservation: (report) => log.onObservation(report),
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => {
    if (event.type === "git.status.changed") events.push(event);
  });
  return { service, runner, watcher, timers, log, fixture, events };
}

async function bindAndList(context, projectId = "project-a") {
  const { service, watcher, fixture } = context;
  await service.bindProject(projectId, fixture.main);
  await watcher.opened(fixture.gitDir);
  return service.worktrees({ projectId });
}

/** The measurement a watch event raises, resolved when it has finished. */
function watchMeasurement(context) {
  return context.log.next("measurement.completed", (report) => report.raisedBy === "watch");
}

async function addWorktree(fixture, name) {
  const path = join(fixture.root, name);
  await git(["worktree", "add", "-b", name, path], fixture.main);
  return path;
}

test("an idle observed repository runs no Git", async (t) => {
  const context = await observedService(t);
  const first = await bindAndList(context);
  assert.equal(first.state, "ready");

  context.runner.calls.length = 0;
  const again = await context.service.worktrees({ projectId: "project-a" });
  // Fire everything the service has armed: none of it may run Git.
  context.timers.advance(FLUSH_MS);
  assert.deepEqual(context.timers.pending(), [], "nothing is left armed");
  assert.deepEqual(context.runner.calls, [], "a clean cached listing must not spawn Git");
  assert.deepEqual(again.worktrees, first.worktrees);
});

test("an edit in one worktree refreshes only that worktree, and the follow-up listing is cached", async (t) => {
  const context = await observedService(t);
  const second = await addWorktree(context.fixture, "second");
  await bindAndList(context);
  assert.ok(context.watcher.isWatching(second), "every worktree's working tree is watched");

  context.runner.calls.length = 0;
  const changed = context.events.length;
  await writeFile(join(second, "b.txt"), "b\n");
  const measured = watchMeasurement(context);
  context.watcher.emit(second, "b.txt");
  await measured;
  assert.ok(context.events.length > changed, "the edit published a status change");

  assert.ok(context.runner.statusAgainst(second) > 0, "the edited worktree is measured");
  assert.equal(context.runner.statusAgainst(context.fixture.main), 0, "the other worktree is not measured");

  context.runner.calls.length = 0;
  const listing = await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(context.runner.calls, [], "listing after the event is served from the measurement");
  const edited = listing.worktrees.find((worktree) => worktree.path === second);
  assert.deepEqual(edited.entries.map((entry) => entry.path), ["b.txt"]);
});

test("a listing that overlaps a watch-driven refresh never caches summaries older than the change", async (t) => {
  const context = await observedService(t);
  const second = await addWorktree(context.fixture, "second");
  await bindAndList(context);

  await writeFile(join(second, "late.txt"), "late\n");
  context.watcher.emit(second, "late.txt");
  // Race the background refresh the event just started.
  const [overlapping] = await Promise.all([
    context.service.worktrees({ projectId: "project-a" }),
    context.service.worktrees({ projectId: "project-a" }),
  ]);
  const paths = (listing) =>
    listing.worktrees.find((worktree) => worktree.path === second).entries.map((entry) => entry.path);
  assert.deepEqual(paths(overlapping), ["late.txt"]);
  const cached = await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(paths(cached), ["late.txt"], "the cache must reflect the change");
});

test("Git directory changes are attributed: packed-refs refreshes every worktree, objects refresh none", async (t) => {
  const context = await observedService(t);
  const second = await addWorktree(context.fixture, "second");
  await bindAndList(context);

  context.runner.calls.length = 0;
  context.watcher.emit(context.fixture.gitDir, "objects/ab/cdef");
  context.watcher.emit(context.fixture.gitDir, "index.lock");
  context.watcher.emit(context.fixture.gitDir, "logs/HEAD");
  // A change that scheduled a refresh would have started it already, or left
  // the cache invalid; either way this listing would run Git.
  await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(context.runner.calls, [], "inert Git directory writes schedule nothing");

  const everything = watchMeasurement(context);
  context.watcher.emit(context.fixture.gitDir, "packed-refs");
  await everything;
  assert.ok(context.runner.statusAgainst(second) > 0, "packed-refs refreshed the linked worktree");
  assert.ok(context.runner.statusAgainst(context.fixture.main) > 0, "packed-refs refreshed the main worktree");

  context.runner.calls.length = 0;
  await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(context.runner.calls, [], "the listing after the refresh is the cache");
  const linkedHead = watchMeasurement(context);
  context.watcher.emit(context.fixture.gitDir, "worktrees/second/HEAD");
  await linkedHead;
  assert.ok(context.runner.statusAgainst(second) > 0, "linked HEAD refreshed its worktree");
  assert.equal(context.runner.statusAgainst(context.fixture.main), 0);
});

test("a mutation invalidates the cache and the watch set follows the worktree registry", async (t) => {
  const context = await observedService(t);
  const second = await addWorktree(context.fixture, "second");
  const first = await bindAndList(context);
  const target = first.worktrees.find((worktree) => worktree.path === second);

  const removed = await context.service.removeWorktree({
    projectId: "project-a",
    repositoryId: first.repositoryId,
    worktreeId: target.id,
  });
  assert.equal(removed.applied, true);

  context.runner.calls.length = 0;
  const after = await context.service.worktrees({ projectId: "project-a" });
  assert.ok(context.runner.calls.length > 0, "a listing after a mutation re-measures");
  assert.equal(after.worktrees.some((worktree) => worktree.path === second), false);
  assert.equal(context.watcher.isWatching(second), false, "a removed worktree is no longer watched");

  const third = await addWorktree(context.fixture, "third");
  context.watcher.emit(context.fixture.gitDir, "worktrees/third");
  // The refresh the registry change raises watches the new worktree.
  await context.watcher.opened(third);
});

test("projects sharing a repository share its watches until the last one is released", async (t) => {
  const context = await observedService(t);
  await bindAndList(context, "project-a");
  await context.service.bindProject("project-b", context.fixture.main);
  const watched = context.watcher.openPaths();

  assert.equal(context.service.releaseProject("project-a"), true);
  assert.deepEqual(context.watcher.openPaths(), watched, "the remaining project keeps its watches");
  await assert.rejects(context.service.worktrees({ projectId: "project-a" }), { code: "invalid-project" });

  assert.equal(context.service.releaseProject("project-b"), true);
  assert.deepEqual(context.watcher.openPaths(), [], "the last release closes every watch");
  // With no watch open, only an armed timer could run Git again.
  assert.deepEqual(context.timers.pending(), [], "nothing is left armed");
});

test("a failed watch leaves the repository measured on demand, never on a timer", async (t) => {
  const context = await observedService(t);
  await bindAndList(context);
  const before = context.events.length;

  context.watcher.fail(context.fixture.main);
  assert.deepEqual(context.watcher.openPaths(), [], "every watch of the repository is closed");
  const published = context.events.slice(before);
  assert.equal(published.length, 1, "exactly one status change asks clients to re-query");
  assert.equal(published[0].worktreeId, null, "the status change is unattributed");

  // With no watch open, only an armed timer could run Git between requests.
  assert.deepEqual(context.timers.pending(), [], "nothing is armed to run between client requests");
  context.runner.calls.length = 0;

  await context.service.worktrees({ projectId: "project-a" });
  const firstRequest = context.runner.calls.length;
  assert.ok(firstRequest > 0, "a request is measured");
  await context.service.worktrees({ projectId: "project-a" });
  assert.ok(context.runner.calls.length > firstRequest, "every request is measured, none cached");
});

test("a listing in flight when its project is released publishes and keeps nothing", async (t) => {
  const context = await observedService(t);
  await context.service.bindProject("project-a", context.fixture.main);
  const pending = context.service.worktrees({ projectId: "project-a" });
  context.service.releaseProject("project-a");
  const before = context.events.length;
  await pending.catch(() => undefined);
  assert.equal(context.events.length, before, "a released project publishes no status");
  assert.equal(context.service.getBinding("project-a"), undefined, "the binding is not resurrected");
  assert.deepEqual(context.watcher.openPaths(), []);
});

test("a project root that becomes a repository is picked up from its watch", async (t) => {
  const context = await observedService(t);
  const plain = join(context.fixture.root, "plain");
  await mkdir(plain);
  const binding = await context.service.bindProject("project-p", plain);
  assert.notEqual(binding.state, "ready");
  assert.ok(context.watcher.isWatching(plain), "a non-repository root is watched for .git");

  await git(["init", "-b", "main"], plain);
  // Clients are told to re-query once the new repository is bound.
  const told = new Promise((resolve) => {
    const stop = context.service.subscribe((event) => {
      if (event.type !== "git.status.changed" || event.projectId !== "project-p" || event.worktreeId !== null) return;
      stop();
      resolve();
    });
  });
  context.watcher.emit(plain, ".git");
  await told;
  assert.equal(context.service.getBinding("project-p")?.state, "ready", "the new repository was discovered");
  assert.equal(
    context.watcher.open().some((entry) => entry.path === plain && !entry.options.recursive),
    false,
    "the discovery watch is replaced by repository watches",
  );
});

test("close tears down every watch and schedule", async (t) => {
  const context = await observedService(t, { ramp: [60_000] });
  const second = await addWorktree(context.fixture, "second");
  await bindAndList(context);
  // The first event refreshes at once; the second waits out the interval.
  const abandoned = context.log.next("measurement.abandoned");
  context.watcher.emit(second, "x.txt");
  context.watcher.emit(second, "y.txt");
  assert.deepEqual(context.timers.pending(), [FLUSH_MS, 60_000], "the second event is scheduled, and its count is due to be reported");
  context.service.close();
  assert.deepEqual(context.watcher.openPaths(), []);
  assert.deepEqual(context.timers.pending(), [], "the scheduled refresh is cancelled");
  context.runner.calls.length = 0;
  // The refresh already running ends without spawning anything more.
  await abandoned;
  assert.deepEqual(context.runner.calls, []);
});
