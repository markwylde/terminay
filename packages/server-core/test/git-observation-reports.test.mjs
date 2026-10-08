import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
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
 * The Git service reports its observation lifecycle to its host. These drive
 * events through a fake watcher so each report can be tied to the exact event
 * that raised it; the real watcher is covered separately.
 */
const LINKED_BRANCH = "feature-zebra";
const LINKED_DIRECTORY = "sibling-tree";

async function reportingService(t, { flushMs = 20, onObservation, wrapRunner, refreshRampMs = [0] } = {}) {
  const { GitService, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const fixture = await createRepository();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const counting = createCountingRunner(NodeGitCommandRunner);
  const runner = wrapRunner === undefined ? counting : wrapRunner(counting);
  const watcher = createFakeWatcher();
  const reports = [];
  const service = new GitService({
    runner,
    watcher,
    refreshRampMs,
    observationFlushMs: flushMs,
    onObservation: onObservation ?? ((report) => reports.push(report)),
  });
  t.after(() => service.close());
  return { service, runner: counting, watcher, fixture, reports };
}

async function bindAndList(context, projectId = "project-a") {
  await context.service.bindProject(projectId, context.fixture.main);
  await eventually(() => context.watcher.isWatching(context.fixture.gitDir), "Git directory watch was not established");
  return context.service.worktrees({ projectId });
}

/** A linked worktree one commit, three lines, ahead of the default branch. */
async function addLinkedWorktree(fixture) {
  const path = join(fixture.root, LINKED_DIRECTORY);
  await git(["worktree", "add", "-b", LINKED_BRANCH, path], fixture.main);
  await writeFile(join(path, "b.txt"), "1\n2\n3\n");
  await git(["add", "."], path);
  await git(["commit", "-m", "linked"], path);
  return path;
}

const of = (reports, kind) => reports.filter((report) => report.kind === kind);
const last = (reports, kind) => of(reports, kind).at(-1);

test("every watch reports when it opens and when it closes", async (t) => {
  const context = await reportingService(t);
  await bindAndList(context);
  assert.deepEqual(
    of(context.reports, "watch.opened").map((report) => report.watch).sort(),
    ["git-directory", "working-tree"],
  );
  for (const report of of(context.reports, "watch.opened")) {
    assert.match(report.repository, /^r\d+$/u);
    assert.equal(report.recursive, true);
  }

  const linked = join(context.fixture.root, LINKED_DIRECTORY);
  await git(["worktree", "add", "-b", LINKED_BRANCH, linked], context.fixture.main);
  context.watcher.emit(context.fixture.gitDir, `worktrees/${LINKED_DIRECTORY}`);
  await eventually(() => context.watcher.isWatching(linked), "the new worktree was not watched");
  assert.equal(of(context.reports, "watch.opened").length, 3);

  await git(["worktree", "remove", linked], context.fixture.main);
  context.watcher.emit(context.fixture.gitDir, "worktrees");
  await eventually(() => !context.watcher.isWatching(linked), "the removed worktree stayed watched");
  assert.equal(of(context.reports, "watch.closed").length, 1);
  assert.equal(last(context.reports, "watch.closed").watch, "working-tree");

  context.service.releaseProject("project-a");
  assert.equal(of(context.reports, "watch.closed").length, of(context.reports, "watch.opened").length);
  assert.deepEqual(context.watcher.openPaths(), []);
});

test("a failed watch reports the error it was given, and the repository is then measured on demand", async (t) => {
  const context = await reportingService(t);
  await bindAndList(context);

  context.watcher.fail(context.fixture.gitDir);
  const failed = last(context.reports, "watch.failed");
  assert.equal(failed.watch, "git-directory");
  assert.equal(failed.recursive, true);
  assert.deepEqual(failed.error, { code: "ENOSPC", message: "watch limit" });
  assert.match(failed.repository, /^r\d+$/u);
  assert.equal(of(context.reports, "watch.closed").length, of(context.reports, "watch.opened").length);

  context.runner.calls.length = 0;
  await context.service.worktrees({ projectId: "project-a" });
  assert.ok(context.runner.statusAgainst(context.fixture.main) > 0, "an unwatched repository is measured when asked");
  assert.equal(last(context.reports, "measurement.completed").cached, false);
});

test("an observer that throws changes no result", async (t) => {
  const quiet = await reportingService(t);
  const throwing = await reportingService(t, {
    onObservation: () => {
      throw new Error("host observer failed");
    },
  });
  for (const context of [quiet, throwing]) {
    await addLinkedWorktree(context.fixture);
    await bindAndList(context);
    await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
    context.watcher.emit(context.fixture.gitDir, "refs/heads/main");
    await eventually(async () => {
      const listing = await context.service.worktrees({ projectId: "project-a" });
      return listing.worktrees.every((worktree) => worktree.lineAdditions === 0);
    }, "the default-branch move was not measured");
  }
  const shape = async (context) =>
    (await context.service.worktrees({ projectId: "project-a" })).worktrees.map((worktree) => ({
      isMain: worktree.isMain,
      state: worktree.state,
      ahead: worktree.aheadOfDefaultBranchCount,
      additions: worktree.lineAdditions,
      deletions: worktree.lineDeletions,
    }));
  assert.deepEqual(await shape(throwing), await shape(quiet));
});

test("changes that invalidate nothing are reported once, as counts, without running Git", async (t) => {
  const context = await reportingService(t, { flushMs: 60 });
  await bindAndList(context);
  await settle(120);
  context.reports.length = 0;
  context.runner.calls.length = 0;

  for (const entry of ["index.lock", "refs/heads/main.lock", "HEAD.lock", "objects/ab/cd", "logs/HEAD"])
    context.watcher.emit(context.fixture.gitDir, entry);
  assert.deepEqual(context.reports, [], "a burst is not reported event by event");

  await eventually(() => of(context.reports, "changes").length > 0, "the counted changes were never reported");
  await settle(120);
  assert.equal(context.reports.length, 1);
  assert.deepEqual(context.reports[0].changes, {
    byClass: { lock: 3, inert: 2 },
    byScope: { ignore: 5 },
    cachedListingsServed: 0,
  });
  assert.deepEqual(context.runner.calls, [], "reporting runs no Git");
});

test("a default-branch move reports its class, its scope, and every worktree re-measured", async (t) => {
  const context = await reportingService(t);
  await addLinkedWorktree(context.fixture);
  const first = await bindAndList(context);
  const linkedBefore = first.worktrees.find((worktree) => !worktree.isMain);
  assert.equal(linkedBefore.lineAdditions, 3);
  const firstMeasured = last(context.reports, "measurement.completed");
  const linkedDiagnostic = firstMeasured.worktrees.find((worktree) => worktree.role === "linked");
  assert.deepEqual(
    { additions: linkedDiagnostic.additions, ahead: linkedDiagnostic.ahead, listIndex: linkedDiagnostic.listIndex },
    { additions: 3, ahead: 1, listIndex: 1 },
  );

  // A cached answer is counted, not measured.
  await context.service.worktrees({ projectId: "project-a" });
  const before = of(context.reports, "measurement.completed").length;

  await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
  context.watcher.emit(context.fixture.gitDir, "refs/heads/main");
  await eventually(() => of(context.reports, "measurement.completed").length > before, "the move raised no measurement");

  const moved = last(context.reports, "measurement.completed");
  assert.equal(moved.raisedBy, "watch");
  assert.equal(moved.claim, "all");
  assert.equal(moved.trusted, true);
  assert.equal(moved.remeasured, 2);
  assert.equal(moved.carried, 0);
  assert.equal(moved.cached, true);
  assert.equal(moved.changes.byClass["default-branch-ref"], 1);
  assert.equal(moved.changes.byScope.all, 1);
  const cachedServed = [...of(context.reports, "changes"), moved].reduce(
    (total, report) => total + report.changes.cachedListingsServed,
    0,
  );
  assert.equal(cachedServed, 1, "the cached answer is counted exactly once");
  assert.equal(typeof moved.durationMs, "number");

  const linkedAfter = moved.worktrees.find((worktree) => worktree.role === "linked");
  assert.equal(linkedAfter.id, linkedDiagnostic.id, "a worktree keeps its diagnostic id");
  assert.deepEqual({ additions: linkedAfter.additions, ahead: linkedAfter.ahead }, { additions: 0, ahead: 0 });

  // The main worktree's head moved, so its event is published. The linked
  // worktree's delta changed but its status did not, so its event is not.
  assert.equal(moved.published, 1);
  assert.equal(moved.suppressed, 1);
});

test("an edit in one worktree reports the others carried forward", async (t) => {
  const context = await reportingService(t);
  const linked = await addLinkedWorktree(context.fixture);
  await bindAndList(context);
  const before = of(context.reports, "measurement.completed").length;

  await writeFile(join(linked, "c.txt"), "c\n");
  context.watcher.emit(linked, "c.txt");
  await eventually(() => of(context.reports, "measurement.completed").length > before, "the edit raised no measurement");

  const edited = last(context.reports, "measurement.completed");
  assert.equal(edited.claim, "scoped");
  assert.equal(edited.remeasured, 1);
  assert.equal(edited.carried, 1);
  assert.equal(edited.worktrees[0].role, "linked");
  assert.equal(edited.worktrees[0].changedFiles, 1);
  assert.deepEqual(edited.changes.byClass, { "working-tree": 1 });
  assert.deepEqual(edited.changes.byScope, { worktrees: 1 });
});

test("a change that arrives during a measurement is reported by the measurement that claims it", async (t) => {
  // A fast-forward writes the index before the branch ref. The index event
  // starts a measurement scoped to the main worktree; the ref event lands
  // while it runs and belongs to the full measurement that follows.
  let duringStatus;
  const context = await reportingService(t, {
    wrapRunner: (inner) => ({
      async run(args, cwd, options) {
        if (args.includes("status")) duringStatus?.();
        return inner.run(args, cwd, options);
      },
    }),
  });
  await addLinkedWorktree(context.fixture);
  await bindAndList(context);
  context.reports.length = 0;

  await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
  duringStatus = () => {
    duringStatus = undefined;
    context.watcher.emit(context.fixture.gitDir, "refs/heads/main");
  };
  context.watcher.emit(context.fixture.gitDir, "index");
  await eventually(() => of(context.reports, "measurement.completed").length >= 2, "the ref move was never measured");

  const [first, second] = of(context.reports, "measurement.completed");
  assert.deepEqual({ claim: first.claim, carried: first.carried }, { claim: "scoped", carried: 1 });
  assert.deepEqual(first.changes.byClass, { index: 1 });
  assert.deepEqual({ claim: second.claim, carried: second.carried }, { claim: "all", carried: 0 });
  assert.deepEqual(second.changes.byClass, { "default-branch-ref": 1 });
  assert.equal(second.worktrees.find((worktree) => worktree.role === "linked").additions, 0);
});

test("a listing that names one worktree does not narrow a claim on every worktree", async (t) => {
  // A fast-forward writes the index before the branch ref. The index event is
  // measured at once and announces the main worktree. A client answers that
  // announcement with a listing naming the main worktree, and by then the ref
  // has moved: the watch's own refresh is still waiting out its interval, so
  // the client's listing is the one holding the claim on every worktree.
  const context = await reportingService(t, { refreshRampMs: [0, 60_000] });
  await addLinkedWorktree(context.fixture);
  const first = await bindAndList(context);
  const main = first.worktrees.find((worktree) => worktree.isMain);
  assert.equal(first.worktrees.find((worktree) => !worktree.isMain).lineAdditions, 3);
  context.reports.length = 0;

  await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
  context.watcher.emit(context.fixture.gitDir, "index");
  await eventually(() => of(context.reports, "measurement.completed").length === 1, "the index change was never measured");
  assert.equal(last(context.reports, "measurement.completed").claim, "scoped");
  context.watcher.emit(context.fixture.gitDir, "refs/heads/main");

  const listing = await context.service.worktrees({ projectId: "project-a", worktreeId: main.id });

  const linked = listing.worktrees.find((worktree) => !worktree.isMain);
  assert.deepEqual(
    { additions: linked.lineAdditions, ahead: linked.aheadOfDefaultBranchCount },
    { additions: 0, ahead: 0 },
    "the worktree the listing did not name was carried forward with its old delta",
  );
  const moved = last(context.reports, "measurement.completed");
  assert.deepEqual(
    { raisedBy: moved.raisedBy, claim: moved.claim, remeasured: moved.remeasured, carried: moved.carried },
    { raisedBy: "request", claim: "all", remeasured: 2, carried: 0 },
  );
  assert.equal(moved.changes.byClass["default-branch-ref"], 1);
  // Nothing is owed afterwards: the next listing is the cached one.
  const again = await context.service.worktrees({ projectId: "project-a" });
  assert.equal(again.worktrees.find((worktree) => !worktree.isMain).lineAdditions, 0);
  assert.equal(of(context.reports, "measurement.completed").length, 2);
});

test("a failed measurement reports that its claim was handed back", async (t) => {
  let failList = false;
  const context = await reportingService(t, {
    wrapRunner: (inner) => ({
      run(args, cwd, options) {
        return inner.run(failList && args[0] === "worktree" ? [...args, "--no-such-flag"] : args, cwd, options);
      },
    }),
  });
  await bindAndList(context);
  context.reports.length = 0;

  failList = true;
  context.watcher.emit(context.fixture.gitDir, "refs/heads/main");
  await eventually(() => of(context.reports, "measurement.failed").length > 0, "the failure was not reported");
  const failed = last(context.reports, "measurement.failed");
  assert.equal(failed.claim, "all");
  assert.equal(failed.restored, true);
  assert.equal(failed.error.code, "command-error");

  failList = false;
  await context.service.worktrees({ projectId: "project-a" });
  const recovered = last(context.reports, "measurement.completed");
  assert.equal(recovered.claim, "all", "the restored claim is measured by the next listing");
  assert.equal(recovered.remeasured, 1);
});

test("a measurement overtaken by a release reports that it was abandoned", async (t) => {
  let release;
  const context = await reportingService(t, {
    wrapRunner: (inner) => ({
      async run(args, cwd, options) {
        const result = await inner.run(args, cwd, options);
        if (args.includes("status")) release?.();
        return result;
      },
    }),
  });
  await bindAndList(context);
  context.reports.length = 0;

  context.watcher.emit(context.fixture.main, "a.txt");
  release = () => {
    release = undefined;
    context.service.releaseProject("project-a");
  };
  await eventually(() => of(context.reports, "measurement.abandoned").length > 0, "the abandonment was not reported");
  const abandoned = last(context.reports, "measurement.abandoned");
  assert.equal(abandoned.restored, true);
  assert.equal(of(context.reports, "measurement.completed").length, 0);
});

test("a fresh listing measures past a cache the watches vouched for, and reports the mismatch", async (t) => {
  const context = await reportingService(t);
  await addLinkedWorktree(context.fixture);
  await bindAndList(context);

  // The default branch moves and no watch event arrives.
  await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
  context.runner.calls.length = 0;
  const cached = await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(context.runner.calls, [], "an event-less listing is answered from the cache");
  assert.equal(cached.worktrees.find((worktree) => !worktree.isMain).lineAdditions, 3);

  const fresh = await context.service.worktrees({ projectId: "project-a", fresh: true });
  assert.equal(fresh.worktrees.find((worktree) => !worktree.isMain).lineAdditions, 0);
  assert.equal(last(context.reports, "measurement.completed").raisedBy, "refresh");
  assert.equal(last(context.reports, "measurement.completed").carried, 0);

  const mismatches = of(context.reports, "cache.mismatch");
  assert.equal(mismatches.length, 1);
  const linked = mismatches[0].worktrees.find((worktree) => worktree.role === "linked");
  assert.ok(linked.fields.includes("lineAdditions"));
  assert.ok(linked.fields.includes("ahead"));
  const main = mismatches[0].worktrees.find((worktree) => worktree.role === "main");
  assert.deepEqual(main.fields, ["head"]);

  // Nothing changed since: measured again, and nothing to report.
  context.runner.calls.length = 0;
  await context.service.worktrees({ projectId: "project-a", fresh: true });
  assert.ok(context.runner.statusAgainst(context.fixture.main) > 0, "a fresh listing always measures");
  assert.equal(of(context.reports, "cache.mismatch").length, 1);

  // And the cache it left behind answers the next ordinary listing.
  context.runner.calls.length = 0;
  await context.service.worktrees({ projectId: "project-a" });
  assert.deepEqual(context.runner.calls, []);
});

test("no report carries a path, a branch name, a canonical id, or a project id", async (t) => {
  const context = await reportingService(t);
  const linked = await addLinkedWorktree(context.fixture);
  const listing = await bindAndList(context);

  await writeFile(join(linked, "c.txt"), "c\n");
  context.watcher.emit(linked, "c.txt");
  context.watcher.emit(context.fixture.gitDir, `refs/heads/${LINKED_BRANCH}`);
  context.watcher.emit(context.fixture.gitDir, `worktrees/${LINKED_DIRECTORY}/HEAD`);
  await settle();
  await context.service.worktrees({ projectId: "project-a" });
  // With the cache settled, the default branch moves unobserved.
  await git(["merge", "--ff-only", LINKED_BRANCH], context.fixture.main);
  await context.service.worktrees({ projectId: "project-a", fresh: true });
  await settle(120);
  context.watcher.fail(context.fixture.gitDir, Object.assign(new Error("watch limit"), { code: "ENOSPC" }));
  context.service.releaseProject("project-a");

  const kinds = new Set(context.reports.map((report) => report.kind));
  for (const kind of ["watch.opened", "watch.closed", "watch.failed", "measurement.completed", "cache.mismatch"])
    assert.ok(kinds.has(kind), `the scenario produced no ${kind} report`);

  // The default branch is literally "main", which is also a worktree role, so
  // the linked branch's distinctive name stands in for branch names.
  const text = JSON.stringify(context.reports);
  const forbidden = [
    context.fixture.root,
    LINKED_DIRECTORY,
    "c.txt",
    LINKED_BRANCH,
    "project-a",
    listing.repositoryId,
    ...listing.worktrees.map((worktree) => worktree.id),
    ...listing.worktrees.map((worktree) => worktree.head),
  ];
  for (const value of forbidden) assert.ok(!text.includes(value), `a report carries ${value}`);
  for (const report of context.reports)
    for (const worktree of report.worktrees ?? []) assert.match(worktree.id, /^w\d+$/u);
});
