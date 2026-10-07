import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  GitCommandStream,
  WorkspaceStore,
  WorktreeCapture,
  createInitialWorkspace,
  parseProcessTable,
  sessionRunningWorktreeAdd,
  worktreeAddDirectoryName,
} from "../dist/index.js";

const run = promisify(execFile);
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
let serial = 0;
/** Socket paths are capped near 104 bytes, so they live directly in tmpdir. */
const socketPath = () => join(tmpdir(), `tmy-capture-${process.pid}-${++serial}.sock`);

test("worktree add is recognised after any options, and nothing else is", () => {
  const name = (...argv) => worktreeAddDirectoryName(argv);
  assert.equal(name("git", "worktree", "add", "../feature"), "feature");
  assert.equal(name("git", "worktree", "add", "-b", "feat/x", "/repo/.worktrees/x", "main"), "x");
  assert.equal(name("git", "worktree", "add", "--detach", "-q", "wt/"), "wt");
  assert.equal(name("git", "worktree", "add", "--", "-odd-name"), "-odd-name");
  // Agents put configuration and a directory before the subcommand.
  assert.equal(name("/usr/bin/git", "-c", "core.fsmonitor=", "-C", "/repo", "worktree", "add", "x"), "x");
  assert.equal(name("git", "--no-pager", "worktree", "add", "x"), "x");
  // `worktree add` with no readable path is still the command.
  assert.equal(name("git", "worktree", "add", "-b"), "");
  for (const other of [["git", "status"], ["git", "worktree", "list"], ["git", "worktree", "remove", "x"], ["git", "commit", "-m", "worktree add x"], ["git"], []])
    assert.equal(worktreeAddDirectoryName(other), null);
  assert.equal(worktreeAddDirectoryName(["git", 7, "worktree", null, "add", "x"]), "x");
});

async function stream() {
  const seen = [];
  let token = 0;
  const commands = new GitCommandStream({ socketPath: socketPath(), onWorktreeAdd: (command) => seen.push(command), createToken: () => `tok-${++token}` });
  assert.equal(await commands.listen(), true);
  return { commands, seen };
}
function send(path, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.end(text, resolve));
    socket.on("error", reject);
  });
}

test("a terminal's Git reports worktree add with that terminal's token, and nothing else gets through", async (t) => {
  const { commands, seen } = await stream();
  t.after(() => commands.close());
  const env = commands.environmentFor("session-a");
  assert.match(env.GIT_TRACE2_EVENT, /^af_unix:stream:/);
  assert.equal(env.GIT_TRACE2_EVENT_BRIEF, "1");
  const path = env.GIT_TRACE2_EVENT.slice("af_unix:stream:".length);
  const token = env.GIT_TRACE2_PARENT_SID;
  // The same session always gets the same token.
  assert.equal(commands.environmentFor("session-a").GIT_TRACE2_PARENT_SID, token);
  const line = (value) => `${JSON.stringify(value)}\n`;
  await send(path, [
    line({ event: "version", sid: `${token}/1` }),
    line({ event: "start", sid: `${token}/1`, argv: ["git", "status"] }),
    line({ event: "start", sid: `${token}/20261008T1-P1/20261008T2-P2`, argv: ["git", "-C", "/repo", "worktree", "add", "-b", "feat", "../feature"] }),
    line({ event: "start", sid: "forged-token/1", argv: ["git", "worktree", "add", "x"] }),
    line({ event: "exit", sid: `${token}/1`, argv: ["git", "worktree", "add", "y"] }),
    "not json with \"start\" in it\n",
    line({ event: "start", sid: 7, argv: ["git", "worktree", "add", "z"] }),
    line({ event: "start", sid: `${token}/1`, argv: "git worktree add q" }),
  ].join(""));
  await settle();
  assert.deepEqual(seen, [{ sessionId: "session-a", directoryName: "feature" }]);

  // An ended session's token stops working.
  commands.release("session-a");
  assert.equal(commands.sessionCount, 0);
  await send(path, line({ event: "start", sid: `${token}/1`, argv: ["git", "worktree", "add", "late"] }));
  await settle();
  assert.equal(seen.length, 1);
});

test("the user's own tracing is left alone, and a stream that is not listening reports nothing", async (t) => {
  const { commands } = await stream();
  t.after(() => commands.close());
  for (const name of ["GIT_TRACE2_EVENT", "GIT_TRACE2", "GIT_TRACE2_PERF"]) assert.deepEqual(commands.environmentFor("session-a", { [name]: "/tmp/mine" }), {});
  assert.equal(commands.sessionCount, 0);
  const idle = new GitCommandStream({ socketPath: socketPath(), onWorktreeAdd: () => {}, createToken: () => "t" });
  assert.deepEqual(idle.environmentFor("session-a"), {});
  // A path too long to be a socket cannot listen, and that is survivable.
  const tooLong = new GitCommandStream({ socketPath: join(tmpdir(), `${"x".repeat(200)}.sock`), onWorktreeAdd: () => {}, createToken: () => "t" });
  assert.equal(await tooLong.listen(), false);
  assert.deepEqual(tooLong.environmentFor("session-a"), {});
});

test("an over-long line ends its connection and the stream carries on", async (t) => {
  const { commands, seen } = await stream();
  t.after(() => commands.close());
  const env = commands.environmentFor("session-a");
  const path = env.GIT_TRACE2_EVENT.slice("af_unix:stream:".length);
  await send(path, "x".repeat(200_000)).catch(() => {});
  await settle();
  await send(path, `${JSON.stringify({ event: "start", sid: `${env.GIT_TRACE2_PARENT_SID}/1`, argv: ["git", "worktree", "add", "after"] })}\n`);
  await settle();
  assert.deepEqual(seen, [{ sessionId: "session-a", directoryName: "after" }]);
});

test("100,000 events leave nothing behind in memory", async () => {
  // A separate process with a collectable heap: what is measured is what the
  // stream still holds, not what the collector has yet to free.
  const fixture = fileURLToPath(new URL("./fixtures/git-command-stream-memory.mjs", import.meta.url));
  const { stdout } = await run(process.execPath, ["--expose-gc", fixture]);
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(result.events, 100_000);
  assert.equal(result.seen, 0);
  assert.ok(result.bytes > 8 * 1024 * 1024);
  assert.ok(result.grown < 2 * 1024 * 1024, `heap grew by ${result.grown} bytes after ${result.bytes} bytes of events`);
});

test("real Git, run under a shell that carries the variables, reports the worktree it adds", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "tmy-capture-repo-")));
  const { commands, seen } = await stream();
  t.after(async () => {
    commands.close();
    await rm(root, { recursive: true, force: true });
  });
  const repo = join(root, "repo");
  await run("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "a\n");
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "init"], { cwd: repo });
  const env = { ...process.env, ...commands.environmentFor("session-a") };
  // Through an inner shell, the way an agent's tool call runs it.
  await run("sh", ["-c", `git -C '${repo}' worktree add -q -b feature '${join(root, "feature")}'`], { env });
  await run("sh", ["-c", `git -C '${repo}' status --short`], { env });
  await settle(100);
  assert.deepEqual(seen, [{ sessionId: "session-a", directoryName: "feature" }]);
});

test("a running git worktree add is walked up to its terminal's shell", () => {
  const rows = parseProcessTable([
    "    1     0 /sbin/launchd",
    "  100     1 -zsh",
    "  200   100 claude",
    "  300   200 /bin/sh -c git -C /repo worktree add -b feat ../feature",
    "  301   300 /usr/bin/git -C /repo worktree add -b feat ../feature",
    "  400     1 -zsh",
    "  401   400 git status",
    "  500     1 -zsh",
    "  501   500 vim worktree add notes",
    "garbage line",
  ].join("\n"));
  assert.equal(rows.length, 9);
  const shells = new Map([[100, "session-a"], [400, "session-b"], [500, "session-c"]]);
  assert.equal(sessionRunningWorktreeAdd(rows, shells, "feature"), "session-a");
  // A different directory, or a process outside every terminal, names nobody.
  assert.equal(sessionRunningWorktreeAdd(rows, shells, "other"), undefined);
  assert.equal(sessionRunningWorktreeAdd(rows, new Map([[400, "session-b"]]), "feature"), undefined);
  // Two terminals adding the same directory name at once: nobody is guessed.
  const both = [...rows, { pid: 402, ppid: 400, command: "git worktree add ../feature" }];
  assert.equal(sessionRunningWorktreeAdd(both, shells, "feature"), undefined);
});

/** A project with two terminals in General and an empty linked folder. */
function captureFixture({ automatic = true, processTable = async () => [] } = {}) {
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"));
  const apply = (commandId, command) => workspace.apply({ commandId, command });
  const host = (command) => {
    const applied = apply(`setup-${++serial}`, command);
    assert.equal(applied.ok, true, applied.ok ? "" : applied.conflict.message);
    return applied;
  };
  const viewId = workspace.state.viewOrder[0];
  host({ type: "project.create", projectId: "project-a", viewId, root: "/repo", name: "A" });
  host({ type: "project.create", projectId: "project-b", viewId, root: "/other", name: "B" });
  host({ type: "terminal.createPanel", projectId: "project-a", sessionId: "session-a", panelId: "panel-a", createdAt: 1 });
  host({ type: "terminal.createPanel", projectId: "project-a", sessionId: "session-b", panelId: "panel-b", createdAt: 2 });
  host({ type: "terminal.createPanel", projectId: "project-b", sessionId: "session-x", panelId: "panel-x", createdAt: 3 });
  const captured = [];
  let now = 1_000_000;
  let tables = 0;
  const capture = new WorktreeCapture({
    workspace: () => workspace.state,
    apply,
    moveAutomatically: () => automatic,
    shells: (projectId) => (projectId === "project-a" ? new Map([[100, "session-a"], [400, "session-b"]]) : new Map()),
    processTable: async () => {
      tables += 1;
      return processTable();
    },
    onCaptured: (event) => captured.push(event),
    now: () => now,
  });
  const linkedFolder = (createdByPanelId) => {
    const applied = host({ type: "folder.create", projectId: "project-a", name: "feature", worktree: { repositoryId: "repo", path: "/repo/.worktrees/feature" }, ...(createdByPanelId === undefined ? {} : { createdByPanelId }) });
    return applied.event.changedIds.find((id) => workspace.state.folders[id]?.kind === "linked");
  };
  const appeared = { projectId: "project-a", worktree: { repositoryId: "repo", path: "/repo/.worktrees/feature" } };
  return { workspace, capture, captured, appeared, linkedFolder, tables: () => tables, advance: (ms) => { now += ms; }, general: () => workspace.state.projects["project-a"].folderIds[0] };
}

test("Git's own report names the creator, once, and only for a terminal of the project", async () => {
  const { capture, appeared, tables } = captureFixture();
  capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: "feature" });
  assert.equal(await capture.creatorOf(appeared), "panel-a");
  // The process table was never read: Git had already said who it was.
  assert.equal(tables(), 0);
  // The same command does not explain a second worktree of the same name.
  assert.equal(await capture.creatorOf(appeared), undefined);

  // A terminal of another project, a different directory, and two terminals at once name nobody.
  capture.noteWorktreeAdd({ sessionId: "session-x", directoryName: "feature" });
  assert.equal(await capture.creatorOf(appeared), undefined);
  capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: "elsewhere" });
  assert.equal(await capture.creatorOf(appeared), undefined);
  capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: "feature" });
  capture.noteWorktreeAdd({ sessionId: "session-b", directoryName: "feature" });
  assert.equal(await capture.creatorOf(appeared), undefined);
});

test("a command whose path could not be read still names its terminal when nothing more exact does, and old commands expire", async () => {
  const { capture, appeared, advance } = captureFixture();
  capture.noteWorktreeAdd({ sessionId: "session-b", directoryName: "" });
  assert.equal(await capture.creatorOf(appeared), "panel-b");
  capture.noteWorktreeAdd({ sessionId: "session-b", directoryName: "" });
  capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: "feature" });
  assert.equal(await capture.creatorOf(appeared), "panel-a");

  const stale = captureFixture();
  stale.capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: "feature" });
  stale.advance(10 * 60_000);
  assert.equal(await stale.capture.creatorOf(stale.appeared), undefined);
  assert.equal(stale.capture.rememberedCommands, 0);
  advance(0);
});

test("only a bounded number of commands is ever remembered", () => {
  const { capture } = captureFixture();
  for (let index = 0; index < 10_000; index += 1) capture.noteWorktreeAdd({ sessionId: "session-a", directoryName: `wt-${index}` });
  assert.ok(capture.rememberedCommands <= 32);
});

test("with no report, a git worktree add still running is found in one read of the process table", async () => {
  const table = [{ pid: 100, ppid: 1, command: "-zsh" }, { pid: 301, ppid: 100, command: "git worktree add -b feat ../feature" }];
  const { capture, appeared, tables } = captureFixture({ processTable: async () => table });
  assert.equal(await capture.creatorOf(appeared), "panel-a");
  assert.equal(tables(), 1);
  const none = captureFixture();
  assert.equal(await none.capture.creatorOf(none.appeared), undefined);
});

test("with the setting on the creator moves into the folder and the move is announced", () => {
  const { workspace, capture, captured, appeared, linkedFolder, general } = captureFixture();
  const folderId = linkedFolder("panel-a");
  capture.capture({ ...appeared, folderId, panelId: "panel-a" });
  assert.equal(workspace.state.panels["panel-a"].folderId, folderId);
  assert.deepEqual(workspace.state.folders[folderId].panelIds, ["panel-a"]);
  assert.deepEqual(captured, [{ projectId: "project-a", folderId, panelId: "panel-a", fromFolderId: general() }]);
  assert.equal(workspace.state.terminalSessions["session-a"].projectId, "project-a");
  // Asked again once it is there, nothing happens.
  capture.capture({ ...appeared, folderId, panelId: "panel-a" });
  assert.equal(captured.length, 1);
});

test("with the setting off the folder offers the move and nothing moves", () => {
  const { workspace, capture, captured, appeared, linkedFolder, general } = captureFixture({ automatic: false });
  const folderId = linkedFolder("panel-a");
  capture.capture({ ...appeared, folderId, panelId: "panel-a" });
  assert.equal(workspace.state.panels["panel-a"].folderId, general());
  assert.deepEqual(workspace.state.folders[folderId].captureOffer, { panelId: "panel-a" });
  assert.equal(workspace.state.folders[folderId].createdByPanelId, "panel-a");
  assert.deepEqual(captured, []);
  // A panel of another project is never offered or moved.
  capture.capture({ ...appeared, folderId, panelId: "panel-x" });
  assert.deepEqual(workspace.state.folders[folderId].captureOffer, { panelId: "panel-a" });
});
