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
  const [agents, dockerfile, e2eDockerfile, dockerignore, packageJson, runner] = await Promise.all([
    text("AGENTS.md"),
    text("Dockerfile.e2e-base"),
    text("Dockerfile.e2e"),
    text(".dockerignore"),
    text("package.json"),
    text("scripts/run-e2e-container.sh"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.equal(scripts["test:e2e"], "sh scripts/run-e2e-container.sh");
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
  // The per-commit image adds only source and build output to the base.
  assert.match(e2eDockerfile, /^ARG E2E_BASE_IMAGE\nFROM \$\{E2E_BASE_IMAGE\}$/mu);
  assert.doesNotMatch(e2eDockerfile, /npm ci|apt-get|playwright install/u);
  assert.doesNotMatch(e2eDockerfile, /chown -R node:node \/workspace/u);
  assert.match(runner, /base_key=\$\(cd "\$repo_dir" && node scripts\/e2e-base-image-key\.mjs\)/u);
  assert.match(runner, /--file "\$repo_dir\/Dockerfile\.e2e-base"/u);
  assert.match(runner, /--build-arg "E2E_BASE_IMAGE=\$base_image"/u);
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
    text("Dockerfile.e2e-base"),
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

test("Gitea CI shards Electron E2E through the same isolated Docker entrypoint", async () => {
  const workflow = await text(".gitea/workflows/ci.yml");
  assert.match(workflow, /npm install --global npm@12\.0\.2/u);

  const e2eJob = job(workflow, "e2e-test");
  assert.match(e2eJob, /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/u, "Gitea E2E job must retain ten shards");
  assert.match(e2eJob, /needs: e2e-image/u);
  assert.match(e2eJob, new RegExp([
    "TERMINAY_E2E_IMAGE: \\$\\{\\{ needs\\.e2e-image\\.outputs\\.image \\}\\}",
  ].join(""), "u"));
  assert.match(e2eJob, /TERMINAY_E2E_IMAGE_IS_PRELOADED: "1"/u);
  assert.match(e2eJob, /TERMINAY_E2E_PLATFORM: linux\/amd64/u);
  assert.match(e2eJob, /Require amd64 Docker host/u);
  assert.match(e2eJob, /x86_64\|amd64/u);
  assert.match(e2eJob, /TERMINAY_E2E_ARTIFACT_DIR: \$\{\{ github\.workspace \}\}\/.docker-cache\/e2e\/shard-\$\{\{ matrix\.shard \}\}-of-10/u);
  assert.match(e2eJob, /run: npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/10/u);
  assert.doesNotMatch(e2eJob, /run: xvfb-run -a npm run test:e2e:host/u);
  assert.match(e2eJob, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(e2eJob, /name: playwright-report-\$\{\{ matrix\.shard \}\}-of-10/u);
  assert.match(e2eJob, /retention-days: 7/u);

  const giteaImage = job(workflow, "e2e-image");
  assert.match(giteaImage, /node scripts\/e2e-image-cache-key\.mjs/u);
  assert.match(giteaImage, /git\.i\.wylde\.net\/markwylde\/terminay-e2e:\$IMAGE_KEY/u);
  assert.match(giteaImage, /docker manifest inspect "\$IMAGE_TAG"/u);
  assert.match(giteaImage, /docker push "\$IMAGE_TAG"/u);
  // The dependency base is keyed by its inputs, restored when published, and
  // otherwise built and pushed before the per-commit image is built on it.
  assert.match(giteaImage, /node scripts\/e2e-base-image-key\.mjs/u);
  assert.match(giteaImage, /\/markwylde\/terminay-e2e-base:\$BASE_KEY/u);
  assert.match(giteaImage, /docker manifest inspect "\$BASE_TAG"/u);
  assert.match(giteaImage, /--file Dockerfile\.e2e-base/u);
  assert.match(giteaImage, /docker push "\$BASE_TAG"/u);
  assert.match(giteaImage, /--build-arg E2E_BASE_IMAGE="\$BASE_TAG"/u);
  assert.ok(
    giteaImage.indexOf("Build or restore the dependency base image") <
      giteaImage.indexOf("Build or restore the content-addressed E2E image"),
    "the base must be ready before the per-commit image is built",
  );
  assert.doesNotMatch(giteaImage, /docker save|Upload shared E2E image|upload-artifact/u);
  assert.match(e2eJob, /docker login git\.i\.wylde\.net/u);
  assert.match(e2eJob, /docker pull "\$IMAGE_TAG"/u);
  assert.match(e2eJob, /needs\.e2e-image\.outputs\.image-key/u);
  assert.doesNotMatch(e2eJob, /download-artifact|docker load|image-id/u);
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

/**
 * The image installs dependencies from a hand-written list of workspace
 * manifests. A workspace missing from that list is not installed, so its
 * extension is absent from every containerised end-to-end run while the suite
 * still reports green.
 */
test("the E2E image copies a manifest for every workspace", async () => {
  const { readdir } = await import("node:fs/promises");
  const dockerfile = await text("Dockerfile.e2e-base");
  const packageJson = JSON.parse(await text("package.json"));
  const directories = [];
  for (const pattern of packageJson.workspaces) {
    assert.ok(pattern.endsWith("/*"), `unsupported workspace pattern ${pattern}`);
    const parent = pattern.slice(0, -2);
    for (const entry of await readdir(new URL(`${parent}/`, root), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // A directory under a workspace glob is only a workspace if it has a
      // manifest. `packages/shared-ui` is sources compiled by its consumers and
      // has none, so npm never installs it and the image must not copy one.
      const directory = `${parent}/${entry.name}`;
      const manifest = await readFile(new URL(`${directory}/package.json`, root), "utf8").catch(() => undefined);
      if (manifest !== undefined) directories.push(directory);
    }
  }
  assert.ok(directories.length > 0, "no workspaces were discovered");
  const missing = directories.filter(
    (directory) => !dockerfile.includes(`COPY --chown=node:node ${directory}/package.json ${directory}/package.json`),
  );
  assert.deepEqual(missing, [], `Dockerfile.e2e-base must copy each workspace manifest; missing: ${missing.join(", ")}`);
});

/**
 * A runner's Docker store outlives its jobs. Without cleanup, the rebuilt
 * ":local" images and one E2E image per commit filled a runner host's disk
 * within days and the node evicted everything on it.
 */
test("every CI job that builds or pulls images frees them when it ends", async () => {
  const ci = await text(".gitea/workflows/ci.yml");
  const cleanup = (keep) => new RegExp(
    `- name: Free this job's Docker images\\n\\s+if: \\$\\{\\{ always\\(\\)[^\\n]*\\}\\}\\n[\\s\\S]*?run: sh scripts/prune-ci-docker-images\\.sh${keep}\\n`,
    "u",
  );
  const lastStep = (block) => block.slice(block.lastIndexOf("\n      - name: "));

  assert.match(lastStep(job(ci, "mcp-cli-compatibility")), cleanup(""));
  assert.match(lastStep(job(ci, "e2e-image")), cleanup(' "\\$IMAGE_TAG" "\\$BASE_TAG"'));
  assert.match(lastStep(job(ci, "e2e-image")), /BASE_TAG: \$\{\{ steps\.image\.outputs\.base-tag \}\}/u);
  assert.match(lastStep(job(ci, "e2e-image")), /IMAGE_TAG: \$\{\{ steps\.image\.outputs\.tag \}\}/u);
  assert.match(lastStep(job(ci, "e2e-test")), cleanup(' "\\$IMAGE_TAG" "\\$BASE_TAG"'));
  assert.match(lastStep(job(ci, "e2e-test")), /BASE_TAG: \$\{\{ needs\.e2e-image\.outputs\.base-image \}\}/u);
  assert.match(lastStep(job(ci, "e2e-test")), /IMAGE_TAG: \$\{\{ needs\.e2e-image\.outputs\.image \}\}/u);
});

test("CI image cleanup keeps the newest and the named E2E image and base, and never fails the job", async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");

  const bin = await mkdtemp(join(tmpdir(), "prune-ci-docker-"));
  const log = join(bin, "calls");
  const repository = "git.i.wylde.net/markwylde/terminay-e2e";
  const baseRepository = `${repository}-base`;
  await writeFile(join(bin, "docker"), [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    // The last argument names the repository being listed.
    `if [ "$1 $2" = "image ls" ]; then for last; do :; done; printf '%s\\n' "$last:newest" "$last:current" "$last:old1" "$last:old2"; fi`,
    // Every mutating call fails, so the script must shrug off daemon errors.
    `case "$1 $2" in "image ls") ;; *) exit 1 ;; esac`,
  ].join("\n"));
  await chmod(join(bin, "docker"), 0o755);

  try {
    const script = fileURLToPath(new URL("scripts/prune-ci-docker-images.sh", root));
    const result = spawnSync("sh", [script, `${repository}:current`, `${baseRepository}:current`], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.equal(calls[0], "container prune --force", "stopped containers must go first; they pin images");
    assert.deepEqual(
      calls.filter((call) => call.startsWith("image rm")),
      [
        `image rm ${repository}:old1`,
        `image rm ${repository}:old2`,
        `image rm ${baseRepository}:old1`,
        `image rm ${baseRepository}:old2`,
      ],
    );
    assert.equal(calls.at(-1), "image prune --force");
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

test("the base image key covers every file the base Dockerfile copies", async () => {
  const { e2eBaseImageInputs } = await import("./e2e-base-image-key.mjs");
  const dockerfile = await text("Dockerfile.e2e-base");
  const inputs = await e2eBaseImageInputs(new URL("Dockerfile.e2e-base", root).pathname);
  const copied = [...dockerfile.matchAll(/^COPY\s+(?:--\S+\s+)*(.+)$/gmu)]
    .flatMap((match) => match[1].trim().split(/\s+/u).slice(0, -1))
    .map((source) => source.replace(/^\.\//u, ""));
  assert.ok(copied.includes("package-lock.json"));
  for (const source of copied) assert.ok(inputs.includes(source), `${source} is not in the base image key`);
  assert.ok(inputs.some((input) => input.endsWith("Dockerfile.e2e-base")));
  assert.match(dockerfile, /^LABEL net\.wylde\.ci\.retain=true$/mu);
});

test("the per-commit image ships a committed browser-fixture dependency cache", async () => {
  const dockerfile = await text("Dockerfile.e2e");
  const buildAt = dockerfile.indexOf("npm run build:app");
  const prebundleAt = dockerfile.indexOf("RUN node --experimental-strip-types scripts/prebundle-e2e-vite-deps.mjs");
  assert.ok(buildAt !== -1 && prebundleAt > buildAt, "the Vite dependency cache is built after the application");
  const script = await text("scripts/prebundle-e2e-vite-deps.mjs");
  assert.match(script, /prebundleSharedWebShellDependencies/u);
});

test("E2E shards split by test and report per-test timings without changing the result", async () => {
  const [config, entrypoint, sandbox] = await Promise.all([
    text("playwright.config.ts"),
    text("scripts/support/e2e-container-entrypoint.sh"),
    text("e2e/server-ui-sandbox.spec.ts"),
  ]);
  assert.match(config, /fullyParallel: true/u);
  assert.match(config, /\['json', \{ outputFile: 'test-results\/e2e-timings\.json' \}\]/u);
  assert.match(sandbox, /test\.describe\.configure\(\{ mode: 'default' \}\)/u);
  assert.match(entrypoint, /xvfb-run --auto-servernum npx playwright test "\$@"\nstatus=\$\?/u);
  assert.match(entrypoint, /node scripts\/summarize-e2e-timings\.mjs test-results\/e2e-timings\.json \|\| true/u);
  assert.match(entrypoint, /exit "\$status"$/mu);
});
