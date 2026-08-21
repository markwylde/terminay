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

test("node-pty kill waits for the native exit callback before teardown", async () => {
  const child = createChild();
  const process = createNodePtyFactory({ spawn: () => child }).spawn({
    shellPath: "/bin/sh", shell: "/bin/sh", args: [], cwd: "/tmp", cols: 80, rows: 24,
  });
  let settled = false;
  const killed = process.kill("SIGTERM").then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  child.exit({ exitCode: 143, signal: 15 });
  await killed;
  assert.equal(settled, true);
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
