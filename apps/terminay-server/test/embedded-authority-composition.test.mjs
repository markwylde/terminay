import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createEmbeddedDesktopAuthority } from "../dist/index.js";

function createPtyFactory() {
  return {
    spawn() {
      return {
        pid: 8100,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => {}; },
        onExit() { return () => {}; },
      };
    },
  };
}

test("the server application exports the embedded Desktop authority boundary", async () => {
  const authority = createEmbeddedDesktopAuthority({
    serverId: "desktop-local",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: createPtyFactory(),
    allowUnresolvedTestSessions: true,
  });
  assert.equal(typeof authority.core.accept, "function");
  assert.equal(authority.coreOptions.commands.get("terminal.input") !== undefined, true);
  assert.equal(authority.coreOptions.queries.get("terminal.list") !== undefined, true);
  assert.equal(authority.terminal.serverId, "desktop-local");
  await authority.shutdown();
});

test("the embedded authority source is Electron-free", async () => {
  const source = await readFile(new URL("../src/embeddedAuthority.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:from|import\()\s*["']electron(?:["']|\/)/u);
});
