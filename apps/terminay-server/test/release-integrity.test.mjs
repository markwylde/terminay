import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const distRoot = join(packageRoot, "dist");
const { assertStandaloneReleaseIntegrity } = await import("../dist/releaseIntegrity.js");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "terminay-server-release-integrity-"));
  const app = join(root, "app");
  await cp(distRoot, join(app, "dist"), { recursive: true });
  await cp(join(packageRoot, "package.json"), join(app, "package.json"));
  await symlink(join(repositoryRoot, "node_modules"), join(root, "node_modules"), "dir");
  return { root, dist: join(app, "dist") };
}

async function runCli(cli) {
  const child = spawn(process.execPath, [cli, "--version"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

test("standalone release manifest binds package identity and every executable module", async () => {
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(distRoot, "release-integrity.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageName, packageJson.name);
  assert.equal(manifest.version, packageJson.version);
  assert.ok(manifest.files.some((file) => file.path === "cli.js"));
  assert.ok(manifest.files.some((file) => file.path === "mcpEntry.js"));
  await assertStandaloneReleaseIntegrity(distRoot);
});

test("standalone release validation fails closed for changed, injected, and identity-mismatched payloads", async () => {
  const fixtureRoot = await fixture();
  try {
    await writeFile(join(fixtureRoot.dist, "bootstrap.js"), "tampered");
    await assert.rejects(() => assertStandaloneReleaseIntegrity(fixtureRoot.dist), /integrity mismatch: bootstrap\.js/u);

    await cp(distRoot, fixtureRoot.dist, { recursive: true, force: true });
    await writeFile(join(fixtureRoot.dist, "injected.js"), "export {}\n");
    await assert.rejects(() => assertStandaloneReleaseIntegrity(fixtureRoot.dist), /executable file set mismatch/u);

    await rm(join(fixtureRoot.dist, "injected.js"));
    await writeFile(join(dirname(fixtureRoot.dist), "package.json"), JSON.stringify({ name: "@terminay/server", version: "9.9.9" }));
    await assert.rejects(() => assertStandaloneReleaseIntegrity(fixtureRoot.dist), /package identity mismatch/u);
  } finally {
    await rm(fixtureRoot.root, { force: true, recursive: true });
  }
});

test("standalone release validation rejects a manifest module replaced by a symlink", async () => {
  const fixtureRoot = await fixture();
  try {
    const externalModule = join(fixtureRoot.root, "external-bootstrap.js");
    await writeFile(externalModule, await readFile(join(fixtureRoot.dist, "bootstrap.js")));
    await rm(join(fixtureRoot.dist, "bootstrap.js"));
    await symlink(externalModule, join(fixtureRoot.dist, "bootstrap.js"));

    await assert.rejects(
      () => assertStandaloneReleaseIntegrity(fixtureRoot.dist),
      /standalone release file is not regular: bootstrap\.js/u,
    );
  } finally {
    await rm(fixtureRoot.root, { force: true, recursive: true });
  }
});

test("standalone CLI refuses a changed support module before handling commands", async () => {
  const fixtureRoot = await fixture();
  try {
    const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const intact = await runCli(join(fixtureRoot.dist, "cli.js"));
    assert.equal(intact.code, 0, intact.stderr);
    assert.equal(intact.stdout, `${packageJson.version}\n`);

    await writeFile(join(fixtureRoot.dist, "bootstrap.js"), `${await readFile(join(fixtureRoot.dist, "bootstrap.js"), "utf8")}\n`);
    const tampered = await runCli(join(fixtureRoot.dist, "cli.js"));
    assert.notEqual(tampered.code, 0);
    assert.match(tampered.stderr, /standalone release integrity mismatch: bootstrap\.js/u);
  } finally {
    await rm(fixtureRoot.root, { force: true, recursive: true });
  }
});
