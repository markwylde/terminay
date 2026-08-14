import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_OPERATIONS,
  OrderedEventJournal,
  TerminalActivityService,
  createActivityEventProjector,
  createActivityOperationRegistry,
} from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-a", projectId: "project-a", sessionId: "session-a" });
const context = Object.freeze({ connectionId: "connection-a", clientId: "client-a", authScope: "admin", signal: new AbortController().signal });
const query = (operation, payload) => ({ envelope: { operation, payload }, body: new Uint8Array(), context });
const command = (operation, payload, claims) => ({ envelope: { operation, commandId: "command-a", correlationId: "correlation-a", payload }, body: new Uint8Array(), context: claims === undefined ? context : { ...context, claims } });

test("activity protocol publishes canonical snapshots, deltas, and ordered activity events", async () => {
  const service = new TerminalActivityService({ serverId: identity.serverId });
  const journal = new OrderedEventJournal();
  const registry = createActivityOperationRegistry({ service, eventJournal: journal });
  service.register(identity);
  service.ingestSignal(identity, { kind: "bell" });

  const snapshot = await registry.operations.queries[ACTIVITY_OPERATIONS.snapshot](query(ACTIVITY_OPERATIONS.snapshot, {}));
  assert.equal(snapshot.sessions[identity.sessionId].attention, true);
  const delta = registry.operations.queries[ACTIVITY_OPERATIONS.delta](query(ACTIVITY_OPERATIONS.delta, { revision: 0, cursor: "0" }));
  assert.equal(delta.kind, "events");
  assert.equal(delta.events.at(-1).type, "activity.changed");
  assert.equal(journal.replay(0).events.at(-1).event, ACTIVITY_OPERATIONS.event);
  registry.close();
});

test("activity acknowledgement is bound to the exact server project and session", () => {
  const service = new TerminalActivityService({ serverId: identity.serverId });
  const registry = createActivityOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  service.register(identity);
  service.ingestSignal(identity, { kind: "bell" });

  const acknowledged = registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](command(ACTIVITY_OPERATIONS.acknowledge, { projectId: identity.projectId, sessionId: identity.sessionId }));
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(service.get(identity).acknowledged, true);
  assert.throws(
    () => registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](command(ACTIVITY_OPERATIONS.acknowledge, { projectId: "project-b", sessionId: identity.sessionId })),
    /activity identity belongs to another project/,
  );
  assert.throws(
    () => registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](command(ACTIVITY_OPERATIONS.acknowledge, { projectId: identity.projectId, sessionId: identity.sessionId }, { projectId: "project-b" })),
    (error) => error?.code === "forbidden" && error?.message.includes("authenticated project scope"),
  );
  registry.close();
});

test("a delayed viewed acknowledgement cannot erase newer completion activity", () => {
  let now = 100;
  const service = new TerminalActivityService({ serverId: identity.serverId, now: () => now });
  const registry = createActivityOperationRegistry({ service, eventJournal: new OrderedEventJournal() });
  service.register(identity);
  const viewedUpdatedAt = service.get(identity).updatedAt;
  now = 200;
  service.ingestSignal(identity, { kind: "command", phase: "executing" });
  now = 201;
  service.ingestSignal(identity, { kind: "command", phase: "finished", exitCode: 0 });

  const delayed = registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](command(
    ACTIVITY_OPERATIONS.acknowledge,
    { projectId: identity.projectId, sessionId: identity.sessionId, expectedUpdatedAt: viewedUpdatedAt },
  ));
  assert.equal(delayed.acknowledged, false);
  assert.equal(service.get(identity).status, "idle");
  assert.equal(service.get(identity).acknowledged, false);
  registry.close();
});

test("racing activity acknowledgements from separate clients publish exactly one state transition", () => {
  let now = 100;
  const service = new TerminalActivityService({ serverId: identity.serverId, now: () => now });
  const journal = new OrderedEventJournal();
  const registry = createActivityOperationRegistry({ service, eventJournal: journal });
  const clientA = { ...context, connectionId: "connection-a", clientId: "client-a" };
  const clientB = { ...context, connectionId: "connection-b", clientId: "client-b" };
  const request = (client, commandId) => ({
    envelope: {
      operation: ACTIVITY_OPERATIONS.acknowledge,
      commandId,
      correlationId: commandId,
      payload: { projectId: identity.projectId, sessionId: identity.sessionId },
    },
    body: new Uint8Array(),
    context: client,
  });
  try {
    service.register(identity);
    service.ingestSignal(identity, { kind: "bell" });
    const before = service.revision;

    const first = registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](request(clientA, "ack-a"));
    now = 101;
    const duplicate = registry.operations.commands[ACTIVITY_OPERATIONS.acknowledge](request(clientB, "ack-b"));

    assert.equal(first.acknowledged, true);
    assert.equal(duplicate.acknowledged, false);
    assert.equal(service.revision, before + 1);
    assert.equal(journal.replay(0).events.filter((event) => event.event === ACTIVITY_OPERATIONS.event).length, 2);
  } finally {
    registry.close();
  }
});

test("project claims receive only their activity snapshot, replay, and live events", async () => {
  const service = new TerminalActivityService({ serverId: identity.serverId });
  const journal = new OrderedEventJournal();
  const registry = createActivityOperationRegistry({ service, eventJournal: journal });
  const projectA = identity;
  const projectB = { ...identity, projectId: "project-b", sessionId: "session-b" };
  const scopedContext = { ...context, claims: { projectId: "project-a" } };
  try {
    service.register(projectA);
    service.register(projectB);
    service.ingestSignal(projectA, { kind: "bell" });
    service.ingestSignal(projectB, { kind: "bell" });

    const scopedSnapshot = await registry.operations.queries[ACTIVITY_OPERATIONS.snapshot]({
      envelope: { operation: ACTIVITY_OPERATIONS.snapshot, payload: {} }, body: new Uint8Array(), context: scopedContext,
    });
    assert.deepEqual(Object.keys(scopedSnapshot.sessions), ["session-a"]);

    const scopedDelta = registry.operations.queries[ACTIVITY_OPERATIONS.delta]({
      envelope: { operation: ACTIVITY_OPERATIONS.delta, payload: { revision: 0, cursor: "0" } }, body: new Uint8Array(), context: scopedContext,
    });
    assert.equal(scopedDelta.kind, "events");
    assert.ok(scopedDelta.events.length > 0);
    assert.ok(scopedDelta.events.every((event) => event.sessionId === "session-a"));

    const projector = createActivityEventProjector(service);
    const projectBEvent = journal.replay(0).events.at(-1);
    assert.equal(projector(projectBEvent, { clientId: "client-a", authScope: "read", claims: { projectId: "project-a" } }), undefined);
    const projectAEvent = journal.replay(0).events.find((event) => event.payload.sessionId === "session-a");
    assert.ok(projector(projectAEvent, { clientId: "client-a", authScope: "read", claims: { projectId: "project-a" } }));

    service.markExited(projectA);
    const removal = journal.replay(0).events.at(-1);
    assert.ok(projector(removal, { clientId: "client-a", authScope: "read", claims: { projectId: "project-a" } }));
  } finally {
    registry.close();
  }
});

test("activity snapshot waits for the host foreground observation fence", async () => {
  const service = new TerminalActivityService({ serverId: identity.serverId });
  let release;
  const observed = new Promise((resolve) => { release = resolve; });
  const registry = createActivityOperationRegistry({
    service,
    eventJournal: new OrderedEventJournal(),
    beforeSnapshot: async () => {
      await observed;
      service.ingestSignal(identity, { kind: "foreground", busy: true, processName: "sleep" });
    },
  });
  service.register(identity);

  const pending = registry.operations.queries[ACTIVITY_OPERATIONS.snapshot](query(ACTIVITY_OPERATIONS.snapshot, {}));
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release();

  const snapshot = await pending;
  assert.equal(snapshot.sessions[identity.sessionId].foregroundBusy, true);
  registry.close();
});
