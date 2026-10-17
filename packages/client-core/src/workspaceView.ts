import type { JsonValue } from "@terminay/protocol";
import type { QueryCommandTransport } from "./queryCommand.js";

/**
 * The client side of the workspace view relay (ADR-0070).
 *
 * An MCP agent that reads or changes the view asks the one client it is
 * talking from. That client applies the request to its own panes and answers
 * with what it now shows. Nothing here decides what an agent may do: the
 * server has already checked that before a request arrives.
 */

export const WORKSPACE_VIEW_OPERATIONS = Object.freeze({
  attach: "workspace-view.attach",
  respond: "workspace-view.respond",
} as const);

export const WORKSPACE_VIEW_EVENTS = Object.freeze({
  request: "workspace-view.request",
} as const);

export const WORKSPACE_VIEW_REQUEST_OPS = Object.freeze([
  "layout",
  "focus",
  "place",
  "resize",
  "arrange",
  "showProject",
  "selectFolder",
  "openFile",
  "closeTab",
] as const);
export type WorkspaceViewRequestOp = (typeof WORKSPACE_VIEW_REQUEST_OPS)[number];

export interface WorkspaceViewRequest {
  readonly requestId: string;
  readonly op: WorkspaceViewRequestOp;
  readonly params: Readonly<Record<string, JsonValue>>;
}

/** Why a client could not apply a request, as a short code the server passes on. */
export class WorkspaceViewRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceViewRefusal";
  }
}

export interface WorkspaceViewEventTransport extends QueryCommandTransport {
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void, onResync?: () => void) => () => void;
}

const OPS = new Set<string>(WORKSPACE_VIEW_REQUEST_OPS);
const REFUSAL_CODE = /^[a-z_]{1,32}$/u;

/**
 * Serve view requests for one connection: attach once, then answer each
 * request with the handler's result or its refusal. Returns the unsubscribe.
 */
export function serveWorkspaceView(
  transport: WorkspaceViewEventTransport,
  handle: (request: WorkspaceViewRequest) => Promise<JsonValue>,
): () => void {
  let stopped = false;
  const unsubscribe = transport.subscribe(WORKSPACE_VIEW_EVENTS.request, (payload) => {
    const request = parseRequest(payload);
    if (request === undefined || stopped) return;
    void answer(request);
  });
  // A server that predates the relay refuses the attach; nothing then arrives.
  void transport.command(WORKSPACE_VIEW_OPERATIONS.attach, {}).catch(() => undefined);

  async function answer(request: WorkspaceViewRequest): Promise<void> {
    let reply: JsonValue;
    try {
      reply = { requestId: request.requestId, ok: true, result: await handle(request) };
    } catch (error) {
      const code = error instanceof WorkspaceViewRefusal && REFUSAL_CODE.test(error.code) ? error.code : "failed";
      const message = error instanceof Error ? error.message.slice(0, 512) : "The window could not do that.";
      reply = { requestId: request.requestId, ok: false, error: { code, message } };
    }
    // A reply the server no longer wants (it timed out, or was cancelled) is
    // refused; there is nothing to do about that here.
    await transport.command(WORKSPACE_VIEW_OPERATIONS.respond, reply).catch(() => undefined);
  }

  return () => {
    stopped = true;
    unsubscribe();
  };
}

function parseRequest(payload: JsonValue): WorkspaceViewRequest | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const { requestId, op, params } = payload as Record<string, JsonValue>;
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 64) return undefined;
  if (typeof op !== "string" || !OPS.has(op)) return undefined;
  const fields = typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, JsonValue>) : {};
  return { requestId, op: op as WorkspaceViewRequestOp, params: fields };
}
