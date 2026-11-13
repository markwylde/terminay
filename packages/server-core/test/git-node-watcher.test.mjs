import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createRepository, eventually, git, settle } from "./fixtures/git-observation.mjs";

/** The real host watch, against a real repository, filtered by the same
 *  attribution the service uses. */
async function watchRepository(t, platform) {
  const { NodeGitStateWatcher } = await import("../dist/gitService/index.js");
  const { attributeGitDirChange, attributeWorkingTreeChange, gitDirectoryWatchFilter } = await import("../dist/gitService/observation.js");
  const fixture = await createRepository("terminay-node-watch-");
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const layout = {
    mainWorktreeId: "main",
    defaultBranch: "main",
    worktrees: [{ id: "main", path: fixture.main, branch: "main", gitDirName: null, hasWorkingTree: true }],
  };
  const scopes = [];
  const errors = [];
  const watcher = new NodeGitStateWatcher({ platform });
  const handles = [
    watcher.watch(fixture.gitDir, {
      recursive: true,
      filterDirectories: async (dirs) => gitDirectoryWatchFilter(dirs),
      onChange: (entry) => scopes.push({ from: "git", entry, scope: attributeGitDirChange(entry, layout) }),
      onError: (error) => errors.push(error),
    }),
    watcher.watch(fixture.main, {
      recursive: true,
      onChange: (entry) => scopes.push({ from: "tree", entry, scope: attributeWorkingTreeChange(fixture.main, entry, layout) }),
      onError: (error) => errors.push(error),
    }),
  ];
  t.after(() => { for (const handle of handles) handle.close(); });
  // Let the host finish arming the watches before anything is written.
  await settle(200);
  const attributed = () => scopes.filter((item) => item.scope.kind !== "ignore");
  return { fixture, scopes, errors, attributed };
}

for (const platform of [process.platform, "linux"]) {
const built = platform === "linux" ? " (built-up watch)" : "";
// Built-up watches are inotify-only; elsewhere the variant is skipped.
const only = platform === "linux" && process.platform !== "linux" ? { skip: "built-up watches run only on Linux (inotify)" } : {};

test(`a file save is observed as a change to its worktree${built}`, only, async (t) => {
  const context = await watchRepository(t, platform);
  await writeFile(join(context.fixture.main, "a.txt"), "edited\n");
  await eventually(() => context.attributed().some((item) => item.from === "tree"), "the save was not observed");
  assert.deepEqual(context.errors, []);
});

test(`a commit and a branch switch are observed in the Git directory${built}`, only, async (t) => {
  const context = await watchRepository(t, platform);
  await writeFile(join(context.fixture.main, "a.txt"), "edited\n");
  await git(["commit", "-am", "second"], context.fixture.main);
  await eventually(() => context.attributed().some((item) => item.from === "git"), "the commit was not observed");

  context.scopes.length = 0;
  await git(["checkout", "-b", "topic"], context.fixture.main);
  await eventually(
    () => context.attributed().some((item) => item.from === "git" && item.entry?.replaceAll("\\", "/") === "HEAD"),
    "the branch switch was not observed",
  );
});

test(`writing objects alone is observed but attributes nothing${built}`, only, async (t) => {
  const context = await watchRepository(t, platform);
  await git(["hash-object", "-w", "a.txt"], context.fixture.main);
  await settle(500);
  assert.deepEqual(
    context.attributed().filter((item) => item.from === "git"),
    [],
    "object storage must not schedule a refresh",
  );
});

test(`a watch on a missing path reports an error rather than a silent gap${built}`, only, async (t) => {
  const { NodeGitStateWatcher } = await import("../dist/gitService/index.js");
  const errors = [];
  const handle = new NodeGitStateWatcher({ platform }).watch("/definitely/not/here/terminay", {
    recursive: true,
    onChange: () => {},
    onError: (error) => errors.push(error),
  });
  t.after(() => handle.close());
  await eventually(() => errors.length === 1, "the failed watch was not reported");
});
}
