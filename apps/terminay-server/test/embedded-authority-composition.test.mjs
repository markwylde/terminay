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

test("the embedded authority never composes or advertises the server desktop", async () => {
  const authority = createEmbeddedDesktopAuthority({
    serverId: "desktop-local",
    serverVersion: "1.0.0",
    capabilities: ["desktop", "server-desktop.v1"],
    ptyFactory: createPtyFactory(),
    allowUnresolvedTestSessions: true,
    // Even handed one, the embedded server drops it.
    serverDesktop: {
      operations: () => { throw new Error("the embedded server must not read desktop operations"); },
      displayEnvironment: () => { throw new Error("unused"); },
      closeConnection: () => {},
      dispose: () => {},
    },
  });
  assert.equal(authority.coreOptions.capabilities.includes("server-desktop.v1"), false);
  for (const name of [...authority.coreOptions.commands.keys(), ...authority.coreOptions.queries.keys()])
    assert.equal(name.startsWith("server.desktop."), false, name);
  await authority.shutdown();
});

test("Terminay Desktop's embedded server passes no server desktop to its composition", async () => {
  const source = await readFile(new URL("../../../electron/serverTerminalAuthority.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /serverDesktop/u);
});
