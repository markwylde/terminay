import { protocolError, type JsonValue } from "@terminay/protocol";
import type { AuthenticatedClient, CommandRequest, OperationRegistries, OrderedEvent, OrderedEventJournalLike, QueryRequest } from "../types.js";
import { AgentStatusService } from "./agentService.js";

/** Stable protocol names for the reduced, server-owned agent authority. */
export const AGENT_OPERATIONS = Object.freeze({
  snapshot: "agent.snapshot",
  acknowledge: "agent.acknowledge",
  /**
   * Reconciles the provider-owned hook files from the same composed server
   * authority in both standalone and embedded hosts. This is deliberately an
   * admin command: it may write files below the server account's home.
   */
  reconcileHooks: "agent.hooks.reconcile",
  event: "agent",
} as const);

export interface AgentOperationRegistryOptions {
  readonly service: AgentStatusService;
  /** The same journal used by ServerCore, so agent changes preserve the
   * ordinary authenticated subscription/replay boundary. */
  readonly eventJournal: OrderedEventJournalLike;
}

export interface AgentOperationRegistry {
  readonly operations: OperationRegistries;
  readonly close: () => void;
}

/**
 * Expose only reduced agent snapshots. Provider hook tokens and native hook
 * payloads never cross this boundary: AgentStatusService has already reduced
 * them before publishing its immutable status snapshot.
 */
export function createAgentOperationRegistry(options: AgentOperationRegistryOptions): AgentOperationRegistry {
  if (!(options.service instanceof AgentStatusService)) throw new TypeError("agent status service is required");
  const unsubscribe = options.service.subscribe((snapshot) => {
    options.eventJournal.append(AGENT_OPERATIONS.event, asSnapshot(snapshot));
  });
  return {
    operations: {
      queries: {
        [AGENT_OPERATIONS.snapshot]: (request: QueryRequest) => snapshot(request),
      },
      commands: {
        [AGENT_OPERATIONS.acknowledge]: (request: CommandRequest) => acknowledge(request),
        [AGENT_OPERATIONS.reconcileHooks]: (request: CommandRequest) => reconcileHooks(request),
      },
      policies: {
        [AGENT_OPERATIONS.snapshot]: { scope: "read" },
        [AGENT_OPERATIONS.acknowledge]: { scope: "read" },
        [AGENT_OPERATIONS.reconcileHooks]: { scope: "admin" },
      },
    },
    close: unsubscribe,
  };

  function snapshot(request: QueryRequest): JsonValue {
    assertReadable(request);
    return asSnapshot(options.service.getSnapshotForProject(projectClaim(request)));
  }

  function acknowledge(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const projectId = id(payload.projectId, "projectId");
    const sessionId = id(payload.sessionId, "sessionId");
    const entryId = payload.entryId === undefined ? undefined : id(payload.entryId, "entryId");
    const claimedProjectId = projectClaim(request);
    if (claimedProjectId !== undefined && claimedProjectId !== projectId) {
      throw protocolError("forbidden", "agent acknowledgement is outside the authenticated project scope");
    }
    const acknowledged = options.service.acknowledge({
      serverId: options.service.serverId,
      projectId,
      sessionId,
    }, entryId);
    const current = options.service.getSnapshot();
    return { acknowledged, revision: current.revision, cursor: String(current.revision) } as JsonValue;
  }

  async function reconcileHooks(request: CommandRequest): Promise<JsonValue> {
    const payload = objectPayload(request.envelope.payload);
    const action = payload.action;
    if (action !== "install" && action !== "uninstall" && action !== "status") {
      throw protocolError("validation", "agent hook action is invalid");
    }
    const provider = payload.provider;
    if (provider !== undefined && provider !== "codex" && provider !== "claude-code") {
      throw protocolError("validation", "agent hook provider is invalid");
    }
    // The server chooses its own home/profile paths. Accepting client-supplied
    // paths here would turn a connection command into arbitrary file access.
    const result = await options.service.drivers.reconcileHooks({
      action,
      ...(provider === undefined ? {} : { provider }),
    });
    return JSON.parse(JSON.stringify(result)) as JsonValue;
  }
}

function asSnapshot(snapshot: ReturnType<AgentStatusService["getSnapshot"]>): JsonValue {
  // Agent entries contain optional fields represented as `undefined` in the
  // internal model. Strip those implementation values before a strict JSON
  // journal validates the wire payload.
  return JSON.parse(JSON.stringify({ revision: snapshot.revision, cursor: String(snapshot.revision), entries: snapshot.entries })) as JsonValue;
}

function assertReadable(request: QueryRequest): void {
  if (request.context.authScope === "none") throw protocolError("forbidden", "agents require read access");
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw protocolError("validation", "agent payload must be an object");
  return value as Record<string, JsonValue>;
}

function id(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:%-]{0,4095}$/u.test(value)) {
    throw protocolError("validation", `${name} is invalid`);
  }
  return value;
}

/** Project an agent journal event immediately before it is sent to an
 * authenticated client. The global journal remains canonical; client-facing
 * payloads never contain entries outside an exact project claim. */
export function createAgentEventProjector(service: AgentStatusService): (event: OrderedEvent, client: AuthenticatedClient | undefined) => OrderedEvent | undefined {
  return (event, client) => {
    if (event.event !== AGENT_OPERATIONS.event) return event;
    const projectId = projectClaimFromContext(client?.claims);
    if (projectId === undefined) return event;
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
    const revision = payload.revision;
    const entries = payload.entries;
    if (!Number.isSafeInteger(revision) || typeof payload.cursor !== "string" || typeof entries !== "object" || entries === null || Array.isArray(entries)) return undefined;
    const scoped = service.filterSnapshotForProject({ revision: revision as number, entries: entries as unknown as ReturnType<AgentStatusService["getSnapshot"]>["entries"], eventCursors: Object.freeze({}) }, projectId);
    return Object.freeze({ ...event, payload: asSnapshot(scoped) });
  };
}

function projectClaim(request: QueryRequest | CommandRequest): string | undefined {
  return projectClaimFromContext(request.context.claims);
}

function projectClaimFromContext(claims: unknown): string | undefined {
  const record = typeof claims === "object" && claims !== null && !Array.isArray(claims) ? claims as Record<string, unknown> : undefined;
  return typeof record?.projectId === "string"
    ? record.projectId
    : undefined;
}
