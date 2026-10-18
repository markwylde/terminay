import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { FolderReconciler, WorkspaceStore, createInitialWorkspace, createWorktreeCaptureHost } from "../dist/index.js";
import { GitService } from "../dist/gitService/index.js";

const run = promisify(execFile);
let serial = 0;

/**
 * The whole chain a host wires, with a real repository and a real Git service:
 * Git reports a command, the registry watch reveals the worktree, the
 * reconciler makes its folder, and capture moves the terminal or offers to.
 */
async function fixture(t, { automatic = true, restart = false } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tmy-capture-e2e-")));
  const repo = join(root, "repo");
  await run("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"], { cwd: repo });

  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const apply = (commandId, command) => workspace.apply({ commandId, command });
  apply("p", { type: "project.create", projectId: "project-a", viewId: workspace.state.viewOrder[0], root: repo, name: "A" });
  apply("t1", { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", createdAt: 1 });
  apply("t2", { type: "terminal.createPanel", projectId: "project-a", sessionId: "session-b", panelId: "panel-b", createdAt: 2 });

  const git = new GitService();
  await git.bindProject("project-a", repo);
  const captured = [];
  let reported = 0;
  const reportWaiters = new Set();
  const hostOptions = {
    socketPath: join(tmpdir(), `tmy-e2e-${process.pid}-${++serial}.sock`),
    tokenKey: randomBytes(32),
    workspace: () => workspace.state,
    apply,
    moveAutomatically: () => automatic,
    // No terminal has a shell process here, so only Git's own report can name one.
    sessions: () => [],
    onCaptured: (event) => captured.push(event),
    onObservation: (report) => {
      if (report.kind !== "command.reported") return;
      reported += 1;
      for (const waiter of [...reportWaiters]) {
        if (reported < waiter.count) continue;
        reportWaiters.delete(waiter);
        waiter.resolve();
      }
    },
  };
  /** Settles once Git has reported `count` worktree additions over the socket. */
  const commandsReported = (count) => reported >= count
    ? Promise.resolve()
    : new Promise((resolve) => reportWaiters.add({ count, resolve }));
  // A shell started by an earlier run of the server keeps the environment
  // that run gave it; the earlier run is gone before the shell runs Git.
  const kept = new Map();
  if (restart) {
    const earlier = createWorktreeCaptureHost(hostOptions);
    assert.equal(await earlier.start(), true);
    kept.set("session-a", earlier.gitCommands.environmentFor("session-a"));
    earlier.close();
  }
  const host = createWorktreeCaptureHost(hostOptions);
  assert.equal(await host.start(), true);
  if (restart) host.gitCommands.adopt(kept.keys());
  const reconciler = new FolderReconciler({
    workspace: () => workspace.state,
    apply,
    worktrees: async (projectId) => {
      const listing = await git.worktrees(projectId);
      return { state: listing.state, worktrees: listing.worktrees };
    },
    canonicalRoot: (path) => realpath(path).catch(() => null),
    ...host.reconcilerHooks,
  });
  const unsubscribe = git.subscribe((event) => {
    if (event.type === "git.status.changed") reconciler.onGitChange(event);
  });
  await reconciler.reconcile("project-a");
  t.after(async () => {
    unsubscribe();
    host.close();
    git.releaseProject("project-a");
    await rm(root, { recursive: true, force: true });
  });

  const linked = () => Object.values(workspace.state.folders).filter((folder) => folder.kind === "linked");
  /**
   * Bring the project's folders in line with what Git now lists. Nothing here
   * watches the repository for the test, so it asks for a fresh listing as a
   * client would, then runs a reconcile pass, which settles after any pass
   * that listing started.
   */
  const reconciled = async () => {
    await git.worktrees({ projectId: "project-a", fresh: true });
    await reconciler.reconcile("project-a");
  };
  /**
   * Run `git worktree add` as a process of the given terminal session would.
   * A terminal's Git reports the command over the socket; this settles once
   * that report is in, as well as the process done.
   */
  const addWorktree = async (sessionId, name) => {
    const report = sessionId === null ? undefined : commandsReported(reported + 1);
    await run("sh", ["-c", `git -C '${repo}' worktree add -q -b ${name} '${join(root, name)}'`], {
      env: { ...process.env, ...(sessionId === null ? {} : (kept.get(sessionId) ?? host.gitCommands.environmentFor(sessionId))) },
    });
    await report;
  };
  return { workspace, captured, linked, reconciled, addWorktree, general: () => workspace.state.projects["project-a"].folderIds[0] };
}

test("a terminal that adds a worktree is moved into the folder that appears for it", async (t) => {
  const { workspace, captured, linked, reconciled, addWorktree, general } = await fixture(t);
  await addWorktree("session-a", "feature");
  await reconciled();
  assert.ok(linked().length === 1 && linked()[0].panelIds.length === 1, "the terminal was not captured");
  const folder = linked()[0];
  assert.equal(folder.name, "feature");
  assert.deepEqual(folder.panelIds, ["panel-a"]);
  assert.equal(folder.createdByPanelId, "panel-a");
  assert.equal(workspace.state.panels["panel-a"].folderId, folder.id);
  // The other terminal stayed where it was.
  assert.equal(workspace.state.panels["panel-b"].folderId, general());
  assert.deepEqual(captured, [{ projectId: "project-a", folderId: folder.id, panelId: "panel-a", fromFolderId: general() }]);
});

test("a terminal kept across a server restart is still moved into the folder of a worktree it adds", async (t) => {
  const { workspace, linked, reconciled, addWorktree, general } = await fixture(t, { restart: true });
  await addWorktree("session-a", "feature");
  await reconciled();
  assert.ok(linked().length === 1 && linked()[0].panelIds.length === 1, "the kept terminal was not captured");
  assert.deepEqual(linked()[0].panelIds, ["panel-a"]);
  assert.equal(workspace.state.panels["panel-b"].folderId, general());
});

test("with the setting off the folder appears with an offer and the terminal stays put", async (t) => {
  const { workspace, captured, linked, reconciled, addWorktree, general } = await fixture(t, { automatic: false });
  await addWorktree("session-b", "feature");
  await reconciled();
  assert.ok(linked().length === 1 && linked()[0].captureOffer !== undefined, "no offer was made");
  const folder = linked()[0];
  assert.deepEqual(folder.captureOffer, { panelId: "panel-b" });
  assert.deepEqual(folder.panelIds, []);
  assert.equal(workspace.state.panels["panel-b"].folderId, general());
  assert.deepEqual(captured, []);
});

test("a worktree added outside every terminal gets an empty folder and moves nobody", async (t) => {
  const { workspace, captured, linked, reconciled, addWorktree, general } = await fixture(t);
  await addWorktree(null, "outside");
  await reconciled();
  assert.ok(linked().length === 1, "no folder appeared");
  const folder = linked()[0];
  assert.deepEqual(folder.panelIds, []);
  assert.equal(folder.createdByPanelId, undefined);
  assert.equal(folder.captureOffer, undefined);
  for (const panelId of ["panel-a", "panel-b"]) assert.equal(workspace.state.panels[panelId].folderId, general());
  assert.deepEqual(captured, []);
});
