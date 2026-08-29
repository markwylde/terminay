import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the public package packs compiled code, fixtures and no workspace source", async () => {
  const destination = await mkdtemp(join(tmpdir(), "terminay-agent-grok-pack-"));
  const repository = new URL("../../../", import.meta.url);
  const packed = spawnSync("npm", ["pack", "--workspace", "terminay-agent-grok", "--pack-destination", destination, "--json"], { cwd: repository, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const parsed = JSON.parse(packed.stdout);
  const item = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.equal(typeof item?.filename, "string");
  const listing = spawnSync("tar", ["-tzf", join(destination, item.filename)], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /package\/dist\/index\.js/u);
  assert.match(listing.stdout, /package\/fixtures\/v0\.1\/basic\.jsonl/u);
  assert.doesNotMatch(listing.stdout, /package\/src\//u);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.terminay.permissions.includes("agent-observation"), true);
  assert.equal(manifest.terminay.contributes.agentProviders[0].requiredEnvironmentVariables.includes("GROK_HOME"), true);
});
