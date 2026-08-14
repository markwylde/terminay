import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stageProductionDependencyClosure } from "../../../scripts/standalone-runtime-dependencies.mjs";

const repositoryRoot = new URL("../../..", import.meta.url).pathname;

test("Desktop embedded adapter delegates runtime construction to the shared server package", async () => {
  const source = await readFile(new URL("../src/main/embeddedRuntime.ts", import.meta.url), "utf8");

  // This is intentionally a small source-boundary assertion alongside the
  // extracted-package integration test below.  Desktop is allowed to own the
  // private bootstrap hand-off and lifecycle translation, but it must not
  // regain a second Local HTTP/UI listener or a server runtime implementation.
  assert.match(source, /from "@terminay\/server"/);
  assert.match(source, /createEmbeddedBootstrap\(/);
  assert.doesNotMatch(source, /from ["']electron["']/);
  assert.doesNotMatch(source, /createLocalUiServer\s*\(/);
  assert.doesNotMatch(source, /new\s+ServerRuntime\s*\(/);
});

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

function runFailure(command, args, options = {}) {
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
      if (code !== 0) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} unexpectedly succeeded`));
    });
  });
}

function startForeground(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

function readReadiness(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("packed Desktop server did not become ready")), 20_000);
    const fail = (code) => {
      clearTimeout(timeout);
      reject(new Error(`packed Desktop server exited before readiness (${code}): ${stderr}`));
    };
    child.once("exit", fail);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timeout);
      child.off("exit", fail);
      try { resolve(JSON.parse(output.slice(0, newline))); }
      catch (error) { reject(error); }
    });
  });
}

function stopForeground(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, stderr: "" });
  return new Promise((resolve) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: child.exitCode, stderr });
    }, 10_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr });
    });
    child.kill("SIGTERM");
  });
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

async function packAndExtract(workspace, destination) {
  await mkdir(destination, { recursive: true });
  const packed = normalizePackResult(JSON.parse((await run("npm", ["pack", "--workspace", workspace, "--json", "--pack-destination", destination], { cwd: repositoryRoot })).stdout));
  assert.equal(packed.length, 1);
  const archive = join(destination, packed[0].filename);
  const extracted = join(destination, "extracted");
  await mkdir(extracted);
  await run("tar", ["-xzf", archive, "-C", extracted]);
  return join(extracted, "package");
}

function normalizePackResult(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

async function assertNoSymlinks(root) {
  const { lstat, readdir } = await import("node:fs/promises");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const details = await lstat(path);
    assert.equal(details.isSymbolicLink(), false, `packed Desktop payload retained symlink ${path}`);
    if (details.isDirectory()) await assertNoSymlinks(path);
  }
}

function waitFor(predicate, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        if (predicate()) return resolve();
      } catch (error) {
        return reject(error);
      }
      if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(check, 10);
    };
    check();
  });
}

function outputText(events) {
  return events
    .filter((event) => event.type === "output")
    .map((event) => new TextDecoder().decode(event.bytes))
    .join("");
}

test("extracted Desktop package starts the extracted shared embedded server runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-embedded-artifact-"));
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
    await assertNoSymlinks(desktopRoot);

    // The staged Desktop closure must execute the shared server's actual MCP
    // entry, rather than resolving a workspace copy or an Electron bridge.
    // It completes its release-integrity preflight and then deliberately
    // rejects the absent inherited local-control capability.
    const serverPackage = JSON.parse(await readFile(join(modules, "@terminay/server/package.json"), "utf8"));
    const mcp = await runFailure(process.execPath, [join(modules, "@terminay/server", serverPackage.bin["terminay-mcp"])], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        TERMINAY_SERVER_VERSION: serverPackage.version,
        TERMINAY_CONTROL_SOCKET: "",
        TERMINAY_CONTROL_TOKEN: "",
      },
    });
    assert.equal(mcp.code, 1);
    assert.equal(mcp.stdout, "");
    assert.match(mcp.stderr, /terminay mcp failed: TypeError: Terminay MCP requires an absolute local control socket/);

    // The Desktop closure must also execute the shared server's real pairing
    // CLI, rather than resolving a workspace CLI or an Electron-owned remote
    // implementation. Pairing is intentionally a short-lived, fragment-only
    // bootstrap record; keep it in memory and assert the exact staged server
    // dependency honours its configured origin.
    const pairing = await run(process.execPath, [
      join(modules, "@terminay/server", serverPackage.bin["terminay-server"]),
      "--pairing",
      "--server-id", "packed-desktop-pairing",
      "--remote-origin", "https://packed-desktop-pairing.example.test",
      "--data-root", join(root, "pairing-data"),
    ], {
      cwd: desktopRoot,
      env: { ...process.env, TERMINAY_SERVER_VERSION: serverPackage.version },
    });
    assert.equal(pairing.stderr, "");
    const pairingRecord = JSON.parse(pairing.stdout);
    assert.equal(pairingRecord.serverId, "packed-desktop-pairing");
    assert.equal(pairingRecord.endpoint, "loopback");
    assert.equal(pairingRecord.requiresApproval, true);
    assert.equal(pairingRecord.roomId, pairingRecord.pairingSessionId);
    const pairingUrl = new URL(pairingRecord.pairingUrl);
    assert.equal(pairingUrl.origin, "https://packed-desktop-pairing.example.test");
    assert.equal(pairingUrl.search, "");
    const pairingBootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
    assert.equal(pairingBootstrap.get("pairingSessionId"), pairingRecord.pairingSessionId);
    assert.ok(pairingBootstrap.get("pairingToken"));
    assert.equal(pairingBootstrap.get("pairingExpiresAt"), pairingRecord.expiresAt);

    // Status follows a distinct CLI path from pairing and must retain the
    // standalone server's flag-over-environment precedence and redaction when
    // invoked from Desktop's isolated staged closure.
    const environmentDataRoot = join(root, "environment-data-root");
    const flagDataRoot = join(root, "flag-data-root");
    const privateLog = join(root, "private-log.jsonl");
    const privateBundle = join(root, "private-ui-bundle");
    const statusResult = await run(process.execPath, [
      join(modules, "@terminay/server", serverPackage.bin["terminay-server"]),
      "--status",
      "--server-id", "packed-desktop-status-flag",
      "--data-root", flagDataRoot,
    ], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        TERMINAY_SERVER_VERSION: serverPackage.version,
        TERMINAY_SERVER_ID: "packed-desktop-status-environment",
        TERMINAY_DATA_ROOT: environmentDataRoot,
        TERMINAY_LOG_SINK: privateLog,
        TERMINAY_UI_BUNDLE: privateBundle,
      },
    });
    assert.equal(statusResult.stderr, "");
    const status = JSON.parse(statusResult.stdout);
    assert.equal(status.runtimeMode, "standalone");
    assert.equal(status.serverId, "packed-desktop-status-flag");
    assert.equal(status.version, serverPackage.version);
    assert.equal(status.dataRootConfigured, true);
    assert.equal(status.uiBundleConfigured, true);
    for (const privateValue of [environmentDataRoot, flagDataRoot, privateLog, privateBundle]) {
      assert.equal(JSON.stringify(status).includes(privateValue), false, `status must redact ${privateValue}`);
    }

    // Run the same staged server as a foreground authority from the extracted
    // Desktop closure. This is intentionally distinct from the embedded
    // adapter below: it proves the packaged Desktop payload has no hidden
    // workspace/Electron dependency for the server's lifecycle, health, and
    // clean signal shutdown paths.
    const foregroundHome = join(root, "foreground-home");
    await mkdir(foregroundHome);
    const foreground = startForeground(process.execPath, [
      join(modules, "@terminay/server", serverPackage.bin["terminay-server"]),
      "--server-id", "packed-desktop-foreground",
      "--data-root", join(root, "foreground-data"),
      "--project-root", desktopRoot,
      "--endpoint", "disabled",
      "--health-host", "127.0.0.1",
      "--health-port", "0",
      "--agent-integration", "disabled",
    ], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        HOME: foregroundHome,
        TERMINAY_SERVER_VERSION: serverPackage.version,
      },
    });
    try {
      const foregroundReady = await readReadiness(foreground);
      assert.equal(foregroundReady.ready, true);
      assert.equal(foregroundReady.serverId, "packed-desktop-foreground");
      assert.equal(foregroundReady.version, serverPackage.version);
      assert.equal(foregroundReady.protocolEndpoint, null);
      assert.match(foregroundReady.healthEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
      const health = await fetch(`${foregroundReady.healthEndpoint}/readyz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), {
        status: "ok",
        ready: true,
        phase: "ready",
        serverId: "packed-desktop-foreground",
        version: serverPackage.version,
      });
    } finally {
      const exit = await stopForeground(foreground);
      assert.equal(exit.code, 0, exit.stderr);
    }

    const desktop = await import(pathToFileURL(join(desktopRoot, "dist/main/embeddedRuntime.js")).href);
    const server = await import(pathToFileURL(join(modules, "@terminay/server/dist/index.js")).href);
    const serverCore = await import(pathToFileURL(join(modules, "@terminay/server-core/dist/index.js")).href);
    const nodePty = await import(pathToFileURL(join(modules, "node-pty/lib/index.js")).href);
    const firstPort = await reserveLoopbackPort();
    const secondPort = await reserveLoopbackPort();
    const endpoints = [
      { origin: `http://127.0.0.1:${firstPort}`, endpoint: `127.0.0.1:${firstPort}` },
      { origin: `http://127.0.0.1:${secondPort}`, endpoint: `127.0.0.1:${secondPort}` },
    ];
    let endpointIndex = 0;
    const bundleRoot = join(root, "bundle");
    await mkdir(bundleRoot);
    const index = Buffer.from("<!doctype html><title>Packed Desktop Local</title>");
    const hash = createHash("sha256").update(index).digest("base64url");
    const bundleId = serverCore.deriveUiBundleId([
      { path: "/remote-app/provisional/index.html", contentType: "text/html; charset=utf-8", hash, size: index.byteLength },
    ], "provisional");
    await writeFile(join(bundleRoot, "index.html"), index);
    await writeFile(join(bundleRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      bundleId,
      serverVersion: "1.0.0",
      protocolVersion: "1",
      entryPath: `/remote-app/${bundleId}/index.html`,
      assets: [{ path: `/remote-app/${bundleId}/index.html`, contentType: "text/html; charset=utf-8", hash, size: index.byteLength }],
    }));

    const local = desktop.createDesktopEmbeddedLocalServer({
      claim: () => ({ value: "packed-desktop-bootstrap-credential", expiresAt: Date.now() + 60_000 }),
    }, {
      serverId: "packed-desktop",
      serverVersion: "1.0.0",
      dataRoot: bundleRoot,
      allocator: {
        choose: () => endpoints[Math.min(endpointIndex++, endpoints.length - 1)],
        claim: () => undefined,
        release: () => undefined,
      },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      createUiServer: ({ bootstrapCredential, endpoint, serverId, serverVersion }) => server.createLocalUiServer({
        rootDirectory: bundleRoot,
        serverId,
        serverVersion,
        authToken: bootstrapCredential,
        host: "127.0.0.1",
        port: Number(new URL(endpoint.origin).port),
      }),
    });
    try {
      const ready = await local.start();
      assert.equal(ready.origin, endpoints[0].origin);
      const manifest = await fetch(`${ready.origin}/manifest.json`, { headers: { Authorization: `Bearer ${ready.bootstrapCredential}` } });
      assert.equal(manifest.status, 200);
      assert.equal((await manifest.json()).bundleId, bundleId);
      const asset = await fetch(`${ready.origin}/remote-app/${bundleId}/index.html`, { headers: { Authorization: `Bearer ${ready.bootstrapCredential}` } });
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), index);

      // This must resolve node-pty from the extracted Desktop closure, not
      // from the workspace's native module.  The actual TerminalService is
      // deliberately exercised because merely importing a native addon does
      // not prove that its ABI can create the server-owned child process.
      const terminal = new serverCore.TerminalService({
        serverId: "packed-desktop",
        ptyFactory: serverCore.createNodePtyFactory(nodePty),
      });
      const events = [];
      const session = await terminal.createSession({
        projectId: "default",
        sessionId: "packed-desktop-node-pty",
        shellPath: "/bin/sh",
        args: ["-c", "printf 'PACKED_DESKTOP_NODE_PTY_OK\\n'"],
        cwd: bundleRoot,
        cols: 80,
        rows: 24,
      });
      const subscription = terminal.subscribe(session.identity, {
        authorization: { ...session.identity, clientId: "artifact-test", scope: "read" },
        fromPosition: 0,
        onEvent: (event) => events.push(event),
      });
      try {
        await waitFor(
          () => session.status === "exited" && outputText(events).includes("PACKED_DESKTOP_NODE_PTY_OK"),
          "extracted Desktop node-pty session",
        );
        assert.equal(session.exit.reason, "exit");
      } finally {
        subscription.close();
        await terminal.shutdown();
      }

      // Exercise the provider-CLI adapter from the extracted server-core
      // closure as well. This is deliberately an actual child-process
      // invocation rather than a configured-model shortcut: it proves the
      // packaged Desktop runtime can load the shared provider adapter and run
      // a bounded server-owned CLI command without resolving workspace code.
      const providers = serverCore.createServerAiProviderAdapters({
        cwd: bundleRoot,
        environment: { PATH: process.env.PATH ?? "" },
        commands: {
          codex: {
            command: process.execPath,
            listArgs: () => ["-e", "process.stdout.write('packed-provider-cli')"],
            parseModels: (stdout) => [{ id: stdout.trim(), label: "Packed provider CLI" }],
          },
        },
      });
      assert.deepEqual(
        await providers.codex.listModels({
          provider: "codex",
          signal: new AbortController().signal,
          maxOutputBytes: 1024,
        }),
        [{ id: "packed-provider-cli", label: "Packed provider CLI" }],
      );

      // A packaged Desktop adapter must be able to deliberately retire and
      // recreate the shared embedded authority.  This verifies the extracted
      // runtime does not retain a Desktop-only listener or stale endpoint:
      // the shared bootstrap releases the first listener, claims a newly
      // allocated loopback origin, and serves the exact verified bundle again.
      await local.stop();
      const restarted = await local.start();
      assert.equal(restarted.origin, endpoints[1].origin);
      assert.notEqual(restarted.origin, ready.origin);
      assert.equal(restarted.bootstrapCredential, ready.bootstrapCredential);
      const restartedManifest = await fetch(`${restarted.origin}/manifest.json`, {
        headers: { Authorization: `Bearer ${restarted.bootstrapCredential}` },
      });
      assert.equal(restartedManifest.status, 200);
      assert.equal((await restartedManifest.json()).bundleId, bundleId);
      const restartedAsset = await fetch(`${restarted.origin}/remote-app/${bundleId}/index.html`, {
        headers: { Authorization: `Bearer ${restarted.bootstrapCredential}` },
      });
      assert.deepEqual(Buffer.from(await restartedAsset.arrayBuffer()), index);
    } finally {
      await local.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extracted Desktop package refuses an expired private bootstrap credential before a shared listener can start", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-desktop-expired-bootstrap-artifact-"));
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
    await assertNoSymlinks(desktopRoot);
    const desktop = await import(pathToFileURL(join(desktopRoot, "dist/main/embeddedRuntime.js")).href);
    let uiServerCreated = false;
    assert.throws(() => desktop.createDesktopEmbeddedLocalServer({
      claim: () => ({ value: "packed-desktop-expired-credential", expiresAt: Date.now() - 1 }),
    }, {
      serverId: "packed-desktop-expired-bootstrap",
      serverVersion: "1.0.0",
      dataRoot: root,
      allocator: { choose: () => ({ origin: "http://127.0.0.1:1", endpoint: "127.0.0.1:1" }), claim: () => undefined, release: () => undefined },
      dataRootLease: { acquire: () => undefined, release: () => undefined },
      createUiServer: () => {
        uiServerCreated = true;
        throw new Error("expired Desktop credential must not construct a listener");
      },
    }), /bootstrap credential expired before embedded Local startup/u);
    assert.equal(uiServerCreated, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
