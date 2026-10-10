import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient } from "@terminay/client-core";
import {
  FEATURE_CAPABILITIES,
  WORKSPACE_DELTA_VERSION,
  WORKSPACE_RECORDS_DELTA_VERSION,
  parseWorkspaceChangeRecordDto,
  parseWorkspaceRecordsDeltaDto,
} from "@terminay/protocol";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  WORKSPACE_EVENT,
  WORKSPACE_OPERATIONS,
  WorkspaceStore,
  createInitialWorkspace,
  createServerCoreComposition,
} from "../dist/index.js";

const RECORDS = FEATURE_CAPABILITIES.workspaceChanges;

/** A composed server over two projects, `project-a` with two terminals and
 * `project-b` with one, and a way to connect clients to it. */
async function served(run, { claims = {}, storeOptions = {} } = {}) {
  const store = new WorkspaceStore(createInitialWorkspace("wire-server"), storeOptions);
  const view = store.state.viewOrder[0];
  for (const id of ["project-a", "project-b"])
    assert.equal(store.apply({ commandId: `create-${id}`, command: { type: "project.create", projectId: id, viewId: view, root: `/tmp/${id}`, name: id } }).ok, true);
  for (const [id, projectId] of [["a1", "project-a"], ["a2", "project-a"], ["b1", "project-b"]])
    assert.equal(store.apply({ commandId: `open-${id}`, command: { type: "terminal.createPanel", sessionId: `session-${id}`, projectId, panelId: `panel-${id}`, cwd: "/tmp", createdAt: 1 } }).ok, true);
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "wire-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    // Panels are placed by workspace commands; no terminal is ever spawned.
    ptyFactory: { spawn() { throw new Error("this server spawns no terminals"); } },
    workspace: store,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write", ...(claims[hello.clientId] === undefined ? {} : { claims: claims[hello.clientId] }) }),
  });
  const open = [];
  const connect = async (clientId, capabilities = ["workspace", RECORDS]) => {
    const pair = createInMemoryTransportPair();
    const serverTask = composition.core.accept(pair.server).start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities });
    await pair.open();
    await client.connect();
    open.push({ client, serverTask });
    const events = [];
    let wake = () => {};
    const subscription = await client.subscribe(WORKSPACE_EVENT);
    subscription.onEvent((event) => { events.push(event.payload); wake(); });
    return {
      client,
      events,
      /** The event for `revision`, once it has arrived. */
      event: async (revision) => {
        const deadline = Date.now() + 2_000;
        for (;;) {
          const found = events.find((payload) => payload.revision === revision);
          if (found !== undefined) return found;
          if (Date.now() > deadline) throw new Error(`no event for revision ${revision}; saw ${JSON.stringify(events)}`);
          await new Promise((resolve) => { wake = resolve; setTimeout(resolve, 20); });
        }
      },
      delta: async (revision) => (await client.query(WORKSPACE_OPERATIONS.delta, { revision, cursor: String(revision) })).result,
      snapshot: async () => (await client.query(WORKSPACE_OPERATIONS.snapshot, {})).result,
    };
  };
  let serial = 0;
  const commit = (command) => {
    serial += 1;
    const applied = composition.workspaceOperations.applyHostCommand(`wire-${serial}`, command);
    assert.equal(applied.ok, true, applied.conflict?.message);
    return applied.revision;
  };
  try {
    await run({ store, composition, connect, commit });
  } finally {
    for (const { client, serverTask } of open) {
      await client.close().catch(() => undefined);
      await serverTask.catch(() => undefined);
    }
    await composition.shutdown();
  }
}

/** Apply a change record to a snapshot, as a client does. */
function applied(snapshot, record) {
  assert.equal(record.fromRevision, snapshot.revision, "the record starts from the held revision");
  const next = { ...snapshot, revision: record.revision, cursor: record.cursor };
  for (const [collection, members] of Object.entries(record.changed))
    next[collection] = { ...next[collection], ...members };
  for (const [collection, ids] of Object.entries(record.removed)) {
    next[collection] = { ...next[collection] };
    for (const id of ids) delete next[collection][id];
  }
  if (record.viewOrder !== undefined) next.viewOrder = record.viewOrder;
  return next;
}

const ids = (collection) => Object.keys(collection ?? {}).sort();

test("the change event carries the commit's record, and it is enough to advance", async () => {
  await served(async ({ connect, commit }) => {
    const peer = await connect("capable");
    const before = await peer.snapshot();
    const revision = commit({ type: "panel.update", panelId: "panel-a1", patch: { title: "api" } });
    const event = await peer.event(revision);
    const record = parseWorkspaceChangeRecordDto(event.record);
    // This server serves no automations, so every connection is one the
    // automation space is withheld from: its records are scoped, and a scoped
    // record does not say what kind of command ran.
    assert.equal("type" in record, false);
    assert.deepEqual(Object.keys(record.changed), ["panels"]);
    assert.deepEqual(ids(record.changed.panels), ["panel-a1"]);
    assert.deepEqual(record.removed, {});
    // Applied to what the client held, it is what the server now serves.
    assert.deepEqual(applied(before, record), await peer.snapshot());
  });
});

test("a peer that did not negotiate change records gets the event and the delta it always did", async () => {
  await served(async ({ connect, commit, store }) => {
    const peer = await connect("legacy", ["workspace"]);
    const from = store.state.revision;
    const revision = commit({ type: "panel.update", panelId: "panel-a1", patch: { title: "api" } });
    const event = await peer.event(revision);
    assert.equal("record" in event, false);
    assert.deepEqual(Object.keys(event).sort(), ["cursor", "projectId", "revision", "serverId"]);
    const delta = await peer.delta(from);
    assert.equal(delta.deltaVersion, WORKSPACE_DELTA_VERSION);
    assert.equal(delta.state.revision, revision);
    assert.equal(delta.state.panels["panel-a1"].title, "api");
    assert.equal("records" in delta, false);
  });
});

test("a delta is the ordered records since a revision, and carries only what changed", async () => {
  await served(async ({ connect, commit, store }) => {
    const peer = await connect("capable");
    const from = store.state.revision;
    const before = await peer.snapshot();
    commit({ type: "panel.update", panelId: "panel-a1", patch: { title: "api" } });
    commit({ type: "panel.close", panelId: "panel-a2" });
    const delta = parseWorkspaceRecordsDeltaDto(await peer.delta(from), { serverId: "wire-server", revision: from, cursor: String(from) });
    assert.equal(delta.deltaVersion, WORKSPACE_RECORDS_DELTA_VERSION);
    assert.equal(delta.state, undefined);
    assert.equal(delta.records.length, 2);
    assert.deepEqual(Object.keys(delta.records[0].changed), ["panels"]);
    assert.deepEqual(ids(delta.records[0].changed.panels), ["panel-a1"]);
    assert.deepEqual(delta.records[1].removed.panels, ["panel-a2"]);
    assert.deepEqual(delta.records.reduce(applied, before), await peer.snapshot());
    // Nothing since the current revision.
    const idle = await peer.delta(store.state.revision);
    assert.deepEqual(idle.records, []);
  });
});

test("a delta from before the retained records is a snapshot", async () => {
  await served(async ({ connect, commit, store }) => {
    const peer = await connect("capable");
    const from = store.state.revision;
    for (const title of ["one", "two", "three", "four"]) commit({ type: "panel.update", panelId: "panel-a1", patch: { title } });
    const delta = parseWorkspaceRecordsDeltaDto(await peer.delta(from), { serverId: "wire-server", revision: from, cursor: String(from) });
    assert.equal(delta.records, undefined);
    assert.equal(delta.state.revision, store.state.revision);
    assert.equal(delta.state.panels["panel-a1"].title, "four");
    assert.deepEqual(delta.state, await peer.snapshot());
  }, { storeOptions: { maxHistory: 2 } });
});

test("a project-scoped connection's record names nothing outside its project", async () => {
  await served(async ({ connect, commit }) => {
    const peer = await connect("scoped");
    const before = await peer.snapshot();
    assert.deepEqual(ids(before.projects), ["project-a"]);
    const revision = commit({ type: "panel.update", panelId: "panel-b1", patch: { title: "secret" } });
    const record = parseWorkspaceChangeRecordDto((await peer.event(revision)).record);
    assert.deepEqual(record.changed, {});
    assert.deepEqual(record.removed, {});
    // Nor is it told what kind of command ran elsewhere.
    assert.equal("type" in record, false);
    assert.equal(JSON.stringify(record).includes("secret"), false);
    assert.deepEqual(applied(before, record), await peer.snapshot());
  }, { claims: { scoped: { projectId: "project-a" } } });
});

test("an object entering a scoped connection's project arrives in full, and one leaving is removed", async () => {
  await served(async ({ connect, commit }) => {
    const peer = await connect("scoped");
    let held = await peer.snapshot();
    assert.equal("panel-b1" in held.panels, false);

    const entered = commit({ type: "panel.move", panelId: "panel-b1", targetProjectId: "project-a" });
    const arrival = parseWorkspaceChangeRecordDto((await peer.event(entered)).record);
    assert.equal(arrival.changed.panels["panel-b1"].projectId, "project-a");
    assert.equal(arrival.changed.panels["panel-b1"].sessionId, "session-b1");
    assert.deepEqual(ids(arrival.changed.terminalSessions), ["session-b1"]);
    assert.deepEqual(ids(arrival.changed.projects), ["project-a"]);
    held = applied(held, arrival);
    assert.deepEqual(held, await peer.snapshot());

    const left = commit({ type: "panel.move", panelId: "panel-a1", targetProjectId: "project-b" });
    const departure = parseWorkspaceChangeRecordDto((await peer.event(left)).record);
    assert.deepEqual(departure.removed.panels, ["panel-a1"]);
    assert.deepEqual(departure.removed.terminalSessions, ["session-a1"]);
    // Where it went is not named.
    assert.equal(JSON.stringify(departure).includes("project-b"), false);
    held = applied(held, departure);
    assert.deepEqual(held, await peer.snapshot());

    // The same records come back from a delta, scoped the same way.
    const delta = parseWorkspaceRecordsDeltaDto(await peer.delta(entered - 1), { serverId: "wire-server", revision: entered - 1, cursor: String(entered - 1) });
    assert.deepEqual(delta.records, [arrival, departure]);
  }, { claims: { scoped: { projectId: "project-a" } } });
});

test("a connection that cannot see the automation space gets no record of it", async () => {
  await served(async ({ connect, composition, store }) => {
    const peer = await connect("no-automations");
    const before = await peer.snapshot();
    const spaceId = composition.workspaceOperations.ensureAutomationSpace("/tmp/space");
    const record = parseWorkspaceChangeRecordDto((await peer.event(store.state.revision)).record);
    assert.equal(JSON.stringify(record).includes(spaceId), false, JSON.stringify(record));
    assert.equal(record.changed.projects, undefined);
    assert.equal(record.changed.folders, undefined);
    assert.deepEqual(applied(before, record), await peer.snapshot());
  });
});

test("every scope converges on its own snapshot across a mixed run of commands", async () => {
  await served(async ({ connect, commit, store }) => {
    const all = await connect("all");
    const scoped = await connect("scoped");
    const start = store.state.revision;
    const held = { all: await all.snapshot(), scoped: await scoped.snapshot() };
    const view = store.state.viewOrder[0];
    const commands = [
      { type: "panel.update", panelId: "panel-a1", patch: { title: "api", emoji: "🧪" } },
      { type: "folder.create", projectId: "project-a", name: "Scratch" },
      { type: "panel.move", panelId: "panel-a2", targetProjectId: "project-b" },
      { type: "project.create", projectId: "project-c", viewId: view, root: "/tmp/c", name: "C" },
      { type: "panel.move", panelId: "panel-b1", targetProjectId: "project-a" },
      { type: "panel.close", panelId: "panel-a1" },
      { type: "project.close", projectId: "project-c" },
    ];
    for (const command of commands) commit(command);
    for (let revision = start + 1; revision <= store.state.revision; revision += 1) {
      held.all = applied(held.all, parseWorkspaceChangeRecordDto((await all.event(revision)).record));
      held.scoped = applied(held.scoped, parseWorkspaceChangeRecordDto((await scoped.event(revision)).record));
    }
    assert.deepEqual(held.all, await all.snapshot());
    assert.deepEqual(held.scoped, await scoped.snapshot());
    assert.deepEqual(ids(held.scoped.projects), ["project-a"]);
  }, { claims: { scoped: { projectId: "project-a" } } });
});
