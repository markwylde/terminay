import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [giteaCi, serverImage, triggerRelease, decision, packageJson, packagedBuiltIns] = await Promise.all([
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

test("Gitea is the only provider that runs verification CI", async () => {
  const { readdir } = await import("node:fs/promises");
  const githubWorkflows = (await readdir(new URL("../.github/workflows/", import.meta.url))).sort();
  assert.deepEqual(githubWorkflows, ["main-prerelease.yml", "server-image.yml", "trigger-release.yml"],
    "GitHub mirrors the repository and runs only release workflows; verification runs on Gitea");
  // The rolling prerelease publishes the same signed archives a tag does. It
  // must stay a publication path: nothing here may become a second, weaker
  // verification lane beside Gitea's.
  const mainPrerelease = await read(".github/workflows/main-prerelease.yml");
  assert.doesNotMatch(mainPrerelease, /npm run test:ci|npm run test:workspaces|npm run smoke\b/u);
  assert.match(mainPrerelease, /release-signature\.mjs sign/u);
  assert.deepEqual(
    [...giteaCi.slice(giteaCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["packaged-macos-smoke", "packaged-linux-built-in-lifecycle", "build-and-test", "mcp-cli-compatibility", "e2e-image", "e2e-test"],
  );
  assert.match(job(giteaCi, "packaged-macos-smoke"), /^ {4}runs-on: xcode-16$/mu);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /packaged-macos-pr-smoke\.sh/u);
  assert.doesNotMatch(job(giteaCi, "packaged-macos-smoke"), /codesign --verify/u);
  assert.doesNotMatch(job(giteaCi, "packaged-macos-smoke"), /setup-node/u);
  assert.doesNotMatch(job(giteaCi, "packaged-macos-smoke"), /unavailable macOS runner|Gitea has no macOS runners/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /Require the native supported macOS arm64 architecture/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test "\$\(node -p 'process\.arch'\)" = arm64/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test "\$\(uname -m\)" = arm64/u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /test:packaged-built-in-extension-runtime/u);
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
  assert.doesNotMatch(giteaCi, /github\.server_url|github-e2e|ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(decision, /launchctl managername/u);
  assert.match(decision, /use-mock-keychain/u);
});

test("Gitea CI retains its shared-image fan-out and declared runner bounds", () => {
  assert.match(JSON.parse(packageJson).scripts["test:ci"], /test:release-evidence/u);
  assert.match(triggerRelease, /npm run test:release-evidence/u);
  assert.match(decision, /test:release-evidence/u);
  assert.match(giteaCi, /name: Build, lint, and unit tests/u);
  assert.match(giteaCi, /run: npm run test:ci/u);
  assert.match(job(giteaCi, "e2e-test"), /needs: e2e-image/u);
  assert.equal((giteaCi.match(/name: Require amd64 Docker host/g) ?? []).length, 2);
  assert.equal((giteaCi.match(/x86_64\|amd64/g) ?? []).length, 2);
  assert.match(job(giteaCi, "e2e-test"), /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/u);
  assert.match(job(giteaCi, "e2e-test"), /name: E2E \(\$\{\{ matrix\.shard \}\}\/10\)/u);
  assert.match(giteaCi, /group: terminay-ci-\$\{\{ github\.ref \}\}/u);
  assert.match(giteaCi, /cancel-in-progress: true/u);

  assert.match(giteaCi, /git\.i\.wylde\.net\/markwylde\/terminay-e2e:\$IMAGE_KEY/u);
  assert.match(giteaCi, /docker manifest inspect "\$IMAGE_TAG"/u);
  assert.match(giteaCi, /docker push "\$IMAGE_TAG"/u);
  assert.match(job(giteaCi, "e2e-test"), /docker pull "\$IMAGE_TAG"/u);
  assert.doesNotMatch(giteaCi, /docker save|docker load|terminay-e2e-image-\$\{\{ github\.sha \}\}/u);
});

test("Gitea CI uses its compatible shared-image transport", () => {
  const giteaE2e = job(giteaCi, "e2e-test");
  assert.match(giteaE2e, /uses: actions\/upload-artifact@ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5/u);
  assert.doesNotMatch(giteaCi, /d3f86a106a0bac45b974a628896c90dbdf5c8093|ea165f8d65b6e75b540449e92b4886f43607fa02|actions\/download-artifact/u);
  assert.match(giteaE2e, /docker login git\.i\.wylde\.net/u);
  assert.match(giteaE2e, /docker pull "\$IMAGE_TAG"/u);
  assert.match(giteaE2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
  assert.match(giteaE2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
  assert.match(giteaE2e, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(giteaE2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-10/u);
  assert.match(giteaE2e, /retention-days: 7/u);
});

test("server image publication is versioned-release-only", () => {
  assert.doesNotMatch(serverImage, /^ {2}pull_request:/mu);
  assert.doesNotMatch(serverImage, /^ {4}branches:/mu);
  assert.match(serverImage, /^ {4}tags:/mu);
  assert.doesNotMatch(triggerRelease, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
  assert.match(decision, /Native arm64 qualification belongs to the manually triggered release/u);
});
