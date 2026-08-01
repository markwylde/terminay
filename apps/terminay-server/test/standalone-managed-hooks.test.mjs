import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("standalone startup installs and disabled policy uninstalls managed provider hooks without Electron", async () => {
  const home = await mkdtemp(join(tmpdir(), "terminay-standalone-hooks-"));
  let installed;
  let disabled;
  try {
    installed = await startStandalone(home, "enabled");
    assert.equal(installed.ready.ready, true);
    const configs = await Promise.all([
      readFile(join(home, ".codex", "hooks.json"), "utf8"),
      readFile(join(home, ".claude", "settings.json"), "utf8"),
    ]);
    for (const config of configs) {
      assert.match(config, /TERMINAY_MANAGED_AGENT_HOOK=1/u);
      assert.doesNotMatch(config, /TERMINAY_AGENT_HOOK_(?:ENDPOINT|TOKEN)/u);
    }
    assert.doesNotMatch(`${installed.stdout}${installed.stderr}`, /TERMINAY_AGENT_HOOK_TOKEN/u);
    await installed.stop();

    disabled = await startStandalone(home, "disabled");
    assert.equal(disabled.ready.ready, true);
    const removedConfigs = await Promise.all([
      readFile(join(home, ".codex", "hooks.json"), "utf8"),
      readFile(join(home, ".claude", "settings.json"), "utf8"),
    ]);
    for (const config of removedConfigs) assert.doesNotMatch(config, /TERMINAY_MANAGED_AGENT_HOOK=1/u);
    await assert.rejects(stat(join(home, ".terminay", "agent-hooks", "terminay-codex-agent-hook.sh")), { code: "ENOENT" });
    await assert.rejects(stat(join(home, ".terminay", "agent-hooks", "terminay-claude-code-agent-hook.sh")), { code: "ENOENT" });
    assert.doesNotMatch(`${disabled.stdout}${disabled.stderr}`, /electron/iu);
    await disabled.stop();
  } finally {
    await disabled?.stop();
    await installed?.stop();
    await rm(home, { recursive: true, force: true });
  }
});

async function startStandalone(home, agentIntegration) {
  const child = spawn(process.execPath, [
    "dist/cli.js",
    "--server-id", "standalone-managed-hooks",
    "--data-root", join(home, "data"),
    "--endpoint", "disabled",
  ], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, HOME: home, TERMINAY_SERVER_VERSION: "test", TERMINAY_AGENT_INTEGRATION: agentIntegration },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CLI readiness timed out: ${stderr}`)), 5_000);
    child.stdout.on("data", () => {
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      resolve(JSON.parse(stdout.slice(0, newline)));
    });
    child.once("error", reject);
  });
  return {
    ready: await ready,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await once(child, "exit");
    },
  };
}
