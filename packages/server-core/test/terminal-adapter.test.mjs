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
      const foreground = new Set();
      const process = {
        pid: 9000 + processes.length,
        write() {},
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
        onForegroundProcess(listener) { foreground.add(listener); return () => foreground.delete(listener); },
        emit(value) {
          const bytes = new TextEncoder().encode(value);
          for (const listener of data) listener(bytes);
        },
        exit(value = {}) {
          for (const listener of exits) listener(value);
        },
        emitForegroundProcess(processName, shellForeground = false) {
          for (const listener of foreground) listener({ processName, shellForeground });
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

test("terminal adapter resumes only from a stated cursor and keeps no watermark memory", async () => {
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
  assert.equal(resumed.snapshot().fromPosition, 0);
  assert.deepEqual(textEvents(resumed.initialEvents), [
    { position: 0, nextPosition: 3, text: "abc", replay: true },
    { position: 3, nextPosition: 6, text: "def", replay: true },
  ]);
  assert.deepEqual(textEvents(resumedEvents), textEvents(resumed.initialEvents));

  // A separate client has an independent cursor and receives the retained
  // snapshot from zero; both fresh display surfaces receive retained bytes.
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
  // A reconnect states the position it actually rendered. The adapter keeps no
  // cursor of its own: resuming from a remembered watermark can start a stream
  // at a position this display never reached, which is precisely the gap it
  // has no way to detect.
  const reconnect = adapter.resume(
    { clientId: "client-a", identity, authorization: read },
    { onEvent: () => {} },
  );
  assert.equal(reconnect.snapshot().fromPosition, 0,
    "an omitted cursor means the start of retained replay, never an invented one");
  assert.equal(
    textEvents(reconnect.initialEvents).map((event) => event.text).join(""),
    "abcdefg",
    "retained replay is delivered in full rather than silently skipped",
  );
  reconnect.detach();

  const exact = adapter.resume(
    { clientId: "client-a", identity, authorization: read, fromPosition: 7 },
    { onEvent: () => {} },
  );
  assert.equal(exact.snapshot().fromPosition, 7);
  assert.deepEqual(exact.initialEvents, []);
  exact.detach();
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

test("foreground lifecycle signals never enter terminal output, replay, or attachment streams", async () => {
  const pty = fakePty();
  const service = new TerminalService({ serverId: "server-a", ptyFactory: pty, maxReplayBytes: 64 });
  const session = await service.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const serviceEvents = [];
  const unsubscribeService = service.onEvent((event) => serviceEvents.push(event));
  const direct = service.subscribe(identity, { authorization: read });
  const adapter = new TerminalServiceAdapter(service);
  const attachmentEvents = [];
  const attachment = adapter.attach(
    { clientId: "client-a", identity, authorization: read },
    { onEvent: (event) => attachmentEvents.push(event) },
  );

  pty.processes[0].emitForegroundProcess("codex", false);
  pty.processes[0].emitForegroundProcess("zsh", true);

  assert.deepEqual(serviceEvents, []);
  assert.deepEqual(direct.drain(), []);
  assert.deepEqual(attachmentEvents, []);
  assert.equal(session.outputPosition, 0);
  assert.equal(direct.position, 0);
  assert.equal(attachment.position, 0);

  attachment.detach();
  const resumedEvents = [];
  const resumed = adapter.resume(
    { clientId: "client-a", identity, authorization: read, fromPosition: 0 },
    { onEvent: (event) => resumedEvents.push(event) },
  );
  assert.deepEqual(resumed.initialEvents, []);

  // Normal PTY output still reaches direct subscribers, attachments, and replay.
  pty.processes[0].emit("ok");
  assert.deepEqual(textEvents(direct.drain()), [
    { position: 0, nextPosition: 2, text: "ok", replay: false },
  ]);
  assert.deepEqual(textEvents(attachmentEvents), []);
  assert.deepEqual(textEvents(resumedEvents), [
    { position: 0, nextPosition: 2, text: "ok", replay: false },
  ]);
  assert.deepEqual(textEvents(serviceEvents), [
    { position: 0, nextPosition: 2, text: "ok", replay: false },
  ]);

  resumed.detach();
  const replayedEvents = [];
  const replayed = adapter.resume(
    { clientId: "client-b", identity, authorization: read, fromPosition: 0 },
    { onEvent: (event) => replayedEvents.push(event) },
  );
  assert.deepEqual(textEvents(replayed.initialEvents), [
    { position: 0, nextPosition: 2, text: "ok", replay: true },
  ]);
  assert.deepEqual(textEvents(replayedEvents), [
    { position: 0, nextPosition: 2, text: "ok", replay: true },
  ]);
  replayed.detach();
  direct.close();
  unsubscribeService();
});
