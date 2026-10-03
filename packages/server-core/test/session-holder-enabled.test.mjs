import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionHolderEnabled } from "../dist/index.js";

const on = (env = {}, overrides = {}) =>
  sessionHolderEnabled({ dataRoot: "/var/lib/terminay", env, platform: "linux", ...overrides });

test("terminals are kept in a session holder by default", () => {
  assert.equal(on(), true);
  assert.equal(on({}, { platform: "darwin", dataRoot: "/Users/ada/Library/Application Support/Terminay" }), true);
});

test("it can be turned off, and only an exact 0 does so", () => {
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "0" }), false);
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "1" }), true);
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "" }), true);
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "false" }), true);
});

test("a test harness gets no holder unless it asks for one", () => {
  // A holder outlives the process that started it; a harness that did not ask
  // for one would leave shells running after it finished.
  assert.equal(on({ TERMINAY_TEST: "1" }), false);
  assert.equal(on({ TERMINAY_TEST: "1", TERMINAY_SESSION_HOLDER: "1" }), true);
  assert.equal(on({ TERMINAY_TEST: "1", TERMINAY_SESSION_HOLDER: "0" }), false);
});

test("it is off where it cannot work, whatever was asked", () => {
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "1" }, { platform: "win32" }), false);
  // The holder's socket lives under the data root, and a Unix socket path is
  // limited to about a hundred bytes. Terminals that end with the server are
  // better than terminals that cannot start.
  const deep = `/home/${"a".repeat(80)}/terminay`;
  assert.equal(on({}, { dataRoot: deep }), false);
  assert.equal(on({ TERMINAY_SESSION_HOLDER: "1" }, { dataRoot: deep }), false);
  // The longest account name the default macOS location still fits.
  assert.equal(on({}, { platform: "darwin", dataRoot: `/Users/${"u".repeat(22)}/Library/Application Support/Terminay` }), true);
  assert.equal(on({}, { platform: "darwin", dataRoot: `/Users/${"u".repeat(23)}/Library/Application Support/Terminay` }), false);
});

test("both hosts decide through the same rule", () => {
  const desktop = readFileSync(new URL("../../../electron/main.ts", import.meta.url), "utf8");
  const standalone = readFileSync(new URL("../../../apps/terminay-server/src/cli.ts", import.meta.url), "utf8");
  for (const source of [desktop, standalone]) {
    assert.match(source, /isSessionHolderEnabled\(\{/);
    assert.doesNotMatch(source, /TERMINAY_SESSION_HOLDER === '1'/);
  }
});
