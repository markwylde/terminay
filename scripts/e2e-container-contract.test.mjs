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
  const next = remainder.search(/^  [a-z][a-z0-9-]+:\n/mu);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
}

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
  const githubE2e = job(workflow, "github-e2e-test");
  const giteaE2e = job(workflow, "gitea-e2e-test");
  assert.match(workflow, /npm install --global npm@12\.0\.2/u);
  assert.match(githubE2e, /if: \$\{\{ github\.server_url == 'https:\/\/github\.com' \}\}/u);
  assert.match(giteaE2e, /if: \$\{\{ github\.server_url != 'https:\/\/github\.com' \}\}/u);

  for (const [provider, e2eJob, imageJob, downloadAction, excludedAction] of [
    ["GitHub", githubE2e, "github-e2e-image", "d3f86a106a0bac45b974a628896c90dbdf5c8093", "9bc31d5ccc31df68ecc42ccf4149144866c47d8a"],
    ["Gitea", giteaE2e, "gitea-e2e-image", "9bc31d5ccc31df68ecc42ccf4149144866c47d8a", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
  ]) {
    assert.match(e2eJob, /shard: \[1, 2, 3, 4, 5\]/u, `${provider} E2E job must retain five shards`);
    assert.match(e2eJob, new RegExp(`needs: ${imageJob}`, "u"));
    assert.match(e2eJob, new RegExp(`uses: actions/download-artifact@${downloadAction}`, "u"));
    assert.doesNotMatch(e2eJob, new RegExp(excludedAction, "u"));
    assert.match(e2eJob, new RegExp([
      "TERMINAY_E2E_IMAGE: \\$\\{\\{ needs\\.", imageJob, "\\.outputs\\.image \\}\\}",
    ].join(""), "u"));
    assert.match(e2eJob, new RegExp([
      "EXPECTED_IMAGE_ID: \\$\\{\\{ needs\\.", imageJob, "\\.outputs\\.image-id \\}\\}",
    ].join(""), "u"));
    assert.match(e2eJob, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
    assert.match(e2eJob, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
    assert.match(e2eJob, /Require amd64 Docker host/u);
    assert.match(e2eJob, /x86_64\|amd64/u);
    assert.match(e2eJob, /docker image inspect --format '\{\{\.Id\}\}' "\$IMAGE_TAG"/u);
    assert.match(e2eJob, /TERMINAY_E2E_ARTIFACT_DIR: \$\{\{ github\.workspace \}\}\/.docker-cache\/e2e\/shard-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2eJob, /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/5/u);
    assert.doesNotMatch(e2eJob, /run: xvfb-run -a npm run test:e2e:host/u);
    assert.match(e2eJob, /if: \$\{\{ always\(\) \}\}/u);
    assert.match(e2eJob, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-5/u);
    assert.match(e2eJob, /retention-days: 7/u);
  }
});
