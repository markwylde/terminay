import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, "package.json"), "utf8")).terminay;
const loaded = await import(pathToFileURL(join(here, "extension.js")));

function journal(records) {
  return fixtureTerminal({
    foregroundExecutable: "example-agent",
    files: { "/home/test/.example-agent/sessions/current.jsonl": records },
  });
}

test("example provider maps a complete journal through the public harness", async (t) => {
  const harness = await createAgentExtensionHarness(loaded.default, { manifest });
  t.after(() => harness.dispose());
  await harness.observe(journal([
    { type: "session", id: "sess-1", title: "Example task" },
    { type: "metadata", title: "Renamed", model: { id: "model-1", displayName: "Example" } },
    { type: "user_message", turnId: "turn-1", text: "Do the work" },
    { type: "tool_started", toolId: "tool-1", toolName: "read" },
    { type: "subagent_started", childId: "child-1", title: "Research" },
    { type: "subagent_started", index: 0, title: "Unidentified" },
    { type: "subagent_done", childId: "child-1" },
    { type: "tool_finished", toolId: "tool-1" },
    { type: "turn_completed" },
  ]));
  assert.deepEqual(harness.events().map((event) => event.kind), [
    "session.started",
    "agent.metadata",
    "turn.started",
    "tool.started",
    "subagent.started",
    "subagent.done",
    "tool.finished",
    "agent.done",
  ]);
  assert.equal(harness.events().some((event) => event.kind === "subagent.started" && event.title === "Unidentified"), false);
  const projection = harness.projection();
  assert.equal(projection.done, true);
  assert.equal(projection.title, "Renamed");
});

test("example provider emits nothing when a required capability is missing", async (t) => {
  const harness = await createAgentExtensionHarness(loaded.default, { manifest });
  t.after(() => harness.dispose());
  await harness.observe(fixtureTerminal({
    foregroundExecutable: "example-agent",
    capabilities: ["process-observation"],
    files: { "/home/test/.example-agent/sessions/current.jsonl": [{ type: "session", id: "sess-1", title: "Ignored" }] },
  }));
  assert.deepEqual(harness.events(), []);
  assert.deepEqual(harness.observation(), { state: "unavailable", reason: "environment-capability-missing" });
});
