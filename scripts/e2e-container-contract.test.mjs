import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("local Electron E2E defaults to an isolated Linux container", async () => {
  const [agents, dockerfile, packageJson, runner] = await Promise.all([
    text("AGENTS.md"),
    text("Dockerfile.e2e"),
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
  assert.doesNotMatch(dockerfile, /chown -R node:node \/workspace/u);
  assert.match(dockerfile, /USER node/u);
  assert.match(runner, /TERMINAY_E2E_PLATFORM:-\}/u);
  assert.match(runner, /arm64\|aarch64\) platform=linux\/arm64/u);
  assert.match(runner, /x86_64\|amd64\) platform=linux\/amd64/u);
  assert.match(runner, /--pull/u);
  assert.match(runner, /preloaded_image=\$\{TERMINAY_E2E_IMAGE_IS_PRELOADED:-\}/u);
  assert.match(runner, /if \[ "\$preloaded_image" = 1 \]; then\n\s+if ! docker image inspect "\$image"/u);
  assert.match(runner, /--shm-size 2g/u);
  assert.doesNotMatch(runner, /--volume[^\n]*repo_dir/u);
});

test("CI shards Electron E2E through the same isolated Docker entrypoint", async () => {
  const workflow = await text(".github/workflows/ci.yml");
  const e2eJob = workflow.slice(workflow.indexOf("  e2e-test:"));
  assert.match(workflow, /npm install --global npm@12\.0\.2/u);
  assert.match(e2eJob, /shard: \[1, 2, 3, 4, 5\]/u);
  assert.match(e2eJob, /needs: e2e-image/u);
  assert.match(e2eJob, /TERMINAY_E2E_IMAGE: \$\{\{ needs\.e2e-image\.outputs\.image \}\}/u);
  assert.match(e2eJob, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
  assert.match(e2eJob, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
  assert.match(e2eJob, /Require amd64 Docker host/u);
  assert.match(e2eJob, /x86_64\|amd64/u);
  assert.match(e2eJob, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}\n\s+uses: actions\/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093/u);
  assert.match(e2eJob, /if: \$\{\{ github\.server_url != 'https:\/\/github\.com' \}\}\n\s+uses: actions\/download-artifact@9bc31d5ccc31df68ecc42ccf4149144866c47d8a/u);
  assert.match(e2eJob, /EXPECTED_IMAGE_ID: \$\{\{ needs\.e2e-image\.outputs\.image-id \}\}/u);
  assert.match(e2eJob, /docker image inspect --format '\{\{\.Id\}\}' "\$IMAGE_TAG"/u);
  assert.match(e2eJob, /TERMINAY_E2E_ARTIFACT_DIR: \$\{\{ github\.workspace \}\}\/.docker-cache\/e2e\/shard-\$\{\{ matrix\.shard \}\}-of-5/u);
  assert.match(e2eJob, /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/5/u);
  assert.doesNotMatch(e2eJob, /run: xvfb-run -a npm run test:e2e:host/u);
  assert.match(e2eJob, /if: \$\{\{ always\(\) && github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(e2eJob, /if: \$\{\{ always\(\) && github\.server_url != 'https:\/\/github\.com' \}\}/u);
  assert.match(e2eJob, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
  assert.match(e2eJob, /retention-days: 7/u);
});
