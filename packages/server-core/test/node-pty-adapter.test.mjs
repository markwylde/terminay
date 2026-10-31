import test from "node:test";
import assert from "node:assert/strict";
import { createNodePtyFactory } from "../dist/index.js";

function createScheduler() {
  const active = new Map();
  let nextId = 0;
  return {
    active,
    setInterval(callback, delayMs) {
      const id = ++nextId;
      active.set(id, { callback, delayMs });
      return id;
    },
    clearInterval(id) { active.delete(id); },
    tick() { for (const { callback } of [...active.values()]) callback(); },
  };
}

function createChild() {
  const data = new Set();
  const exits = new Set();
  return {
    pid: 41,
    process: "zsh",
    write() {}, resize() {}, kill() {},
    onData(listener) { data.add(listener); return { dispose: () => data.delete(listener) }; },
    onExit(listener) { exits.add(listener); return { dispose: () => exits.delete(listener) }; },
    emitData(value) { for (const listener of [...data]) listener(value); },
    exit(event = { exitCode: 0 }) { for (const listener of [...exits]) listener(event); },
  };
}

test("node-pty retains output and exit emitted before TerminalService attaches", () => {
  const child = createChild();
  const process = createNodePtyFactory({ spawn: () => child }).spawn({
    shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: "/tmp", cols: 80, rows: 24,
  });

  child.emitData("READY\n");
  child.exit({ exitCode: 7, signal: 9 });
  const output = [];
  const exits = [];
  process.onData((bytes) => output.push(new TextDecoder().decode(bytes)));
  process.onExit((event) => exits.push(event));

  assert.deepEqual(output, ["READY\n"]);
  assert.deepEqual(exits, [{ exitCode: 7, signal: 9 }]);
});

test("node-pty foreground observer deduplicates process changes and identifies the shell", () => {
  const scheduler = createScheduler();
  const child = createChild();
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  const unsubscribe = process.onForegroundProcess((event) => events.push(event));

  assert.deepEqual([...scheduler.active.values()].map(({ delayMs }) => delayMs), [1500]);
  scheduler.tick();
  scheduler.tick();
  child.process = "codex";
  scheduler.tick();
  child.process = "zsh";
  scheduler.tick();

  assert.deepEqual(events, [
    { processName: "zsh", shellForeground: true, observation: "available" },
    { processName: "codex", shellForeground: false, observation: "available" },
    { processName: "zsh", shellForeground: true, observation: "available" },
  ]);
  unsubscribe();
  assert.equal(scheduler.active.size, 0, "last foreground listener stops polling");
});

test("node-pty refreshes foreground activity when output advances while timer delivery is starved", () => {
  const scheduler = createScheduler();
  const child = createChild();
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));

  child.process = "sleep";
  child.emitData("foreground-ready\n");

  assert.deepEqual(events, [{ processName: "sleep", shellForeground: false, observation: "available" }]);
  process.dispose();
});

test("node-pty prefers host foreground process authority over a stale process title", async () => {
  const scheduler = createScheduler();
  const child = createChild();
  child.process = "zsh";
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      foregroundPolling: scheduler,
      resolveForegroundProcess: async (pid) => {
        assert.equal(pid, 41);
        return "sleep";
      },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));

  scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [{ processName: "sleep", shellForeground: false, observation: "available" }]);
  process.dispose();
});

test("node-pty foreground refresh awaits an in-flight host observation fence", async () => {
  const child = createChild();
  let resolveProcess;
  const processResult = new Promise((resolve) => { resolveProcess = resolve; });
  const factory = createNodePtyFactory(
    { spawn: () => child },
    { resolveForegroundProcess: () => processResult },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));

  const fence = process.refreshForegroundProcess();
  assert.deepEqual(events, []);
  resolveProcess("sleep");
  await fence;

  assert.deepEqual(events, [{ processName: "sleep", shellForeground: false, observation: "available" }]);
  process.dispose();
});

test("node-pty foreground refresh settles after one sample even when output requests a replacement", async () => {
  const child = createChild();
  let releaseFirst;
  let calls = 0;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      resolveForegroundProcess: () => {
        calls += 1;
        return calls === 1 ? first : Promise.resolve("sleep");
      },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));
  try {
    const snapshotFence = process.refreshForegroundProcess();
    child.emitData("foreground-marker\n");
    releaseFirst("sleep");
    await snapshotFence;
    assert.deepEqual(events[0], { processName: "sleep", shellForeground: false, observation: "available" });
    assert.ok(calls >= 1 && calls <= 2);
  } finally {
    process.dispose();
  }
});

test("node-pty close observation discards an in-flight sample that started before the refresh", async () => {
  const child = createChild();
  let calls = 0;
  let rejectStale;
  const stale = new Promise((_resolve, reject) => {
    rejectStale = reject;
  });
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      resolveForegroundProcess: (_pid, signal) => {
        calls += 1;
        if (calls === 1) {
          signal?.addEventListener("abort", () => {
            rejectStale(new Error("aborted"));
          }, { once: true });
          return stale;
        }
        return Promise.resolve("sleep");
      },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));
  try {
    child.emitData("stale-output\n");
    assert.equal(calls, 1);
    const fence = process.refreshForegroundProcess();
    await fence;
    assert.deepEqual(events.at(-1), { processName: "sleep", shellForeground: false, observation: "available" });
    assert.equal(events.some((event) => event.processName === "zsh" && event.observation === "limited"), false);
  } finally {
    process.dispose();
  }
});

test("node-pty foreground observer tears down on PTY exit and never enters output callbacks", () => {
  const scheduler = createScheduler();
  const child = createChild();
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/fish", shell: "/bin/fish", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const foreground = [];
  const output = [];
  process.onData((bytes) => output.push(bytes));
  process.onForegroundProcess((event) => foreground.push(event));
  scheduler.tick();
  assert.deepEqual(foreground, [{ processName: "zsh", shellForeground: false, observation: "available" }]);
  assert.equal(output.length, 0);

  child.exit();
  assert.equal(scheduler.active.size, 0, "PTY exit stops polling");
  child.process = "claude";
  scheduler.tick();
  assert.deepEqual(foreground, [{ processName: "zsh", shellForeground: false, observation: "available" }]);
  assert.equal(output.length, 0);
});

test("node-pty treats a login shell argv0 as the configured shell", () => {
  const scheduler = createScheduler();
  const child = createChild();
  child.process = "-zsh";
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));
  scheduler.tick();
  assert.deepEqual(events, [{ processName: "-zsh", shellForeground: true, observation: "available" }]);
});

test("node-pty treats login as a trivial wrapper around the configured shell", () => {
  const scheduler = createScheduler();
  const child = createChild();
  child.process = "login";
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));
  scheduler.tick();
  assert.deepEqual(events, [{ processName: "login", shellForeground: true, observation: "available" }]);
});

test("node-pty treats Debian dash as the configured POSIX sh shell", () => {
  const scheduler = createScheduler();
  const child = createChild();
  child.process = "dash";
  const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
  const process = factory.spawn({ shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event));
  scheduler.tick();
  assert.deepEqual(events, [{ processName: "dash", shellForeground: true, observation: "available" }]);
});

test("node-pty treats a Windows shell's command name as its configured executable", () => {
  for (const [shellPath, idle] of [
    ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "powershell"],
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh"],
    ["C:\\Windows\\System32\\cmd.exe", "cmd"],
    ["C:\\Windows\\System32\\CMD.EXE", "cmd"],
  ]) {
    const scheduler = createScheduler();
    const child = createChild();
    child.process = idle;
    const factory = createNodePtyFactory({ spawn: () => child }, { foregroundPolling: scheduler });
    const process = factory.spawn({ shellPath, shell: shellPath, args: [], cwd: "C:\\", cols: 80, rows: 24 });
    const events = [];
    process.onForegroundProcess((event) => events.push(event));
    scheduler.tick();
    child.process = "node";
    scheduler.tick();
    assert.deepEqual(events, [
      { processName: idle, shellForeground: true, observation: "available" },
      { processName: "node", shellForeground: false, observation: "available" },
    ], shellPath);
  }
});

test("node-pty cwd observation forwards the service cancellation signal", async () => {
  const child = createChild();
  let observed;
  const factory = createNodePtyFactory(
    { spawn: () => child },
    { resolveCwd: async (pid, signal) => {
      observed = { pid, signal };
      return "/live";
    } },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/spawn", cols: 80, rows: 24 });
  const controller = new AbortController();
  assert.equal(await process.getCwd(controller.signal), "/live");
  assert.deepEqual(observed, { pid: 41, signal: controller.signal });
});

test("node-pty coalesces continuous output into one in-flight sample and one pending sample", async () => {
  const child = createChild();
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  const second = new Promise((resolve) => { releaseSecond = resolve; });
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      resolveForegroundProcess: () => {
        calls += 1;
        if (calls === 1) return first;
        if (calls === 2) return second;
        return new Promise(() => {});
      },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  process.onForegroundProcess(() => {});

  const fence = process.refreshForegroundProcess();
  for (let index = 0; index < 40; index += 1) child.emitData(`chunk-${index}\n`);
  assert.equal(calls, 1, "output cannot start a second host sample while one is in flight");

  releaseFirst("zsh");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2, "the latest pending sample replaces obsolete output-driven requests");

  for (let index = 0; index < 40; index += 1) child.emitData(`later-${index}\n`);
  releaseSecond("sleep");
  await fence;

  assert.ok(calls <= 3, "close observation settles without waiting for output silence");
  process.dispose();
});

/**
 * A clock the test advances: the adapter's output ramp reads it and arms its
 * timers on it, and nothing runs until the test says that time has passed.
 */
function createRampClock() {
  let now = 0;
  const timers = [];
  return {
    timers,
    get now() { return now; },
    outputRamp: {
      now: () => now,
      schedule: (callback, milliseconds) => { const timer = { callback, at: now + milliseconds }; timers.push(timer); return timer; },
      cancelSchedule: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    },
    /** Move time on, running each ramp timer that falls due on the way. */
    advance(milliseconds) {
      const until = now + milliseconds;
      for (;;) {
        timers.sort((left, right) => left.at - right.at);
        const due = timers[0];
        if (due === undefined || due.at > until) break;
        timers.shift();
        now = due.at;
        due.callback();
      }
      now = until;
    },
  };
}

test("node-pty samples the host foreground at a bounded rate under sustained output", async (t) => {
  const child = createChild();
  const clock = createRampClock();
  let samples = 0;
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      // A host observation that completes at once, so nothing but the adapter's
      // own pacing separates one sample from the next.
      resolveForegroundProcess: async () => { samples += 1; return "claude"; },
      // Neither the poll nor the ramp runs on the machine's clock: the rate is
      // counted against time the test lets pass, not time the run took.
      foregroundPolling: { ...createScheduler(), outputRamp: clock.outputRamp },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  t.after(() => process.dispose());
  process.onForegroundProcess(() => {});
  process.onData(() => {});

  // A repainting TUI printing a frame every 10 ms for four seconds; each
  // chunk arrives after the previous sample settled.
  const FRAMES = 400;
  const FRAME_MS = 10;
  for (let index = 0; index < FRAMES; index += 1) {
    child.emitData(`frame-${index}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(FRAME_MS);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const elapsedSeconds = (FRAMES * FRAME_MS) / 1000;

  // Output may refresh the projection promptly; it may not turn every chunk
  // into a walk of the host process table.
  const allowed = 2 + Math.ceil(elapsedSeconds * 4);
  assert.ok(samples > 1, "sustained output stopped sampling the host after the first chunk");
  assert.ok(
    samples <= allowed,
    `${samples} host samples for ${FRAMES} chunks in ${elapsedSeconds}s; at most ${allowed} are allowed`,
  );
  process.dispose();
});

test("node-pty close observation is not delayed by output pacing", async (t) => {
  const child = createChild();
  const clock = createRampClock();
  let samples = 0;
  const factory = createNodePtyFactory(
    { spawn: () => child },
    {
      resolveForegroundProcess: async () => { samples += 1; return "vim"; },
      foregroundPolling: { ...createScheduler(), outputRamp: clock.outputRamp },
    },
  );
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  t.after(() => process.dispose());
  process.onForegroundProcess(() => {});
  for (let index = 0; index < 50; index += 1) {
    child.emitData(`frame-${index}\n`);
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Output has sampled, and the ramp is holding the next sample back.
  assert.equal(clock.timers.length, 1, "sustained output left no paced sample waiting");

  // Destructive close asks for an observation that began after the request;
  // it is answered by a fresh sample at once, however recently output sampled.
  // The test's clock stands still, so an answer that waited on output pacing
  // could never arrive.
  const before = samples;
  let answered = false;
  const observation = process.refreshForegroundProcess().then(() => { answered = true; });
  for (let turn = 0; turn < 10 && !answered; turn += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered, true, "the close observation waited on output pacing");
  await observation;
  assert.ok(samples > before, "the close observation reused a sample taken before it was requested");
  assert.equal(clock.now, 0, "time passed while the close observation was answered");
  process.dispose();
});

test("node-pty spaces output-driven samples by the shared ramp", () => {
  const child = createChild();
  let now = 0;
  const timers = [];
  const factory = createNodePtyFactory({ spawn: () => child }, {
    foregroundPolling: {
      ...createScheduler(),
      outputRamp: {
        now: () => now,
        schedule: (callback, milliseconds) => { const timer = { callback, at: now + milliseconds }; timers.push(timer); return timer; },
        cancelSchedule: (timer) => { timers.splice(timers.indexOf(timer), 1); },
      },
    },
  });
  const process = factory.spawn({ shellPath: "/bin/zsh", shell: "/bin/zsh", args: [], cwd: "/tmp", cols: 80, rows: 24 });
  const events = [];
  process.onForegroundProcess((event) => events.push(event.processName));
  process.onData(() => {});
  const fire = () => { const timer = timers.shift(); now = timer.at; timer.callback(); };

  // Output after quiet is acted on inside the output callback itself.
  child.process = "vim";
  child.emitData("first\n");
  assert.deepEqual(events, ["vim"]);
  assert.equal(timers.length, 0, "the first sample must not wait for a timer");

  // Output inside the interval collapses into exactly one sample at its end.
  child.process = "less";
  for (let index = 0; index < 100; index += 1) { now += 1; child.emitData(`frame-${index}\n`); }
  assert.deepEqual(events, ["vim"], "output inside the interval sampled the host again");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].at, 1_000);
  fire();
  assert.deepEqual(events, ["vim", "less"]);
  assert.equal(timers.length, 0, "the ramp rescheduled itself without new output");

  // Still printing: the next floor is wider.
  child.process = "top";
  now += 10;
  child.emitData("more\n");
  assert.equal(timers[0].at, 3_000);
  fire();
  assert.deepEqual(events, ["vim", "less", "top"]);

  // A quiet period at least as long as the current interval returns to the floor.
  child.process = "zsh";
  now += 60_000;
  child.emitData("prompt\n");
  assert.deepEqual(events, ["vim", "less", "top", "zsh"]);
  assert.equal(timers.length, 0);

  // Whatever started observing also stops it.
  child.emitData("tail\n");
  assert.equal(timers.length, 1);
  process.dispose();
  assert.equal(timers.length, 0, "disposing left a ramp timer armed");
});
