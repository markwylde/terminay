import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalUiServer } from "../dist/index.js";
import { deriveUiBundleId } from "@terminay/server-core";

test("standalone listener resolves verified unpacked UI assets independently of its working directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-standalone-unpacked-assets-"));
  const bundleRoot = join(root, "unpacked", "terminay-server", "ui");
  const unrelatedWorkingDirectory = join(root, "unrelated-working-directory");
  const index = Buffer.from("<!doctype html><title>Unpacked Terminay</title>");
  const script = Buffer.from("console.log('unpacked-asset');");
  const provisionalAssets = [
    asset("index.html", "text/html; charset=utf-8", index),
    asset("assets/app.js", "text/javascript; charset=utf-8", script),
  ];
  const bundleId = deriveUiBundleId(provisionalAssets.map(({ relativePath, ...entry }) => ({
    ...entry,
    path: `/remote-app/provisional/${relativePath}`,
  })), "provisional");
  const assets = provisionalAssets.map(({ relativePath, ...entry }) => ({
    ...entry,
    path: `/remote-app/${bundleId}/${relativePath}`,
  }));
  let server;
  const originalWorkingDirectory = process.cwd();
  try {
    await mkdir(join(bundleRoot, "assets"), { recursive: true });
    await mkdir(unrelatedWorkingDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(bundleRoot, "index.html"), index),
      writeFile(join(bundleRoot, "assets", "app.js"), script),
      writeFile(join(bundleRoot, "manifest.json"), JSON.stringify({
        schemaVersion: 1,
        bundleId,
        protocolVersion: "1",
        serverVersion: "1.0.0",
        entryPath: `/remote-app/${bundleId}/index.html`,
        assets,
      })),
    ]);

    server = createLocalUiServer({
      rootDirectory: bundleRoot,
      serverId: "unpacked-assets",
      serverVersion: "1.0.0",
      authToken: "unpacked-assets-test-token",
      host: "127.0.0.1",
      port: 0,
    });
    process.chdir(unrelatedWorkingDirectory);
    const address = await server.start();
    const headers = { Authorization: "Bearer unpacked-assets-test-token" };
    const [manifest, entry, resolvedScript] = await Promise.all([
      fetch(`${address.origin}/manifest.json`, { headers }),
      fetch(`${address.origin}/`, { headers }),
      fetch(`${address.origin}/remote-app/${bundleId}/assets/app.js`, { headers }),
    ]);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).bundleId, bundleId);
    assert.deepEqual(Buffer.from(await entry.arrayBuffer()), index);
    assert.deepEqual(Buffer.from(await resolvedScript.arrayBuffer()), script);
  } finally {
    process.chdir(originalWorkingDirectory);
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

function asset(relativePath, contentType, bytes) {
  return {
    relativePath,
    contentType,
    hash: createHash("sha256").update(bytes).digest("base64url"),
    size: bytes.byteLength,
  };
}
