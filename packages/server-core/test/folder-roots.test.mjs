import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FolderRootError, FolderRootResolver, WorkspaceStore, createInitialWorkspace } from "../dist/index.js";

/** Two projects on disk. The first has a worktree with a linked folder. */
async function fixture(run) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "terminay-folder-roots-")));
  try {
    const paths = { a: join(base, "a"), b: join(base, "b"), worktree: join(base, "a-feature"), elsewhere: join(base, "elsewhere") };
    for (const path of Object.values(paths)) await mkdir(path);
    const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
    const apply = (command) => {
      const applied = workspace.apply({ commandId: `c${workspace.state.revision}`, command });
      assert.equal(applied.ok, true, applied.ok ? "" : applied.conflict.message);
      return applied;
    };
    const viewId = workspace.state.viewOrder[0];
    apply({ type: "project.create", projectId: "project-a", viewId, root: paths.a, name: "A" });
    apply({ type: "project.create", projectId: "project-b", viewId, root: paths.b, name: "B" });
    const linked = apply({ type: "folder.create", projectId: "project-a", name: "feature", worktree: { repositoryId: "repo-a", path: paths.worktree } });
    const plain = apply({ type: "folder.create", projectId: "project-a", name: "Servers" });
    const folderIn = (applied) => applied.event.changedIds.find((id) => workspace.state.folders[id] !== undefined);
    const listing = { rows: [{ repositoryId: "repo-a", path: paths.a }, { repositoryId: "repo-a", path: paths.worktree }], calls: 0 };
    const resolver = new FolderRootResolver({
      workspace: () => workspace.state,
      worktrees: async () => {
        listing.calls += 1;
        if (listing.rows instanceof Error) throw listing.rows;
        return listing.rows;
      },
      canonicalize: async (path) => {
        const canonical = await realpath(path);
        if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory");
        return canonical;
      },
    });
    await run({ workspace, resolver, paths, listing, linked: folderIn(linked), plain: folderIn(plain), general: (projectId) => workspace.state.projects[projectId].folderIds[0] });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
const refuses = (promise, code) => assert.rejects(promise, (error) => error instanceof FolderRootError && error.code === code);

test("a linked folder resolves to its registered worktree, and other folders to the project root", async () => {
  await fixture(async ({ resolver, paths, linked, plain, general }) => {
    assert.deepEqual(await resolver.resolve("project-a", linked), { projectId: "project-a", folderId: linked, root: paths.worktree, worktree: true });
    assert.deepEqual(await resolver.resolve("project-a", plain), { projectId: "project-a", folderId: plain, root: paths.a, worktree: false });
    assert.deepEqual(await resolver.resolve("project-a", general("project-a")), { projectId: "project-a", folderId: general("project-a"), root: paths.a, worktree: false });
  });
});

test("a folder of another project, or one that does not exist, is refused before the listing is read", async () => {
  await fixture(async ({ resolver, listing, linked, general }) => {
    await refuses(resolver.resolve("project-b", linked), "folder_outside_project");
    await refuses(resolver.resolve("project-a", general("project-b")), "folder_outside_project");
    await refuses(resolver.resolve("project-a", "folder:missing"), "folder_not_found");
    await refuses(resolver.resolve("project-missing", linked), "folder_not_found");
    assert.equal(listing.calls, 0);
  });
});

test("a worktree that is no longer registered, or is prunable or bare, fails closed", async () => {
  await fixture(async ({ resolver, paths, listing, linked }) => {
    listing.rows = [{ repositoryId: "repo-a", path: paths.a }];
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
    listing.rows = [{ repositoryId: "repo-other", path: paths.worktree }];
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
    listing.rows = [{ repositoryId: "repo-a", path: paths.worktree, isPrunable: true }];
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
    listing.rows = [{ repositoryId: "repo-a", path: paths.worktree, isBare: true }];
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
    listing.rows = new Error("git is unavailable");
    await refuses(resolver.resolve("project-a", linked), "folder_root_unavailable");
  });
});

test("a worktree whose directory is gone, or was replaced by a link elsewhere, fails closed", async () => {
  await fixture(async ({ resolver, paths, linked }) => {
    await rm(paths.worktree, { recursive: true });
    await refuses(resolver.resolve("project-a", linked), "folder_root_unavailable");
    // Still registered by name, but the path now points out of the repository.
    await symlink(paths.elsewhere, paths.worktree);
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
  });
});

test("nothing is remembered between operations: each resolution reads the listing once and sees a change", async () => {
  await fixture(async ({ resolver, paths, listing, linked, plain }) => {
    await resolver.resolve("project-a", linked);
    await resolver.resolve("project-a", linked);
    assert.equal(listing.calls, 2);
    listing.rows = [{ repositoryId: "repo-a", path: paths.a }];
    await refuses(resolver.resolve("project-a", linked), "folder_worktree_unregistered");
    // A folder with no link needs no listing at all.
    const before = listing.calls;
    await resolver.resolve("project-a", plain);
    assert.equal(listing.calls, before);
  });
});
