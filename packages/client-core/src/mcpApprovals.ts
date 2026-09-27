import type { JsonValue } from "@terminay/protocol";
import type { CommandOptions, QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

/** Feature capability a server advertises when it serves MCP approvals. */
export const MCP_APPROVALS_CAPABILITY = "mcp-approvals.v1" as const;

export const MCP_APPROVAL_OPERATIONS = Object.freeze({
  get: "mcp.approvals.get",
  decide: "mcp.approvals.decide",
} as const);

export const MCP_APPROVAL_EVENTS = Object.freeze({
  changed: "mcp.approvals.changed",
} as const);

export type McpApprovalDecision = "once" | "session" | "decline";

export interface McpApprovalDetail {
  readonly label: string;
  readonly value: string;
  readonly code?: boolean;
}

/** One MCP request waiting on a user's decision, shown inline with the terminal that made it. */
export interface McpApproval {
  readonly id: string;
  readonly terminalSessionId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly group: string;
  readonly groupLabel: string;
  readonly agent: string;
  readonly terminalTitle: string;
  /** Completes "<agent> in <terminal> wants to …". */
  readonly summary: string;
  readonly details: readonly McpApprovalDetail[];
  readonly createdAt: number;
}

export interface McpApprovalEventTransport extends QueryCommandTransport {
  readonly subscribe: (event: string, listener: (payload: JsonValue) => void) => () => void;
}

const MAX_TEXT = 64 * 1024;
const MAX_DETAILS = 256;

/** Shared facade over the server's MCP approvals. */
export class McpApprovalClient {
  constructor(private readonly transport: McpApprovalEventTransport) {}

  /** Pending approvals, oldest first. */
  async list(options: QueryOptions = {}): Promise<readonly McpApproval[]> {
    const result = await this.transport.query<JsonValue>(MCP_APPROVAL_OPERATIONS.get, {}, options);
    if (!isRecord(result) || !Array.isArray(result.approvals)) throw new TypeError("MCP approvals response is invalid");
    return Object.freeze(result.approvals.map(validateApproval));
  }

  async decide(approvalId: string, decision: McpApprovalDecision, options: CommandOptions = {}): Promise<void> {
    if (decision !== "once" && decision !== "session" && decision !== "decline") throw new TypeError("MCP approval decision is invalid");
    await this.transport.command(MCP_APPROVAL_OPERATIONS.decide, { approvalId: boundedId(approvalId, "approval id"), decision }, options);
  }

  /** Ids only; refetch the details with `list()`. */
  onChanged(listener: () => void): () => void {
    if (typeof listener !== "function") throw new TypeError("MCP approval listener is required");
    if (typeof this.transport.subscribe !== "function") throw new Error("MCP approval subscription is unavailable");
    return this.transport.subscribe(MCP_APPROVAL_EVENTS.changed, () => listener());
  }
}

function validateApproval(value: JsonValue): McpApproval {
  if (!isRecord(value) || !Array.isArray(value.details) || value.details.length > MAX_DETAILS || typeof value.createdAt !== "number") throw new TypeError("MCP approval is invalid");
  return Object.freeze({
    id: boundedId(value.id, "approval id"),
    terminalSessionId: boundedId(value.terminalSessionId, "terminal session id"),
    projectId: boundedId(value.projectId, "project id"),
    operation: text(value.operation),
    group: text(value.group),
    groupLabel: text(value.groupLabel),
    agent: text(value.agent),
    terminalTitle: text(value.terminalTitle),
    summary: text(value.summary),
    details: Object.freeze(value.details.map((detail) => {
      if (!isRecord(detail)) throw new TypeError("MCP approval detail is invalid");
      return Object.freeze({ label: text(detail.label), value: text(detail.value), ...(detail.code === true ? { code: true } : {}) });
    })),
    createdAt: value.createdAt,
  });
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new TypeError("MCP approval text is invalid");
  return value;
}
function boundedId(value: unknown, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`); return value; }
function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
