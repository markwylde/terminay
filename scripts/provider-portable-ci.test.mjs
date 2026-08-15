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

test("pull-request CI contains a packaged macOS smoke, one fast gate, one E2E image build, and five E2E shards", () => {
  assert.deepEqual(
    [...ci.slice(ci.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "build-and-test", "e2e-image", "e2e-test"],
  );
  assert.match(ci, /name: Packaged macOS startup smoke/u);
  assert.match(ci, /run: npm run test:packaged-startup-macos/u);
  assert.match(ci, /name: Build, lint, and unit tests/u);
  assert.match(ci, /run: npm run test:ci/u);
  assert.match(ci, /name: Build E2E image/u);
  assert.match(ci, /image: \$\{\{ steps\.image\.outputs\.tag \}\}/u);
  assert.match(ci, /terminay-e2e:ci-\$GITHUB_SHA/u);
  assert.equal((ci.match(/name: Require amd64 Docker host/g) ?? []).length, 2);
  assert.equal((ci.match(/x86_64\|amd64/g) ?? []).length, 2);
  assert.match(ci, /docker save --output \.docker-cache\/e2e-image\/terminay-e2e-image\.tar "\$IMAGE_TAG"/u);
  assert.match(ci, /tar -tf \.docker-cache\/e2e-image\/terminay-e2e-image\.tar >\/dev\/null/u);
  assert.match(ci, /gzip -1 --no-name \.docker-cache\/e2e-image\/terminay-e2e-image\.tar/u);
  assert.match(ci, /gzip -t \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
  assert.match(ci, /image-id: \$\{\{ steps\.archive\.outputs\.image_id \}\}/u);
  assert.match(ci, /name: terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
  assert.match(ci, /retention-days: 1/u);
  assert.match(ci, /shard: \[1, 2, 3, 4, 5\]/u);
  assert.match(ci, /name: E2E \(\$\{\{ matrix\.shard \}\}\/5\)/u);
  assert.doesNotMatch(ci, /ubuntu-24\.04|standalone-server|WebRTC/u);
});

test("only E2E shards wait for their shared image and all jobs use declared runners", () => {
  assert.equal((ci.match(/^ {4}needs: e2e-image$/gmu) ?? []).length, 1);
  assert.equal((ci.match(/^ {4}runs-on: ubuntu-latest$/gmu) ?? []).length, 3);
  assert.match(
    ci,
    /runs-on: \$\{\{ github\.server_url == 'https:\/\/github\.com' && 'macos-latest' \|\| 'ubuntu-latest' \}\}/u,
  );
  assert.match(ci, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(ci, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
  assert.match(ci, /cancel-in-progress: true/u);
});

test("Electron shards load the shared Docker image and preserve distinct Playwright artifacts", () => {
  const e2e = ci.slice(ci.indexOf("  e2e-test:"));
  assert.match(e2e, /uses: actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(e2e, /docker load --input \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
  assert.match(e2e, /EXPECTED_IMAGE_ID: \$\{\{ needs\.e2e-image\.outputs\.image-id \}\}/u);
  assert.match(e2e, /TERMINAY_E2E_IMAGE: \$\{\{ needs\.e2e-image\.outputs\.image \}\}/u);
  assert.match(e2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
  assert.match(e2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
  assert.match(e2e, /TERMINAY_E2E_ARTIFACT_DIR: \$\{\{ github\.workspace \}\}\/.docker-cache\/e2e\/shard-\$\{\{ matrix\.shard \}\}-of-5/u);
  assert.match(e2e, /npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/5/u);
  assert.doesNotMatch(e2e, /test:e2e:host|playwright install|setup-node/u);
  assert.match(e2e, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(e2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
  assert.match(e2e, /retention-days: 7/u);
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
