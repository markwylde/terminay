import type { QueryCommandTransport } from "./queryCommand.js";

export const SERVER_HEALTH_OPERATION = "server.health";

export interface ServerHealthSnapshot {
  readonly phase: string;
  readonly serverId: string;
  readonly version: string;
  readonly ready: boolean;
  readonly uptimeMs?: number;
}

/** Transport-neutral readiness query used by Desktop, browser, and remote
 * connection flows. It validates the canonical DTO before a renderer can
 * treat a handshake as a usable application server. */
export class ServerHealthClient {
  constructor(private readonly transport: Pick<QueryCommandTransport, "query">) {}

  async snapshot(): Promise<ServerHealthSnapshot> {
    return validateHealth(await this.transport.query(SERVER_HEALTH_OPERATION, {}));
  }
}

function validateHealth(value: unknown): ServerHealthSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("server health snapshot is invalid");
  }
  const candidate = value as Record<string, unknown>;
  const phase = boundedText(candidate.phase, "phase", 64);
  const serverId = boundedText(candidate.serverId, "serverId", 128);
  const version = boundedText(candidate.version, "version", 128);
  if (typeof candidate.ready !== "boolean") throw new TypeError("server health ready state is invalid");
  const uptimeMs = candidate.uptimeMs;
  if (uptimeMs !== undefined && (!Number.isSafeInteger(uptimeMs) || (uptimeMs as number) < 0)) {
    throw new TypeError("server health uptime is invalid");
  }
  return Object.freeze({
    phase,
    serverId,
    version,
    ready: candidate.ready,
    ...(uptimeMs === undefined ? {} : { uptimeMs: uptimeMs as number }),
  });
}

function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.includes("\0")) {
    throw new TypeError(`server health ${name} is invalid`);
  }
  return value;
}
