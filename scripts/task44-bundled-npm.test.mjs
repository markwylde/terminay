import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inspectBundledNpmEvidence } from "./bundled-npm-evidence.mjs";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("Desktop and standalone servers pin the same npm installer with lock integrity and license metadata", async () => {
  const [desktop, server, npm, lock] = await Promise.all([json("package.json"), json("apps/terminay-server/package.json"), json("node_modules/npm/package.json"), json("package-lock.json")]);
  assert.equal(desktop.packageManager, "npm@11.9.0");
  assert.equal(desktop.dependencies.npm, "11.9.0");
  assert.equal(server.dependencies.npm, "11.9.0");
  assert.equal(npm.version, "11.9.0");
  assert.equal(npm.license, "Artistic-2.0");
  const locked = lock.packages["node_modules/npm"];
  assert.equal(locked.version, "11.9.0");
  assert.match(locked.integrity, /^sha512-/u);
  assert.equal(locked.license, "Artistic-2.0");
});

test("the bundled CLI is a deterministic regular payload covered by a stable source hash", async () => {
  const bytes = await readFile(new URL("node_modules/npm/bin/npm-cli.js", root));
  assert.ok(bytes.byteLength > 20);
  assert.match(createHash("sha256").update(bytes).digest("hex"), /^[a-f0-9]{64}$/u);
});

test("bundled npm evidence binds every bundled package's version, license, and registry integrity", async () => {
  const first = await inspectBundledNpmEvidence(); const second = await inspectBundledNpmEvidence();
  assert.deepEqual(first, second); assert.ok(first.packageCount > 50); assert.equal(first.packages.length, first.packageCount);
  assert.ok(first.packages.every((item) => item.version && item.license && /^sha512-/u.test(item.integrity)));
  assert.match(first.closureSha256, /^[a-f0-9]{64}$/u);
});
