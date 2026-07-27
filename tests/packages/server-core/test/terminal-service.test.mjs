import assert from "node:assert/strict";
import test from "node:test";

const modulePath = process.env.TERMINAY_TERMINAL_SERVICE_DIST ?? new URL("../../../../packages/server-core/dist/terminalService/index.js", import.meta.url).href;
const {
  TerminalService,
  TerminalServiceError,
} = await import(modulePath);

function fakeFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 100 + processes.length,
        writes: [],
        sizes: [],
        killed: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.sizes.push({ ...dimensions }); },
        kill(signal) { this.killed.push(signal); },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emit(bytes) { for (const listener of dataListeners) listener(bytes); },
        exit(value = {}) { for (const listener of exitListeners) listener(value); },
        options,
      };
      processes.push(process);
      return process;
    },
  };
}

test("terminal service keeps exact identity and bounded input/output", async () => {
  const factory = fakeFactory();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: factory, maxInputBytes: 3, maxOutputChunkBytes: 2, maxReplayBytes: 4 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  assert.deepEqual(session.identity, { serverId: "server-a", projectId: "project-a", sessionId: "session-a" });
  const events = [];
  session.subscribe({ onEvent: (event) => events.push(event) });
  factory.processes[0].emit(new Uint8Array([1, 2, 3, 4, 5]));
  assert.deepEqual(events.filter((event) => event.type === "output").map((event) => [...event.bytes]), [[1, 2], [3, 4], [5]]);
  assert.equal(session.snapshot().outputPosition, 5);
  await assert.rejects(service.input(session.identity, new Uint8Array([1, 2, 3, 4])), (error) => error instanceof TerminalServiceError && error.code === "input_too_large");
  await service.input(session.identity, new Uint8Array([1, 2, 3]), { serverId: "server-a", projectId: "project-a", sessionId: "session-a", scope: "write" });
  assert.deepEqual([...factory.processes[0].writes[0]], [1, 2, 3]);
  await assert.rejects(service.input(session.identity, new Uint8Array([1]), { serverId: "server-a", projectId: "project-b", sessionId: "session-a", scope: "admin" }), (error) => error.code === "forbidden");
});

test("reconnect replays retained bytes without duplicate PTY creation and reports gaps", async () => {
  const factory = fakeFactory();
  const service = new TerminalService({ serverId: "server-b", ptyFactory: factory, maxReplayBytes: 3, maxOutputChunkBytes: 3 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-b", cols: 80, rows: 24 });
  factory.processes[0].emit(new Uint8Array([10, 11, 12, 13, 14]));
  assert.equal(factory.processes.length, 1);
  await assert.rejects(Promise.resolve().then(() => service.subscribe(session.identity, { fromPosition: 0 })), (error) => error.code === "replay_gap");
  const replay = service.subscribe(session.identity, { fromPosition: 3 }).drain();
  assert.deepEqual(replay.filter((event) => event.type === "output").map((event) => [...event.bytes]), [[13, 14]]);
});

test("exit and interruption are emitted exactly once and survive detached clients", async () => {
  const factory = fakeFactory();
  const service = new TerminalService({ serverId: "server-c", ptyFactory: factory });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-c", cols: 80, rows: 24 });
  const events = [];
  session.subscribe({ onEvent: (event) => events.push(event) });
  factory.processes[0].exit({ exitCode: 7, signal: 0 });
  factory.processes[0].exit({ exitCode: 8, signal: 9 });
  assert.equal(events.filter((event) => event.type === "exit").length, 1);
  assert.equal(session.snapshot().status, "exited");
  const second = await service.createSession({ projectId: "project-a", sessionId: "session-d", cols: 80, rows: 24 });
  await service.interrupt(second.identity);
  assert.equal(second.snapshot().status, "interrupted");
  assert.equal(second.snapshot().exit.reason, "interrupted");
});

