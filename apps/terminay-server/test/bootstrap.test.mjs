import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddedBootstrap, createLocalUiServer, createServerRemoteExposure, FileDataRootLease } from "../dist/index.js";
import { deriveUiBundleId } from "@terminay/server-core";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("embedded bootstrap claims one data root, chooses a private endpoint, and publishes a short-lived credential", async () => {
  const calls = [];
  let claimCount = 0;
  const bootstrap = createEmbeddedBootstrap({
    serverId: "local-server",
    serverVersion: "1.0.0",
    dataRoot: "/private/local",
    allocator: {
      choose: () => ({ origin: "http://127.0.0.1:4317", endpoint: "loopback:4317" }),
      claim: (candidate) => calls.push(["claim", candidate.endpoint]),
      release: (candidate) => calls.push(["release", candidate.endpoint]),
    },
    dataRootLease: {
      acquire: () => { claimCount += 1; },
      release: () => { claimCount -= 1; },
    },
    publishReady: (ready) => calls.push(["ready", ready.serverId, ready.endpoint]),
  });
  const ready = await bootstrap.start();
  assert.equal(bootstrap.phase, "ready");
  assert.equal(ready.serverId, "local-server");
  assert.match(ready.bootstrapCredential, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(ready.credentialDigest.length, 64);
  assert.equal(claimCount, 1);
  const again = await bootstrap.start();
  assert.equal(again.bootstrapCredential, ready.bootstrapCredential);
  assert.equal(calls.filter((entry) => entry[0] === "claim").length, 1);
  await bootstrap.stop();
  assert.equal(claimCount, 0);
  assert.deepEqual(calls.map((entry) => entry[0]), ["claim", "ready", "release"]);
  const recovered = await bootstrap.start();
  assert.equal(bootstrap.phase, "ready");
  assert.notEqual(recovered.bootstrapCredential, ready.bootstrapCredential);
  assert.equal(claimCount, 1);
  await bootstrap.stop();
});

test("concurrent embedded bootstrap starts coalesce one authority claim, credential, and readiness publication", async () => {
  const events = [];
  let releaseChoose;
  const chosen = new Promise((resolve) => { releaseChoose = resolve; });
  const bootstrap = createEmbeddedBootstrap({
    serverId: "coalesced-local-server",
    serverVersion: "1.0.0",
    dataRoot: "/private/coalesced-local",
    allocator: {
      async choose() {
        events.push("choose");
        await chosen;
        return { origin: "http://127.0.0.1:4320", endpoint: "loopback:4320" };
      },
      claim() { events.push("claim"); },
      release() { events.push("release"); },
    },
    dataRootLease: {
      acquire() { events.push("lease:acquire"); },
      release() { events.push("lease:release"); },
    },
    publishReady() { events.push("ready"); },
  });

  const first = bootstrap.start();
  const second = bootstrap.start();
  const third = bootstrap.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["lease:acquire", "choose"]);
  releaseChoose();

  const [firstReady, secondReady, thirdReady] = await Promise.all([first, second, third]);
  assert.equal(firstReady.bootstrapCredential, secondReady.bootstrapCredential);
  assert.equal(secondReady.bootstrapCredential, thirdReady.bootstrapCredential);
  assert.deepEqual(events, ["lease:acquire", "choose", "claim", "ready"]);

  await bootstrap.stop();
  assert.deepEqual(events, ["lease:acquire", "choose", "claim", "ready", "release", "lease:release"]);
});

test("embedded stop joins an in-flight startup before releasing its authority", async () => {
  const events = [];
  let releaseChoose;
  const chosen = new Promise((resolve) => { releaseChoose = resolve; });
  const bootstrap = createEmbeddedBootstrap({
    serverId: "stop-during-start",
    serverVersion: "1.0.0",
    dataRoot: "/private/stop-during-start",
    allocator: {
      async choose() {
        events.push("choose");
        await chosen;
        return { origin: "http://127.0.0.1:4321", endpoint: "loopback:4321" };
      },
      claim() { events.push("claim"); },
      release() { events.push("release"); },
    },
    dataRootLease: {
      acquire() { events.push("lease:acquire"); },
      release() { events.push("lease:release"); },
    },
    publishReady() { events.push("ready"); },
  });

  const start = bootstrap.start();
  await new Promise((resolve) => setImmediate(resolve));
  const firstStop = bootstrap.stop();
  const secondStop = bootstrap.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["lease:acquire", "choose"]);

  releaseChoose();
  await Promise.all([start, firstStop, secondStop]);
  assert.equal(bootstrap.phase, "stopped");
  assert.equal(bootstrap.runtime, undefined);
  assert.deepEqual(events, ["lease:acquire", "choose", "claim", "ready", "release", "lease:release"]);
});

test("embedded bootstrap releases the lease when startup fails", async () => {
  let acquired = 0;
  let released = 0;
  const bootstrap = createEmbeddedBootstrap({
    serverId: "local-server",
    serverVersion: "1.0.0",
    dataRoot: "/private/local",
    allocator: {
      choose: () => ({ origin: "http://127.0.0.1:4318", endpoint: "loopback:4318" }),
      claim: () => { throw new Error("endpoint busy"); },
      release: () => undefined,
    },
    dataRootLease: { acquire: () => { acquired += 1; }, release: () => { released += 1; } },
  });
  await assert.rejects(bootstrap.start(), /endpoint busy/);
  assert.equal(bootstrap.phase, "failed");
  assert.equal(acquired, 1);
  assert.equal(released, 1);
});

test("embedded Local stays loopback-only and unexposed until an explicit exposure action", async () => {
  const exposure = createServerRemoteExposure({
    serverId: "embedded-local",
    sessionOrigin: "https://embedded-local.remote.terminay.local",
    cleanupIntervalMs: 0,
  });
  const bootstrap = createEmbeddedBootstrap({
    serverId: "embedded-local",
    serverVersion: "1.0.0",
    dataRoot: "/private/embedded-local",
    services: { remoteExposure: exposure },
    allocator: {
      choose: () => ({ origin: "http://127.0.0.1:4319/", endpoint: "loopback:4319" }),
      claim: () => undefined,
      release: () => undefined,
    },
    dataRootLease: { acquire: () => undefined, release: () => undefined },
  });

  const ready = await bootstrap.start();
  assert.equal(ready.origin, "http://127.0.0.1:4319");
  assert.equal(exposure.status.exposure.state, "disabled");
  assert.equal(bootstrap.runtime.diagnostics().remoteExposure.state, "disabled");

  const handoff = exposure.start(Date.now() + 60_000);
  assert.equal(exposure.status.exposure.state, "exposed");
  assert.equal(handoff.serverId, "embedded-local");

  await bootstrap.stop();
  assert.equal(exposure.status.exposure.state, "disabled");
});

test("embedded Local composes the shared runtime with public UI assets and authenticated protocol access", async () => {
  await withReservedLoopbackPort(async (port, origin) => {
    const root = await mkdtemp(join(tmpdir(), "terminay-embedded-ui-"));
    const index = Buffer.from("<!doctype html><title>Embedded Terminay</title>");
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
    const bootstrap = createEmbeddedBootstrap({
      serverId: "embedded-ui",
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
    });
    try {
      const ready = await bootstrap.start();
      assert.equal(bootstrap.runtime.config.runtimeMode, "embedded");
      assert.equal(ready.origin, origin);
      const unauthenticatedManifest = await fetch(`${origin}/manifest.json`);
      assert.equal(unauthenticatedManifest.status, 200);
      assert.equal((await unauthenticatedManifest.json()).bundleId, bundleId);
      const unauthenticatedProtocol = await fetch(`${origin}/protocol/stream`);
      assert.equal(unauthenticatedProtocol.status, 401);
      assert.equal(unauthenticatedProtocol.headers.get("www-authenticate"), "Bearer");
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
      await bootstrap.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("embedded readiness publication failure tears down the authenticated listener and server services", async () => {
  await withReservedLoopbackPort(async (port, origin) => {
    const root = await mkdtemp(join(tmpdir(), "terminay-embedded-publish-failure-"));
    const index = Buffer.from("<!doctype html><title>rollback</title>");
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
    let released = 0;
    let stoppedServices = 0;
    const bootstrap = createEmbeddedBootstrap({
      serverId: "embedded-publish-failure",
      serverVersion: "1.0.0",
      dataRoot: root,
      allocator: {
        choose: () => ({ origin, endpoint: `127.0.0.1:${port}` }),
        claim: () => undefined,
        release: () => { released += 1; },
      },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      hooks: { stopServices: () => { stoppedServices += 1; } },
      createUiServer: ({ bootstrapCredential, endpoint, serverId, serverVersion }) => createLocalUiServer({
        rootDirectory: root,
        serverId,
        serverVersion,
        authToken: bootstrapCredential,
        host: "127.0.0.1",
        port: Number(new URL(endpoint.origin).port),
      }),
      publishReady: () => { throw new Error("parent disappeared before readiness"); },
    });
    try {
      await assert.rejects(bootstrap.start(), /parent disappeared before readiness/);
      assert.equal(bootstrap.phase, "failed");
      assert.equal(released, 1);
      assert.equal(stoppedServices, 1);
      await assert.rejects(fetch(`${origin}/manifest.json`), /fetch failed|ECONNREFUSED/u);
    } finally {
      await bootstrap.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("embedded bootstrap rejects a non-loopback origin before claiming it", async () => {
  let claimed = 0;
  let released = 0;
  const bootstrap = createEmbeddedBootstrap({
    serverId: "embedded-invalid",
    serverVersion: "1.0.0",
    dataRoot: "/private/embedded-invalid",
    allocator: {
      choose: () => ({ origin: "https://192.0.2.10:4319", endpoint: "public:4319" }),
      claim: () => { claimed += 1; },
      release: () => { released += 1; },
    },
    dataRootLease: { acquire: () => undefined, release: () => undefined },
  });

  await assert.rejects(bootstrap.start(), /loopback URL/);
  assert.equal(claimed, 0);
  assert.equal(released, 0);
  assert.equal(bootstrap.phase, "failed");
});

test("file data-root lease prevents a second authority and releases atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-data-root-"));
  const first = new FileDataRootLease();
  const second = new FileDataRootLease();
  try {
    await first.acquire(root);
    const lock = await stat(join(root, ".terminay-server.lock"));
    assert.equal(lock.mode & 0o777, 0o600);
    assert.match(await readFile(join(root, ".terminay-server.lock"), "utf8"), /"pid"/);
    await assert.rejects(second.acquire(root), /data root is already in use/);
    await first.release(root);
    await second.acquire(root);
    await second.release(root);
    await assert.rejects(stat(join(root, ".terminay-server.lock")), { code: "ENOENT" });
  } finally {
    await first.release(root);
    await second.release(root);
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Another process can take a reserved loopback port between the reservation
 * closing its probe socket and the code under test binding it. Retrying with a
 * fresh port keeps every assertion below unchanged.
 */
async function withReservedLoopbackPort(run, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    const port = await reserveLoopbackPort();
    try {
      return await run(port, `http://127.0.0.1:${port}`);
    } catch (error) {
      if (attempt >= attempts || !isAddressInUse(error)) throw error;
    }
  }
}

function isAddressInUse(error) {
  // A stolen port can surface directly, wrapped in a cause chain, or as the
  // `actual` error of an assert.rejects whose message no longer matches.
  const seen = new Set();
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (current.code === "EADDRINUSE") return true;
    queue.push(current.cause, current.actual);
  }
  return false;
}

async function reserveLoopbackPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => listener.close((error) => error === undefined ? resolve() : reject(error)));
  return port;
}
