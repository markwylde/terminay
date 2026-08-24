import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAPPING_VERSION, mapCodexRecord } from "../dist/index.js";

test("v0.1 is deliberately forward-compatible and malformed/content records fail closed", async () => {
  assert.equal(MAPPING_VERSION, "0.1");
  const fixture = (await readFile(new URL("../fixtures/v0.1/basic.jsonl", import.meta.url), "utf8")).trim().split("\n").map(JSON.parse);
  const events = [];
  const publish = new Proxy({}, { get: (_target, name) => (event) => events.push({ kind: name, ...event }) });
  const context = { binding: { providerSessionId: "fixture-session-v01" }, publish };
  for (const record of fixture) mapCodexRecord(record, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "unknown_future_event", output: "private" } }, context);
  mapCodexRecord({ type: "response_item", payload: { type: "message", content: "private" } }, context);
  mapCodexRecord({ type: "session_meta", payload: { id: "wrong", originator: "codex-tui", source: "cli" } }, context);
  assert.equal(events.length, 6);
  assert.equal(JSON.stringify(events).includes("private"), false);
});
