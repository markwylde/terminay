import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [githubCi, giteaCi, serverImage, triggerRelease, decision, packageJson, packagedBuiltIns] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".gitea/workflows/ci.yml"),
  read(".github/workflows/server-image.yml"),
  read(".github/workflows/trigger-release.yml"),
  read("openspec/adr/0010-provider-portable-parallel-pull-request-ci.md"),
  read("package.json"),
  read("scripts/run-packaged-built-in-extension-runtime-linux.sh"),
]);

function job(workflow, name) {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `CI must declare ${name}`);
  const remainder = workflow.slice(start + header.length);
  const next = remainder.search(/^ {2}[a-z][a-z0-9-]+:\n/mu);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
}

test("GitHub and Gitea discover separate provider-specific CI workflows", () => {
  assert.deepEqual(
    [...githubCi.slice(githubCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "packaged-linux-built-in-lifecycle", "build-and-test", "mcp-cli-compatibility", "e2e-image", "e2e-test"],
  );
  assert.deepEqual(
    [...giteaCi.slice(giteaCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "packaged-linux-built-in-lifecycle", "build-and-test", "mcp-cli-compatibility", "e2e-image", "e2e-test"],
  );
  assert.match(job(githubCi, "packaged-macos-smoke"), /^ {4}runs-on: macos-latest$/mu);
  assert.match(job(githubCi, "packaged-macos-smoke"), /packaged-macos-pr-smoke\.sh/u);
  assert.doesNotMatch(job(githubCi, "packaged-macos-smoke"), /codesign --verify/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /^ {4}runs-on: xcode-16$/mu);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /packaged-macos-pr-smoke\.sh/u);
  assert.doesNotMatch(job(giteaCi, "packaged-macos-smoke"), /setup-node/u);
  assert.doesNotMatch(job(giteaCi, "packaged-macos-smoke"), /unavailable macOS runner|Gitea has no macOS runners/u);
  assert.match(job(githubCi, "packaged-macos-smoke"), /Require the native supported macOS arm64 architecture/u);
  assert.match(job(githubCi, "packaged-macos-smoke"), /test "\$\(node -p 'process\.arch'\)" = arm64/u);
  assert.match(job(githubCi, "packaged-macos-smoke"), /test "\$\(uname -m\)" = arm64/u);
  assert.match(job(githubCi, "packaged-macos-smoke"), /test:packaged-built-in-extension-runtime/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /Require the native supported macOS arm64 architecture/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test "\$\(node -p 'process\.arch'\)" = arm64/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test "\$\(uname -m\)" = arm64/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test:packaged-built-in-extension-runtime/u);
  const packagedLinux = job(githubCi, "packaged-linux-built-in-lifecycle");
  assert.match(packagedLinux, /target: linux-x64/u);
  assert.match(packagedLinux, /target: linux-arm64/u);
  assert.match(packagedLinux, /runner: ubuntu-24\.04-arm/u);
  assert.match(packagedLinux, /node_arch: arm64/u);
  assert.match(packagedLinux, /uname_arch: aarch64/u);
  assert.match(packagedLinux, /Require the native supported Linux architecture/u);
  assert.match(packagedLinux, /test "\$\(node -p 'process\.arch'\)" = "\$EXPECTED_NODE_ARCH"/u);
  assert.match(packagedLinux, /test "\$\(uname -m\)" = "\$EXPECTED_UNAME_ARCH"/u);
  assert.match(packagedLinux, /npm ci/u);
  assert.match(packagedLinux, /test:packaged-built-in-extension-runtime:linux -- \$\{\{ matrix\.target \}\}/u);
  const giteaPackagedLinux = job(giteaCi, "packaged-linux-built-in-lifecycle");
  assert.match(giteaPackagedLinux, /^ {4}runs-on: ubuntu-latest$/mu);
  assert.match(giteaPackagedLinux, /Require the native supported Linux x64 architecture/u);
  assert.match(giteaPackagedLinux, /test "\$\(node -p 'process\.arch'\)" = x64/u);
  assert.match(giteaPackagedLinux, /test "\$\(uname -m\)" = x86_64/u);
  assert.match(giteaPackagedLinux, /npm ci/u);
  assert.match(giteaPackagedLinux, /test:packaged-built-in-extension-runtime:linux -- linux-x64/u);
  const applicationGraphBuild = packagedBuiltIns.indexOf('npm run build:application-graph')
  const postcompile = packagedBuiltIns.indexOf('npm run build:server-postcompile')
  assert.ok(applicationGraphBuild >= 0 && postcompile > applicationGraphBuild,
    'the standalone arm64 lifecycle must compile workspace dependencies before packing the server')
  assert.match(triggerRelease, /stage-macos-app-from-dmg\.sh/u);
  assert.doesNotMatch(triggerRelease, /TERMINAY_PACKAGED_APP="\$APP_BUNDLE"/u);
  assert.doesNotMatch(githubCi, /github\.server_url|gitea-e2e|ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a/u);
  assert.doesNotMatch(giteaCi, /github\.server_url|github-e2e|ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(decision, /launchctl managername/u);
  assert.match(decision, /use-mock-keychain/u);
});

test("provider CI retains its shared-image fan-out and declared runner bounds", () => {
  assert.match(JSON.parse(packageJson).scripts["test:ci"], /test:release-evidence/u);
  assert.match(triggerRelease, /npm run test:release-evidence/u);
  assert.match(decision, /test:release-evidence/u);
  for (const workflow of [githubCi, giteaCi]) {
    assert.match(workflow, /name: Build, lint, and unit tests/u);
    assert.match(workflow, /run: npm run test:ci/u);
    assert.match(job(workflow, "e2e-test"), /needs: e2e-image/u);
    assert.equal((workflow.match(/name: Require amd64 Docker host/g) ?? []).length, 2);
    assert.equal((workflow.match(/x86_64\|amd64/g) ?? []).length, 2);
    assert.match(job(workflow, "e2e-test"), /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/u);
    assert.match(job(workflow, "e2e-test"), /name: E2E \(\$\{\{ matrix\.shard \}\}\/10\)/u);
    assert.match(workflow, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
    assert.match(workflow, /cancel-in-progress: true/u);
  }

  assert.match(githubCi, /terminay-e2e:ci-\$GITHUB_SHA/u);
  assert.match(githubCi, /docker save --output \.docker-cache\/e2e-image\/terminay-e2e-image\.tar "\$IMAGE_TAG"/u);
  assert.match(githubCi, /tar -tf \.docker-cache\/e2e-image\/terminay-e2e-image\.tar >\/dev\/null/u);
  assert.match(githubCi, /gzip -1 --no-name \.docker-cache\/e2e-image\/terminay-e2e-image\.tar/u);
  assert.match(githubCi, /gzip -t \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
  assert.match(githubCi, /image-id: \$\{\{ steps\.archive\.outputs\.image_id \}\}/u);
  assert.match(githubCi, /name: terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
  assert.match(githubCi, /retention-days: 1/u);

  assert.match(giteaCi, /git\.i\.wylde\.net\/markwylde\/terminay-e2e:\$IMAGE_KEY/u);
  assert.match(giteaCi, /docker manifest inspect "\$IMAGE_TAG"/u);
  assert.match(giteaCi, /docker push "\$IMAGE_TAG"/u);
  assert.match(job(giteaCi, "e2e-test"), /docker pull "\$IMAGE_TAG"/u);
  assert.doesNotMatch(giteaCi, /docker save|docker load|terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
});

test("each provider uses its compatible shared-image transport", () => {
  const githubE2e = job(githubCi, "e2e-test");
  assert.match(githubE2e, /uses: actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(githubE2e, /uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.doesNotMatch(githubCi, /9bc31d5ccc31df68ecc42ccf4149144866c47d8a|ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5/u);
  assert.match(githubE2e, /docker load --input \.docker-cache\/e2e-image\/terminay-e2e-image\.tar\.gz/u);
  assert.match(githubE2e, /EXPECTED_IMAGE_ID: \$\{\{ needs\.e2e-image\.outputs\.image-id \}\}/u);

  const giteaE2e = job(giteaCi, "e2e-test");
  assert.match(giteaE2e, /uses: actions\/upload-artifact@ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5/u);
  assert.doesNotMatch(giteaCi, /d3f86a106a0bac45b974a628896c90dbdf5c8093|ea165f8d65b6e75b540449e92b4886f43607fa02|actions\/download-artifact/u);
  assert.match(giteaE2e, /docker login git\.i\.wylde\.net/u);
  assert.match(giteaE2e, /docker pull "\$IMAGE_TAG"/u);

  for (const e2e of [githubE2e, giteaE2e]) {
    assert.match(e2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
    assert.match(e2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
    assert.match(e2e, /if: \$\{\{ always\(\) \}\}/u);
    assert.match(e2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-10/u);
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
