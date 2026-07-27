import test from "node:test";
import assert from "node:assert/strict";
import {
  TerminalService,
  TerminalServiceAdapter,
  TerminalServiceError,
} from "../dist/index.js";

function fakePty() {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        pid: 9000 + processes.length,
        write() {},
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
        emit(value) {
          const bytes = new TextEncoder().encode(value);
          for (const listener of data) listener(bytes);
        },
        exit(value = {}) {
          for (const listener of exits) listener(value);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const read = { ...identity, scope: "read" };

function textEvents(events) {
  return events.filter((event) => event.type === "output").map((event) => ({
    position: event.position,
    nextPosition: event.nextPosition,
    text: new TextDecoder().decode(event.bytes),
    replay: event.replay,
  }));
}

test("terminal adapter detaches and resumes at each client/session high-water mark", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, maxReplayBytes: 64 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const adapter = new TerminalServiceAdapter(service);
  const firstEvents = [];
  const firstClosed = [];
  const first = adapter.attach(
    { clientId: "client-a", identity, authorization: read },
    { onEvent: (event) => firstEvents.push(event), onClose: (reason) => firstClosed.push(reason) },
  );

  pty.processes[0].emit("abc");
  assert.equal(first.position, 3);
  assert.deepEqual(textEvents(firstEvents), [{ position: 0, nextPosition: 3, text: "abc", replay: false }]);
  first.detach();
  assert.equal(first.closed, true);
  assert.deepEqual(firstClosed, ["client"]);
  assert.equal(session.status, "running");

  // Output produced while detached remains server-owned and is replayable.
  pty.processes[0].emit("def");
  const resumedEvents = [];
  const resumed = adapter.resume(
    { clientId: "client-a", identity, authorization: read, fromPosition: 0 },
    { onEvent: (event) => resumedEvents.push(event) },
  );
  assert.equal(resumed.snapshot().fromPosition, 3, "stale reconnect cursor is advanced to the known position");
  assert.deepEqual(textEvents(resumed.initialEvents), [{ position: 3, nextPosition: 6, text: "def", replay: true }]);
  assert.deepEqual(textEvents(resumedEvents), [{ position: 3, nextPosition: 6, text: "def", replay: true }]);

  // A separate client has an independent cursor and receives the retained
  // snapshot from zero; client-a never receives abc a second time.
  const otherEvents = [];
  const other = adapter.attach(
    { clientId: "client-b", identity, authorization: read, fromPosition: 0 },
    { onEvent: (event) => otherEvents.push(event) },
  );
  assert.deepEqual(textEvents(otherEvents), [
    { position: 0, nextPosition: 3, text: "abc", replay: true },
    { position: 3, nextPosition: 6, text: "def", replay: true },
  ]);
  pty.processes[0].emit("g");
  assert.deepEqual(textEvents(resumedEvents).at(-1), { position: 6, nextPosition: 7, text: "g", replay: false });
  assert.deepEqual(textEvents(otherEvents).at(-1), { position: 6, nextPosition: 7, text: "g", replay: false });
  resumed.detach();
  other.detach();
  assert.equal(adapter.size, 0);
  assert.equal(session.status, "running");
});

test("terminal adapter preserves exact identity authorization and surfaces retained replay gaps", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, maxOutputChunkBytes: 3, maxReplayBytes: 3 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const adapter = new TerminalServiceAdapter(service);
  pty.processes[0].emit("abcdef");

  assert.throws(
    () => adapter.attach({ clientId: "client-a", identity: { ...identity, projectId: "project-other" }, authorization: read }, { onEvent() {} }),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
  assert.throws(
    () => adapter.attach({ clientId: "client-a", identity, authorization: read, fromPosition: 0 }, { onEvent() {} }),
    (error) => error instanceof TerminalServiceError && error.code === "replay_gap" && error.details?.replayFrom === 3,
  );
  assert.equal(session.status, "running");
});
