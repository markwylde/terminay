import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionHolderPtyFactory,
  launchDetachedSessionHolder,
  readHolderRecords,
  TerminalService,
  TerminalServiceError,
} from "../dist/index.js";

/**
 * These tests run a real detached holder process with a real PTY. "Restarting
 * the server" is modelled exactly as it happens: one TerminalService and
 * factory let go, and a second pair is built from nothing but the data root.
 */

const ENTRY = fileURLToPath(new URL("./fixtures/session-holder-entry.mjs", import.meta.url));
const SERVER_ID = "srv";
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

/** Settles once a holder this file launched has exited. */
function holderExited(pid) {
  const holder = holders.get(pid);
  assert.ok(holder, `holder ${pid} was not launched by this test`);
  // The holder is unreferenced so it never keeps a test alive; waiting on it
  // does, until it exits.
  holder.child.ref();
  return holder.exited;
}

/**
 * A FIFO in the data root, which is every shell's working directory. A shell
 * that reads `go` waits for the test to write it; a `cat` of `hold` is a busy
 * foreground process, and the test's open of it for writing settles only once
 * that `cat` is running, so it is the shell saying "everything before me is
 * done".
 */
function fifo(dataRoot, name) {
  const path = join(dataRoot, name);
  assert.equal(spawnSync("mkfifo", [path]).status, 0, `mkfifo ${name}`);
  return path;
}

/** Open `hold` for writing: settles once the shell's `cat hold` is running. */
async function heldOpen(t, path) {
  const handle = await open(path, "w");
  t.after(() => handle.close());
  return handle;
}

function dataRootFor(t) {
  // realpath keeps the socket path short and stable on macOS, where the
  // temporary directory is reached through a symlink.
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(async () => {
    // Whatever a failed assertion left behind must not outlive the test.
    for (const record of readHolderRecords(dataRoot)) {
      try { process.kill(record.pid, "SIGKILL"); } catch { /* already gone */ }
      if (holders.has(record.pid)) await holderExited(record.pid);
    }
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return dataRoot;
}

function server(dataRoot, buildId = "build-a", options = {}) {
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId,
    limitMs: 60_000,
    launch: ({ env }) => launchHolder(ENTRY, env),
    ...options,
  });
  const service = new TerminalService({ serverId: SERVER_ID, ptyFactory: factory });
  return { factory, service };
}

/** What a server does when asked to end its terminals. */
async function endEverything({ service, factory }) {
  await service.shutdown();
  await factory.endAll();
}

/**
 * Collect a subscription's output as text. `seen(value)` settles once the
 * output includes it, and `exited` once the session's exit arrives.
 */
function watch(service, sessionId, fromPosition) {
  const state = { output: "", exits: [], firstPosition: undefined };
  const waiters = new Set();
  let reportExit;
  const exited = new Promise((resolve) => { reportExit = resolve; });
  const subscription = service.subscribe(sessionId, {
    ...(fromPosition === undefined ? {} : { fromPosition }),
    onEvent: (event) => {
      if (event.type === "output") {
        state.firstPosition ??= event.position;
        state.output += text(event.bytes);
        for (const waiter of [...waiters]) {
          if (!state.output.includes(waiter.value)) continue;
          waiters.delete(waiter);
          waiter.resolve();
        }
      } else if (event.type === "exit") {
        state.exits.push(event);
        reportExit(event);
      }
    },
  });
  const seen = (value) => state.output.includes(value)
    ? Promise.resolve()
    : new Promise((resolve) => waiters.add({ value, resolve }));
  return { state, subscription, seen, exited };
}

async function adoptAll(dataRoot, buildId, options) {
  const next = server(dataRoot, buildId, options);
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
  return { ...next, held };
}

const create = (service, sessionId, dataRoot) =>
  service.createSession({ projectId: "p1", sessionId, shellPath: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

test("a shell survives its server and is adopted with its output and position intact", async (t) => {
  const dataRoot = dataRootFor(t);
  const go = fifo(dataRoot, "go");
  const hold = fifo(dataRoot, "hold");
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const before = watch(first.service, "s1");
  const pid = first.service.getSession("s1").pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);

  await first.service.write("s1", bytesOf("echo marker-$((40+2))\n"));
  await before.seen("marker-42");
  const acknowledged = first.service.getSession("s1").outputPosition;

  // Work that outlives the server: once told to go, which is after the server
  // has gone, it prints and then keeps a foreground process running.
  await first.service.write("s1", bytesOf("echo armed-$((3+3)); read _ < go; echo while-$((1+1))-away; cat hold\n"));
  await before.seen("armed-6");

  await first.service.shutdown({ detach: true });
  await first.factory.detach();
  assert.equal(before.state.exits.length, 0, "detaching published an exit");
  assert.equal(isAlive(pid), true, "the shell died with its server");

  await writeFile(go, "go\n");
  await heldOpen(t, hold);

  const second = await adoptAll(dataRoot);
  t.after(() => endEverything(second));
  assert.deepEqual(second.held.map((session) => session.sessionId), ["s1"]);
  const adopted = second.service.getSession("s1");
  assert.equal(adopted.pid, pid);
  assert.equal(adopted.status, "running");
  assert.equal(readHolderRecords(dataRoot).length, 1, "a second holder was started");

  // A client that had acknowledged `acknowledged` receives exactly the rest.
  const after = watch(second.service, "s1", acknowledged);
  await after.seen("while-2-away");
  assert.equal(after.state.firstPosition, acknowledged);
  assert.equal(after.state.output.includes("marker-42"), false, "acknowledged output was replayed");

  // A fresh client still gets everything retained.
  const fresh = watch(second.service, "s1", adopted.replayFrom);
  await fresh.seen("while-2-away");
  assert.ok(fresh.state.output.includes("marker-42"));

  // Busy state resumes with no input from anyone: `cat` is in the foreground.
  const observation = await second.service.observeForegroundProcess("s1");
  assert.equal(observation.foregroundBusy, true);

  // And the same shell is still interactive.
  await second.service.write("s1", bytesOf("\x03"));
  await second.service.write("s1", bytesOf("echo back-$((2+3))\n"));
  await fresh.seen("back-5");
});

test("output beyond the bound while detached is dropped oldest-first and the command still completes", async (t) => {
  const dataRoot = dataRootFor(t);
  const go = fifo(dataRoot, "go");
  const hold = fifo(dataRoot, "hold");
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const before = watch(first.service, "s1");
  await first.service.write("s1", bytesOf("echo ready-$((1+2))\n"));
  await before.seen("ready-3");
  const acknowledged = first.service.getSession("s1").outputPosition;

  // 1.5 MiB against a 1 MiB ring, written only after the server has gone.
  await first.service.write("s1", bytesOf("echo armed-$((3+3)); read _ < go; head -c 1500000 /dev/zero | tr '\\0' x; echo; echo flood-$((3+4))-done; cat hold\n"));
  await before.seen("armed-6");
  await first.service.shutdown({ detach: true });
  await first.factory.detach();

  // The flood runs with no server attached, and has been printed once `cat`
  // after it is running: the holder has read all but what the PTY buffers.
  await writeFile(go, "go\n");
  await heldOpen(t, hold);
  const second = await adoptAll(dataRoot);
  t.after(() => endEverything(second));
  const adopted = second.service.getSession("s1");
  const tail = watch(second.service, "s1", adopted.replayFrom);
  await tail.seen("flood-7-done");

  const settled = second.service.getSession("s1");
  assert.ok(settled.outputPosition > 1_500_000, "the position did not count dropped bytes");
  assert.ok(settled.replayFrom > acknowledged, "nothing was dropped");
  assert.ok(settled.outputPosition - settled.replayFrom <= 1024 * 1024 + 64 * 1024);

  // The position a client last acknowledged has fallen out of the ring.
  assert.throws(
    () => second.service.subscribe("s1", { fromPosition: acknowledged }),
    (error) => error instanceof TerminalServiceError && error.code === "replay_gap",
  );
});

test("a server from another build drains the old holder and still drives its sessions", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot, "build-a");
  await create(first.service, "old", dataRoot);
  const oldPid = first.service.getSession("old").pid;
  const [oldHolder] = readHolderRecords(dataRoot);
  await first.service.shutdown({ detach: true });
  await first.factory.detach();

  const second = await adoptAll(dataRoot, "build-b");
  t.after(() => endEverything(second));
  assert.equal(second.service.getSession("old").pid, oldPid);

  // A new terminal goes to a holder of the new build; the old one is untouched.
  await create(second.service, "new", dataRoot);
  const holders = readHolderRecords(dataRoot);
  assert.equal(holders.length, 2);
  assert.deepEqual(holders.map((record) => record.buildId).sort(), ["build-a", "build-b"]);
  assert.equal(isAlive(oldPid), true);

  const output = watch(second.service, "old", second.service.getSession("old").replayFrom);
  await second.service.write("old", bytesOf("echo old-$((5+5))\n"));
  await output.seen("old-10");

  // The drained holder leaves once its last session is closed, and only after
  // that session's shell has ended.
  await second.factory.end("old");
  await holderExited(oldHolder.pid);
  assert.equal(isAlive(oldPid), false);
  assert.equal(second.service.getSession("new").status, "running");
});

test("end-all ends every shell and leaves no holder", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  await create(first.service, "s2", dataRoot);
  const pids = ["s1", "s2"].map((id) => first.service.getSession(id).pid);
  const [holder] = readHolderRecords(dataRoot);

  await endEverything(first);
  // A holder exits only once its shells have, and removes its record first.
  await holderExited(holder.pid);
  assert.deepEqual(pids.filter((pid) => isAlive(pid)), []);
  assert.deepEqual(readHolderRecords(dataRoot), []);
  assert.deepEqual(["s1", "s2"].map((id) => first.service.getSession(id).status), ["interrupted", "interrupted"]);
});

test("a holder that dies takes its sessions with it and the server records an abnormal exit", async (t) => {
  const dataRoot = dataRootFor(t);
  const first = server(dataRoot);
  await create(first.service, "s1", dataRoot);
  const seen = watch(first.service, "s1");
  const [holder] = readHolderRecords(dataRoot);

  process.kill(holder.pid, "SIGKILL");
  await seen.exited;
  assert.notEqual(seen.state.exits[0].exitCode, 0, "a lost session looked like a clean exit");
  assert.equal(first.service.getSession("s1").status, "exited");
  await first.factory.detach();
});
