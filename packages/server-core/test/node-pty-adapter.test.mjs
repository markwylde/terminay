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
  const exits = new Set();
  return {
    pid: 41,
    process: "zsh",
    write() {}, resize() {}, kill() {}, onData() {},
    onExit(listener) { exits.add(listener); return { dispose: () => exits.delete(listener) }; },
    exit(event = { exitCode: 0 }) { for (const listener of [...exits]) listener(event); },
  };
}

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
    { processName: "zsh", shellForeground: true },
    { processName: "codex", shellForeground: false },
    { processName: "zsh", shellForeground: true },
  ]);
  unsubscribe();
  assert.equal(scheduler.active.size, 0, "last foreground listener stops polling");
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
  assert.deepEqual(foreground, [{ processName: "zsh", shellForeground: false }]);
  assert.equal(output.length, 0);

  child.exit();
  assert.equal(scheduler.active.size, 0, "PTY exit stops polling");
  child.process = "claude";
  scheduler.tick();
  assert.deepEqual(foreground, [{ processName: "zsh", shellForeground: false }]);
  assert.equal(output.length, 0);
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
