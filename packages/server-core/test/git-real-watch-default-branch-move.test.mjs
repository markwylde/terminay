import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { eventually } from "./fixtures/git-observation.mjs";

const execFileAsync = promisify(execFile);
const git = (args, cwd) => execFileAsync("git", args, { cwd });

/**
 * The other observation tests inject a fake watcher, which proves attribution
 * and nothing about delivery. This one uses the default `NodeGitStateWatcher`
 * against a real repository: a branch is merged on the remote, the main
 * checkout pulls it, and the linked worktree nested inside that checkout must
 * lose its delta without anything naming it.
 */
async function mergedOnRemote(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "terminay-git-real-watch-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  const other = join(root, "other");
  const linked = join(main, ".claude", "worktrees", "feature");
  const identity = async (cwd) => {
    await git(["config", "user.email", "test@example.invalid"], cwd);
    await git(["config", "user.name", "Terminay Test"], cwd);
  };

  await git(["init", "--bare", "-b", "main", origin], root);
  await git(["clone", origin, main], root);
  await identity(main);
  await writeFile(join(main, ".gitignore"), ".claude/\n");
  await writeFile(join(main, "a.txt"), "a\n");
  await git(["add", "."], main);
  await git(["commit", "-m", "first"], main);
  await git(["push", "origin", "HEAD:main"], main);
  await git(["remote", "set-head", "origin", "main"], main);

  await mkdir(join(main, ".claude", "worktrees"), { recursive: true });
  await git(["worktree", "add", "-b", "feature", linked], main);
  await writeFile(join(linked, "b.txt"), "1\n2\n3\n4\n5\n");
  await git(["add", "."], linked);
  await git(["commit", "-m", "feature"], linked);
  await git(["push", "origin", "feature"], linked);

  // The pull request is merged on the remote, from elsewhere.
  await git(["clone", origin, other], root);
  await identity(other);
  await git(["merge", "--no-ff", "origin/feature", "-m", "merge feature"], other);
  await git(["push", "origin", "HEAD:main"], other);
  return { main, linked };
}

async function observe(t, fixture) {
  const { GitService } = await import("../dist/gitService/index.js");
  const reports = [];
  const service = new GitService({ onObservation: (report) => reports.push(report) });
  t.after(() => service.close());
  await service.bindProject("project-a", fixture.main);
  await eventually(
    () => reports.some((report) => report.kind === "watch.opened" && report.watch === "git-directory"),
    "the real Git directory watch was not opened",
  );
  const first = await service.worktrees({ projectId: "project-a" });
  const linked = first.worktrees.find((worktree) => !worktree.isMain);
  assert.deepEqual(
    { ahead: linked.aheadOfDefaultBranchCount, additions: linked.lineAdditions },
    { ahead: 1, additions: 5 },
  );
  return { service, reports, mainWorktree: first.worktrees.find((worktree) => worktree.isMain) };
}

async function assertSiblingRemeasured(service, reports) {
  // The listing is the ordinary, cache-eligible one: only a watch event can
  // have brought the linked worktree's delta to zero.
  await eventually(
    async () => {
      const listing = await service.worktrees({ projectId: "project-a" });
      const linked = listing.worktrees.find((worktree) => !worktree.isMain);
      return linked.lineAdditions === 0 && linked.aheadOfDefaultBranchCount === 0;
    },
    "the linked worktree kept its pre-pull delta",
    15_000,
  );
  const summaries = reports.filter((report) => report.kind === "measurement.completed" || report.kind === "changes");
  assert.ok(
    summaries.some((report) => (report.changes.byClass["default-branch-ref"] ?? 0) > 0),
    "no default-branch change was observed",
  );
  assert.ok(
    summaries.some((report) => (report.changes.byScope.all ?? 0) > 0),
    "no change invalidated every worktree",
  );
  const settled = reports
    .filter((report) => report.kind === "measurement.completed")
    .findLast((report) => report.worktrees.some((worktree) => worktree.role === "linked"));
  assert.equal(settled.worktrees.find((worktree) => worktree.role === "linked").additions, 0);
  assert.equal(reports.filter((report) => report.kind === "watch.failed").length, 0);
  assert.equal(reports.filter((report) => report.kind === "cache.mismatch").length, 0);
}

test("pulling the default branch in the main checkout re-measures a nested linked worktree", async (t) => {
  const fixture = await mergedOnRemote(t);
  const { service, reports } = await observe(t, fixture);
  await git(["pull", "--ff-only"], fixture.main);
  await assertSiblingRemeasured(service, reports);
});

test("pulling through the service's own pull re-measures a nested linked worktree", async (t) => {
  const fixture = await mergedOnRemote(t);
  const { service, reports, mainWorktree } = await observe(t, fixture);
  const pulled = await service.pullWorktree({
    projectId: "project-a",
    repositoryId: mainWorktree.repositoryId,
    worktreeId: mainWorktree.id,
    expectedHead: mainWorktree.head,
  });
  assert.equal(pulled.applied, true);
  await assertSiblingRemeasured(service, reports);
});
