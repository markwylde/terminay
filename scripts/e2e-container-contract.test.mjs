import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

function job(workflow, name) {
  const header = `  ${name}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `CI must declare ${name}`);
  const remainder = workflow.slice(start + header.length);
  const next = remainder.search(/^ {2}[a-z][a-z0-9-]+:\n/mu);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
}

test("local Electron E2E defaults to an isolated Linux container", async () => {
  const [agents, dockerfile, dockerignore, packageJson, runner] = await Promise.all([
    text("AGENTS.md"),
    text("Dockerfile.e2e"),
    text(".dockerignore"),
    text("package.json"),
    text("scripts/run-e2e-container.sh"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.equal(scripts["test:e2e"], "sh scripts/run-project-environment-e2e.sh && sh scripts/run-e2e-container.sh");
  assert.equal(scripts["test:e2e:host"], "npm run build:app && playwright test");
  assert.match(agents, /must run Electron end-to-end tests through `npm run test:e2e`/u);
  assert.match(dockerfile, /^FROM node:24\.15\.0-bookworm-slim$/mu);
  assert.match(dockerfile, /npm install --global npm@12\.0\.2/u);
  assert.match(dockerfile, /COPY --chown=node:node scripts\/ensure-node-pty-helper-mode\.mjs scripts\/ensure-node-pty-helper-mode\.mjs/u);
  assert.match(dockerfile, /USER node\nRUN npm ci \\\n\s+&& node node_modules\/electron\/install\.js \\\n\s+&& npx playwright install chromium/u);
  assert.match(dockerfile, /USER root\nRUN npx playwright install-deps chromium/u);
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends libgtk-3-0 libxss1 xauth/u);
  assert.match(dockerignore, /^\*\.tsbuildinfo$/mu);
  assert.match(dockerignore, /^\*\*\/\*\.tsbuildinfo$/mu);
  assert.doesNotMatch(dockerfile, /chown -R node:node \/workspace/u);
  assert.match(dockerfile, /USER node/u);
  assert.match(runner, /TERMINAY_E2E_PLATFORM:-\}/u);
  assert.match(runner, /arm64\|aarch64\) platform=linux\/arm64/u);
  assert.match(runner, /x86_64\|amd64\) platform=linux\/amd64/u);
  assert.match(runner, /--pull/u);
  assert.match(runner, /DOCKER_BUILDKIT=1 build_image/u);
  assert.match(runner, /--secret id=turbo_token,env=TURBO_TOKEN/u);
  assert.match(runner, /--secret id=turbo_signature_key,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY/u);
  assert.match(runner, /preloaded_image=\$\{TERMINAY_E2E_IMAGE_IS_PRELOADED:-\}/u);
  assert.match(runner, /if \[ "\$preloaded_image" = 1 \]; then\n\s+if ! docker image inspect "\$image"/u);
  assert.match(runner, /--shm-size 2g/u);
  assert.doesNotMatch(runner, /--volume[^\n]*repo_dir/u);
});

test("busy torn-off window E2E waits for a non-shell process the container can run", async () => {
  const [dockerfile, spec, main] = await Promise.all([
    text("Dockerfile.e2e"),
    text("e2e/project-tabs.spec.ts"),
    text("electron/main.ts"),
  ]);
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends .*python3/u);
  assert.match(
    spec,
    /python3 -c "import time; print\('\$\{foregroundStarted\}', flush=True\); time\.sleep\(30\)"/u,
  );
  assert.doesNotMatch(spec, /sh -c "sleep 2\.1/u);
  assert.match(spec, /waitUntilNativeWindowHasBusyTerminal/u);
  assert.match(
    main,
    /process\.env\.TERMINAY_TEST === '1'[\s\S]{0,280}__terminayTestRunningTerminalCountForWindow/u,
  );
});

test("CI shards Electron E2E through the same isolated Docker entrypoint", async () => {
  const [githubWorkflow, giteaWorkflow] = await Promise.all([
    text(".github/workflows/ci.yml"),
    text(".gitea/workflows/ci.yml"),
  ]);
  assert.match(githubWorkflow, /npm install --global npm@12\.0\.2/u);
  assert.match(giteaWorkflow, /npm install --global npm@12\.0\.2/u);

  for (const [provider, workflow] of [
    ["GitHub", githubWorkflow],
    ["Gitea", giteaWorkflow],
  ]) {
    const e2eJob = job(workflow, "e2e-test");
    assert.match(e2eJob, /shard: \[1, 2, 3, 4, 5\]/u, `${provider} E2E job must retain five shards`);
    assert.match(e2eJob, /needs: e2e-image/u);
    assert.match(e2eJob, new RegExp([
      "TERMINAY_E2E_IMAGE: \\$\\{\\{ needs\\.e2e-image\\.outputs\\.image \\}\\}",
    ].join(""), "u"));
    assert.match(e2eJob, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
    assert.match(e2eJob, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
    assert.match(e2eJob, /Require amd64 Docker host/u);
    assert.match(e2eJob, /x86_64\|amd64/u);
    assert.match(e2eJob, /TERMINAY_E2E_ARTIFACT_DIR: \$\{\{ github\.workspace \}\}\/.docker-cache\/e2e\/shard-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2eJob, /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/5/u);
    assert.doesNotMatch(e2eJob, /run: xvfb-run -a npm run test:e2e:host/u);
    assert.match(e2eJob, /if: \$\{\{ always\(\) \}\}/u);
    assert.match(e2eJob, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2eJob, /retention-days: 7/u);
  }

  const githubE2e = `${job(githubWorkflow, "e2e-image")}\n${job(githubWorkflow, "e2e-test")}`;
  assert.match(githubE2e, /uses: actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);

  const giteaImage = job(giteaWorkflow, "e2e-image");
  const giteaE2e = job(giteaWorkflow, "e2e-test");
  assert.match(giteaImage, /node scripts\/e2e-image-cache-key\.mjs/u);
  assert.match(giteaImage, /git\.i\.wylde\.net\/markwylde\/terminay-e2e:\$IMAGE_KEY/u);
  assert.match(giteaImage, /docker manifest inspect "\$IMAGE_TAG"/u);
  assert.match(giteaImage, /docker push "\$IMAGE_TAG"/u);
  assert.doesNotMatch(giteaImage, /docker save|Upload shared E2E image|upload-artifact/u);
  assert.match(giteaE2e, /docker login git\.i\.wylde\.net/u);
  assert.match(giteaE2e, /docker pull "\$IMAGE_TAG"/u);
  assert.match(giteaE2e, /needs\.e2e-image\.outputs\.image-key/u);
  assert.doesNotMatch(giteaE2e, /download-artifact|docker load|image-id/u);
});

test("trusted Gitea builds use the signed internal Turborepo cache without baking credentials into the E2E image", async () => {
  const [dockerfile, packageJson, turboJson, workflow] = await Promise.all([
    text("Dockerfile.e2e"),
    text("package.json"),
    text("turbo.json"),
    text(".gitea/workflows/ci.yml"),
  ]);
  const packageData = JSON.parse(packageJson);
  const turbo = JSON.parse(turboJson);
  const cacheEnvironment = /TURBO_TEAM: wylde\n\s+TURBO_TOKEN: \$\{\{ secrets\.TURBO_TOKEN \}\}\n\s+TURBO_REMOTE_CACHE_SIGNATURE_KEY: \$\{\{ secrets\.TURBO_REMOTE_CACHE_SIGNATURE_KEY \}\}/u;

  assert.equal(packageData.devDependencies.turbo, "2.10.12");
  assert.match(packageData.scripts["build:workspaces"], /^turbo run build --filter=!terminay-\* && turbo run compile --filter=terminay-\*$/u);
  assert.match(packageData.scripts["test:workspaces"], /^turbo run test:ci --concurrency=1$/u);
  assert.deepEqual(turbo.remoteCache, {
    apiUrl: "https://turborepo.i.wylde.net",
    teamSlug: "wylde",
    signature: true,
  });
  assert.equal(turbo.tasks.build.outputs.includes("dist/**"), true);
  assert.equal(turbo.tasks["test:ci"].cache, false);

  assert.match(job(workflow, "packaged-macos-smoke"), cacheEnvironment);
  assert.match(job(workflow, "build-and-test"), cacheEnvironment);
  const e2eImage = job(workflow, "e2e-image");
  assert.match(e2eImage, cacheEnvironment);
  assert.match(e2eImage, /DOCKER_BUILDKIT=1 docker build/u);
  assert.match(e2eImage, /--secret id=turbo_token,env=TURBO_TOKEN/u);
  assert.match(e2eImage, /--secret id=turbo_signature_key,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY/u);
  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1\.7$/mu);
  assert.match(dockerfile, /--mount=type=secret,id=turbo_token,required=false/u);
  assert.match(dockerfile, /--mount=type=secret,id=turbo_signature_key,required=false/u);
  assert.match(dockerfile, /npm run build:app/u);
});
