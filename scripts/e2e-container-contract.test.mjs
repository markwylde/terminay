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

  assert.equal(scripts["test:e2e"], "sh scripts/run-e2e-container.sh");
  assert.equal(scripts["test:e2e:host"], "npm run build:app && playwright test");
  assert.match(agents, /must run Electron end-to-end tests through `npm run test:e2e`/u);
  assert.match(dockerfile, /^FROM node:24\.14\.0-bookworm-slim$/mu);
  assert.match(dockerfile, /COPY scripts\/ensure-node-pty-helper-mode\.mjs scripts\/ensure-node-pty-helper-mode\.mjs/u);
  assert.match(dockerfile, /npx playwright install --with-deps chromium/u);
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends libgtk-3-0 libxss1 xauth/u);
  assert.match(dockerfile, /chown -R node:node \/workspace/u);
  assert.match(dockerfile, /USER node/u);
  assert.match(runner, /TERMINAY_E2E_PLATFORM:-\}/u);
  assert.match(runner, /arm64\|aarch64\) platform=linux\/arm64/u);
  assert.match(runner, /x86_64\|amd64\) platform=linux\/amd64/u);
  assert.match(runner, /--pull/u);
  assert.match(runner, /--shm-size 2g/u);
  assert.doesNotMatch(runner, /--volume[^\n]*repo_dir/u);
});

test("GitHub runs the host command only inside its isolated Ubuntu runner", async () => {
  const workflow = await text(".github/workflows/ci.yml");
  assert.match(workflow, /run: xvfb-run -a npm run test:e2e:host/u);
  assert.doesNotMatch(workflow, /run: xvfb-run -a npm run test:e2e\s*$/mu);
});
