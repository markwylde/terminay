import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  DEFAULT_SERVER_SETTINGS,
  ProgramTitleCoalescer,
  SETTING_AUTHORITY,
  TerminalActivityService,
  WorkspaceStore,
  bindProgramTitles,
  createInitialWorkspace,
  createServerCoreComposition,
  createTerminalSignalParser,
  migrateWorkspaceState,
  parseTerminalSignals,
  sanitiseProgramTitle,
  validateWorkspace,
} from "../dist/index.js";

function workspace() {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"));
  const view = store.state.viewOrder[0];
  for (const id of ["project-a", "project-b"])
    assert.equal(store.apply({ commandId: `create-${id}`, command: { type: "project.create", projectId: id, viewId: view, root: `/tmp/${id}`, name: id } }).ok, true);
  return store;
}

function openTerminal(store, id, title, projectId = "project-a") {
  const applied = store.apply({
    commandId: `open-${id}`,
    command: { type: "terminal.createPanel", sessionId: `session-${id}`, projectId, panelId: `panel-${id}`, ...(title === undefined ? {} : { title }), cwd: "/tmp", createdAt: 1 },
  });
  assert.equal(applied.ok, true, applied.conflict?.message);
  return `panel-${id}`;
}

let serial = 0;
function apply(store, command) {
  serial += 1;
  return store.apply({ commandId: `command-${serial}`, command });
}

function fakeTimers() {
  const timers = [];
  return {
    setTimeout: (handler, milliseconds) => {
      const timer = { handler, milliseconds, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { timer.cancelled = true; },
    /** Fire every timer armed so far, once. */
    elapse: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.handler();
    },
    live: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

test("OSC 0 and OSC 2 are title signals; OSC 1 is not", () => {
  assert.deepEqual(parseTerminalSignals("\x1b]2;build watcher\x07"), [{ kind: "title", title: "build watcher" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]0;deploy\x1b\\"), [{ kind: "title", title: "deploy" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]2;a;b\x07"), [{ kind: "title", title: "a;b" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]2;\x07"), [{ kind: "title", title: "" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]2\x07"), [{ kind: "title", title: "" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]1;name\x07"), []);
});

test("a title sequence split across chunks is one signal, and an oversized one is none", () => {
  const parser = createTerminalSignalParser();
  assert.deepEqual(parser.push("\x1b]2;build"), []);
  assert.deepEqual(parser.push(" watcher\x07"), [{ kind: "title", title: "build watcher" }]);
  const bounded = createTerminalSignalParser({ maxPayloadBytes: 8 });
  assert.deepEqual(bounded.push("\x1b]2;a very long title\x07"), []);
  assert.deepEqual(bounded.push("\x1b]2;ok\x07"), [{ kind: "title", title: "ok" }]);
});

test("a program title is reduced to bounded display text", () => {
  assert.equal(sanitiseProgramTitle("build watcher"), "build watcher");
  assert.equal(sanitiseProgramTitle("a\rb\x1bc"), "a bc");
  assert.equal(sanitiseProgramTitle("safe‮gpj.exe"), "safegpj.exe");
  assert.equal(sanitiseProgramTitle("⁦a⁩\u0085b\u009b"), "ab");
  assert.equal(sanitiseProgramTitle("  many \t\n  spaces  "), "many spaces");
  assert.equal(sanitiseProgramTitle(" \t\x00\x07 "), undefined);
  assert.equal(sanitiseProgramTitle(""), undefined);
  assert.equal(sanitiseProgramTitle("x".repeat(400)).length, 256);
  // A character outside the BMP is never cut in half.
  const astral = sanitiseProgramTitle(`${"x".repeat(255)}\u{1F600}`);
  assert.equal(astral, "x".repeat(255));
});

test("a terminal shows its named title, else its program title, else its default name", () => {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });

  assert.equal(apply(store, { type: "panel.programTitle.set", panelId, title: "claude" }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "claude", defaultTitle: "Terminal 1", programTitle: "claude" });

  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "api" } }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "api", defaultTitle: "Terminal 1", namedTitle: "api", programTitle: "claude" });

  // The program keeps writing; the name a person gave still wins.
  assert.equal(apply(store, { type: "panel.programTitle.set", panelId, title: "vim" }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "api", defaultTitle: "Terminal 1", namedTitle: "api", programTitle: "vim" });

  // Clearing the name returns the tab to the program's title...
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "" } }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "vim", defaultTitle: "Terminal 1", programTitle: "vim" });

  // ...and the program clearing its own returns it to the default name.
  assert.equal(apply(store, { type: "panel.programTitle.set", panelId, title: null }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });
  validateWorkspace(store.state);
});

test("clearing a name with no program title returns the default name", () => {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: null } }).ok, true);
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });
});

test("a terminal created with a name carries it as its named title", () => {
  const store = workspace();
  openTerminal(store, "a", "Terminal 1");
  assert.deepEqual(titles(store, openTerminal(store, "b", "deploy")), { title: "deploy", defaultTitle: "Terminal 2", namedTitle: "deploy" });
  assert.deepEqual(titles(store, openTerminal(store, "c")), { title: "Terminal 3", defaultTitle: "Terminal 3" });

  // `panel.create` assigns the sources too, whatever the input claims.
  assert.equal(apply(store, { type: "terminal.create", sessionId: "session-d", projectId: "project-a" }).ok, true);
  assert.equal(apply(store, { type: "panel.create", panel: { id: "panel-d", projectId: "project-a", type: "terminal", sessionId: "session-d", title: "Terminal 4", programTitle: "forged", createdAt: 1 } }).ok, true);
  assert.deepEqual(titles(store, "panel-d"), { title: "Terminal 4", defaultTitle: "Terminal 4" });
});

test("title sources are server-assigned and only a named title advances the metadata revision", () => {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  for (const key of ["programTitle", "defaultTitle", "namedTitle"]) {
    const refused = apply(store, { type: "panel.update", panelId, patch: { [key]: "forged" } });
    assert.equal(refused.ok, false);
    assert.match(refused.conflict.message, /server-assigned/u);
  }
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "x".repeat(257) } }).ok, false);
  assert.equal(apply(store, { type: "panel.programTitle.set", panelId, title: "" }).ok, false);

  const revision = () => store.state.panels[panelId].metadataRevision ?? 0;
  assert.equal(revision(), 0);
  apply(store, { type: "panel.programTitle.set", panelId, title: "spinner 1" });
  apply(store, { type: "panel.programTitle.set", panelId, title: "spinner 2" });
  assert.equal(revision(), 0);
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(revision(), 1);
  apply(store, { type: "panel.update", panelId, patch: { emoji: "x" } });
  assert.equal(revision(), 1);
  apply(store, { type: "panel.update", panelId, patch: { title: "" } });
  assert.equal(revision(), 2);
});

test("a file panel has no program title", () => {
  const store = workspace();
  assert.equal(apply(store, { type: "panel.create", panel: { id: "panel-file", projectId: "project-a", type: "file", path: "/tmp/project-a/a.txt", title: "a.txt", createdAt: 1 } }).ok, true);
  assert.equal(apply(store, { type: "panel.programTitle.set", panelId: "panel-file", title: "x" }).ok, false);
  assert.equal(apply(store, { type: "panel.update", panelId: "panel-file", patch: { title: "b.txt" } }).ok, true);
  assert.equal(store.state.panels["panel-file"].title, "b.txt");
  assert.equal("defaultTitle" in store.state.panels["panel-file"], false);
});

test("the titles travel with a terminal moved to another project", () => {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  apply(store, { type: "panel.programTitle.set", panelId, title: "claude" });
  assert.equal(apply(store, { type: "panel.move", panelId, targetProjectId: "project-b" }).ok, true);
  assert.equal(store.state.panels[panelId].projectId, "project-b");
  assert.deepEqual(titles(store, panelId), { title: "claude", defaultTitle: "Terminal 1", programTitle: "claude" });
});

test("clearing every program title leaves names alone", () => {
  const store = workspace();
  const a = openTerminal(store, "a", "Terminal 1");
  const b = openTerminal(store, "b", "Terminal 2");
  apply(store, { type: "panel.programTitle.set", panelId: a, title: "claude" });
  apply(store, { type: "panel.programTitle.set", panelId: b, title: "vim" });
  apply(store, { type: "panel.update", panelId: b, patch: { title: "api" } });
  const cleared = apply(store, { type: "panel.programTitles.clear" });
  assert.equal(cleared.ok, true);
  assert.deepEqual([...cleared.event.changedIds].sort(), [a, b]);
  assert.deepEqual(titles(store, a), { title: "Terminal 1", defaultTitle: "Terminal 1" });
  assert.deepEqual(titles(store, b), { title: "api", defaultTitle: "Terminal 2", namedTitle: "api" });
});

test("a workspace stored before title sources gains them without changing a title", () => {
  const store = workspace();
  const plain = openTerminal(store, "a", "Terminal 2");
  const renamed = openTerminal(store, "b", "Terminal 1");
  apply(store, { type: "panel.update", panelId: renamed, patch: { title: "api" } });
  const stored = structuredClone(store.state);
  for (const panel of Object.values(stored.panels)) {
    delete panel.defaultTitle;
    delete panel.namedTitle;
    delete panel.programTitle;
  }
  assert.equal(stored.panels[plain].title, "Terminal 2");
  assert.equal(stored.panels[renamed].title, "api");

  const migrated = migrateWorkspaceState(stored, "server-a");
  assert.deepEqual(pick(migrated.panels[plain]), { title: "Terminal 2", defaultTitle: "Terminal 2" });
  assert.deepEqual(pick(migrated.panels[renamed]), { title: "api", defaultTitle: "Terminal 2", namedTitle: "api" });
  validateWorkspace(migrated);
  // Idempotent.
  assert.deepEqual(migrateWorkspaceState(structuredClone(migrated), "server-a"), migrated);

  // A store handed the old shape directly still resolves titles correctly.
  const legacy = new WorkspaceStore(stored);
  assert.equal(apply(legacy, { type: "panel.programTitle.set", panelId: renamed, title: "vim" }).ok, true);
  assert.equal(legacy.state.panels[renamed].title, "api");
  assert.equal(apply(legacy, { type: "panel.update", panelId: renamed, patch: { title: "" } }).ok, true);
  assert.equal(legacy.state.panels[renamed].title, "vim");
});

test("the store lets go of command outcomes older than its history", () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-a"), { maxHistory: 2 });
  const create = (id) => store.apply({ commandId: id, command: { type: "view.create", viewId: `view-${id}`, name: id } });
  assert.equal(create("a").ok, true);
  // Inside the history a repeated command id replays its outcome.
  assert.equal(create("a").revision, 1);
  create("b");
  create("c");
  // Outside it the outcome is gone, so the command is judged afresh.
  assert.equal(create("a").ok, false);
});

test("a burst of titles commits the first and one trailing latest", () => {
  const timers = fakeTimers();
  const commits = [];
  const coalescer = new ProgramTitleCoalescer({ commit: (sessionId, title) => commits.push([sessionId, title]), setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  for (let index = 1; index <= 20; index += 1) coalescer.push("s", `title ${index}`);
  assert.deepEqual(commits, [["s", "title 1"]]);
  timers.elapse();
  assert.deepEqual(commits, [["s", "title 1"], ["s", "title 20"]]);
  // The trailing commit opens a window of its own; a quiet one leaves nothing armed.
  assert.equal(timers.live(), 1);
  timers.elapse();
  assert.equal(timers.live(), 0);
  assert.equal(commits.length, 2);

  // Terminals do not share a window, and a cleared title is carried as such.
  coalescer.push("s", "again");
  coalescer.push("t", undefined);
  assert.deepEqual(commits.slice(2), [["s", "again"], ["t", undefined]]);

  // A forgotten or disposed terminal commits nothing more.
  coalescer.push("s", "pending");
  coalescer.forget("s");
  coalescer.push("t", "pending");
  coalescer.dispose();
  timers.elapse();
  assert.equal(commits.length, 4);
  assert.equal(timers.live(), 0);
});

function bound(enabled = { value: true }) {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  const timers = fakeTimers();
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
  activity.register(identity);
  const applied = [];
  const binding = bindProgramTitles({
    activity,
    workspace: () => store.state,
    apply: (commandId, command) => {
      applied.push(command);
      return store.apply({ commandId, command });
    },
    enabled: () => enabled.value,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const write = (text) => activity.ingestPtyOutput(identity, text);
  return { store, panelId, timers, applied, binding, write, enabled, activity, identity };
}

test("a program's title sequence becomes its terminal's title", () => {
  const { store, panelId, timers, applied, write } = bound();
  const events = write("\x1b]2;build\x1b[31m watcher‮\x07");
  // A title is not activity: it produces no signal-driven attention.
  assert.equal(events.some((event) => JSON.stringify(event).includes("structured:title")), false);
  assert.equal(store.state.panels[panelId].title, "build[31m watcher");
  assert.equal(store.state.panels[panelId].programTitle, "build[31m watcher");

  // The same title again commits nothing.
  timers.elapse();
  write("\x1b]0;build[31m watcher\x07");
  assert.equal(applied.length, 1);

  // An animated title costs at most two commits a window, ending on the latest.
  timers.elapse();
  for (let index = 1; index <= 20; index += 1) write(`\x1b]2;frame ${index}\x07`);
  assert.equal(applied.length, 2);
  timers.elapse();
  assert.equal(applied.length, 3);
  assert.equal(store.state.panels[panelId].title, "frame 20");

  // An empty title, or one that is nothing once sanitised, clears it.
  timers.elapse();
  write("\x1b]2; \x00 \x07");
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });
});

test("a title for a terminal with no panel, or after its panel closed, is dropped", () => {
  const { store, panelId, applied, write, activity } = bound();
  const stray = { serverId: "server-a", projectId: "project-a", sessionId: "session-stray" };
  activity.register(stray);
  activity.ingestPtyOutput(stray, "\x1b]2;nobody\x07");
  assert.equal(applied.length, 0);
  assert.equal(store.apply({ commandId: "close", command: { type: "panel.close", panelId } }).ok, true);
  write("\x1b]2;gone\x07");
  assert.equal(applied.length, 0);
});

test("with the setting off, titles are ignored and stored ones are dropped", () => {
  const { store, panelId, applied, binding, write, enabled, timers } = bound();
  write("\x1b]2;claude\x07");
  assert.equal(store.state.panels[panelId].title, "claude");

  // Reconciling while on changes nothing.
  binding.reconcile();
  assert.equal(applied.length, 1);

  enabled.value = false;
  write("\x1b]2;pending\x07");
  binding.reconcile();
  timers.elapse();
  assert.deepEqual(applied.at(-1), { type: "panel.programTitles.clear" });
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });

  write("\x1b]2;ignored\x07");
  timers.elapse();
  assert.equal(store.state.panels[panelId].title, "Terminal 1");
  // Nothing to drop, so nothing is committed.
  const before = applied.length;
  binding.reconcile();
  assert.equal(applied.length, before);

  // A name still works while off, and titles resume when it is turned on.
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(store.state.panels[panelId].title, "api");
  enabled.value = true;
  write("\x1b]2;back\x07");
  assert.equal(store.state.panels[panelId].programTitle, "back");
  assert.equal(store.state.panels[panelId].title, "api");
});

test("disposing the binding stops titles reaching the workspace", () => {
  const { store, panelId, binding, write } = bound();
  binding.dispose();
  write("\x1b]2;late\x07");
  assert.equal(store.state.panels[panelId].title, "Terminal 1");
});

test("letting programs set tab titles is a server setting that is on by default", () => {
  assert.equal(DEFAULT_SERVER_SETTINGS.programSetTabTitles, true);
  assert.equal(SETTING_AUTHORITY.programSetTabTitles, "server");
});

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn() {
      const dataListeners = new Set();
      const process = {
        pid: 40_000 + processes.length,
        written: [],
        write(data) { process.written.push(data); },
        resize() {},
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit() { return () => {}; },
        emit(data) { for (const listener of dataListeners) listener(data); },
      };
      processes.push(process);
      return process;
    },
  };
}

test("composed server: output names the tab, a client cannot, and nothing is written back", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("title-server"));
  const ptyFactory = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "title-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory,
    workspace: store,
    activity: new TerminalActivityService({ serverId: "title-server" }),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "title-client", capabilities: ["workspace"] });
  await pair.open();
  await client.connect();
  try {
    const created = await client.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "create-terminal" });
    const panel = () => Object.values(store.state.panels).find((candidate) => candidate.sessionId === created.result.sessionId);
    assert.equal(panel().title, "Terminal 1");

    const pty = ptyFactory.processes[0];
    // A title, then a request to report it back: the first names the tab,
    // the second is answered with nothing.
    pty.emit("\x1b]2;build watcher\x07\x1b[21t");
    assert.equal(panel().title, "build watcher");
    assert.deepEqual(pty.written, []);

    for (const command of [
      { type: "panel.programTitle.set", panelId: panel().id, title: "forged" },
      { type: "panel.programTitles.clear" },
    ])
      await assert.rejects(
        () => client.command("workspace.command", { command }, { commandId: `forge-${command.type}` }),
        (error) => error?.code === "forbidden",
      );
    await assert.rejects(
      () => client.command("workspace.command", { command: { type: "panel.update", panelId: panel().id, patch: { programTitle: "forged" } } }, { commandId: "forge-patch" }),
      (error) => error?.code === "conflict",
    );
    assert.equal(panel().programTitle, "build watcher");

    // A client names the tab the ordinary way, and the program no longer shows.
    await client.command("workspace.command", { command: { type: "panel.update", panelId: panel().id, patch: { title: "api" } } }, { commandId: "rename" });
    assert.equal(panel().title, "api");
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});

function pick(panel) {
  return Object.fromEntries(["title", "defaultTitle", "namedTitle", "programTitle"].filter((key) => key in panel).map((key) => [key, panel[key]]));
}

function titles(store, panelId) {
  return pick(store.state.panels[panelId]);
}
