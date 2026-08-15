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

function job(name) {
  const header = `  ${name}:\n`;
  const start = ci.indexOf(header);
  assert.notEqual(start, -1, `CI must declare ${name}`);
  const remainder = ci.slice(start + header.length);
  const next = remainder.search(/^  [a-z][a-z0-9-]+:\n/mu);
  return next === -1 ? ci.slice(start) : ci.slice(start, start + header.length + next);
}

test("pull-request CI selects one provider-specific E2E image and five-shard pair", () => {
  assert.deepEqual(
    [...ci.slice(ci.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["github-packaged-macos-smoke", "gitea-packaged-macos-smoke", "build-and-test", "github-e2e-image", "github-e2e-test", "gitea-e2e-image", "gitea-e2e-test"],
  );
  const githubMacSmoke = job("github-packaged-macos-smoke");
  const giteaMacSmoke = job("gitea-packaged-macos-smoke");
  assert.match(githubMacSmoke, /name: Packaged macOS startup smoke/u);
  assert.match(githubMacSmoke, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(githubMacSmoke, /runs-on: macos-latest/u);
  assert.match(githubMacSmoke, /run: npm run test:packaged-startup-macos/u);
  assert.match(githubMacSmoke, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(giteaMacSmoke, /name: Packaged macOS startup smoke/u);
  assert.match(giteaMacSmoke, /if: \$\{\{ github\.server_url != 'https:\/\/github\.com' \}\}/u);
  assert.match(giteaMacSmoke, /runs-on: ubuntu-latest/u);
  assert.match(giteaMacSmoke, /Record unavailable macOS runner/u);
  assert.doesNotMatch(giteaMacSmoke, /(?:ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093)/u);
  assert.match(ci, /name: Build, lint, and unit tests/u);
  assert.match(ci, /run: npm run test:ci/u);
  const githubImage = job("github-e2e-image");
  const githubE2e = job("github-e2e-test");
  const giteaImage = job("gitea-e2e-image");
  const giteaE2e = job("gitea-e2e-test");
  assert.match(githubImage, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(githubE2e, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(giteaImage, /if: \$\{\{ github\.server_url != 'https:\/\/github\.com' \}\}/u);
  assert.match(giteaE2e, /if: \$\{\{ github\.server_url != 'https:\/\/github\.com' \}\}/u);
  assert.match(githubImage, /image: \$\{\{ steps\.image\.outputs\.tag \}\}/u);
  assert.match(giteaImage, /image: \$\{\{ steps\.image\.outputs\.tag \}\}/u);
  assert.match(ci, /terminay-e2e:ci-\$GITHUB_SHA/u);
  assert.equal((ci.match(/name: Require amd64 Docker host/g) ?? []).length, 4);
  assert.equal((ci.match(/x86_64\|amd64/g) ?? []).length, 4);
  assert.match(ci, /docker save --output \.docker-cache\/e2e-image\/terminay-e2e-image\.tar "\$IMAGE_TAG"/u);
  assert.match(ci, /tar -tf \.docker-cache\/e2e-image\/terminay-e2e-image\.tar >\/dev\/null/u);
  assert.match(ci, /gzip -1 --no-name \.docker-cache\/e2e-image\/terminay-e2e-image\.tar/u);
  assert.match(ci, /gzip -t \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
  assert.equal((ci.match(/image-id: \$\{\{ steps\.archive\.outputs\.image_id \}\}/g) ?? []).length, 2);
  assert.match(ci, /name: terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
  assert.match(ci, /retention-days: 1/u);
  assert.match(githubImage, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.doesNotMatch(githubImage, /ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5/u);
  assert.match(giteaImage, /uses: actions\/upload-artifact@ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5/u);
  assert.doesNotMatch(giteaImage, /ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(githubE2e, /shard: \[1, 2, 3, 4, 5\]/u);
  assert.match(giteaE2e, /shard: \[1, 2, 3, 4, 5\]/u);
  assert.match(githubE2e, /name: E2E \(\$\{\{ matrix\.shard \}\}\/5\)/u);
  assert.match(giteaE2e, /name: E2E \(\$\{\{ matrix\.shard \}\}\/5\)/u);
  assert.doesNotMatch(ci, /ubuntu-24\.04|standalone-server|WebRTC/u);
});

test("provider-specific E2E shards wait only for their own image and use declared runners", () => {
  assert.match(job("github-e2e-test"), /needs: github-e2e-image/u);
  assert.match(job("gitea-e2e-test"), /needs: gitea-e2e-image/u);
  assert.equal((ci.match(/^ {4}runs-on: ubuntu-latest$/gmu) ?? []).length, 6);
  assert.match(job("github-packaged-macos-smoke"), /runs-on: macos-latest/u);
  assert.match(ci, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(ci, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
  assert.match(ci, /cancel-in-progress: true/u);
});

test("provider-specific Electron shards load only their compatible artifact actions", () => {
  for (const [e2e, imageJob, downloadAction, uploadAction, excludedAction] of [
    [job("github-e2e-test"), "github-e2e-image", "d3f86a106a0bac45b974a628896c90dbdf5c8093", "ea165f8d65b6e75b540449e92b4886f43607fa02", "9bc31d5ccc31df68ecc42ccf4149144866c47d8a|ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5"],
    [job("gitea-e2e-test"), "gitea-e2e-image", "9bc31d5ccc31df68ecc42ccf4149144866c47d8a", "ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5", "d3f86a106a0bac45b974a628896c90dbdf5c8093|ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ]) {
    assert.match(e2e, new RegExp(`uses: actions/download-artifact@${downloadAction}`, "u"));
    assert.match(e2e, new RegExp(`uses: actions/upload-artifact@${uploadAction}`, "u"));
    assert.doesNotMatch(e2e, new RegExp(excludedAction, "u"));
    assert.match(e2e, /docker load --input \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
    assert.match(e2e, new RegExp([
      "EXPECTED_IMAGE_ID: \\$\\{\\{ needs\\.", imageJob, "\\.outputs\\.image-id \\}\\}",
    ].join(""), "u"));
    assert.match(e2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
    assert.match(e2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
    assert.match(e2e, /if: \$\{\{ always\(\) \}\}/u);
    assert.match(e2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2e, /retention-days: 7/u);
  }
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
