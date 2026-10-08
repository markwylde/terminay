import assert from "node:assert/strict";
import test from "node:test";
import { FolderReconciler, WorkspaceStore, createInitialWorkspace, worktreesNeedingFolders } from "../dist/index.js";

const row = (path, extra = {}) => ({ repositoryId: "repo", path, ...extra });
const MAIN = row("/repo");

/** A project rooted at /repo with two terminals in General. */
function fixture({ root = "/repo" } = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  let serial = 0;
  const apply = (commandId, command) => workspace.apply({ commandId, command });
  const host = (command) => {
    const applied = apply(`setup-${++serial}`, command);
    assert.equal(applied.ok, true, applied.ok ? "" : applied.conflict.message);
  };
  host({ type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root, name: "A" });
  host({ type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", createdAt: 1 });
  host({ type: "terminal.createPanel", projectId: "project-a", sessionId: "session-b", panelId: "panel-b", createdAt: 2 });
  const git = { state: "ready", worktrees: [MAIN], reads: 0 };
  const appeared = [];
  const errors = [];
  const reconciler = new FolderReconciler({
    workspace: () => workspace.state,
    apply,
    worktrees: async () => {
      git.reads += 1;
      if (git.worktrees instanceof Error) throw git.worktrees;
      return { state: git.state, worktrees: git.worktrees };
    },
    canonicalRoot: async (path) => (path === "/missing" ? null : path),
    onWorktreeAppeared: (event) => appeared.push(event),
    onError: (_projectId, error) => errors.push(error),
  });
  const folders = () => workspace.state.projects["project-a"].folderIds.map((id) => workspace.state.folders[id]);
  const linked = () => folders().filter((folder) => folder.kind === "linked");
  return { workspace, reconciler, git, appeared, errors, host, folders, linked, general: () => folders()[0] };
}

test("every worktree but the project root's checkout gets one linked folder, named after its directory", async () => {
  const { reconciler, git, linked, general, appeared } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature"), row("/elsewhere/docs-refresh")];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => [folder.name, folder.worktree]), [
    ["feature", { repositoryId: "repo", path: "/repo/.worktrees/feature" }],
    ["docs-refresh", { repositoryId: "repo", path: "/elsewhere/docs-refresh" }],
  ]);
  assert.equal(general().kind, "general");
  assert.deepEqual(general().panelIds, ["panel-a", "panel-b"]);
  // Worktrees that were already there when the project was bound did not "appear".
  assert.deepEqual(appeared, []);
  // A second pass with nothing changed makes no revision.
  const before = linked().map((folder) => folder.id);
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => folder.id), before);
});

test("a worktree that turns up later is announced once, with its folder", async () => {
  const { reconciler, git, linked, appeared } = fixture();
  await reconciler.reconcile("project-a");
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  assert.equal(appeared.length, 1);
  assert.deepEqual(appeared[0], { projectId: "project-a", folderId: linked()[0].id, worktree: { repositoryId: "repo", path: "/repo/.worktrees/feature" } });
  await reconciler.reconcile("project-a");
  assert.equal(appeared.length, 1);
});

test("a worktree that disappears has its terminals moved to General, in order and unharmed, and its folder removed", async () => {
  const { workspace, reconciler, git, host, linked, general } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  const folderId = linked()[0].id;
  host({ type: "terminal.createPanel", projectId: "project-a", folderId, sessionId: "session-c", panelId: "panel-c", createdAt: 3 });
  host({ type: "terminal.createPanel", projectId: "project-a", folderId, sessionId: "session-d", panelId: "panel-d", createdAt: 4 });
  const sessions = workspace.state.terminalSessions;
  git.worktrees = [MAIN];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked(), []);
  assert.deepEqual(general().panelIds, ["panel-a", "panel-b", "panel-c", "panel-d"]);
  assert.deepEqual(workspace.state.terminalSessions, sessions);
});

test("a renamed folder stays linked, a bare entry gets no folder, and a registration whose directory is gone keeps one", async () => {
  const { reconciler, git, host, linked } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature"), row("/gone", { isPrunable: true }), row("/bare.git", { isBare: true })];
  await reconciler.reconcile("project-a");
  // The missing worktree is still registered, and its folder is where it is deleted from.
  assert.deepEqual(linked().map((folder) => folder.name), ["feature", "gone"]);
  host({ type: "folder.rename", folderId: linked()[0].id, name: "Releases" });
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => [folder.name, folder.worktree.path]), [["Releases", "/repo/.worktrees/feature"], ["gone", "/gone"]]);
  // A worktree whose directory disappears while it is listed keeps its folder and its panels.
  git.worktrees = [MAIN, row("/repo/.worktrees/feature", { isPrunable: true }), row("/gone", { isPrunable: true })];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => folder.name), ["Releases", "gone"]);
  // A missing checkout is never the one General stands for.
  assert.deepEqual(worktreesNeedingFolders([row("/repo", { isPrunable: true })], "/repo").map((entry) => entry.path), ["/repo"]);
});

test("a failed or indefinite listing changes nothing; a root that is not a repository drops linked folders", async () => {
  const { reconciler, git, linked, errors } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  for (const state of ["git-unavailable", "missing-gitfile", "command-error"]) {
    git.state = state;
    git.worktrees = [];
    await reconciler.reconcile("project-a");
    assert.equal(linked().length, 1, state);
  }
  git.worktrees = new Error("git exploded");
  await reconciler.reconcile("project-a");
  assert.equal(linked().length, 1);
  assert.equal(errors.length, 1);
  git.state = "not-repository";
  git.worktrees = [];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked(), []);
});

test("a move made through Terminay keeps the folder and its terminals", async () => {
  const { reconciler, git, host, linked, general } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  const folderId = linked()[0].id;
  host({ type: "panel.moveToFolder", panelId: "panel-b", folderId });
  assert.equal(reconciler.relink("project-a", "repo", "/repo/.worktrees/feature", "/repo/.worktrees/renamed"), true);
  git.worktrees = [MAIN, row("/repo/.worktrees/renamed")];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => [folder.id, folder.worktree.path, folder.panelIds]), [[folderId, "/repo/.worktrees/renamed", ["panel-b"]]]);
  assert.deepEqual(general().panelIds, ["panel-a"]);
  assert.equal(reconciler.relink("project-a", "repo", "/nowhere", "/x"), false);
});

test("calls for one project never overlap, and one that arrives mid-pass causes exactly one more pass", async () => {
  const { reconciler, git, linked } = fixture();
  const first = reconciler.reconcile("project-a");
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  const second = reconciler.reconcile("project-a");
  const third = reconciler.reconcile("project-a");
  await Promise.all([first, second, third]);
  assert.equal(git.reads, 2);
  assert.equal(linked().length, 1);
});

test("an unknown project, the automation space, and an unresolvable root are left alone", async () => {
  const { workspace, reconciler, git, linked } = fixture({ root: "/missing" });
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-missing");
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked(), []);
  const space = workspace.ensureAutomationSpace({ root: "/repo" });
  await reconciler.reconcile(space);
  assert.equal(workspace.state.projects[space].folderIds.length, 1);
});

test("General stands for the deepest checkout that contains the project root", () => {
  const paths = (rows, root) => worktreesNeedingFolders(rows, root).map((entry) => entry.path);
  const rows = [row("/repo"), row("/repo/.worktrees/feature"), row("/elsewhere/docs")];
  assert.deepEqual(paths(rows, "/repo"), ["/repo/.worktrees/feature", "/elsewhere/docs"]);
  // A project opened on a subdirectory of the main checkout.
  assert.deepEqual(paths(rows, "/repo/packages/app"), ["/repo/.worktrees/feature", "/elsewhere/docs"]);
  // A project opened on a linked worktree nested in the main checkout: the main checkout gets a folder.
  assert.deepEqual(paths(rows, "/repo/.worktrees/feature"), ["/repo", "/elsewhere/docs"]);
  // A sibling whose name merely starts the same is not a container.
  assert.deepEqual(paths([row("/repo"), row("/repo-two")], "/repo-two"), ["/repo"]);
});

test("a pass is held while Terminay moves a worktree, so the folder is relinked before anything is emptied", async () => {
  const { reconciler, git, host, linked, general } = fixture();
  git.worktrees = [MAIN, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  const folderId = linked()[0].id;
  host({ type: "panel.moveToFolder", panelId: "panel-b", folderId });

  const resume = reconciler.suspend("project-a");
  // The registry watch fires mid-move: the old path is gone, the new one is there.
  git.worktrees = [MAIN, row("/repo/.worktrees/renamed")];
  const reads = git.reads;
  await reconciler.reconcile("project-a");
  assert.equal(git.reads, reads);
  assert.deepEqual(linked().map((folder) => folder.worktree.path), ["/repo/.worktrees/feature"]);

  reconciler.relink("project-a", "repo", "/repo/.worktrees/feature", "/repo/.worktrees/renamed");
  resume();
  resume();
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => [folder.id, folder.worktree.path, folder.panelIds]), [[folderId, "/repo/.worktrees/renamed", ["panel-b"]]]);
  assert.deepEqual(general().panelIds, ["panel-a"]);
});

test("nested suspensions resume only when the last one ends, and with nothing asked for no pass runs", async () => {
  const { reconciler, git } = fixture();
  await reconciler.reconcile("project-a");
  const reads = git.reads;
  const first = reconciler.suspend("project-a");
  const second = reconciler.suspend("project-a");
  first();
  await reconciler.reconcile("project-a");
  assert.equal(git.reads, reads);
  second();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(git.reads, reads + 1);
  const idle = reconciler.suspend("project-a");
  idle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(git.reads, reads + 1);
});

test("a change inside a known worktree reads nothing; a removal, a registry change, or a new worktree runs a pass", async () => {
  const { reconciler, git, linked } = fixture();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  git.worktrees = [{ ...MAIN, id: "wt-main" }, { ...row("/repo/.worktrees/feature"), id: "wt-feature" }];
  // Before any pass nothing is known, so the first change runs one.
  reconciler.onGitChange({ projectId: "project-a", worktreeId: "wt-main" });
  await settle();
  assert.equal(git.reads, 1);
  assert.equal(linked().length, 1);

  // Edits inside worktrees the project already has folders for.
  for (const worktreeId of ["wt-main", "wt-feature", "wt-main"]) reconciler.onGitChange({ projectId: "project-a", worktreeId });
  await settle();
  assert.equal(git.reads, 1);

  // A worktree no pass has seen.
  git.worktrees = [...git.worktrees, { ...row("/repo/.worktrees/docs"), id: "wt-docs" }];
  reconciler.onGitChange({ projectId: "project-a", worktreeId: "wt-docs" });
  await settle();
  assert.equal(git.reads, 2);
  assert.equal(linked().length, 2);

  // A removal is reported with no worktree named.
  git.worktrees = [{ ...MAIN, id: "wt-main" }];
  reconciler.onGitChange({ projectId: "project-a", worktreeId: null });
  await settle();
  assert.equal(git.reads, 3);
  assert.deepEqual(linked(), []);

  // A released project forgets what it knew.
  reconciler.release("project-a");
  reconciler.onGitChange({ projectId: "project-a", worktreeId: "wt-main" });
  await settle();
  assert.equal(git.reads, 4);
});

test("a worktree that appears later records the panel that created it; one already there never asks", async () => {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const apply = (commandId, command) => workspace.apply({ commandId, command });
  apply("p", { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: "/repo", name: "A" });
  apply("t", { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", createdAt: 1 });
  const listing = { worktrees: [MAIN, row("/repo/.worktrees/old")] };
  const asked = [];
  const appeared = [];
  let creator = "panel-a";
  const reconciler = new FolderReconciler({
    workspace: () => workspace.state,
    apply,
    worktrees: async () => ({ state: "ready", worktrees: listing.worktrees }),
    canonicalRoot: async (path) => path,
    creatorOf: async (event) => {
      asked.push(event.worktree.path);
      if (creator instanceof Error) throw creator;
      return creator;
    },
    onWorktreeAppeared: (event) => appeared.push(event),
  });
  const folderFor = (path) => Object.values(workspace.state.folders).find((folder) => folder.worktree?.path === path);
  await reconciler.reconcile("project-a");
  assert.deepEqual(asked, []);
  assert.equal(folderFor("/repo/.worktrees/old").createdByPanelId, undefined);

  listing.worktrees = [...listing.worktrees, row("/repo/.worktrees/feature")];
  await reconciler.reconcile("project-a");
  assert.deepEqual(asked, ["/repo/.worktrees/feature"]);
  assert.equal(folderFor("/repo/.worktrees/feature").createdByPanelId, "panel-a");
  assert.equal(appeared.at(-1).createdByPanelId, "panel-a");

  // A creator that no longer exists, and a lookup that fails, still get a folder.
  creator = "panel-gone";
  listing.worktrees = [...listing.worktrees, row("/repo/.worktrees/second")];
  await reconciler.reconcile("project-a");
  assert.equal(folderFor("/repo/.worktrees/second").createdByPanelId, undefined);
  assert.equal(appeared.at(-1).createdByPanelId, undefined);
  creator = new Error("lookup failed");
  listing.worktrees = [...listing.worktrees, row("/repo/.worktrees/third")];
  await reconciler.reconcile("project-a");
  assert.equal(folderFor("/repo/.worktrees/third").kind, "linked");
});

test("a worktree moved outside Terminay keeps its folder, its terminals, and a name the user gave it", async () => {
  const { reconciler, git, host, linked, general, appeared } = fixture();
  git.worktrees = [MAIN, row("/wt/alpha", { branch: "feat/alpha" }), row("/wt/beta", { branch: "feat/beta" })];
  await reconciler.reconcile("project-a");
  const [alpha, beta] = linked().map((folder) => folder.id);
  host({ type: "terminal.createPanel", projectId: "project-a", folderId: alpha, sessionId: "session-c", panelId: "panel-c", createdAt: 3 });
  host({ type: "folder.rename", folderId: beta, name: "Payments" });
  host({ type: "terminal.createPanel", projectId: "project-a", folderId: beta, sessionId: "session-d", panelId: "panel-d", createdAt: 4 });

  // git worktree move, twice: each branch is now somewhere else.
  git.worktrees = [MAIN, row("/wt/alpha-moved", { branch: "feat/alpha" }), row("/elsewhere/beta-2", { branch: "feat/beta" })];
  await reconciler.reconcile("project-a");

  assert.deepEqual(linked().map((folder) => [folder.id, folder.name, folder.worktree.path, folder.panelIds]), [
    [alpha, "alpha-moved", "/wt/alpha-moved", ["panel-c"]],
    [beta, "Payments", "/elsewhere/beta-2", ["panel-d"]],
  ]);
  assert.deepEqual(general().panelIds, ["panel-a", "panel-b"]);
  // The same worktree somewhere else did not "appear".
  assert.deepEqual(appeared, []);
});

test("a worktree removed while another appears on a different branch is a removal and an arrival", async () => {
  const { reconciler, git, host, linked, general, appeared } = fixture();
  git.worktrees = [MAIN, row("/wt/alpha", { branch: "feat/alpha" })];
  await reconciler.reconcile("project-a");
  const alpha = linked()[0].id;
  host({ type: "terminal.createPanel", projectId: "project-a", folderId: alpha, sessionId: "session-c", panelId: "panel-c", createdAt: 3 });

  git.worktrees = [MAIN, row("/wt/other", { branch: "feat/other" })];
  await reconciler.reconcile("project-a");

  assert.equal(linked().length, 1);
  assert.notEqual(linked()[0].id, alpha);
  assert.deepEqual(linked()[0].panelIds, []);
  assert.deepEqual(general().panelIds, ["panel-a", "panel-b", "panel-c"]);
  assert.equal(appeared.length, 1);

  // A detached worktree has no branch to follow, so a move of one is a removal.
  git.worktrees = [MAIN, row("/wt/detached", { branch: null })];
  await reconciler.reconcile("project-a");
  git.worktrees = [MAIN, row("/wt/detached-moved", { branch: null })];
  await reconciler.reconcile("project-a");
  assert.deepEqual(linked().map((folder) => folder.name), ["detached-moved"]);
});
