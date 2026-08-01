import test from "node:test";
import assert from "node:assert/strict";
import { DetachableTerminalConsumerRegistry, TerminalService } from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn() {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 7000 + processes.length,
        writes: [],
        kills: [],
        write(value) { this.writes.push(new Uint8Array(value)); },
        resize() {},
        kill(signal) { this.kills.push(signal); },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = new TextEncoder().encode(value);
          for (const listener of dataListeners) listener(bytes);
        },
        emitExit(value = { exitCode: 0, signal: null }) {
          for (const listener of exitListeners) listener(value);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

const identity = { serverId: "server-consumers", projectId: "project-a", sessionId: "session-a" };

test("detachable consumers can reload independently while the server-owned PTY survives", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty, generateSessionId: () => identity.sessionId });
  const handle = await service.createSession({ projectId: identity.projectId, cols: 80, rows: 24 });
  const consumers = new DetachableTerminalConsumerRegistry(service);
  const firstEvents = [];
  const first = consumers.attach(identity, "desktop-client", { onEvent: (event) => firstEvents.push(event) });

  pty.processes[0].emitData("before-reload");
  assert.equal(firstEvents.filter((event) => event.type === "output").length, 1);
  assert.equal(consumers.isAttached(identity, "desktop-client"), true);

  assert.equal(consumers.detach(identity, "desktop-client"), true);
  assert.equal(first.closed, true);
  assert.equal(consumers.isAttached(identity, "desktop-client"), false);
  assert.equal(handle.status, "running");
  assert.deepEqual(pty.processes[0].kills, []);

  pty.processes[0].emitData("after-reload");
  const resumedEvents = [];
  const resumed = consumers.attach(identity, "desktop-client", { fromPosition: 0, onEvent: (event) => resumedEvents.push(event) });
  assert.equal(resumed.closed, false);
  assert.deepEqual(resumedEvents.filter((event) => event.type === "output").map((event) => new TextDecoder().decode(event.bytes)), ["before-reload", "after-reload"]);
  assert.equal(pty.processes.length, 1);

  consumers.clear();
  await service.shutdown();
});

test("replacing and detaching one consumer never detaches another consumer or kills the PTY", async () => {
  const pty = createPtyFactory();
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: pty, generateSessionId: () => identity.sessionId });
  await service.createSession({ projectId: identity.projectId, cols: 80, rows: 24 });
  const consumers = new DetachableTerminalConsumerRegistry(service);
  const old = consumers.attach(identity, "client-a");
  const other = consumers.attach(identity, "client-b");
  const replacement = consumers.attach(identity, "client-a");

  assert.equal(old.closed, true);
  assert.equal(other.closed, false);
  assert.equal(consumers.isAttached(identity, "client-a"), true);
  assert.equal(consumers.detach(identity, "client-a", old), false);
  assert.equal(consumers.isAttached(identity, "client-a"), true);
  assert.equal(consumers.detachConsumer("client-a"), 1);
  assert.equal(replacement.closed, true);
  assert.equal(consumers.isAttached(identity, "client-b"), true);
  assert.deepEqual(pty.processes[0].kills, []);

  consumers.clear();
  await service.shutdown();
});

test("consumer ids are bounded and cannot smuggle renderer ownership fields", () => {
  const service = new TerminalService({ serverId: identity.serverId, ptyFactory: createPtyFactory() });
  const consumers = new DetachableTerminalConsumerRegistry(service);
  for (const value of ["", "window id", "x".repeat(129)]) {
    assert.throws(() => consumers.attach(identity, value), /consumer id is invalid/);
  }
});
