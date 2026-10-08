import test from "node:test";
import assert from "node:assert/strict";
import {
  FILE_OBSERVATION_OPERATIONS,
  FileServiceError,
  FolderRootError,
  OrderedEventJournal,
  ServerFileObservationAdapter,
} from "../dist/index.js";

const context = (overrides = {}) => ({
  connectionId: "connection-a", clientId: "client-a", authScope: "read",
  claims: { projectId: "project-a" }, signal: new AbortController().signal, ...overrides,
});
const command = (operation, payload, requestContext = context()) => ({
  envelope: { type: "command", commandId: `command-${operation}`, correlationId: `correlation-${operation}`, operation, payload },
  body: new Uint8Array(), context: requestContext,
});
const query = (operation, payload, requestContext = context()) => ({
  envelope: { type: "query", queryId: `query-${operation}`, operation, payload },
  body: new Uint8Array(), context: requestContext,
});
/** A host that records what it was asked to observe. */
function host(size = { bytes: 0, files: 0, directories: 0 }) {
  const recorded = { watches: [], sizes: [] };
  return {
    ...recorded,
    watch(input) { recorded.watches.push(input); },
    async calculateFolderSize(input) { recorded.sizes.push(input); return size; },
  };
}
function scoped(options = {}) {
  const main = host({ bytes: 1, files: 1, directories: 1 });
  /** Stands in for the host observing a linked folder's worktree. */
  const linked = host({ bytes: 9, files: 9, directories: 9 });
  const resolved = [];
  const journal = new OrderedEventJournal();
  const adapter = new ServerFileObservationAdapter({
    serverId: "server-a", host: main, eventJournal: journal,
    folderScope: async (projectId, folderId) => { resolved.push([projectId, folderId]); return { projectId, host: linked }; },
    ...options,
  });
  const run = (operation, payload, requestContext) => adapter.operations.commands[operation](command(operation, payload, requestContext));
  return {
    adapter, journal, main, linked, resolved,
    start: (payload, requestContext) => run(FILE_OBSERVATION_OPERATIONS.watchStart, payload, requestContext),
    stop: (payload, requestContext) => run(FILE_OBSERVATION_OPERATIONS.watchStop, payload, requestContext),
    size: (payload, requestContext) => run(FILE_OBSERVATION_OPERATIONS.folderSizeStart, payload, requestContext),
    read: (subscriptionId) => adapter.operations.queries[FILE_OBSERVATION_OPERATIONS.watchRead](query(FILE_OBSERVATION_OPERATIONS.watchRead, { subscriptionId })),
  };
}
const inFolder = { projectId: "project-a", folderId: "folder:r3", resource: "src" };
const inProject = { projectId: "project-a", resource: "src" };

test("a watch naming a folder observes the folder's root and keeps its events apart from the project root's", async () => {
  const { journal, main, linked, resolved, start, stop, read } = scoped();
  const folderWatch = await start(inFolder);
  assert.equal(folderWatch.folderId, "folder:r3");
  assert.equal(linked.watches.length, 1);
  assert.equal(main.watches.length, 0);
  assert.equal(linked.watches[0].resource, "src");
  // Without a folder the same resource is still watched in the project root, as its own subscription.
  const projectWatch = await start(inProject);
  assert.equal("folderId" in projectWatch, false);
  assert.notEqual(projectWatch.subscriptionId, folderWatch.subscriptionId);
  assert.equal(main.watches.length, 1);
  assert.equal(linked.watches.length, 1);

  linked.watches[0].publish({ resource: "src/feature.ts", kind: "changed" });
  main.watches[0].publish({ resource: "src/main.ts", kind: "changed" });
  assert.deepEqual((await read(folderWatch.subscriptionId)).events.map((event) => [event.folderId, event.resource]), [["folder:r3", "src/feature.ts"]]);
  assert.deepEqual((await read(projectWatch.subscriptionId)).events.map((event) => [event.folderId, event.resource]), [[undefined, "src/main.ts"]]);
  assert.deepEqual(journal.replay(0).events.map((event) => event.payload), [
    { subscriptionId: folderWatch.subscriptionId, clientId: "client-a", projectId: "project-a", folderId: "folder:r3", resource: "src/feature.ts", kind: "changed", sequence: 1 },
    { subscriptionId: projectWatch.subscriptionId, clientId: "client-a", projectId: "project-a", resource: "src/main.ts", kind: "changed", sequence: 2 },
  ]);

  // A second start shares the watch; each start resolves the folder once.
  assert.equal((await start(inFolder)).subscriptionId, folderWatch.subscriptionId);
  assert.equal(linked.watches.length, 1);
  assert.deepEqual(resolved, [["project-a", "folder:r3"], ["project-a", "folder:r3"]]);

  // Reading and stopping name only the subscription, and release the folder's watch normally.
  await stop({ subscriptionId: folderWatch.subscriptionId });
  assert.equal(linked.watches[0].signal.aborted, false);
  await stop({ subscriptionId: folderWatch.subscriptionId });
  assert.equal(linked.watches[0].signal.aborted, true);
  assert.equal(main.watches[0].signal.aborted, false);
  assert.equal(resolved.length, 2);
});

test("a folder watch is released with its connection and with its project", async () => {
  const byConnection = scoped();
  await byConnection.start(inFolder);
  byConnection.adapter.closeConnection("connection-a");
  assert.equal(byConnection.linked.watches[0].signal.aborted, true);

  const byProject = scoped();
  const handle = await byProject.start(inFolder);
  byProject.adapter.closeProject("project-a");
  assert.equal(byProject.linked.watches[0].signal.aborted, true);
  await assert.rejects(() => byProject.read(handle.subscriptionId), /unavailable/u);
});

test("a folder-size job naming a folder measures the folder's root", async () => {
  const { journal, main, linked, resolved, size } = scoped();
  const job = await size(inFolder);
  assert.equal(job.folderId, "folder:r3");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(linked.sizes.length, 1);
  assert.equal(main.sizes.length, 0);
  assert.deepEqual(journal.replay(0).events.at(-1).payload, {
    jobId: job.jobId, clientId: "client-a", projectId: "project-a", folderId: "folder:r3", resource: "src",
    phase: "completed", bytes: 9, files: 9, directories: 9,
  });
  const projectJob = await size(inProject);
  assert.equal("folderId" in projectJob, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(main.sizes.length, 1);
  assert.equal(journal.replay(0).events.at(-1).payload.bytes, 1);
  assert.deepEqual(resolved, [["project-a", "folder:r3"]]);
});

test("a folder cannot widen the project scope or stand in for a failed resolution", async () => {
  const { main, linked, resolved, start, size } = scoped();
  // Another project's claim, too little scope, or a malformed folder id is refused before the folder is looked at.
  for (const begin of [start, size]) {
    assert.throws(() => begin({ ...inFolder, projectId: "project-b" }), /authenticated project/u);
    assert.throws(() => begin(inFolder, context({ authScope: "none" })), /requires read scope/u);
    for (const folderId of ["../etc", "", "x".repeat(129), 7])
      assert.throws(() => begin({ ...inFolder, folderId }), (error) => error instanceof FileServiceError && error.code === "invalid_path");
  }
  assert.equal(resolved.length, 0);

  const fails = async (options, code) => {
    const refused = scoped(options);
    for (const begin of [refused.start, refused.size])
      await assert.rejects(async () => begin(inFolder), (error) => error instanceof FileServiceError && error.code === code);
    // Nothing was observed anywhere: a refusal never falls back to the project root.
    assert.deepEqual([refused.main.watches.length, refused.main.sizes.length, refused.linked.watches.length, refused.linked.sizes.length], [0, 0, 0, 0]);
    await assert.rejects(() => refused.read("watch-1"), /unavailable/u);
  };
  await fails({ folderScope: undefined }, "path_escape");
  for (const [code, expected] of [["folder_not_found", "path_escape"], ["folder_outside_project", "path_escape"], ["folder_worktree_unregistered", "path_missing"], ["folder_root_unavailable", "path_missing"]])
    await fails({ folderScope: async () => { throw new FolderRootError(code, "resolution failed"); } }, expected);
  // A context for a different project is refused even if the resolver returns it.
  await fails({ folderScope: async () => ({ projectId: "project-b", host: linked }) }, "path_escape");
  await fails({ folderScope: async (projectId) => ({ projectId }) }, "path_escape");
  assert.equal(main.watches.length + linked.watches.length, 0);
});

test("a request cancelled while its folder resolves starts nothing", async () => {
  const controller = new AbortController();
  const { linked, start, size } = scoped({ folderScope: async (projectId) => { controller.abort(); return { projectId, host: host() }; } });
  await assert.rejects(async () => start(inFolder, context({ signal: controller.signal })), /cancelled/u);
  await assert.rejects(async () => size(inFolder, context({ signal: controller.signal })), /cancelled/u);
  assert.equal(linked.watches.length, 0);
});
