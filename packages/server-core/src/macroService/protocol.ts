import { protocolError, type JsonValue } from "@terminay/protocol";
import { MacroServiceError } from "./errors.js";
import { MacroRepository } from "./repository.js";
import { MacroRunner } from "./runner.js";
import type {
  MacroExecutionEnvironment,
  MacroFieldValue,
  MacroTarget,
} from "./types.js";
import type {
  CommandRequest,
  OperationRegistries,
  OrderedEventJournalLike,
  QueryRequest,
} from "../types.js";

export const MACRO_OPERATIONS = Object.freeze({
  get: "macros.get",
  replace: "macros.replace",
  upsert: "macros.upsert",
  remove: "macros.remove",
  reset: "macros.reset",
  run: "macros.run",
  cancel: "macros.cancel",
  runs: "macros.runs",
} as const);

export const MACRO_EVENTS = Object.freeze({
  changed: "macros.changed",
  runChanged: "macros.run.changed",
} as const);

export interface MacroOperationRegistryOptions {
  readonly serverId: string;
  readonly repository: MacroRepository;
  readonly runner?: MacroRunner;
  readonly eventJournal: OrderedEventJournalLike;
  /** Builds a server-owned PTY/vault environment for this exact target. */
  readonly environmentFor: (request: CommandRequest, target: MacroTarget) => MacroExecutionEnvironment;
}

export interface MacroOperationRegistry {
  readonly operations: OperationRegistries;
  readonly runner: MacroRunner;
  /** Cancel the disconnect-scoped runs launched by one connection. A run
   * launched by another live connection of the same client keeps running. */
  readonly closeConnection: (connectionId: string) => void;
}

/** Bind revisioned macro editing and server-side execution to the canonical
 * query/command dispatcher. No resolved secret crosses this boundary. */
export function createMacroOperationRegistry(options: MacroOperationRegistryOptions): MacroOperationRegistry {
  if (!(options.repository instanceof MacroRepository)) throw new TypeError("macro repository is required");
  const runner = options.runner ?? new MacroRunner();
  const owners = new Map<string, string>();
  const targets = new Map<string, MacroTarget>();

  const operations: OperationRegistries = {
    queries: {
      [MACRO_OPERATIONS.get]: get,
      [MACRO_OPERATIONS.runs]: listRuns,
    },
    commands: {
      [MACRO_OPERATIONS.replace]: replace,
      [MACRO_OPERATIONS.upsert]: upsert,
      [MACRO_OPERATIONS.remove]: remove,
      [MACRO_OPERATIONS.reset]: reset,
      [MACRO_OPERATIONS.run]: run,
      [MACRO_OPERATIONS.cancel]: cancel,
    },
    policies: {
      [MACRO_OPERATIONS.get]: { scope: "read" },
      [MACRO_OPERATIONS.runs]: { scope: "read" },
      [MACRO_OPERATIONS.replace]: { scope: "write" },
      [MACRO_OPERATIONS.upsert]: { scope: "write" },
      [MACRO_OPERATIONS.remove]: { scope: "write" },
      [MACRO_OPERATIONS.reset]: { scope: "write" },
      [MACRO_OPERATIONS.run]: { scope: "write" },
      [MACRO_OPERATIONS.cancel]: { scope: "write" },
    },
  };

  return {
    operations,
    runner,
    closeConnection: (connectionId) => runner.launcherDisconnected(connectionId),
  };

  async function get(_request: QueryRequest): Promise<JsonValue> {
    return asJson(await options.repository.load());
  }

  async function listRuns(_request: QueryRequest): Promise<JsonValue> {
    return asJson(runner.list());
  }

  async function replace(request: CommandRequest): Promise<{ readonly result: JsonValue; readonly revision: number }> {
      return apply(() => {
      const payload = objectPayload(request.envelope.payload);
      if (!Array.isArray(payload.macros)) throw macroError("invalid_macro", "macro replacement payload is invalid");
      return options.repository.replace(payload.macros, request.envelope.expectedRevision, request.envelope.commandId);
    });
  }

  async function upsert(request: CommandRequest): Promise<{ readonly result: JsonValue; readonly revision: number }> {
    return apply(() => {
      const payload = objectPayload(request.envelope.payload);
      if (payload.macro === undefined) throw macroError("invalid_macro", "macro upsert payload is invalid");
      return options.repository.upsert(payload.macro, request.envelope.expectedRevision, request.envelope.commandId);
    });
  }

  async function remove(request: CommandRequest): Promise<{ readonly result: JsonValue; readonly revision: number }> {
    return apply(() => {
      const macroId = boundedId(objectPayload(request.envelope.payload).macroId, "macro id");
      return options.repository.remove(macroId, request.envelope.expectedRevision, request.envelope.commandId);
    });
  }

  async function reset(request: CommandRequest): Promise<{ readonly result: JsonValue; readonly revision: number }> {
    return apply(() => options.repository.reset({ expectedRevision: request.envelope.expectedRevision, commandId: request.envelope.commandId }));
  }

  async function apply(operation: () => Promise<Awaited<ReturnType<MacroRepository["replace"]>>>) {
    try {
      const result = await operation();
      if (!result.ok) throw protocolError("conflict", result.conflict.message, { details: { currentRevision: result.conflict.currentRevision, currentCursor: result.conflict.currentCursor }, retryable: true });
      options.eventJournal.append(MACRO_EVENTS.changed, asJson(result.state));
      return { result: asJson(result.state), revision: result.revision };
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  async function run(request: CommandRequest): Promise<JsonValue> {
    try {
      const payload = objectPayload(request.envelope.payload);
      const macroId = boundedId(payload.macroId, "macro id");
      const target = parseTarget(payload.target, options.serverId);
      const state = await options.repository.load();
      const macro = state.macros.find((candidate) => candidate.id === macroId);
      if (macro === undefined) throw macroError("macro_not_found", "macro is unavailable");
      const values = parseValues(payload.values);
      const disconnectPolicy = payload.disconnectPolicy === undefined ? "cancel" : parseDisconnectPolicy(payload.disconnectPolicy);
      const environment = options.environmentFor(request, target);
      const handle = runner.start(macro, environment, {
        authorization: { target, scope: request.context.authScope === "admin" ? "admin" : "write" },
        values,
        launcherId: request.context.connectionId,
        disconnectPolicy,
      });
      owners.set(handle.runId, request.context.clientId);
      targets.set(handle.runId, target);
      options.eventJournal.append(MACRO_EVENTS.runChanged, asJson(handle.snapshot()));
      void handle.promise.then((snapshot) => {
        options.eventJournal.append(MACRO_EVENTS.runChanged, asJson(snapshot));
        owners.delete(handle.runId);
        targets.delete(handle.runId);
      });
      return asJson(handle.snapshot());
    } catch (error) {
      throw toProtocolError(error);
    }
  }

  async function cancel(request: CommandRequest): Promise<JsonValue> {
    try {
      const payload = objectPayload(request.envelope.payload);
      const runId = boundedId(payload.runId, "run id");
      const target = parseTarget(payload.target, options.serverId);
      const snapshot = runner.snapshot(runId);
      if (snapshot === undefined || !sameTarget(snapshot.target, target)) throw macroError("macro_not_found", "macro run is unavailable");
      const owner = owners.get(runId);
      if (owner !== request.context.clientId && request.context.authScope !== "admin") throw macroError("unauthorized_target", "macro run belongs to another client");
      return { runId, canceled: runner.cancel(runId) };
    } catch (error) {
      throw toProtocolError(error);
    }
  }
}

function objectPayload(value: JsonValue): Readonly<Record<string, JsonValue>> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}; }

function parseTarget(value: JsonValue | undefined, serverId: string): MacroTarget {
  const target = objectPayload(value ?? null);
  if (target.serverId !== serverId) throw macroError("unauthorized_target", "macro target is outside this server");
  return { serverId, projectId: boundedId(target.projectId, "project id"), sessionId: boundedId(target.sessionId, "session id") };
}

function parseValues(value: JsonValue | undefined): Readonly<Record<string, MacroFieldValue>> {
  const values = objectPayload(value ?? {});
  const result: Record<string, MacroFieldValue> = {};
  for (const [name, candidate] of Object.entries(values)) {
    if (!/^[^\0]{1,256}$/u.test(name) || typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "boolean" || typeof candidate === "number" && !Number.isFinite(candidate)) throw macroError("invalid_macro", "macro field value is invalid");
    result[name] = candidate;
  }
  return result;
}

function parseDisconnectPolicy(value: JsonValue): "cancel" | "continue" { if (value !== "cancel" && value !== "continue") throw macroError("invalid_macro", "macro disconnect policy is invalid"); return value; }
function boundedId(value: JsonValue | undefined, name: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw macroError("invalid_macro", `${name} is invalid`); return value; }
function sameTarget(left: MacroTarget, right: MacroTarget): boolean { return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId; }
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function macroError(code: MacroServiceError["code"], message: string): MacroServiceError { return new MacroServiceError(code, message); }

function toProtocolError(error: unknown): unknown {
  if (!(error instanceof MacroServiceError)) return error;
  const code = error.code === "conflict" ? "conflict" : error.code === "macro_not_found" ? "not_found" : error.code === "unauthorized_target" ? "forbidden" : error.code === "limit" ? "resource" : error.code === "secret_unavailable" ? "unavailable" : error.code === "canceled" ? "cancelled" : error.code === "invalid_macro" ? "validation" : error.code === "unsupported_step" ? "validation" : "internal";
  return protocolError(code, error.message, error.details === undefined ? {} : { details: error.details as JsonValue });
}
