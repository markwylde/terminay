import { protocolError, type JsonValue } from "@terminay/protocol";
import type { AuthenticatedClient, CommandRequest, OperationRegistries, OrderedEvent, OrderedEventJournalLike, QueryRequest } from "../types.js";
import { TerminalActivityService } from "./service.js";
import type { ActivityClosePreflight, ActivityClosePreflightSession } from "./types.js";
import type { TerminalForegroundObservation } from "../terminalService/types.js";

/** Stable protocol names for the canonical activity authority. */
export const ACTIVITY_OPERATIONS = Object.freeze({
  snapshot: "activity.snapshot",
  delta: "activity.delta",
  closePreflight: "activity.closePreflight",
  acknowledge: "activity.acknowledge",
  event: "activity",
} as const);

export interface ActivityClosePreflightScope {
  readonly projectId: string;
  readonly sessionId?: string;
}

export interface ActivityOperationRegistryOptions {
  readonly service: TerminalActivityService;
  /** The same journal installed in ServerCore, so activity subscriptions have
   * normal replay and ordering semantics alongside other server events. */
  readonly eventJournal: OrderedEventJournalLike;
  /** Bounded exact-session or project-scoped host observation for close
   * protection. Snapshots never use this hook. */
  readonly observeForeground?: (
    request: QueryRequest,
    scope: ActivityClosePreflightScope,
  ) => Promise<readonly TerminalForegroundObservation[]>;
}

export interface ActivityOperationRegistry {
  readonly operations: OperationRegistries;
  readonly close: () => void;
}

/**
 * Expose server-owned activity snapshots and acknowledgement through the
 * authenticated application protocol. The reducer remains the sole authority:
 * this layer only validates immutable terminal identities and publishes its
 * already-reduced events.
 */
export function createActivityOperationRegistry(options: ActivityOperationRegistryOptions): ActivityOperationRegistry {
  if (!(options.service instanceof TerminalActivityService)) throw new TypeError("activity service is required");
  const unsubscribe = options.service.subscribe((event) => {
    options.eventJournal.append(ACTIVITY_OPERATIONS.event, event as unknown as JsonValue);
  });
  return {
    operations: {
      queries: {
        [ACTIVITY_OPERATIONS.snapshot]: (request: QueryRequest) => snapshot(request),
        [ACTIVITY_OPERATIONS.delta]: (request: QueryRequest) => delta(request),
        [ACTIVITY_OPERATIONS.closePreflight]: (request: QueryRequest) => closePreflight(request),
      },
      commands: {
        [ACTIVITY_OPERATIONS.acknowledge]: (request: CommandRequest) => acknowledge(request),
      },
      policies: {
        [ACTIVITY_OPERATIONS.snapshot]: { scope: "read" },
        [ACTIVITY_OPERATIONS.delta]: { scope: "read" },
        [ACTIVITY_OPERATIONS.closePreflight]: { scope: "read" },
        [ACTIVITY_OPERATIONS.acknowledge]: { scope: "read" },
      },
    },
    close: unsubscribe,
  };

  function snapshot(request: QueryRequest): JsonValue {
    assertReadable(request);
    return options.service.snapshotForProject(projectClaim(request)) as unknown as JsonValue;
  }

  async function closePreflight(request: QueryRequest): Promise<JsonValue> {
    assertReadable(request);
    const payload = objectPayload(request.envelope.payload);
    const projectId = id(payload.projectId, "projectId");
    const sessionId = payload.sessionId === undefined ? undefined : id(payload.sessionId, "sessionId");
    const claimedProjectId = projectClaim(request);
    if (claimedProjectId !== undefined && claimedProjectId !== projectId) {
      throw protocolError("forbidden", "activity close preflight is outside the authenticated project scope");
    }
    const registeredProject = sessionId === undefined ? undefined : options.service.projectIdForSession(sessionId);
    if (registeredProject !== undefined && registeredProject !== projectId) {
      throw protocolError("forbidden", "activity close preflight is outside the session project");
    }

    const observed = options.observeForeground !== undefined;
    let observations: readonly TerminalForegroundObservation[] = [];
    try {
      observations = observed
        ? await options.observeForeground(request, {
            projectId,
            ...(sessionId === undefined ? {} : { sessionId }),
          })
        : [];
    } catch {
      return limitedPreflightResult(options.service, projectId, sessionId) as unknown as JsonValue;
    }

    if (observed) {
      for (const observation of observations) {
        if (observation.observation !== "limited") continue;
        try {
          options.service.ingestSignal({
            serverId: options.service.serverId,
            projectId: observation.projectId,
            sessionId: observation.sessionId,
          }, { kind: "foreground", observation: "limited" });
        } catch {
          // An exited session cannot change close-preflight availability.
        }
      }
    }

    const sessions: ActivityClosePreflightSession[] = observed
      ? observations.map((observation) => {
          const committed = options.service.snapshotForProject(observation.projectId).sessions[observation.sessionId];
          return Object.freeze({
            sessionId: observation.sessionId,
            projectId: observation.projectId,
            observation: observation.observation,
            foregroundBusy: observation.observation === "available"
              ? observation.foregroundBusy
              : observation.foregroundBusy || committed?.foregroundBusy === true,
          });
        })
      : fallbackLimitedSessions(options.service, projectId, sessionId);

    const result: ActivityClosePreflight = Object.freeze({
      observation: sessions.some((session) => session.observation === "limited") ? "limited" : "available",
      runningSessionIds: Object.freeze(
        sessions.filter((session) => session.foregroundBusy).map((session) => session.sessionId).sort(),
      ),
      sessions: Object.freeze(sessions),
    });
    return result as unknown as JsonValue;
  }

  function delta(request: QueryRequest): JsonValue {
    assertReadable(request);
    const payload = objectPayload(request.envelope.payload);
    const revision = uint(payload.revision, "revision");
    const cursor = stringField(payload.cursor, "cursor");
    if (cursor !== String(revision)) throw protocolError("validation", "activity cursor does not match revision");
    return options.service.replayForProject(revision, projectClaim(request)) as unknown as JsonValue;
  }

  function acknowledge(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const sessionId = id(payload.sessionId, "sessionId");
    const projectId = id(payload.projectId, "projectId");
    const expectedUpdatedAt = payload.expectedUpdatedAt === undefined
      ? undefined
      : uint(payload.expectedUpdatedAt, "expectedUpdatedAt");
    const claimedProjectId = projectClaim(request);
    if (claimedProjectId !== undefined && claimedProjectId !== projectId) {
      throw protocolError("forbidden", "activity acknowledgement is outside the authenticated project scope");
    }
    const event = options.service.acknowledge({
      serverId: options.service.serverId,
      projectId,
      sessionId,
    }, expectedUpdatedAt);
    return {
      acknowledged: event !== undefined,
      ...(event === undefined ? {} : { event }),
      revision: options.service.revision,
      cursor: String(options.service.revision),
    } as unknown as JsonValue;
  }
}

function assertReadable(request: QueryRequest): void {
  if (request.context.authScope === "none") throw protocolError("forbidden", "activity requires read access");
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw protocolError("validation", "activity payload must be an object");
  return value as Record<string, JsonValue>;
}

function uint(value: JsonValue | undefined, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw protocolError("validation", `${name} is invalid`);
  return value as number;
}

function stringField(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw protocolError("validation", `${name} is invalid`);
  return value;
}

function id(value: JsonValue | undefined, name: string): string {
  const result = stringField(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result)) throw protocolError("validation", `${name} is invalid`);
  return result;
}

function projectClaim(request: QueryRequest | CommandRequest): string | undefined {
  const claims = request.context.claims;
  return typeof claims === "object" && claims !== null && !Array.isArray(claims) && typeof claims.projectId === "string"
    ? claims.projectId
    : undefined;
}

/** Project activity journal events immediately before transport delivery. */
export function createActivityEventProjector(service: TerminalActivityService): (event: OrderedEvent, client: AuthenticatedClient | undefined) => OrderedEvent | undefined {
  return (event, client) => {
    if (event.event !== ACTIVITY_OPERATIONS.event) return event;
    const projectId = projectClaimFromContext(client?.claims);
    if (projectId === undefined) return event;
    const payload = event.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
    const sessionId = payload.sessionId;
    if (typeof sessionId !== "string" || service.projectIdForSession(sessionId) !== projectId) return undefined;
    const snapshot = payload.snapshot;
    if (snapshot !== undefined && (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot) || (snapshot as Record<string, unknown>).projectId !== projectId)) return undefined;
    return event;
  };
}

function limitedPreflightResult(
  service: TerminalActivityService,
  projectId: string,
  sessionId: string | undefined,
): ActivityClosePreflight {
  const sessions = fallbackLimitedSessions(service, projectId, sessionId);
  return Object.freeze({
    observation: "limited",
    runningSessionIds: Object.freeze(
      sessions.filter((session) => session.foregroundBusy).map((session) => session.sessionId).sort(),
    ),
    sessions: Object.freeze(sessions),
  });
}

function fallbackLimitedSessions(
  service: TerminalActivityService,
  projectId: string,
  sessionId: string | undefined,
): ActivityClosePreflightSession[] {
  if (sessionId !== undefined) {
    const committed = service.snapshotForProject(projectId).sessions[sessionId];
    return [Object.freeze({
      sessionId,
      projectId,
      observation: "limited" as const,
      foregroundBusy: committed?.foregroundBusy === true,
    })];
  }
  return Object.values(service.snapshotForProject(projectId).sessions).map((session) => Object.freeze({
    sessionId: session.sessionId,
    projectId: session.projectId ?? projectId,
    observation: "limited" as const,
    foregroundBusy: session.foregroundBusy,
  }));
}

function projectClaimFromContext(claims: unknown): string | undefined {
  const record = typeof claims === "object" && claims !== null && !Array.isArray(claims) ? claims as Record<string, unknown> : undefined;
  return typeof record?.projectId === "string" ? record.projectId : undefined;
}
