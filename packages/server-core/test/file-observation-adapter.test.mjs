import test from "node:test";
import assert from "node:assert/strict";
import {
  FILE_OBSERVATION_OPERATIONS,
  OrderedEventJournal,
  ServerFileObservationAdapter,
  createFileObservationEventProjector,
} from "../dist/index.js";

const context = (clientId = "client-a", projectId = "project-a") => ({
  connectionId: `connection-${clientId}`, clientId, authScope: "read",
  claims: { projectId }, signal: new AbortController().signal,
});
const command = (operation, payload, requestContext = context()) => ({
  envelope: { type: "command", commandId: `command-${operation}`, correlationId: `correlation-${operation}`, operation, payload },
  body: new Uint8Array(), context: requestContext,
});
const query = (operation, payload, requestContext = context()) => ({
  envelope: { type: "query", queryId: `query-${operation}`, operation, payload },
  body: new Uint8Array(), context: requestContext,
});

test("file observations are project scoped, ordered, idempotent, and cancelled with their client", async () => {
  const journal = new OrderedEventJournal();
  let watcher;
  const host = {
    watch(input) { watcher = input; },
    async calculateFolderSize() { return { bytes: 0, files: 0, directories: 0 }; },
  };
  const adapter = new ServerFileObservationAdapter({ serverId: "server-a", host, eventJournal: journal });
  const start = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.watchStart];
  const read = adapter.operations.queries[FILE_OBSERVATION_OPERATIONS.watchRead];
  const handle = await start(command(FILE_OBSERVATION_OPERATIONS.watchStart, { projectId: "project-a", resource: "" }));
  const duplicate = await start(command(FILE_OBSERVATION_OPERATIONS.watchStart, { projectId: "project-a", resource: "" }));
  assert.equal(duplicate.subscriptionId, handle.subscriptionId);
  assert.equal(watcher.resource, "");

  const stop = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.watchStop];
  await stop(command(FILE_OBSERVATION_OPERATIONS.watchStop, { subscriptionId: handle.subscriptionId }));
  assert.equal(watcher.signal.aborted, false);

  watcher.publish({ resource: "docs/readme.md", kind: "changed" });
  const batch = await read(query(FILE_OBSERVATION_OPERATIONS.watchRead, { subscriptionId: handle.subscriptionId }));
  assert.equal(batch.events[0].resource, "docs/readme.md");
  assert.equal(batch.events[0].sequence, 1);
  assert.deepEqual(journal.replay(0).events[0].payload, {
    subscriptionId: handle.subscriptionId, clientId: "client-a", projectId: "project-a",
    resource: "docs/readme.md", kind: "changed", sequence: 1,
  });

  assert.throws(() => start(command(FILE_OBSERVATION_OPERATIONS.watchStart, {
    projectId: "project-b", resource: "",
  })), /authenticated project/u);
  adapter.closeConnection("connection-client-a");
  assert.equal(watcher.signal.aborted, true);
  await assert.rejects(() => read(query(FILE_OBSERVATION_OPERATIONS.watchRead, {
    subscriptionId: handle.subscriptionId,
  })), /unavailable/u);
});

test("closing one connection keeps a watch its sibling connection still consumes", async () => {
  const journal = new OrderedEventJournal();
  let watcher;
  const host = {
    watch(input) { watcher = input; },
    async calculateFolderSize() { return { bytes: 0, files: 0, directories: 0 }; },
  };
  const adapter = new ServerFileObservationAdapter({ serverId: "server-a", host, eventJournal: journal });
  const start = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.watchStart];
  const read = adapter.operations.queries[FILE_OBSERVATION_OPERATIONS.watchRead];
  // One device, two live connections: the reconnect replacement and the
  // superseded original both consume the same deduplicated watch.
  const first = { ...context(), connectionId: "connection-first" };
  const second = { ...context(), connectionId: "connection-second" };
  const handle = await start(command(FILE_OBSERVATION_OPERATIONS.watchStart, { projectId: "project-a", resource: "" }, first));
  const shared = await start(command(FILE_OBSERVATION_OPERATIONS.watchStart, { projectId: "project-a", resource: "" }, second));
  assert.equal(shared.subscriptionId, handle.subscriptionId);

  adapter.closeConnection("connection-first");
  assert.equal(watcher.signal.aborted, false, "the surviving connection keeps the watch open");
  watcher.publish({ resource: "docs/readme.md", kind: "changed" });
  const batch = await read(query(FILE_OBSERVATION_OPERATIONS.watchRead, { subscriptionId: handle.subscriptionId }, second));
  assert.equal(batch.events[0].resource, "docs/readme.md");

  adapter.closeConnection("connection-second");
  assert.equal(watcher.signal.aborted, true, "the last consumer releases the watch");
});

test("folder-size progress is bounded and cancellation aborts host work", async () => {
  const journal = new OrderedEventJournal();
  let sizeInput;
  const host = {
    watch() {},
    calculateFolderSize(input) {
      sizeInput = input;
      input.progress({ bytes: 5, files: 1, directories: 0 });
      return new Promise((_resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
  };
  const adapter = new ServerFileObservationAdapter({ serverId: "server-a", host, eventJournal: journal, maxFolderSizeJobs: 1 });
  const start = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.folderSizeStart];
  const cancel = adapter.operations.commands[FILE_OBSERVATION_OPERATIONS.folderSizeCancel];
  const handle = await start(command(FILE_OBSERVATION_OPERATIONS.folderSizeStart, { projectId: "project-a", resource: "docs" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(journal.replay(0).events[0].payload, {
    jobId: handle.jobId, clientId: "client-a", projectId: "project-a", resource: "docs",
    phase: "progress", bytes: 5, files: 1, directories: 0,
  });
  assert.throws(() => start(command(FILE_OBSERVATION_OPERATIONS.folderSizeStart, {
    projectId: "project-a", resource: "other",
  })), /limit/u);
  await cancel(command(FILE_OBSERVATION_OPERATIONS.folderSizeCancel, { jobId: handle.jobId }));
  assert.equal(sizeInput.signal.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(journal.replay(0).events.at(-1).payload.phase, "cancelled");
});

test("file observation event projector isolates exact client and project", () => {
  const event = {
    revision: 1, cursor: "1", event: FILE_OBSERVATION_OPERATIONS.watchEvent,
    payload: { clientId: "client-a", projectId: "project-a" },
  };
  assert.equal(createFileObservationEventProjector(event, { clientId: "client-b", authScope: "read" }), undefined);
  assert.equal(createFileObservationEventProjector(event, { clientId: "client-a", authScope: "read", claims: { projectId: "project-b" } }), undefined);
  assert.equal(createFileObservationEventProjector(event, { clientId: "client-a", authScope: "read", claims: { projectId: "project-a" } }), event);
});
