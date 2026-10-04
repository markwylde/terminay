import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export const CONNECTED_SERVER_OPERATIONS = Object.freeze({
  list: "mcp.servers.list",
  save: "mcp.servers.save",
  remove: "mcp.servers.remove",
} as const);

export const CONNECTED_SERVER_EVENTS = Object.freeze({
  changed: "mcp.servers.changed",
} as const);

/** An MCP server the user connected to Terminay. Credential values never reach a client; only the names that are set do. */
export interface ConnectedServer {
  readonly name: string;
  readonly enabled: boolean;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly envNames: readonly string[];
  readonly url?: string;
  readonly headerNames: readonly string[];
}

export interface ConnectedServerStatus {
  readonly name: string;
  readonly state: "connected" | "not-connected" | "disabled" | "idle";
  readonly tools: number;
  readonly reason?: string;
}

/** A save. `env` and `headers` carry only what changes: a string sets a value, `null` removes it, and an absent name keeps what is stored. */
export interface ConnectedServerSave {
  readonly previousName?: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly transport: "stdio" | "http";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string | null>>;
  readonly headers?: Readonly<Record<string, string | null>>;
}

export interface ConnectedServerEventTransport extends QueryCommandTransport {
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void) => () => void;
}

const MAX_SERVERS = 64;
const MAX_TEXT = 8192;

/** Shared facade over the server's connected MCP servers. */
export class ConnectedServersClient {
  constructor(private readonly transport: ConnectedServerEventTransport) {}

  async list(options: QueryOptions = {}): Promise<{ readonly servers: readonly ConnectedServer[]; readonly status: readonly ConnectedServerStatus[] }> {
    const result = await this.transport.query<JsonValue>(CONNECTED_SERVER_OPERATIONS.list, {}, options);
    if (!isRecord(result) || !Array.isArray(result.servers) || !Array.isArray(result.status) || result.servers.length > MAX_SERVERS) throw new TypeError("connected servers response is invalid");
    return Object.freeze({ servers: Object.freeze(result.servers.map(validateServer)), status: Object.freeze(result.status.map(validateStatus)) });
  }

  async save(input: ConnectedServerSave, options: CommandOptions = {}): Promise<ConnectedServer> {
    const result = await this.transport.command<JsonValue>(CONNECTED_SERVER_OPERATIONS.save, input as unknown as JsonValue, options);
    if (!isRecord(result)) throw new TypeError("connected server response is invalid");
    return validateServer(result.server as JsonValue);
  }

  async remove(name: string, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(CONNECTED_SERVER_OPERATIONS.remove, { name: text(name) }, options);
  }

  /** The list or a connection's status changed; refetch with `list()`. */
  onChanged(listener: () => void): () => void {
    if (typeof listener !== "function") throw new TypeError("connected servers listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("connected servers subscription is unavailable");
    return this.transport.subscribe(CONNECTED_SERVER_EVENTS.changed, () => listener());
  }
}

function validateServer(value: JsonValue): ConnectedServer {
  if (!isRecord(value) || (value.transport !== "stdio" && value.transport !== "http") || typeof value.enabled !== "boolean") throw new TypeError("connected server is invalid");
  return Object.freeze({
    name: text(value.name),
    enabled: value.enabled,
    transport: value.transport,
    ...(typeof value.command === "string" ? { command: text(value.command) } : {}),
    ...(Array.isArray(value.args) ? { args: Object.freeze(value.args.map(text)) } : {}),
    envNames: names(value.envNames),
    ...(typeof value.url === "string" ? { url: text(value.url) } : {}),
    headerNames: names(value.headerNames),
  });
}

function validateStatus(value: JsonValue): ConnectedServerStatus {
  if (!isRecord(value) || !Number.isSafeInteger(value.tools)) throw new TypeError("connected server status is invalid");
  const state = value.state;
  if (state !== "connected" && state !== "not-connected" && state !== "disabled" && state !== "idle") throw new TypeError("connected server status is invalid");
  return Object.freeze({ name: text(value.name), state, tools: value.tools as number, ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 400) } : {}) });
}

function names(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("connected server names are invalid");
  return Object.freeze(value.map(text));
}
function text(value: unknown): string { if (typeof value !== "string" || value.length > MAX_TEXT) throw new TypeError("connected server text is invalid"); return value; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
