import assert from "node:assert/strict";
import test from "node:test";
import { cursorAgentProvider } from "../dist/index.js";

test("Cursor v0.1 recognizes only the CLI and its versioned Node wrapper", () => {
  assert.equal(cursorAgentProvider.mappingVersion, "0.1");
  assert.equal(cursorAgentProvider.matchesForeground({ executableName: "agent" }), true);
  assert.equal(cursorAgentProvider.matchesForeground({ executableName: "/usr/local/bin/cursor-agent" }), true);
  assert.equal(cursorAgentProvider.matchesForeground({ executableName: "node", arguments: ["/Users/me/.local/share/cursor-agent/versions/2026.08.11/index.js"] }), true);
  assert.equal(cursorAgentProvider.matchesForeground({ executableName: "node", arguments: ["server.js"] }), false);
  assert.equal(cursorAgentProvider.matchesForeground({ executableName: "claude" }), false);
});

test("Cursor refuses an environment without every declared observation capability", async () => {
  const result = await cursorAgentProvider.observe({
    capabilities: new Set(["process-observation"]),
    signal: { aborted: false, throwIfAborted() {} },
    observation: {},
  });
  assert.deepEqual(result, { state: "unavailable", reason: "environment-capability-missing" });
});
