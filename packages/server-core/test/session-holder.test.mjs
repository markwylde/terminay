import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  encodeHolderFrame,
  HolderFrameDecoder,
  readSessionTail,
  SessionHolder,
  SessionHolderClient,
  SessionHolderRefusedError,
  sessionHolderDirectory,
  sessionHolderRecordPath,
  sessionTailPath,
  sessionTailsDirectory,
} from "../dist/index.js";

const GENERATION = "0123456789abcdef";
const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (value) => new TextEncoder().encode(value);

/** A node-pty double whose children emit only what a test tells them to. */
function fakePty() {
  const children = [];
  return {
    children,
    spawn(file, args, options) {
      const data = new Set();
      const exit = new Set();
      const child = {
        pid: 9000 + children.length,
        file,
        args,
        options,
        process: "zsh",
        writes: [],
        resizes: [],
        kills: [],
        pauses: 0,
        resumes: 0,
        exited: false,
        /** When set, a signal ends the child the way a real shell would. */
        diesOnSignal: true,
        onData(listener) { data.add(listener); return { dispose: () => data.delete(listener) }; },
        onExit(listener) { exit.add(listener); return { dispose: () => exit.delete(listener) }; },
        write(value) { this.writes.push(value); },
        resize(cols, rows) { this.resizes.push([cols, rows]); },
        kill(signal) {
          this.kills.push(signal);
          if (this.diesOnSignal || signal === "SIGKILL") this.emitExit({ exitCode: 0, signal: 1 });
        },
        pause() { this.pauses += 1; },
        resume() { this.resumes += 1; },
        emitData(value) { for (const listener of [...data]) listener(value); },
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

/** Timers a test fires by hand, so no test waits on a wall clock. */
function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout(callback, delayMs) { const id = next++; pending.set(id, { callback, delayMs }); return id; },
    clearTimeout(id) { pending.delete(id); },
    /** Fire every pending timer with exactly this delay. */
    fire(delayMs) {
      const due = [...pending].filter(([, timer]) => timer.delayMs === delayMs);
      for (const [id, timer] of due) { pending.delete(id); timer.callback(); }
      return due.length;
    },
    delays() { return [...pending.values()].map((timer) => timer.delayMs).sort((a, b) => a - b); },
  };
}

async function startHolder(t, overrides = {}) {
  const dataRoot = mkdtempSync(join(tmpdir(), "th-"));
  const pty = fakePty();
  const timers = manualTimers();
  const closedWith = [];
  const holder = await SessionHolder.start({
    dataRoot,
    generation: GENERATION,
    buildId: "build-a",
    nodePty: pty,
    limitMs: 300_000,
    killGraceMs: 2_000,
    firstAttachTimeoutMs: 60_000,
    timers,
    onClosed: (reason) => closedWith.push(reason),
    ...overrides,
  });
  t.after(async () => {
    await holder.close("signal");
    rmSync(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, pty, timers, holder, closedWith };
}

const recordOf = (holder) => ({ socketPath: holder.socketPath, credential: holder.credential });
const spawnRequest = (sessionId, extra = {}) => ({
  sessionId, projectId: "p1", shellPath: "/bin/zsh", args: ["-l"], cwd: "/tmp", env: { A: "1" }, cols: 80, rows: 24, ...extra,
});
/** Let queued socket writes and their handlers run. */
const settle = () => delay(50);

function collect(stream) {
  const chunks = [];
  const exits = [];
  stream.onData((position, bytes) => chunks.push({ position, text: text(bytes) }));
  stream.onExit((exit) => exits.push(exit));
  return { chunks, exits, text: () => chunks.map((chunk) => chunk.text).join("") };
}

test("the holder directory, socket, and credential file are owner-only", async (t) => {
  const { dataRoot, holder } = await startHolder(t);
  const mode = (path) => statSync(path).mode & 0o777;
  assert.equal(mode(sessionHolderDirectory(dataRoot)), 0o700);
  assert.equal(mode(holder.socketPath), 0o600);
  const recordPath = sessionHolderRecordPath(dataRoot, GENERATION);
  assert.equal(mode(recordPath), 0o600);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  assert.equal(record.credential, holder.credential);
  assert.equal(record.generation, GENERATION);
  assert.deepEqual(record.versions, [1]);
});

test("a peer without the credential is closed and learns nothing", async (t) => {
  const { holder, pty } = await startHolder(t);
  const first = await SessionHolderClient.connect(recordOf(holder));
  await first.spawn(spawnRequest("s1"));
  await first.close();
  await settle();

  await assert.rejects(
    SessionHolderClient.connect({ socketPath: holder.socketPath, credential: "wrong" }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "credential",
  );

  // Speaking the protocol without a hello first is no better.
  const received = [];
  await new Promise((resolve) => {
    const socket = connect(holder.socketPath);
    socket.on("data", (chunk) => received.push(chunk));
    socket.on("close", resolve);
    socket.on("connect", () => socket.write(encodeHolderFrame({ type: "list", id: 1 })));
  });
  assert.equal(Buffer.concat(received).byteLength, 0);
  assert.equal(holder.isAttached, false);
  assert.equal(pty.children[0].writes.length, 0);
});

test("a server with no common protocol version is told what the holder speaks", async (t) => {
  const { holder } = await startHolder(t);
  await assert.rejects(
    SessionHolderClient.connect(recordOf(holder), { versions: [99] }),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "version" && error.versions[0] === 1,
  );
});

test("a second server is refused while one is attached and the first is unaffected", async (t) => {
  const { holder } = await startHolder(t);
  const first = await SessionHolderClient.connect(recordOf(holder));
  await assert.rejects(
    SessionHolderClient.connect(recordOf(holder)),
    (error) => error instanceof SessionHolderRefusedError && error.reason === "busy",
  );
  assert.deepEqual(await first.list(), []);
  await first.close();
});

test("spawn, write, resize, signal, and exit reach the PTY and come back", async (t) => {
  const { holder, pty } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  const { record, stream } = await client.spawn(spawnRequest("s1"));
  const child = pty.children[0];
  assert.equal(record.pid, child.pid);
  assert.deepEqual([child.file, child.args, child.options.cwd, child.options.env], ["/bin/zsh", ["-l"], "/tmp", { A: "1" }]);
  const seen = collect(stream);

  child.emitData("hello ");
  child.emitData("world");
  client.write("s1", bytesOf("ls\n"));
  client.resize("s1", 120, 40);
  client.signal("s1", "SIGINT");
  // Wait for the round trip itself, not for a fixed time: the exit is the last
  // thing to come back, and a loaded machine can take longer than any guess.
  for (let attempt = 0; attempt < 200 && seen.exits.length === 0; attempt += 1) await delay(10);

  assert.equal(seen.text(), "hello world");
  assert.deepEqual(seen.chunks.map((chunk) => chunk.position), [0, 6]);
  assert.deepEqual(child.writes, ["ls\n"]);
  assert.deepEqual(child.resizes, [[120, 40]]);
  assert.deepEqual(child.kills, ["SIGINT"]);
  assert.equal(seen.exits.length, 1);

  const [listed] = await client.list();
  assert.deepEqual([listed.cols, listed.rows, listed.outputPosition, listed.exit.exitCode], [120, 40, 11, 0]);
  assert.equal(await client.foreground("s1").catch((error) => error.message), "session has ended");
  await client.close();
});

test("the ring is bounded and the position advances past dropped bytes", async (t) => {
  const { holder, pty } = await startHolder(t, { maxBufferBytes: 10 });
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  await client.close();
  await settle();

  const child = pty.children[0];
  child.emitData("aaaa");
  child.emitData("bbbb");
  child.emitData("cccc");
  child.emitData("dddd");

  const next = await SessionHolderClient.connect(recordOf(holder));
  const [listed] = await next.list();
  assert.equal(listed.outputPosition, 16);
  assert.equal(listed.bufferedFrom, 8);

  const { from, stream } = await next.attach("s1", 0);
  const seen = collect(stream);
  await settle();
  assert.equal(from, 8);
  assert.equal(seen.text(), "ccccdddd");
  assert.deepEqual(seen.chunks.map((chunk) => chunk.position), [8, 12]);

  // Live output continues from the same position space.
  child.emitData("e");
  await settle();
  assert.deepEqual(seen.chunks.at(-1), { position: 16, text: "e" });
  await next.close();
});

test("attaching from a position inside the ring delivers only the later bytes", async (t) => {
  const { holder, pty } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  pty.children[0].emitData("0123456789");
  await settle();
  await client.close();
  await settle();

  const next = await SessionHolderClient.connect(recordOf(holder));
  const { from, stream } = await next.attach("s1", 4);
  const seen = collect(stream);
  await settle();
  assert.equal(from, 4);
  assert.equal(seen.text(), "456789");
  await assert.rejects(next.attach("s1", 99), /ahead of output/);
  await next.close();
});

test("an unattached holder keeps reading and never leaves a PTY paused", async (t) => {
  const { holder, pty } = await startHolder(t, { maxBufferBytes: 64 });
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  client.pause("s1");
  await settle();
  const child = pty.children[0];
  assert.equal(child.pauses, 1);

  await client.close();
  await settle();
  // The server asked for backpressure and then went away: the shell must not
  // stay blocked on a full PTY for as long as nothing is attached.
  assert.equal(child.resumes, 1);

  for (let index = 0; index < 100; index += 1) child.emitData("0123456789");
  const next = await SessionHolderClient.connect(recordOf(holder));
  const [listed] = await next.list();
  assert.equal(listed.outputPosition, 1000);
  assert.ok(listed.outputPosition - listed.bufferedFrom <= 64);
  assert.equal(child.pauses, 1);
  await next.close();
});

test("the unattached limit is one timer: it ends sessions on expiry and is cancelled by an attach", async (t) => {
  const { dataRoot, holder, pty, timers, closedWith } = await startHolder(t);
  // Before any server attaches, only the first-attach timer is armed.
  assert.deepEqual(timers.delays(), [60_000]);

  const client = await SessionHolderClient.connect(recordOf(holder));
  assert.deepEqual(timers.delays(), []);
  await client.spawn(spawnRequest("s1"));
  pty.children[0].emitData("last words");
  client.setLimit(5_000);
  await settle();
  await client.close();
  await settle();
  assert.deepEqual(timers.delays(), [5_000]);

  // A server coming back in time cancels it.
  const back = await SessionHolderClient.connect(recordOf(holder));
  assert.deepEqual(timers.delays(), []);
  await back.close();
  await settle();
  assert.deepEqual(timers.delays(), [5_000]);

  assert.equal(timers.fire(5_000), 1);
  await holder.closed();
  assert.deepEqual(closedWith, ["limit"]);
  assert.deepEqual(pty.children[0].kills, ["SIGHUP"]);
  const tail = readSessionTail(dataRoot, "s1");
  assert.equal(text(tail.bytes), "last words");
  assert.equal(tail.exit, undefined);
  assert.equal(existsSync(holder.socketPath), false);
  assert.equal(existsSync(sessionHolderRecordPath(dataRoot, GENERATION)), false);
});

test("a limit of none arms no timer", async (t) => {
  const { holder, timers } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  client.setLimit(null);
  await settle();
  await client.close();
  await settle();
  assert.deepEqual(timers.delays(), []);
  assert.equal(holder.sessionCount, 1);
});

test("a process that ignores SIGHUP is killed after the grace period", async (t) => {
  const { holder, pty, timers } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  pty.children[0].diesOnSignal = false;
  client.setLimit(1_000);
  await settle();
  await client.close();
  await settle();
  timers.fire(1_000);
  await settle();
  assert.deepEqual(pty.children[0].kills, ["SIGHUP"]);
  timers.fire(2_000);
  await holder.closed();
  assert.deepEqual(pty.children[0].kills, ["SIGHUP", "SIGKILL"]);
});

test("a holder with no sessions exits when its server leaves", async (t) => {
  const { holder, closedWith } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.close();
  await holder.closed();
  assert.deepEqual(closedWith, ["empty"]);
});

test("a holder nobody attaches to gives up", async (t) => {
  const { holder, timers, closedWith } = await startHolder(t);
  timers.fire(60_000);
  await holder.closed();
  assert.deepEqual(closedWith, ["first-attach-timeout"]);
});

test("a draining holder refuses to spawn and exits after its last session", async (t) => {
  const { holder, pty, closedWith } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  client.drain();
  await assert.rejects(client.spawn(spawnRequest("s2")), /draining/);
  assert.equal(pty.children.length, 1);
  assert.equal(holder.isDraining, true);

  pty.children[0].emitExit({ exitCode: 3 });
  await holder.closed();
  assert.deepEqual(closedWith, ["empty"]);
});

test("a later server learns a holder is draining from its welcome", async (t) => {
  const { holder } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  client.drain();
  await settle();
  await client.close();
  await settle();
  const next = await SessionHolderClient.connect(recordOf(holder));
  assert.equal(next.draining, true);
  await next.close();
});

test("end stops one session and end-all leaves nothing behind", async (t) => {
  const { dataRoot, holder, pty, closedWith } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  await client.spawn(spawnRequest("s2"));
  await client.spawn(spawnRequest("s3"));

  await client.end("s1");
  await settle();
  assert.deepEqual(pty.children[0].kills, ["SIGHUP"]);
  assert.deepEqual((await client.list()).map((session) => session.sessionId), ["s2", "s3"]);

  pty.children[1].emitData("should not be saved");
  await client.endAll();
  await holder.closed();
  assert.deepEqual(closedWith, ["end-all"]);
  assert.deepEqual(pty.children.map((child) => child.exited), [true, true, true]);
  assert.equal(existsSync(holder.socketPath), false);
  assert.deepEqual(existsSync(sessionTailsDirectory(dataRoot)) ? readdirSync(sessionTailsDirectory(dataRoot)) : [], []);
});

test("a tail is written when a session exits unattached, and never while attached", async (t) => {
  const { dataRoot, holder, pty } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("attached"));
  await client.spawn(spawnRequest("alone"));
  pty.children[0].emitData("watched output");
  pty.children[1].emitData("unwatched ");
  // Exiting while the server is attached writes nothing: the server has it.
  pty.children[0].emitExit({ exitCode: 0 });
  await settle();
  assert.equal(existsSync(sessionTailsDirectory(dataRoot)), false);

  client.setLimit(null);
  await settle();
  await client.close();
  await settle();
  pty.children[1].emitData("output");
  pty.children[1].emitExit({ exitCode: 7 });
  await holder.closed();

  const alone = readSessionTail(dataRoot, "alone");
  assert.equal(text(alone.bytes), "unwatched output");
  assert.equal(alone.exit.exitCode, 7);
  assert.deepEqual([alone.bufferedFrom, alone.outputPosition], [0, 16]);
  assert.equal(statSync(sessionTailPath(dataRoot, "alone")).mode & 0o777, 0o600);
  assert.equal(statSync(sessionTailsDirectory(dataRoot)).mode & 0o777, 0o700);

  // The holder's orderly exit also saved the session that ended while watched,
  // so its panel still has output after the next restart.
  const attached = readSessionTail(dataRoot, "attached");
  assert.equal(text(attached.bytes), "watched output");
  assert.equal(attached.exit.exitCode, 0);
});

test("SIGTERM-style close saves a tail for every held session", async (t) => {
  const { dataRoot, holder, pty } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("s1"));
  await client.spawn(spawnRequest("s2"));
  pty.children[0].emitData("one");
  pty.children[1].emitData("two");
  await settle();
  await holder.close("signal");
  assert.equal(text(readSessionTail(dataRoot, "s1").bytes), "one");
  assert.equal(text(readSessionTail(dataRoot, "s2").bytes), "two");
});

test("ending a session deletes its saved tail", async (t) => {
  const { dataRoot, holder, pty } = await startHolder(t);
  const client = await SessionHolderClient.connect(recordOf(holder));
  await client.spawn(spawnRequest("keep"));
  await client.spawn(spawnRequest("gone"));
  client.setLimit(null);
  await settle();
  await client.close();
  await settle();
  pty.children[1].emitData("bye");
  pty.children[1].emitExit({ exitCode: 0 });
  await settle();
  assert.ok(readSessionTail(dataRoot, "gone"));

  const next = await SessionHolderClient.connect(recordOf(holder));
  await next.end("gone");
  assert.equal(readSessionTail(dataRoot, "gone"), undefined);
  await next.close();
});

test("a malformed frame from the attached server closes only that connection", async (t) => {
  const { holder, pty } = await startHolder(t);
  const frames = new HolderFrameDecoder();
  const messages = [];
  await new Promise((resolve) => {
    const socket = connect(holder.socketPath);
    socket.on("data", (chunk) => {
      for (const frame of frames.push(chunk)) {
        messages.push(frame.message);
        if (frame.message.type === "result") socket.write(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
      }
    });
    socket.on("close", resolve);
    socket.on("connect", () => {
      socket.write(encodeHolderFrame({ type: "hello", credential: holder.credential, versions: [1] }));
      socket.write(encodeHolderFrame({ type: "spawn", id: 1, ...spawnRequest("s1") }));
    });
  });
  assert.deepEqual(messages.map((message) => message.type), ["welcome", "result"]);
  assert.equal(pty.children[0].exited, false);
  assert.equal(holder.sessionCount, 1);
});

test("the holder uses no interval", () => {
  const source = readFileSync(new URL("../src/sessionHolder/holder.ts", import.meta.url), "utf8");
  assert.equal(/setInterval/.test(source), false);
});
