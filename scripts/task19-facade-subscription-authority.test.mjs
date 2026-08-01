import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Task 19 generic facade never turns a missing canonical subscription into stale renderer authority", async () => {
  const source = await readFile("packages/client-core/src/queryCommand.ts", "utf8");

  assert.match(source, /canonical event subscriptions are unavailable on this transport/u);
  assert.doesNotMatch(source, /if \(typeof subscribe !== "function"\) return \(\) => undefined/u);
  assert.match(source, /if \(typeof subscribe !== "function"\) \{\s*throw new Error/u);
});
