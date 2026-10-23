import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionHost } from "../dist/index.js";

const LAUNCHER_ID = "example.launch/echo";

async function fixture(resolveBody, permissions = ["agent-launch"]) {
  const root = await mkdtemp(join(tmpdir(), "terminay-launcher-"));
  await writeFile(
    join(root, "extension.js"),
    `export function activate(context) {
  context.terminals.registerLauncher("${LAUNCHER_ID}", {
    async resolve() { ${resolveBody} },
  });
}`,
    { mode: 0o600 },
  );
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId: "example.launch",
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions,
    terminalLaunchers: [{ id: LAUNCHER_ID, displayName: "Echo", icon: "terminal" }],
  };
}

test("a launcher registers and reports its absolute executable, and nothing more", async (t) => {
  const host = new ExtensionHost("example.launch", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(`return { available: true, executable: "/usr/bin/echo", args: ["--danger"] };`));
  assert.deepEqual(host.status().terminalLaunchers.map((launcher) => launcher.id), [LAUNCHER_ID]);
  assert.deepEqual(await host.resolveTerminalLauncher(LAUNCHER_ID), { available: true, executable: "/usr/bin/echo" });
});

test("a relative executable is refused", async (t) => {
  const host = new ExtensionHost("example.launch", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(`return { available: true, executable: "echo" };`));
  await assert.rejects(host.resolveTerminalLauncher(LAUNCHER_ID));
});

test("a resolution that throws is a failure the host reports", async (t) => {
  const host = new ExtensionHost("example.launch", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(`throw new Error("boom");`));
  await assert.rejects(host.resolveTerminalLauncher(LAUNCHER_ID));
});

test("a resolution that never answers times out", async (t) => {
  const host = new ExtensionHost("example.launch", {
    broker: { async request() {} },
    limits: { invocationTimeoutMs: 200 },
  });
  t.after(() => host.stop());
  await host.start(await fixture(`await new Promise(() => {});`));
  const started = Date.now();
  await assert.rejects(host.resolveTerminalLauncher(LAUNCHER_ID));
  assert.ok(Date.now() - started < 5_000);
});

test("an unregistered launcher is unavailable", async (t) => {
  const host = new ExtensionHost("example.launch", { broker: { async request() {} } });
  t.after(() => host.stop());
  await host.start(await fixture(`return { available: false, reason: "not_installed" };`));
  await assert.rejects(host.resolveTerminalLauncher("example.launch/other"), /unavailable/);
});

test("a launcher registered without agent-launch is refused", async () => {
  const host = new ExtensionHost("example.launch", { broker: { async request() {} } });
  await assert.rejects(
    host.start(await fixture(`return { available: false, reason: "not_installed" };`, [])),
    /invalid terminal launcher registrations/,
  );
});
