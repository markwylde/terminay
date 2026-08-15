import test from "node:test";
import assert from "node:assert/strict";
import { TerminayTerminalClient, TerminayTerminalPanelClient } from "../dist/index.js";

const identity = { serverId: "server-panel", projectId: "project-panel", sessionId: "session-panel" };

function encoded(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function output(position, bytes, replay = false) {
  return {
    ...identity,
    type: "output",
    position,
    nextPosition: position + bytes.length,
    bytes: encoded(bytes),
    replay,
  };
}

function transport() {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    emitRaw(payload, body) {
      for (const listener of listeners) listener({
        subscriptionId: "terminal-sub",
        revision: 1,
        cursor: "1",
        event: "terminal",
        payload,
        ...(body === undefined ? {} : { body }),
      });
    },
    emit(payload, body) {
      for (const listener of listeners) listener({
        subscriptionId: "terminal-sub",
        revision: 1,
        cursor: "1",
        event: "terminal",
        payload: { attachmentId: "panel-attachment", clientId: "panel-client", ...payload },
        ...(body === undefined ? {} : { body }),
      });
    },
    async command(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "terminal.attach" || operation === "terminal.resume") {
        return { attachmentId: "panel-attachment", presentation: { ...payload.identity, revision: 0, role: "read_only" }, fromPosition: payload.fromPosition, position: payload.fromPosition, events: payload.fromPosition === 0 ? [output(0, new Uint8Array([0, 0xff, 0x1b]), true)] : [] };
      }
      return { type: "command_result", commandId: `command-${calls.length}`, correlationId: `correlation-${calls.length}`, ok: true };
    },
    async subscribe() {
      return {
        id: "terminal-sub",
        fromRevision: 0,
        unsubscribe: async () => { listeners.clear(); },
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      };
    },
  };
}

test("terminal panel ignores journal payloads that do not claim its exact attachment", async () => {
  const source = transport();
  const panel = await new TerminayTerminalPanelClient(new TerminayTerminalClient(source)).attach({ ...identity, clientId: "panel-client" });

  assert.doesNotThrow(() => source.emitRaw(null));
  assert.doesNotThrow(() => source.emitRaw({ type: "auxiliary-terminal-event" }));
  assert.doesNotThrow(() => source.emitRaw({ ...identity, type: "presentation", attachmentId: "other-attachment", clientId: "other-client", revision: 1, role: "controller" }));
  assert.throws(() => source.emit({ ...identity, type: "unknown-terminal-event" }), /unknown terminal event type/);
  await panel.detach();
});

test("terminal panel adapter preserves raw bytes and routes input, resize, kill, ack, and detach", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });

  assert.deepEqual([...panel.initialEvents[0].bytes], [0, 0xff, 0x1b]);
  const outputs = [];
  const exits = [];
  const resyncs = [];
  panel.onOutput((event) => outputs.push([...event.bytes]));
  panel.onExit((event) => exits.push(event.exitCode));
  panel.onResync((event) => resyncs.push(event.replayFrom));

  source.emit({ ...output(3, new Uint8Array([0x00, 0xc3, 0xa9])) });
  source.emit({ ...identity, type: "exit", exitCode: 0, signal: null });
  source.emit({ ...identity, type: "resync_required", fromPosition: 0, replayFrom: 3, outputPosition: 8 });
  assert.deepEqual(outputs, [[0, 0xc3, 0xa9]]);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(resyncs, [3]);

  await panel.write(new Uint8Array([0, 0xff]));
  await panel.resize({ cols: 120, rows: 40 });
  // A resync invalidates the unacknowledged tail. Only the retained replay
  // boundary is safe to acknowledge until the panel reattaches.
  await panel.ack(3);
  await panel.kill("SIGTERM");
  await panel.detach();
  await panel.detach();

  assert.deepEqual(source.calls.slice(1).map(([operation]) => operation), ["terminal.input", "terminal.resize", "terminal.ack", "terminal.kill", "terminal.detach"]);
  assert.equal(source.calls[1][1].dataBase64, encoded(new Uint8Array([0, 0xff])));
  assert.deepEqual(source.calls[2][1], {
    attachmentId: "panel-attachment",
    clientId: "panel-client",
    identity,
    cols: 120,
    rows: 40,
  });
  assert.equal(panel.closed, true);
});

test("terminal panel consumes a live output frame body without base64 bytes", async () => {
  const source = transport();
  const panel = await new TerminayTerminalPanelClient(new TerminayTerminalClient(source)).attach({ ...identity, clientId: "panel-client" });
  const outputs = [];
  panel.onOutput((event) => outputs.push([...event.bytes]));

  const wire = output(panel.position, new Uint8Array([0, 0xff, 0x1b]));
  delete wire.bytes;
  source.emit(wire, new Uint8Array([0, 0xff, 0x1b]));

  assert.deepEqual(outputs, [[0, 0xff, 0x1b]]);
  await panel.detach();
});

test("terminal panel adapter rejects unsafe dimensions and input after detach", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });
  await assert.rejects(panel.resize({ cols: 1, rows: 40 }), /dimensions/);
  await panel.detach();
  await assert.rejects(panel.write("late input"), /closed/);
});

test("terminal panel adapter honors an explicit display replay cursor and disposes listeners", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panelClient = new TerminayTerminalPanelClient(client);
  const first = await panelClient.attach({ ...identity, clientId: "panel-client" });
  await first.ack(3);
  await first.detach();

  const resumed = await panelClient.resume({ ...identity, clientId: "panel-client", fromPosition: 0 });
  const outputs = [];
  const stop = resumed.onOutput((event) => outputs.push([...event.bytes]));
  stop();
  source.emit(output(3, new Uint8Array([7, 8, 9])));

  assert.deepEqual(outputs, []);
  assert.equal(
    source.calls.filter(([operation]) => operation === "terminal.resume").at(-1)[1].fromPosition,
    0,
  );
  await resumed.detach();
});

test("terminal panel forwards raw replay and filters output, exit, and resync listeners", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });

  assert.equal(panel.initialEvents.length, 1);
  assert.equal(panel.initialEvents[0].type, "output");
  assert.equal(panel.initialEvents[0].replay, true);
  assert.deepEqual([...panel.initialEvents[0].bytes], [0, 0xff, 0x1b]);

  const outputs = [];
  const exits = [];
  const resyncs = [];
  const events = [];
  panel.onEvent((event) => events.push(event));
  panel.onOutput((event) => outputs.push({ bytes: [...event.bytes], position: event.position }));
  panel.onExit((event) => exits.push({ exitCode: event.exitCode, signal: event.signal }));
  panel.onResync((event) => resyncs.push({ replayFrom: event.replayFrom, outputPosition: event.outputPosition }));

  source.emit(output(3, new Uint8Array([0x00, 0xc3, 0xa9])));
  source.emit({ ...identity, type: "exit", exitCode: 7, signal: 15 });
  source.emit({ ...identity, type: "resync_required", fromPosition: 6, replayFrom: 9, outputPosition: 12 });
  source.emit({ ...identity, type: "dimensions", cols: 44, rows: 16 });

  assert.deepEqual(outputs, [{ bytes: [0x00, 0xc3, 0xa9], position: 3 }]);
  assert.deepEqual(exits, [{ exitCode: 7, signal: 15 }]);
  assert.deepEqual(resyncs, [{ replayFrom: 9, outputPosition: 12 }]);
  assert.deepEqual(events.at(-1), { ...identity, type: "dimensions", cols: 44, rows: 16 });
  await panel.detach();
});

test("terminal panel acknowledges only observed output and preserves acknowledgement order", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });

  await assert.rejects(panel.ack(panel.position + 1), /ahead/);
  await panel.ack(panel.position);
  source.emit(output(3, new Uint8Array([0x01, 0x02, 0x03])));
  await panel.ack(panel.position);

  const acknowledgements = source.calls
    .filter(([operation]) => operation === "terminal.ack")
    .map(([, payload]) => payload.position);
  assert.deepEqual(acknowledgements, [3, 6]);
  await panel.detach();
});

test("terminal panel coalesces a rendered output burst into one cumulative acknowledgement", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });

  const acknowledgements = [];
  for (let index = 0; index < 200; index += 1) {
    source.emit(output(panel.position, new Uint8Array([index & 0xff])));
    acknowledgements.push(panel.ack(panel.position));
  }
  await Promise.all(acknowledgements);

  const calls = source.calls.filter(([operation]) => operation === "terminal.ack");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].position, 203);
  await panel.detach();
});

test("terminal panel bounds acknowledgement concurrency and advances to output rendered in flight", async () => {
  const source = transport();
  const originalCommand = source.command.bind(source);
  let releaseFirstAcknowledgement;
  const firstAcknowledgementBlocked = new Promise((resolve) => { releaseFirstAcknowledgement = resolve; });
  let acknowledgementCalls = 0;
  source.command = async (operation, payload) => {
    if (operation === "terminal.ack") {
      acknowledgementCalls += 1;
      source.calls.push([operation, payload]);
      if (acknowledgementCalls === 1) await firstAcknowledgementBlocked;
      return { type: "command_result", commandId: `ack-${acknowledgementCalls}`, correlationId: `ack-${acknowledgementCalls}`, ok: true };
    }
    return originalCommand(operation, payload);
  };
  const panel = await new TerminayTerminalPanelClient(new TerminayTerminalClient(source)).attach({ ...identity, clientId: "panel-client" });

  source.emit(output(3, new Uint8Array([1])));
  const first = panel.ack(4);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(acknowledgementCalls, 1);

  const later = [];
  for (let position = 4; position < 104; position += 1) {
    source.emit(output(position, new Uint8Array([1])));
    later.push(panel.ack(position + 1));
  }
  assert.equal(acknowledgementCalls, 1);
  releaseFirstAcknowledgement();
  await Promise.all([first, ...later]);

  const positions = source.calls
    .filter(([operation]) => operation === "terminal.ack")
    .map(([, payload]) => payload.position);
  assert.deepEqual(positions, [4, 104]);
  await panel.detach();
});

test("terminal panel detach is idempotent and closes all lifecycle commands", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });

  await Promise.all([panel.detach(), panel.detach(), panel.detach()]);
  assert.equal(panel.closed, true);
  assert.equal(source.calls.filter(([operation]) => operation === "terminal.detach").length, 1);
  await assert.rejects(panel.ack(0), /closed/);
  await assert.rejects(panel.write(new Uint8Array([0x01])), /closed/);
  await assert.rejects(panel.resize({ cols: 120, rows: 40 }), /closed/);
  await assert.rejects(panel.kill(), /closed/);
  await panel.detach();
  assert.equal(source.calls.filter(([operation]) => operation === "terminal.detach").length, 1);
});

test("terminal panel resume honors an explicit stale display cursor", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const adapter = new TerminayTerminalPanelClient(client);
  const first = await adapter.attach({ ...identity, clientId: "panel-client" });

  source.emit(output(3, new Uint8Array([0x01, 0x02, 0x03])));
  assert.equal(first.position, 6);
  await first.detach();

  const resumed = await adapter.resume({ ...identity, clientId: "panel-client", fromPosition: 0 });
  const resumeCall = source.calls.filter(([operation]) => operation === "terminal.resume").at(-1);
  assert.equal(resumeCall[1].fromPosition, 0);
  assert.equal(resumed.position, 3);
  assert.equal(resumed.initialEvents.length, 1);
  await resumed.detach();
});

test("terminal panel retry resumes from the retained replay boundary after resync", async () => {
  const calls = [];
  const listeners = new Set();
  const source = {
    async command(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "terminal.attach") {
        return {
          attachmentId: "resync-attachment",
          fromPosition: payload.fromPosition,
          position: 900,
          events: [{ ...identity, type: "resync_required", fromPosition: payload.fromPosition, replayFrom: 500, outputPosition: 900 }],
        };
      }
      if (operation === "terminal.resume") {
        return { attachmentId: "resumed-attachment", fromPosition: payload.fromPosition, position: payload.fromPosition, events: [] };
      }
      return { type: "command_result", commandId: "command", correlationId: "correlation", ok: true };
    },
    async subscribe() { return { id: "terminal-sub", fromRevision: 0, unsubscribe: async () => { listeners.clear(); }, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); } }; },
  };
  const client = new TerminayTerminalClient(source);
  const first = await client.attach({ ...identity, clientId: "panel-client" });
  assert.equal(first.position, 500);
  await first.detach();
  await client.resume({ ...identity, clientId: "panel-client" });
  assert.equal(calls.filter(([operation]) => operation === "terminal.resume").at(-1)[1].fromPosition, 500);
});

test("fresh-surface resync cannot lower the shared reconnect watermark", async () => {
  const calls = [];
  let attachment = 0;
  const source = {
    async command(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "terminal.attach") {
        return {
          attachmentId: `attachment-${++attachment}`,
          fromPosition: 0,
          position: 900,
          events: [output(0, new Uint8Array(900), true)],
        };
      }
      if (operation === "terminal.resume" && payload.fromPosition === 0) {
        return {
          attachmentId: `attachment-${++attachment}`,
          fromPosition: 0,
          position: 900,
          events: [{ ...identity, type: "resync_required", fromPosition: 0, replayFrom: 500, outputPosition: 900 }],
        };
      }
      return {
        attachmentId: `attachment-${++attachment}`,
        fromPosition: payload.fromPosition,
        position: payload.fromPosition,
        events: [],
      };
    },
    async subscribe() {
      return { id: "terminal-sub", fromRevision: 0, unsubscribe: async () => {}, onEvent() { return () => {}; } };
    },
  };
  const client = new TerminayTerminalClient(source);
  const first = await client.attach({ ...identity, clientId: "panel-client" });
  assert.equal(first.position, 900);
  await first.detach();

  const moved = await client.resume({ ...identity, clientId: "panel-client", fromPosition: 0 });
  assert.equal(moved.position, 500);
  await moved.detach();

  await client.resume({ ...identity, clientId: "panel-client" });
  assert.equal(calls.filter(([operation]) => operation === "terminal.resume").at(-1)[1].fromPosition, 900);
});
