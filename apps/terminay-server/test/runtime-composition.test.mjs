import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEmbeddedServer, createLoopbackUiServer, createStandaloneServer } from "../dist/index.js";
import { deriveUiBundleId } from "@terminay/server-core";

test("server composition passes injected platform paths to privileged service construction", async () => {
  const paths = { dataRoot: "/srv/terminay/data", home: "/srv/terminay/home", temp: "/srv/terminay/tmp", configRoot: "/srv/terminay/config", cacheRoot: "/srv/terminay/cache", logRoot: "/srv/terminay/log" };
  let received;
  const service = { marker: "server-owned" };
  const runtime = createStandaloneServer({
    serverId: "composed-server",
    serverVersion: "1.0.0",
    dataRoot: paths.dataRoot,
    platformPaths: paths,
    serviceFactory: {
      create(context) {
        received = context;
        return { settings: service };
      },
    },
  });
  assert.equal(runtime.config.services, undefined);
  assert.deepEqual(received.paths, paths);
  assert.equal(received.config.runtimeMode, "standalone");
  assert.equal(runtime.services.settings, service);
  await runtime.start();
  await runtime.stop();
  assert.throws(() => createEmbeddedServer({ serverId: "missing-paths", serverVersion: "1.0.0", dataRoot: "/srv/data", serviceFactory: { create: () => ({}) } }), /injected platform paths/);
  assert.throws(() => createStandaloneServer({ serverId: "mismatched-paths", serverVersion: "1.0.0", dataRoot: "/srv/data", platformPaths: { ...paths }, serviceFactory: { create: () => ({}) } }), /does not match/);
});

test("loopback UI listeners use OS-assigned ports instead of a probe-and-race port", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-loopback-"));
  const content = Buffer.from("<!doctype html><title>loopback</title>");
  const hash = createHash("sha256").update(content).digest("base64url");
  const provisional = [{ contentType: "text/html; charset=utf-8", hash, path: "/remote-app/provisional/index.html", size: content.byteLength }];
  const bundleId = deriveUiBundleId(provisional, "provisional");
  await writeFile(join(root, "index.html"), content);
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: 1, bundleId, serverVersion: "1.0.0", protocolVersion: "1", entryPath: `/remote-app/${bundleId}/index.html`, assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })) }));
  const first = createLoopbackUiServer({ rootDirectory: root, serverId: "loopback-one", serverVersion: "1.0.0", authToken: "loopback-one-token-123456" });
  const second = createLoopbackUiServer({ rootDirectory: root, serverId: "loopback-two", serverVersion: "1.0.0", authToken: "loopback-two-token-123456" });
  try {
    const [firstAddress, secondAddress] = await Promise.all([first.start(), second.start()]);
    assert.equal(firstAddress.host, "127.0.0.1");
    assert.equal(secondAddress.host, "127.0.0.1");
    assert.notEqual(firstAddress.port, secondAddress.port);
    assert.match(firstAddress.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.match(secondAddress.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime lifecycle clears the bounded shutdown timer after services finish", async () => {
  const runtime = createStandaloneServer({
    serverId: "lifecycle-server",
    serverVersion: "1.0.0",
    dataRoot: "/srv/terminay/lifecycle",
    shutdownTimeoutMs: 2_000,
    hooks: { stopServices: async () => undefined },
  });
  await runtime.start();
  const startedAt = Date.now();
  await runtime.stop();
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(runtime.health().phase, "stopped");
});

test("embedded shutdown still releases server services when its UI listener stop fails", async () => {
  let stoppedServices = 0;
  const runtime = createEmbeddedServer({
    serverId: "embedded-listener-stop-failure",
    serverVersion: "1.0.0",
    dataRoot: "/srv/terminay/embedded-listener-stop-failure",
    hooks: {
      stopServices: () => { stoppedServices += 1; },
    },
    uiServer: {
      async start() {},
      async stop() { throw new Error("listener close failed"); },
    },
  });
  await runtime.start();
  await assert.rejects(runtime.stop(), (error) => {
    assert.match(error.message, /server runtime shutdown failed/);
    assert.ok(Array.isArray(error.errors));
    assert.match(error.errors[0]?.message ?? "", /listener close failed/);
    return true;
  });
  assert.equal(stoppedServices, 1);
  assert.equal(runtime.health().phase, "stopped");
});

test("headless and embedded launches share the same runtime lifecycle contract", async (t) => {
  const launchModes = [
    ["headless", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ];

  for (const [mode, createServer] of launchModes) {
    await t.test(mode, async () => {
      const hooks = { started: 0, stopped: 0 };
      const runtime = createServer({
        serverId: `${mode}-lifecycle`,
        serverVersion: "1.0.0",
        dataRoot: `/srv/terminay/${mode}`,
        shutdownTimeoutMs: 2_000,
        hooks: {
          startServices(config) {
            hooks.started += 1;
            assert.equal(config.runtimeMode, mode === "headless" ? "standalone" : "embedded");
          },
          stopServices() {
            hooks.stopped += 1;
          },
        },
      });

      assert.equal(runtime.health().phase, "created");
      assert.equal(runtime.diagnostics().runtimeMode, mode === "headless" ? "standalone" : "embedded");

      const ready = await runtime.start();
      assert.deepEqual(ready, {
        phase: "ready",
        serverId: `${mode}-lifecycle`,
        version: "1.0.0",
        ready: true,
        uptimeMs: ready.uptimeMs,
      });
      assert.deepEqual(hooks, { started: 1, stopped: 0 });

      await runtime.stop();
      await runtime.stop();
      assert.equal(runtime.health().phase, "stopped");
      assert.deepEqual(hooks, { started: 1, stopped: 1 });
    });
  }
});

test("headless and embedded runtimes give the authenticated UI listener the same lifecycle boundary", async (t) => {
  const launchModes = [
    ["headless", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ];

  for (const [mode, createServer] of launchModes) {
    await t.test(mode, async () => {
      const events = [];
      const uiServer = {
        async start() { events.push("ui:start"); },
        async stop() { events.push("ui:stop"); },
      };
      const runtime = createServer({
        serverId: `${mode}-ui-lifecycle`,
        serverVersion: "1.0.0",
        dataRoot: `/srv/terminay/${mode}-ui-lifecycle`,
        uiServer,
        hooks: {
          async startServices() { events.push("services:start"); },
          async stopServices() { events.push("services:stop"); },
        },
      });

      await runtime.start();
      await runtime.stop();
      await runtime.stop();

      assert.deepEqual(events, [
        "services:start",
        "ui:start",
        "ui:stop",
        "services:stop",
      ]);
    });
  }
});

test("headless and embedded runtime startup roll back server services exactly once when their UI listener fails", async (t) => {
  const launchModes = [
    ["headless", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ];

  for (const [mode, createServer] of launchModes) {
    await t.test(mode, async () => {
      const events = [];
      const runtime = createServer({
        serverId: `${mode}-ui-start-failure`,
        serverVersion: "1.0.0",
        dataRoot: `/srv/terminay/${mode}-ui-start-failure`,
        uiServer: {
          async start() {
            events.push("ui:start");
            throw new Error("listener bind failed");
          },
          async stop() { events.push("ui:stop"); },
        },
        hooks: {
          async startServices() { events.push("services:start"); },
          async stopServices() { events.push("services:stop"); },
        },
      });

      await assert.rejects(runtime.start(), /listener bind failed/);
      assert.equal(runtime.health().phase, "failed");
      await runtime.stop();
      await runtime.stop();

      assert.deepEqual(events, [
        "services:start",
        "ui:start",
        "ui:stop",
        "services:stop",
      ]);
      assert.equal(runtime.health().phase, "stopped");
    });
  }
});

test("headless and embedded runtime startup roll back partial services when composition startup fails before the UI listener", async (t) => {
  const launchModes = [
    ["headless", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ];

  for (const [mode, createServer] of launchModes) {
    await t.test(mode, async () => {
      const events = [];
      const runtime = createServer({
        serverId: `${mode}-service-start-failure`,
        serverVersion: "1.0.0",
        dataRoot: `/srv/terminay/${mode}-service-start-failure`,
        uiServer: {
          async start() { events.push("ui:start"); },
          async stop() { events.push("ui:stop"); },
        },
        hooks: {
          async startServices() {
            events.push("services:start");
            throw new Error("service composition failed");
          },
          async stopServices() { events.push("services:stop"); },
        },
      });

      await assert.rejects(runtime.start(), /service composition failed/);
      assert.equal(runtime.health().phase, "failed");
      await runtime.stop();
      await runtime.stop();

      assert.deepEqual(events, ["services:start", "services:stop"]);
      assert.equal(runtime.health().phase, "stopped");
    });
  }
});

test("headless and embedded runtimes coalesce concurrent starts before shared service or UI-listener side effects", async (t) => {
  const launchModes = [
    ["headless", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ];

  for (const [mode, createServer] of launchModes) {
    await t.test(mode, async () => {
      const events = [];
      const runtime = createServer({
        serverId: `${mode}-coalesced-start`,
        serverVersion: "1.0.0",
        dataRoot: `/srv/terminay/${mode}-coalesced-start`,
        uiServer: {
          async start() { events.push("ui:start"); },
          async stop() { events.push("ui:stop"); },
        },
        hooks: {
          async startServices() { events.push("services:start"); },
          async stopServices() { events.push("services:stop"); },
        },
      });

      const [first, second, third] = await Promise.all([
        runtime.start(),
        runtime.start(),
        runtime.start(),
      ]);

      assert.equal(first.phase, "ready");
      assert.equal(second.phase, "ready");
      assert.equal(third.phase, "ready");
      assert.deepEqual(events, ["services:start", "ui:start"]);

      await runtime.stop();
      assert.deepEqual(events, ["services:start", "ui:start", "ui:stop", "services:stop"]);
    });
  }
});
