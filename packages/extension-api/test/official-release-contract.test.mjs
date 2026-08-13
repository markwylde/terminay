import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("official workflow pins its release tools and cannot fetch an undeclared conformance CLI", async () => {
  const workflow = await readFile(new URL("../templates/official-extension-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /node-version: 24\.15\.0/);
  assert.match(workflow, /npm install --global npm@12\.0\.2/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run build --if-present/);
  assert.match(workflow, /npx --no-install terminay-extension-conformance/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
});

test("registry proof requires integrity and npm provenance attestations", async () => {
  const verifier = await readFile(new URL("../scripts/verify-registry.mjs", import.meta.url), "utf8");
  assert.match(verifier, /dist\.integrity/);
  assert.match(verifier, /dist\.attestations/);
  assert.match(verifier, /provenance\.predicateType/);
  assert.match(verifier, /npm-registry-proof\.json/);
});
