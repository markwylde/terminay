#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const evidenceDirectory = resolve(process.argv[2] ?? "release-evidence");

function fail(message) {
  throw new Error(message);
}

async function main() {
  const evidence = JSON.parse(await readFile(join(evidenceDirectory, "extension-release-evidence.json"), "utf8"));
  const spec = `${evidence.package.name}@${evidence.package.version}`;
  const result = spawnSync("npm", ["view", spec, "dist.integrity", "dist.tarball", "--json"], { encoding: "utf8" });
  if (result.status !== 0) fail(`npm registry lookup failed for ${spec}: ${result.stderr.trim()}`);
  const registry = JSON.parse(result.stdout);
  if (registry["dist.integrity"] !== evidence.packed.integrity) fail(`registry integrity for ${spec} does not match the verified tarball`);
  if (typeof registry["dist.tarball"] !== "string" || !registry["dist.tarball"].startsWith("https://registry.npmjs.org/")) fail(`registry tarball for ${spec} is not an npmjs HTTPS artifact`);
  const proof = { schemaVersion: 1, package: evidence.package, integrity: registry["dist.integrity"], tarball: registry["dist.tarball"] };
  await writeFile(join(evidenceDirectory, "npm-registry-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  process.stdout.write(`Verified npmjs registry integrity for ${spec}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Registry verification failed"}\n`);
  process.exitCode = 1;
});
