import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { EXTENSION_ID, PROVIDER_ID } from "../../dist/index.js";

const require = createRequire(new URL("../../../../package.json", import.meta.url));
const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["INIT_CWD", "npm_config_local_prefix", "npm_config_user_agent", "npm_config_workspace"].includes(key)));

test("packed host grants agent broker only to agent profiles", async () => {
  const image = "terminay-plugin-ssh-fixture:task46-agent";
  assert.equal(run("docker", ["build", "-t", image, new URL(".", import.meta.url).pathname]).status, 0);
  const started = run("docker", ["run", "-d", "-P", image]);
  assert.equal(started.status, 0, started.stderr);
  const container = started.stdout.trim();
  let manager;
  try {
    const port = Number(run("docker", ["port", container, "22/tcp"]).stdout.trim().split(":").at(-1));
    const root = await mkdtemp(join(tmpdir(), "terminay-ssh-agent-host-")); const repository = new URL("../../../../", import.meta.url); const packed = run("npm", ["pack", "--workspace", "terminay-plugin-ssh", "--pack-destination", root, "--json"], repository); assert.equal(packed.status, 0, packed.stderr);
    assert.equal(run("tar", ["-xzf", join(root, packedFilename(packed.stdout)), "-C", root]).status, 0);
    const api = run("npm", ["pack", "--workspace", "@terminay/extension-api", "--pack-destination", root, "--json"], repository); assert.equal(api.status, 0, api.stderr);
    const packageRoot = join(root, "package"); assert.equal(run("npm", ["install", "--ignore-scripts", "--omit=dev", join(root, packedFilename(api.stdout))], packageRoot).status, 0);
    const dirs = { configDirectory: join(root, "config"), dataDirectory: join(root, "data"), cacheDirectory: join(root, "cache") }; await Promise.all(Object.values(dirs).map((path) => mkdir(path)));
    const profiles = new Map([
      ["agent", { "display-name": "Agent", hostname: "127.0.0.1", port, username: "terminay", "auth-mode": "agent", "default-root": "~", hostVerification: "unsafe", connectMs: 5000, handshakeMs: 5000, keepaliveMs: 1000 }],
      ["password", { "display-name": "Password", hostname: "127.0.0.1", port, username: "terminay", "auth-mode": "password", "default-root": "~", hostVerification: "unsafe", connectMs: 5000, handshakeMs: 5000, keepaliveMs: 1000 }],
    ]);
    let agentLists = 0; const [{ ExtensionHostManager }] = await Promise.all([import(require.resolve("@terminay/server-core"))]);
    manager = new ExtensionHostManager({
      broker: { async request() { throw new Error("unexpected generic broker"); } },
      profiles: { async get(_extensionId, _providerId, profileId) { return { profileId, providerId: PROVIDER_ID, revision: 1, values: profiles.get(profileId), secretFields: profileId === "password" ? ["password"] : [] }; } },
      secrets: { async withSecret(_principal, _request, use) { return use(Buffer.from("secret-pass")); } },
      sshAgent: { async listIdentities() { agentLists++; return []; }, async sign() { throw new Error("no identity"); } },
    });
    await manager.start({ extensionId: EXTENSION_ID, packageRoot, entrypoint: "dist/index.js", ...dirs, permissions: ["network", "secrets:resolve", "ssh-agent:use"], projectEnvironmentProviders: [{ id: PROVIDER_ID, displayName: "SSH server", capabilities: ["terminal", "filesystem", "git", "agent-journal", "process-observation"], dependencyOperations: ["generate", "bind", "update", "verify", "approve-trust", "service", "remove"].map((name) => ({ name: `managed-binding.${name}` })) }], extensionDependencies: [] });
    const invoke = (profileId) => manager.invokeProvider({ providerId: PROVIDER_ID, callback: "testProfile", request: { profileId, values: {} } });
    const passwordIssues = await invoke("password");
    assert.deepEqual(passwordIssues, []);
    assert.equal(agentLists, 0, "password authentication must not invoke the agent broker");

    const agentIssues = await invoke("agent");
    assert.equal(agentLists, 1, JSON.stringify(agentIssues));
    assert.ok(agentIssues.length > 0);
  } finally {
    await manager?.shutdown();
    run("docker", ["rm", "-f", container]);
  }
});

function run(command, args, cwd) { return spawnSync(command, args, { cwd, encoding: "utf8", ...(command === "npm" ? { env: npmEnvironment } : {}) }); }
function packedFilename(output) { const parsed = JSON.parse(output); const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]; assert.equal(typeof item?.filename, "string"); return item.filename; }
