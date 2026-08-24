import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

test("packed Cursor extension contains its public runtime and no private Terminay imports", async () => {
  const environment = { ...process.env };
  // npm propagates the parent workspace selection into lifecycle scripts.
  // Remove it so this child packs the extension directory itself.
  delete environment.npm_config_workspace;
  delete environment.npm_config_workspaces;
  const { stdout } = await execute("npm", ["pack", "--json", "--dry-run"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: environment,
  });
  const parsed = JSON.parse(stdout);
  const pack = Array.isArray(parsed)
    ? parsed[0]
    : Array.isArray(parsed.files)
      ? parsed
      : parsed["terminay-agent-cursor"];
  assert.ok(Array.isArray(pack.files), `npm pack did not return extension file inventory: ${JSON.stringify(pack)}`);
  const names = new Set(pack.files.map((file) => file.path));
  assert.equal(names.has("dist/index.js"), true);
  assert.equal(names.has("dist/cursorAgent.js"), true);
  assert.equal(names.has("README.md"), true);
  assert.equal(names.has("fixtures/cursor/v0.1/basic.jsonl"), true);
  const sources = pack.files.filter((file) => file.path.startsWith("dist/")).map((file) => file.path);
  assert.equal(sources.some((name) => name.includes("server-core") || name.includes("electron")), false);
  const runtime = await readFile(new URL("../dist/cursorAgent.js", import.meta.url), "utf8");
  assert.equal(runtime.includes("server-core"), false);
  assert.equal(runtime.includes("packages/"), false);
  assert.equal(runtime.includes("electron/"), false);
});
