import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  createSessionHolderPtyFactory,
  launchDetachedSessionHolder,
  readHolderCloseRecords,
  readHolderRecords,
  readSessionTail,
  SessionHolderClient,
  sessionHolderDirectory,
  sessionHolderRecordPath,
  TerminalService,
  writeHolderCloseRecord,
} from "../dist/index.js";

/**
 * What a server reports about its session holders. These run a real detached
 * holder with a real PTY, because the reports that matter are about processes
 * ending: a holder signalled, a connection lost, a shell hung up.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const FUTURE_ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry-future.mjs", import.meta.url));
const SERVER_ID = "srv";

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

function dataRootFor(t) {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    await delay(50);
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

function server(dataRoot, buildId = "build-a", options = {}) {
  const reports = [];
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId,
    limitMs: 60_000,
    launch: ({ env }) => launchDetachedSessionHolder(process.execPath, [ENTRY], { ...process.env, ...env }),
    onObservation: (report) => reports.push(report),
    ...options,
  });
  const service = new TerminalService({ serverId: SERVER_ID, ptyFactory: factory });
  const of = (kind) => reports.filter((report) => report.kind === kind);
  return { factory, service, reports, of };
}

const create = (service, sessionId, dataRoot) =>
  service.createSession({ projectId: "p1", sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

const spawnOptions = (sessionId, dataRoot) =>
  ({ projectId: "p1", sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

async function leave({ service, factory }) {
  await service.shutdown({ detach: true });
  await factory.detach();
}

async function adoptLive(next) {
  const held = await next.factory.start();
  for (const session of held) {
    if (session.exit !== undefined) continue;
    const { process: pty, record, from } = await next.factory.adopt(session.sessionId);
    next.service.adoptSession({
      identity: { serverId: SERVER_ID, projectId: record.projectId, sessionId: record.sessionId },
      cwd: record.cwd,
      createdAt: record.createdAt,
      cols: record.cols,
      rows: record.rows,
      process: pty,
      outputPosition: from,
    });
  }
  return held;
}

/** Nothing a report carries may name a session, a path, or a credential. */
function assertMetadataOnly(reports, dataRoot, sessionIds) {
  const text = JSON.stringify(reports);
  for (const sessionId of sessionIds) assert.equal(text.includes(sessionId), false, `a report names ${sessionId}`);
  assert.equal(text.includes(dataRoot), false, "a report carries the data root");
  for (const record of readHolderRecords(dataRoot)) {
    assert.equal(text.includes(record.credential), false, "a report carries a credential");
    assert.equal(text.includes(record.generation), false, "a report carries a generation");
  }
}

test("a launch, a detach, and a same-build reattach are each reported", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "alpha-session", dataRoot);
  const [holder] = readHolderRecords(dataRoot);

  assert.equal(first.of("launched").length, 1);
  assert.deepEqual(first.of("launched")[0].holder, { pid: holder.pid, startedAt: holder.startedAt });
  assert.equal(first.of("launched")[0].limitMs, 60_000);
  assert.equal(typeof first.of("launched")[0].durationMs, "number");

  first.factory.setLimit(5_000);
  assert.deepEqual(first.of("limit-set"), [{ kind: "limit-set", limitMs: 5_000, holders: 1 }]);
  assertMetadataOnly(first.reports, dataRoot, ["alpha-session"]);

  await leave(first);
  assert.deepEqual(first.of("connection-closed"), [{
    kind: "connection-closed",
    holder: { pid: holder.pid, startedAt: holder.startedAt },
    requested: true,
    announced: false,
    liveSessions: 1,
  }]);
  assert.deepEqual(first.of("session-ended"), []);

  const second = server(dataRoot);
  t.after(async () => { await second.service.shutdown(); await second.factory.endAll(); });
  await adoptLive(second);
  assert.deepEqual(second.of("attached"), [{
    kind: "attached",
    holder: { pid: holder.pid, startedAt: holder.startedAt },
    buildId: "build-a",
    sameBuild: true,
    draining: false,
    liveSessions: 1,
    endedSessions: 0,
    limitMs: 60_000,
  }]);
  assert.deepEqual(second.of("drained"), []);
  assert.deepEqual(second.of("closed"), []);
});

test("a holder from another build is reported attached and then drained", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot, "build-a");
  await create(first.service, "s1", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  await leave(first);

  const second = server(dataRoot, "build-b");
  t.after(async () => { await second.service.shutdown(); await second.factory.endAll(); });
  await adoptLive(second);
  const identity = { pid: holder.pid, startedAt: holder.startedAt };
  assert.equal(second.of("attached")[0].sameBuild, false);
  assert.equal(second.of("attached")[0].buildId, "build-a");
  assert.equal(second.of("attached")[0].draining, false);
  assert.deepEqual(second.of("drained"), [{ kind: "drained", holder: identity, cause: "build-mismatch" }]);

  // A third server finds it already draining, and does not report draining it.
  await leave(second);
  const third = server(dataRoot, "build-c");
  t.after(async () => { await third.service.shutdown(); await third.factory.endAll(); });
  await adoptLive(third);
  assert.equal(third.of("attached")[0].draining, true);
  assert.deepEqual(third.of("drained"), []);
});

test("a record whose process is gone and a holder that cannot be spoken to are told apart", async (t) => {
  const dataRoot = dataRootFor(t);
  // A pid that is certainly not running: a child that has already been reaped.
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  mkdirSync(sessionHolderDirectory(dataRoot), { recursive: true, mode: 0o700 });
  writeFileSync(
    sessionHolderRecordPath(dataRoot, "aaaaaaaaaaaaaaaa"),
    JSON.stringify({ generation: "aaaaaaaaaaaaaaaa", pid: gone, buildId: "build-a", versions: [1], credential: "c", startedAt: 10 }),
  );
  launchDetachedSessionHolder(process.execPath, [FUTURE_ENTRY], { ...process.env, TEST_HOLDER_DATA_ROOT: dataRoot });
  const future = await until(
    () => readHolderRecords(dataRoot).find((record) => record.versions.includes(99)),
    "the future holder",
  );

  const next = server(dataRoot);
  await next.factory.start();
  assert.deepEqual(next.of("record-removed"), [{ kind: "record-removed", holder: { pid: gone, startedAt: 10 } }]);
  assert.deepEqual(next.of("incompatible"), [{
    kind: "incompatible",
    holder: { pid: future.pid, startedAt: future.startedAt },
    signal: "SIGTERM",
  }]);
  assert.deepEqual(next.of("attached"), []);
});

test("a holder already serving another server is reported unreachable and left alone", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  t.after(async () => { await first.service.shutdown(); await first.factory.endAll(); });

  const intruder = server(dataRoot);
  await intruder.factory.start();
  assert.deepEqual(intruder.of("unreachable"), [{
    kind: "unreachable",
    holder: { pid: holder.pid, startedAt: holder.startedAt },
    reason: "busy",
  }]);
  assert.equal(isAlive(holder.pid), true);
});

test("a launch that fails is reported with its error, and an observer that throws changes nothing", async (t) => {
  const dataRoot = dataRootFor(t);
  const broken = server(dataRoot, "build-a", { launch: () => { throw new Error("no such runtime"); } });
  await assert.rejects(broken.factory.spawn(spawnOptions("s1", dataRoot)));
  assert.equal(broken.of("launch-failed").length, 1);
  assert.equal(broken.of("launch-failed")[0].error, "no such runtime");

  const silent = server(dataRoot, "build-a", { launch: () => {}, launchTimeoutMs: 100 });
  await assert.rejects(silent.factory.spawn(spawnOptions("s2", dataRoot)));
  assert.equal(silent.of("launch-failed")[0].error, "session holder did not start");

  const hostile = server(dataRoot, "build-a", { onObservation: () => { throw new Error("observer failed"); } });
  t.after(async () => { await hostile.service.shutdown(); await hostile.factory.endAll(); });
  await create(hostile.service, "s3", dataRoot);
  assert.equal(hostile.service.getSession("s3").status, "running");
});

test("a holder signalled while attached says so, once, and its sessions are counted not listed", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  for (const id of ["s1", "s2", "s3"]) await create(first.service, id, dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  const identity = { pid: holder.pid, startedAt: holder.startedAt };

  process.kill(holder.pid, "SIGTERM");
  await until(() => first.of("connection-closed").length === 1, "the connection to close");

  const [closed] = first.of("closed");
  assert.equal(first.of("closed").length, 1);
  assert.deepEqual(closed.holder, identity);
  assert.equal(closed.late, false);
  assert.equal(closed.reason, "signal");
  assert.equal(closed.signal, "SIGTERM");
  assert.equal(closed.liveSessions, 3);
  assert.equal(closed.attached, true);
  assert.equal(closed.limitMs, 60_000);
  assert.equal(closed.sinceDetachMs, null);
  assert.equal(typeof closed.sinceAttachMs, "number");
  assert.deepEqual(first.of("connection-closed"), [{
    kind: "connection-closed", holder: identity, requested: false, announced: true, liveSessions: 3,
  }]);
  assert.deepEqual(first.of("session-ended"), []);
  assert.ok(first.reports.indexOf(closed) < first.reports.indexOf(first.of("connection-closed")[0]));
  assertMetadataOnly(first.reports, dataRoot, ["s1", "s2", "s3"]);

  // It was heard, so the next server does not report it again.
  assert.deepEqual(readHolderCloseRecords(dataRoot), []);
  const second = server(dataRoot);
  await second.factory.start();
  assert.deepEqual(second.of("closed"), []);
});

test("a connection lost without a word is an unrequested, unannounced close", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const [holder] = readHolderRecords(dataRoot);

  process.kill(holder.pid, "SIGKILL");
  await until(() => first.of("connection-closed").length === 1, "the connection to close");
  assert.deepEqual(first.of("connection-closed"), [{
    kind: "connection-closed",
    holder: { pid: holder.pid, startedAt: holder.startedAt },
    requested: false,
    announced: false,
    liveSessions: 1,
  }]);
  assert.deepEqual(first.of("closed"), []);
  assert.deepEqual(first.of("session-ended"), []);
});

test("a holder that closes with nobody attached is reported late by the next server, once", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  await leave(first);

  process.kill(holder.pid, "SIGTERM");
  await until(() => !isAlive(holder.pid), "the holder to exit");
  const [record] = readHolderCloseRecords(dataRoot);
  assert.equal(record.notice.reason, "signal");
  assert.equal(record.notice.signal, "SIGTERM");
  assert.equal(record.notice.attached, false);

  const second = server(dataRoot);
  await second.factory.start();
  const [closed] = second.of("closed");
  assert.equal(second.of("closed").length, 1);
  assert.deepEqual(closed.holder, { pid: holder.pid, startedAt: holder.startedAt });
  assert.equal(closed.late, true);
  assert.equal(closed.reason, "signal");
  assert.equal(closed.liveSessions, 1);
  assert.equal(closed.closedAt, record.notice.closedAt);
  assert.equal(typeof closed.sinceDetachMs, "number");

  const third = server(dataRoot);
  await third.factory.start();
  assert.deepEqual(third.of("closed"), []);
});

test("unheard closes are bounded, and the oldest are the ones dropped", async (t) => {
  const dataRoot = dataRootFor(t);
  mkdirSync(sessionHolderDirectory(dataRoot), { recursive: true, mode: 0o700 });
  for (let index = 0; index < 11; index += 1)
    writeHolderCloseRecord(dataRoot, `${index.toString(16)}`.padStart(16, "0"), {
      reason: "limit", pid: 100 + index, startedAt: 1, closedAt: 1_000 + index, liveSessions: 1, endedSessions: 0,
      attached: false, draining: false, limitMs: 300_000, attachCount: 1, lastAttachAt: 2, lastDetachAt: 3,
    });

  const next = server(dataRoot);
  await next.factory.start();
  assert.deepEqual(next.of("closed").map((report) => report.holder.pid), [103, 104, 105, 106, 107, 108, 109, 110]);
  assert.equal(next.of("closed").every((report) => report.late), true);
  assert.deepEqual(readHolderCloseRecords(dataRoot), []);
});

test("a session ending is reported with who asked for it", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  t.after(async () => { await first.service.shutdown(); await first.factory.endAll(); });
  await create(first.service, "asked", dataRoot);
  await create(first.service, "hung-up", dataRoot);
  await create(first.service, "signalled", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  const identity = { pid: holder.pid, startedAt: holder.startedAt };

  // The server ends one: a holder reports no exit for a session it is told to end.
  await first.factory.end("asked");
  assert.deepEqual(first.of("session-ended"), [{
    kind: "session-ended", holder: identity, session: 1, exitCode: null, signal: null, requested: true, endedUnattached: false,
  }]);

  // Something else hangs one up.
  process.kill(first.service.getSession("hung-up").pid, "SIGHUP");
  await until(() => first.of("session-ended").length === 2, "the hung-up session to be reported");
  const hungUp = first.of("session-ended")[1];
  assert.equal(hungUp.session, 2);
  assert.equal(hungUp.requested, false);
  assert.equal(hungUp.signal, 1);
  assert.equal(hungUp.endedUnattached, false);

  // The server signals one itself.
  await first.service.kill("signalled", undefined, "SIGKILL");
  await until(() => first.of("session-ended").length === 3, "the signalled session to be reported");
  assert.equal(first.of("session-ended")[2].requested, true);
  assert.equal(first.of("session-ended")[2].signal, 9);

  // Ending a session that was already reported says nothing more.
  await first.factory.end("hung-up");
  assert.equal(first.of("session-ended").length, 3);
  assertMetadataOnly(first.reports, dataRoot, ["asked", "hung-up", "signalled"]);
});

test("a session that ended with nobody watching is reported when it is adopted", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  await create(first.service, "s2", dataRoot);
  const pid = first.service.getSession("s1").pid;
  await leave(first);

  process.kill(pid, "SIGHUP");
  await until(() => readSessionTail(dataRoot, "s1")?.exit !== undefined, "the unattended exit to be saved");

  const second = server(dataRoot);
  t.after(async () => { await second.service.shutdown(); await second.factory.endAll(); });
  await second.factory.start();
  assert.equal(second.of("attached")[0].liveSessions, 1);
  assert.equal(second.of("attached")[0].endedSessions, 1);
  assert.deepEqual(second.of("session-ended"), []);

  const adopted = await second.factory.adopt("s1");
  const exits = [];
  adopted.process.onExit((exit) => exits.push(exit));
  await until(() => exits.length === 1, "the saved exit to be replayed");
  const ended = second.of("session-ended");
  assert.equal(ended.length, 1);
  assert.equal(ended[0].endedUnattached, true);
  assert.equal(ended[0].requested, false);
  assert.equal(ended[0].signal, 1);
});

test("a server that asks for everything to end is not surprised when it does", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  await create(first.service, "s2", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  await first.service.shutdown();
  await first.factory.endAll();
  await until(() => !isAlive(holder.pid), "the holder to exit");

  assert.equal(first.of("closed")[0].reason, "end-all");
  assert.equal(first.of("connection-closed")[0].requested, true);
  assert.equal(first.of("connection-closed")[0].announced, true);
  assert.deepEqual(readHolderCloseRecords(dataRoot), []);
});

test("a client that predates the closing notice ignores it", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const [holder] = readHolderRecords(dataRoot);
  await leave(first);

  // No listener for the notice at all: the connection simply closes.
  const plain = await SessionHolderClient.connect(holder);
  const closed = new Promise((resolve) => plain.onClose(resolve));
  process.kill(holder.pid, "SIGTERM");
  await closed;
  assert.equal(plain.closed, true);
});
