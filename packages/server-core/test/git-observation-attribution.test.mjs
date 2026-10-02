import assert from "node:assert/strict";
import test from "node:test";

const {
  attributeGitDirChange,
  attributeWorkingTreeChange,
  linkedGitDirName,
  workingTreeWatchRoots,
} = await import("../dist/gitService/observation.js");

const layout = {
  mainWorktreeId: "worktree-main",
  defaultBranch: "main",
  worktrees: [
    { id: "worktree-main", path: "/repo", branch: "main", gitDirName: null, hasWorkingTree: true },
    { id: "worktree-feature", path: "/repo/.worktrees/feature", branch: "feature", gitDirName: "feature", hasWorkingTree: true },
    { id: "worktree-other", path: "/elsewhere/other", branch: "other", gitDirName: "other", hasWorkingTree: true },
    { id: "worktree-gone", path: "/gone", branch: null, gitDirName: "gone", hasWorkingTree: false },
  ],
};
const only = (...ids) => ({ kind: "worktrees", ids });
const ALL = { kind: "all", registry: false };
const REGISTRY = { kind: "all", registry: true };
const IGNORE = { kind: "ignore" };

test("Git directory writes that cannot change status are ignored", () => {
  for (const path of ["objects/ab/cd", "logs/HEAD", "hooks/pre-commit", "index.lock", "refs/heads/main.lock",
    "FETCH_HEAD", "COMMIT_EDITMSG", "refs/tags/v1", "refs/stash", "worktrees/feature/logs/HEAD", "modules/sub/HEAD"])
    assert.deepEqual(attributeGitDirChange(path, layout), IGNORE, path);
});

test("top-level Git state belongs to the main worktree", () => {
  assert.deepEqual(attributeGitDirChange("HEAD", layout), only("worktree-main"));
  assert.deepEqual(attributeGitDirChange("index", layout), only("worktree-main"));
  assert.deepEqual(attributeGitDirChange("rebase-merge/done", layout), only("worktree-main"));
});

test("branch refs belong to the worktrees on that branch; the default branch and remote refs touch all", () => {
  assert.deepEqual(attributeGitDirChange("refs/heads/feature", layout), only("worktree-feature"));
  assert.deepEqual(attributeGitDirChange("refs/heads/unrelated", layout), IGNORE);
  assert.deepEqual(attributeGitDirChange("refs/heads/main", layout), ALL);
  assert.deepEqual(attributeGitDirChange("refs/remotes/origin/main", layout), ALL);
  assert.deepEqual(attributeGitDirChange("packed-refs", layout), ALL);
  assert.deepEqual(attributeGitDirChange("config", layout), ALL);
  assert.deepEqual(attributeGitDirChange(null, layout), ALL);
});

test("linked worktree gitdirs belong to their worktree; registry changes re-derive the watch set", () => {
  assert.deepEqual(attributeGitDirChange("worktrees/feature/HEAD", layout), only("worktree-feature"));
  assert.deepEqual(attributeGitDirChange("worktrees/other/index", layout), only("worktree-other"));
  assert.deepEqual(attributeGitDirChange("worktrees", layout), REGISTRY);
  assert.deepEqual(attributeGitDirChange("worktrees/new", layout), REGISTRY);
  assert.deepEqual(attributeGitDirChange("worktrees/unknown/HEAD", layout), REGISTRY);
  assert.deepEqual(attributeGitDirChange("worktrees/feature/gitdir", layout), REGISTRY);
});

test("working-tree changes go to the innermost worktree and skip the Git directory", () => {
  assert.deepEqual(attributeWorkingTreeChange("/repo", "src/a.ts", layout), only("worktree-main"));
  assert.deepEqual(attributeWorkingTreeChange("/repo", ".worktrees/feature/b.ts", layout), only("worktree-feature"));
  assert.deepEqual(attributeWorkingTreeChange("/repo", ".git/index", layout), IGNORE);
  assert.deepEqual(attributeWorkingTreeChange("/elsewhere/other", null, layout), only("worktree-other"));
});

test("nested working trees are covered by their containing watch", () => {
  assert.deepEqual(workingTreeWatchRoots(layout), ["/repo", "/elsewhere/other"]);
});

test("a linked worktree's .git file names its registry entry", () => {
  assert.equal(linkedGitDirName("gitdir: /repo/.git/worktrees/feature\n"), "feature");
  assert.equal(linkedGitDirName("gitdir: C:\\repo\\.git\\worktrees\\win\r\n"), "win");
  assert.equal(linkedGitDirName("gitdir: /repo/.git\n"), null);
  assert.equal(linkedGitDirName("nonsense"), null);
});

test("every Git directory entry has a diagnostic class that names no path or ref", async () => {
  const { classifyGitDirEntry, scopeName } = await import("../dist/gitService/observation.js");
  const cases = {
    HEAD: "head",
    index: "index",
    "refs/heads/main": "default-branch-ref",
    "refs/heads/feature": "branch-ref",
    "refs/heads/unrelated": "branch-ref",
    "refs/remotes/origin/main": "remote-ref",
    "packed-refs": "packed-refs",
    config: "config",
    worktrees: "worktree-registry",
    "worktrees/feature": "worktree-registry",
    "worktrees/feature/gitdir": "worktree-registry",
    "worktrees/unknown/HEAD": "worktree-registry",
    "worktrees/feature/HEAD": "linked-worktree-state",
    "worktrees/feature/logs/HEAD": "inert",
    "index.lock": "lock",
    "refs/heads/main.lock": "lock",
    "objects/ab/cd": "inert",
    FETCH_HEAD: "inert",
    "refs/tags/v1": "inert",
    ORIG_HEAD: "other",
    "rebase-merge/done": "other",
    refs: "other",
  };
  for (const [path, expected] of Object.entries(cases)) assert.equal(classifyGitDirEntry(path, layout), expected, path);
  assert.equal(classifyGitDirEntry(null, layout), "unnamed");
  assert.equal(classifyGitDirEntry("", layout), "unnamed");

  // The class agrees with the attribution: what is ignored is never a class
  // that invalidates, and the default branch always invalidates everything.
  for (const path of Object.keys(cases)) {
    const scope = scopeName(attributeGitDirChange(path, layout));
    const entryClass = classifyGitDirEntry(path, layout);
    if (entryClass === "lock" || entryClass === "inert") assert.equal(scope, "ignore", path);
    if (entryClass === "default-branch-ref" || entryClass === "remote-ref") assert.equal(scope, "all", path);
    if (entryClass === "worktree-registry") assert.equal(scope, "registry", path);
  }
  assert.equal(scopeName(IGNORE), "ignore");
  assert.equal(scopeName(ALL), "all");
  assert.equal(scopeName(REGISTRY), "registry");
  assert.equal(scopeName(only("worktree-main")), "worktrees");
});
