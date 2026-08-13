import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NpmCliRegistryClient, NpmRegistryUnavailableError } from "../dist/extensions/index.js";

const integrity = `sha512-${Buffer.alloc(64, 3).toString("base64")}`;
const resolution = { packageName: "safe-extension", version: "1.0.0", integrity, tarballUrl: "https://registry.npmjs.org/safe-extension/-/safe-extension-1.0.0.tgz" };

test("npm materialization validates the generated lock before npm ci can materialize hostile transitive content", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-npm-two-phase-")); const calls = [];
  try {
    const client = new NpmCliRegistryClient({ workRoot: join(root, "work"), runner: async (args, options) => {
      calls.push([...args]);
      await writeFile(join(options.cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/safe-extension": { version: "1.0.0", integrity, resolved: resolution.tarballUrl }, "node_modules/hostile": { version: "1.0.0", integrity, resolved: "git+https://evil.test/repo.git" } } }));
      return { stdout: "", stderr: "" };
    } });
    await assert.rejects(client.materialize(resolution, join(root, "stage")), /public npmjs/u);
    assert.equal(calls.length, 1); assert.ok(calls[0].includes("--package-lock-only")); assert.ok(!calls.some((args) => args[0] === "ci"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("safe closure uses package-lock-only followed by exact scriptless npm ci", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-npm-two-phase-")); const calls = []; const environments = [];
  try {
    const client = new NpmCliRegistryClient({ workRoot: join(root, "work"), runner: async (args, options) => {
      calls.push([...args]); environments.push(options.env); if (args[0] === "install") await writeFile(join(options.cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/safe-extension": { version: "1.0.0", integrity, resolved: resolution.tarballUrl } } })); return { stdout: "", stderr: "" };
    } });
    await client.materialize(resolution, join(root, "stage")); assert.equal(calls.length, 2); assert.equal(calls[1][0], "ci");
    for (const flag of ["--ignore-scripts", "--omit=dev", "--allow-git=none", "--workspaces=false", "--no-bin-links"]) assert.ok(calls[1].includes(flag));
    assert.ok(environments.every((env) => env.ELECTRON_RUN_AS_NODE === "1"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("registry network failures expose a typed actionable preview state", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-npm-unavailable-"));
  try {
    const client = new NpmCliRegistryClient({ workRoot: root, runner: async () => { throw Object.assign(new Error("offline"), { code: "ENOTFOUND" }); } });
    await assert.rejects(client.resolve("safe-extension", "latest"), (error) => error instanceof NpmRegistryUnavailableError && error.code === "registry_unavailable" && error.retryable === true && /retry/u.test(error.action));
  } finally { await rm(root, { recursive: true, force: true }); }
});
