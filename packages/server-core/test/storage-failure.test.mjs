import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, writeSync } from "node:fs";
import * as fs from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  CanonicalProjectPathResolver,
  FILE_OPERATIONS,
  NodeRecordingStorage,
  ServerFileAdapter,
  TerminalFileDrops,
  TerminalService,
  WORKSPACE_EVENT,
  WORKSPACE_OPERATIONS,
  WorkflowStore,
  WorkspaceRepository,
  createOperationDispatcher,
  createServerCoreComposition,
  createWorkflowOperationRegistry,
  WORKFLOW_OPERATIONS,
} from "../dist/index.js";
import { storageFailure } from "../dist/storageFailure.js";
import { toProtocolError as workflowProtocolError } from "../dist/workflowService/protocol.js";

/** An error shaped as Node's filesystem calls throw it. */
const systemError = (code, syscall = "write", extra = {}) =>
  Object.assign(new Error(`${code}: refused, ${syscall} '/secret/path'`), { code, errno: -1, syscall, ...extra });

const DATA_ROOT = "/srv/terminay/data";
const IN_ROOT = "The server does not have permission to access its data folder";
const ELSEWHERE = "The server does not have permission to access that file or folder";

test("each storage condition has its code, message, reason and retryability", () => {
  const cases = [
    ["ENOSPC", "unavailable", "The server's disk is full", "storage_full", true],
    ["EDQUOT", "resource", "The server's disk quota is exceeded", "storage_quota_exceeded", true],
    ["EROFS", "unavailable", "The server's storage is read-only", "storage_read_only", false],
    ["EACCES", "unavailable", ELSEWHERE, "storage_permission", false],
    ["EPERM", "unavailable", ELSEWHERE, "storage_permission", false],
  ];
  for (const [code, expected, message, reason, retryable] of cases)
    assert.deepEqual(storageFailure(systemError(code)), { code: expected, message, details: { reason }, retryable });
});

test("every step of a durable save is recognised", () => {
  for (const syscall of ["mkdir", "open", "write", "fsync", "fdatasync", "close", "read", "copyfile", "rename", "unlink", "rm"])
    assert.equal(storageFailure(systemError("ENOSPC", syscall))?.details.reason, "storage_full", syscall);
});

test("only a refused path inside the data root names the data folder", () => {
  const message = (extra) => storageFailure(systemError("EACCES", "open", extra), DATA_ROOT).message;
  assert.equal(message({ path: `${DATA_ROOT}/workspace.v3.json` }), IN_ROOT);
  assert.equal(message({ path: DATA_ROOT }), IN_ROOT);
  assert.equal(message({ path: "/tmp/x", dest: `${DATA_ROOT}/x` }), IN_ROOT);
  assert.equal(message({ path: `${DATA_ROOT}-other/file` }), ELSEWHERE);
  assert.equal(message({ path: `${DATA_ROOT}/../project/file` }), ELSEWHERE);
  assert.equal(message({ path: "/home/me/project/file" }), ELSEWHERE);
  assert.equal(message({}), ELSEWHERE);
});

test("refusals that are not filesystem storage failures are left alone", () => {
  for (const [code, syscall] of [["ENOSPC", "watch"], ["EPERM", "kill"], ["EACCES", "spawn /bin/sh"], ["EACCES", "listen"], ["ENOENT", "open"]])
    assert.equal(storageFailure(systemError(code, syscall)), undefined, `${code} ${syscall}`);
  for (const value of [undefined, null, "ENOSPC", { code: "ENOSPC" }, { code: "ENOSPC", syscall: "write" }, new Error("ENOSPC")])
    assert.equal(storageFailure(value), undefined);
});

test("the cause chain is searched, bounded and safe against cycles", () => {
  const wrapped = (depth) => {
    let error = systemError("ENOSPC");
    for (let i = 0; i < depth; i += 1) error = new Error("wrapper", { cause: error });
    return error;
  };
  assert.equal(storageFailure(wrapped(7))?.details.reason, "storage_full");
  assert.equal(storageFailure(wrapped(8)), undefined);
  const cycle = new Error("a");
  cycle.cause = new Error("b", { cause: cycle });
  assert.equal(storageFailure(cycle), undefined);
});

test("a real full device is recognised", { skip: !existsSync("/dev/full") }, () => {
  const fd = openSync("/dev/full", "w");
  try {
    assert.throws(() => writeSync(fd, "x"), (error) => storageFailure(error)?.details.reason === "storage_full");
  } finally {
    closeSync(fd);
  }
});

function request(type, operation, connectionId = operation) {
  const id = `${type}-1`;
  return {
    envelope: type === "query"
      ? { type, queryId: id, operation, payload: {} }
      : { type, commandId: id, correlationId: id, operation, payload: {} },
    body: new Uint8Array(),
    context: { connectionId, clientId: "client", authScope: "write", signal: new AbortController().signal },
  };
}

test("the dispatcher names storage failures for commands only and keeps paths private", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const failing = () => { throw new Error("wrapper", { cause: systemError("EACCES", "open", { path: `${DATA_ROOT}/secret.json` }) }); };
  const refusal = { code: "forbidden", message: "deliberate", retryable: false };
  const dispatcher = createOperationDispatcher({
    dataRoot: DATA_ROOT,
    commands: { write: failing, deliberate: () => { throw { ...refusal, cause: systemError("EACCES") }; }, admin: failing },
    queries: { read: failing },
    policies: { admin: { scope: "admin" } },
  });
  const result = await dispatcher.command(request("command", "write"));
  assert.deepEqual(result.error, { code: "unavailable", message: IN_ROOT, details: { reason: "storage_permission" }, retryable: false });
  assert.doesNotMatch(JSON.stringify(result), /secret|EACCES/);
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual((await dispatcher.command(request("command", "deliberate"))).error, refusal);
  assert.equal((await dispatcher.command(request("command", "admin"))).error.code, "forbidden");
  assert.deepEqual((await dispatcher.query(request("query", "read"))).envelope.error, { code: "internal", message: "query failed", retryable: false });
});

/** The reported path: a client creates a project while the workspace cannot be
 * saved. */
async function createProjectWhileSaveFails(fail, options = {}) {
  let failing = false;
  const repository = new WorkspaceRepository({
    async load() { return undefined; },
    async commit() {},
    commitSync() { if (failing) fail(); },
  }, "storage-server");
  await repository.load();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "storage-server",
    serverVersion: "test",
    capabilities: ["workspace"],
    ptyFactory: { spawn() { throw new Error("no terminals"); } },
    workspace: repository.workspace,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    ...options,
  });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "client", capabilities: ["workspace"] });
  await pair.open();
  await client.connect();
  try {
    const events = [];
    (await client.subscribe(WORKSPACE_EVENT)).onEvent((event) => events.push(event));
    const revision = repository.workspace.state.revision;
    const viewId = repository.workspace.state.viewOrder[0];
    failing = true;
    let error;
    await client.command(WORKSPACE_OPERATIONS.command, {
      command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/a", name: "a" },
    }).catch((caught) => { error = caught; });
    await client.query(WORKSPACE_OPERATIONS.snapshot, {});
    return { error, events, unchanged: repository.workspace.state.revision === revision };
  } finally {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
}

test("creating a project on a full disk reaches the client as sent and commits nothing", async (t) => {
  t.mock.method(console, "error", () => {});
  const { error, events, unchanged } = await createProjectWhileSaveFails(() => { throw systemError("ENOSPC"); });
  assert.equal(error.message, "The server's disk is full");
  assert.equal(error.code, "unavailable");
  assert.equal(error.retryable, true);
  assert.deepEqual(error.details, { reason: "storage_full" });
  assert.deepEqual(events, []);
  assert.equal(unchanged, true);
});

test("the composition hands its data root to the dispatcher", async (t) => {
  t.mock.method(console, "error", () => {});
  const { error } = await createProjectWhileSaveFails(
    () => { throw systemError("EACCES", "open", { path: `${DATA_ROOT}/workspace.v3.json` }); },
    { dataRoot: DATA_ROOT },
  );
  assert.equal(error.message, IN_ROOT);
});

test("a file save on a full disk fails the command and keeps the draft", async (t) => {
  t.mock.method(console, "error", () => {});
  const path = "/project/notes.txt";
  const original = new TextEncoder().encode("hello");
  const files = new Map([[path, original]]);
  let failure = () => systemError("ENOSPC");
  const storage = {
    realpath(value) {
      if (value === "/project" || files.has(value)) return value;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    stat: (value) => value === "/project" ? { isDirectory: true, size: 0 } : { isFile: true, size: files.get(value).byteLength, mode: 0o644, identity: "1" },
    readRange: (value, offset, length) => files.get(value).slice(offset, offset + length),
    readFile: (value) => files.get(value).slice(),
    atomicWrite: () => { throw failure(); },
  };
  const adapter = new ServerFileAdapter({
    serverId: "server-a",
    projects: { "project-a": { projectId: "project-a", resolver: new CanonicalProjectPathResolver("/project", storage), storage } },
  });
  const authorization = { serverId: "server-a", projectId: "project-a", scope: "write" };
  const opened = await adapter.open({ authorization, path: "notes.txt" });
  await adapter.edit({ authorization, sessionId: opened.sessionId, bytes: new TextEncoder().encode("changed"), expectedDraftRevision: 0 });
  const dispatcher = createOperationDispatcher(adapter.operations());
  const save = (id) => dispatcher.command({
    envelope: { type: "command", commandId: id, correlationId: id, operation: FILE_OPERATIONS.save, payload: { sessionId: opened.sessionId, expectedDiskRevision: 1, expectedDraftRevision: 1 } },
    body: new Uint8Array(),
    context: { connectionId: "c", clientId: "client", authScope: "write", claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  const before = await adapter.metadata({ authorization, sessionId: opened.sessionId });
  assert.equal((await save("save-1")).error.details.reason, "storage_full");
  const after = await adapter.metadata({ authorization, sessionId: opened.sessionId });
  assert.deepEqual(after, before);
  assert.equal(after.dirty, true);
  assert.equal(files.get(path), original);
  // Any other failed save stays a result.
  failure = () => new Error("something else");
  const other = await save("save-2");
  assert.equal(other.ok, true);
  assert.equal(other.result.error.code, "write_failed");
});

test("a workflow write the storage refused reaches the dispatcher unconverted", async (t) => {
  t.mock.method(console, "error", () => {});
  const directory = mkdtempSync(join(tmpdir(), "terminay-storage-workflow-"));
  let failure;
  const fileOps = {
    openSync: (...args) => fs.openSync(...args),
    writeSync: (fd, data) => { if (failure) throw failure; return fs.writeSync(fd, data); },
    fsyncSync: (fd) => fs.fsyncSync(fd),
    closeSync: (fd) => fs.closeSync(fd),
    renameSync: (from, to) => fs.renameSync(from, to),
    readFileSync: (path) => fs.readFileSync(path),
    rmSync: (path, options) => fs.rmSync(path, options),
    existsSync: (path) => fs.existsSync(path),
  };
  try {
    const store = new WorkflowStore({ directory, fileOps });
    const workflow = { id: "wf", name: "w", templateId: null, openingPrompt: "", steps: [{ id: "step-0", title: "t", prompt: "p", icon: null, after: [], status: "not_started", note: null, startedAt: null, endedAt: null }] };
    store.attach("s1", workflow);
    let published = 0;
    store.onChange(() => (published += 1));
    const attempt = () => {
      try { store.updateStep("s1", "step-0", "running"); } catch (error) { return error; }
      assert.fail("the write should fail");
    };
    failure = systemError("ENOSPC");
    const refused = attempt();
    // MCP reads the workflow error itself; the protocol mapping lets it through.
    assert.equal(refused.code, "write_failed");
    assert.equal(workflowProtocolError(refused), refused);
    assert.equal(storageFailure(refused).details.reason, "storage_full");
    assert.equal(refused.details, undefined);
    const registry = createWorkflowOperationRegistry({
      serverId: "server-a", store, templates: {},
      eventJournal: { append() { published += 1; } },
      sessionProject: () => "project-a", typeText() {},
    });
    t.after(() => registry.dispose());
    const dispatcher = createOperationDispatcher(registry.operations);
    const update = request("command", WORKFLOW_OPERATIONS.updateStep);
    update.envelope.payload = {
      target: { serverId: "server-a", projectId: "project-a", sessionId: "s1" },
      stepId: "step-0", status: "running",
    };
    const result = await dispatcher.command(update);
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, {
      code: "unavailable", message: "The server's disk is full",
      details: { reason: "storage_full" }, retryable: true,
    });
    assert.equal(store.get("s1").workflow.steps[0].status, "not_started");
    assert.equal(published, 0);
    failure = new Error("something else");
    assert.equal(workflowProtocolError(attempt()).code, "internal");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a dropped file the storage refused keeps its cause", async () => {
  const root = mkdtempSync(join(tmpdir(), "terminay-storage-drop-"));
  try {
    const drops = new TerminalFileDrops({ directory: join(root, "drops") });
    const owner = { clientId: "a", connectionId: "a" };
    const id = await drops.begin(owner, { serverId: "s", projectId: "p", sessionId: "t" }, [{ name: "a.txt", size: 2 }]);
    drops.uploads.get(id).writer.write = async () => { throw systemError("ENOSPC"); };
    await assert.rejects(
      () => drops.part(owner, id, 0, 0, Uint8Array.of(1, 2)),
      (error) => error.code === "upload_failed" && storageFailure(error)?.details.reason === "storage_full",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Desktop's embedded server supplies its data root", () => {
  const source = fs.readFileSync(new URL("../../../electron/serverTerminalAuthority.ts", import.meta.url), "utf8");
  assert.match(source, /createServerCoreComposition\(\{\s*\.\.\.\(options\.dataRoot === undefined \? \{\} : \{ dataRoot: options\.dataRoot \}\),/);
});

test("a recording delete the storage refused keeps its cause", {
  // Permissions do not refuse root, and Windows ignores the mode.
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "terminay-storage-recording-"));
  const directory = join(root, "recordings", "2026-01-01");
  try {
    const storage = new NodeRecordingStorage({ recordingRoot: join(root, "recordings"), homeDirectory: root });
    const entry = storage.createRecording({ recordingId: "recording-1", startedAt: "2026-01-01T00:00:00.000Z", recordingState: "complete" }, "{}");
    fs.chmodSync(directory, 0o500);
    assert.throws(
      () => storage.delete(entry),
      (error) => error.code === "storage_failed" && storageFailure(error)?.details.reason === "storage_permission",
    );
  } finally {
    fs.chmodSync(directory, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test("a terminal start the storage refused keeps its cause", async (t) => {
  t.mock.method(console, "error", () => {});
  const service = new TerminalService({
    serverId: "s",
    ptyFactory: { spawn() { throw systemError("ENOSPC", "open"); } },
  });
  await assert.rejects(
    () => service.createResolvedSession({
      identity: { serverId: "s", projectId: "p", sessionId: "t" },
      profile: { id: "shell", revision: 1, name: "Shell", targetSummary: "sh" },
      shellPath: "/bin/sh", args: [], cwd: "/tmp", env: {}, cols: 80, rows: 24,
      createdAt: 1, workspaceRevision: 1, settingsRevision: 1,
    }),
    (error) => error.code === "spawn_failed" && storageFailure(error)?.details.reason === "storage_full",
  );
});
