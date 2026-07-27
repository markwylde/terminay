import test from "node:test";
import assert from "node:assert/strict";
import { createHostCapabilityProvider } from "../dist/index.js";

test("host capabilities are normalized and enforced", () => {
  const host = createHostCapabilityProvider({ clipboard: true, nativeWindows: false });
  assert.equal(host.has("clipboard"), true);
  assert.equal(host.has("nativeWindows"), false);
  assert.throws(() => host.require("nativeWindows"), /unavailable/);
});
