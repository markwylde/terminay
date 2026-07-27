import test from "node:test";
import assert from "node:assert/strict";
import {
  createNodePtyFactory,
  TerminalService,
  TerminalServiceAdapter,
  TerminalServiceError,
} from "../dist/index.js";
import * as nodePty from "node-pty";

/**
 * A deliberately tiny PTY double.  It keeps the process callbacks explicit so
 * each test can model output and exit independently of the service.
 */
function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 7000 + processes.length,
        options,
        writes: [],
        resizes: [],
        kills: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill(signal) { this.kills.push(signal); },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(exit = {}) {
          for (const listener of exitListeners) listener(exit);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

function identity(sessionId = "session-a", projectId = "project-a") {
  return { serverId: "server-a", projectId, sessionId };
}

function writeAuthorization(projectId = "project-a", sessionId = "session-a") {
  return { serverId: "server-a", projectId, sessionId, scope: "write" };
}

function waitFor(predicate, timeoutMs = 4_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("timed out waiting for terminal state"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

function outputText(events) {
  return events
    .filter((event) => event.type === "output")
    .map((event) => new TextDecoder().decode(event.bytes));
}

test("TerminalService owns PTY lifecycle and enforces exact server/project/session authorization", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    now: () => 100,
    generateSessionId: () => "session-a",
  });
  const handle = await service.createSession({ projectId: "project-a", cols: 80, rows: 24, cwd: "/tmp" });
  const process = pty.processes[0];

  assert.equal(handle.status, "running");
  assert.deepEqual(handle.snapshot(), {
    serverId: "server-a",
    projectId: "project-a",
    sessionId: "session-a",
    status: "running",
    createdAt: 100,
    outputPosition: 0,
    replayFrom: 0,
    pid: 7000,
    dimensions: { cols: 80, rows: 24 },
  });
  assert.equal(process.options.shellPath, "sh");

  const read = { serverId: "server-a", projectId: "project-a", sessionId: "session-a", scope: "read" };
  const write = writeAuthorization();
  const subscription = service.subscribe(handle.identity, { authorization: read });
  assert.equal(subscription.sessionId, "session-a");

  await assert.rejects(
    () => service.input(handle.identity, "denied", read),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
  await assert.rejects(
    () => service.input(handle.identity, "denied", writeAuthorization("project-other")),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
  assert.throws(
    () => service.subscribe({ ...identity(), projectId: "project-other" }, { authorization: read }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );

  await service.input(handle.identity, "accepted", write);
  assert.deepEqual([...process.writes[0]], [...new TextEncoder().encode("accepted")]);

  process.emitExit({ exitCode: 0, signal: null });
  assert.equal(handle.status, "exited");
  assert.deepEqual(handle.exit, { exitCode: 0, signal: null, reason: "exit", at: 100 });
  const events = subscription.drain();
  assert.equal(events.at(-1).type, "exit");
  await assert.rejects(
    () => handle.input("after-exit", write),
    (error) => error instanceof TerminalServiceError && error.code === "session_exited",
  );
  // A late adapter callback cannot publish a second exit or revive the PTY.
  process.emitExit({ exitCode: 9, signal: 9 });
  assert.equal(subscription.drain().length, 0);
});

test("server PTY adapter has no window owner and detach/resume reuses one process", async () => {
  const dataListeners = new Set();
  const exitListeners = new Set();
  const spawned = [];
  const child = {
    pid: 9001,
    writes: [],
    resizes: [],
    kills: [],
    write(value) { this.writes.push(value); },
    resize(cols, rows) { this.resizes.push({ cols, rows }); },
    kill(signal) { this.kills.push(signal); },
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return { dispose: () => exitListeners.delete(listener) };
    },
    emitData(value) { for (const listener of dataListeners) listener(value); },
    emitExit(event = { exitCode: 0, signal: 0 }) { for (const listener of exitListeners) listener(event); },
  };
  const ptyFactory = createNodePtyFactory({
    spawn(file, args, options) {
      spawned.push({ file, args, options });
      return child;
    },
  });
  const service = new TerminalService({ serverId: "server-a", ptyFactory });
  const handle = await service.createSession({
    projectId: "project-a",
    shellPath: "/bin/sh",
    args: ["-l"],
    cwd: "/tmp/project",
    env: { TERM: "xterm", OMIT: undefined },
    cols: 80,
    rows: 24,
  });
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0], {
    file: "/bin/sh",
    args: ["-l"],
    options: { name: undefined, cols: 80, rows: 24, cwd: "/tmp/project", env: { TERM: "xterm" } },
  });

  const first = handle.attach({ fromPosition: 0 });
  child.emitData("one");
  assert.deepEqual(first.drain().filter((event) => event.type === "output").map((event) => new TextDecoder().decode(event.bytes)), ["one"]);
  first.close();

  // No client/window is passed to the PTY factory. Output continues while the
  // first subscription is detached and is replayed by a later subscriber.
  child.emitData("two");
  const resumed = handle.attach({ fromPosition: 3 });
  const replay = resumed.drain().filter((event) => event.type === "output");
  assert.deepEqual(replay.map((event) => [event.position, event.nextPosition, new TextDecoder().decode(event.bytes), event.replay]), [[3, 6, "two", true]]);
  assert.equal(spawned.length, 1);

  await handle.input(new Uint8Array([0x68, 0x69]));
  await handle.resize({ cols: 100, rows: 30 });
  assert.deepEqual(child.writes, ["hi"]);
  assert.deepEqual(child.resizes, [{ cols: 100, rows: 30 }]);
});

test("TerminalService splits output into bounded chunks, retains bounded replay, and closes slow pull subscribers", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    maxOutputChunkBytes: 3,
    maxReplayBytes: 5,
    maxQueuedOutputBytes: 4,
    generateSessionId: () => "session-a",
  });
  const handle = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const process = pty.processes[0];

  process.emitData("abcdef");
  process.emitData("ghij");
  assert.equal(handle.outputPosition, 10);
  assert.equal(handle.snapshot().replayFrom, 6);

  assert.throws(
    () => service.subscribe(handle.identity, { fromPosition: 0 }),
    (error) => error instanceof TerminalServiceError
      && error.code === "replay_gap"
      && error.details?.replayFrom === 6,
  );
  const replay = service.subscribe(handle.identity, { fromPosition: 6 });
  assert.deepEqual(replay.drain().filter((event) => event.type === "output").map((event) => [event.position, event.nextPosition, new TextDecoder().decode(event.bytes), event.replay]), [
    [6, 9, "ghi", true],
    [9, 10, "j", true],
  ]);

  const slow = service.subscribe(handle.identity, { fromPosition: 10, maxQueuedBytes: 4 });
  process.emitData("abc");
  assert.equal(slow.queuedBytes, 3);
  process.emitData("de");
  assert.equal(slow.closed, true);
  assert.equal(slow.closeReason, "resync_required");
  assert.deepEqual(slow.drain().map((event) => event.type), ["resync_required"]);
});

test("interrupt publishes one terminal event and shutdown marks remaining sessions interrupted", async () => {
  const pty = createPtyFactory();
  let now = 500;
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, now: () => now, generateSessionId: (project) => `${project}-session` });
  const first = await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const second = await service.createSession({ projectId: "project-b", cols: 80, rows: 24 });
  const firstSubscription = first.subscribe();
  const secondSubscription = second.subscribe();

  now = 501;
  await service.interrupt(first.identity, writeAuthorization("project-a", "project-a-session"), 501);
  assert.equal(first.status, "interrupted");
  assert.deepEqual(first.exit, { exitCode: 130, signal: 15, reason: "interrupted", at: 501 });
  assert.equal(pty.processes[0].kills[0], "SIGTERM");
  assert.equal(firstSubscription.drain().filter((event) => event.type === "exit").length, 1);

  now = 502;
  const shutdownEvents = await service.shutdown({ at: 502 });
  assert.equal(shutdownEvents.length, 1);
  assert.equal(second.status, "interrupted");
  assert.deepEqual(second.exit, { exitCode: 143, signal: 15, reason: "shutdown", at: 502 });
  assert.equal(secondSubscription.drain().filter((event) => event.type === "exit").length, 1);
  assert.equal(service.stopped, true);
  await assert.rejects(
    () => service.createSession({ projectId: "project-c", cols: 80, rows: 24 }),
    (error) => error instanceof TerminalServiceError && error.code === "service_shutdown",
  );
});

test("node-pty adapter supervises a real shell and preserves server-owned exit/output", async () => {
  const service = new TerminalService({
    serverId: "server-real-shell",
    ptyFactory: createNodePtyFactory(nodePty),
  });
  const session = await service.createSession({
    projectId: "project-real-shell",
    shellPath: "/bin/sh",
    args: ["-c", "printf 'REAL_SHELL_READY\\n'; read value; printf 'REAL_SHELL_ECHO:%s\\n' \"$value\""],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  });
  const transcript = [];
  const subscription = service.subscribe(session.identity, {
    authorization: { ...session.identity, scope: "read", clientId: "real-shell-reader" },
    onEvent: (event) => {
      if (event.type === "output") transcript.push(new TextDecoder().decode(event.bytes));
    },
  });
  const write = { ...session.identity, scope: "write", clientId: "real-shell-writer" };

  try {
    await waitFor(() => transcript.join("").includes("REAL_SHELL_READY"));
    await service.input(session.identity, "hello-from-client\n", write);
    await waitFor(() => transcript.join("").includes("REAL_SHELL_ECHO:hello-from-client"));
    await waitFor(() => session.status === "exited");
    assert.equal(session.exit?.reason, "exit");
    assert.equal(transcript.join("").includes("REAL_SHELL_READY"), true);
    assert.equal(transcript.join("").includes("REAL_SHELL_ECHO:hello-from-client"), true);
  } finally {
    subscription.close();
    if (session.status === "running") await session.kill(write, "SIGTERM").catch(() => {});
    await service.shutdown().catch(() => {});
  }
});

test("two authorized clients compete on one PTY while replay cursors suppress duplicates", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, maxReplayBytes: 64 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const adapter = new TerminalServiceAdapter(service);
  const firstEvents = [];
  const secondEvents = [];
  const firstIdentity = { ...session.identity, clientId: "client-a", scope: "read" };
  const secondIdentity = { ...session.identity, clientId: "client-b", scope: "read" };
  const first = adapter.attach({ clientId: "client-a", identity: session.identity, authorization: firstIdentity }, { onEvent: (event) => firstEvents.push(event) });
  const second = adapter.attach({ clientId: "client-b", identity: session.identity, authorization: secondIdentity }, { onEvent: (event) => secondEvents.push(event) });

  pty.processes[0].emitData("one");
  first.detach();
  pty.processes[0].emitData("two");
  const resumed = adapter.resume({ clientId: "client-a", identity: session.identity, authorization: firstIdentity, fromPosition: 0 }, { onEvent: (event) => firstEvents.push(event) });

  assert.deepEqual(outputText(firstEvents), ["one", "two"]);
  assert.deepEqual(outputText(resumed.initialEvents), ["two"]);
  assert.deepEqual(outputText(secondEvents), ["one", "two"]);

  const writeA = { ...session.identity, clientId: "client-a", scope: "write" };
  const writeB = { ...session.identity, clientId: "client-b", scope: "write" };
  await service.input(session.identity, "from-a", writeA);
  await service.resize(session.identity, { cols: 100, rows: 30 }, writeB);
  assert.deepEqual([...pty.processes[0].writes].map((bytes) => new TextDecoder().decode(bytes)), ["from-a"]);
  assert.deepEqual(pty.processes[0].resizes, [{ cols: 100, rows: 30 }]);
  await assert.rejects(
    () => service.input({ ...session.identity, projectId: "project-other" }, "blocked", writeA),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
  await assert.rejects(
    () => service.resize({ ...session.identity, projectId: "project-other" }, { cols: 90, rows: 25 }, writeB),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );

  resumed.detach();
  second.detach();
  assert.equal(adapter.size, 0);
  assert.equal(session.status, "running");
});
