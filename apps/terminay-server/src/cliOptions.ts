import { resolve } from "node:path";

export interface ServerCliOptions {
  readonly command: "start" | "status" | "pairing" | "mcp" | "help" | "version";
  readonly serverId: string;
  readonly serverVersion: string;
  readonly dataRoot: string;
  readonly projectRoot: string;
  readonly webOrigin: string;
  readonly endpoint: string;
  readonly remoteOrigin: string;
  /** Exact six-digit pairing PIN kept in the operator's protected environment. */
  readonly remotePairingPin?: string;
  readonly publicOrigin?: string;
  readonly httpHost?: string;
  readonly httpPort?: number;
  readonly healthHost?: string;
  readonly healthPort?: number;
  readonly logSink?: string;
  readonly uiBundle?: string;
  /** Whether this standalone host should reconcile its managed provider hooks. */
  readonly agentIntegrationEnabled: boolean;
  readonly aiProviders: readonly ("codex" | "claude-code")[];
  /** One-shot inherited descriptor containing the vault passphrase. */
  readonly vaultUnlockFd?: number;
}

/** Expand only an explicitly configured loopback HTTP web origin to the
 * equivalent browser loopback hostnames on the same port. Non-loopback and
 * HTTPS deployments retain exact-origin matching. */
export function allowedWebOrigins(webOrigin: string): readonly string[] {
  const parsed = new URL(normalizePublicOrigin(webOrigin));
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !loopback) return Object.freeze([parsed.origin]);
  const suffix = parsed.port === "" ? "" : `:${parsed.port}`;
  return Object.freeze([
    `http://localhost${suffix}`,
    `http://127.0.0.1${suffix}`,
    `http://[::1]${suffix}`,
  ]);
}

export function parseServerCliOptions(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): ServerCliOptions {
  const command = argv.includes("--help") ? "help" : argv.includes("--version") ? "version" : argv.includes("--status") ? "status" : argv.includes("--pairing") ? "pairing" : argv[0] === "mcp" ? "mcp" : "start";
  const serverId = value(argv, "--server-id") ?? env.TERMINAY_SERVER_ID ?? "local-server";
  const remoteOrigin = value(argv, "--remote-origin") ?? env.TERMINAY_REMOTE_ORIGIN ?? defaultRemoteOrigin(serverId);
  const remotePairingPin = env.TERMINAY_REMOTE_PAIRING_PIN;
  const publicOrigin = value(argv, "--public-origin") ?? env.TERMINAY_PUBLIC_ORIGIN;
  const logSink = value(argv, "--log-sink") ?? env.TERMINAY_LOG_SINK;
  const uiBundle = value(argv, "--ui-bundle") ?? env.TERMINAY_UI_BUNDLE;
  const httpHost = value(argv, "--http-host") ?? env.TERMINAY_HTTP_HOST;
  const httpPortValue = value(argv, "--http-port") ?? env.TERMINAY_HTTP_PORT;
  const healthHost = value(argv, "--health-host") ?? env.TERMINAY_HEALTH_HOST;
  const healthPortValue = value(argv, "--health-port") ?? env.TERMINAY_HEALTH_PORT;
  const agentIntegrationValue = value(argv, "--agent-integration") ?? env.TERMINAY_AGENT_INTEGRATION;
  const aiProvidersValue = value(argv, "--ai-providers") ?? env.TERMINAY_AI_PROVIDERS;
  const vaultUnlockFdValue = value(argv, "--vault-unlock-fd");
  return Object.freeze({
    command,
    serverId,
    serverVersion: env.TERMINAY_SERVER_VERSION ?? "0.0.0",
    dataRoot: value(argv, "--data-root") ?? env.TERMINAY_DATA_ROOT ?? ".terminay",
    projectRoot: normalizeProjectRoot(value(argv, "--project-root") ?? env.TERMINAY_PROJECT_ROOT ?? process.cwd()),
    webOrigin: normalizePublicOrigin(value(argv, "--web-origin") ?? env.TERMINAY_WEB_ORIGIN ?? "http://localhost:8080"),
    endpoint: value(argv, "--endpoint") ?? env.TERMINAY_ENDPOINT ?? "loopback",
    remoteOrigin,
    ...(remotePairingPin === undefined ? {} : { remotePairingPin }),
    ...(publicOrigin === undefined ? {} : { publicOrigin: normalizePublicOrigin(publicOrigin) }),
    ...(httpHost === undefined ? {} : { httpHost }),
    ...(httpPortValue === undefined ? {} : { httpPort: parsePort(httpPortValue, "--http-port") }),
    ...(healthHost === undefined ? {} : { healthHost }),
    ...(healthPortValue === undefined ? {} : { healthPort: parsePort(healthPortValue, "--health-port") }),
    ...(logSink === undefined ? {} : { logSink }),
    ...(uiBundle === undefined ? {} : { uiBundle }),
    agentIntegrationEnabled: parseAgentIntegration(agentIntegrationValue),
    aiProviders: parseAiProviders(aiProvidersValue),
    ...(vaultUnlockFdValue === undefined ? {} : { vaultUnlockFd: parseInheritedFd(vaultUnlockFdValue) }),
  });
}

export function formatServerHelp(): string {
  return `${[
    "Usage: terminay-server [mcp|--status|--pairing|--version] [options]",
    "Options:",
    "  --data-root PATH   server data directory (TERMINAY_DATA_ROOT)",
    "  --project-root PATH initial project root (TERMINAY_PROJECT_ROOT; defaults to cwd)",
    "  --web-origin URL   browser origin allowed to call the local protocol (TERMINAY_WEB_ORIGIN)",
    "  --server-id ID     stable server identity (TERMINAY_SERVER_ID)",
    "  --endpoint VALUE   local endpoint policy (TERMINAY_ENDPOINT)",
    "  --http-host HOST   authenticated HTTP bind host (TERMINAY_HTTP_HOST)",
    "  --http-port PORT   authenticated HTTP port; 0 selects one (TERMINAY_HTTP_PORT)",
    "  --public-origin URL advertised browser URL for the authenticated HTTP server (TERMINAY_PUBLIC_ORIGIN)",
    "  --remote-origin URL remote WebRTC session origin (TERMINAY_REMOTE_ORIGIN)",
    "  TERMINAY_REMOTE_PAIRING_PIN  required six-digit PIN for remote pairing; keep it in a protected environment file",
    "  --log-sink PATH    structured log destination (TERMINAY_LOG_SINK)",
    "  --ui-bundle PATH   matching workspace bundle (TERMINAY_UI_BUNDLE)",
    "  --agent-integration MODE  observe supported agent session journals: enabled or disabled (TERMINAY_AGENT_INTEGRATION)",
    "  --ai-providers LIST  opt in to bounded server CLI providers: codex,claude-code (TERMINAY_AI_PROVIDERS)",
    "  --health-host HOST unauthenticated liveness/readiness bind host (TERMINAY_HEALTH_HOST)",
    "  --health-port PORT unauthenticated liveness/readiness port (TERMINAY_HEALTH_PORT)",
    "  --vault-unlock-fd FD  consume vault passphrase from inherited FD >= 3; otherwise use an echo-disabled controlling terminal",
    "  --pairing          print a short-lived pairing handoff record",
    "  --status           print redacted runtime configuration",
    "  --version          print the server version",
    "  mcp                run the headless MCP stdio adapter (requires inherited control env)",
  ].join("\n")}\n`;
}

function parseInheritedFd(value: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error("--vault-unlock-fd must be an inherited fd of 3 or greater");
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error("--vault-unlock-fd must be an inherited fd of 3 or greater");
  return fd;
}

function parseAiProviders(value: string | undefined): readonly ("codex" | "claude-code")[] {
  if (value === undefined || value.trim() === "" || value === "disabled") return [];
  const providers = [...new Set(value.split(",").map((item) => item.trim()))];
  for (const provider of providers) {
    if (provider !== "codex" && provider !== "claude-code") {
      throw new Error("--ai-providers accepts only codex and claude-code");
    }
  }
  return Object.freeze(providers) as readonly ("codex" | "claude-code")[];
}

function parseAgentIntegration(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === "enabled" || value === "true" || value === "1") return true;
  if (value === "disabled" || value === "false" || value === "0") return false;
  throw new Error("--agent-integration must be enabled or disabled");
}

function normalizePublicOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("--public-origin must be a URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("--public-origin must use HTTP or HTTPS");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("--public-origin must be an exact origin");
  return parsed.origin;
}

function parsePort(value: string, option: string): number {
  if (!/^[0-9]+$/u.test(value)) throw new Error(`${option} must be a number`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error(`${option} is out of range`);
  return port;
}

function normalizeProjectRoot(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new Error("--project-root must be a non-empty path");
  }
  return resolve(value);
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
