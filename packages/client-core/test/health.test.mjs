import assert from "node:assert/strict";
import test from "node:test";
import { SERVER_HEALTH_OPERATION, ServerHealthClient } from "../dist/index.js";

test("ServerHealthClient queries and validates the canonical readiness snapshot", async () => {
  const calls = [];
  const client = new ServerHealthClient({
    async query(operation, payload) {
      calls.push({ operation, payload });
      return { phase: "ready", serverId: "server-a", version: "1.2.3", ready: true, uptimeMs: 42 };
    },
  });
  assert.deepEqual(await client.snapshot(), {
    phase: "ready", serverId: "server-a", version: "1.2.3", ready: true, uptimeMs: 42,
  });
  assert.deepEqual(calls, [{ operation: SERVER_HEALTH_OPERATION, payload: {} }]);
});

test("ServerHealthClient rejects malformed or unbounded host responses", async () => {
  for (const value of [
    null,
    { phase: "ready", serverId: "server-a", version: "1", ready: "yes" },
    { phase: "x".repeat(65), serverId: "server-a", version: "1", ready: true },
    { phase: "ready", serverId: "server-a", version: "1", ready: true, uptimeMs: -1 },
  ]) {
    const client = new ServerHealthClient({ query: async () => value });
    await assert.rejects(() => client.snapshot(), /server health/);
  }
});
