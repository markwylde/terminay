import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveUiBundleId } from "@terminay/server-core";
import { createLocalUiServer } from "@terminay/server";
import {
  createDesktopEmbeddedLocalServer,
  createDesktopLocalServerSupervisor,
} from "../dist/main/index.js";

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test("Desktop Local starts the shared embedded runtime and its authenticated UI listener", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-embedded-"));
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const index = Buffer.from("<!doctype html><title>Desktop Local</title>");
  const hash = createHash("sha256").update(index).digest("base64url");
  const provisional = [{ path: "/remote-app/provisional/index.html", contentType: "text/html; charset=utf-8", hash, size: index.byteLength }];
  const bundleId = deriveUiBundleId(provisional, "provisional");
  await writeFile(join(root, "index.html"), index);
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    bundleId,
    serverVersion: "1.0.0",
    protocolVersion: "1",
    entryPath: `/remote-app/${bundleId}/index.html`,
    assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
  }));

  const supervisor = createDesktopLocalServerSupervisor({
    create: (channel) => createDesktopEmbeddedLocalServer(channel, {
      serverId: "desktop-embedded",
      serverVersion: "1.0.0",
      dataRoot: root,
      allocator: {
        choose: () => ({ origin, endpoint: `127.0.0.1:${port}` }),
        claim: () => undefined,
        release: () => undefined,
      },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      createUiServer: ({ bootstrapCredential, endpoint, serverId, serverVersion }) => createLocalUiServer({
        rootDirectory: root,
        serverId,
        serverVersion,
        authToken: bootstrapCredential,
        host: "127.0.0.1",
        port: Number(new URL(endpoint.origin).port),
      }),
    }),
  });
  try {
    const ready = await supervisor.start();
    assert.equal(ready.origin, origin);
    assert.ok(ready.bootstrapCredential);
    const manifest = await fetch(`${origin}/manifest.json`, {
      headers: { Authorization: `Bearer ${ready.bootstrapCredential}` },
    });
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).bundleId, bundleId);
    const asset = await fetch(`${origin}/remote-app/${bundleId}/index.html`, {
      headers: { Authorization: `Bearer ${ready.bootstrapCredential}` },
    });
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), index);
  } finally {
    await supervisor.stop();
    await rm(root, { recursive: true, force: true });
  }
});
