import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  createCountingRunner,
  createFakeWatcher,
  createRepository,
  eventually,
  git,
  settle,
} from "./fixtures/git-observation.mjs";

/**
 * Git status follows watch events (ADR-0028). These count spawned Git commands
 * through the injectable runner and drive events through a fake watcher, so
 * "idle costs nothing" and "closed costs nothing" are exact assertions.
 */
async function observedService(t, { ramp = [0] } = {}) {
  const { GitService, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const fixture = await createRepository();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const runner = createCountingRunner(NodeGitCommandRunner);
  const watcher = createFakeWatcher();
  const service = new GitService({ runner, watcher, refreshRampMs: ramp });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => {
    if (event.type === "git.status.changed") events.push(event);
  });
  return { service, runner, watcher, fixture, events };
}

async function bindAndList(context, projectId = "project-a") {
  const { service, watcher, fixture } = context;
  await service.bindProject(projectId, fixture.main);
  await eventually(() => watcher.isWatching(fixture.gitDir), "Git directory watch was not established");
  return service.worktrees({ projectId });
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
  await settle();
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
  context.watcher.emit(second, "b.txt");
  await eventually(() => context.events.length > changed, "the edit published no status change");

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
  await settle();
  assert.deepEqual(context.runner.calls, [], "inert Git directory writes schedule nothing");

  context.watcher.emit(context.fixture.gitDir, "packed-refs");
  await eventually(
    () => context.runner.statusAgainst(second) > 0 && context.runner.statusAgainst(context.fixture.main) > 0,
    "packed-refs did not refresh every worktree",
  );

  await eventually(async () => {
    context.runner.calls.length = 0;
    await context.service.worktrees({ projectId: "project-a" });
    return context.runner.calls.length === 0;
  }, "the listing did not settle back to the cache");
  context.watcher.emit(context.fixture.gitDir, "worktrees/second/HEAD");
  await eventually(() => context.runner.statusAgainst(second) > 0, "linked HEAD did not refresh its worktree");
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
  await eventually(() => context.watcher.isWatching(third), "a new worktree was not watched");
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

  context.runner.calls.length = 0;
  await settle();
  assert.deepEqual(context.runner.calls, []);
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

  context.runner.calls.length = 0;
  await settle(300);
  assert.deepEqual(context.runner.calls, [], "no Git runs between client requests");

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
  context.watcher.emit(plain, ".git");
  await eventually(
    () => context.service.getBinding("project-p")?.state === "ready",
    "the new repository was not discovered",
  );
  assert.ok(
    context.events.some((event) => event.projectId === "project-p" && event.worktreeId === null),
    "clients are told to re-query",
  );
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
  context.watcher.emit(second, "x.txt");
  context.watcher.emit(second, "y.txt");
  context.service.close();
  assert.deepEqual(context.watcher.openPaths(), []);
  context.runner.calls.length = 0;
  await settle();
  assert.deepEqual(context.runner.calls, []);
});
