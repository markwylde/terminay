import assert from "node:assert/strict";
import test from "node:test";
import { FolderRootError, FolderScopeCache } from "../dist/index.js";

function fixture() {
  /** folderId -> root, or an Error to throw. Absent means General/plain. */
  const worktrees = new Map([["folder-wt", "/worktree"]]);
  const calls = { resolve: 0, created: [], disposed: [] };
  const project = { projectId: "project-a", tag: "project" };
  const cache = new FolderScopeCache({
    roots: {
      resolve: async (projectId, folderId) => {
        calls.resolve += 1;
        const root = worktrees.get(folderId);
        if (root instanceof Error) throw root;
        return root === undefined ? { projectId, folderId, root: "/project", worktree: false } : { projectId, folderId, root, worktree: true };
      },
    },
    projectContext: (projectId) => (projectId === "project-a" ? project : undefined),
    create: (projectId, folderId, root) => {
      const context = { projectId, tag: `${folderId}@${root}` };
      calls.created.push(context.tag);
      return context;
    },
    dispose: (context) => calls.disposed.push(context.tag),
  });
  return { cache, worktrees, calls, project };
}

test("a linked folder gets its own services, reused while its root is unchanged, and the root is asked for every time", async () => {
  const { cache, calls, project } = fixture();
  const first = await cache.resolve("project-a", "folder-wt");
  const second = await cache.resolve("project-a", "folder-wt");
  assert.equal(first, second);
  assert.equal(first.tag, "folder-wt@/worktree");
  assert.deepEqual(calls.created, ["folder-wt@/worktree"]);
  assert.equal(calls.resolve, 2);
  // General and plain folders use the project's own services and cache nothing.
  assert.equal(await cache.resolve("project-a", "folder-general"), project);
  assert.equal(cache.size, 1);
});

test("a folder whose root changed gets new services and the old ones are disposed", async () => {
  const { cache, worktrees, calls } = fixture();
  await cache.resolve("project-a", "folder-wt");
  worktrees.set("folder-wt", "/moved");
  const moved = await cache.resolve("project-a", "folder-wt");
  assert.equal(moved.tag, "folder-wt@/moved");
  assert.deepEqual(calls.disposed, ["folder-wt@/worktree"]);
  assert.equal(cache.size, 1);
});

test("a failed resolution is not answered from the cache", async () => {
  const { cache, worktrees } = fixture();
  await cache.resolve("project-a", "folder-wt");
  worktrees.set("folder-wt", new FolderRootError("folder_worktree_unregistered", "gone"));
  await assert.rejects(cache.resolve("project-a", "folder-wt"), (error) => error.code === "folder_worktree_unregistered");
  await assert.rejects(cache.resolve("project-b", "folder-general"), (error) => error.code === "folder_root_unavailable");
});

test("entries are dropped with their project or folder, so the cache cannot outgrow the folders that exist", async () => {
  const { cache, worktrees, calls } = fixture();
  for (let index = 0; index < 50; index += 1) {
    worktrees.set(`folder-${index}`, `/wt-${index}`);
    await cache.resolve("project-a", `folder-${index}`);
  }
  assert.equal(cache.size, 50);
  cache.prune((folderId) => folderId === "folder-7");
  assert.equal(cache.size, 1);
  assert.equal(calls.disposed.length, 49);
  cache.releaseProject("project-b");
  assert.equal(cache.size, 1);
  cache.releaseProject("project-a");
  assert.equal(cache.size, 0);
  assert.equal(calls.disposed.length, 50);
});
