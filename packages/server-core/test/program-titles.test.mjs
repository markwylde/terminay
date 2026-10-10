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
  TERMINAL_TITLE_OPERATIONS,
  TerminalTitleService,
  bindTerminalTitles,
  createInitialWorkspace,
  createServerCoreComposition,
  createTerminalSignalParser,
  migrateWorkspaceState,
  parseTerminalSignals,
  projectionDeliveryKey,
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

/** A title service over a two-project workspace with one terminal, fed by a
 * real activity service, with every publication and every commit recorded. */
function live(enabled = { value: true }) {
  let writes = 0;
  const store = new WorkspaceStore(createInitialWorkspace("server-a"), { commit: () => { writes += 1; } });
  const view = store.state.viewOrder[0];
  for (const id of ["project-a", "project-b"])
    assert.equal(store.apply({ commandId: `create-${id}`, command: { type: "project.create", projectId: id, viewId: view, root: `/tmp/${id}`, name: id } }).ok, true);
  const panelId = openTerminal(store, "a", "Terminal 1");
  const timers = fakeTimers();
  const service = new TerminalTitleService({ workspace: store, enabled: () => enabled.value, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const activity = new TerminalActivityService({ serverId: "server-a" });
  const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
  activity.register(identity);
  const unbind = bindTerminalTitles(activity, service);
  const published = [];
  service.subscribe((event) => published.push(event));
  const write = (text) => activity.ingestPtyOutput(identity, text);
  const committed = { revision: store.state.revision, writes };
  /** Asserts that nothing since `live()` returned reached the workspace. */
  const untouched = () => {
    assert.equal(store.state.revision, committed.revision, "workspace revision");
    assert.equal(writes, committed.writes, "persistence writes");
  };
  return { store, panelId, timers, service, activity, identity, unbind, published, write, enabled, untouched, writes: () => writes };
}

test("a terminal shows its named title, else its program title, else its default name", () => {
  const { store, panelId, service, write, timers, published } = live();
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });

  write("\x1b]2;claude\x07");
  assert.equal(service.displayedTitle(panelId), "claude");
  // The workspace model holds no program title.
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });

  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "api" } }).ok, true);
  assert.equal(service.displayedTitle(panelId), "api");
  assert.deepEqual(titles(store, panelId), { title: "api", defaultTitle: "Terminal 1", namedTitle: "api" });

  // The program keeps writing; the name a person gave still wins, and
  // nothing is published for a title nobody sees.
  timers.elapse();
  const before = published.length;
  write("\x1b]2;vim\x07");
  assert.equal(service.displayedTitle(panelId), "api");
  assert.equal(published.length, before);
  assert.equal(service.programTitle(panelId), "vim");

  // Clearing the name returns the tab to the program's title...
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "" } }).ok, true);
  assert.equal(service.displayedTitle(panelId), "vim");
  assert.deepEqual(published.at(-1), { panelId, projectId: "project-a", sessionId: "session-a", title: "vim" });

  // ...and the program clearing its own returns it to the default name.
  timers.elapse();
  write("\x1b]2;\x07");
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  validateWorkspace(store.state);
});

test("clearing a name with no program title returns the default name", () => {
  const { store, panelId, service } = live();
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(service.displayedTitle(panelId), "api");
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: null } }).ok, true);
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
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

test("title sources are server-assigned, and no command sets a program title", () => {
  const store = workspace();
  const panelId = openTerminal(store, "a", "Terminal 1");
  for (const key of ["programTitle", "defaultTitle", "namedTitle"]) {
    const refused = apply(store, { type: "panel.update", panelId, patch: { [key]: "forged" } });
    assert.equal(refused.ok, false);
    assert.match(refused.conflict.message, /server-assigned/u);
  }
  assert.equal(apply(store, { type: "panel.update", panelId, patch: { title: "x".repeat(257) } }).ok, false);
  for (const command of [{ type: "panel.programTitle.set", panelId, title: "forged" }, { type: "panel.programTitles.clear" }])
    assert.equal(apply(store, command).ok, false, command.type);
  assert.equal("programTitle" in store.state.panels[panelId], false);

  const revision = () => store.state.panels[panelId].metadataRevision ?? 0;
  assert.equal(revision(), 0);
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(revision(), 1);
  apply(store, { type: "panel.update", panelId, patch: { emoji: "x" } });
  assert.equal(revision(), 1);
  apply(store, { type: "panel.update", panelId, patch: { title: "" } });
  assert.equal(revision(), 2);
});

test("a program title changes nothing in the workspace: no commit, no revision, no write", () => {
  const { store, panelId, service, write, timers, untouched } = live();
  const metadata = store.state.panels[panelId].metadataRevision ?? 0;
  const state = store.state;
  for (let second = 0; second < 60; second += 1) {
    write(`\x1b]2;working ${second}\x07`);
    timers.elapse();
  }
  assert.equal(service.displayedTitle(panelId), "working 59");
  untouched();
  assert.equal(store.state, state);
  assert.equal(store.state.panels[panelId].metadataRevision ?? 0, metadata);
});

test("a file panel displays no live title", () => {
  const { store, service } = live();
  assert.equal(apply(store, { type: "panel.create", panel: { id: "panel-file", projectId: "project-a", type: "file", path: "/tmp/project-a/a.txt", title: "a.txt", createdAt: 1 } }).ok, true);
  assert.equal(service.displayedTitle("panel-file"), undefined);
  assert.equal("panel-file" in service.snapshot().titles, false);
  assert.equal(apply(store, { type: "panel.update", panelId: "panel-file", patch: { title: "b.txt" } }).ok, true);
  assert.equal(store.state.panels["panel-file"].title, "b.txt");
  assert.equal("defaultTitle" in store.state.panels["panel-file"], false);
});

test("the title travels with a terminal moved to another project, and its old project is told it left", () => {
  const { store, panelId, service, write, published } = live();
  write("\x1b]2;claude\x07");
  published.length = 0;
  assert.equal(apply(store, { type: "panel.move", panelId, targetProjectId: "project-b" }).ok, true);
  assert.equal(store.state.panels[panelId].projectId, "project-b");
  assert.equal(service.displayedTitle(panelId), "claude");
  assert.deepEqual(published, [
    { panelId, projectId: "project-a", sessionId: "session-a", removed: true },
    { panelId, projectId: "project-b", sessionId: "session-a", title: "claude" },
  ]);
  assert.deepEqual(Object.keys(service.snapshot("project-a").titles), []);
  assert.deepEqual(Object.keys(service.snapshot("project-b").titles), [panelId]);
});

test("a title remains after its session exits, and goes when its panel closes", () => {
  const { store, panelId, service, write, published, activity, identity } = live();
  write("\x1b]2;claude\x07");
  assert.equal(apply(store, { type: "terminal.markExited", sessionId: "session-a", exitCode: 0, exitedAt: 2 }).ok, true);
  activity.remove?.(identity);
  assert.equal(service.displayedTitle(panelId), "claude");
  assert.equal(apply(store, { type: "panel.close", panelId }).ok, true);
  assert.equal(service.displayedTitle(panelId), undefined);
  assert.deepEqual(published.at(-1), { panelId, projectId: "project-a", sessionId: "session-a", removed: true });
  assert.deepEqual(service.snapshot().titles, {});
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
  }
  assert.equal(stored.panels[plain].title, "Terminal 2");
  assert.equal(stored.panels[renamed].title, "api");

  const migrated = migrateWorkspaceState(stored, "server-a");
  assert.deepEqual(pick(migrated.panels[plain]), { title: "Terminal 2", defaultTitle: "Terminal 2" });
  assert.deepEqual(pick(migrated.panels[renamed]), { title: "api", defaultTitle: "Terminal 2", namedTitle: "api" });
  validateWorkspace(migrated);
  // Idempotent.
  assert.deepEqual(migrateWorkspaceState(structuredClone(migrated), "server-a"), migrated);
});

test("a stored program title is dropped on load, and the terminal goes back to its name or default", () => {
  const store = workspace();
  const programOnly = openTerminal(store, "a", "Terminal 1");
  const named = openTerminal(store, "b", "Terminal 2");
  apply(store, { type: "panel.update", panelId: named, patch: { title: "api" } });
  const stored = structuredClone(store.state);
  // As written by a server that kept program titles in workspace state.
  stored.panels[programOnly].programTitle = "claude";
  stored.panels[programOnly].title = "claude";
  stored.panels[named].programTitle = "vim";

  const loaded = migrateWorkspaceState(stored, "server-a");
  assert.deepEqual(pick(loaded.panels[programOnly]), { title: "Terminal 1", defaultTitle: "Terminal 1" });
  assert.deepEqual(pick(loaded.panels[named]), { title: "api", defaultTitle: "Terminal 2", namedTitle: "api" });
  validateWorkspace(loaded);
  const reopened = new WorkspaceStore(loaded);
  const service = new TerminalTitleService({ workspace: reopened, enabled: () => true });
  assert.equal(service.displayedTitle(programOnly), "Terminal 1");
  assert.equal(service.displayedTitle(named), "api");
  service.dispose();
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

test("a program's title sequence becomes its terminal's displayed title, at most twice a window", () => {
  const { store, panelId, timers, service, published, write, untouched } = live();
  const events = write("\x1b]2;build\x1b[31m watcher‮\x07");
  // A title is not activity: it produces no signal-driven attention.
  assert.equal(events.some((event) => JSON.stringify(event).includes("structured:title")), false);
  assert.equal(service.displayedTitle(panelId), "build[31m watcher");
  assert.deepEqual(published, [{ panelId, projectId: "project-a", sessionId: "session-a", title: "build[31m watcher" }]);

  // The same title again publishes nothing.
  timers.elapse();
  write("\x1b]0;build[31m watcher\x07");
  assert.equal(published.length, 1);

  // An animated title costs at most two publications a window, ending on the latest.
  timers.elapse();
  for (let index = 1; index <= 20; index += 1) write(`\x1b]2;frame ${index}\x07`);
  assert.equal(published.length, 2);
  timers.elapse();
  assert.equal(published.length, 3);
  assert.equal(service.displayedTitle(panelId), "frame 20");

  // An empty title, or one that is nothing once sanitised, clears it.
  timers.elapse();
  write("\x1b]2; \x00 \x07");
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  assert.deepEqual(titles(store, panelId), { title: "Terminal 1", defaultTitle: "Terminal 1" });
  untouched();
});

test("a quiet terminal holds no timer", () => {
  const { timers, write } = live();
  assert.equal(timers.live(), 0);
  write("\x1b]2;once\x07");
  assert.equal(timers.live(), 1);
  timers.elapse();
  assert.equal(timers.live(), 0);
});

test("a title for a terminal with no panel, or after its panel closed, is dropped", () => {
  const { store, panelId, published, write, activity, service } = live();
  const stray = { serverId: "server-a", projectId: "project-a", sessionId: "session-stray" };
  activity.register(stray);
  activity.ingestPtyOutput(stray, "\x1b]2;nobody\x07");
  assert.equal(published.length, 0);
  assert.equal(store.apply({ commandId: "close", command: { type: "panel.close", panelId } }).ok, true);
  published.length = 0;
  write("\x1b]2;gone\x07");
  assert.equal(published.length, 0);
  assert.deepEqual(service.snapshot().titles, {});
});

test("with the setting off, titles are ignored and held ones are dropped", () => {
  const { store, panelId, service, write, enabled, timers, published, untouched } = live();
  write("\x1b]2;claude\x07");
  assert.equal(service.displayedTitle(panelId), "claude");

  // Reconciling while on changes nothing.
  service.reconcile();
  assert.equal(published.length, 1);

  enabled.value = false;
  write("\x1b]2;pending\x07");
  service.reconcile();
  timers.elapse();
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  assert.deepEqual(published.at(-1), { panelId, projectId: "project-a", sessionId: "session-a", title: "Terminal 1" });

  write("\x1b]2;ignored\x07");
  timers.elapse();
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  // Nothing to drop, so nothing is published.
  const before = published.length;
  service.reconcile();
  assert.equal(published.length, before);
  untouched();

  // A name still works while off, and titles resume when it is turned on.
  apply(store, { type: "panel.update", panelId, patch: { title: "api" } });
  assert.equal(service.displayedTitle(panelId), "api");
  enabled.value = true;
  service.reconcile();
  // The title dropped while off does not come back.
  assert.equal(service.programTitle(panelId), undefined);
  write("\x1b]2;back\x07");
  assert.equal(service.programTitle(panelId), "back");
  assert.equal(service.displayedTitle(panelId), "api");
});

test("unbinding and disposing stop titles being published", () => {
  const { panelId, service, unbind, write, published } = live();
  unbind();
  write("\x1b]2;late\x07");
  assert.equal(service.displayedTitle(panelId), "Terminal 1");
  service.dispose();
  service.observe("session-a", "later");
  assert.equal(published.length, 0);
});

test("a snapshot holds every terminal's displayed title, by project when asked", () => {
  const { store, panelId, service, write } = live();
  const other = openTerminal(store, "b", "deploy", "project-b");
  write("\x1b]2;claude\x07");
  assert.deepEqual(service.snapshot().titles, {
    [panelId]: { panelId, projectId: "project-a", sessionId: "session-a", title: "claude" },
    [other]: { panelId: other, projectId: "project-b", sessionId: "session-b", title: "deploy" },
  });
  assert.deepEqual(Object.keys(service.snapshot("project-b").titles), [other]);
  assert.equal(service.displayedTitleForSession("session-a"), "claude");
  assert.equal(service.displayedTitleForSession("session-nope"), undefined);
});

test("a title waiting to be delivered is replaced by a newer one for the same terminal", () => {
  const title = (revision, panelId, text) => ({ event: TERMINAL_TITLE_OPERATIONS.event, revision, cursor: String(revision), payload: { panelId, projectId: "project-a", sessionId: "s", title: text } });
  // One key per terminal: the delivery lane keeps only the newest value per key.
  assert.equal(projectionDeliveryKey(title(1, "panel-a", "frame 1")), projectionDeliveryKey(title(2, "panel-a", "frame 2")));
  assert.notEqual(projectionDeliveryKey(title(1, "panel-a", "x")), projectionDeliveryKey(title(2, "panel-b", "x")));
  // A removal takes the place of a title still queued, and the reverse.
  assert.equal(
    projectionDeliveryKey({ ...title(3, "panel-a", "x"), payload: { panelId: "panel-a", projectId: "project-a", sessionId: "s", removed: true } }),
    projectionDeliveryKey(title(4, "panel-a", "y")),
  );
  // Ordered events are never replaced by one another.
  const changed = (revision) => ({ event: "workspace.changed", revision, cursor: String(revision), payload: { projectId: null } });
  assert.notEqual(projectionDeliveryKey(changed(1)), projectionDeliveryKey(changed(2)));
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

async function composed(run, { claims } = {}) {
  let writes = 0;
  const store = new WorkspaceStore(createInitialWorkspace("title-server"), { commit: () => { writes += 1; } });
  const ptyFactory = createPtyFactory();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "title-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory,
    workspace: store,
    activity: new TerminalActivityService({ serverId: "title-server" }),
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write", ...(claims?.[hello.clientId] === undefined ? {} : { claims: claims[hello.clientId] }) }),
  });
  const clients = [];
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["workspace"] });
    await pair.open();
    await client.connect();
    clients.push({ client, serverTask });
    return client;
  };
  try {
    await run({ store, ptyFactory, composition, connect, writes: () => writes });
  } finally {
    for (const { client, serverTask } of clients) {
      await client.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
    }
    await composition.shutdown();
  }
}

/** Collects one client's title events, and lets a test wait for the next. */
async function titleEvents(client) {
  const seen = [];
  let wake = () => {};
  const subscription = await client.subscribe(TERMINAL_TITLE_OPERATIONS.event);
  subscription.onEvent((event) => { seen.push(event.payload); wake(); });
  const until = async (predicate) => {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(seen)}`);
      await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 20); });
    }
  };
  return { seen, until };
}

test("composed server: output names the tab for every client, a client cannot, and nothing is written back", async () => {
  await composed(async ({ store, ptyFactory, composition, connect, writes }) => {
    const first = await connect("title-client");
    const second = await connect("second-device");
    const created = await first.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "create-terminal" });
    const panel = () => Object.values(store.state.panels).find((candidate) => candidate.sessionId === created.result.sessionId);
    assert.equal(panel().title, "Terminal 1");
    const a = await titleEvents(first);
    const b = await titleEvents(second);
    const revision = store.state.revision;
    const written = writes();

    const pty = ptyFactory.processes[0];
    // A title, then a request to report it back: the first names the tab,
    // the second is answered with nothing.
    pty.emit("\x1b]2;build watcher\x07\x1b[21t");
    assert.deepEqual(pty.written, []);
    const named = (events) => events.some((event) => event.panelId === panel().id && event.title === "build watcher");
    await a.until(() => named(a.seen));
    await b.until(() => named(b.seen));
    assert.equal(composition.terminalTitles.displayedTitle(panel().id), "build watcher");
    // The workspace was not touched by it.
    assert.equal(store.state.revision, revision);
    assert.equal(writes(), written);
    assert.equal(panel().title, "Terminal 1");

    // A client that connects afterwards is told without the program writing again.
    const late = await connect("late-device");
    const snapshot = (await late.query(TERMINAL_TITLE_OPERATIONS.snapshot, {})).result;
    assert.equal(snapshot.titles[panel().id].title, "build watcher");

    for (const command of [
      { type: "panel.programTitle.set", panelId: panel().id, title: "forged" },
      { type: "panel.programTitles.clear" },
    ])
      await assert.rejects(() => first.command("workspace.command", { command }, { commandId: `forge-${command.type}` }));
    await assert.rejects(
      () => first.command("workspace.command", { command: { type: "panel.update", panelId: panel().id, patch: { programTitle: "forged" } } }, { commandId: "forge-patch" }),
      (error) => error?.code === "conflict",
    );
    assert.equal(composition.terminalTitles.displayedTitle(panel().id), "build watcher");

    // A client names the tab the ordinary way, and the program no longer shows.
    await first.command("workspace.command", { command: { type: "panel.update", panelId: panel().id, patch: { title: "api" } } }, { commandId: "rename" });
    assert.equal(panel().title, "api");
    await b.until(() => b.seen.at(-1)?.title === "api");
  });
});

test("composed server: a project-scoped connection learns only its own project's titles", async () => {
  await composed(async ({ store, ptyFactory, connect }) => {
    const owner = await connect("owner");
    const scoped = await connect("scoped");
    const inA = await owner.command("terminal.create", { projectId: "project-a", cwd: "/repo/a", cols: 80, rows: 24 }, { commandId: "create-a" });
    const inB = await owner.command("terminal.create", { projectId: "project-b", cwd: "/repo/b", cols: 80, rows: 24 }, { commandId: "create-b" });
    const panelOf = (sessionId) => Object.values(store.state.panels).find((candidate) => candidate.sessionId === sessionId).id;
    const events = await titleEvents(scoped);
    ptyFactory.processes[1].emit("\x1b]2;secret\x07");
    ptyFactory.processes[0].emit("\x1b]2;mine\x07");
    await events.until(() => events.seen.some((event) => event.title === "mine"));
    assert.equal(events.seen.some((event) => event.projectId !== "project-a"), false, JSON.stringify(events.seen));
    const snapshot = (await scoped.query(TERMINAL_TITLE_OPERATIONS.snapshot, {})).result;
    assert.deepEqual(Object.keys(snapshot.titles), [panelOf(inA.result.sessionId)]);
    assert.equal(panelOf(inB.result.sessionId) in snapshot.titles, false);
  }, { claims: { scoped: { projectId: "project-a" } } });
});

function pick(panel) {
  return Object.fromEntries(["title", "defaultTitle", "namedTitle", "programTitle"].filter((key) => key in panel).map((key) => [key, panel[key]]));
}

function titles(store, panelId) {
  return pick(store.state.panels[panelId]);
}