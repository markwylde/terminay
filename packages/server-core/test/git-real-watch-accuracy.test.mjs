import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createReportLog } from "./fixtures/git-observation.mjs";

/**
 * The sidebar stays accurate through the real host watch alone (issue #652).
 * Every test here uses the default `NodeGitStateWatcher` on the host platform
 * (the built-up watch on Linux, FSEvents on macOS) and never asks for a fresh
 * listing: what it asserts can only have arrived through a watch event, a
 * published status change, and the cache that change refreshed.
 */

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync("git", args, { cwd });
const PROJECT = "project-a";

async function identity(cwd) {
  await git(["config", "user.email", "test@example.invalid"], cwd);
  await git(["config", "user.name", "Terminay Test"], cwd);
}

/** A clone of a bare origin with a pushed main, and a linked worktree beside it. */
async function repositoryWithLinkedWorktree(t, { branchCommit = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "terminay-git-accuracy-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  const linked = join(root, "linked");
  await git(["init", "--bare", "-b", "main", origin], root);
  await git(["clone", origin, main], root);
  await identity(main);
  await writeFile(join(main, "a.txt"), "a\n");
  await git(["add", "."], main);
  await git(["commit", "-m", "first"], main);
  await git(["push", "origin", "HEAD:main"], main);
  await git(["remote", "set-head", "origin", "main"], main);
  await git(["worktree", "add", "-b", "feature", linked], main);
  if (branchCommit) {
    await writeFile(join(linked, "b.txt"), "1\n2\n3\n");
    await git(["add", "."], linked);
    await git(["commit", "-m", "feature"], linked);
  }
  return { root, origin, main, linked };
}

async function observe(t, fixture) {
  const { GitService } = await import("../dist/gitService/index.js");
  const log = createReportLog();
  const service = new GitService({ onObservation: (report) => log.onObservation(report) });
  t.after(() => service.close());
  const events = [];
  const waiters = new Set();
  service.subscribe((event) => {
    if (event.type !== "git.status.changed") return;
    events.push(event);
    for (const waiter of [...waiters])
      if (waiter.match(event)) {
        waiters.delete(waiter);
        waiter.resolve(event);
      }
  });
  /** Resolves on the next status change that `match` accepts. Register it
   *  before acting, so an event published at once is not missed. */
  const nextEvent = (match = () => true) =>
    new Promise((resolve) => waiters.add({ match, resolve }));
  await service.bindProject(PROJECT, fixture.main);
  const first = await service.worktrees({ projectId: PROJECT });
  return { service, log, events, nextEvent, first };
}

const list = (service) => service.worktrees({ projectId: PROJECT });
const linkedOf = (listing, path) => listing.worktrees.find((worktree) => worktree.path === path);
const failures = (log) => log.reports.filter((report) => report.kind === "watch.failed");

test("pushing a clean branch with no upstream is announced, and the listing shows no unpushed work", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  const context = await observe(t, fixture);
  const before = linkedOf(context.first, fixture.linked);
  assert.equal(before.hasUnpushedCommits, true);
  const linkedId = before.id;

  const announced = context.nextEvent((event) => event.worktreeId === linkedId);
  const measured = context.log.next(
    "measurement.completed",
    (report) => report.raisedBy === "watch" && report.worktrees.some((worktree) => worktree.role === "linked"),
  );
  await git(["push", "origin", "feature"], fixture.linked);
  await announced;
  await measured;

  const after = linkedOf(await list(context.service), fixture.linked);
  assert.deepEqual(
    {
      unpushed: after.hasUnpushedCommits,
      additions: after.unpushedLineAdditions,
      deletions: after.unpushedLineDeletions,
    },
    { unpushed: false, additions: 0, deletions: 0 },
  );
  assert.deepEqual(failures(context.log), []);
});

test("pushing a branch with uncommitted changes leaves only those changes unpushed", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  await writeFile(join(fixture.linked, "b.txt"), "1\n2\n3\n4\n5\n");
  const context = await observe(t, fixture);
  const linkedId = linkedOf(context.first, fixture.linked).id;

  const announced = context.nextEvent((event) => event.worktreeId === linkedId);
  await git(["push", "origin", "feature"], fixture.linked);
  await announced;

  // The announcement and the cached listing come from the same measurement,
  // but a later watch event may still be in flight; wait until it settles.
  let after;
  for (;;) {
    after = linkedOf(await list(context.service), fixture.linked);
    if (after.hasUnpushedCommits === false) break;
    await context.nextEvent((event) => event.worktreeId === linkedId);
  }
  assert.equal(after.unpushedLineAdditions, 2, "the two uncommitted lines are still unpushed");
  assert.equal(after.unpushedLineDeletions, 0);
});

test("a pull that moves the default branch announces the linked worktree's new delta", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  await git(["push", "origin", "feature"], fixture.linked);
  // The branch is merged on the remote from elsewhere.
  const other = join(fixture.root, "other");
  await git(["clone", fixture.origin, other], fixture.root);
  await identity(other);
  await git(["merge", "--no-ff", "origin/feature", "-m", "merge feature"], other);
  await git(["push", "origin", "HEAD:main"], other);

  const context = await observe(t, fixture);
  const before = linkedOf(context.first, fixture.linked);
  assert.deepEqual({ ahead: before.aheadOfDefaultBranchCount, additions: before.lineAdditions }, { ahead: 1, additions: 3 });

  const announced = context.nextEvent((event) => event.worktreeId === before.id);
  await git(["pull", "--ff-only"], fixture.main);
  await announced;

  let after;
  for (;;) {
    after = linkedOf(await list(context.service), fixture.linked);
    if (after.aheadOfDefaultBranchCount === 0) break;
    await context.nextEvent((event) => event.worktreeId === before.id);
  }
  assert.equal(after.lineAdditions, 0);
  assert.deepEqual(failures(context.log), []);
});

test("git worktree remove is announced, and the repository stays observed", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  const context = await observe(t, fixture);
  assert.equal(context.first.worktrees.length, 2);

  const announced = context.nextEvent();
  await git(["worktree", "remove", "--force", fixture.linked], fixture.main);
  await announced;
  let listing;
  for (;;) {
    listing = await list(context.service);
    if (linkedOf(listing, fixture.linked) === undefined) break;
    await context.nextEvent();
  }
  assert.equal(listing.worktrees.length, 1);
  assert.deepEqual(failures(context.log), [], "removing a worktree is not a watch failure");

  // The main worktree's watch is still live.
  const mainId = listing.worktrees[0].id;
  const edited = context.nextEvent((event) => event.worktreeId === mainId);
  await writeFile(join(fixture.main, "a.txt"), "edited\n");
  await edited;
});

test("a deleted worktree folder is listed as prunable, then gone once pruned", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  const context = await observe(t, fixture);

  const deleted = context.nextEvent();
  await rm(fixture.linked, { recursive: true, force: true });
  await deleted;
  let listing;
  for (;;) {
    listing = await list(context.service);
    if (linkedOf(listing, fixture.linked)?.isPrunable === true) break;
    await context.nextEvent();
  }
  assert.deepEqual(failures(context.log), []);

  const pruned = context.nextEvent();
  await git(["worktree", "prune"], fixture.main);
  await pruned;
  for (;;) {
    listing = await list(context.service);
    if (linkedOf(listing, fixture.linked) === undefined) break;
    await context.nextEvent();
  }
  assert.equal(listing.worktrees.length, 1);
});

test("a restored worktree folder is watched again after the next measurement", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  const context = await observe(t, fixture);
  const saved = join(fixture.root, "saved");
  await cp(fixture.linked, saved, { recursive: true });

  const deleted = context.nextEvent();
  await rm(fixture.linked, { recursive: true, force: true });
  await deleted;
  for (;;) {
    if (linkedOf(await list(context.service), fixture.linked)?.isPrunable === true) break;
    await context.nextEvent();
  }

  await mkdir(fixture.linked);
  await cp(saved, fixture.linked, { recursive: true });
  // Restoring touches neither the registry nor any watched Git state, so an
  // explicit refresh is what re-derives the watch set.
  const refreshed = await context.service.worktrees({ projectId: PROJECT, fresh: true });
  const restored = linkedOf(refreshed, fixture.linked);
  assert.equal(restored.isPrunable, false);

  const edited = context.nextEvent((event) => event.worktreeId === restored.id);
  await writeFile(join(fixture.linked, "c.txt"), "c\n");
  await edited;
});

test("a repository nothing changes is measured once after binding", async (t) => {
  const fixture = await repositoryWithLinkedWorktree(t);
  const context = await observe(t, fixture);
  await list(context.service);
  const measured = context.log.reports.filter((report) => report.kind === "measurement.completed");
  assert.equal(measured.length, 1, "the second listing is answered from the cache");
  assert.equal(measured[0].trusted, true);
  assert.equal(measured[0].cached, true);
});
