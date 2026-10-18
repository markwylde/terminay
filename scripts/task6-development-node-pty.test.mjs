import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { TerminayClient, WebSocketByteTransport } from "@terminay/client-core";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repositoryRoot, "apps", "terminay-server");
const cli = join(serverRoot, "dist", "cli.js");
const supportedPlatform = process.platform === "darwin" || process.platform === "linux";

test("compiled development CLI resolves its declared node-pty outside a hostile cwd and emits real PTY output", { skip: !supportedPlatform }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-task6-development-node-pty-"));
  let child;
  try {
    const hostileCwd = join(root, "hostile-cwd");
    const hostileNodePty = join(hostileCwd, "node_modules", "node-pty");
    await mkdir(hostileNodePty, { recursive: true });
    await writeFile(join(hostileNodePty, "package.json"), '{"name":"node-pty","type":"module","main":"index.js"}\n');
    await writeFile(join(hostileNodePty, "index.js"), "throw new Error('hostile node-pty was loaded');\n");

    child = spawn(process.execPath, [
      cli,
      "--server-id", "development-node-pty",
      "--data-root", join(root, "data"),
      "--project-root", serverRoot,
      "--http-host", "127.0.0.1",
      "--http-port", "0",
      "--agent-integration", "disabled",
    ], {
      cwd: hostileCwd,
      env: {
        ...process.env,
        HOME: join(root, "home"),
        NODE_PATH: join(hostileCwd, "node_modules"),
        TERMINAY_SERVER_VERSION: "development-node-pty",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const readiness = await readReadiness(child);
    assert.equal(readiness.ready, true);
    assert.match(readiness.protocolEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);

    const pairing = new URLSearchParams(new URL(readiness.pairing.pairingUrl).hash.slice(1));
    const pairingToken = pairing.get("pairingToken");
    assert.ok(pairingToken);
    const client = new TerminayClient({
      transport: new WebSocketByteTransport({ origin: readiness.protocolEndpoint, authToken: pairingToken, WebSocket }),
      clientId: "development-node-pty-client",
      clientVersion: "1.0.0",
    });
    try {
      await client.connect();
      const identity = { serverId: "development-node-pty", projectId: "default", sessionId: "default" };
      const attached = await client.command("terminal.attach", {
        clientId: "development-node-pty-client",
        identity,
        fromPosition: 0,
      });
      assert.equal(attached.ok, true);
      const subscription = await client.subscribe("terminal", {
        subscriptionId: "development-node-pty-output",
        fromRevision: 0,
      });
      const output = [];
      let printed;
      const marker = new Promise((resolve) => { printed = resolve; });
      const removeOutputListener = subscription.onEvent((event) => {
        if (event.payload?.type !== "output" || event.payload?.attachmentId !== attached.result.attachmentId) return;
        output.push(Buffer.from(event.payload.bytes, "base64").toString("utf8"));
        if (output.join("").includes("DEVELOPMENT_NODE_PTY_OK")) printed();
      });
      const command = Buffer.from("printf 'DEVELOPMENT_NODE_PTY_OK\\n'\n", "utf8").toString("base64");
      try {
        const input = await client.command("terminal.input", {
          clientId: "development-node-pty-client",
          identity,
          attachmentId: attached.result.attachmentId,
          dataBase64: command,
          source: "remote",
        });
        assert.equal(input.ok, true);
        await marker;
        assert.match(output.join(""), /DEVELOPMENT_NODE_PTY_OK/u);
      } finally {
        removeOutputListener();
        await subscription.unsubscribe();
      }
    } finally {
      client.close();
    }

    const exit = await stop(child);
    assert.equal(exit.code, 0, exit.stderr);
    child = undefined;
  } finally {
    // Only a failure leaves the child running; end it outright.
    if (child !== undefined) await stop(child, "SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

function readReadiness(child) {
  return new Promise((resolve, reject) => {
    // Readiness is the first line on stdout. The CLI either prints it or
    // exits; both are events, so nothing here waits on a clock.
    let output = "";
    let stderr = "";
    const fail = (code) => {
      reject(new Error(`development CLI exited before readiness (${code}): ${stderr}`));
    };
    child.once("exit", fail);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      child.off("exit", fail);
      try { resolve(JSON.parse(output.slice(0, newline))); }
      catch (error) { reject(error); }
    });
  });
}

/** Signal the CLI and resolve on its exit. */
function stop(child, signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, stderr: "" });
  return new Promise((resolve) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code) => resolve({ code, stderr }));
    child.kill(signal);
  });
}
