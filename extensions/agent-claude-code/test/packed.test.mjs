import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repository = new URL("../../../", import.meta.url);
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));

test("the Claude Code extension packs as a self-contained public package", async () => {
  const destination = await mkdtemp(join(tmpdir(), "terminay-claude-code-pack-"));
  try {
    const output = execFileSync("npm", ["pack", "--workspace", "terminay-agent-claude-code", "--json", "--pack-destination", destination], { cwd: repository, encoding: "utf8", env: npmEnvironment });
    const packed = JSON.parse(output); const item = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    assert.equal(typeof item?.filename, "string");
    execFileSync("tar", ["-xzf", join(destination, item.filename), "-C", destination]);
    const packageJson = JSON.parse(await readFile(join(destination, "package/package.json"), "utf8"));
    assert.equal(packageJson.name, "terminay-agent-claude-code");
    assert.equal(packageJson.terminay.id, "com.terminay.agent.claude-code");
    assert.equal(packageJson.terminay.entrypoint, "dist/index.js");
    assert.deepEqual(packageJson.terminay.permissions, ["agent-observation"]);
    const source = await readFile(join(destination, "package/dist/provider.js"), "utf8");
    assert.equal(source.includes("server-core"), false);
    assert.equal(source.includes("../../../"), false);
    const apiScope = join(destination, "package/node_modules/@terminay");
    await mkdir(apiScope, { recursive: true });
    await symlink(new URL("../../../packages/extension-api", import.meta.url), join(apiScope, "extension-api"), "dir");
    const loaded = await import(pathToFileURL(join(destination, "package/dist/index.js")).href);
    const providers = [];
    await loaded.default.activate({
      extensionId: packageJson.terminay.id,
      apiVersion: "1.1.0",
      paths: { configuration: "/fixture/config", data: "/fixture/data", cache: "/fixture/cache" },
      agents: { registerProvider(providerId, runtime) { providers.push({ providerId, runtime }); return { providerId, dispose() {} }; } },
      subscriptions: { add(value) { return value; } },
      registerProjectEnvironmentProvider() {},
    });
    assert.equal(providers[0]?.providerId, "com.terminay.agent.claude-code/cli");
  } finally { await rm(destination, { recursive: true, force: true }); }
});
