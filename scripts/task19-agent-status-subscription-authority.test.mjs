import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("Task 19 agent status rejects query-command-only compatibility transports", async () => {
  const source = await fs.readFile(new URL("../packages/client-core/src/agentStatus.ts", import.meta.url), "utf8");
  assert.match(source, /subscribe: \(event: string, listener: \(snapshot: AgentClientSnapshot\) => void\)/u);
  assert.doesNotMatch(source, /subscribe\?: \(event: string, listener: \(snapshot: AgentClientSnapshot\) => void\)/u);
  assert.match(source, /agent status subscriptions are required on this transport/u);
  assert.doesNotMatch(source, /transport\?\.subscribe/u);
});
