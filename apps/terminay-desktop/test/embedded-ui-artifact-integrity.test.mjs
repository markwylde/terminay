import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stageProductionDependencyClosure } from "../../../scripts/standalone-runtime-dependencies.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

async function packAndExtract(workspace, destination) {
  await mkdir(destination, { recursive: true });
  const packed = JSON.parse((await run("npm", ["pack", "--workspace", workspace, "--json", "--pack-destination", destination], {
    cwd: repositoryRoot,
  })).stdout);
  assert.equal(packed.length, 1);
  const extracted = join(destination, "extracted");
  await mkdir(extracted);
  await run("tar", ["-xzf", join(destination, packed[0].filename), "-C", extracted]);
  return join(extracted, "package");
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("extracted Desktop refuses a tampered staged shared-server UI asset before it listens", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-ui-artifact-integrity-"));
  try {
    const desktopRoot = await packAndExtract("@terminay/desktop", join(root, "desktop"));
    const serverRoot = await packAndExtract("@terminay/server", join(root, "server"));
    const serverCoreRoot = await packAndExtract("@terminay/server-core", join(root, "server-core"));
    const protocolRoot = await packAndExtract("@terminay/protocol", join(root, "protocol"));
    const modules = join(desktopRoot, "node_modules");
    await stageProductionDependencyClosure({
      destinationModules: modules,
      runtimeModules: join(repositoryRoot, "node_modules"),
      workspacePackages: {
        "@terminay/server": serverRoot,
        "@terminay/server-core": serverCoreRoot,
        "@terminay/protocol": protocolRoot,
      },
      rootPackages: ["@terminay/server", "@terminay/server-core", "@terminay/protocol", "@modelcontextprotocol/sdk", "node-pty", "zod"],
    });

    const desktop = await import(pathToFileURL(join(desktopRoot, "dist/main/embeddedRuntime.js")).href);
    const server = await import(pathToFileURL(join(modules, "@terminay/server/dist/index.js")).href);
    const serverCore = await import(pathToFileURL(join(modules, "@terminay/server-core/dist/index.js")).href);
    const bundleRoot = join(root, "bundle");
    await mkdir(bundleRoot);
    const expectedAsset = Buffer.from("<!doctype html><title>verified packed UI</title>");
    const hash = createHash("sha256").update(expectedAsset).digest("base64url");
    const bundleId = serverCore.deriveUiBundleId([
      { path: "/remote-app/provisional/index.html", contentType: "text/html; charset=utf-8", hash, size: expectedAsset.byteLength },
    ], "provisional");
    await writeFile(join(bundleRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      bundleId,
      serverVersion: "1.0.0",
      protocolVersion: "1",
      entryPath: `/remote-app/${bundleId}/index.html`,
      assets: [{ path: `/remote-app/${bundleId}/index.html`, contentType: "text/html; charset=utf-8", hash, size: expectedAsset.byteLength }],
    }));
    // The manifest is intact, but the payload in the staged server bundle is
    // not.  The packaged Desktop adapter must reach the shared verifier before
    // binding its loopback origin.
    await writeFile(join(bundleRoot, "index.html"), "<script>tampered</script>");
    const port = await reserveLoopbackPort();
    let uiServer;
    const local = desktop.createDesktopEmbeddedLocalServer({
      claim: () => ({ value: "packed-desktop-tamper-credential", expiresAt: Date.UTC(2099, 0, 1) }),
    }, {
      serverId: "packed-desktop-ui-integrity",
      serverVersion: "1.0.0",
      dataRoot: bundleRoot,
      allocator: { choose: () => ({ origin: `http://127.0.0.1:${port}`, endpoint: `127.0.0.1:${port}` }), claim: () => undefined, release: () => undefined },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      createUiServer: ({ bootstrapCredential, endpoint, serverId, serverVersion }) => {
        uiServer = server.createLocalUiServer({
          authToken: bootstrapCredential,
          serverId,
          serverVersion,
          rootDirectory: bundleRoot,
          host: "127.0.0.1",
          port: Number(new URL(endpoint.origin).port),
        });
        return uiServer;
      },
    });

    await assert.rejects(local.start(), /size mismatch|hash mismatch/u);
    assert.equal(uiServer?.listening, false, "a tampered packaged UI must fail before opening its loopback listener");
    assert.equal(local.state, "failed");
    await local.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracted Desktop refuses an otherwise verified shared UI bundle from a different server version before it listens", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-ui-version-integrity-"));
  try {
    const desktopRoot = await packAndExtract("@terminay/desktop", join(root, "desktop"));
    const serverRoot = await packAndExtract("@terminay/server", join(root, "server"));
    const serverCoreRoot = await packAndExtract("@terminay/server-core", join(root, "server-core"));
    const protocolRoot = await packAndExtract("@terminay/protocol", join(root, "protocol"));
    const modules = join(desktopRoot, "node_modules");
    await stageProductionDependencyClosure({
      destinationModules: modules,
      runtimeModules: join(repositoryRoot, "node_modules"),
      workspacePackages: {
        "@terminay/server": serverRoot,
        "@terminay/server-core": serverCoreRoot,
        "@terminay/protocol": protocolRoot,
      },
      rootPackages: ["@terminay/server", "@terminay/server-core", "@terminay/protocol", "@modelcontextprotocol/sdk", "node-pty", "zod"],
    });

    const desktop = await import(pathToFileURL(join(desktopRoot, "dist/main/embeddedRuntime.js")).href);
    const server = await import(pathToFileURL(join(modules, "@terminay/server/dist/index.js")).href);
    const serverCore = await import(pathToFileURL(join(modules, "@terminay/server-core/dist/index.js")).href);
    const bundleRoot = join(root, "bundle");
    await mkdir(bundleRoot);
    const asset = Buffer.from("<!doctype html><title>old but verified packed UI</title>");
    const hash = createHash("sha256").update(asset).digest("base64url");
    const bundleId = serverCore.deriveUiBundleId([
      { path: "/remote-app/provisional/index.html", contentType: "text/html; charset=utf-8", hash, size: asset.byteLength },
    ], "provisional");
    await writeFile(join(bundleRoot, "index.html"), asset);
    await writeFile(join(bundleRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      bundleId,
      // The files and hashes are valid, but this is an artifact from a prior
      // server release. The shared runtime must reject it rather than let a
      // packaged Desktop launch a mixed-version workspace surface.
      serverVersion: "0.9.0",
      protocolVersion: "1",
      entryPath: `/remote-app/${bundleId}/index.html`,
      assets: [{ path: `/remote-app/${bundleId}/index.html`, contentType: "text/html; charset=utf-8", hash, size: asset.byteLength }],
    }));
    const port = await reserveLoopbackPort();
    let uiServer;
    const local = desktop.createDesktopEmbeddedLocalServer({
      claim: () => ({ value: "packed-desktop-version-credential", expiresAt: Date.UTC(2099, 0, 1) }),
    }, {
      serverId: "packed-desktop-ui-version-integrity",
      serverVersion: "1.0.0",
      dataRoot: bundleRoot,
      allocator: { choose: () => ({ origin: `http://127.0.0.1:${port}`, endpoint: `127.0.0.1:${port}` }), claim: () => undefined, release: () => undefined },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      createUiServer: ({ bootstrapCredential, endpoint, serverId, serverVersion }) => {
        uiServer = server.createLocalUiServer({
          authToken: bootstrapCredential,
          serverId,
          serverVersion,
          rootDirectory: bundleRoot,
          host: "127.0.0.1",
          port: Number(new URL(endpoint.origin).port),
        });
        return uiServer;
      },
    });

    await assert.rejects(local.start(), /UI manifest version mismatch/u);
    assert.equal(uiServer?.listening, false, "a mixed-version packaged UI must fail before opening its loopback listener");
    assert.equal(local.state, "failed");
    await local.stop();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
