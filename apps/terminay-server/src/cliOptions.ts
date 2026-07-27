export interface ServerCliOptions {
  readonly command: "start" | "status" | "pairing" | "mcp" | "help" | "version";
  readonly serverId: string;
  readonly serverVersion: string;
  readonly dataRoot: string;
  readonly endpoint: string;
  readonly remoteOrigin: string;
  readonly logSink?: string;
  readonly uiBundle?: string;
}

export function parseServerCliOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): ServerCliOptions {
  const command = argv.includes("--help") ? "help" : argv.includes("--version") ? "version" : argv.includes("--status") ? "status" : argv.includes("--pairing") ? "pairing" : argv[0] === "mcp" ? "mcp" : "start";
  const serverId = value(argv, "--server-id") ?? env.TERMINAY_SERVER_ID ?? "local-server";
  const remoteOrigin = value(argv, "--remote-origin") ?? env.TERMINAY_REMOTE_ORIGIN ?? defaultRemoteOrigin(serverId);
  const logSink = value(argv, "--log-sink") ?? env.TERMINAY_LOG_SINK;
  const uiBundle = value(argv, "--ui-bundle") ?? env.TERMINAY_UI_BUNDLE;
  return Object.freeze({
    command,
    serverId,
    serverVersion: env.TERMINAY_SERVER_VERSION ?? "0.0.0",
    dataRoot: value(argv, "--data-root") ?? env.TERMINAY_DATA_ROOT ?? ".terminay",
    endpoint: value(argv, "--endpoint") ?? env.TERMINAY_ENDPOINT ?? "loopback",
    remoteOrigin,
    ...(logSink === undefined ? {} : { logSink }),
    ...(uiBundle === undefined ? {} : { uiBundle }),
  });
}

export function formatServerHelp(): string {
  return `${[
    "Usage: terminay-server [mcp|--status|--pairing|--version] [options]",
    "Options:",
    "  --data-root PATH   server data directory (TERMINAY_DATA_ROOT)",
    "  --server-id ID     stable server identity (TERMINAY_SERVER_ID)",
    "  --endpoint VALUE   local endpoint policy (TERMINAY_ENDPOINT)",
    "  --remote-origin URL remote WebRTC session origin (TERMINAY_REMOTE_ORIGIN)",
    "  --log-sink PATH    structured log destination (TERMINAY_LOG_SINK)",
    "  --ui-bundle PATH   matching workspace bundle (TERMINAY_UI_BUNDLE)",
    "  --pairing          print a short-lived pairing handoff record",
    "  --status           print redacted runtime configuration",
    "  --version          print the server version",
    "  mcp                run the headless MCP stdio adapter (requires inherited control env)",
  ].join("\n")}\n`;
}

function defaultRemoteOrigin(serverId: string): string {
  const label = serverId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "server";
  return `https://${label}.remote.terminay.local`;
}

function value(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--") || next.length === 0) throw new Error(`${name} requires a value`);
  return next;
}
