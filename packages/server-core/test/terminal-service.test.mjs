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
      const foregroundProcessListeners = new Set();
      const process = {
        pid: 7000 + processes.length,
        options,
        writes: [],
        resizes: [],
        kills: [],
        pauses: 0,
        resumes: 0,
        currentCwd: options.cwd,
        getCwd() { return this.currentCwd; },
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill(signal) { this.kills.push(signal); },
        pause() { this.pauses += 1; },
        resume() { this.resumes += 1; },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        onForegroundProcess(listener) { foregroundProcessListeners.add(listener); return () => foregroundProcessListeners.delete(listener); },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(exit = {}) {
          for (const listener of exitListeners) listener(exit);
        },
        emitForegroundProcess(event) {
          for (const listener of foregroundProcessListeners) listener(event);
        },
        get foregroundProcessListenerCount() { return foregroundProcessListeners.size; },
      };
      processes.push(process);
      return process;
    },
  };
}

test("TerminalService resolves the host default shell for every implicit session", async () => {
  const pty = createPtyFactory();
  let configuredShell = { shellPath: "/bin/zsh", args: ["-l"] };
  const service = new TerminalService({
    serverId: "server-default-shell",
    ptyFactory: pty,
    resolveDefaultShell: () => configuredShell,
  });

  await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  configuredShell = { shellPath: "/bin/fish", args: ["-l"] };
  await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  await service.createSession({ projectId: "project-a", shellPath: "/bin/bash", args: ["--noprofile"], cols: 80, rows: 24 });

  assert.deepEqual(
    pty.processes.map(({ options }) => ({ shellPath: options.shellPath, shell: options.shell, args: options.args })),
    [
      { shellPath: "/bin/zsh", shell: "/bin/zsh", args: ["-l"] },
      { shellPath: "/bin/fish", shell: "/bin/fish", args: ["-l"] },
      { shellPath: "/bin/bash", shell: "/bin/bash", args: ["--noprofile"] },
    ],
  );
  await service.shutdown();
});

test("TerminalService observes live cwd without mutating immutable spawn cwd", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty });
  const session = await service.createSession({ projectId: "project-a", cwd: "/spawn", cols: 80, rows: 24 });
  pty.processes[0].currentCwd = "/live";
  assert.deepEqual(await service.currentCwd(session.snapshot(), {
    serverId: "server-a", projectId: "project-a", sessionId: session.sessionId, scope: "read",
  }), { cwd: "/live", source: "observed" });
  assert.equal(session.snapshot().cwd, "/spawn");
});

test("TerminalService aborts a cwd observer when its bounded deadline expires", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty });
  const session = await service.createSession({ projectId: "project-a", cwd: "/spawn", cols: 80, rows: 24 });
  let aborted = false;
  pty.processes[0].getCwd = (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      resolve(null);
    }, { once: true });
  });
  assert.deepEqual(await service.currentCwd(session.snapshot(), {
    serverId: "server-a", projectId: "project-a", sessionId: session.sessionId, scope: "read",
  }, 5), { cwd: "/spawn", source: "spawn", observationError: "timeout" });
  assert.equal(aborted, true);
});

test("TerminalService close observation is session-scoped, bounded, and capability-limited", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty });
  const idle = await service.createSession({ projectId: "project-a", sessionId: "idle", cols: 80, rows: 24 });
  const noisy = await service.createSession({ projectId: "project-a", sessionId: "noisy", cols: 80, rows: 24 });
  const _other = await service.createSession({ projectId: "project-b", sessionId: "other", cols: 80, rows: 24 });
  const auth = (sessionId, projectId = "project-a") => ({
    serverId: "server-a", projectId, sessionId, scope: "read",
  });

  assert.deepEqual(await service.observeForegroundProcess(idle.snapshot(), auth("idle"), 20), {
    sessionId: "idle",
    projectId: "project-a",
    observation: "limited",
    foregroundBusy: false,
    observationError: "unavailable",
  });

  let noisyCalls = 0;
  pty.processes[1].refreshForegroundProcess = (signal) => new Promise((_, reject) => {
    noisyCalls += 1;
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  pty.processes[0].refreshForegroundProcess = async () => {
    pty.processes[0].emitForegroundProcess({ processName: "zsh", shellForeground: true, observation: "available" });
  };
  pty.processes[2].refreshForegroundProcess = () => new Promise(() => {});

  const started = Date.now();
  const observedIdle = await service.observeForegroundProcess(idle.snapshot(), auth("idle"), 30);
  const elapsed = Date.now() - started;
  assert.equal(observedIdle.observation, "available");
  assert.equal(observedIdle.foregroundBusy, false);
  assert.equal(noisyCalls, 0);
  assert.ok(elapsed < 200, "an idle session must not wait for a sibling observer");

  const timedOut = await service.observeForegroundProcess(noisy.snapshot(), auth("noisy"), 20);
  assert.equal(timedOut.observation, "limited");
  assert.equal(timedOut.observationError, "timeout");
  assert.equal(noisyCalls, 1);

  const project = await service.observeProjectForegroundProcesses("project-a", { serverId: "server-a", projectId: "project-a", scope: "read" }, 20);
  assert.deepEqual(project.map((entry) => entry.sessionId).sort(), ["idle", "noisy"]);
  assert.equal(project.some((entry) => entry.sessionId === "other"), false);
  await service.shutdown();
});


function createInactivityTimer() {
  let now = 0;
  let nextId = 0;
  const scheduled = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      scheduled.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id) { scheduled.delete(id); },
    advanceBy(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...scheduled.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at || left - right)[0];
        if (next === undefined) break;
        const [id, timer] = next;
        scheduled.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
    get size() { return scheduled.size; },
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
    cwd: "/tmp",
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

test("TerminalService forwards optional foreground process events with exact identity and disposes them on exit", async () => {
  const pty = createPtyFactory();
  const foregroundEvents = [];
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    now: () => 100,
    sessionLifecycle: {
      prepareTerminalSession: () => ({}),
      terminalExited() {},
      foregroundProcessChanged(session, event) { foregroundEvents.push({ session, event }); },
    },
  });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const process = pty.processes[0];

  assert.equal(process.foregroundProcessListenerCount, 1);
  process.emitForegroundProcess({ processName: "codex", shellForeground: false });
  assert.deepEqual(foregroundEvents, [{
    session: identity(),
    event: { processName: "codex", shellForeground: false },
  }]);

  process.emitExit({ exitCode: 0, signal: null });
  assert.equal(handle.status, "exited");
  assert.equal(process.foregroundProcessListenerCount, 0);
  process.emitForegroundProcess({ processName: "sh", shellForeground: true });
  assert.equal(foregroundEvents.length, 1);
});

test("TerminalService waits for output-only inactivity and resets the quiet window on accepted output", async () => {
  const pty = createPtyFactory();
  const timer = createInactivityTimer();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    inactivityTimer: timer,
  });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const process = pty.processes[0];
  const write = writeAuthorization();

  let firstResolved = false;
  const first = handle.waitForInactivity(100).then(() => { firstResolved = true; });
  timer.advanceBy(25);
  process.emitData("");
  await handle.input("input is not output", write);
  await handle.resize({ cols: 100, rows: 30 }, write);
  handle.attach().close();
  timer.advanceBy(75);
  await first;
  assert.equal(firstResolved, true, "empty output, input, resize, and attachment do not reset inactivity");

  let secondResolved = false;
  const second = service.waitForInactivity(handle.identity, 100).then(() => { secondResolved = true; });
  timer.advanceBy(99);
  process.emitData("accepted PTY output");
  timer.advanceBy(1);
  await Promise.resolve();
  assert.equal(secondResolved, false, "accepted output restarts the quiet window");
  timer.advanceBy(99);
  await second;
  assert.equal(secondResolved, true);
  assert.equal(timer.size, 0);
});

test("TerminalService resolves inactivity waits on exit and abort cleans up only its own wait", async () => {
  const pty = createPtyFactory();
  const timer = createInactivityTimer();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, inactivityTimer: timer });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const process = pty.processes[0];

  const exitFirst = handle.waitForInactivity(100);
  const exitSecond = handle.waitForInactivity(200);
  assert.equal(timer.size, 2);
  process.emitExit({ exitCode: 0, signal: null });
  await Promise.all([exitFirst, exitSecond]);
  assert.equal(timer.size, 0, "exit clears every outstanding inactivity timer");

  const live = await service.createSession({ projectId: "project-a", sessionId: "session-b", cols: 80, rows: 24 });
  const controller = new AbortController();
  const aborted = live.waitForInactivity(100, { signal: controller.signal });
  const remaining = live.waitForInactivity(200);
  assert.equal(timer.size, 2);
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);
  await assert.rejects(aborted, (error) => error === reason);
  assert.equal(timer.size, 1, "aborting one wait clears only its own timer");
  timer.advanceBy(200);
  await remaining;
  assert.equal(timer.size, 0);
});

test("TerminalService incrementally drains one multi-megabyte PTY callback into checkpoints", { timeout: 5_000 }, async () => {
  const pty = createPtyFactory();
  const pending = [];
  const admitted = [];
  let active = 0;
  const checkpoints = {
    createSession() {},
    ingestOutput(_identity, position, bytes) {
      active += 1;
      assert.equal(active, 1, "checkpoint authority receives only one in-flight chunk");
      let resolve;
      const promise = new Promise((done) => {
        resolve = () => {
          active -= 1;
          done();
        };
      });
      admitted.push({ position, bytes: new Uint8Array(bytes) });
      pending.push({ promise, resolve });
      return promise;
    },
    ingestResize() { return Promise.resolve(); },
    closeSession() {},
  };
  const service = new TerminalService({
    serverId: "server-checkpoint-pressure",
    ptyFactory: pty,
    presentationCheckpoints: checkpoints,
  });
  await service.createSession({
    projectId: "project-checkpoint-pressure",
    sessionId: "session-checkpoint-pressure",
    cols: 80,
    rows: 24,
  });
  const process = pty.processes[0];
  const output = new Uint8Array(3 * 1024 * 1024);
  for (let index = 0; index < output.byteLength; index += 1) output[index] = index % 251;

  try {
    process.emitData(output);
    assert.equal(process.pauses, 1, "the PTY pauses at the bounded parser high-water mark");
    assert.equal(process.resumes, 0);
    assert.equal(admitted.length, 1, "a single large callback does not flood checkpoint admission");

    const expectedChunks = output.byteLength / (64 * 1024);
    for (let index = 0; index < expectedChunks; index += 1) {
      assert.equal(pending.length, index + 1);
      pending[index].resolve();
      await pending[index].promise;
      await Promise.resolve();
    }
    assert.equal(process.resumes, 1, "the PTY resumes at the parser low-water mark");
    assert.equal(admitted.length, expectedChunks);
    for (let index = 0; index < admitted.length; index += 1) {
      assert.equal(admitted[index].position, index * 64 * 1024);
      assert.deepEqual(admitted[index].bytes, output.slice(index * 64 * 1024, (index + 1) * 64 * 1024));
    }
    assert.equal(service.getSession({
      serverId: "server-checkpoint-pressure",
      projectId: "project-checkpoint-pressure",
      sessionId: "session-checkpoint-pressure",
    }).status, "running");
  } finally {
    for (const item of pending) item.resolve();
    await service.shutdown();
  }
});

test("TerminalService kill finalizes a session exactly once when the PTY reports duplicate exits", async () => {
  const pty = createPtyFactory();
  const lifecycleExits = [];
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    now: () => 100,
    sessionLifecycle: {
      prepareTerminalSession: () => ({}),
      terminalExited(session, exit) { lifecycleExits.push({ session, exit }); },
    },
  });
  const handle = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const subscription = handle.attach();
  const process = pty.processes[0];

  await handle.kill(writeAuthorization());
  assert.deepEqual(process.kills, [undefined]);
  assert.equal(handle.status, "running", "the authoritative finalization waits for the PTY exit");

  process.emitExit({ exitCode: 137, signal: 9 });
  process.emitExit({ exitCode: 137, signal: 9 });

  assert.deepEqual(handle.exit, { exitCode: 137, signal: 9, reason: "killed", at: 100 });
  assert.equal(handle.status, "exited");
  assert.deepEqual(lifecycleExits, [{
    session: identity(),
    exit: { exitCode: 137, signal: "9" },
  }]);
  assert.deepEqual(subscription.drain().filter((event) => event.type === "exit"), [{
    type: "exit",
    ...identity(),
    metadata: { exitCode: 137, signal: 9, reason: "killed", at: 100 },
    exitCode: 137,
    signal: 9,
  }]);

  await handle.kill(writeAuthorization());
  assert.equal(handle.status, "exited");
  assert.deepEqual(process.kills, [undefined]);
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

  // The service foreground observer polls while a terminal is live.  This
  // fixture deliberately never emits a node-pty exit, so finish its
  // server-owned lifecycle explicitly rather than leaving that poll alive
  // after the assertion completes.
  resumed.close();
  await service.shutdown();
});

test("TerminalService merges host defaults, caller values, and server lifecycle credentials in that order", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    defaultEnvironment: { PATH: "/host/bin", TERM: "host-term", HOST_ONLY: "yes" },
    sessionLifecycle: {
      prepareTerminalSession: () => ({ TERM: "server-term", TERMINAY_SERVER_SCOPE: "server-only" }),
      terminalExited() {},
    },
  });
  await service.createSession({
    projectId: "project-a",
    sessionId: "session-a",
    cols: 80,
    rows: 24,
    env: { TERM: "client-term", CLIENT_ONLY: "yes", TERMINAY_SERVER_SCOPE: "spoofed" },
  });
  assert.deepEqual(pty.processes[0].options.env, {
    PATH: "/host/bin",
    TERM: "server-term",
    HOST_ONLY: "yes",
    CLIENT_ONLY: "yes",
    TERMINAY_SERVER_SCOPE: "server-only",
  });
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
  assert.equal(slow.closeReason, "skip");
  assert.deepEqual(slow.drain().map((event) => event.type), ["skip"]);
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

test("TerminalService disposal releases node-pty foreground polling when shutdown precedes PTY exit", async () => {
  const intervals = new Map();
  let nextIntervalId = 0;
  const exits = new Set();
  const child = {
    pid: 9911,
    process: "sh",
    write() {},
    resize() {},
    kill() {},
    onData() {},
    onExit(listener) {
      exits.add(listener);
      return { dispose: () => exits.delete(listener) };
    },
  };
  const service = new TerminalService({
    serverId: "server-foreground-disposal",
    ptyFactory: createNodePtyFactory(
      { spawn: () => child },
      {
        foregroundPolling: {
          setInterval(callback, delayMs) {
            const id = ++nextIntervalId;
            intervals.set(id, { callback, delayMs });
            return id;
          },
          clearInterval(id) { intervals.delete(id); },
        },
      },
    ),
  });
  const session = await service.createSession({ projectId: "project-foreground-disposal", shellPath: "/bin/sh", cols: 80, rows: 24 });

  assert.equal(intervals.size, 1, "the service foreground subscription starts the adapter poll");
  await service.shutdown();
  assert.equal(session.status, "interrupted");
  assert.equal(intervals.size, 0, "authoritative shutdown disposes the adapter poll without waiting for node-pty exit");
});

test("two authorized clients compete on one PTY while an explicit display cursor replays retained output", async () => {
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

  assert.deepEqual(outputText(firstEvents), ["one", "one", "two"]);
  assert.deepEqual(outputText(resumed.initialEvents), ["one", "two"]);
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
