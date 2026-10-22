import test from "node:test";
import assert from "node:assert/strict";
import { TerminalLauncherRegistry, launcherCommandLine } from "../dist/index.js";

const BUILT_IN = "com.terminay.builtin-agents";
const SOURCE = `${BUILT_IN}/agents`;

function launcher(extensionId, local, extra = {}) {
  return {
    extensionId,
    contribution: { id: `${extensionId}/${local}`, displayName: local, icon: "terminal", ...extra },
  };
}

/** A stand-in for the extension host manager. */
function fakeSource(entries, resolutions) {
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    entries,
    terminalLauncherContributions: () => entries,
    async resolveTerminalLauncher(id) {
      calls.push(id);
      const answer = resolutions[id];
      if (answer instanceof Error) throw answer;
      if (typeof answer === "function") return answer();
      return answer ?? { available: false, reason: "not_installed" };
    },
    onContributionsChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async changed() {
      for (const listener of listeners) await listener();
    },
  };
}

test("lists only resolved launchers, built-ins first, with no path", async () => {
  const source = fakeSource(
    [
      launcher("zz.other", "tool"),
      launcher(BUILT_IN, "launch-codex", { displayName: "Codex" }),
      launcher("aa.other", "missing"),
      launcher(BUILT_IN, "launch-claude-code", { displayName: "Claude Code" }),
    ],
    {
      "zz.other/tool": { available: true, executable: "/usr/bin/tool" },
      [`${BUILT_IN}/launch-codex`]: { available: true, executable: "/usr/bin/codex" },
      [`${BUILT_IN}/launch-claude-code`]: { available: true, executable: "/usr/bin/claude" },
    },
  );
  const registry = new TerminalLauncherRegistry({ builtInExtensionIds: [BUILT_IN], platform: "darwin" });
  registry.attach(source);
  const list = await registry.list();
  assert.deepEqual(list.map((entry) => entry.id), [
    `${BUILT_IN}/launch-codex`,
    `${BUILT_IN}/launch-claude-code`,
    "zz.other/tool",
  ]);
  for (const entry of list) assert.deepEqual(Object.keys(entry).sort(), ["displayName", "icon", "id"]);
  assert.equal((await registry.target(`${BUILT_IN}/launch-codex`)).executable, "/usr/bin/codex");
});

test("a harness switched off hides its launcher without asking it", async () => {
  const id = `${BUILT_IN}/launch-codex`;
  const source = fakeSource([launcher(BUILT_IN, "launch-codex", { harness: { source: SOURCE, harness: "codex" } })], {
    [id]: { available: true, executable: "/usr/bin/codex" },
  });
  const registry = new TerminalLauncherRegistry({ harnessSwitches: { [`${SOURCE}/codex`]: false }, platform: "linux" });
  registry.attach(source);
  assert.deepEqual(await registry.list(), []);
  assert.equal(await registry.target(id), undefined);
  assert.deepEqual(source.calls, []);
  registry.setHarnessSwitches({});
  assert.deepEqual((await registry.list()).map((entry) => entry.id), [id]);
});

test("an unsupported platform hides a launcher", async () => {
  const source = fakeSource([launcher("x.ext", "win", { platforms: ["win32"] })], {
    "x.ext/win": { available: true, executable: "C:\\tool.exe" },
  });
  const registry = new TerminalLauncherRegistry({ platform: "linux" });
  registry.attach(source);
  assert.deepEqual(await registry.list(), []);
});

test("a launcher that fails, times out, or names a relative path is not offered", async () => {
  const source = fakeSource(
    [launcher("x.ext", "boom"), launcher("x.ext", "relative"), launcher("x.ext", "ok")],
    {
      "x.ext/boom": new Error("timed out"),
      "x.ext/relative": { available: true, executable: "tool" },
      "x.ext/ok": { available: true, executable: "/opt/tool" },
    },
  );
  const registry = new TerminalLauncherRegistry({ platform: "linux" });
  registry.attach(source);
  assert.deepEqual((await registry.list()).map((entry) => entry.id), ["x.ext/ok"]);
});

test("a resolution is reused until it is stale", async () => {
  let now = 0;
  const source = fakeSource([launcher("x.ext", "ok")], { "x.ext/ok": { available: true, executable: "/opt/tool" } });
  const registry = new TerminalLauncherRegistry({ platform: "linux", maxResolutionAgeMs: 1_000, now: () => now });
  registry.attach(source);
  await registry.list();
  await registry.list();
  assert.equal(source.calls.length, 1);
  now = 5_000;
  await registry.list();
  assert.equal(source.calls.length, 2);
});

test("observers hear when what is offered changes", async () => {
  let installed = true;
  const source = fakeSource([launcher("x.ext", "ok")], {
    "x.ext/ok": () => (installed ? { available: true, executable: "/opt/tool" } : { available: false, reason: "not_installed" }),
  });
  const registry = new TerminalLauncherRegistry({ platform: "linux" });
  let heard = 0;
  registry.observe(() => {
    heard += 1;
  });
  registry.attach(source);
  await registry.refresh();
  const afterFirst = heard;
  await registry.refresh();
  assert.equal(heard, afterFirst, "an unchanged list is not announced again");
  installed = false;
  await source.changed();
  assert.equal(heard, afterFirst + 1);
  assert.deepEqual(await registry.list(), []);
});

test("the start command is the quoted path alone, for each shell family", () => {
  assert.equal(launcherCommandLine("/Users/me/.local/bin/claude", "/bin/zsh"), "'/Users/me/.local/bin/claude'\r");
  assert.equal(launcherCommandLine("/opt/it's/codex", "/bin/bash"), "'/opt/it'\\''s/codex'\r");
  assert.equal(launcherCommandLine("C:\\Tools\\codex.exe", "C:\\Windows\\System32\\cmd.exe"), "\"C:\\Tools\\codex.exe\"\r");
  assert.equal(launcherCommandLine("C:\\it's\\codex.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe"), "& 'C:\\it''s\\codex.exe'\r");
});
