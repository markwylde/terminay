import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  createOperationDispatcher,
  verifyUiBundle,
  type EventReplay,
  type OperationDispatcher,
  type OperationRegistries,
  type OrderedEvent,
  type OrderedEventJournalLike,
  type UiBundleManifest,
  type VerifiedUiBundle,
} from "@terminay/server-core";
import {
  DEFAULT_PROTOCOL_LIMITS,
  MAX_DEADLINE_MS,
  negotiateClientHello,
  validateEnvelope,
  type AuthScope,
  type ClientHello,
  type CommandEnvelope,
  type NegotiatedProtocol,
  type ProtocolLimits,
  type QueryEnvelope,
  type ServerHello,
} from "@terminay/protocol";

export interface LocalUiServerOptions {
  readonly rootDirectory: string;
  readonly serverId: string;
  readonly serverVersion: string;
  readonly authToken: string;
  readonly host?: string;
  readonly port?: number;
  readonly protocolVersion?: number;
  readonly capabilities?: readonly string[];
  readonly limits?: ProtocolLimits;
  readonly maxAssetBytes?: number;
  /** Canonical server-core operation registries exposed over local HTTP. */
  readonly operations?: OperationRegistries;
  /** Optional prebuilt canonical dispatcher, useful when services are composed elsewhere. */
  readonly protocolDispatcher?: OperationDispatcher;
  readonly maxOperationBytes?: number;
  readonly maxOperationDeadlineMs?: number;
  /** Optional bounded journal used for local event replay/subscriptions. */
  readonly eventJournal?: OrderedEventJournalLike;
  readonly authorize?: (token: string, hello?: ClientHello) => AuthScope | null | Promise<AuthScope | null>;
}

export interface LocalUiServerAddress {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
}

const DEFAULT_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_HANDSHAKE_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const DEFAULT_MAX_OPERATION_BYTES = 256 * 1024;
const DEFAULT_MAX_OPERATION_DEADLINE_MS = 15 * 60 * 1000;
const MAX_HANDSHAKE_CLIENTS = 256;
const HANDSHAKE_TTL_MS = 15 * 60 * 1000;
const TOKEN_DIGEST_BYTES = 32;
const forbiddenQueryKeys = new Set(["token", "access_token", "bootstrap_credential", "credential"]);
const UI_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

interface HandshakeIdentity {
  readonly hello: ClientHello;
  readonly scope: AuthScope;
  readonly expiresAt: number;
}

/**
 * Authenticated local origin for the server-bundled UI and the first protocol
 * handshake. It intentionally serves files only from an injected bundle root;
 * it does not resolve arbitrary filesystem paths or accept credentials in URL
 * query strings. The same envelope negotiation used by framed transports is
 * used by the HTTP handshake endpoint.
 */
export class LocalUiServer {
  private readonly options: Required<Pick<LocalUiServerOptions, "host" | "port" | "protocolVersion" | "capabilities" | "limits" | "maxAssetBytes" | "maxOperationBytes" | "maxOperationDeadlineMs">> & LocalUiServerOptions;
  private readonly rootDirectory: string;
  private readonly tokenDigest: Buffer;
  private bundleValue: VerifiedUiBundle | undefined;
  private server: Server | undefined;
  private addressValue: LocalUiServerAddress | undefined;
  private readonly connections = new Set<Socket>();
  private readonly dispatcher: OperationDispatcher | undefined;
  private readonly handshakes = new Map<string, Map<string, HandshakeIdentity>>();
  private handshakeCount = 0;

  constructor(options: LocalUiServerOptions) {
    if (!isSafeId(options.serverId) || !isSafeVersion(options.serverVersion)) throw new TypeError("server identity is invalid");
    if (typeof options.rootDirectory !== "string" || options.rootDirectory.length === 0 || options.rootDirectory.length > 4096 || !isAbsolute(options.rootDirectory)) throw new TypeError("bundle root must be absolute");
    if (typeof options.authToken !== "string" || options.authToken.length < 16 || options.authToken.length > 512 || hasLineBreak(options.authToken)) throw new TypeError("local UI credential is invalid");
    const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
    if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0 || maxAssetBytes > DEFAULT_MAX_ASSET_BYTES) throw new RangeError("maxAssetBytes is invalid");
    const port = options.port ?? 0;
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError("port is invalid");
    const capabilities = Object.freeze([...(options.capabilities ?? [])]);
    const limits = Object.freeze({ ...(options.limits ?? DEFAULT_PROTOCOL_LIMITS) });
    const maxOperationBytes = options.maxOperationBytes ?? DEFAULT_MAX_OPERATION_BYTES;
    if (!Number.isSafeInteger(maxOperationBytes) || maxOperationBytes <= 0 || maxOperationBytes > limits.maxBodyBytes) throw new RangeError("maxOperationBytes is invalid");
    const maxOperationDeadlineMs = options.maxOperationDeadlineMs ?? DEFAULT_MAX_OPERATION_DEADLINE_MS;
    if (!Number.isSafeInteger(maxOperationDeadlineMs) || maxOperationDeadlineMs <= 0 || maxOperationDeadlineMs > MAX_DEADLINE_MS) throw new RangeError("maxOperationDeadlineMs is invalid");
    this.options = {
      ...options,
      host: options.host ?? "127.0.0.1",
      port,
      protocolVersion: options.protocolVersion ?? 1,
      capabilities,
      limits,
      maxAssetBytes,
      maxOperationBytes,
      maxOperationDeadlineMs,
    };
    this.rootDirectory = resolve(options.rootDirectory);
    this.tokenDigest = createHash("sha256").update(options.authToken, "utf8").digest();
    this.dispatcher = options.protocolDispatcher ?? (options.operations === undefined ? undefined : createOperationDispatcher({ ...options.operations, maxBodyBytes: maxOperationBytes }));
  }

  get listening(): boolean { return this.server?.listening === true; }
  get address(): LocalUiServerAddress | undefined { return this.addressValue; }

  async start(): Promise<LocalUiServerAddress> {
    if (this.server !== undefined && this.addressValue !== undefined) return this.addressValue;
    await this.loadBundle();
    const server = createServer((request, response) => { void this.handle(request, response); });
    server.on("connection", (socket) => {
      this.connections.add(socket);
      socket.once("close", () => this.connections.delete(socket));
    });
    this.server = server;
    try {
      await new Promise<void>((resolveStart, reject) => {
        const onError = (error: Error): void => { server.off("listening", onListening); reject(error); };
        const onListening = (): void => { server.off("error", onError); resolveStart(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.options.port, this.options.host);
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("local UI server did not expose a TCP address");
      this.addressValue = Object.freeze({ host: address.address, port: address.port, origin: `http://${formatHost(address.address)}:${address.port}` });
      return this.addressValue;
    } catch (error) {
      this.server = undefined;
      for (const socket of this.connections) socket.destroy();
      this.connections.clear();
      await closeServer(server);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.addressValue = undefined;
    this.bundleValue = undefined;
    this.handshakes.clear();
    this.handshakeCount = 0;
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    if (server !== undefined) await closeServer(server);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const method = request.method ?? "";
      if (method !== "GET" && method !== "HEAD" && !(method === "POST" && (request.url?.startsWith("/protocol/handshake") || request.url?.startsWith("/protocol/query") || request.url?.startsWith("/protocol/command")))) {
        sendText(response, 405, "method not allowed");
        return;
      }
      const url = new URL(request.url ?? "/", "http://terminay.local");
      for (const key of url.searchParams.keys()) if (forbiddenQueryKeys.has(key.toLowerCase())) {
        sendText(response, 400, "credentials must not be placed in a URL");
        return;
      }
      const token = bearerToken(request.headers.authorization);
      if (!this.matchesToken(token)) {
        sendText(response, 401, "local UI authorization required", { "WWW-Authenticate": "Bearer" });
        return;
      }
      if (url.pathname === "/protocol/handshake") {
        if (method !== "POST") { sendText(response, 405, "method not allowed"); return; }
        await this.handleHandshake(request, response, token);
        return;
      }
      if (url.pathname === "/protocol/events" || url.pathname === "/protocol/events/subscribe") {
        if (method !== "GET") { sendText(response, 405, "method not allowed"); return; }
        await this.handleEvents(request, response, url, token);
        return;
      }
      if (url.pathname === "/protocol/query" || url.pathname === "/protocol/command") {
        if (method !== "POST") { sendText(response, 405, "method not allowed"); return; }
        await this.handleOperation(request, response, url.pathname === "/protocol/query" ? "query" : "command", token);
        return;
      }
      if (method === "POST") { sendText(response, 404, "not found"); return; }
      await this.handleAsset(url.pathname, response, method === "HEAD");
    } catch {
      if (!response.headersSent) sendText(response, 500, "local UI request failed");
    }
  }

  private async handleHandshake(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    let body: Buffer;
    try { body = await readBoundedBody(request, MAX_HANDSHAKE_BYTES); }
    catch { sendText(response, 413, "handshake body exceeds limit"); return; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(body)); } catch { sendText(response, 400, "invalid handshake JSON"); return; }
    let hello: ClientHello;
    try {
      const envelope = validateEnvelope(value);
      if (envelope.type !== "client_hello") throw new TypeError("expected client hello");
      hello = envelope;
    } catch { sendText(response, 400, "invalid client hello"); return; }
    const authScope = this.options.authorize === undefined ? "read" as const : await this.options.authorize(token, hello);
    if (authScope === null) { sendText(response, 403, "local UI authorization denied"); return; }
    let negotiated: NegotiatedProtocol;
    try { negotiated = negotiateClientHello(hello, this.options.capabilities, this.options.limits); }
    catch { sendText(response, 409, "incompatible protocol"); return; }
    const serverHello: ServerHello = {
      type: "server_hello",
      protocolVersion: negotiated.version,
      serverId: this.options.serverId,
      serverVersion: this.options.serverVersion,
      clientId: hello.clientId,
      capabilities: [...negotiated.capabilities],
      limits: { ...negotiated.limits },
      authScope,
    };
    this.rememberHandshake(token, hello, authScope);
    sendJson(response, 200, serverHello);
  }

  private async handleOperation(request: IncomingMessage, response: ServerResponse, kind: "query" | "command", token: string): Promise<void> {
    const dispatcher = this.dispatcher;
    if (dispatcher === undefined) { sendText(response, 404, "protocol operation dispatch is unavailable"); return; }
    const clientId = protocolClientId(request.headers["x-terminay-client-id"]);
    if (clientId === null) { sendText(response, 401, "protocol client identity is required"); return; }
    const handshake = this.getHandshake(token, clientId);
    if (handshake === null) { sendText(response, 403, "protocol handshake is required"); return; }
    const currentScope = this.options.authorize === undefined ? handshake.scope : await this.options.authorize(token, handshake.hello);
    if (currentScope === null) { sendText(response, 403, "local UI authorization denied"); return; }
    let body: Buffer;
    try { body = await readBoundedBody(request, this.options.maxOperationBytes); }
    catch { sendText(response, 413, "protocol operation body exceeds limit"); return; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(body)); } catch { sendText(response, 400, "invalid protocol operation JSON"); return; }
    let envelope: QueryEnvelope | CommandEnvelope;
    try {
      const checked = validateEnvelope(value);
      if (kind === "query") {
        if (checked.type !== "query") throw new TypeError("expected query envelope");
        envelope = checked;
      } else {
        if (checked.type !== "command") throw new TypeError("expected command envelope");
        envelope = checked;
      }
      if (envelope.deadlineMs !== undefined && envelope.deadlineMs > this.options.maxOperationDeadlineMs) throw new RangeError("operation deadline exceeds local limit");
    } catch { sendText(response, 400, "invalid protocol operation envelope"); return; }
    const controller = new AbortController();
    const abort = (): void => controller.abort("caller_closed");
    request.once("aborted", abort);
    response.once("close", abort);
    const context = {
      connectionId: protocolConnectionId(token, clientId),
      clientId,
      authScope: currentScope,
      signal: controller.signal,
      ...(envelope.deadlineMs === undefined ? {} : { deadline: Date.now() + envelope.deadlineMs }),
      ...(envelope.type === "command" && envelope.expectedRevision === undefined ? {} : envelope.type === "command" ? { expectedRevision: envelope.expectedRevision } : {}),
    } as const;
    try {
      const result = envelope.type === "query"
        ? await dispatcher.query({ envelope, body: new Uint8Array(), context })
        : await dispatcher.command({ envelope, body: new Uint8Array(), context });
      sendBoundedJson(response, 200, result, this.options.maxOperationBytes, "protocol response exceeds limit");
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  }

  private async handleEvents(request: IncomingMessage, response: ServerResponse, url: URL, token: string): Promise<void> {
    const journal = this.options.eventJournal;
    if (journal === undefined) { sendText(response, 404, "event journal is unavailable"); return; }
    const authorized = this.options.authorize === undefined ? "read" as const : await this.options.authorize(token);
    if (authorized === null || authorized === "none") { sendText(response, 403, "local UI authorization denied"); return; }
    let afterRevision: number;
    try { afterRevision = parseRevision(url.searchParams.get("afterRevision")); }
    catch { sendText(response, 400, "afterRevision is invalid"); return; }
    const replay = await Promise.resolve(journal.replay(afterRevision));
    if (url.pathname === "/protocol/events") {
      sendBoundedJson(response, 200, replay);
      return;
    }
    await this.openEventSubscription(request, response, journal, replay);
  }

  private async openEventSubscription(
    request: IncomingMessage,
    response: ServerResponse,
    journal: OrderedEventJournalLike,
    replay: EventReplay,
  ): Promise<void> {
    response.writeHead(200, {
      ...UI_SECURITY_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
    });
    let closed = false;
    let unsubscribe = (): void => undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };
    const write = (event: unknown): boolean => {
      if (closed || !response.writable) return false;
      const data = JSON.stringify(event);
      if (Buffer.byteLength(data, "utf8") > MAX_EVENT_BYTES) {
        response.write(`event: error\ndata: {"code":"limit_exceeded"}\n\n`);
        response.end();
        close();
        return false;
      }
      response.write(`event: terminay\ndata: ${data}\n\n`);
      return true;
    };
    const writeReplay = (value: EventReplay): boolean => {
      if (value.kind === "resync") return write({ kind: "resync", snapshot: value.snapshot ?? null, events: [] });
      for (const event of value.events) if (!write(event)) return false;
      return true;
    };
    request.on("close", close);
    response.on("close", close);
    unsubscribe = journal.subscribe((event: OrderedEvent) => { write(event); });
    if (!writeReplay(replay)) return;
  }

  private async handleAsset(pathname: string, response: ServerResponse, headOnly: boolean): Promise<void> {
    const bundle = this.bundleValue;
    if (bundle === undefined) { sendText(response, 503, "UI bundle is unavailable"); return; }
    if (pathname === "/manifest.json") { sendJson(response, 200, bundle.manifest, headOnly); return; }
    let assetPath: string;
    try { assetPath = pathname === "/" ? bundle.manifest.entryPath : decodeURIComponent(pathname); }
    catch { sendText(response, 400, "invalid bundle path"); return; }
    const asset = bundle.manifest.assets.find((candidate) => candidate.path === assetPath);
    if (asset === undefined) { sendText(response, 404, "not found"); return; }
    const content = Buffer.from(bundle.read(asset.path));
    response.writeHead(200, {
      ...UI_SECURITY_HEADERS,
      "Content-Type": asset.contentType || "application/octet-stream",
      "Content-Length": String(content.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    if (!headOnly) response.end(content); else response.end();
  }

  private matchesToken(token: string | null): token is string {
    if (token === null) return false;
    const digest = createHash("sha256").update(token, "utf8").digest();
    return digest.byteLength === TOKEN_DIGEST_BYTES && timingSafeEqual(digest, this.tokenDigest);
  }

  private rememberHandshake(token: string, hello: ClientHello, scope: AuthScope): void {
    const key = tokenDigestKey(token);
    let clients = this.handshakes.get(key);
    if (clients === undefined) {
      clients = new Map();
      this.handshakes.set(key, clients);
    }
    if (!clients.has(hello.clientId)) {
      while (this.handshakeCount >= MAX_HANDSHAKE_CLIENTS) this.evictHandshake();
      this.handshakeCount += 1;
    }
    clients.set(hello.clientId, { hello, scope, expiresAt: Date.now() + HANDSHAKE_TTL_MS });
  }

  private getHandshake(token: string, clientId: string): HandshakeIdentity | null {
    const clients = this.handshakes.get(tokenDigestKey(token));
    const handshake = clients?.get(clientId);
    if (handshake === undefined) return null;
    if (handshake.expiresAt <= Date.now()) {
      clients?.delete(clientId);
      this.handshakeCount = Math.max(0, this.handshakeCount - 1);
      if (clients?.size === 0) this.handshakes.delete(tokenDigestKey(token));
      return null;
    }
    return handshake;
  }

  private evictHandshake(): void {
    const tokenKey = this.handshakes.keys().next().value as string | undefined;
    if (tokenKey === undefined) return;
    const clients = this.handshakes.get(tokenKey);
    const clientId = clients?.keys().next().value as string | undefined;
    if (clients === undefined || clientId === undefined) {
      this.handshakes.delete(tokenKey);
      return;
    }
    clients.delete(clientId);
    this.handshakeCount = Math.max(0, this.handshakeCount - 1);
    if (clients.size === 0) this.handshakes.delete(tokenKey);
  }

  private async loadBundle(): Promise<void> {
    const manifestPath = safeChild(this.rootDirectory, "manifest.json");
    if (manifestPath === null) throw new TypeError("UI manifest path is invalid");
    const raw = JSON.parse((await readFile(manifestPath)).toString("utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("UI manifest is invalid");
    const candidate = raw as Partial<UiBundleManifest>;
    if (candidate.serverVersion !== this.options.serverVersion || candidate.protocolVersion !== String(this.options.protocolVersion)) throw new TypeError("UI manifest version mismatch");
    this.bundleValue = await verifyUiBundle(raw, {
      read: async (assetPath) => {
        const prefix = typeof candidate.bundleId === "string" ? `/remote-app/${candidate.bundleId}/` : "";
        if (!assetPath.startsWith(prefix)) throw new TypeError("UI bundle asset namespace is invalid");
        const filePath = safeChild(this.rootDirectory, assetPath.slice(prefix.length));
        if (filePath === null) throw new TypeError("UI bundle asset path is invalid");
        return readFile(filePath);
      },
    }, { maxAssetBytes: this.options.maxAssetBytes });
  }
}

export function createLocalUiServer(options: LocalUiServerOptions): LocalUiServer { return new LocalUiServer(options); }

function safeChild(root: string, child: string): string | null {
  if (child.length === 0 || child.includes("\0") || child.startsWith("/") || isAbsolute(child)) return null;
  const candidate = resolve(root, child);
  const escaped = relative(root, candidate);
  return escaped.length === 0 || (!escaped.startsWith(`..${sep}`) && escaped !== ".." && !isAbsolute(escaped)) ? candidate : null;
}

function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  return token.length === 0 || token.length > 512 || hasLineBreak(token) ? null : token;
}

function protocolClientId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && isSafeId(value) ? value : null;
}

function tokenDigestKey(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }
function protocolConnectionId(token: string, clientId: string): string { return `http-${tokenDigestKey(`${token}:${clientId}`).slice(0, 32)}`; }

async function readBoundedBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) throw new RangeError("request body exceeds limit");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new RangeError("request body exceeds limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function sendJson(response: ServerResponse, status: number, value: unknown, headOnly = false): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, { ...UI_SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(body.byteLength), "Cache-Control": "no-store" });
  if (headOnly) response.end(); else response.end(body);
}

function sendBoundedJson(response: ServerResponse, status: number, value: unknown, maxBytes = MAX_EVENT_BYTES, overflowText = "event replay exceeds limit"): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.byteLength > maxBytes) { sendText(response, 413, overflowText); return; }
  response.writeHead(status, { ...UI_SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(body.byteLength), "Cache-Control": "no-store" });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  const body = Buffer.from(text, "utf8");
  response.writeHead(status, { ...UI_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(body.byteLength), "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function formatHost(host: string): string { return host.includes(":") ? `[${host}]` : host; }
function parseRevision(value: string | null): number {
  if (value === null || value.length === 0) return 0;
  if (!/^\d+$/u.test(value)) throw new TypeError("revision is invalid");
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError("revision is invalid");
  return revision;
}
function isSafeId(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
function isSafeVersion(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 128 && !hasLineBreak(value); }
function hasLineBreak(value: string): boolean { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); if (code === 0 || code === 10 || code === 13) return true; } return false; }
function closeServer(server: Server): Promise<void> { return new Promise((resolveClose) => { if (!server.listening) { resolveClose(); return; } server.close(() => resolveClose()); }); }
