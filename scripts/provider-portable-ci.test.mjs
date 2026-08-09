import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [ci, serverImage, webImage, triggerRelease, decision] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".github/workflows/server-image.yml"),
  read(".github/workflows/web-image.yml"),
  read(".github/workflows/trigger-release.yml"),
  read("specs/decisions/provider-portable-parallel-ci.md"),
]);

test("pull-request CI contains one fast gate and five E2E shards", () => {
  assert.deepEqual(
    [...ci.slice(ci.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["build-and-test", "e2e-test"],
  );
  assert.match(ci, /name: Build, lint, and unit tests/u);
  assert.match(ci, /run: npm run test:ci/u);
  assert.match(ci, /shard: \[1, 2, 3, 4, 5\]/u);
  assert.match(ci, /name: E2E \(\$\{\{ matrix\.shard \}\}\/5\)/u);
  assert.doesNotMatch(ci, /ubuntu-24\.04|arm64|standalone-server|WebRTC|image/u);
});

test("all six PR jobs are independent and use portable runners", () => {
  assert.doesNotMatch(ci, /^ {4}needs:/mu);
  assert.equal((ci.match(/^ {4}runs-on: ubuntu-latest$/gmu) ?? []).length, 2);
  assert.match(ci, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
  assert.match(ci, /cancel-in-progress: true/u);
});

test("Electron shards use Docker without provider-specific steps", () => {
  const e2e = ci.slice(ci.indexOf("  e2e-test:"));
  assert.match(e2e, /npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/5/u);
  assert.doesNotMatch(e2e, /test:e2e:host|playwright install|setup-node/u);
  assert.doesNotMatch(e2e, /actions\/upload-artifact/u);
});

test("image publication is versioned-release-only", () => {
  assert.doesNotMatch(serverImage, /^ {2}pull_request:/mu);
  assert.doesNotMatch(serverImage, /^ {4}branches:/mu);
  assert.match(serverImage, /^ {4}tags:/mu);
  assert.match(webImage, /^ {2}workflow_dispatch:/mu);
  assert.doesNotMatch(webImage, /^ {2}push:/mu);
  assert.match(triggerRelease, /^ {2}build-web-image:/mu);
  assert.match(triggerRelease, /ref: \$\{\{ needs\.release\.outputs\.tag \}\}/u);
  assert.match(decision, /Native arm64 qualification belongs to the manually triggered release/u);
});
