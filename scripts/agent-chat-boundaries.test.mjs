import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", "fixtures", "test", "dist-electron"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}

async function occurrences(pattern, directories) {
  const found = [];
  for (const directory of directories)
    for (const file of await sourceFiles(join(root, directory))) {
      const count = [...(await readFile(file, "utf8")).matchAll(pattern)].length;
      if (count > 0) found.push([relative(root, file), count]);
    }
  return found;
}

const SOURCES = ["apps", "electron", "packages", "extensions", "src"];

test("a chat capability is minted only by the host that serves MCP, for the agent chat service", async () => {
  // Defined once in the capability store, called once where the desktop hands
  // the agent chat service its MCP bridge, and nowhere else (ADR-0068).
  assert.deepEqual(await occurrences(/\bmintChat\(/gu, SOURCES), [
    ["apps/terminay-server/src/mcp/controlEndpoint.ts", 1],
    ["electron/main.ts", 1],
  ]);
  assert.deepEqual(
    (await occurrences(/\bagentChatMcp\b/gu, SOURCES)).map(([file]) => file),
    ["electron/main.ts", "electron/serverTerminalAuthority.ts"],
  );
});

test("the extension API offers no way to mint, read, or widen a capability", async () => {
  const found = await occurrences(/mintChat|revokeChat|ControlCapabilityStore|chatCallerKey/gu, ["packages/extension-api/src", "extensions"]);
  assert.deepEqual(found, []);
});

test("clients cannot hand a chat an instruction", async () => {
  const protocol = await readFile(join(root, "packages/server-core/src/agentChat/protocol.ts"), "utf8");
  assert.equal(/payload\.instruction/u.test(protocol), false);
  assert.equal(/allowReservedKey/u.test(protocol), false);
});
