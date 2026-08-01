import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { TerminayClient, WebSocketByteTransport } from "@terminay/client-core";
import { createServerCore, deriveUiBundleId } from "@terminay/server-core";
import { createLocalUiServer, createStandaloneServer } from "../apps/terminay-server/dist/index.js";

const TOKEN = "remote-stream-transport-token-123456";

test("Electron-compatible WebSocket ByteTransport uses the standalone ServerConnection stream", async () => {
  const root = await createBundleRoot();
  const protocolCore = createServerCore({
    serverId: "standalone-stream-server",
    serverVersion: "1.0.0",
    capabilities: ["workspace.echo"],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
    queries: {
      "workspace.echo": ({ envelope, context }) => ({
        clientId: context.clientId,
        scope: context.authScope,
        payload: envelope.payload,
      }),
    },
  });
  const uiServer = createLocalUiServer({
    rootDirectory: root,
    serverId: "standalone-stream-server",
    serverVersion: "1.0.0",
    authToken: TOKEN,
    capabilities: ["workspace.echo"],
    protocolCore,
  });
  const runtime = createStandaloneServer({
    serverId: "standalone-stream-server",
    serverVersion: "1.0.0",
    dataRoot: root,
    uiServer,
  });
  await runtime.start();
  const address = uiServer.address;
  assert.ok(address);

  const transport = new WebSocketByteTransport({
    origin: address.origin,
    authToken: TOKEN,
    WebSocket,
  });
  const client = new TerminayClient({
    transport,
    clientId: "electron-stream-client",
    clientVersion: "1.0.0",
    capabilities: ["workspace.echo"],
  });
  try {
    const hello = await client.connect();
    assert.deepEqual({ serverId: hello.serverId, serverVersion: hello.serverVersion, authScope: hello.authScope }, {
      serverId: "standalone-stream-server",
      serverVersion: "1.0.0",
      authScope: "read",
    });

    const result = await client.query("workspace.echo", { view: "desktop" });
    assert.deepEqual(result.result, {
      clientId: "electron-stream-client",
      scope: "read",
      payload: { view: "desktop" },
    });
    assert.equal(client.state, "connected");
  } finally {
    await client.close().catch(() => undefined);
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("WebSocket ByteTransport keeps credentials out of the URL and surfaces stream failures", async () => {
  assert.throws(
    () => new WebSocketByteTransport({ origin: "http://127.0.0.1:4310?token=secret", authToken: TOKEN, WebSocket }),
    /query/,
  );
  const transport = new WebSocketByteTransport({
    origin: "http://127.0.0.1:1",
    authToken: TOKEN,
    WebSocket,
  });
  await assert.rejects(transport.open(), /remote stream failed to open|closed before it opened|ECONNREFUSED|Unexpected server response/u);
});

async function createBundleRoot() {
  const root = await mkdtemp(join(tmpdir(), "terminay-stream-transport-"));
  const content = Buffer.from("<!doctype html><title>Terminay</title>");
  await writeFile(join(root, "index.html"), content);
  const provisional = [{
    contentType: "text/html; charset=utf-8",
    hash: createHash("sha256").update(content).digest("base64url"),
    path: "/remote-app/provisional/index.html",
    size: content.byteLength,
  }];
  const bundleId = deriveUiBundleId(provisional, "provisional");
  await writeFile(join(root, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    bundleId,
    serverVersion: "1.0.0",
    protocolVersion: "1",
    entryPath: `/remote-app/${bundleId}/index.html`,
    assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
  }));
  return root;
}
