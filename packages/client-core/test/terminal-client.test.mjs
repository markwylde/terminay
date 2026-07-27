import test from "node:test";
import assert from "node:assert/strict";
import { TerminayTerminalClient } from "../dist/index.js";

const identity = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };

function output(position, text, replay = false) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { ...identity, type: "output", position, nextPosition: position + bytes.length, bytes: btoa(binary), replay };
}

function fakeTransport() {
  const calls = [];
  const listeners = new Set();
  let attachment = 0;
  return {
    calls,
    emit(payload, body) {
      for (const listener of listeners) listener({ subscriptionId: "sub", revision: 1, cursor: "1", event: "terminal", payload, ...(body === undefined ? {} : { body }) });
    },
    async command(operation, payload) {
      calls.push([operation, payload]);
      if (operation === "terminal.attach" || operation === "terminal.resume") {
        attachment += 1;
        return { attachmentId: `attachment-${attachment}`, fromPosition: payload.fromPosition, position: payload.fromPosition, events: payload.fromPosition === 0 ? [output(0, "abc", true)] : [] };
      }
      return null;
    },
    async subscribe() {
      return {
        id: "sub",
        fromRevision: 0,
        unsubscribe: async () => { listeners.clear(); },
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      };
    },
  };
}

test("TerminayTerminalClient attaches, detaches, resumes, and suppresses duplicate output", async () => {
  const transport = fakeTransport();
  const client = new TerminayTerminalClient(transport);
  const first = await client.attach({ ...identity, clientId: "client-a" });
  assert.equal(first.position, 3);
  assert.deepEqual([...first.initialEvents].map((event) => event.type), ["output"]);

  const events = [];
  first.onEvent((event) => events.push(event));
  transport.emit(output(0, "abc", true));
  transport.emit(output(3, "def"));
  assert.deepEqual(events.map((event) => new TextDecoder().decode(event.bytes)), ["def"]);
  assert.equal(first.position, 6);

  await first.ack(6);
  await first.detach();
  assert.equal(first.closed, true);
  assert.equal(transport.calls.at(-1)[0], "terminal.detach");

  const resumed = await client.resume({ ...identity, clientId: "client-a", fromPosition: 0 });
  assert.equal(resumed.position, 6);
  const resumedEvents = [];
  resumed.onEvent((event) => resumedEvents.push(event));
  transport.emit(output(3, "def", true));
  const rawBody = new TextEncoder().encode("ghi");
  transport.emit({ ...identity, type: "output", position: 6, nextPosition: 9 }, rawBody);
  assert.deepEqual(resumedEvents.map((event) => new TextDecoder().decode(event.bytes)), ["ghi"]);
  assert.equal(transport.calls.filter(([operation]) => operation === "terminal.resume").at(-1)[1].fromPosition, 6);
  await resumed.detach();
});

test("TerminayTerminalClient rejects terminal events that cross the identity boundary", async () => {
  const transport = fakeTransport();
  const client = new TerminayTerminalClient(transport);
  const attachment = await client.attach({ ...identity, clientId: "client-a" });
  attachment.onEvent(() => {});
  assert.throws(() => transport.emit({ ...output(3, "x"), projectId: "project-other" }), /identity mismatch/);
  await attachment.detach();
});
