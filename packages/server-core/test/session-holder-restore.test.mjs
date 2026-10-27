import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInitialWorkspace,
  createServerCoreComposition,
  createSessionHolderPtyFactory,
  ServerSettingsRepository,
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

/** Every holder this file launched, by pid. */
const holders = new Map();

/** Launch a holder the way a host does, keeping its process to hear it exit. */
function launchHolder(entry, env) {
  const child = launchDetachedSessionHolder(process.execPath, [entry], { ...process.env, ...env });
  holders.set(child.pid, { child, exited: new Promise((resolve) => child.once("exit", resolve)) });
  return child;
}

/** Settles once a holder this file launched says it is ready (its record is in place). */
function holderReady(child) {
  const ready = child.stdio[3];
  ready.resume();
  return new Promise((resolve) => ready.once("close", resolve));
}

/** Settles once a holder this file launched has exited. */
function holderExited(pid) {
  const holder = holders.get(pid);
  assert.ok(holder, `holder ${pid} was not launched by this test`);
  // The holder is unreferenced so it never keeps a test alive; waiting on it
  // does, until it exits.
  holder.child.ref();
  return holder.exited;
}

/** Kill whatever holders a failed test left, then remove its data root. */
async function removeDataRoot(dataRoot) {
  for (const record of readHolderRecords(dataRoot)) {
    try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    if (holders.has(record.pid)) await holderExited(record.pid);
  }
  rmSync(dataRoot, { recursive: true, force: true });
}

/** Settles once a terminal's live output includes `value`. */
function outputIncludes(terminal, sessionId, value) {
  let output = "";
  let subscription;
  return new Promise((resolve) => {
    subscription = terminal.subscribe(sessionId, {
      onEvent: (event) => {
        if (event.type !== "output") return;
        output += text(event.bytes);
        if (output.includes(value)) resolve();
      },
    });
  }).finally(() => subscription.close());
}

/**
 * Have a shell hold the write end of a FIFO for as long as it lives. The open
 * returned settles once the shell holds it; reading it to the end settles
 * once the shell has exited, because exiting is what closes that end.
 */
async function lifeline(terminal, sessionId, dataRoot) {
  const path = join(dataRoot, `life-${sessionId}`);
  assert.equal(spawnSync("mkfifo", [path]).status, 0, "mkfifo");
  await terminal.write(sessionId, bytesOf(`exec 3> '${path}'\n`));
  const handle = await open(path, "r");
  return {
    ended: (async () => {
      try {
        await handle.readFile();
      } finally {
        await handle.close();
      }
    })(),
  };
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

  assert.deepEqual(result, { adopted: ["live"], ended: ["tail-exit", "lost"], orphaned: [], recovered: [] });

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

test("a terminal moved to another project before the restart is adopted under that project", async () => {
  const seeded = seededWorkspace(["moved"]);
  assert.equal(seeded.apply({ commandId: "move", command: { type: "panel.move", panelId: "panel-moved", targetProjectId: "other" } }).ok, true);
  const workspace = reloaded(seeded);
  // The holder still carries the project the shell was launched in.
  const holder = fakeHolder({ moved: { pid: 5151, from: 0, retained: "moved output" } });
  assert.equal((await holder.start())[0].projectId, "default");
  const terminal = service();

  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder, now: () => 1000 });

  assert.deepEqual(result.adopted, ["moved"]);
  const adopted = terminal.getSession("moved");
  assert.deepEqual([adopted.projectId, adopted.status, adopted.pid], ["other", "running", 5151]);
  assert.equal(workspace.state.panels["panel-moved"].projectId, "other");
  assert.equal(replayOf(terminal, "moved").output, "moved output");
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

test("a running shell the workspace does not know is recovered into a project of its own; an ended one is ended", async () => {
  const workspace = reloaded(seededWorkspace(["known"]));
  const holder = fakeHolder({
    known: { pid: 1, from: 0 },
    stranger: { pid: 2, from: 0, retained: "still typing" },
    finished: { pid: 3, from: 0, exit: { exitCode: 0, signal: null } },
  });
  const terminal = service();
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder, now: () => 1000 });
  assert.deepEqual(result.recovered, ["stranger"]);
  assert.deepEqual(result.orphaned, ["finished"]);
  assert.deepEqual(holder.ended, ["finished"]);
  assert.deepEqual(result.adopted.sort(), ["known", "stranger"]);
  // The stranger is running, shown, and in a project anyone can find.
  const stranger = terminal.getSession("stranger");
  assert.equal(stranger.status, "running");
  assert.equal(replayOf(terminal, "stranger").output, "still typing");
  const panel = Object.values(workspace.state.panels).find((candidate) => candidate.sessionId === "stranger");
  const project = workspace.state.projects[panel.projectId];
  assert.equal(project.name, "Recovered terminals");
  assert.equal(project.root, "/held/cwd");
  assert.ok(workspace.state.views[workspace.state.viewOrder[0]].projectIds.includes(project.id));
  assert.equal(stranger.projectId, project.id);
  assert.equal(terminal.getSession("known").status, "running");
  assert.equal(terminal.getSession("finished"), undefined);
});

test("a freshly initialized workspace ends its seed's namesake and recovers any other running shell", async () => {
  // First-run initialization commits one terminal session that is about to be
  // created. It must not be mistaken for a session that was lost, or the seed
  // that follows would find it already present and create nothing.
  const workspace = seededWorkspace(["seed"]);
  const seedId = "seed";
  assert.equal(workspace.state.terminalSessions[seedId].status, "running");
  const holder = fakeHolder({ [seedId]: { pid: 5, from: 0 }, leftover: { pid: 6, from: 0 } });
  const terminal = service();
  const result = await reattachHeldSessions({ serverId: SERVER_ID, workspace, terminal, holder, freshWorkspace: true });

  assert.deepEqual(result, { adopted: ["leftover"], ended: [], orphaned: [seedId], recovered: ["leftover"] });
  assert.deepEqual(holder.ended, [seedId]);
  assert.equal(terminal.getSession(seedId), undefined);
  assert.equal(terminal.getSession("leftover").status, "running");
  assert.equal(workspace.state.terminalSessions[seedId].status, "running");
  assert.equal(workspace.state.projects[workspace.state.terminalSessions.leftover.projectId].name, "Recovered terminals");
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

function realServer(dataRoot, workspace, buildId = "build-a", extra = {}) {
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId,
    limitMs: 60_000,
    launch: ({ env }) => launchHolder(ENTRY, env),
  });
  // Ending a session, tail and all, is heard when the factory finishes it.
  const ends = new Map();
  const ended = (sessionId) => {
    if (!ends.has(sessionId)) {
      let resolve;
      ends.set(sessionId, { promise: new Promise((settle) => { resolve = settle; }), resolve: () => resolve() });
    }
    return ends.get(sessionId);
  };
  const holder = {
    ...factory,
    end: async (sessionId) => {
      await factory.end(sessionId);
      ended(sessionId).resolve();
    },
  };
  let counter = 0;
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER_ID,
    serverVersion: "1.0.0",
    capabilities: [],
    sessionHolder: holder,
    workspace,
    ...extra,
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
  return { composition, holder, ended: (sessionId) => ended(sessionId).promise };
}

test("a composed server restarts onto its running terminals, and ending them is explicit", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => removeDataRoot(dataRoot));

  // First life: nothing restored, so each project is seeded with a terminal.
  const firstWorkspace = seededWorkspace([]);
  const first = realServer(dataRoot, firstWorkspace);
  await first.composition.start();
  const seeded = Object.keys(firstWorkspace.state.terminalSessions).sort();
  assert.equal(seeded.length, 2);
  const [keptId, closedId] = seeded;
  const pids = Object.fromEntries(seeded.map((id) => [id, first.composition.terminal.getSession(id).pid]));
  const [holder] = readHolderRecords(dataRoot);
  const closedShell = await lifeline(first.composition.terminal, closedId, dataRoot);
  const answered = outputIncludes(first.composition.terminal, keptId, "kept-23");
  await first.composition.terminal.write(keptId, bytesOf("echo kept-$((20+3))\n"));
  await answered;
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
  await closedShell.ended;
  assert.equal(isAlive(pids[keptId]), true);

  // Ending everything leaves no shell, no panel, and no holder. The holder
  // exits once its shells have, and removes its record before it does.
  await second.composition.endAllTerminalSessions();
  await second.composition.shutdown();
  await holderExited(holder.pid);
  assert.equal(isAlive(pids[keptId]), false);
  assert.deepEqual(readHolderRecords(dataRoot), []);
  assert.deepEqual(Object.keys(secondWorkspace.state.terminalSessions), []);
  assert.deepEqual(Object.values(secondWorkspace.state.panels).map((panel) => panel.type), ["file"]);
});

test("the first start with a holder on a data root that never had one restores as it always did", async () => {
  // An upgrade from a release whose terminals ended with the server: the
  // workspace remembers terminals, but no holder ever held them and nothing
  // was saved. Keeping those panels would greet every project with dead,
  // empty tabs.
  const workspace = reloaded(seededWorkspace(["old-1", "old-2"]));
  const created = [];
  const holder = {
    ...fakeHolder(),
    hadPriorState: () => false,
    setLimit() {},
    async detach() {},
    async endAll() {},
    start() { throw new Error("nothing is reattached on this start"); },
  };
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER_ID,
    serverVersion: "1.0.0",
    capabilities: [],
    sessionHolder: holder,
    workspace,
    workspaceStartup: {
      firstRun: false,
      createTerminal: async (request) => { created.push(request.projectId); },
    },
  });
  await composition.start();
  try {
    assert.deepEqual(Object.keys(workspace.state.terminalSessions), []);
    assert.deepEqual(Object.values(workspace.state.panels).map((panel) => panel.type), ["file"]);
    assert.deepEqual(created.sort(), ["default", "other"]);
  } finally {
    await composition.shutdown();
  }
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

  const { composition, ended } = realServer(dataRoot, workspace);
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
  await ended("gone");
  assert.equal(existsSync(sessionTailPath(dataRoot, "gone")), false);
});

test("a holder this server cannot speak to has its sessions ended and shown as ended", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => removeDataRoot(dataRoot));

  const futureEntry = fileURLToPath(new URL("./fixtures/session-holder-entry-future.mjs", import.meta.url));
  await holderReady(launchHolder(futureEntry, { TEST_HOLDER_DATA_ROOT: dataRoot }));
  const [future] = readHolderRecords(dataRoot);
  assert.deepEqual(future.versions, [99]);

  // Something from the future started a shell in it.
  const futureServer = await SessionHolderClient.connect(future, { versions: [99] });
  const { record, stream } = await futureServer.spawn({
    sessionId: "from-the-future", projectId: "default", shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24,
  });
  let seen = "";
  const answered = new Promise((resolve) => {
    stream.onData((_position, bytes) => {
      seen += text(bytes);
      if (seen.includes("future-99")) resolve();
    });
  });
  futureServer.write("from-the-future", bytesOf("echo future-$((90+9))\n"));
  await answered;
  await futureServer.close();

  const workspace = reloaded(seededWorkspace(["from-the-future"]));
  const { composition, holder } = realServer(dataRoot, workspace);
  await composition.start();
  t.after(async () => {
    await composition.endAllTerminalSessions();
    await composition.shutdown();
  });

  assert.deepEqual(holder.incompatibleGenerations(), ["ffffffffffffffff"]);
  // Start waited for the holder to remove its record, which it does only
  // after its shells have ended; the process itself exits just after.
  assert.equal(readHolderRecords(dataRoot).some((entry) => entry.pid === future.pid), false, "the unreachable holder is still serving");
  assert.equal(isAlive(record.pid), false, "its shell is still running");
  await holderExited(future.pid);
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

test("a restart registers Git reporting again for every running session it re-adopts, and for nothing else", async () => {
  const workspace = reloaded(seededWorkspace(["live", "done"]));
  const holder = fakeHolder({
    live: { pid: 4242, from: 0 },
    done: { pid: 4343, from: 0, exit: { exitCode: 0, signal: null } },
    stranger: { pid: 4444, from: 0 },
  });
  holder.detach = async () => {};
  const adopted = [];
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER_ID,
    serverVersion: "1.0.0",
    capabilities: [],
    sessionHolder: holder,
    workspace,
    gitCommands: {
      environmentFor: () => ({}),
      release: () => {},
      adopt: (sessionIds) => adopted.push(...sessionIds),
    },
    workspaceStartup: { firstRun: false, createTerminal: async () => {} },
  });
  await composition.start();
  try {
    // A running shell the workspace did not name is recovered and adopted
    // too (ADR-0071), so it reports again; the ended one does not.
    assert.deepEqual(adopted, ["live", "stranger"]);
  } finally {
    await composition.shutdown();
  }
});

test("a window lasts as long as its terminal: a restart keeps it, ending the terminals ends it", async (t) => {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => removeDataRoot(dataRoot));
  const storeDirectory = join(dataRoot, "app-windows");
  const windowed = () => ({
    settings: new ServerSettingsRepository({ load: async () => undefined, commit: async () => {} }),
    mcpApprovals: true,
    appWindows: { storeDirectory },
  });
  const firstWorkspace = seededWorkspace([]);
  const first = realServer(dataRoot, firstWorkspace, "build-a", windowed());
  await first.composition.start();
  const [keptId, endedId] = Object.keys(firstWorkspace.state.terminalSessions).sort();
  const openIn = (sessionId, title) => first.composition.appWindows.open({
    terminalSessionId: sessionId,
    projectId: firstWorkspace.state.terminalSessions[sessionId].projectId,
    title,
    source: { kind: "agent" },
    html: `<p>${title}</p>`,
  });
  const minimised = openIn(keptId, "Minimised");
  const open = openIn(keptId, "Open");
  openIn(endedId, "Gone");
  const endedShell = await lifeline(first.composition.terminal, endedId, dataRoot);
  const endedPid = first.composition.terminal.getSession(endedId).pid;
  await first.composition.shutdown();
  assert.equal(readdirSync(storeDirectory).length, 3, "shutting down with a holder ended a window");

  // One terminal's shell ends while no server is running.
  process.kill(endedPid, "SIGKILL");
  await endedShell.ended;

  const secondWorkspace = reloaded(firstWorkspace);
  const second = realServer(dataRoot, secondWorkspace, "build-a", windowed());
  await second.composition.start();
  assert.notEqual(second.composition.terminal.getSession(endedId)?.status, "running");
  assert.deepEqual(
    second.composition.appWindows.list().map(({ id, state, title }) => ({ id, state, title })),
    [
      { id: minimised.id, state: "minimised", title: "Minimised" },
      { id: open.id, state: "open", title: "Open" },
    ],
  );
  await second.composition.appWindows.flush();
  assert.deepEqual(readdirSync(storeDirectory).sort(), [`${minimised.id}.json`, `${open.id}.json`].sort());

  // Ending the terminals ends their windows, and nothing is left to restore.
  await second.composition.endAllTerminalSessions();
  await second.composition.shutdown();
  assert.deepEqual(readdirSync(storeDirectory), []);
});
