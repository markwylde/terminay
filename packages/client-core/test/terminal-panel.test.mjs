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
    emit(payload, body) {
      for (const listener of listeners) listener({ subscriptionId: "terminal-sub", revision: 1, cursor: "1", event: "terminal", payload, ...(body === undefined ? {} : { body }) });
    },
    async command(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "terminal.attach" || operation === "terminal.resume") {
        return { attachmentId: "panel-attachment", fromPosition: payload.fromPosition, position: payload.fromPosition, events: payload.fromPosition === 0 ? [output(0, new Uint8Array([0, 0xff, 0x1b]), true)] : [] };
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
  await panel.ack(6);
  await panel.kill("SIGTERM");
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

test("terminal panel adapter rejects unsafe dimensions and input after detach", async () => {
  const source = transport();
  const client = new TerminayTerminalClient(source);
  const panel = await new TerminayTerminalPanelClient(client).attach({ ...identity, clientId: "panel-client" });
  await assert.rejects(panel.resize({ cols: 1, rows: 40 }), /dimensions/);
  await panel.detach();
  await assert.rejects(panel.write("late input"), /closed/);
});
