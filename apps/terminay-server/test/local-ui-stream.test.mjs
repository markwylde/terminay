import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLocalUiServer } from "../dist/index.js";

test("local UI stream authenticates upgrade and delegates to protocol core", async () => {
  const token = "local-stream-token-123456";
  let accepted = 0;
  let opened = 0;
  const server = createLocalUiServer({
    serverId: "stream-server",
    serverVersion: "1.0.0",
    authToken: token,
    protocolCore: {
      accept: (transport) => {
        accepted += 1;
        return {
          state: "new",
          connectionId: "stream-connection",
          client: undefined,
          start: async () => {
            await transport.open();
            opened += 1;
          },
          process: async () => {},
          subscribe: async () => ({ kind: "events", fromRevision: 0, events: [], currentRevision: 0 }),
          close: async () => transport.close(),
        };
      },
    },
  });
  const address = await server.start();
  try {
    const notAppQuery = await fetch(`${address.origin}/protocol/query`, { method: "POST" });
    assert.equal(notAppQuery.status, 405);

    const socket = new WebSocket(
      `${address.origin.replace(/^http:/, "ws:")}/protocol/stream`,
      ["terminay.v1", `terminay.auth.${base64url(token)}`],
    );
    await once(socket, "open");
    assert.equal(socket.protocol, "terminay.v1");
    await waitFor(() => opened === 1);
    assert.equal(accepted, 1);
    socket.close();
  } finally {
    await server.stop();
  }
});

test("local UI stream reports a contained protocol connection failure", async () => {
  const token = "local-stream-token-123456";
  const failures = [];
  const server = createLocalUiServer({
    serverId: "stream-server",
    serverVersion: "1.0.0",
    authToken: token,
    onConnectionError: (error) => failures.push(error),
    protocolCore: {
      accept: () => ({
        state: "new",
        connectionId: "stream-connection",
        client: undefined,
        start: async () => { throw new Error("contained stream failure"); },
        process: async () => {},
        subscribe: async () => ({ kind: "events", fromRevision: 0, events: [], currentRevision: 0 }),
        close: async () => {},
      }),
    },
  });
  const address = await server.start();
  try {
    const socket = new WebSocket(
      `${address.origin.replace(/^http:/, "ws:")}/protocol/stream`,
      ["terminay.v1", `terminay.auth.${base64url(token)}`],
    );
    await once(socket, "open");
    await waitFor(() => failures.length === 1);
    assert.match(failures[0].message, /contained stream failure/u);
    socket.close();
  } finally {
    await server.stop();
  }
});

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once("error", reject);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
