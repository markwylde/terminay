import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  backgroundTerminalLimitMs,
  createServerCoreComposition,
  DEFAULT_SERVER_SETTINGS,
  KEEP_TERMINALS_AFTER_QUIT_VALUES,
  normalizeKeepTerminalsAfterQuit,
  ServerSettingsRepository,
  SETTING_AUTHORITY,
} from "../dist/index.js";

test("the limit defaults to five minutes and offers keeping terminals until restart", () => {
  assert.equal(DEFAULT_SERVER_SETTINGS.keepTerminalsAfterQuit, "5m");
  assert.equal(backgroundTerminalLimitMs(DEFAULT_SERVER_SETTINGS.keepTerminalsAfterQuit), 5 * 60_000);
  assert.equal(backgroundTerminalLimitMs("untilRestart"), null);
  assert.deepEqual(
    KEEP_TERMINALS_AFTER_QUIT_VALUES.map((value) => backgroundTerminalLimitMs(value)),
    [60_000, 300_000, 1_800_000, 7_200_000, null],
  );
});

test("an unknown value falls back to the default rather than to no limit", () => {
  for (const value of [undefined, null, "", "forever", 0, 5, {}]) {
    assert.equal(normalizeKeepTerminalsAfterQuit(value), "5m");
    assert.equal(backgroundTerminalLimitMs(value), 300_000);
  }
});

test("the setting is server-owned on the server and on the client", () => {
  assert.equal(SETTING_AUTHORITY.keepTerminalsAfterQuit, "server");
  const client = readFileSync(new URL("../../../src/terminalSettings.ts", import.meta.url), "utf8");
  const owned = client.slice(client.indexOf("SERVER_OWNED_TERMINAL_SETTING_KEYS"), client.indexOf("]);"));
  assert.ok(owned.includes("'keepTerminalsAfterQuit'"), "the client would persist a server setting on the device");
});

/** The part of a session-holder factory the composition drives at start-up. */
function fakeHolder() {
  const limits = [];
  return {
    limits,
    spawn() { throw new Error("unexpected spawn"); },
    setLimit: (limitMs) => limits.push(limitMs),
    async start() { return []; },
    async detach() {},
    async endAll() {},
    async end() {},
    readTail: () => undefined,
    pruneTails() {},
  };
}

test("the holder is told the limit at start and again whenever the setting changes", async () => {
  let persisted;
  const settings = new ServerSettingsRepository({
    async load() { return persisted; },
    async commit(value) { persisted = value; },
  });
  const holder = fakeHolder();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "limit-server",
    serverVersion: "1.0.0",
    capabilities: [],
    sessionHolder: holder,
    settings,
  });
  await composition.start();
  assert.deepEqual(holder.limits, [300_000]);

  await settings.set("keepTerminalsAfterQuit", "2h");
  assert.deepEqual(holder.limits, [300_000, 7_200_000]);

  await settings.set("keepTerminalsAfterQuit", "untilRestart");
  assert.equal(holder.limits.at(-1), null);

  // After shutdown the holder is no longer driven by this server.
  await composition.shutdown();
  const before = holder.limits.length;
  await settings.set("keepTerminalsAfterQuit", "1m");
  assert.equal(holder.limits.length, before);
});
