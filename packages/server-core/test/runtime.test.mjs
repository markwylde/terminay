import test from "node:test";
import assert from "node:assert/strict";
import { ServerRuntime, ServerSettingsRepository, ServerVaultService } from "../dist/index.js";

test("server runtime exposes redacted health and bounded lifecycle", async () => {
  const transitions = [];
  const runtime = new ServerRuntime({ serverId: "server-a", serverVersion: "1.0.0", dataRoot: "/var/lib/terminay", runtimeMode: "standalone", localEndpoint: "loopback", shutdownTimeoutMs: 100 }, { startServices: () => transitions.push("start"), stopServices: () => transitions.push("stop") });
  assert.equal(runtime.diagnostics().dataRootConfigured, true);
  assert.equal(runtime.diagnostics().uiBundleConfigured, false);
  assert.equal((await runtime.start()).ready, true);
  await runtime.stop();
  assert.deepEqual(transitions, ["start", "stop"]);
  assert.equal(runtime.health().phase, "stopped");
});

test("shutdown returns at the configured deadline when a service hangs", async () => {
  const runtime = new ServerRuntime({ serverId: "server-timeout", serverVersion: "1.0.0", dataRoot: "/tmp/a", runtimeMode: "standalone", shutdownTimeoutMs: 5 }, { stopServices: () => new Promise(() => {}) });
  await runtime.start();
  const started = Date.now();
  await runtime.stop();
  assert.ok(Date.now() - started < 500);
  assert.equal(runtime.health().phase, "stopped");
});

test("runtime composes settings and vault metadata without creating a secret transport path", async () => {
  let state = "locked";
  const references = new Map();
  const adapter = {
    backend: "custom",
    status: () => state,
    async unlock(request) { state = "unlocked"; request.secret.fill(0); },
    lock() { state = "locked"; },
    list: () => [...references.values()],
    async put(input) { references.set(input.id, { id: input.id, configured: true, label: input.label, version: 1 }); input.value.fill(0); return references.get(input.id); },
    async replace(input) { input.value.fill(0); return references.get(input.id); },
    async test(id) { if (!references.has(id)) throw new Error("missing secret"); },
    async remove(id) { return references.delete(id); },
    async rotate() {},
    async withSecret(id, callback) { if (!references.has(id)) throw new Error("missing secret"); return callback(new Uint8Array(Buffer.from("runtime-secret-sentinel"))); },
  };
  const vault = new ServerVaultService(adapter);
  let persisted;
  const settings = new ServerSettingsRepository({ async load() { return persisted; }, async commit(value) { persisted = value; } });
  await settings.load();
  let hookServices;
  const runtime = new ServerRuntime({
    serverId: "server-services",
    serverVersion: "1.0.0",
    dataRoot: "/tmp/services",
    runtimeMode: "standalone",
    services: { settings, vault },
  }, { startServices: (_config, services) => { hookServices = services; } });
  assert.equal(runtime.config.services, undefined);
  assert.equal(runtime.services.settings, settings);
  assert.equal(runtime.services.vault, vault);
  await runtime.start();
  assert.equal(hookServices.vault, vault);
  assert.equal(runtime.diagnostics().settingsRevision, 0);
  assert.equal(runtime.diagnostics().vault.state, "locked");
  assert.equal(JSON.stringify(runtime.diagnostics()).includes("runtime-secret-sentinel"), false);
  await assert.rejects(() => runtime.withSecret("provider.key", () => undefined), /missing secret/);
  await vault.unlock({ secret: new Uint8Array(Buffer.from("unlock-passphrase")) });
  await vault.put({ id: "provider.key", label: "Provider", value: new Uint8Array([1, 2, 3]) });
  let observed = "";
  await runtime.withSecret("provider.key", (secret) => { observed = Buffer.from(secret).toString(); });
  assert.equal(observed, "runtime-secret-sentinel");
  const target = { serverId: "server-services", projectId: "project-1", sessionId: "session-1" };
  const resolveMacroSecret = runtime.createMacroSecretResolver(target);
  assert.throws(() => runtime.createMacroSecretResolver({ ...target, serverId: "other-server" }), /another server/);
  const resolved = await resolveMacroSecret(target, "provider.key");
  assert.equal(Buffer.from(resolved).toString(), "runtime-secret-sentinel");
  resolved.fill(0);
  await assert.rejects(() => resolveMacroSecret({ ...target, sessionId: "other" }, "provider.key"), /exact terminal/);
  assert.equal(JSON.stringify(runtime.diagnostics()).includes("runtime-secret-sentinel"), false);
});

test("runtime attempts every privileged teardown even when one service fails", async () => {
  const calls = [];
  const runtime = new ServerRuntime({
    serverId: "runtime-cleanup", serverVersion: "1.0.0", dataRoot: "/tmp/runtime-cleanup", runtimeMode: "standalone",
    services: {
      agents: { async start() {}, async stop() { calls.push("agents"); throw new Error("agent stop failed"); } },
      remoteExposure: { async shutdown() { calls.push("remote"); } },
      terminal: { async shutdown() { calls.push("terminal"); }, listSessions() { return []; } },
    },
  }, { stopServices: () => { calls.push("journal"); } });
  await runtime.start();
  await assert.rejects(() => runtime.stop(), /shutdown failed/u);
  assert.deepEqual(calls, ["remote", "terminal", "agents", "journal"]);
  assert.equal(runtime.state, "stopped");
});

test("stopping a never-started runtime still withdraws remote exposure", async () => {
  let shutdowns = 0;
  const runtime = new ServerRuntime({
    serverId: "runtime-created-stop", serverVersion: "1.0.0", dataRoot: "/tmp/runtime-created-stop", runtimeMode: "standalone",
    services: { remoteExposure: { async shutdown() { shutdowns += 1; } } },
  });
  await runtime.stop();
  assert.equal(shutdowns, 1);
  assert.equal(runtime.state, "stopped");
});

test("stop during startup cannot publish a ready runtime after teardown", async () => {
  let release;
  let stopped = 0;
  const runtime = new ServerRuntime({
    serverId: "runtime-start-stop", serverVersion: "1.0.0", dataRoot: "/tmp/runtime-start-stop", runtimeMode: "standalone",
  }, {
    startServices: () => new Promise((resolve) => { release = resolve; }),
    stopServices: () => { stopped += 1; },
  });
  const starting = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = runtime.stop();
  release();
  const health = await starting;
  await stopping;
  assert.equal(health.ready, false);
  assert.equal(runtime.state, "stopped");
  assert.equal(stopped, 1);
});
