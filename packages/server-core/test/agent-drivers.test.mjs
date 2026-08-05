import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { codexV01Driver, createAgentDriverRegistry } from "../dist/activity/agentDrivers.js";

async function fixture(version) {
  const text = await readFile(new URL(`./fixtures/codex/${version}/basic.jsonl`, import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("Codex v0.1 rollout records normalize through the v0.1 mapping", async () => {
  const registry = createAgentDriverRegistry();
  const records = await fixture("v0.1");
  const inspected = registry.inspectSession("codex", records[0]);
  assert.equal(inspected?.session.providerSessionId, "fixture-session-v01");
  const resolved = registry.resolve("codex", inspected?.session.providerVersion);
  assert.equal(resolved?.mappingVersion, "0.1");
  const events = records.map((record, index) => registry.normalize("codex", inspected?.session.providerVersion, record, {
    activationTerminalSessionId: "terminal-1", providerSessionId: inspected?.session.providerSessionId,
    sequence: index + 1, occurredAt: index + 1,
  })).filter(Boolean);
  assert.deepEqual(events.map(({ kind }) => kind), ["session.started", "turn.started", "tool.started", "tool.finished", "wait.started", "agent.done"]);
});

test("newer and older Codex releases resolve permissively to the closest mapping", () => {
  const registry = createAgentDriverRegistry();
  assert.equal(registry.resolve("codex", "0.2.0")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.146.0")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.0.5")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("claude-code", "1.0.0"), undefined);
});

test("the greatest compatible provider/version mapping wins", () => {
  const codexV02Driver = { ...codexV01Driver, mappingVersion: "0.2" };
  const registry = createAgentDriverRegistry([codexV01Driver, codexV02Driver]);
  assert.equal(registry.resolve("codex", "0.1.9")?.mappingVersion, "0.1");
  assert.equal(registry.resolve("codex", "0.2.0")?.mappingVersion, "0.2");
  assert.equal(registry.resolve("codex", "0.5.0")?.mappingVersion, "0.2");
  assert.equal(registry.resolve("codex", "0.0.1")?.mappingVersion, "0.1");
});

test("driver ignores content-bearing rollout records", () => {
  const registry = createAgentDriverRegistry();
  const event = registry.normalize("codex", "0.1.0", {
    type: "response_item", payload: { type: "message", content: "secret user content" },
  }, { activationTerminalSessionId: "terminal-1", providerSessionId: "session-1", sequence: 1, occurredAt: 1 });
  assert.equal(event, null);
});
