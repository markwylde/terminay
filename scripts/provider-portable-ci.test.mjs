import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [githubCi, giteaCi, serverImage, triggerRelease, decision, packageJson] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".gitea/workflows/ci.yml"),
  read(".github/workflows/server-image.yml"),
  read(".github/workflows/trigger-release.yml"),
  read("specs/decisions/provider-portable-parallel-ci.md"),
  read("package.json"),
]);

function job(workflow, name) {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `CI must declare ${name}`);
  const remainder = workflow.slice(start + header.length);
  const next = remainder.search(/^  [a-z][a-z0-9-]+:\n/mu);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
}

test("GitHub and Gitea discover separate provider-specific CI workflows", () => {
  assert.deepEqual(
    [...githubCi.slice(githubCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "build-and-test", "e2e-image", "e2e-test"],
  );
  assert.deepEqual(
    [...giteaCi.slice(giteaCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "build-and-test", "e2e-image", "e2e-test"],
  );
  assert.match(job(githubCi, "packaged-macos-smoke"), /^    runs-on: macos-latest$/mu);
  assert.match(job(githubCi, "packaged-macos-smoke"), /stage-macos-app-from-dmg\.sh/u);
  assert.match(job(githubCi, "packaged-macos-smoke"), /hdiutil create/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /Record unavailable macOS runner/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /Gitea has no macOS runners/u);
  assert.match(triggerRelease, /stage-macos-app-from-dmg\.sh/u);
  assert.doesNotMatch(triggerRelease, /TERMINAY_PACKAGED_APP="\$APP_BUNDLE"/u);
  assert.doesNotMatch(githubCi, /github\.server_url|gitea-e2e|ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a/u);
  assert.doesNotMatch(giteaCi, /github\.server_url|github-e2e|ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
});

test("provider CI retains its shared-image fan-out and declared runner bounds", () => {
  assert.match(JSON.parse(packageJson).scripts["test:ci"], /test:release-evidence/u);
  assert.match(triggerRelease, /npm run test:release-evidence/u);
  assert.match(decision, /test:release-evidence/u);
  for (const workflow of [githubCi, giteaCi]) {
    assert.match(workflow, /name: Build, lint, and unit tests/u);
    assert.match(workflow, /run: npm run test:ci/u);
    assert.match(job(workflow, "e2e-test"), /needs: e2e-image/u);
    assert.match(workflow, /terminay-e2e:ci-\$GITHUB_SHA/u);
    assert.equal((workflow.match(/name: Require amd64 Docker host/g) ?? []).length, 2);
    assert.equal((workflow.match(/x86_64\|amd64/g) ?? []).length, 2);
    assert.match(workflow, /docker save --output \.docker-cache\/e2e-image\/terminay-e2e-image\.tar "\$IMAGE_TAG"/u);
    assert.match(workflow, /tar -tf \.docker-cache\/e2e-image\/terminay-e2e-image\.tar >\/dev\/null/u);
    assert.match(workflow, /gzip -1 --no-name \.docker-cache\/e2e-image\/terminay-e2e-image\.tar/u);
    assert.match(workflow, /gzip -t \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
    assert.match(workflow, /image-id: \$\{\{ steps\.archive\.outputs\.image_id \}\}/u);
    assert.match(workflow, /name: terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
    assert.match(workflow, /retention-days: 1/u);
    assert.match(job(workflow, "e2e-test"), /shard: \[1, 2, 3, 4, 5\]/u);
    assert.match(job(workflow, "e2e-test"), /name: E2E \(\$\{\{ matrix\.shard \}\}\/5\)/u);
    assert.match(workflow, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
    assert.match(workflow, /cancel-in-progress: true/u);
  }
});

test("each provider loads only its compatible artifact-action generation", () => {
  for (const [workflow, downloadAction, uploadAction, excludedAction] of [
    [githubCi, "d3f86a106a0bac45b974a628896c90dbdf5c8093", "ea165f8d65b6e75b540449e92b4886f43607fa02", "9bc31d5ccc31df68ecc42ccf4149144866c47d8a|ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5"],
    [giteaCi, "9bc31d5ccc31df68ecc42ccf4149144866c47d8a", "ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5", "d3f86a106a0bac45b974a628896c90dbdf5c8093|ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ]) {
    const e2e = job(workflow, "e2e-test");
    assert.match(e2e, new RegExp(`uses: actions/download-artifact@${downloadAction}`, "u"));
    assert.match(e2e, new RegExp(`uses: actions/upload-artifact@${uploadAction}`, "u"));
    assert.doesNotMatch(workflow, new RegExp(excludedAction, "u"));
    assert.match(e2e, /docker load --input \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
    assert.match(e2e, /EXPECTED_IMAGE_ID: \$\{\{ needs\.e2e-image\.outputs\.image-id \}\}/u);
    assert.match(e2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
    assert.match(e2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
    assert.match(e2e, /if: \$\{\{ always\(\) \}\}/u);
    assert.match(e2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2e, /retention-days: 7/u);
  }
});

test("server image publication is versioned-release-only", () => {
  assert.doesNotMatch(serverImage, /^ {2}pull_request:/mu);
  assert.doesNotMatch(serverImage, /^ {4}branches:/mu);
  assert.match(serverImage, /^ {4}tags:/mu);
  assert.doesNotMatch(triggerRelease, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
  assert.match(decision, /Native arm64 qualification belongs to the manually triggered release/u);
});
