import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stageProductionDependencyClosure } from "../../../scripts/standalone-runtime-dependencies.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

async function packAndExtract(workspace, destination) {
  await mkdir(destination, { recursive: true });
  const packed = JSON.parse((await run("npm", ["pack", "--workspace", workspace, "--json", "--pack-destination", destination], { cwd: repositoryRoot })).stdout);
  assert.equal(packed.length, 1);
  const extracted = join(destination, "extracted");
  await mkdir(extracted);
  await run("tar", ["-xzf", join(destination, packed[0].filename), "-C", extracted]);
  return join(extracted, "package");
}

async function assertNoSymlinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    assert.equal((await lstat(path)).isSymbolicLink(), false, `packed Desktop closure retained symlink ${path}`);
    if (entry.isDirectory()) await assertNoSymlinks(path);
  }
}

test("extracted Desktop closure reconciles shared provider hook scripts without credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-provider-hooks-artifact-"));
  try {
    const desktopRoot = await packAndExtract("@terminay/desktop", join(root, "desktop"));
    const serverRoot = await packAndExtract("@terminay/server", join(root, "server"));
    const serverCoreRoot = await packAndExtract("@terminay/server-core", join(root, "server-core"));
    const protocolRoot = await packAndExtract("@terminay/protocol", join(root, "protocol"));
    const modules = join(desktopRoot, "node_modules");
    await stageProductionDependencyClosure({
      destinationModules: modules,
      runtimeModules: join(repositoryRoot, "node_modules"),
      workspacePackages: {
        "@terminay/server": serverRoot,
        "@terminay/server-core": serverCoreRoot,
        "@terminay/protocol": protocolRoot,
      },
      rootPackages: ["@terminay/server", "@terminay/server-core", "@terminay/protocol", "@modelcontextprotocol/sdk", "node-pty", "zod"],
    });
    await assertNoSymlinks(desktopRoot);

    const serverCore = await import(pathToFileURL(join(modules, "@terminay/server-core/dist/index.js")).href);
    const artifactHome = join(root, "artifact-home");
    const hooks = serverCore.createAgentDriverRegistry();
    const installed = await hooks.reconcileHooks({
      action: "install",
      options: { homeDir: artifactHome },
    });
    assert.equal(installed.ok, true);
    assert.deepEqual(installed.statuses.map((status) => status.provider).sort(), ["claude-code", "codex"]);
    assert.deepEqual(installed.statuses.map((status) => status.state), ["installed", "installed"]);

    const [codexConfig, claudeConfig, codexScript, claudeScript, codexMode, claudeMode] = await Promise.all([
      readFile(join(artifactHome, ".codex", "hooks.json"), "utf8"),
      readFile(join(artifactHome, ".claude", "settings.json"), "utf8"),
      readFile(join(artifactHome, ".terminay", "agent-hooks", "terminay-codex-agent-hook.sh"), "utf8"),
      readFile(join(artifactHome, ".terminay", "agent-hooks", "terminay-claude-code-agent-hook.sh"), "utf8"),
      stat(join(artifactHome, ".terminay", "agent-hooks", "terminay-codex-agent-hook.sh")),
      stat(join(artifactHome, ".terminay", "agent-hooks", "terminay-claude-code-agent-hook.sh")),
    ]);
    for (const config of [codexConfig, claudeConfig]) {
      assert.match(config, /TERMINAY_MANAGED_AGENT_HOOK=1/u);
      assert.doesNotMatch(config, /TERMINAY_AGENT_HOOK_(?:ENDPOINT|TOKEN)/u);
    }
    for (const script of [codexScript, claudeScript]) {
      assert.match(script, /http:\/\/127\.0\.0\.1:\*/u);
      assert.doesNotMatch(script, /https?:\/\/(?!127\.0\.0\.1|localhost|\\\[::1\\\])/u);
    }
    assert.equal(codexMode.mode & 0o777, 0o700);
    assert.equal(claudeMode.mode & 0o777, 0o700);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
