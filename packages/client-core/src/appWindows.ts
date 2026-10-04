import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { BinaryQueryTransport } from "./queryCommand.js";

/** Feature capability a server advertises when it serves app windows. */
export const APP_WINDOWS_CAPABILITY = "app-windows.v1" as const;

export const APP_WINDOW_OPERATIONS = Object.freeze({
  list: "app-windows.list",
  content: "app-windows.content",
  setState: "app-windows.set-state",
  close: "app-windows.close",
  message: "app-windows.message",
  context: "app-windows.context",
  viewRequest: "app-windows.view-request",
} as const);

export const APP_WINDOW_EVENTS = Object.freeze({
  changed: "app-windows.changed",
} as const);

export type AppWindowState = "open" | "minimised";

export type AppWindowSource =
  | { readonly kind: "agent" }
  | { readonly kind: "mcp-app"; readonly server: string; readonly tool: string; readonly resourceUri: string };

/** Origins an MCP App's UI resource declares it needs. */
export interface AppWindowCsp {
  readonly connectDomains?: readonly string[];
  readonly resourceDomains?: readonly string[];
  readonly frameDomains?: readonly string[];
  readonly baseUriDomains?: readonly string[];
}

/** A window a terminal owns. The server holds the record; the client that controls the terminal runs its view. */
export interface AppWindow {
  readonly id: string;
  readonly terminalSessionId: string;
  readonly projectId: string;
  readonly title: string;
  readonly source: AppWindowSource;
  readonly state: AppWindowState;
  /** Changes whenever the document, tool result, or cancellation changes. */
  readonly contentRevision: number;
  readonly createdAt: number;
}

/** Everything a view needs to start. */
export interface AppWindowContent {
  readonly window: AppWindow;
  readonly html: string;
  readonly csp?: AppWindowCsp;
  readonly permissions?: Readonly<Record<string, JsonValue>>;
  readonly tool?: JsonValue;
  readonly toolInput?: JsonValue;
  readonly toolResult?: JsonValue;
  readonly toolCancelled?: string;
}

export interface AppWindowEventTransport extends BinaryQueryTransport {
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void) => () => void;
}

const MAX_TITLE = 256;
const MAX_ID = 128;
const MAX_DOMAINS = 64;
const MAX_DOMAIN_CHARS = 2048;
/** Text a view may send as a message or as model context. */
export const MAX_APP_WINDOW_TEXT_BYTES = 16 * 1024;

/** Shared facade over the server's app windows. */
export class AppWindowClient {
  constructor(private readonly transport: AppWindowEventTransport) {}

  /** Every window the server holds, oldest first. */
  async list(options: QueryOptions = {}): Promise<readonly AppWindow[]> {
    const result = await this.transport.query<JsonValue>(APP_WINDOW_OPERATIONS.list, {}, options);
    if (!isRecord(result) || !Array.isArray(result.windows)) throw new TypeError("app windows response is invalid");
    return Object.freeze(result.windows.map(validateWindow));
  }

  /** The document and tool data a view starts from. */
  async content(windowId: string, options: QueryOptions = {}): Promise<AppWindowContent> {
    const { result, body } = await this.transport.queryWithBody<JsonValue>(APP_WINDOW_OPERATIONS.content, { windowId: boundedId(windowId) }, options);
    if (!isRecord(result)) throw new TypeError("app window content is invalid");
    return Object.freeze({
      window: validateWindow(result.window),
      html: new TextDecoder("utf-8", { fatal: false }).decode(body),
      ...(result.csp === undefined ? {} : { csp: validateCsp(result.csp) }),
      ...(isRecord(result.permissions) ? { permissions: result.permissions } : {}),
      ...(result.tool === undefined ? {} : { tool: result.tool }),
      ...(result.toolInput === undefined ? {} : { toolInput: result.toolInput }),
      ...(result.toolResult === undefined ? {} : { toolResult: result.toolResult }),
      ...(typeof result.toolCancelled === "string" ? { toolCancelled: result.toolCancelled.slice(0, 1024) } : {}),
    });
  }

  async setState(windowId: string, state: AppWindowState, options: CommandOptions = {}): Promise<void> {
    if (state !== "open" && state !== "minimised") throw new TypeError("app window state is invalid");
    await this.transport.command(APP_WINDOW_OPERATIONS.setState, { windowId: boundedId(windowId), state }, options);
  }

  async close(windowId: string, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(APP_WINDOW_OPERATIONS.close, { windowId: boundedId(windowId) }, options);
  }

  /** Type a view's message into the terminal that owns the window. Only the client controlling that terminal may. */
  async sendMessage(windowId: string, text: string, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(APP_WINDOW_OPERATIONS.message, { windowId: boundedId(windowId), text: boundedText(text) }, options);
  }

  /** Leave text for the model, delivered once with the next tool result from the owning terminal. */
  async updateContext(windowId: string, text: string, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(APP_WINDOW_OPERATIONS.context, { windowId: boundedId(windowId), text: boundedText(text) }, options);
  }

  /** Forward an MCP App view's request to the server that supplied the view. */
  async viewRequest(windowId: string, method: "tools/call" | "resources/read", params: JsonValue, options: CommandOptions = {}): Promise<JsonValue> {
    if (method !== "tools/call" && method !== "resources/read") throw new TypeError("view request method is invalid");
    const result = await this.transport.command<JsonValue>(APP_WINDOW_OPERATIONS.viewRequest, { windowId: boundedId(windowId), method, params }, options);
    if (!isRecord(result) || result.response === undefined) throw new TypeError("view response is invalid");
    return result.response;
  }

  /** Ids only; refetch the details with `list()` and `content()`. */
  onChanged(listener: () => void): () => void {
    if (typeof listener !== "function") throw new TypeError("app window listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("app window subscription is unavailable");
    return this.transport.subscribe(APP_WINDOW_EVENTS.changed, () => listener());
  }
}

function validateWindow(value: JsonValue | undefined): AppWindow {
  if (!isRecord(value) || typeof value.title !== "string" || value.title.length === 0 || value.title.length > MAX_TITLE) throw new TypeError("app window is invalid");
  if (value.state !== "open" && value.state !== "minimised") throw new TypeError("app window state is invalid");
  if (!Number.isSafeInteger(value.contentRevision) || !Number.isFinite(value.createdAt)) throw new TypeError("app window is invalid");
  return Object.freeze({
    id: boundedId(value.id),
    terminalSessionId: boundedId(value.terminalSessionId),
    projectId: boundedId(value.projectId),
    title: value.title,
    source: validateSource(value.source),
    state: value.state,
    contentRevision: value.contentRevision as number,
    createdAt: value.createdAt as number,
  });
}

function validateSource(value: JsonValue | undefined): AppWindowSource {
  if (!isRecord(value)) throw new TypeError("app window source is invalid");
  if (value.kind === "agent") return Object.freeze({ kind: "agent" });
  if (value.kind !== "mcp-app" || typeof value.server !== "string" || typeof value.tool !== "string" || typeof value.resourceUri !== "string") throw new TypeError("app window source is invalid");
  if (value.server.length > MAX_TITLE || value.tool.length > MAX_TITLE || value.resourceUri.length > MAX_DOMAIN_CHARS) throw new TypeError("app window source is invalid");
  return Object.freeze({ kind: "mcp-app", server: value.server, tool: value.tool, resourceUri: value.resourceUri });
}

function validateCsp(value: JsonValue): AppWindowCsp {
  if (!isRecord(value)) throw new TypeError("app window csp is invalid");
  const domains = (entry: JsonValue | undefined): readonly string[] | undefined => {
    if (entry === undefined) return undefined;
    if (!Array.isArray(entry) || entry.length > MAX_DOMAINS || entry.some((domain) => typeof domain !== "string" || domain.length === 0 || domain.length > MAX_DOMAIN_CHARS)) throw new TypeError("app window csp is invalid");
    return Object.freeze([...(entry as string[])]);
  };
  const csp: Record<string, readonly string[]> = {};
  for (const key of ["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"] as const) {
    const list = domains(value[key]);
    if (list !== undefined) csp[key] = list;
  }
  return Object.freeze(csp);
}

function boundedText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > MAX_APP_WINDOW_TEXT_BYTES) throw new TypeError("app window text is invalid");
  return value;
}
function boundedId(value: unknown): string { if (typeof value !== "string" || value.length > MAX_ID || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError("app window id is invalid"); return value; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
