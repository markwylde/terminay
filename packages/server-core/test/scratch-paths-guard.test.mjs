import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The standalone server shares the host's temporary directory, so a fixed name
 * directly under it can be planted by another account. Shipped server code
 * reaches the temporary directory only through the scratch root
 * (`scratchDirectory.ts`), the socket placement that validates its own
 * directory (ADR-0054), or `mkdtemp`, which always makes a fresh private one.
 */

const repository = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const roots = ["packages/server-core/src", "apps/terminay-server/src"];
const allowed = new Set([
  "packages/server-core/src/scratchDirectory.ts",
  "apps/terminay-server/src/mcp/controlSocketPlacement.ts",
]);

// `join(tmpdir(), 'name')` or a `= tmpdir()` default for a fixed directory.
const FIXED_NAME = /join\(\s*(?:os\.)?tmpdir\(\)\s*,\s*['"`]/u;
const DEFAULT_ROOT = /\b\w+\s*=\s*(?:os\.)?tmpdir\(\)\s*\)/u;

async function sources(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(path);
  }
  return found;
}

export function findFixedTemporaryPaths(text) {
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !line.includes("mkdtemp") && (FIXED_NAME.test(line) || DEFAULT_ROOT.test(line)));
}

test("shipped server code writes no fixed name directly under the temporary directory", async () => {
  const offenders = [];
  for (const root of roots) {
    for (const file of await sources(join(repository, root))) {
      const name = relative(repository, file);
      if (allowed.has(name)) continue;
      for (const { number, line } of findFixedTemporaryPaths(await readFile(file, "utf8")))
        offenders.push(`${name}:${number}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the guard catches a planted fixed name and allows mkdtemp", () => {
  assert.equal(findFixedTemporaryPaths("const p = join(tmpdir(), 'x');").length, 1);
  assert.equal(findFixedTemporaryPaths("export function d(root = tmpdir()): string {").length, 1);
  assert.equal(findFixedTemporaryPaths("await mkdtemp(path.join(tmpdir(), 'terminay-bot-'));").length, 0);
});
