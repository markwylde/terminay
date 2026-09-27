import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Every way a linked worktree has been seen to lose its working tree while
// Git still has it registered. Each must show as prunable, stay out of the
// clean-worktree sweep, and be deletable from the Git panel without touching
// anything else. These have repeatedly left undeletable rows in the panel.
const BREAKAGES = [
  {
    name: "folder deleted",
    break: ({ path }) => rm(path, { recursive: true, force: true }),
  },
  {
    name: "folder deleted while locked",
    locked: true,
    break: ({ path }) => rm(path, { recursive: true, force: true }),
  },
  {
    // An agent session's `.claude/worktrees/<name>` with `.claude` removed.
    name: "parent folder deleted while locked",
    locked: true,
    nested: true,
    break: ({ root }) => rm(join(root, "agent-sessions"), { recursive: true, force: true }),
  },
  {
    name: "folder deleted with unmerged commits while locked",
    locked: true,
    commit: true,
    break: ({ path }) => rm(path, { recursive: true, force: true }),
  },
  {
    name: "detached folder deleted while locked",
    locked: true,
    detached: true,
    break: ({ path }) => rm(path, { recursive: true, force: true }),
  },
  {
    name: ".git file deleted",
    keeps: "folder",
    break: ({ path }) => rm(join(path, ".git")),
  },
  {
    name: ".git file deleted while locked",
    locked: true,
    keeps: "folder",
    break: ({ path }) => rm(join(path, ".git")),
  },
  {
    name: "folder emptied while locked",
    locked: true,
    keeps: "folder",
    break: async ({ path }) => {
      await rm(path, { recursive: true, force: true });
      await mkdir(path);
    },
  },
  {
    name: "path replaced by a file",
    keeps: "file",
    break: async ({ path }) => {
      await rm(path, { recursive: true, force: true });
      await writeFile(path, "someone else's file\n");
    },
  },
  {
    name: "path replaced by a file while locked",
    locked: true,
    keeps: "file",
    break: async ({ path }) => {
      await rm(path, { recursive: true, force: true });
      await writeFile(path, "someone else's file\n");
    },
  },
];

for (const breakage of BREAKAGES) {
  test(`GitService deletes a worktree whose working tree was lost: ${breakage.name}`, async () => {
    const { GitService, GitServiceError } = await import("../dist/gitService/index.js");
    const root = await mkdtemp(join(tmpdir(), "terminay-server-git-broken-"));
    const project = join(root, "project");
    const broken = breakage.nested
      ? join(root, "agent-sessions", "worktrees", "broken")
      : join(root, "broken");
    const healthy = join(root, "healthy");
    const stale = join(root, "stale");
    try {
      await mkdir(project);
      await git(["init", "-b", "main"], project);
      await git(["config", "user.email", "test@example.invalid"], project);
      await git(["config", "user.name", "Terminay Test"], project);
      await writeFile(join(project, "file.txt"), "base\n");
      await git(["add", "file.txt"], project);
      await git(["commit", "-m", "initial"], project);
      if (breakage.nested) await mkdir(join(root, "agent-sessions", "worktrees"), { recursive: true });
      await git(
        breakage.detached
          ? ["worktree", "add", "--detach", broken]
          : ["worktree", "add", broken, "-b", "broken"],
        project,
      );
      if (breakage.commit) {
        await writeFile(join(broken, "work.txt"), "unmerged work\n");
        await git(["add", "work.txt"], broken);
        await git(["commit", "-m", "unmerged work"], broken);
      }
      if (breakage.locked)
        await git(["worktree", "lock", "--reason", "claude session broken (pid 1)", broken], project);
      // Bystanders: a healthy worktree, and another stale registration that a
      // blanket `git worktree prune` would have swept away with the target.
      await git(["worktree", "add", healthy, "-b", "healthy"], project);
      await git(["worktree", "add", stale, "-b", "stale"], project);

      const service = new GitService();
      const binding = await service.bindProject("project", project);
      const list = () => service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
      const byPath = (listing, path) => listing.worktrees.find((worktree) => worktree.path.endsWith(path.slice(root.length)));

      // The client reviewed the worktree while it was still healthy.
      const reviewed = byPath(await list(), broken);
      assert.ok(reviewed);
      assert.equal(reviewed.isPrunable, false);

      await breakage.break({ root, path: broken });
      await rm(stale, { recursive: true, force: true });

      const listing = await list();
      assert.equal(listing.state, "ready");
      const lost = byPath(listing, broken);
      assert.ok(lost, "the lost worktree is still listed");
      assert.equal(lost.id, reviewed.id, "losing the working tree keeps the worktree's identity");
      assert.equal(lost.isPrunable, true);
      assert.equal(lost.state, "prunable");
      assert.equal(lost.locked, breakage.locked === true);

      // The clean-worktree sweep never deletes a registration it cannot inspect.
      await assert.rejects(
        () => service.removeCleanWorktree({
          projectId: "project",
          repositoryId: binding.repositoryId,
          worktreeId: lost.id,
          expectedHead: lost.head,
        }),
        (error) => error instanceof GitServiceError,
      );
      assert.ok(byPath(await list(), broken), "a refused sweep leaves the worktree registered");

      const removed = await service.removeWorktree({
        projectId: "project",
        repositoryId: binding.repositoryId,
        worktreeId: reviewed.id,
        expectedHead: reviewed.head,
      });
      assert.equal(removed.error, undefined);
      assert.equal(removed.applied, true);
      assert.equal(removed.state, "removed");
      assert.equal(removed.headBefore, reviewed.head);

      const after = await list();
      assert.equal(byPath(after, broken), undefined);
      assert.doesNotMatch(await git(["worktree", "list", "--porcelain"], project), new RegExp(`${broken.slice(root.length)}\\n`));
      assert.ok(byPath(after, healthy), "a healthy worktree is untouched");
      assert.equal((await stat(join(healthy, "file.txt"))).isFile(), true);
      assert.ok(byPath(after, stale), "another stale registration is not swept");
      if (!breakage.detached)
        assert.match(await git(["rev-parse", "--verify", "refs/heads/broken"], project), /^[0-9a-f]{40}/u, "the branch survives");

      // Whatever sits at the old path is no longer a worktree and is left alone.
      if (breakage.keeps === "folder") assert.equal((await stat(broken)).isDirectory(), true);
      if (breakage.keeps === "file") assert.equal(await readFile(broken, "utf8"), "someone else's file\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("GitService keeps a locked worktree with its working tree intact out of the prunable path", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-server-git-locked-intact-"));
  const project = join(root, "project");
  const locked = join(root, "locked");
  try {
    await mkdir(project);
    await git(["init", "-b", "main"], project);
    await git(["config", "user.email", "test@example.invalid"], project);
    await git(["config", "user.name", "Terminay Test"], project);
    await writeFile(join(project, "file.txt"), "base\n");
    await git(["add", "file.txt"], project);
    await git(["commit", "-m", "initial"], project);
    await git(["worktree", "add", locked, "-b", "locked"], project);
    await git(["worktree", "lock", locked], project);
    await writeFile(join(locked, "draft.txt"), "untracked\n");

    const service = new GitService();
    const binding = await service.bindProject("project", project);
    const listing = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const selected = listing.worktrees.find((worktree) => worktree.path.endsWith("/locked"));
    assert.ok(selected);
    assert.equal(selected.locked, true);
    assert.equal(selected.isPrunable, false);
    assert.equal(selected.state, "dirty");

    // A real working tree is removed through Git, so its files go with it.
    const removed = await service.removeWorktree({
      projectId: "project",
      repositoryId: binding.repositoryId,
      worktreeId: selected.id,
      expectedHead: selected.head,
    });
    assert.equal(removed.applied, true);
    await assert.rejects(() => stat(locked), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function git(args, cwd) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
