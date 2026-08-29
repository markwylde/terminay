import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAPPING_VERSION, createGrokRecordMapper } from "../dist/index.js";

test("v0.1 is deliberately forward-compatible and malformed/content records fail closed", async () => {
  assert.equal(MAPPING_VERSION, "0.1");
  const fixture = (await readFile(new URL("../fixtures/v0.1/basic.jsonl", import.meta.url), "utf8")).trim().split("\n").map(JSON.parse);
  const events = [];
  const publish = new Proxy({}, { get: (_target, name) => (event) => events.push({ kind: name, ...event }) });
  const context = { binding: { providerSessionId: "01a04dd9-f9f9-77c0-9ea0-8a8f627ea29c" }, journal: { role: "root" }, publish };
  const map = createGrokRecordMapper();
  for (const record of fixture) map(record, context);
  map({ type: "unknown_future_event", output: "private" }, context);
  map({ type: "turn_started", session_id: "wrong", turn_number: 9, model_id: "private" }, context);
  map({ type: "assistant", content: "private" }, context);
  assert.equal(events.length, 9);
  assert.equal(JSON.stringify(events).includes("private"), false);
});
