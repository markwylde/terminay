import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("GitService binds canonical project/repository/worktree identities and reports status", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-"));
  const project = join(root, "project");
  const alias = join(root, "alias");
  try {
    await mkdir(project);
    await git(["init", "-b", "main"], project);
    await git(["config", "user.email", "test@example.invalid"], project);
    await git(["config", "user.name", "Terminay Test"], project);
    await writeFile(join(project, "tracked.txt"), "base\n");
    await git(["add", "tracked.txt"], project);
    await git(["commit", "-m", "initial"], project);
    await symlink(project, alias);

    const service = new GitService();
    const first = await service.bindProject("project-a", project);
    const second = await service.bindProject("project-b", alias);
    assert.equal(first.repositoryId, second.repositoryId);
    assert.equal(first.worktreeId, second.worktreeId);
    assert.equal(first.repositoryRoot.endsWith('/project'), true);
    await writeFile(join(project, "tracked.txt"), "changed\n");
    await writeFile(join(project, "new.txt"), "new\n");

    const status = await service.status({ projectId: "project-a", repositoryId: first.repositoryId, worktreeId: first.worktreeId });
    assert.equal(status.state, "ready");
    assert.equal(status.branch.name, "main");
    assert.deepEqual(status.entries.map((entry) => [entry.path, entry.kind]).sort(), [["new.txt", "untracked"], ["tracked.txt", "modified"]]);
    assert.equal(status.entries.some((entry) => entry.path.startsWith("/")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService returns normalized bounded diffs and rejects path escapes", async () => {
  const { GitService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-diff-"));
  try {
    await git(["init", "-b", "main"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await git(["config", "user.name", "Terminay Test"], root);
    await writeFile(join(root, "file.txt"), "before\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "initial"], root);
    await writeFile(join(root, "file.txt"), "before\nafter\n");
    const service = new GitService({ limits: { maxDiffBytes: 1024, maxOutputBytes: 1024 } });
    const binding = await service.bindProject("project", root);
    const diff = await service.diff({ projectId: "project", path: "file.txt", worktreeId: binding.worktreeId });
    assert.equal(diff.state, "ready");
    assert.equal(diff.files[0].path, "file.txt");
    assert.equal(diff.hunks[0].lines.some((line) => line.type === "add" && line.value === "after"), true);
    await assert.rejects(() => service.diff({ projectId: "project", path: "../outside" }), (error) => error instanceof GitServiceError && error.code === "path-escape");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService keeps read-only worktree listing project-bound", async () => {
  const { GitService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-worktrees-"));
  const feature = join(root, "feature");
  try {
    await git(["init", "-b", "main"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await git(["config", "user.name", "Terminay Test"], root);
    await writeFile(join(root, "file.txt"), "base\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "initial"], root);
    await git(["worktree", "add", feature, "-b", "feature"], root);
    const service = new GitService();
    const binding = await service.bindProject("project", root);
    const list = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(list.state, "ready");
    assert.equal(list.worktrees.length, 2);
    assert.equal(list.worktrees.filter((worktree) => worktree.isMain).length, 1);
    assert.equal(list.worktrees.some((worktree) => worktree.branch === "feature"), true);
    await assert.rejects(() => service.status({ projectId: "project", worktreeId: "worktree-not-real" }), (error) => error instanceof GitServiceError && error.code === "worktree-not-found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService reports effective worktree changes against the default branch", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-worktree-delta-"));
  const project = join(root, "project");
  const feature = join(root, "feature");
  try {
    await mkdir(project);
    await git(["init", "-b", "main"], project);
    await git(["config", "user.email", "test@example.invalid"], project);
    await git(["config", "user.name", "Terminay Test"], project);
    await writeFile(join(project, "shared.txt"), "base\n");
    await git(["add", "shared.txt"], project);
    await git(["commit", "-m", "initial"], project);
    await git(["worktree", "add", feature, "-b", "feature"], project);

    await writeFile(join(feature, "feature.txt"), "unmerged\nchange\n");
    await git(["add", "feature.txt"], feature);
    await git(["commit", "-m", "feature change"], feature);

    const service = new GitService();
    const binding = await service.bindProject("project", project);
    const unmerged = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const unmergedFeature = unmerged.worktrees.find((worktree) => !worktree.isMain);
    assert.equal(unmergedFeature.aheadOfDefaultBranchCount, 1);
    assert.equal(unmergedFeature.hasCommittedChanges, true);
    assert.equal(unmergedFeature.lineAdditions, 2);
    assert.equal(unmergedFeature.lineDeletions, 0);

    await writeFile(join(project, "feature.txt"), "unmerged\nchange\n");
    await git(["add", "feature.txt"], project);
    await git(["commit", "-m", "squash feature"], project);

    const squashMerged = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const squashMergedFeature = squashMerged.worktrees.find((worktree) => !worktree.isMain);
    assert.equal(squashMergedFeature.aheadOfDefaultBranchCount, 1);
    assert.equal(squashMergedFeature.hasCommittedChanges, false);
    assert.equal(squashMergedFeature.lineAdditions, 0);
    assert.equal(squashMergedFeature.lineDeletions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService publishes bounded progress and status revisions to subscribers", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-events-"));
  try {
    await git(["init", "-b", "main"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await git(["config", "user.name", "Terminay Test"], root);
    await writeFile(join(root, "file.txt"), "base\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "initial"], root);
    const service = new GitService({ maxEvents: 32 });
    const events = [];
    const secondClientEvents = [];
    service.subscribe((event) => events.push(event));
    service.subscribe((event) => secondClientEvents.push(event));
    const binding = await service.bindProject("project", root);
    const first = await service.status({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    assert.equal(first.state, "ready");
    assert.deepEqual(events.map((event) => [event.type, event.revision]), [
      ["git.progress", 1],
      ["git.progress", 2],
      ["git.status.changed", 3],
    ]);
    assert.equal(events[0].phase, "started");
    assert.equal(events[1].phase, "completed");
    assert.equal(events[2].changedFiles, 0);
    assert.equal("repositoryRoot" in events[2], false);
    assert.equal("stderr" in events[2], false);
    assert.deepEqual(secondClientEvents, events);

    await service.status({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    assert.equal(events.filter((event) => event.type === "git.status.changed").length, 1);

    await writeFile(join(root, "new.txt"), "new\n");
    await service.status({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    const changed = events.filter((event) => event.type === "git.status.changed").at(-1);
    assert.equal(changed.changedFiles, 1);
    assert.equal(changed.projectId, "project");
    assert.equal(changed.repositoryId, binding.repositoryId);
    assert.equal(changed.worktreeId, binding.worktreeId);
    assert.equal(service.revision, events.at(-1).revision);
    assert.deepEqual(secondClientEvents.map((event) => event.revision), events.map((event) => event.revision));
    assert.equal(service.replay(0).kind, "events");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService removes only a revalidated clean non-main worktree", async () => {
  const { GitService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-remove-"));
  const feature = join(root, "feature");
  const dirty = join(root, "dirty");
  try {
    await git(["init", "-b", "main"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await git(["config", "user.name", "Terminay Test"], root);
    await writeFile(join(root, "file.txt"), "base\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "initial"], root);
    await git(["worktree", "add", feature, "-b", "feature"], root);
    await git(["worktree", "add", dirty, "-b", "dirty"], root);
    // Give the dirty worktree an actual unmerged index so the mutation guard
    // is exercised for both ordinary dirt and conflict state.
    await writeFile(join(root, "file.txt"), "main branch change\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "main branch change"], root);
    await writeFile(join(dirty, "file.txt"), "dirty branch change\n");
    await git(["add", "file.txt"], dirty);
    await git(["commit", "-m", "dirty branch change"], dirty);
    await git(["merge", "main"], dirty).catch(() => undefined);

    const service = new GitService();
    const binding = await service.bindProject("project", root);
    const initial = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const main = initial.worktrees.find((worktree) => worktree.isMain);
    const featureBefore = initial.worktrees.find((worktree) => worktree.path.endsWith("/feature"));
    assert.ok(main);
    assert.ok(featureBefore);
    await assert.rejects(
      () => service.removeWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: main.id }),
      (error) => error instanceof GitServiceError && error.code === "worktree-main",
    );

    // A review bound to the previous full HEAD cannot be replayed after the
    // selected worktree advances.
    await writeFile(join(feature, "feature.txt"), "feature\n");
    await git(["add", "feature.txt"], feature);
    await git(["commit", "-m", "feature change"], feature);
    await assert.rejects(
      () => service.removeWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: featureBefore.id, expectedHead: featureBefore.head }),
      (error) => error instanceof GitServiceError && error.code === "stale-revision",
    );

    const withDirty = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const dirtySummary = withDirty.worktrees.find((worktree) => worktree.path.endsWith("/dirty"));
    const featureAfter = withDirty.worktrees.find((worktree) => worktree.path.endsWith("/feature"));
    assert.ok(dirtySummary);
    assert.ok(featureAfter);
    await assert.rejects(
      () => service.removeWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: dirtySummary.id }),
      (error) => error instanceof GitServiceError && error.code === "worktree-dirty",
    );

    const removed = await service.removeWorktree({
      projectId: "project",
      repositoryId: binding.repositoryId,
      worktreeId: featureAfter.id,
      expectedHead: featureAfter.head,
    });
    assert.equal(removed.applied, true);
    assert.equal(removed.state, "removed");
    const final = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(final.worktrees.some((worktree) => worktree.id === featureAfter.id), false);
    assert.equal(final.worktrees.some((worktree) => worktree.id === dirtySummary.id), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService removes a stale worktree registration after its directory disappears", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-remove-stale-"));
  const project = join(root, "project");
  const feature = join(root, "feature");
  try {
    await mkdir(project);
    await git(["init", "-b", "main"], project);
    await git(["config", "user.email", "test@example.invalid"], project);
    await git(["config", "user.name", "Terminay Test"], project);
    await writeFile(join(project, "file.txt"), "base\n");
    await git(["add", "file.txt"], project);
    await git(["commit", "-m", "initial"], project);
    await git(["worktree", "add", feature, "-b", "feature"], project);

    const service = new GitService();
    const binding = await service.bindProject("project", project);
    const before = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const selected = before.worktrees.find((worktree) => worktree.path.endsWith("/feature"));
    assert.ok(selected);

    await rm(feature, { recursive: true, force: true });

    const stale = await service.worktrees({
      projectId: "project",
      repositoryId: binding.repositoryId,
      worktreeId: selected.id,
    });
    assert.equal(stale.state, "ready");
    assert.equal(stale.worktrees.find((worktree) => worktree.id === selected.id)?.isPrunable, true);

    const removed = await service.removeWorktree({
      projectId: "project",
      repositoryId: binding.repositoryId,
      worktreeId: selected.id,
      expectedHead: selected.head,
    });
    assert.equal(removed.applied, true);
    assert.equal(removed.state, "removed");

    const after = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(after.worktrees.some((worktree) => worktree.id === selected.id), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService moves only a clean reviewed worktree to a safe sibling name", async () => {
  const { GitService, GitServiceError } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-move-"));
  const feature = join(root, "feature");
  try {
    await git(["init", "-b", "main"], root);
    await git(["config", "user.email", "test@example.invalid"], root);
    await git(["config", "user.name", "Terminay Test"], root);
    await writeFile(join(root, "file.txt"), "base\n");
    await git(["add", "file.txt"], root);
    await git(["commit", "-m", "initial"], root);
    await git(["worktree", "add", feature, "-b", "feature"], root);
    const service = new GitService();
    const binding = await service.bindProject("project", root);
    const listing = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const selected = listing.worktrees.find((worktree) => worktree.path.endsWith("/feature"));
    assert.ok(selected);
    await assert.rejects(() => service.moveWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: selected.id, name: "../escape" }), (error) => error instanceof GitServiceError);
    await mkdir(join(root, "occupied"));
    await assert.rejects(() => service.moveWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: selected.id, name: "occupied" }), (error) => error instanceof GitServiceError && /already exists/u.test(error.message));
    await writeFile(join(feature, "dirty.txt"), "dirty\n");
    await assert.rejects(() => service.moveWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: selected.id, name: "renamed" }), (error) => error instanceof GitServiceError && error.code === "worktree-dirty");
    await git(["clean", "-fd"], feature);
    const moved = await service.moveWorktree({ projectId: "project", repositoryId: binding.repositoryId, worktreeId: selected.id, name: "renamed", expectedHead: selected.head });
    assert.equal(moved.applied, true);
    assert.equal(moved.state, "moved");
    assert.equal(moved.path.endsWith("/renamed"), true);
    assert.notEqual(moved.worktreeId, selected.id);
    const after = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    assert.equal(after.worktrees.some((worktree) => worktree.id === selected.id), false);
    assert.equal(after.worktrees.some((worktree) => worktree.id === moved.worktreeId), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
