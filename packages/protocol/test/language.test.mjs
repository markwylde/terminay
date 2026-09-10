import test from "node:test";
import assert from "node:assert/strict";
import { truncateLanguageResult } from "../dist/index.js";

test("a result that fits is returned unchanged", () => {
  const result = { items: [{ label: "greet" }], isTruncated: false };
  assert.deepEqual(truncateLanguageResult(result, "items"), result);
});

test("a result over the cap drops trailing items and is marked truncated", () => {
  const items = Array.from({ length: 64 }, (_, index) => ({ label: `item-${index}`.padEnd(64, "x") }));
  const truncated = truncateLanguageResult({ items, isTruncated: false }, "items", 512);
  assert.ok(truncated.items.length < items.length);
  assert.equal(truncated.isTruncated, true);
  assert.ok(JSON.stringify(truncated).length <= 512);
});

test("a result whose fixed fields alone exceed the cap returns empty and marked, never throws", () => {
  const result = { path: "a.ts".padEnd(400, "b"), items: [{ label: "greet" }], isTruncated: false };
  const truncated = truncateLanguageResult(result, "items", 64);
  assert.deepEqual(truncated.items, []);
  assert.equal(truncated.isTruncated, true);
  assert.equal(truncated.path, result.path);
});
