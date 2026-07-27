import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP, type AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { TerminalActivityService, type ActivitySessionIdentity } from "./service.js";
import type { ProviderActivityState, ProviderActivityUpdate } from "./types.js";

export const AGENT_HOOK_PATH = "/v1/agent-events";
export const AGENT_HOOK_TOKEN_HEADER = "x-terminay-agent-hook-token";
export const AGENT_HOOK_SESSION_HEADER = "x-terminay-session-id";
export const AGENT_HOOK_PROJECT_HEADER = "x-terminay-project-id";
export const AGENT_HOOK_SERVER_HEADER = "x-terminay-server-id";
export const DEFAULT_AGENT_HOOK_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_AGENT_HOOK_MAX_IN_FLIGHT = 32;
export const DEFAULT_AGENT_HOOK_TTL_MS = 15 * 60 * 1000;

const PROVIDERS = new Set(["codex", "claude-code"]);
const PROVIDER_STATES = new Set<ProviderActivityState>([
  "working",
  "waiting",
  "blocked",
  "done",
  "idle",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TOKEN_MAX_LENGTH = 512;
const SOURCE = "hook";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface AgentHookRequest {
  readonly method?: string;
  readonly path?: string;
  readonly remoteAddress?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body: string | Uint8Array;
}

export interface AgentHookResponse {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface AgentHookNormalizerContext {
  readonly provider: string;
  readonly identity: ActivitySessionIdentity;
}

/**
 * Native provider payloads stop at this callback. The callback may inspect
 * them to produce one canonical update, but the receiver only retains the
 * bounded canonical fields validated below.
 */
export type AgentHookNormalizer = (
  payload: Readonly<Record<string, unknown>>,
  context: AgentHookNormalizerContext,
) => ProviderActivityUpdate | null | Promise<ProviderActivityUpdate | null>;

export interface AgentHookReceiverOptions {
  readonly service: TerminalActivityService;
  readonly serverId?: string;
  readonly host?: string;
  readonly port?: number;
  readonly path?: string;
  readonly maxBodyBytes?: number;
  readonly maxInFlight?: number;
  readonly tokenTtlMs?: number;
  readonly now?: () => number;
  readonly tokenFactory?: () => string;
  readonly normalize?: AgentHookNormalizer;
}

export interface AgentHookSessionLease {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
  /** Raw token is returned only by registration and is never retained. */
  readonly token: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface AgentHookReceiver {
  readonly endpoint: string;
  readonly listening: boolean;
  register(identity: ActivitySessionIdentity): AgentHookSessionLease;
  revoke(identity: ActivitySessionIdentity, options?: { readonly exit?: boolean }): boolean;
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class AgentHookRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AgentHookRequestError";
    this.statusCode = statusCode;
  }
}

interface StoredHookSession {
  readonly identity: ActivitySessionIdentity;
  readonly digest: Uint8Array;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

class NodeAgentHookReceiver implements AgentHookReceiver {
  private readonly service: TerminalActivityService;
  private readonly serverId: string;
  private readonly host: string;
  private readonly preferredPort: number;
  private readonly path: string;
  private readonly maxBodyBytes: number;
  private readonly maxInFlight: number;
  private readonly tokenTtlMs: number;
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly normalize: AgentHookNormalizer;
  private readonly sessions = new Map<string, StoredHookSession>();
  private server: Server | undefined;
  private port: number | undefined;
  private inFlight = 0;
  private processing: Promise<void> = Promise.resolve();

  constructor(options: AgentHookReceiverOptions) {
    this.service = options.service;
    this.serverId = options.serverId ?? options.service.serverId;
    if (this.serverId !== options.service.serverId) throw new TypeError("hook receiver server id does not match activity service");
    this.host = options.host ?? "127.0.0.1";
    if (!isLoopbackAddress(this.host)) throw new TypeError("hook receiver must bind to a loopback address");
    this.preferredPort = validatePort(options.port ?? 0);
    this.path = options.path ?? AGENT_HOOK_PATH;
    if (!this.path.startsWith("/") || this.path.length > 128 || this.path.includes("?")) throw new TypeError("hook receiver path is invalid");
    this.maxBodyBytes = positive(options.maxBodyBytes ?? DEFAULT_AGENT_HOOK_MAX_BODY_BYTES, "maxBodyBytes");
    this.maxInFlight = positive(options.maxInFlight ?? DEFAULT_AGENT_HOOK_MAX_IN_FLIGHT, "maxInFlight");
    this.tokenTtlMs = positive(options.tokenTtlMs ?? DEFAULT_AGENT_HOOK_TTL_MS, "tokenTtlMs");
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.normalize = options.normalize ?? defaultNormalizer;
  }

  get endpoint(): string {
    if (this.port === undefined) throw new Error("hook receiver has not started");
    const address = this.host.includes(":") ? `[${this.host}]` : this.host;
    return `http://${address}:${this.port}${this.path}`;
  }

  get listening(): boolean { return this.server !== undefined; }

  register(identity: ActivitySessionIdentity): AgentHookSessionLease {
    this.assertIdentity(identity);
    const current = this.sessions.get(identity.sessionId);
    if (current !== undefined && !sameIdentity(current.identity, identity)) throw new TypeError("session identity is already bound to another project or server");
    this.service.register(identity);
    if (current !== undefined) this.sessions.delete(identity.sessionId);
    let token = this.tokenFactory();
    assertToken(token);
    let digest = digestToken(token);
    let attempts = 0;
    while ([...this.sessions.values()].some((session) => equalDigest(session.digest, digest))) {
      if (++attempts >= 32) throw new Error("tokenFactory did not produce a unique hook token");
      token = this.tokenFactory();
      assertToken(token);
      digest = digestToken(token);
    }
    const issuedAt = this.now();
    const expiresAt = issuedAt + this.tokenTtlMs;
    this.sessions.set(identity.sessionId, { identity: Object.freeze({ ...identity }), digest, issuedAt, expiresAt });
    return Object.freeze({ ...identity, token, issuedAt, expiresAt });
  }

  revoke(identity: ActivitySessionIdentity, options: { readonly exit?: boolean } = {}): boolean {
    this.assertIdentity(identity);
    const current = this.sessions.get(identity.sessionId);
    if (current === undefined || !sameIdentity(current.identity, identity)) return false;
    this.sessions.delete(identity.sessionId);
    if (options.exit !== false) this.service.markExited(identity);
    return true;
  }

  async handle(request: AgentHookRequest): Promise<AgentHookResponse> {
    if (this.inFlight >= this.maxInFlight) return errorResponse(429, "hook receiver is busy");
    this.inFlight += 1;
    const work = this.processing.then(() => this.process(request));
    this.processing = work.then(() => undefined, () => undefined);
    try {
      return await work;
    } finally {
      this.inFlight -= 1;
    }
  }

  async start(): Promise<void> {
    if (this.server !== undefined) return;
    const server = createHttpServer((request, res) => {
      void this.receive(request, res);
    });
    server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: this.host, port: this.port ?? this.preferredPort, exclusive: true });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("hook receiver did not acquire a TCP port");
    }
    this.server = server;
    this.port = (address as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    this.sessions.clear();
    if (server === undefined) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    await this.processing;
  }

  private async process(request: AgentHookRequest): Promise<AgentHookResponse> {
    try {
      if (request.remoteAddress !== undefined && !isLoopbackAddress(request.remoteAddress)) throw new AgentHookRequestError(403, "hook receiver accepts loopback only");
      if ((request.path ?? this.path) !== this.path) throw new AgentHookRequestError(404, "hook endpoint not found");
      if ((request.method ?? "POST").toUpperCase() !== "POST") throw new AgentHookRequestError(405, "hook endpoint accepts POST only");
      if (normalizeContentType(request.contentType) !== "application/json") throw new AgentHookRequestError(415, "hook payload must use application/json");
      const token = readToken(request.headers);
      const sessionId = header(request.headers, AGENT_HOOK_SESSION_HEADER);
      const provider = header(request.headers, "x-terminay-agent-provider");
      const session = this.authorize(token, sessionId);
      const projectId = header(request.headers, AGENT_HOOK_PROJECT_HEADER);
      const serverId = header(request.headers, AGENT_HOOK_SERVER_HEADER);
      if ((projectId !== undefined && projectId !== session.identity.projectId) || (serverId !== undefined && serverId !== session.identity.serverId)) {
        throw new AgentHookRequestError(403, "hook identity is outside the registered session scope");
      }
      if (!PROVIDERS.has(provider ?? "")) throw new AgentHookRequestError(422, "hook provider is unsupported");
      const payload = parseBody(request.body, this.maxBodyBytes);
      const update = await this.normalize(payload, { provider: provider as string, identity: session.identity });
      if (update === null) return response(202, true, undefined, true);
      const canonical = validateCanonicalUpdate(update, provider as string);
      const event = this.service.ingestProvider(session.identity, canonical);
      return event === undefined
        ? response(202, true, undefined, true)
        : response(202, true, event.revision);
    } catch (error) {
      if (error instanceof AgentHookRequestError) return errorResponse(error.statusCode, error.message);
      return errorResponse(500, "hook payload could not be processed");
    }
  }

  private authorize(token: string | undefined, sessionId: string | undefined): StoredHookSession {
    if (token === undefined || sessionId === undefined || !isValidToken(token)) throw new AgentHookRequestError(401, "invalid hook token or session");
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.expiresAt <= this.now() || !equalDigest(session.digest, digestToken(token))) throw new AgentHookRequestError(401, "invalid hook token or session");
    return session;
  }

  private async receive(request: IncomingMessage, output: ServerResponse): Promise<void> {
    const body = await readRequestBody(request, this.maxBodyBytes).catch((error: unknown) => {
      if (error instanceof AgentHookRequestError) return error;
      return new AgentHookRequestError(400, "hook payload could not be read");
    });
    if (body instanceof AgentHookRequestError) {
      writeResponse(output, { statusCode: body.statusCode, body: { accepted: false, error: body.message } });
      return;
    }
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    const result = await this.handle({
      method: request.method,
      path: request.url,
      remoteAddress: request.socket.remoteAddress,
      contentType: typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : undefined,
      headers,
      body,
    });
    writeResponse(output, result);
  }

  private assertIdentity(identity: ActivitySessionIdentity): void {
    if (identity.serverId !== this.serverId) throw new TypeError("session identity belongs to another server");
    assertId(identity.projectId, "project id");
    assertId(identity.sessionId, "session id");
  }
}

export function createAgentHookReceiver(options: AgentHookReceiverOptions): AgentHookReceiver {
  return new NodeAgentHookReceiver(options);
}

function defaultNormalizer(payload: Readonly<Record<string, unknown>>, context: AgentHookNormalizerContext): ProviderActivityUpdate | null {
  const state = payload.state ?? payload.status;
  if (state === undefined) return null;
  const sequence = payload.sequence;
  const agentId = payload.agentId ?? payload.agent_id;
  return {
    provider: context.provider,
    state: state as ProviderActivityState,
    sequence: sequence as number,
    ...(agentId === undefined ? {} : { agentId: agentId as string }),
  };
}

function validateCanonicalUpdate(update: ProviderActivityUpdate, provider: string): ProviderActivityUpdate {
  if (typeof update !== "object" || update === null || Array.isArray(update)) throw new AgentHookRequestError(422, "normalizer returned an invalid event");
  if (update.provider !== provider) throw new AgentHookRequestError(422, "normalizer changed the hook provider");
  const state = update.state ?? update.status;
  if (state !== undefined && !PROVIDER_STATES.has(state)) throw new AgentHookRequestError(422, "hook state is invalid");
  const sequence = update.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) throw new AgentHookRequestError(422, "hook sequence is invalid");
  if (typeof update.agentId !== "string" || update.agentId.length === 0 || update.agentId.length > 256 || update.agentId.includes("\0")) throw new AgentHookRequestError(422, "hook agent identity is invalid");
  if (update.attention !== undefined && typeof update.attention !== "boolean") throw new AgentHookRequestError(422, "hook attention is invalid");
  if (update.acknowledged !== undefined && typeof update.acknowledged !== "boolean") throw new AgentHookRequestError(422, "hook acknowledgement is invalid");
  if (update.exitCode !== undefined && (!Number.isSafeInteger(update.exitCode) || update.exitCode < -1_000_000 || update.exitCode > 1_000_000)) throw new AgentHookRequestError(422, "hook exit code is invalid");
  // Source is intentionally receiver-owned. Raw provider text never reaches
  // the canonical snapshot or event journal.
  return Object.freeze({
    provider,
    ...(state === undefined ? {} : { state }),
    sequence,
    agentId: update.agentId,
    ...(update.attention === undefined ? {} : { attention: update.attention }),
    ...(update.acknowledged === undefined ? {} : { acknowledged: update.acknowledged }),
    ...(update.exitCode === undefined ? {} : { exitCode: update.exitCode }),
    source: `${SOURCE}:${provider}`,
  });
}

function parseBody(body: string | Uint8Array, maxBytes: number): Readonly<Record<string, unknown>> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  if (bytes.byteLength === 0) throw new AgentHookRequestError(400, "hook payload is required");
  if (bytes.byteLength > maxBytes) throw new AgentHookRequestError(413, "hook payload is too large");
  let value: unknown;
  try { value = JSON.parse(utf8Decoder.decode(bytes)); } catch { throw new AgentHookRequestError(400, "hook payload must be valid JSON"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentHookRequestError(400, "hook payload must be a JSON object");
  return value as Readonly<Record<string, unknown>>;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = request.headers["content-length"];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new AgentHookRequestError(400, "invalid content length");
    if (length > maxBytes) throw new AgentHookRequestError(413, "hook payload is too large");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > maxBytes) throw new AgentHookRequestError(413, "hook payload is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function writeResponse(output: ServerResponse, result: AgentHookResponse): void {
  if (output.destroyed || output.headersSent) return;
  const bytes = Buffer.from(JSON.stringify(result.body), "utf8");
  output.writeHead(result.statusCode, {
    "cache-control": "no-store",
    "connection": "close",
    "content-length": String(bytes.byteLength),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  output.end(bytes);
}

function response(statusCode: number, accepted: boolean, revision?: number, ignored = false): AgentHookResponse {
  return {
    statusCode,
    body: {
      accepted,
      ...(revision === undefined ? {} : { revision }),
      ...(ignored ? { ignored: true } : {}),
    },
  };
}

function errorResponse(statusCode: number, message: string): AgentHookResponse {
  return { statusCode, body: { accepted: false, error: message } };
}

function readToken(headers: Readonly<Record<string, string | undefined>> | undefined): string | undefined {
  const direct = header(headers, AGENT_HOOK_TOKEN_HEADER);
  if (direct !== undefined) return direct;
  const authorization = header(headers, "authorization");
  const match = authorization === undefined ? undefined : /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  return match?.[1];
}

function header(headers: Readonly<Record<string, string | undefined>> | undefined, name: string): string | undefined {
  if (headers === undefined) return undefined;
  const normalized = name.toLowerCase();
  const direct = headers[normalized];
  const value = direct ?? Object.entries(headers).find(([key]) => key.toLowerCase() === normalized)?.[1];
  return value === undefined ? undefined : value.trim();
}

function normalizeContentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function sameIdentity(a: ActivitySessionIdentity, b: ActivitySessionIdentity): boolean {
  return a.serverId === b.serverId && a.projectId === b.projectId && a.sessionId === b.sessionId;
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function assertToken(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > TOKEN_MAX_LENGTH || value.includes("\0") || value.includes("\r") || value.includes("\n")) throw new TypeError("hook token is invalid");
}

function isValidToken(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= TOKEN_MAX_LENGTH && !value.includes("\0") && !value.includes("\r") && !value.includes("\n");
}

function digestToken(token: string): Uint8Array {
  const hex = createHash("sha256").update(token).digest("hex");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function equalDigest(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && timingSafeEqual(a, b); }

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function validatePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) throw new RangeError("port must be between 0 and 65535");
  return value;
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const normalized = address.split("%", 1)[0]?.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized?.startsWith("::ffff:")) return isLoopbackAddress(normalized.slice("::ffff:".length));
  if (isIP(normalized ?? "") !== 4) return false;
  return Number.parseInt(normalized?.split(".", 1)[0] ?? "", 10) === 127;
}
