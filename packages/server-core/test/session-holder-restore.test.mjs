import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  createInitialWorkspace,
  createServerCoreComposition,
  createSessionHolderPtyFactory,
  launchDetachedSessionHolder,
  readHolderRecords,
  reattachHeldSessions,
  SessionHolderClient,
  sessionTailPath,
  TerminalService,
  WorkspaceStore,
  writeSessionTail,
} from "../dist/index.js";
import { restoreWorkspaceOnStartup } from "../dist/workspaceStartup.js";

const SERVER_ID = "restore-test";
const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (value) => new TextEncoder().encode(value);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(25);
  }
}

/** A workspace with two projects; `default` has a split of terminals and a file. */
function seededWorkspace(sessions) {
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER_ID));
  const viewId = workspace.state.viewOrder[0];
  const apply = (commandId, command) => {
    const result = workspace.apply({ commandId, command });
    assert.equal(result.ok, true, result.ok ? undefined : result.conflict.message);
  };
  apply("project", { type: "project.create", projectId: "default", viewId, root: tmpdir(), name: "Project" });
  apply("other", { type: "project.create", projectId: "other", viewId, root: tmpdir(), name: "Other" });
  let index = 0;
  for (const sessionId of sessions) {
    index += 1;
    apply(`terminal-${sessionId}`, {
      type: "terminal.createPanel",
      projectId: "default",
      sessionId,
      panelId: `panel-${sessionId}`,
      title: `Terminal ${index}`,
      cwd: tmpdir(),
      createdAt: index,
    });
  }
  apply("file", {
    type: "panel.create",
    panel: { id: "default-file", projectId: "default", type: "file", path: "README.md", createdAt: 50 },
  });
  return workspace;
}

/** What `WorkspaceRepository` does to a persisted state when it is loaded. */
function reloaded(workspace) {
  const next = new WorkspaceStore(structuredClone(workspace.state));
  next.markInterruptedSessions();
  return next;
}

/** A PTY double for a session a holder is keeping. */
function heldProcess({ pid, retained = "", exit } = {}) {
  const data = new Set();
  const exits = new Set();
  return {
    ...(pid === undefined ? {} : { pid }),
    writes: [],
    disposed: false,
    write(bytes) { this.writes.push(text(bytes)); },
    resize() {},
    kill() {},
    onData(listener) {
      data.add(listener);
      if (retained.length > 0) listener(bytesOf(retained));
      return () => data.delete(listener);
    },
    onExit(listener) {
      exits.add(listener);
      if (exit !== undefined) listener(exit);
      return () => exits.delete(listener);
    },
    dispose() { this.disposed = true; },
    emitData(value) { for (const listener of [...data]) listener(bytesOf(value)); },
  };
}

/** The slice of a session-holder factory that restart recovery uses. */
function fakeHolder(held = {}, tails = {}) {
  const ended = [];
  const pruned = [];
  return {
    ended,
    pruned,
    processes: new Map(),
    spawn() { throw new Error("nothing is spawned during recovery"); },
    async start() {
      return Object.entries(held).map(([sessionId, session]) => ({
        sessionId,
        projectId: "default",
        shellPath: "/bin/zsh",
        cwd: "/held/cwd",
        cols: 132,
        rows: 43,
        createdAt: 1,
        outputPosition: session.from + (session.retained ?? "").length,
        bufferedFrom: session.from,
        generation: "0123456789abcdef",
        ...(session.pid === undefined ? {} : { pid: session.pid }),
        ...(session.exit === undefined ? {} : { exit: { ...session.exit, at: 9 } }),
      }));
    },
    async adopt(sessionId) {
      const session = held[sessionId];
      const process = heldProcess({ pid: session.pid, retained: session.retained, exit: session.exit });
      this.processes.set(sessionId, process);
      const [record] = (await this.start()).filter((entry) => entry.sessionId === sessionId);
      return { process, record, from: session.from };
    },
    async end(sessionId) { ended.push(sessionId); },
    readTail: (sessionId) => tails[sessionId],
    pruneTails: (keep) => pruned.push([...keep].sort()),
  };
}

function service() {
  return new TerminalService({ serverId: SERVER_ID, ptyFactory: { spawn() { throw new Error("unexpected spawn"); } } });
}

function replayOf(terminal, sessionId) {
  const snapshot = terminal.getSession(sessionId);
  let output = "";
  const exits = [];
  const subscription = terminal.subscribe(sessionId, {
    fromPosition: snapshot.replayFrom,
    onEvent: (event) => {
      if (event.type === "output") output += text(event.bytes);
      else if (event.type === "exit") exits.push(event);
    },
  });
  subscription.close();
  return { output, exits };
}

test("a restart sorts every persisted session into running, exited, or interrupted", async () => {
  const workspace = reloaded(seededWorkspace(["live", "tail-exit", "lost"]));
  assert.deepEqual(
    Object.values(workspace.state.terminalSessions).map((session) => session.status),
    ["interrupted", "interrupted", "interrupted"],
  );
  const holder = fakeHolder(
    { live: { pid: 4242, from: 100, retained: "still here" } },
    {
      "tail-exit": {
        sessionId: "tail-exit", bufferedFrom: 40, outputPosition: 49, savedAt: 7, cols: 90, rows: 20, cwd: "/tail/cwd",
        exit: { exitCode: 7, signal: null, at: 6 }, bytes: bytesOf("last line"),
      },
    },
  );
  const terminal = service();
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder, now: () => 1000 });

  assert.deepEqual(result, { adopted: ["live"], ended: ["tail-exit", "lost"], orphaned: [] });

  // Still running: adopted under its original identity, with nothing spawned.
  const live = terminal.getSession("live");
  assert.deepEqual([live.status, live.pid, live.dimensions.cols, live.replayFrom, live.outputPosition], ["running", 4242, 132, 100, 110]);
  assert.equal(workspace.state.terminalSessions.live.status, "running");
  assert.equal(workspace.state.terminalSessions.live.interruptedAt, undefined);
  assert.equal(replayOf(terminal, "live").output, "still here");
  assert.deepEqual(holder.processes.get("live").writes, [], "adopting wrote to the shell");

  // Ended with a record: exited with its code and the output it left.
  const exited = terminal.getSession("tail-exit");
  assert.deepEqual([exited.status, exited.exit.exitCode, exited.dimensions.cols, exited.replayFrom], ["exited", 7, 90, 40]);
  assert.deepEqual([workspace.state.terminalSessions["tail-exit"].status, workspace.state.terminalSessions["tail-exit"].exitCode], ["exited", 7]);
  const exitedReplay = replayOf(terminal, "tail-exit");
  assert.equal(exitedReplay.output, "last line");
  assert.equal(exitedReplay.exits.length, 1);

  // Gone without a record: interrupted, present, and empty.
  const lost = terminal.getSession("lost");
  assert.equal(lost.status, "interrupted");
  assert.equal(workspace.state.terminalSessions.lost.status, "interrupted");
  assert.deepEqual(replayOf(terminal, "lost"), { output: "", exits: replayOf(terminal, "lost").exits });
  assert.equal(replayOf(terminal, "lost").exits.length, 1);

  // Input to an ended session goes nowhere.
  await assert.rejects(terminal.write("lost", bytesOf("ls\n")));
  assert.deepEqual(holder.pruned, [["lost", "tail-exit"]]);
});

test("a held session that had already ended replays its output and then its exit", async () => {
  const workspace = reloaded(seededWorkspace(["done"]));
  const holder = fakeHolder({ done: { pid: 77, from: 0, retained: "bye\n", exit: { exitCode: 3, signal: null } } });
  const terminal = service();
  const seen = [];
  terminal.onEvent((event) => seen.push(event.type));
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder });

  assert.deepEqual(result.ended, ["done"]);
  const done = terminal.getSession("done");
  assert.deepEqual([done.status, done.exit.exitCode], ["exited", 3]);
  // The pid of a dead process is not handed to anything that binds by pid.
  assert.equal(done.pid, undefined);
  assert.deepEqual(seen, ["output", "exit"]);
  assert.equal(replayOf(terminal, "done").output, "bye\n");
});

test("a held session the workspace does not know is ended", async () => {
  const workspace = reloaded(seededWorkspace(["known"]));
  const holder = fakeHolder({
    known: { pid: 1, from: 0 },
    stranger: { pid: 2, from: 0 },
  });
  const terminal = service();
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder });
  assert.deepEqual(result.orphaned, ["stranger"]);
  assert.deepEqual(holder.ended, ["stranger"]);
  assert.equal(terminal.getSession("stranger"), undefined);
  assert.equal(terminal.getSession("known").status, "running");
});

test("a freshly initialized workspace recovers nothing and ends whatever a holder still has", async () => {
  // First-run initialization commits one terminal session that is about to be
  // created. It must not be mistaken for a session that was lost, or the seed
  // that follows would find it already present and create nothing.
  const workspace = seededWorkspace(["seed"]);
  const seedId = "seed";
  assert.equal(workspace.state.terminalSessions[seedId].status, "running");
  const holder = fakeHolder({ [seedId]: { pid: 5, from: 0 }, leftover: { pid: 6, from: 0 } });
  const terminal = service();
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder, freshWorkspace: true });

  assert.deepEqual(result, { adopted: [], ended: [], orphaned: [seedId, "leftover"] });
  assert.deepEqual(holder.ended, [seedId, "leftover"]);
  assert.equal(terminal.getSession(seedId), undefined);
  assert.equal(workspace.state.terminalSessions[seedId].status, "running");
  assert.deepEqual(holder.pruned, [[]]);
});

test("panels, order, and layout are untouched, and only a project with no terminal is seeded", async () => {
  const before = seededWorkspace(["a", "b"]);
  const workspace = reloaded(before);
  const holder = fakeHolder({ a: { pid: 10, from: 0 } });
  const terminal = service();
  await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder });

  const created = [];
  await restoreWorkspaceOnStartup({
    workspace,
    preserveTerminalPanels: true,
    firstRun: false,
    liveSessionCount: () => terminal.listSessions().length,
    hasSession: (sessionId) => terminal.getSession(sessionId) !== undefined,
    createTerminal: async (request) => { created.push(request.projectId); },
  });

  assert.deepEqual(workspace.state.projects.default.panelIds, before.state.projects.default.panelIds);
  assert.equal(workspace.state.projects.default.activePanelId, before.state.projects.default.activePanelId);
  assert.deepEqual(workspace.state.panels, before.state.panels);
  assert.deepEqual(workspace.state.projects.default.layout, before.state.projects.default.layout);
  // `default` keeps its two terminal panels, one of them ended; `other` had
  // none, so it alone gets a fresh terminal.
  assert.deepEqual(created, ["other"]);
});

function realServer(dataRoot, workspace, buildId = "build-a") {
  const holder = createSessionHolderPtyFactory({
    dataRoot,
    buildId,
    limitMs: 60_000,
    launch: ({ env }) => launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env }),
  });
  let counter = 0;
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER_ID,
    serverVersion: "1.0.0",
    capabilities: [],
    sessionHolder: holder,
    workspace,
    workspaceStartup: {
      firstRun: false,
      createTerminal: async (request) => {
        counter += 1;
        const sessionId = `${buildId}-seed-${counter}`;
        const handle = await composition.terminal.createSession({
          projectId: request.projectId, sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: request.cols, rows: request.rows,
        });
        const registered = composition.workspaceOperations.applyHostCommand(`seed:${sessionId}`, {
          type: "terminal.createPanel",
          sessionId,
          projectId: request.projectId,
          panelId: `panel-${sessionId}`,
          title: "Terminal",
          cwd: dataRoot,
          createdAt: handle.snapshot().createdAt,
        }, workspace.state.revision);
        assert.equal(registered.ok, true, registered.ok ? undefined : registered.conflict.message);
      },
    },
  });
  return { composition, holder };
}

test("a composed server restarts onto its running terminals, and ending them is explicit", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await delay(50);
    rmSync(dataRoot, { recursive: true, force: true });
  });

  // First life: nothing restored, so each project is seeded with a terminal.
  const firstWorkspace = seededWorkspace([]);
  const first = realServer(dataRoot, firstWorkspace);
  await first.composition.start();
  const seeded = Object.keys(firstWorkspace.state.terminalSessions).sort();
  assert.equal(seeded.length, 2);
  const [keptId, closedId] = seeded;
  const pids = Object.fromEntries(seeded.map((id) => [id, first.composition.terminal.getSession(id).pid]));
  await first.composition.terminal.write(keptId, bytesOf("echo kept-$((20+3))\n"));
  await until(() => text(first.composition.terminal.readRetainedOutput(keptId, { maxBytes: 65536 }).bytes).includes("kept-23"), "the first command");
  const panelsBefore = structuredClone(firstWorkspace.state.panels);

  // Shutting down lets go: no exit is recorded and both shells keep running.
  await first.composition.shutdown();
  assert.deepEqual(seeded.map((id) => firstWorkspace.state.terminalSessions[id].status), ["running", "running"]);
  assert.deepEqual(seeded.map((id) => isAlive(pids[id])), [true, true]);

  // Second life, from the persisted state alone.
  const secondWorkspace = reloaded(firstWorkspace);
  const second = realServer(dataRoot, secondWorkspace);
  await second.composition.start();
  assert.deepEqual(Object.keys(secondWorkspace.state.terminalSessions).sort(), seeded, "a terminal was added or dropped");
  assert.deepEqual(secondWorkspace.state.panels, panelsBefore);
  for (const id of seeded) {
    assert.equal(secondWorkspace.state.terminalSessions[id].status, "running");
    assert.equal(second.composition.terminal.getSession(id).pid, pids[id]);
  }
  assert.ok(text(second.composition.terminal.readRetainedOutput(keptId, { maxBytes: 65536 }).bytes).includes("kept-23"));

  // Closing a panel ends that session in the holder, and only that one.
  const closed = second.composition.workspaceOperations.applyHostCommand("close", {
    type: "panel.close",
    panelId: `panel-${closedId}`,
  }, secondWorkspace.state.revision);
  assert.equal(closed.ok, true, closed.ok ? undefined : closed.conflict.message);
  await until(() => !isAlive(pids[closedId]), "the closed terminal's shell to end");
  assert.equal(isAlive(pids[keptId]), true);

  // Ending everything leaves no shell, no panel, and no holder.
  await second.composition.endAllTerminalSessions();
  await second.composition.shutdown();
  await until(() => !isAlive(pids[keptId]) && readHolderRecords(dataRoot).length === 0, "everything to end");
  assert.deepEqual(Object.keys(secondWorkspace.state.terminalSessions), []);
  assert.deepEqual(Object.values(secondWorkspace.state.panels).map((panel) => panel.type), ["file"]);
});

test("a saved tail becomes the panel's output and is deleted when the panel closes", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  const workspace = reloaded(seededWorkspace(["gone"]));
  writeSessionTail(dataRoot, {
    sessionId: "gone", bufferedFrom: 10, outputPosition: 22, savedAt: 5, cols: 100, rows: 30,
    exit: { exitCode: 0, signal: null, at: 4 }, bytes: bytesOf("final output"),
  });
  // A tail whose panel no longer exists has nothing to belong to.
  writeSessionTail(dataRoot, { sessionId: "forgotten", bufferedFrom: 0, outputPosition: 1, savedAt: 5, bytes: bytesOf("x") });

  const { composition } = realServer(dataRoot, workspace);
  await composition.start();
  t.after(async () => {
    await composition.endAllTerminalSessions();
    await composition.shutdown();
  });

  assert.equal(text(composition.terminal.readRetainedOutput("gone", { maxBytes: 65536 }).bytes), "final output");
  assert.deepEqual([workspace.state.terminalSessions.gone.status, workspace.state.terminalSessions.gone.exitCode], ["exited", 0]);
  assert.equal(existsSync(sessionTailPath(dataRoot, "forgotten")), false);
  assert.equal(existsSync(sessionTailPath(dataRoot, "gone")), true);
  // The project still has its (ended) terminal panel, so nothing was seeded there.
  assert.deepEqual(workspace.state.projects.default.panelIds.includes("panel-gone"), true);

  const closed = composition.workspaceOperations.applyHostCommand("close", { type: "panel.close", panelId: "panel-gone" }, workspace.state.revision);
  assert.equal(closed.ok, true, closed.ok ? undefined : closed.conflict.message);
  await until(() => !existsSync(sessionTailPath(dataRoot, "gone")), "the tail to be deleted");
});

test("a holder this server cannot speak to has its sessions ended and shown as ended", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await delay(50);
    rmSync(dataRoot, { recursive: true, force: true });
  });

  const futureEntry = fileURLToPath(new URL("./fixtures/session-holder-entry-future.mjs", import.meta.url));
  launchDetachedSessionHolder(process.execPath, [futureEntry], { ...process.env, TEST_HOLDER_DATA_ROOT: dataRoot });
  const [future] = await until(() => {
    const records = readHolderRecords(dataRoot);
    return records.length === 1 ? records : undefined;
  }, "the future holder");
  assert.deepEqual(future.versions, [99]);

  // Something from the future started a shell in it.
  const futureServer = await SessionHolderClient.connect(future, { versions: [99] });
  const { record, stream } = await futureServer.spawn({
    sessionId: "from-the-future", projectId: "default", shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24,
  });
  let seen = "";
  stream.onData((_position, bytes) => { seen += text(bytes); });
  futureServer.write("from-the-future", bytesOf("echo future-$((90+9))\n"));
  await until(() => seen.includes("future-99"), "the future shell to answer");
  await futureServer.close();

  const workspace = reloaded(seededWorkspace(["from-the-future"]));
  const { composition, holder } = realServer(dataRoot, workspace);
  await composition.start();
  t.after(async () => {
    await composition.endAllTerminalSessions();
    await composition.shutdown();
  });

  assert.deepEqual(holder.incompatibleGenerations(), ["ffffffffffffffff"]);
  assert.equal(isAlive(future.pid), false, "the unreachable holder is still running");
  assert.equal(isAlive(record.pid), false, "its shell is still running");
  const ended = composition.terminal.getSession("from-the-future");
  assert.equal(ended.status, "interrupted");
  assert.equal(workspace.state.terminalSessions["from-the-future"].status, "interrupted");
  assert.ok(text(composition.terminal.readRetainedOutput("from-the-future", { maxBytes: 65536 }).bytes).includes("future-99"));
  assert.equal(workspace.state.panels["panel-from-the-future"].type, "terminal");

  // New sessions still start, in a holder of this build.
  const fresh = await composition.terminal.createSession({
    projectId: "default", sessionId: "fresh", shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24,
  });
  assert.equal(fresh.snapshot().status, "running");
  assert.deepEqual(readHolderRecords(dataRoot).map((entry) => entry.buildId), ["build-a"]);
});
