import assert from "node:assert/strict";
import test from "node:test";
import { createOmpRecordMapper } from "../dist/index.js";

test("malformed, title-slot, synthetic and unsupported permission records emit nothing", async () => {
  const events = [];
  const map = createOmpRecordMapper();
  const publish = new Proxy({}, { get: (_, key) => (event) => events.push({ kind: key, ...event }) });
  const context = { binding: { providerSessionId: "root" }, publish, signal: { aborted: false, throwIfAborted() {} } };
  for (const record of [
    null,
    [],
    { type: "title", title: "not a lifecycle record" },
    { type: "message", id: "synthetic", message: { role: "user", synthetic: true, content: "do not show" } },
    { type: "custom", customType: "approval_requested", data: { id: "secret" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "private" }] } },
  ]) await map(record, context);
  assert.deepEqual(events, []);
});
