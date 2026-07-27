import {
  RemoteConnectionManager,
  RemoteExposureController,
  RemotePairingStore,
} from "@terminay/server-core";
import { createStandaloneServer, runServerMcpStdio } from "./index.js";
import { formatServerHelp, parseServerCliOptions } from "./cliOptions.js";

declare const process: {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void;
  exitCode?: number;
};

const options = parseServerCliOptions(process.argv.slice(2), process.env);
if (options.command === "help") process.stdout.write(formatServerHelp());
else if (options.command === "version") process.stdout.write(`${options.serverVersion}\n`);
else if (options.command === "mcp") {
  const socketPath = process.env.TERMINAY_CONTROL_SOCKET;
  const token = process.env.TERMINAY_CONTROL_TOKEN ?? "";
  if (socketPath === undefined || socketPath.length === 0) {
    process.stderr.write("terminay mcp requires TERMINAY_CONTROL_SOCKET\n");
    process.exitCode = 1;
  } else {
    runServerMcpStdio({ socketPath, token }).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "MCP adapter failed"}\n`);
      process.exitCode = 1;
    });
  }
}
else {
  const runtime = createStandaloneServer({
    serverId: options.serverId,
    serverVersion: options.serverVersion,
    dataRoot: options.dataRoot,
    localEndpoint: options.endpoint,
    ...(options.logSink === undefined ? {} : { logSink: options.logSink }),
    ...(options.uiBundle === undefined ? {} : { uiBundle: options.uiBundle }),
  });
  const remote = createRemoteExposure(options.serverId, options.remoteOrigin);
  if (options.command === "status") {
    process.stdout.write(`${JSON.stringify({ ...runtime.diagnostics(), remoteExposure: summarizeRemoteStatus(remote.status) })}\n`);
  }
  else if (options.command === "pairing") {
    const handoff = remote.start(Date.now() + 60_000);
    process.stdout.write(`${JSON.stringify({ serverId: options.serverId, endpoint: options.endpoint, roomId: handoff.roomId, pairingUrl: handoff.pairingUrl, expiresAt: new Date(handoff.expiresAt).toISOString(), expiresInSeconds: Math.max(1, Math.ceil((handoff.expiresAt - Date.now()) / 1000)), requiresApproval: true })}\n`);
  }
  else {
    runtime.start().then((health) => {
      process.stdout.write(`${JSON.stringify({ ready: health.ready, serverId: health.serverId, version: health.version, endpoint: runtime.config.localEndpoint ?? null, dataRoot: runtime.config.dataRoot, logSink: runtime.config.logSink ?? null })}\n`);
    }).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "server failed"}\n`); process.exitCode = 1; });
    const shutdown = () => { void runtime.stop(); };
    process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  }
}

function createRemoteExposure(serverId: string, sessionOrigin: string): RemoteExposureController {
  const manager = new RemoteConnectionManager({ serverId, sessionOrigin });
  const pairing = new RemotePairingStore({ serverId, sessionOrigin });
  return new RemoteExposureController({ manager, pairing });
}

function summarizeRemoteStatus(status: RemoteExposureController["status"]): Record<string, unknown> {
  return {
    state: status.exposure.state,
    roomId: status.pairing?.roomId ?? null,
    expiresAt: status.exposure.expiresAt === undefined ? null : new Date(status.exposure.expiresAt).toISOString(),
    connectedPeers: status.peers.filter((peer) => peer.state === "connected").length,
    headlessSessions: status.sessions.length,
  };
}
