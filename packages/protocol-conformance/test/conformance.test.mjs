import test from "node:test";
import assert from "node:assert/strict";
import { createInMemoryTransportPair, createScriptedTransportPair } from "../dist/index.js";
import { TerminayClient } from "@terminay/client-core";
import { decodeFrame, encodeFrame } from "@terminay/protocol";

test("in-memory transport delivers bounded copied frames and closes", async () => {
  const pair = createInMemoryTransportPair({ capacityBytes: 128 });
  await pair.open();
  const original = new Uint8Array([1, 2, 3]);
  await pair.client.send(original);
  original[0] = 9;
  const received = await pair.server.incoming[Symbol.asyncIterator]().next();
  assert.deepEqual([...received.value], [1, 2, 3]);
  await pair.client.close();
  assert.equal(pair.client.state, "closed");
});

test("scripted transport can deterministically drop and delay sends", async () => {
  const pair = createScriptedTransportPair({ autoOpen: true, left: { dropEveryNthSend: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await pair.client.send(new Uint8Array([1]));
  await pair.client.send(new Uint8Array([2]));
  const iterator = pair.server.incoming[Symbol.asyncIterator]();
  assert.deepEqual([...(await iterator.next()).value], [1]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pair.server.bufferedBytes, 0);
  await pair.server.close();
  await pair.client.close();
});

test("the same framed transport supports client handshake and correlated query", async () => {
  const pair = createInMemoryTransportPair();
  await pair.open();
  const serverLoop = (async () => {
    for await (const bytes of pair.server.incoming) {
      const { envelope } = decodeFrame(bytes);
      if (envelope.type === "client_hello") {
        await pair.server.send(encodeFrame({ type: "server_hello", protocolVersion: 1, serverId: "server-test", serverVersion: "1.0.0", clientId: envelope.clientId, capabilities: ["workspace"], limits: envelope.limits, authScope: "read" }));
      } else if (envelope.type === "query") {
        await pair.server.send(encodeFrame({ type: "query_result", queryId: envelope.queryId, ok: true, result: { ok: true } }));
      }
    }
  })();
  const client = new TerminayClient({ transport: pair.client });
  const hello = await client.connect();
  assert.equal(hello.serverId, "server-test");
  const result = await client.query("workspace.snapshot");
  assert.deepEqual(result.result, { ok: true });
  await client.close();
  await serverLoop;
});
