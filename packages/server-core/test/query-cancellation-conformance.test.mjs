import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { LANGUAGE_CAPABILITY, LANGUAGE_OPERATIONS } from "@terminay/protocol";
import { ServerConnection } from "../dist/index.js";

// The real client against the real server connection: an aborted query has to
// reach the server as a cancel envelope and abort the handler's own signal,
// exactly as an aborted command always did.
test("an aborted query cancels the server handler and delivers no result", async () => {
  const observed = {};
  const pair = createInMemoryTransportPair();
  await pair.open();
  const server = new ServerConnection(pair.server, {
    serverId: "language-server",
    serverVersion: "test",
    capabilities: [LANGUAGE_CAPABILITY],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
    queries: {
      [LANGUAGE_OPERATIONS.completion]: ({ context }) =>
        new Promise((resolve) => {
          observed.started = true;
          context.signal.addEventListener(
            "abort",
            () => {
              observed.aborted = true;
              resolve({ items: [], isIncomplete: false, isTruncated: false });
            },
            { once: true },
          );
        }),
    },
  });
  const serverTask = server.start();
  const client = new TerminayClient({ transport: pair.client });
  const hello = await client.connect();
  assert.ok(hello.capabilities.includes(LANGUAGE_CAPABILITY));
  const controller = new AbortController();
  const query = client.query(
    LANGUAGE_OPERATIONS.completion,
    { projectId: "default", path: "main.ts", revision: 1, position: { line: 0, character: 0 } },
    { signal: controller.signal },
  );
  const delivered = query.then(
    (value) => ({ delivered: true, value }),
    (error) => ({ delivered: false, error }),
  );
  for (let attempt = 0; attempt < 100 && observed.started !== true; attempt += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.started, true);
  controller.abort();
  const outcome = await delivered;
  assert.equal(outcome.delivered, false);
  for (let attempt = 0; attempt < 100 && observed.aborted !== true; attempt += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.aborted, true);
  await client.close();
  await server.close();
  await serverTask.catch(() => undefined);
});
