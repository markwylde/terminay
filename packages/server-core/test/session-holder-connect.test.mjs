import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSessionHolderPtyFactory,
  encodeHolderFrame,
  HolderFrameDecoder,
  SESSION_HOLDER_ENV,
  SessionHolderClient,
  sessionHolderDirectory,
  sessionHolderRecordPath,
  sessionHolderSocketPath,
} from "../dist/index.js";

/**
 * Speaking to a holder ends on events, never on a clock: the holder answering,
 * refusing, or its socket closing (which its process ending always does), the
 * holder process exiting, or the server leaving. A holder here is a socket the
 * test answers for, so the test decides when, and whether, each event happens.
 */

const GENERATION = "00112233445566aa";

function dataRootFor(t) {
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), "th-")));
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }));
  return dataRoot;
}

/** Whether a promise has settled, once every event already queued has run. */
async function settledYet(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

/**
 * A holder socket the test speaks for. `hello` settles with each greeting, and
 * the test answers it, or not, through the socket it is given.
 */
async function fakeHolder(t, dataRoot, generation = GENERATION) {
  mkdirSync(sessionHolderDirectory(dataRoot), { recursive: true, mode: 0o700 });
  const socketPath = sessionHolderSocketPath(dataRoot, generation);
  const sockets = new Set();
  const greetings = [];
  const waiting = [];
  const arrivals = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    for (const arrived of arrivals.splice(0)) arrived();
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    const frames = new HolderFrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of frames.push(chunk)) {
        if (frame.message.type !== "hello") continue;
        const greeting = { socket, message: frame.message };
        const next = waiting.shift();
        if (next === undefined) greetings.push(greeting);
        else next(greeting);
      }
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  const close = () => new Promise((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  });
  t.after(close);
  return {
    socketPath,
    hello: () => greetings.length > 0
      ? Promise.resolve(greetings.shift())
      : new Promise((resolve) => waiting.push(resolve)),
    /** Settles on the next connection, greeted or not. */
    connection: () => new Promise((resolve) => arrivals.push(resolve)),
    /** The holder ending: every connection and the listener close. */
    close,
  };
}

const welcome = (pid = process.pid) => encodeHolderFrame({
  type: "welcome", version: 1, generation: GENERATION, buildId: "build-a", pid, draining: false,
});

function writeRecord(dataRoot, pid, generation = GENERATION) {
  const target = sessionHolderRecordPath(dataRoot, generation);
  writeFileSync(`${target}.tmp`, JSON.stringify({
    generation, pid, buildId: "build-a", versions: [1], credential: "c", socketPath: "", startedAt: 1,
  }), { mode: 0o600 });
  renameSync(`${target}.tmp`, target);
}

/** A live process that is not a holder and ignores SIGTERM, for a record's pid. */
async function bystander(t) {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdin.resume(); process.stdout.write('up')"], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((resolve) => child.stdout.once("data", resolve));
  t.after(() => { child.kill("SIGKILL"); });
  return child;
}

function server(dataRoot, launch) {
  const reports = [];
  const factory = createSessionHolderPtyFactory({
    dataRoot,
    buildId: "build-a",
    limitMs: 60_000,
    launch: launch ?? (() => { throw new Error("this test launches no holder"); }),
    onObservation: (report) => reports.push(report),
  });
  return { factory, of: (kind) => reports.filter((report) => report.kind === kind) };
}

const spawnOptions = (dataRoot) =>
  ({ projectId: "p1", sessionId: "s1", shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: dataRoot, cols: 80, rows: 24 });

test("a holder slow to answer is waited for, however long it takes", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const connecting = SessionHolderClient.connect({ socketPath: holder.socketPath, credential: "c" });
  const { socket } = await holder.hello();
  assert.equal(await settledYet(connecting), false, "the connect gave up on a holder that had not answered");
  socket.write(welcome());
  const client = await connecting;
  assert.equal(client.generation, GENERATION);
  await client.close();
});

test("a holder that hangs up before answering ends the connect", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const connecting = SessionHolderClient.connect({ socketPath: holder.socketPath, credential: "c" });
  await holder.hello();
  await holder.close();
  await assert.rejects(connecting, { name: "SessionHolderRefusedError" });
});

test("a holder alive but silent is given up only when the caller aborts", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const abort = new AbortController();
  const connecting = SessionHolderClient.connect({ socketPath: holder.socketPath, credential: "c" }, { signal: abort.signal });
  await holder.hello();
  assert.equal(await settledYet(connecting), false);
  abort.abort(new Error("caller left"));
  await assert.rejects(connecting, { message: "caller left" });
});

test("a holder we launched that exits before it answers fails the launch on its exit", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const child = new EventEmitter();
  child.kill = () => {};
  const launch = ({ env }) => {
    // The record names the socket the test speaks for.
    const generation = env[SESSION_HOLDER_ENV.generation];
    writeRecord(dataRoot, process.pid, generation);
    renameSync(holder.socketPath, sessionHolderSocketPath(dataRoot, generation));
    return child;
  };
  const { factory, of } = server(dataRoot, launch);
  const spawning = factory.spawn(spawnOptions(dataRoot));
  await holder.hello();
  assert.equal(await settledYet(spawning), false);
  child.emit("exit", null, "SIGKILL");
  await assert.rejects(spawning, { message: "session holder exited before it answered" });
  assert.equal(of("launch-failed")[0].error, "session holder exited before it answered");
});

test("a silent holder found at start-up holds start-up only until the server leaves", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const alive = await bystander(t);
  writeRecord(dataRoot, alive.pid);
  const { factory, of } = server(dataRoot);
  const starting = factory.start();
  await holder.hello();
  assert.equal(await settledYet(starting), false, "start-up gave up on a live holder");
  await factory.detach();
  assert.deepEqual(await starting, []);
  assert.deepEqual(of("unreachable").map((report) => report.reason), ["the server is leaving"]);
});

test("an incompatible holder asked to go is waited for until it has gone", async (t) => {
  const dataRoot = dataRootFor(t);
  const holder = await fakeHolder(t, dataRoot);
  const alive = await bystander(t);
  writeRecord(dataRoot, alive.pid);
  const { factory, of } = server(dataRoot);
  const starting = factory.start();
  // It refuses this server's protocol; the server signals it to save its
  // tails and go, and must not read them before it has.
  const { socket } = await holder.hello();
  // The server stays connected to hear it go, without greeting it.
  const listening = holder.connection();
  socket.write(encodeHolderFrame({ type: "refuse", reason: "version", versions: [99] }));
  socket.end();
  await Promise.race([
    listening,
    starting.then(() => { throw new Error("start-up went on before the holder had gone"); }),
  ]);
  assert.equal(await settledYet(starting), false, "start-up went on before the holder had gone");
  assert.equal(of("incompatible").length, 1);
  // Saving tails and leaving: everything it had open closes.
  await holder.close();
  assert.deepEqual(await starting, []);
  assert.deepEqual(factory.incompatibleGenerations(), [GENERATION]);
});
