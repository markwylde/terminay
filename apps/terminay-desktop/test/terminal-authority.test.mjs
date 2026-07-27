import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DesktopTerminalAuthorityAdapter } from "../dist/index.js";
import { TerminayTerminalClient } from "@terminay/client-core";

const identity = { serverId: "server-authority", projectId: "project-authority", sessionId: "session-authority" };

function transport() {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    async command(operation, payload) {
      calls.push({ operation, payload });
      if (operation === "terminal.attach" || operation === "terminal.resume") {
        return { attachmentId: "authority-attachment", fromPosition: payload.fromPosition, position: payload.fromPosition };
      }
      return { type: "command_result", commandId: `authority-command-${calls.length}`, correlationId: `authority-correlation-${calls.length}`, ok: true };
    },
    async subscribe() {
      return {
        id: "authority-subscription",
        fromRevision: 0,
        unsubscribe: async () => listeners.clear(),
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      };
    },
  };
}

test("desktop terminal authority routes non-panel mutations by immutable identity", async () => {
  const source = transport();
  const authority = new DesktopTerminalAuthorityAdapter(new TerminayTerminalClient(source));
  const session = await authority.attach({ ...identity, clientId: "desktop-authority" });

  await session.write(new Uint8Array([0, 0xff]));
  await session.resize({ cols: 120, rows: 40 });
  await session.kill("SIGTERM");
  await session.detach();

  assert.deepEqual(source.calls.map(({ operation }) => operation), [
    "terminal.attach",
    "terminal.input",
    "terminal.resize",
    "terminal.kill",
    "terminal.detach",
  ]);
  for (const { payload } of source.calls) {
    assert.deepEqual(payload.identity, identity);
    assert.equal("webContentsId" in payload, false);
    assert.equal("windowId" in payload, false);
    assert.equal("rendererId" in payload, false);
  }
  assert.equal(source.calls[1].payload.dataBase64, "AP8=");
  assert.equal(session.closed, true);
});

test("desktop terminal authority rejects legacy renderer ownership fields", async () => {
  const source = transport();
  const authority = new DesktopTerminalAuthorityAdapter(new TerminayTerminalClient(source));
  await assert.rejects(
    authority.attach({ ...identity, clientId: "desktop-authority", webContentsId: 42 }),
    /renderer or window ownership/,
  );
  await assert.rejects(
    authority.attach({ ...identity, clientId: "desktop-authority", authorization: { ...identity, webContentsId: 42 } }),
    /renderer or window ownership/,
  );
  assert.deepEqual(source.calls, []);
});

test("desktop authority adapter has no direct Electron preload dependency", () => {
  const source = readFileSync(new URL("../src/compatibility/terminalAuthority.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /window\.terminay|ipcRenderer|BrowserWindow/u);
});
