import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PROTOCOL_LIMITS } from "@terminay/protocol";
import { deriveUiBundleId, OrderedEventJournal } from "@terminay/server-core";
import { createEmbeddedServer, createLocalUiServer, createStandaloneServer } from "../dist/index.js";

test("local UI server authenticates bundle assets and negotiates the shared protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-local-ui-"));
  const files = { "index.html": Buffer.from("<!doctype html><title>Terminay</title>"), "assets.js": Buffer.from("console.log('bundle')") };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  const initialAssets = Object.entries(files).map(([name, content]) => ({ contentType: name.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8", hash: createHash("sha256").update(content).digest("base64url"), path: `/remote-app/placeholder/${name}`, size: content.byteLength }));
  const bundleId = deriveUiBundleId(initialAssets, "placeholder");
  const assets = initialAssets.map((asset) => ({ ...asset, path: asset.path.replace("placeholder", bundleId) }));
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: 1, bundleId, serverVersion: "1.2.3", protocolVersion: "1", entryPath: `/remote-app/${bundleId}/index.html`, assets }));
  let journal;
  journal = new OrderedEventJournal({ maxEvents: 1, snapshot: () => ({ revision: journal.revision, cursor: journal.cursor, payload: { terminals: [] } }) });
  const server = createLocalUiServer({
    rootDirectory: root,
    serverId: "server-a",
    serverVersion: "1.2.3",
    authToken: "local-test-token-123456",
    capabilities: ["terminal.events"],
    eventJournal: journal,
    authorize: (_token, hello) => hello?.clientId === "client-write" ? "write" : "read",
    operations: {
      queries: {
        "workspace.echo": ({ envelope, context }) => ({ clientId: context.clientId, scope: context.authScope, payload: envelope.payload }),
      },
      commands: {
        "workspace.set": ({ envelope, context }) => ({ result: { clientId: context.clientId, expectedRevision: context.expectedRevision ?? null, payload: envelope.payload }, revision: (context.expectedRevision ?? 0) + 1 }),
      },
      policies: {
        "workspace.echo": { scope: "read" },
        "workspace.set": { scope: "write" },
      },
    },
  });
  const runtime = createStandaloneServer({ serverId: "server-a", serverVersion: "1.2.3", dataRoot: root, uiServer: server });
  await runtime.start();
  const address = server.address;
  assert.ok(address);
  assert.equal("uiServer" in runtime.config, false);
  try {
    const unauthorized = await fetch(`${address.origin}/manifest.json`);
    assert.equal(unauthorized.status, 401);
    const queryCredential = await fetch(`${address.origin}/manifest.json?token=local-test-token-123456`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.equal(queryCredential.status, 400);
    const manifest = await fetch(`${address.origin}/manifest.json`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.equal(manifest.status, 200);
    assertUiSecurityHeaders(manifest);
    assert.equal((await manifest.json()).assets.length, 2);
    const traversal = await fetch(`${address.origin}/..%2Fpackage.json`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.ok([400, 404].includes(traversal.status));

    const handshake = await fetch(`${address.origin}/protocol/handshake`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "client_hello", protocolMin: 1, protocolMax: 1, clientId: "client-a", clientVersion: "1.0.0", capabilities: ["workspace.snapshot", "terminal.events"], limits: DEFAULT_PROTOCOL_LIMITS }),
    });
    assert.equal(handshake.status, 200);
    assertUiSecurityHeaders(handshake);
    assert.deepEqual(await handshake.json(), {
      type: "server_hello",
      protocolVersion: 1,
      serverId: "server-a",
      serverVersion: "1.2.3",
      clientId: "client-a",
      capabilities: ["terminal.events"],
      limits: DEFAULT_PROTOCOL_LIMITS,
      authScope: "read",
    });
    assert.equal(handshake.headers.get("referrer-policy"), "no-referrer");

    const missingIdentity = await fetch(`${address.origin}/protocol/query`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "query", queryId: "query-missing", operation: "workspace.echo", payload: {} }),
    });
    assert.equal(missingIdentity.status, 401);
    const query = await fetch(`${address.origin}/protocol/query`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "X-Terminay-Client-Id": "client-a", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "query", queryId: "query-a", operation: "workspace.echo", payload: { view: "overview" } }),
    });
    assert.equal(query.status, 200);
    assert.deepEqual(await query.json(), { type: "query_result", queryId: "query-a", ok: true, result: { clientId: "client-a", scope: "read", payload: { view: "overview" } } });
    const forbiddenCommand = await fetch(`${address.origin}/protocol/command`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "X-Terminay-Client-Id": "client-a", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "command", commandId: "command-read", correlationId: "query-a", operation: "workspace.set", payload: { name: "denied" }, expectedRevision: 1 }),
    });
    assert.equal(forbiddenCommand.status, 200);
    assert.equal((await forbiddenCommand.json()).error.code, "forbidden");
    const writerHandshake = await fetch(`${address.origin}/protocol/handshake`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "client_hello", protocolMin: 1, protocolMax: 1, clientId: "client-write", clientVersion: "1.0.0", capabilities: [], limits: DEFAULT_PROTOCOL_LIMITS }),
    });
    assert.equal((await writerHandshake.json()).authScope, "write");
    const commandBody = { type: "command", commandId: "command-write", correlationId: "query-a", operation: "workspace.set", payload: { name: "accepted" }, expectedRevision: 3 };
    const command = await fetch(`${address.origin}/protocol/command`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "X-Terminay-Client-Id": "client-write", "Content-Type": "application/json" },
      body: JSON.stringify(commandBody),
    });
    assert.equal(command.status, 200);
    const commandResult = await command.json();
    assert.deepEqual(commandResult, { type: "command_result", commandId: "command-write", correlationId: "query-a", ok: true, result: { clientId: "client-write", expectedRevision: 3, payload: { name: "accepted" } }, revision: 4 });
    const duplicate = await fetch(`${address.origin}/protocol/command`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "X-Terminay-Client-Id": "client-write", "Content-Type": "application/json" },
      body: JSON.stringify(commandBody),
    });
    assert.deepEqual(await duplicate.json(), commandResult);

    const initialEvents = await fetch(`${address.origin}/protocol/events?afterRevision=0`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.equal(initialEvents.status, 200);
    assertUiSecurityHeaders(initialEvents);
    assert.deepEqual(await initialEvents.json(), { kind: "events", events: [] });
    journal.append("terminal.output", { terminalId: "terminal-a", output: "one" });
    const eventResponse = await fetch(`${address.origin}/protocol/events?afterRevision=0`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assertUiSecurityHeaders(eventResponse);
    assert.deepEqual(await eventResponse.json(), { kind: "events", events: [{ revision: 1, cursor: "1", event: "terminal.output", payload: { terminalId: "terminal-a", output: "one" } }] });

    const subscription = await fetch(`${address.origin}/protocol/events/subscribe?afterRevision=0`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.equal(subscription.status, 200);
    assertUiSecurityHeaders(subscription);
    assert.equal(subscription.headers.get("referrer-policy"), "no-referrer");
    const reader = subscription.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader.read();
    assert.match(new TextDecoder().decode(firstChunk.value), /terminal\.output/);
    journal.append("terminal.attention", { terminalId: "terminal-a", attention: true });
    const nextChunk = await reader.read();
    assert.match(new TextDecoder().decode(nextChunk.value), /terminal\.attention/);
    await reader.cancel();

    const replayAfterGap = await fetch(`${address.origin}/protocol/events?afterRevision=0`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.deepEqual(await replayAfterGap.json(), { kind: "resync", events: [], snapshot: { revision: 2, cursor: "2", payload: { terminals: [] } } });
    await server.stop();
    await server.start();
    const restartedAddress = server.address;
    assert.ok(restartedAddress);
    const replayAfterRestart = await fetch(`${restartedAddress.origin}/protocol/events?afterRevision=0`, { headers: { Authorization: "Bearer local-test-token-123456" } });
    assert.equal((await replayAfterRestart.json()).kind, "resync");
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("local UI server rejects incompatible or unauthorized handshakes", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-local-ui-auth-"));
  const content = Buffer.from("ok");
  await writeFile(join(root, "index.html"), content);
  const hash = createHash("sha256").update(content).digest("base64url");
  const placeholder = [{ contentType: "text/html; charset=utf-8", hash, path: "/remote-app/placeholder/index.html", size: content.byteLength }];
  const bundleId = deriveUiBundleId(placeholder, "placeholder");
  const assets = placeholder.map((asset) => ({ ...asset, path: asset.path.replace("placeholder", bundleId) }));
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: 1, bundleId, serverVersion: "1.0.0", protocolVersion: "1", entryPath: `/remote-app/${bundleId}/index.html`, assets }));
  const server = createLocalUiServer({ rootDirectory: root, serverId: "server-a", serverVersion: "1.0.0", authToken: "local-test-token-123456", authorize: () => null });
  const address = await server.start();
  try {
    const oversized = await fetch(`${address.origin}/protocol/handshake`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "Content-Type": "application/json", "Content-Length": "65537" },
      body: "x".repeat(65537),
    });
    assert.equal(oversized.status, 413);
    const response = await fetch(`${address.origin}/protocol/handshake`, {
      method: "POST",
      headers: { Authorization: "Bearer local-test-token-123456", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "client_hello", protocolMin: 2, protocolMax: 2, clientId: "client-a", clientVersion: "1.0.0", capabilities: [], limits: DEFAULT_PROTOCOL_LIMITS }),
    });
    assert.equal(response.status, 403);
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("embedded runtime serves the exact verified bundle entry on its isolated local origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-embedded-ui-"));
  const original = Buffer.from("<!doctype html><title>Embedded Terminay</title>");
  await writeFile(join(root, "index.html"), original);
  const hash = createHash("sha256").update(original).digest("base64url");
  const provisional = [{ contentType: "text/html; charset=utf-8", hash, path: "/remote-app/provisional/index.html", size: original.byteLength }];
  const bundleId = deriveUiBundleId(provisional, "provisional");
  const manifest = {
    schemaVersion: 1,
    bundleId,
    serverVersion: "2.0.0",
    protocolVersion: "1",
    entryPath: `/remote-app/${bundleId}/index.html`,
    assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
  };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const uiServer = createLocalUiServer({ rootDirectory: root, serverId: "embedded-server", serverVersion: "2.0.0", authToken: "embedded-ui-token-123456" });
  const runtime = createEmbeddedServer({ serverId: "embedded-server", serverVersion: "2.0.0", dataRoot: root, uiServer });
  await runtime.start();
  const address = uiServer.address;
  assert.ok(address);
  assert.equal(runtime.config.runtimeMode, "embedded");
  try {
    const response = await fetch(`${address.origin}/`, { headers: { Authorization: "Bearer embedded-ui-token-123456" } });
    assert.equal(response.status, 200);
    assertUiSecurityHeaders(response);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(await response.text(), original.toString("utf8"));
    await writeFile(join(root, "index.html"), Buffer.from("tampered after verification"));
    const stable = await fetch(`${address.origin}${manifest.entryPath}`, { headers: { Authorization: "Bearer embedded-ui-token-123456" } });
    assert.equal(await stable.text(), original.toString("utf8"));
    const manifestResponse = await fetch(`${address.origin}/manifest.json`, { headers: { Authorization: "Bearer embedded-ui-token-123456" } });
    assert.deepEqual(await manifestResponse.json(), manifest);
  } finally {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

function assertUiSecurityHeaders(response) {
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
