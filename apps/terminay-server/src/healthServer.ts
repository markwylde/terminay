import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface ServerHealthSnapshot {
  readonly phase: string;
  readonly serverId: string;
  readonly version: string;
  readonly ready: boolean;
}

export interface ServerHealthServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly health: () => ServerHealthSnapshot;
}

export interface ServerHealthAddress {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
}

// Health probes are intentionally unauthenticated and may be bound outside
// loopback for an orchestrator. They must never become an embeddable or
// cross-origin browser resource, including for error responses.
const HEALTH_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  // Health JSON is not an application surface. Explicitly deny browser
  // capabilities as defense in depth if an orchestrator exposes this listener
  // beyond loopback and a browser navigates to it.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

/**
 * Small unauthenticated container probe surface. It deliberately exposes only
 * lifecycle metadata; diagnostics, paths, credentials, and project data stay
 * behind the authenticated server protocol.
 */
export class ServerHealthServer {
  private readonly host: string;
  private readonly port: number;
  private readonly health: () => ServerHealthSnapshot;
  private server: Server | undefined;
  private addressValue: ServerHealthAddress | undefined;

  constructor(options: ServerHealthServerOptions) {
    if (typeof options.health !== "function") throw new TypeError("health callback is required");
    if (typeof options.host !== "undefined" && (typeof options.host !== "string" || options.host.length === 0 || options.host.length > 255)) {
      throw new TypeError("health host is invalid");
    }
    const port = options.port ?? 8080;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError("health port is invalid");
    this.host = options.host ?? "127.0.0.1";
    this.port = port;
    this.health = options.health;
  }

  get listening(): boolean { return this.server?.listening === true; }
  get address(): ServerHealthAddress | undefined { return this.addressValue; }

  async start(): Promise<ServerHealthAddress> {
    if (this.server !== undefined && this.addressValue !== undefined) return this.addressValue;
    const server = createServer((request, response) => this.handle(request, response));
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.port, this.host);
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("health server did not expose a TCP address");
      this.addressValue = Object.freeze({
        host: address.address,
        port: address.port,
        origin: `http://${formatHost(address.address)}:${address.port}`,
      });
      return this.addressValue;
    } catch (error) {
      this.server = undefined;
      await closeServer(server);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.addressValue = undefined;
    if (server !== undefined) await closeServer(server);
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const method = request.method ?? "";
    const path = new URL(request.url ?? "/", "http://terminay.health").pathname;
    if (method !== "GET" && method !== "HEAD") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (path !== "/healthz" && path !== "/readyz") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    let snapshot: ServerHealthSnapshot;
    try {
      snapshot = this.health();
      if (!isSafeHealthSnapshot(snapshot)) throw new TypeError("health snapshot is invalid");
    } catch {
      sendJson(response, 503, { status: "unavailable", ready: false });
      return;
    }
    const ready = path === "/readyz" ? snapshot.ready === true : isLivePhase(snapshot.phase);
    sendJson(response, ready ? 200 : 503, {
      status: ready ? "ok" : "unavailable",
      ready: snapshot.ready === true,
      phase: snapshot.phase,
      serverId: snapshot.serverId,
      version: snapshot.version,
    }, method === "HEAD");
  }
}

export function createServerHealthServer(options: ServerHealthServerOptions): ServerHealthServer {
  return new ServerHealthServer(options);
}

function isLivePhase(phase: string): boolean {
  return phase === "created" || phase === "starting" || phase === "ready" || phase === "stopping";
}

/**
 * The probe is deliberately available without authentication. Treat the
 * lifecycle callback as a runtime boundary: a partially torn-down runtime or
 * a faulty integration must yield the fixed unavailable response rather than
 * an uncaught HTTP handler exception or arbitrary diagnostic JSON.
 */
function isSafeHealthSnapshot(value: unknown): value is ServerHealthSnapshot {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.phase === "string"
    && snapshot.phase.length > 0
    && snapshot.phase.length <= 64
    && typeof snapshot.serverId === "string"
    && snapshot.serverId.length > 0
    && snapshot.serverId.length <= 255
    && typeof snapshot.version === "string"
    && snapshot.version.length > 0
    && snapshot.version.length <= 128
    && typeof snapshot.ready === "boolean";
}

function sendJson(response: ServerResponse, status: number, value: unknown, headOnly = false): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    ...HEALTH_SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.byteLength),
    "Cache-Control": "no-store",
  });
  if (headOnly) response.end();
  else response.end(body);
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
