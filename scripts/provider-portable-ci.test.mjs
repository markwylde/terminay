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
  assert.deepEqual(githubWorkflows, ["canary.yml", "main-prerelease.yml", "nightly.yml", "server-image.yml", "trigger-release.yml"],
    "GitHub mirrors the repository and runs only release workflows; verification runs on Gitea");
  // The rolling prerelease publishes the same signed archives a tag does. It
  // must stay a publication path: nothing here may become a second, weaker
  // verification lane beside Gitea's.
  const mainPrerelease = await read(".github/workflows/main-prerelease.yml");
  assert.doesNotMatch(mainPrerelease, /npm run test:ci|npm run test:workspaces|npm run smoke\b/u);
  assert.match(mainPrerelease, /release-signature\.mjs sign/u);
  // Its callers only schedule it: neither runs a check of its own.
  for (const caller of [".github/workflows/canary.yml", ".github/workflows/nightly.yml"]) {
    const text = await read(caller);
    assert.doesNotMatch(text, /npm run test|npm run smoke\b|node --test/u, caller);
    assert.match(text, /uses: \.\/\.github\/workflows\/main-prerelease\.yml/u, caller);
  }
  assert.deepEqual(
    [...giteaCi.slice(giteaCi.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]),
    ["e2e-image", "linux-artifacts", "packaged-macos-smoke", "packaged-linux-built-in-lifecycle", "linux-glibc-floor", "standalone-systemd-restart", "build-and-test", "workspace-tests", "real-webrtc", "container-image-smoke", "bot-mcp-runtime", "mcp-cli-compatibility", "e2e-test"],
  );
  // The official image is built and paired with on every pull request, by the
  // same client code Desktop ships, before a release can publish it.
  assert.match(job(giteaCi, "container-image-smoke"), /docker build[\s\S]*--file \.\/Dockerfile/u);
  assert.match(job(giteaCi, "container-image-smoke"), /node scripts\/container-image-smoke\.mjs/u);
  const botMcp = job(giteaCi, "bot-mcp-runtime");
  assert.match(botMcp, /run: npm run test:bots:mcp-real/u);
  assert.doesNotMatch(botMcp, /^ {4}if:|continue-on-error/mu,
    "bot ownership coverage must not be conditional or allowed to fail");
  // Every case runs: a job that named cases with --only could drop the control.
  assert.doesNotMatch(job(giteaCi, "container-image-smoke"), /--only/u);
  assert.match(job(giteaCi, "container-image-smoke"), /prune-ci-docker-images\.sh/u);
  assert.doesNotMatch(job(giteaCi, "container-image-smoke"), /docker push/u);
  // Docker Hub rate-limits the Gitea runners: every job that builds an image
  // logs in to the internal registry and takes Docker Hub images from its mirror.
  assert.match(giteaCi, /^env:\n {2}TERMINAY_DOCKER_HUB_MIRROR: git\.i\.wylde\.net\/docker$/mu);
  for (const name of ["linux-glibc-floor", "container-image-smoke", "bot-mcp-runtime", "mcp-cli-compatibility", "e2e-image"]) {
    assert.match(job(giteaCi, name), /docker login git\.i\.wylde\.net --username "\$GITHUB_ACTOR" --password-stdin/u, name);
    assert.doesNotMatch(job(giteaCi, name), /docker login (?!git\.i\.wylde\.net)/u, name);
  }
  for (const name of ["container-image-smoke", "e2e-image"])
    assert.match(job(giteaCi, name), /docker build \\\n(?: {12}--[a-z]+(?: \S+)? \\\n)*? {12}\$\(sh scripts\/docker-hub-build-args\.sh\) \\/u, name);
  // Real-peer tests skip wherever the selected runtime is not staged, which is
  // everywhere but this job; it must keep staging it and running them.
  assert.match(job(giteaCi, "real-webrtc"), /npm run test:real-webrtc/u);
  assert.match(JSON.parse(packageJson).scripts["test:real-webrtc"], /^node scripts\/stage-selected-secure-werift-runtime\.mjs /u);
  assert.match(job(giteaCi, "packaged-macos-smoke"), /^ {4}runs-on: macos$/mu);
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
  assert.match(giteaPackagedLinux, /sh scripts\/install-ci-dependencies\.sh/u);
  assert.match(giteaPackagedLinux, /test:packaged-built-in-extension-runtime:linux -- linux-x64/u);
  // Both x64 Linux artifacts are built in the floor image the release lanes
  // use, checked against the glibc floor, and run on a clean floor host
  // before a change can merge (ADR-0077).
  const giteaGlibcFloor = job(giteaCi, "linux-glibc-floor");
  assert.match(giteaGlibcFloor, /^ {4}runs-on: ubuntu-latest$/mu);
  assert.match(giteaGlibcFloor, /test "\$\(docker info --format '\{\{\.Architecture\}\}'\)" = x86_64/u);
  const producer = job(giteaCi, "linux-artifacts");
  assert.match(producer, /standalone-prebuilt-application\.mjs build linux-x64.*&& sh scripts\/build-linux-standalone-archive\.sh --prebuilt/u);
  assert.match(producer, /electron-builder --linux AppImage --x64 --publish never/u);
  assert.match(producer, /build-linux-standalone-archive\.sh --prebuilt --compression-level 1 linux-x64 main/u);
  assert.match(giteaGlibcFloor, /node scripts\/linux-glibc-floor\.mjs check --target linux-x64 \\\n\s+release\/0\.0\.0\/Terminay-Linux-0\.0\.0\.AppImage \\\n\s+release\/standalone\/terminay-server-main-linux-x64\.tar\.gz/u);
  assert.match(giteaGlibcFloor, /sh scripts\/probe-linux-glibc-floor\.sh appimage release\/0\.0\.0\/Terminay-Linux-0\.0\.0\.AppImage/u);
  assert.match(giteaGlibcFloor, /sh scripts\/probe-linux-glibc-floor\.sh server-archive release\/standalone\/terminay-server-main-linux-x64\.tar\.gz/u);
  assert.match(giteaGlibcFloor, /prune-ci-docker-images\.sh/u);
  assert.doesNotMatch(giteaGlibcFloor, /npm ci/u, "the floor job installs nothing on the host it does not ship");
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
  // The gate and the workspace suites run beside each other. Between them
  // they run exactly what `npm run test:ci` runs, each part once.
  const parts = (command) => command.split(" && ").sort();
  const gate = /^ {8}run: (npm run smoke && .*)$/mu.exec(job(giteaCi, "build-and-test"))?.[1] ?? "";
  const workspaces = /^ {8}run: (npm run test:workspaces)$/mu.exec(job(giteaCi, "workspace-tests"))?.[1] ?? "";
  assert.deepEqual(
    parts(`${gate} && ${workspaces}`),
    parts(JSON.parse(packageJson).scripts["test:ci"]),
    "the two unit jobs must cover npm run test:ci between them",
  );
  // Each Linux install uses the daemon-owned npm download volume. Archiving
  // that cache through setup-node uploaded it again at the end of every job.
  assert.doesNotMatch(giteaCi, /^ {10}cache: npm$/mu);
  // setup-node caches on its own when package.json names a package manager.
  assert.equal(
    (giteaCi.match(/uses: actions\/setup-node@/gu) ?? []).length,
    (giteaCi.match(/^ {10}package-manager-cache: false$/gmu) ?? []).length,
  );
  assert.equal((giteaCi.match(/npm_config_cache: \/var\/cache\/terminay-npm/gu) ?? []).length, 7);
  assert.match(job(giteaCi, "e2e-test"), /needs: e2e-image/u);
  assert.equal((giteaCi.match(/name: Require amd64 Docker host/g) ?? []).length, 2);
  assert.equal((giteaCi.match(/x86_64\|amd64/g) ?? []).length, 2);
  assert.match(job(giteaCi, "e2e-test"), /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18\]/u);
  assert.match(job(giteaCi, "e2e-test"), /name: E2E \(\$\{\{ matrix\.shard \}\}\/18\)/u);
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
  assert.doesNotMatch(giteaCi, /d3f86a106a0bac45b974a628896c90dbdf5c8093|ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.doesNotMatch(giteaE2e, /actions\/download-artifact/u);
  assert.match(giteaE2e, /docker login git\.i\.wylde\.net/u);
  assert.match(giteaE2e, /docker pull "\$IMAGE_TAG"/u);
  assert.match(giteaE2e, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
  assert.match(giteaE2e, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
  assert.match(giteaE2e, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(giteaE2e, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-18/u);
  assert.match(giteaE2e, /retention-days: 7/u);
});

const WATCHDOG_SHELL = "shell: node scripts/ci-watchdog.mjs bash --noprofile --norc -eo pipefail {0}";

function jobNames(workflow) {
  return [...workflow.slice(workflow.indexOf("jobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map((match) => match[1]);
}

function steps(block) {
  return block.split(/\n(?= {6}- name: )/u).slice(1);
}

test("every CI test job explains itself before its timeout", async () => {
  const { leadMs } = await import("./ci-watchdog.mjs");
  const benchmarks = await read(".gitea/workflows/benchmarks.yml");
  const playwrightConfig = await read("playwright.config.ts");
  const watched = [
    ...jobNames(giteaCi).filter((name) => name !== "e2e-image").map((name) => [giteaCi, name]),
    ...jobNames(benchmarks).map((name) => [benchmarks, name]),
  ];
  for (const [workflow, name] of watched) {
    const block = job(workflow, name);
    const timeout = /^ {4}timeout-minutes: (\d+)$/mu.exec(block)?.[1];
    assert.ok(timeout, `${name} declares a timeout`);
    // The watchdog reads the job's budget; it must be the job's own.
    assert.match(block, new RegExp(`^ {6}TERMINAY_CI_JOB_TIMEOUT_MINUTES: ${timeout}$`, "mu"), `${name} tells the watchdog its timeout`);
    const [first, ...rest] = steps(block);
    assert.match(first, /- name: Arm the timeout watchdog\n {8}run: echo "TERMINAY_CI_JOB_STARTED_AT=\$\(date \+%s\)" >> "\$GITHUB_ENV"/u,
      `${name} records when it started before anything else`);
    // Every step that installs, builds, or tests runs under the watchdog.
    for (const step of rest) {
      if (!/npm ci|npm run|node --test|node scripts\/|docker (?:build|pull)/u.test(step)) continue;
      if (/node scripts\/e2e-(?:base-)?image(?:-cache)?-key\.mjs|prune-ci-docker-images/u.test(step)) continue;
      assert.ok(step.includes(`\n        ${WATCHDOG_SHELL}\n`), `${name}: "${step.split("\n")[0].trim()}" runs under the watchdog`);
    }
  }
  assert.ok((giteaCi.match(new RegExp(WATCHDOG_SHELL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) ?? []).length >= 15);

  // Playwright stops a CI shard itself, reports the tests it interrupted,
  // and writes its artifacts well before the watchdog and the job timeout.
  const globalTimeout = /globalTimeout: process\.env\.CI \? (\d+) \* 60_000 : 0/u.exec(playwrightConfig)?.[1];
  assert.ok(globalTimeout, "CI shards carry a Playwright global timeout");
  const e2eTimeoutMinutes = Number(/^ {4}timeout-minutes: (\d+)$/mu.exec(job(giteaCi, "e2e-test"))[1]);
  const setupAndSalvageMinutes = 2;
  assert.ok(
    Number(globalTimeout) * 60_000 + setupAndSalvageMinutes * 60_000 <= e2eTimeoutMinutes * 60_000 - leadMs(e2eTimeoutMinutes * 60_000),
    "the shard's own budget, its setup, and its artifact copy fit before the watchdog fires",
  );
  const e2eSteps = steps(job(giteaCi, "e2e-test"));
  const upload = e2eSteps.findIndex((step) => step.includes("name: Upload Playwright artifacts"));
  assert.match(e2eSteps[upload], /if: \$\{\{ always\(\) \}\}/u);
  assert.ok(upload > e2eSteps.findIndex((step) => step.includes("name: Run end-to-end test shard")));
  const runner = await read("scripts/run-e2e-container.sh");
  assert.match(runner, /cleanup\(\) \{\n {2}if docker container inspect "\$container" >\/dev\/null 2>&1; then\n {4}copy_artifacts/u,
    "a cancelled container run copies its artifacts out before the container is removed");
  assert.match(job(giteaCi, "packaged-macos-smoke"), /- name: Upload packaged smoke diagnostics\n {8}if: \$\{\{ always\(\) \}\}/u);
});

test("benchmarks that measure the machine run apart from every gate", async () => {
  const { readdir } = await import("node:fs/promises");
  const benchmarks = await read(".gitea/workflows/benchmarks.yml");
  const scripts = JSON.parse(packageJson).scripts;
  // Weekly and on demand only: never a pull request or a push.
  const triggers = benchmarks.slice(benchmarks.indexOf("\non:\n") + 5, benchmarks.indexOf("\npermissions:"));
  assert.deepEqual([...triggers.matchAll(/^ {2}([a-z_]+):/gmu)].map((match) => match[1]), ["workflow_dispatch", "schedule"]);
  assert.match(triggers, /- cron: "[^"]+"/u);
  for (const name of jobNames(benchmarks)) {
    assert.match(job(benchmarks, name), /^ {4}continue-on-error: true$/mu, `${name} never fails the workflow`);
  }
  const loadTest = "scripts/task20-secure-werift-multi-peer-load.test.mjs";
  assert.match(scripts["benchmark:webrtc-multi-peer-load"], new RegExp(`TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT=[^ ]+ node --test(?: --[^ ]+)* ${loadTest.replaceAll(".", "\\.")}$`, "u"));
  assert.match(job(benchmarks, "webrtc-multi-peer-load"), /run: npm run benchmark:webrtc-multi-peer-load/u);
  assert.match(job(benchmarks, "webrtc-multi-peer-load"), /TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT: \$\{\{ github\.workspace \}\}\/build\/webrtc-runtime/u);

  // No gating path reaches a benchmark: not a gating workflow, and not any
  // npm script those workflows run, followed through every npm run.
  const gating = (await readdir(new URL("../.gitea/workflows/", import.meta.url)))
    .filter((name) => name !== "benchmarks.yml" && /\.ya?ml$/u.test(name));
  const reached = new Set();
  const visit = (text) => {
    for (const [, name] of text.matchAll(/npm run ([\w:.-]+)/gu)) {
      if (reached.has(name) || !scripts[name]) continue;
      reached.add(name);
      visit(scripts[name]);
    }
  };
  const gatingText = [];
  for (const name of gating) {
    const workflow = await read(`.gitea/workflows/${name}`);
    gatingText.push(workflow);
    visit(workflow);
  }
  for (const name of reached) gatingText.push(scripts[name]);
  assert.ok(reached.has("smoke") && reached.has("test:real-webrtc"), "the gating scripts are followed");
  for (const text of gatingText) {
    assert.doesNotMatch(text, /task20-secure-werift-multi-peer-load|TERMINAY_SELECTED_WEBRTC_RUNTIME_ROOT|benchmark:/u);
  }
  // Nor does a gating test run pick the file up by a glob.
  for (const text of gatingText) assert.doesNotMatch(text, /node --test[^&\n]*scripts\/\*/u);
});

test("the server image is published only for a release tag or a dispatched nightly or canary, never from a pull request", async () => {
  assert.doesNotMatch(serverImage, /^ {2}pull_request/mu);
  assert.doesNotMatch(serverImage, /^ {4}branches:/mu);
  assert.match(serverImage, /^ {4}tags:/mu);
  // A Nightly or Canary image exists only for a default-branch commit whose prerelease
  // assets published: the prerelease dispatches it last, and the image
  // workflow refuses any other branch, version shape, or foreign commit.
  const mainPrerelease = await read(".github/workflows/main-prerelease.yml");
  assert.match(job(mainPrerelease, "publish-image"), /needs: \[plan, build-desktop, publish\]/u);
  assert.match(job(serverImage, "plan"), /"\$GITHUB_REF" != refs\/heads\/main/u);
  assert.match(job(serverImage, "plan"), /git merge-base --is-ancestor "\$REVISION" "\$GITHUB_SHA"/u);
  assert.match(job(serverImage, "build"), /^ {4}if: \$\{\{ needs\.plan\.outputs\.mode != 'none' \}\}$/mu);
  assert.match(job(serverImage, "publish"), /^ {4}needs: \[plan, build\]$/mu);
  assert.doesNotMatch(triggerRelease, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
  assert.match(decision, /Native arm64 qualification belongs to the manually triggered release/u);
});

test('all seven Linux dependency installs retain scripts and share only verified tarballs', async () => {
  const names = ['packaged-linux-built-in-lifecycle', 'standalone-systemd-restart', 'build-and-test', 'workspace-tests', 'real-webrtc', 'container-image-smoke', 'bot-mcp-runtime'];
  for (const name of names) {
    const body = job(giteaCi, name);
    assert.match(body, /container:\n {6}image: git\.i\.wylde\.net\/docker\/dind:latest\n {6}volumes:\n {8}- terminay-ci-npm-cache:\/var\/cache\/terminay-npm/u);
    assert.match(body, /npm_config_cache: \/var\/cache\/terminay-npm/u);
    if (name === 'standalone-systemd-restart') {
      assert.match(body, /node scripts\/prepare-systemd-ci\.mjs/u);
      assert.match(await read('scripts/prepare-systemd-ci.mjs'), /\['sh', \['scripts\/install-ci-dependencies\.sh'\]/u);
    } else assert.match(body, /sh scripts\/install-ci-dependencies\.sh/u);
    assert.doesNotMatch(body, /--ignore-scripts|node_modules:/u);
  }
  for (const name of ['build-and-test', 'workspace-tests']) assert.match(job(giteaCi, name), /--tmpfs \/test-tmp:rw,exec,size=2g,mode=1777/u);
});

test('Linux installer pins npm only when needed, bounds each command, preserves lifecycle and propagates failure', async () => {
  const { mkdtemp, writeFile, chmod, readFile: readText, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'terminay-ci-installer-'));
  try {
    const mockNpm = join(root, 'npm');
    await writeFile(mockNpm, `#!${process.execPath}\nimport {existsSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);const state=process.env.INSTALLER_TEST_STATE;if(args[0]==='--version'){console.log(existsSync(state)?readFileSync(state,'utf8'):process.env.INSTALLER_TEST_VERSION);process.exit(0);}appendFileSync(process.env.INSTALLER_TEST_LOG,JSON.stringify({args,cache:process.env.npm_config_cache,headers:process.env.npm_config_nodedir})+'\\n');if(args[0]==='install')writeFileSync(state,'12.2.1');if(args[0]==='ci'&&process.env.INSTALLER_TEST_FAIL==='1')process.exit(42);\n`);
    const mockTimeout = join(root, 'timeout');
    await writeFile(mockTimeout, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';const args=process.argv.slice(2);appendFileSync(process.env.INSTALLER_TEST_BOUNDS,JSON.stringify(args.slice(0,3))+'\\n');const result=spawnSync(args[3],args.slice(4),{stdio:'inherit'});process.exit(result.status??1);\n`);
    await chmod(mockNpm, 0o755); await chmod(mockTimeout, 0o755);
    for (const [name, version, fails] of [['pinned', '12.2.1', false], ['upgrade', '11.0.0', false], ['failure', '12.2.1', true]]) {
      const log = join(root, `${name}.log`), bounds = join(root, `${name}.bounds`);
      const cache = join(root, 'cache with spaces');
      const result = spawnSync('sh', [new URL('./install-ci-dependencies.sh', import.meta.url).pathname], { encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: `${root}:${process.env.PATH}`, npm_config_cache: cache, INSTALLER_TEST_LOG: log, INSTALLER_TEST_BOUNDS: bounds, INSTALLER_TEST_STATE: join(root, `${name}.state`), INSTALLER_TEST_VERSION: version, INSTALLER_TEST_FAIL: fails ? '1' : '0' } });
      assert.equal(result.status, fails ? 42 : 0, result.stderr);
      const commands = (await readText(log, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(commands.filter(command => command.args[0] === 'install').length, version === '12.2.1' ? 0 : 1);
      const install = commands.find(command => command.args[0] === 'ci');
      assert.equal(install.cache, cache);
      const { verifiedNodeHeaderPrefix } = await import('./node-build-header-prefix.mjs');
      const expectedHeaders = verifiedNodeHeaderPrefix();
      if (expectedHeaders) assert.equal(install.headers, expectedHeaders);
      for (const flag of ['--prefer-offline', '--foreground-scripts', '--timing', '--fetch-timeout=30000', '--fetch-retries=1', '--no-audit']) assert.ok(install.args.includes(flag));
      assert.ok(!install.args.includes('--ignore-scripts'));
      const limits = (await readText(bounds, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(limits.at(-1), ['--signal=TERM', '--kill-after=10s', '180s']);
      if (version !== '12.2.1') assert.deepEqual(limits[0], ['--signal=TERM', '--kill-after=10s', '60s']);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('node-gyp header reuse requires exact runtime major, minor and patch versions', async () => {
  const { verifiedNodeHeaderPrefix } = await import('./node-build-header-prefix.mjs');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'terminay-local-node-headers-'));
  try {
    await mkdir(join(root, 'bin')); await mkdir(join(root, 'include/node'), { recursive: true });
    const executable = join(root, 'bin/node'); await writeFile(executable, 'runtime');
    assert.equal(verifiedNodeHeaderPrefix({ executable, version: '24.15.0' }), null);
    await writeFile(join(root, 'include/node/node_version.h'), '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 15\n#define NODE_PATCH_VERSION 0\n');
    assert.equal(verifiedNodeHeaderPrefix({ executable, version: '24.15.0' }), root);
    for (const version of ['22.15.0', '24.14.0', '24.15.1', '24.15.0-custom']) assert.equal(verifiedNodeHeaderPrefix({ executable, version }), null);
    await writeFile(join(root, 'include/node/node_version.h'), '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 15\n');
    assert.equal(verifiedNodeHeaderPrefix({ executable, version: '24.15.0' }), null);
    const floor = await read('Dockerfile.linux-floor');
    assert.match(floor, /npm_config_nodedir="\$header_prefix" timeout/u);
    assert.doesNotMatch(floor, /^ENV .*npm_config_nodedir/gmu, 'Electron packaging must choose its own headers');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux floor and systemd gates consume one producer directly and verify revision-matched transfers', () => {
  const producer = job(giteaCi, 'linux-artifacts');
  const floor = job(giteaCi, 'linux-glibc-floor');
  const restart = job(giteaCi, 'standalone-systemd-restart');
  assert.ok(giteaCi.indexOf('\n  linux-artifacts:') < giteaCi.indexOf('\n  packaged-macos-smoke:'), 'the producer is admitted before unrelated consumers');
  assert.doesNotMatch(producer, /^ {4}needs:/mu, 'producer is independent');
  assert.match(producer, /--output release\/0\.0\.0\/Terminay-Linux-0\.0\.0\.AppImage --output release\/standalone/u);
  assert.doesNotMatch(producer, /--output release(?:\s|$)/mu, 'the unpacked Electron staging tree is not transferred');
  assert.match(producer, /sha256sum Terminay-Linux-0\.0\.0\.AppImage > SHA256SUMS/u);
  assert.match(producer, /sha256sum terminay-server-main-linux-x64\.tar\.gz > SHA256SUMS/u);
  for (const consumer of [floor, restart]) {
    assert.match(consumer, /^ {4}needs: linux-artifacts$/mu);
    assert.match(consumer, /standalone-floor-\$\{\{ github.sha \}\}/u);
    assert.match(consumer, /sha256sum --check SHA256SUMS/u);
    assert.doesNotMatch(consumer, /build-linux-standalone-archive\.sh/u, 'a consumer does not rebuild the transferred archive');
  }
  assert.match(floor, /appimage-floor-\$\{\{ github.sha \}\}/u);
  assert.match(producer, /appimage-floor-\$\{\{ github.sha \}\}/u);
  assert.ok(floor.indexOf('Verify both transferred artifacts') < floor.indexOf('Check every ELF file'));
  assert.ok(restart.indexOf('Verify the transferred archive') < restart.indexOf('Restart under systemd'));
});


test('Linux verification uses the shared runner pool', () => {
  for (const name of ['e2e-image', 'linux-artifacts', 'linux-glibc-floor', 'standalone-systemd-restart', 'e2e-test']) {
    assert.match(job(giteaCi, name), /^ {4}runs-on: ubuntu-latest$/mu);
  }
  assert.doesNotMatch(giteaCi, /TERMINAY_CI_BUILD_RUNNER|terminay-ci-build/);
});
