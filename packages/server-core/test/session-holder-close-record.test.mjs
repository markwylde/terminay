import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  encodeHolderFrame,
  HolderFrameDecoder,
  parseHolderCloseNotice,
  readHolderCloseRecords,
  readHolderRecords,
  SessionHolder,
  SessionHolderClient,
  sessionHolderCloseRecordPath,
  sessionHolderDirectory,
} from "../dist/index.js";

/**
 * A holder is detached and reports to nobody, so the reason it closed has to
 * be something it leaves behind: a notice to an attached server, and a record
 * in the data root for the case there is none.
 */

const GENERATION = "0123456789abcdef";

function fakePty() {
  const children = [];
  return {
    children,
    spawn() {
      const exit = new Set();
      const child = {
        pid: 9000 + children.length,
        process: "zsh",
        exited: false,
        onData() { return { dispose() {} }; },
        onExit(listener) { exit.add(listener); return { dispose: () => exit.delete(listener) }; },
        write() {},
        resize() {},
        kill() { this.emitExit({ exitCode: 0, signal: 1 }); },
        emitExit(event = { exitCode: 0 }) {
          if (this.exited) return;
          this.exited = true;
          for (const listener of [...exit]) listener(event);
        },
      };
      children.push(child);
      return child;
    },
  };
}

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(callback, delayMs) { const id = next++; pending.set(id, { callback, delayMs }); return id; },
    clearTimeout(id) { pending.delete(id); },
    fire(delayMs) {
      const due = [...pending].filter(([, timer]) => timer.delayMs === delayMs);
      for (const [id, timer] of due) { pending.delete(id); timer.callback(); }
      return due.length;
    },
  };
}

async function startHolder(t, overrides = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), "th-"));
  const pty = fakePty();
  const timers = manualTimers();
  const clock = { now: 1_000 };
  const holder = await SessionHolder.start({
    dataRoot,
    generation: GENERATION,
    buildId: "build-a",
    nodePty: pty,
    limitMs: 300_000,
    timers,
    now: () => clock.now,
    ...overrides,
  });
  t.after(async () => {
    await holder.close("signal");
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, pty, timers, clock, holder };
}

const recordOf = (holder) => ({ socketPath: holder.socketPath, credential: holder.credential });
const spawnRequest = (sessionId) => ({
  sessionId, projectId: "p1", shellPath: "/bin/zsh", args: ["-l"], cwd: "/tmp", cols: 80, rows: 24,
});
const settle = () => delay(50);
const onlyNotice = (dataRoot) => {
  const records = readHolderCloseRecords(dataRoot);
  assert.equal(records.length, 1);
  assert.equal(records[0].generation, GENERATION);
  return records[0].notice;
};

test("a limit expiry with nobody attached leaves a record that says so", async (t) => {
  const { dataRoot, holder, pty, timers, clock } = await startHolder(t);
  clock.now = 2_000;
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  await client.spawn(spawnRequest("s2"));
  pty.children[1].emitExit({ exitCode: 3 });
  client.setLimit(5_000);
  await settle();
  clock.now = 3_000;
  await client.close();
  await settle();

  clock.now = 8_000;
  assert.equal(timers.fire(5_000), 1);
  await holder.closed();

  assert.deepEqual(onlyNotice(dataRoot), {
    reason: "limit",
    pid: process.pid,
    startedAt: 1_000,
    closedAt: 8_000,
    liveSessions: 1,
    endedSessions: 1,
    attached: false,
    draining: false,
    limitMs: 5_000,
    attachCount: 1,
    lastAttachAt: 2_000,
    lastDetachAt: 3_000,
  });
  // A server looking for holders must never take the record for one.
  assert.deepEqual(readHolderRecords(dataRoot), []);
  assert.equal(statSync(sessionHolderCloseRecordPath(dataRoot, GENERATION)).mode & 0o777, 0o600);
});

test("an attached server is told the reason before the connection goes", async (t) => {
  const { dataRoot, holder } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  const first = await client.spawn(spawnRequest("s1"));
  await client.spawn(spawnRequest("s2"));
  const order = [];
  first.stream.onExit(() => order.push("exit"));
  client.onClosing((notice) => order.push(`closing:${notice.reason}:${notice.signal}`));
  client.onClose(() => order.push("closed"));

  await holder.close("signal", { signal: "SIGTERM" });
  await settle();

  assert.deepEqual(order, ["closing:signal:SIGTERM", "closed"]);
  assert.equal(client.closeNotice.liveSessions, 2);
  assert.equal(client.closeNotice.attached, true);
  // The record is written as well: the server may have died before reading.
  assert.equal(onlyNotice(dataRoot).signal, "SIGTERM");
});

test("end-all is announced and leaves no record behind", async (t) => {
  const { dataRoot, holder } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  const notices = [];
  client.onClosing((notice) => notices.push(notice));
  await client.endAll();
  await holder.closed();
  await settle();

  assert.equal(notices.length, 1);
  assert.equal(notices[0].reason, "end-all");
  assert.equal(notices[0].liveSessions, 1);
  assert.deepEqual(readHolderCloseRecords(dataRoot), []);
  assert.deepEqual(readdirSync(sessionHolderDirectory(dataRoot)), []);
});

test("a holder with nothing to hold and a holder nobody attached to each say which", async (t) => {
  const empty = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(empty.holder));
  await client.close();
  await empty.holder.closed();
  const emptied = onlyNotice(empty.dataRoot);
  assert.equal(emptied.reason, "empty");
  assert.equal(emptied.liveSessions, 0);
  assert.equal(emptied.attached, false);

  const unattended = await startHolder(t);
  unattended.timers.fire(60_000);
  await unattended.holder.closed();
  const abandoned = onlyNotice(unattended.dataRoot);
  assert.equal(abandoned.reason, "first-attach-timeout");
  assert.equal(abandoned.attachCount, 0);
  assert.equal(abandoned.lastAttachAt, null);
  assert.equal(abandoned.lastDetachAt, null);
});

test("an uncaught error is recorded without closing anything", async (t) => {
  const { dataRoot, holder } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));

  holder.recordCrash(new TypeError("ring index out of range"));

  const notice = onlyNotice(dataRoot);
  assert.equal(notice.reason, "crash");
  assert.match(notice.error, /TypeError: ring index out of range/);
  assert.equal(notice.liveSessions, 1);
  // Recording is not handling: the holder is still serving.
  assert.equal(existsSync(holder.socketPath), true);
  assert.equal((await client.list()).length, 1);
  await client.close();
});

test("the closing notice round-trips and anything else is not a notice", () => {
  const notice = {
    reason: "signal", signal: "SIGTERM", pid: 42, startedAt: 1, closedAt: 9, liveSessions: 3, endedSessions: 0,
    attached: true, draining: true, limitMs: null, attachCount: 2, lastAttachAt: 5, lastDetachAt: 4,
  };
  const [decoded] = new HolderFrameDecoder().push(encodeHolderFrame({ type: "closing", ...notice }));
  assert.equal(decoded.message.type, "closing");
  assert.deepEqual(parseHolderCloseNotice(decoded.message), notice);

  for (const broken of [
    null,
    "limit",
    { ...notice, reason: "bored" },
    { ...notice, pid: "42" },
    { ...notice, liveSessions: -1 },
    { ...notice, attached: "yes" },
    { ...notice, limitMs: undefined },
  ])
    assert.equal(parseHolderCloseNotice(broken), undefined);
  // Free text from a file is bounded, and unknown fields are not carried.
  const long = parseHolderCloseNotice({ ...notice, reason: "crash", error: "x".repeat(10_000), cwd: "/secret" });
  assert.equal(long.error.length, 4_000);
  assert.equal("cwd" in long, false);
});

test("a close record nobody can read is removed rather than kept", async (t) => {
  const { dataRoot } = await startHolder(t);
  const path = sessionHolderCloseRecordPath(dataRoot, "fedcba9876543210");
  writeFileSync(path, "{not json");
  assert.deepEqual(readHolderCloseRecords(dataRoot), []);
  assert.equal(existsSync(path), false);
});
