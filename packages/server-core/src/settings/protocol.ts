import type { JsonValue, ProtocolError } from "@terminay/protocol";
import type { OperationRegistries, OrderedEventJournalLike, CommandRequest, QueryRequest } from "../types.js";
import { ServerSettingsRepository } from "./repository.js";
import { isSettingsObject } from "./types.js";

export const SETTINGS_OPERATIONS = Object.freeze({
  get: "settings.get",
  update: "settings.update",
  reset: "settings.reset",
} as const);

export const SETTINGS_EVENTS = Object.freeze({ changed: "settings.changed" } as const);

export interface SettingsOperationRegistry {
  readonly operations: OperationRegistries;
}

/** Bind the durable settings repository to the shared application protocol.
 * Secret values are not part of ServerSettingsState; only vault references
 * can cross this boundary. */
export function createSettingsOperationRegistry(
  repository: ServerSettingsRepository,
  eventJournal: OrderedEventJournalLike,
): SettingsOperationRegistry {
  if (!(repository instanceof ServerSettingsRepository)) throw new TypeError("settings repository is required");
  return {
    operations: {
      queries: { [SETTINGS_OPERATIONS.get]: get },
      commands: {
        [SETTINGS_OPERATIONS.update]: update,
        [SETTINGS_OPERATIONS.reset]: reset,
      },
      policies: {
        [SETTINGS_OPERATIONS.get]: { scope: "read" },
        [SETTINGS_OPERATIONS.update]: { scope: "write" },
        [SETTINGS_OPERATIONS.reset]: { scope: "write" },
      },
    },
  };

  async function get(_request: QueryRequest): Promise<JsonValue> {
    return asJson(await repository.load());
  }

  async function update(request: CommandRequest): Promise<{ result: JsonValue; revision: number }> {
    const payload = objectPayload(request.envelope.payload);
    if (!isSettingsObject(payload.settings)) throw protocolError("validation", "settings update payload is invalid");
    const result = await repository.update(payload.settings, request.envelope.expectedRevision, request.envelope.commandId);
    return applied(result);
  }

  async function reset(request: CommandRequest): Promise<{ result: JsonValue; revision: number }> {
    const payload = objectPayload(request.envelope.payload);
    const path = payload.path;
    if (path !== undefined && (typeof path !== "string" || path.length === 0 || path.length > 512)) {
      throw protocolError("validation", "settings reset path is invalid");
    }
    const result = await repository.reset({
      expectedRevision: request.envelope.expectedRevision,
      commandId: request.envelope.commandId,
      ...(path === undefined ? {} : { path }),
    });
    return applied(result);
  }

  function applied(result: Awaited<ReturnType<ServerSettingsRepository["update"]>>): { result: JsonValue; revision: number } {
    if (!result.ok) {
      throw protocolError("conflict", result.conflict.message, {
        currentRevision: result.conflict.currentRevision,
        currentCursor: result.conflict.currentCursor,
      }, true);
    }
    const state = asJson(result.state);
    eventJournal.append(SETTINGS_EVENTS.changed, state);
    return { result: state, revision: result.revision };
  }
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw protocolError("validation", "settings payload must be an object");
  }
  return value;
}

function asJson(value: unknown): JsonValue {
  return structuredClone(value) as JsonValue;
}

function protocolError(
  code: ProtocolError["code"],
  message: string,
  details?: JsonValue,
  retryable = false,
): ProtocolError {
  return { code, message, ...(details === undefined ? {} : { details }), retryable };
}
