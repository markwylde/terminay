import { createHash } from "node:crypto";
import type { JsonValue, ProtocolError } from "@terminay/protocol";
import type { CommandRequest, OperationRegistries, QueryRequest } from "../types.js";
import { ShellProfileCatalogueService, ShellProfileMutationError } from "./catalogue.js";

export const SHELL_PROFILE_OPERATIONS = Object.freeze({
  catalogue: "shell-profiles.catalogue",
  detail: "shell-profiles.detail",
  validate: "shell-profiles.validate",
  refresh: "shell-profiles.refresh",
  create: "shell-profiles.create",
  update: "shell-profiles.update",
  reorder: "shell-profiles.reorder",
  delete: "shell-profiles.delete",
  setDefault: "shell-profiles.set-default",
  setCwdPolicy: "shell-profiles.set-cwd-policy",
  reset: "shell-profiles.reset",
} as const);

export function createShellProfileOperationRegistry(service: ShellProfileCatalogueService): { readonly operations: OperationRegistries } {
  return { operations: {
    queries: {
      [SHELL_PROFILE_OPERATIONS.catalogue]: async () => json(await service.catalogue()),
      [SHELL_PROFILE_OPERATIONS.detail]: (request: QueryRequest) => invoke(() => service.detail(field(object(request.envelope.payload).profileId, "profileId"))),
      [SHELL_PROFILE_OPERATIONS.validate]: (request: QueryRequest) => invoke(() => service.validate(object(request.envelope.payload).profile)),
    },
    commands: {
      [SHELL_PROFILE_OPERATIONS.refresh]: async () => json(await service.catalogue()),
      [SHELL_PROFILE_OPERATIONS.create]: (request: CommandRequest) => mutation(request, service, "create"),
      [SHELL_PROFILE_OPERATIONS.update]: (request: CommandRequest) => mutation(request, service, "update"),
      [SHELL_PROFILE_OPERATIONS.reorder]: (request: CommandRequest) => mutation(request, service, "reorder"),
      [SHELL_PROFILE_OPERATIONS.delete]: (request: CommandRequest) => mutation(request, service, "delete"),
      [SHELL_PROFILE_OPERATIONS.setDefault]: (request: CommandRequest) => mutation(request, service, "setDefault"),
      [SHELL_PROFILE_OPERATIONS.setCwdPolicy]: (request: CommandRequest) => mutation(request, service, "setCwdPolicy"),
      [SHELL_PROFILE_OPERATIONS.reset]: (request: CommandRequest) => mutation(request, service, "reset"),
    },
    policies: {
      [SHELL_PROFILE_OPERATIONS.catalogue]: { scope: "read" },
      [SHELL_PROFILE_OPERATIONS.detail]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.validate]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.refresh]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.create]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.update]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.reorder]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.delete]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.setDefault]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.setCwdPolicy]: { scope: "write" },
      [SHELL_PROFILE_OPERATIONS.reset]: { scope: "write" },
    },
  } };
}

async function mutation(request: CommandRequest, service: ShellProfileCatalogueService, action: "create" | "update" | "reorder" | "delete" | "setDefault" | "setCwdPolicy" | "reset") {
  const payload = object(request.envelope.payload);
  try {
    let result: Awaited<ReturnType<ShellProfileCatalogueService["reset"]>>;
    if (action === "create") {
      const profile = object(payload.profile);
      result = await service.create({ ...profile, id: deterministicProfileId(request.envelope.commandId) }, request.envelope.expectedRevision, request.envelope.commandId);
    } else if (action === "update") result = await service.update(payload.profile, request.envelope.expectedRevision, request.envelope.commandId);
    else if (action === "reorder") result = await service.reorder(stringArray(payload.profileIds, "profileIds"), request.envelope.expectedRevision, request.envelope.commandId);
    else if (action === "delete") result = await service.delete(field(payload.profileId, "profileId"), request.envelope.expectedRevision, request.envelope.commandId);
    else if (action === "setDefault") result = await service.setDefault(field(payload.profileId, "profileId"), request.envelope.expectedRevision, request.envelope.commandId);
    else if (action === "setCwdPolicy") result = await service.setCwdPolicy(field(payload.cwdPolicy, "cwdPolicy") as "current" | "project" | "home", request.envelope.expectedRevision, request.envelope.commandId);
    else result = await service.reset(request.envelope.expectedRevision, request.envelope.commandId);
    if (!result.ok) throw protocolError("conflict", result.conflict.message, { currentRevision: result.conflict.currentRevision }, true);
    const catalogue = await service.catalogue();
    return { result: json(catalogue), revision: result.revision };
  } catch (error) { throw mapError(error); }
}

async function invoke<T>(operation: () => Promise<T>): Promise<JsonValue> {
  try { return json(await operation()); } catch (error) { throw mapError(error); }
}

function deterministicProfileId(commandId: string): string {
  return `profile:${createHash("sha256").update(commandId).digest("hex").slice(0, 24)}`;
}
function object(value: unknown): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw protocolError("validation", "shell profile payload must be an object");
  return value as Record<string, JsonValue>;
}
function field(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) throw protocolError("validation", `${name} is invalid`);
  return value;
}
function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw protocolError("validation", `${name} is invalid`);
  return value as string[];
}
function json(value: unknown): JsonValue { return structuredClone(value) as JsonValue; }
function mapError(error: unknown): ProtocolError {
  if (isProtocolError(error)) return error;
  if (error instanceof ShellProfileMutationError) {
    const code = error.code === "not-found" ? "unavailable" : error.code === "conflict" || error.code === "referenced" ? "conflict" : "validation";
    return protocolError(code, error.message, error.projectIds.length === 0 ? undefined : { projectIds: [...error.projectIds] });
  }
  return protocolError("validation", error instanceof Error ? error.message : "shell profile operation failed");
}
function isProtocolError(value: unknown): value is ProtocolError { return typeof value === "object" && value !== null && "retryable" in value && "code" in value; }
function protocolError(code: ProtocolError["code"], message: string, details?: JsonValue, retryable = false): ProtocolError { return { code, message, ...(details === undefined ? {} : { details }), retryable }; }
