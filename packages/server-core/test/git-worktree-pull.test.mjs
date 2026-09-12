import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("GitService pulls a clean attached worktree from its reviewed upstream", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-git-pull-"));
  const remote = join(root, "remote.git");
  const feature = join(root, "feature");
  const other = join(root, "other");
  try {
    await mkdir(remote);
    await git(["init", "--bare", "-b", "main", remote], root);
    await initialise(join(root, "repo"));
    const repo = join(root, "repo");
    await git(["remote", "add", "origin", remote], repo);
    await git(["push", "-u", "origin", "main"], repo);
    await git(["worktree", "add", feature, "-b", "feature"], repo);
    await git(["push", "-u", "origin", "feature"], feature);
    await git(["clone", remote, other], root);
    await git(["config", "user.email", "test@example.invalid"], other);
    await git(["config", "user.name", "Terminay Test"], other);
    await git(["switch", "feature"], other);
    await writeFile(join(other, "remote.txt"), "pulled\n");
    await git(["add", "remote.txt"], other);
    await git(["commit", "-m", "remote update"], other);
    await git(["push"], other);

    const service = new GitService();
    const binding = await service.bindProject("project-a", repo);
    const listing = await service.worktrees({ projectId: "project-a", repositoryId: binding.repositoryId });
    const selected = listing.worktrees.find((entry) => entry.path.endsWith("/feature"));
    assert.ok(selected);
    const result = await service.pullWorktree({ projectId: "project-a", repositoryId: binding.repositoryId, worktreeId: selected.id, expectedHead: selected.head });
    assert.equal(result.applied, true);
    assert.equal(result.state, "pulled");
    assert.equal(result.headAfter === result.headBefore, false);
    assert.equal(await readFile(join(feature, "remote.txt"), "utf8"), "pulled\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService pulls a branch that tracks no upstream but matches a remote branch", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-git-pull-no-upstream-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  const other = join(root, "other");
  try {
    await mkdir(remote);
    await git(["init", "--bare", "-b", "main", remote], root);
    await initialise(repo);
    await git(["remote", "add", "origin", remote], repo);
    await git(["push", "origin", "main"], repo);
    // A repository pushed without -u has a remote branch but no configured
    // upstream, which is the state `git pull origin main` leaves behind.
    assert.equal(await gitConfig(repo, "branch.main.remote"), null);
    await git(["clone", remote, other], root);
    await git(["config", "user.email", "test@example.invalid"], other);
    await git(["config", "user.name", "Terminay Test"], other);
    await writeFile(join(other, "remote.txt"), "pulled\n");
    await git(["add", "remote.txt"], other);
    await git(["commit", "-m", "remote update"], other);
    await git(["push"], other);

    const service = new GitService();
    const binding = await service.bindProject("project-a", repo);
    const result = await service.pullWorktree({ projectId: "project-a", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    assert.equal(result.error ?? null, null);
    assert.equal(result.applied, true);
    assert.equal(result.state, "pulled");
    assert.notEqual(result.headAfter, result.headBefore);
    assert.equal(await readFile(join(repo, "remote.txt"), "utf8"), "pulled\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService reports a branch with no matching remote branch as unpullable", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-git-pull-unmatched-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  try {
    await mkdir(remote);
    await git(["init", "--bare", "-b", "main", remote], root);
    await initialise(repo);
    await git(["remote", "add", "origin", remote], repo);
    await git(["switch", "-c", "local-only"], repo);

    const service = new GitService();
    const binding = await service.bindProject("project-a", repo);
    const result = await service.pullWorktree({ projectId: "project-a", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    assert.equal(result.applied, false);
    assert.equal(result.state, "command-error");
    assert.match(result.error.message, /no matching remote branch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitService reports a missing worktree upstream without invoking a path supplied by a client", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-git-pull-no-remote-"));
  try {
    await initialise(root);
    const service = new GitService();
    const binding = await service.bindProject("project-a", root);
    const result = await service.pullWorktree({ projectId: "project-a", repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
    assert.equal(result.applied, false);
    assert.equal(result.state, "command-error");
    assert.match(result.error.message, /no remote to pull from/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initialise(root) {
  await mkdir(root, { recursive: true });
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "test@example.invalid"], root);
  await git(["config", "user.name", "Terminay Test"], root);
  await writeFile(join(root, "file.txt"), "base\n");
  await git(["add", "file.txt"], root);
  await git(["commit", "-m", "initial"], root);
}

async function gitConfig(cwd, key) {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", key], { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function git(args, cwd) {
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
