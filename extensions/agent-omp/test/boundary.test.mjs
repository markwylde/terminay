import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension source imports only the public SDK and Node built-ins", async () => {
  const source = await readFile(new URL("../src/ompAgent.ts", import.meta.url), "utf8");
  assert.match(source, /from "@terminay\/extension-api"/);
  assert.equal(/from ["'][^"']*(?:packages\/server-core|electron|client-core|src\/activity)[^"']*["']/u.test(source), false);
  for (const match of source.matchAll(/from "([^"]+)"/gu)) {
    const specifier = match[1];
    assert.ok(specifier.startsWith("@terminay/extension-api") || specifier.startsWith("node:") || specifier.startsWith("./"), specifier);
  }
});
