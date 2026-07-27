import test from "node:test";
import assert from "node:assert/strict";
import { createSupportBundle } from "../dist/diagnostics.js";

test("support bundles are opt-in, bounded, and redact credentials", () => {
  const input = {
    serverId: "server-a",
    version: "1.0.0",
    phase: "ready",
    generatedAt: 10,
    health: { uptimeMs: 42, apiToken: "hidden", nested: { password: "hidden", phase: "ready" } },
    logs: ["phase=ready token=hidden", "ordinary diagnostic"],
  };
  const withoutLogs = createSupportBundle(input);
  assert.equal("logs" in withoutLogs, false);
  const withLogs = createSupportBundle(input, { includeLogs: true });
  assert.equal(withLogs.logs?.length, 2);
  assert.equal(JSON.stringify(withLogs).includes("hidden"), false);
  assert.throws(() => createSupportBundle(input, { includeLogs: true, maxBytes: 10 }), /size/);
});
