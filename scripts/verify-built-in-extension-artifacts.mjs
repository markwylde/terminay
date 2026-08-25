#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DirectoryBuiltInExtensionArtifactSource } from "../packages/server-core/dist/extensions/index.js";

const expected = [
  "com.terminay.ssh",
  "com.puzed.platform",
  "com.terminay.agent.codex",
  "com.terminay.agent.claude-code",
  "com.terminay.agent.cursor",
  "com.terminay.agent.omp",
].sort();

export async function verifyBuiltInExtensionArtifacts(root) {
  const source = new DirectoryBuiltInExtensionArtifactSource(resolve(root));
  const artifacts = await source.list();
  assert.deepEqual(artifacts.map((artifact) => artifact.extensionId).sort(), expected, "built-in inventory must contain exactly the six official extensions");
  const temporary = await mkdtemp(join(tmpdir(), "terminay-built-in-verify-"));
  try {
    for (const artifact of artifacts) await source.materialize(artifact, join(temporary, artifact.extensionId));
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return artifacts;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = process.argv[2];
  if (!root) throw new Error("usage: verify-built-in-extension-artifacts.mjs <artifact-directory>");
  const artifacts = await verifyBuiltInExtensionArtifacts(root);
  process.stdout.write(`${JSON.stringify({ verified: artifacts.map((artifact) => `${artifact.packageName}@${artifact.version}`) }, null, 2)}\n`);
}
