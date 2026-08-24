import type { JsonValue } from "@terminay/protocol";
import type { CommandHandler, OperationRegistries, QueryHandler, RequestContext } from "../types.js";
import { OFFICIAL_EXTENSION_CATALOGUE } from "./catalog.js";
import type { ExtensionHostManager } from "./manager.js";
import type { ExtensionInstaller } from "./installer.js";
import type { ExtensionRegistrySnapshot, InstalledExtensionRecord } from "./installerTypes.js";

export interface ExtensionOperationOptions {
  readonly installer: ExtensionInstaller;
  readonly hosts?: ExtensionHostManager;
  readonly authorityLabel: string;
  readonly onChanged?: (payload: JsonValue) => void;
  readonly restart?: (extensionId: string) => Promise<void>;
  readonly activate?: (extensionId: string) => Promise<void>;
  readonly activateEnabled?: () => Promise<void>;
  /** Server lifecycle entrypoint. It reconciles release-built-ins and starts
   * any newly materialized enabled slot before returning. */
  readonly initialize?: () => Promise<ExtensionRegistrySnapshot>;
  readonly reconcileBuiltIns?: (signal?: AbortSignal) => Promise<ExtensionRegistrySnapshot>;
  readonly audit?: (event: Readonly<Record<string, unknown>>) => Promise<void> | void;
}

/** Fixed application-protocol surface. Renderer clients receive bounded DTOs,
 * never package paths, code, npm configuration, or extension-owned state. */
export function createExtensionOperationHandlers(options: ExtensionOperationOptions): OperationRegistries {
  const idempotency = new Map<string, Promise<{ result: JsonValue; revision: number }>>();
  const queries: Record<string, QueryHandler> = {
    "extensions.list": async (request) => { permission(request.context, "extensions:read"); return listDto(await options.installer.snapshot(), options.authorityLabel, options.hosts); },
    "extensions.get": async (request) => { permission(request.context, "extensions:read"); const payload = exact(request.envelope.payload, ["extensionId"]); const state = await options.installer.snapshot(); const value = state.extensions[text(payload, "extensionId")]; if (value === undefined) throw failure("not_found", "extension is not installed"); return extensionDto(value, state.revision, options.hosts); },
    "extensions.preview-install": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["spec"]); return previewDto(await options.installer.preview(text(payload, "spec"), request.context.signal)); },
    "extensions.preview-update": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["extensionId", "spec"]); const state = await options.installer.snapshot(); const value = state.extensions[text(payload, "extensionId")]; if (value === undefined) throw failure("not_found", "extension is not installed"); const spec = payload.spec === undefined ? `${value.packageName}@latest` : text(payload, "spec"); const preview = await options.installer.preview(spec, request.context.signal); if (preview.packageName !== value.packageName) throw failure("validation", "an update cannot change package identity"); return previewDto(preview); },
  };
  const mutation = (work: (payload: Record<string, JsonValue>, signal: AbortSignal) => Promise<ExtensionRegistrySnapshot>): CommandHandler => async (request) => {
    permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["extensionId", "previewDigest", "expectedRevision", "confirmation", "idempotencyKey", "deadlineAt"]); const idempotencyKey = text(payload, "idempotencyKey"); const key = `${request.context.clientId}:${request.envelope.operation}:${idempotencyKey}`; const existing = idempotency.get(key); if (existing !== undefined) return existing;
    const operation = (async () => { const before = await options.installer.snapshot(); revision(payload, request.context, before.revision); const next = await work(payload, request.context.signal); const result = listDto(next, options.authorityLabel, options.hosts); options.onChanged?.({ revision: next.revision }); await options.audit?.({ kind: request.envelope.operation, clientId: request.context.clientId, extensionId: payload.extensionId, revision: next.revision }); return { result, revision: next.revision }; })();
    idempotency.set(key, operation); if (idempotency.size > 1_024) idempotency.delete(idempotency.keys().next().value as string); try { return await operation; } catch (error) { idempotency.delete(key); throw error; }
  };
  const commands: Record<string, CommandHandler> = {
    "extensions.preview-package-file": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["filename", "idempotencyKey", "deadlineAt"]); return { result: previewDto(await options.installer.previewArchive(text(payload, "filename"), request.body)), revision: (await options.installer.snapshot()).revision }; },
    "extensions.install": mutation(async (payload, signal) => { if (payload.confirmation !== true) throw failure("validation", "extension installation requires confirmation"); const digest = text(payload, "previewDigest"); const preview = options.installer.confirmedPreview?.(digest); try { const next = await options.installer.confirm(digest, signal); return preview !== undefined && typeof preview.manifestMetadata === "object" && preview.manifestMetadata !== null && "id" in preview.manifestMetadata ? activateOrRecordFailure(options, String(preview.manifestMetadata.id), next) : next; } catch (error) { throw installFailure(error); } }),
    "extensions.update": mutation(async (payload, signal) => { if (payload.confirmation !== true) throw failure("validation", "extension update requires confirmation"); const digest = text(payload, "previewDigest"); const extensionId = text(payload, "extensionId"); const preview = options.installer.confirmedPreview(digest); if (preview === undefined || typeof preview.manifestMetadata !== "object" || preview.manifestMetadata === null || !("id" in preview.manifestMetadata) || preview.manifestMetadata.id !== extensionId) throw failure("validation", "update preview did not resolve the selected extension"); const next = await options.installer.confirm(digest, signal); return activateOrRecordFailure(options, extensionId, next); }),
    "extensions.enable": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); return activateOrRecordFailure(options, extensionId, await options.installer.enable(extensionId)); }),
    "extensions.disable": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); const next = await options.installer.disable(extensionId); await options.hosts?.stop(extensionId); return next; }),
    "extensions.remove": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); return activateOrRecordFailure(options, extensionId, await options.installer.remove(extensionId)); }),
    "extensions.rollback": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); return activateOrRecordFailure(options, extensionId, await options.installer.rollback(extensionId)); }),
    "extensions.restart": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); try { if (options.restart !== undefined) await options.restart(extensionId); else { await options.hosts?.stop(extensionId); await options.activate?.(extensionId); } return options.installer.snapshot(); } catch (error) { return options.installer.setFailureState(extensionId, "failed", boundedFailure(error)); } }),
  };
  const policies = Object.fromEntries([...Object.keys(queries).map((operation) => [operation, { scope: "read" }]), ...Object.keys(commands).map((operation) => [operation, { scope: "write" }])]) as OperationRegistries["policies"];
  return { queries, commands, policies };
}

/** A built-in has one Settings entry, whether it is already materialized or
 * its release artifact failed validation. Keep the legacy catalogue field for
 * older clients, but omit entries that already have an installed record. */
function listDto(state: ExtensionRegistrySnapshot, authorityLabel: string, hosts?: ExtensionHostManager): JsonValue {
  const installedIds = new Set(Object.keys(state.extensions));
  return {
    authorityLabel,
    revision: state.revision,
    catalogue: OFFICIAL_EXTENSION_CATALOGUE.filter((item) => !installedIds.has(item.extensionId)).map((item) => ({ extensionId: item.extensionId, packageName: item.packageName, displayName: item.displayName, description: item.description, official: true })),
    extensions: Object.values(state.extensions).sort((a, b) => a.extensionId.localeCompare(b.extensionId)).map((item) => extensionDto(item, state.revision, hosts)),
  } as JsonValue;
}
function extensionDto(value: InstalledExtensionRecord, revisionValue: number, hosts?: ExtensionHostManager): JsonValue {
  const active = value.activeSlotId === undefined ? undefined : value.slots[value.activeSlotId];
  const pending = value.pendingSlotId === undefined ? undefined : value.slots[value.pendingSlotId];
  const bundled = Object.values(value.slots).filter((slot) => slot.receipt.source === "built-in").sort((left, right) => right.version.localeCompare(left.version))[0];
  const uploaded = active?.receipt.source === "uploaded";
  const official = bundled !== undefined || (!uploaded && OFFICIAL_EXTENSION_CATALOGUE.some((item) => item.extensionId === value.extensionId));
  return {
    extensionId: value.extensionId,
    packageName: value.packageName,
    ...(active === undefined ? {} : { activeVersion: active.version, origin: active.receipt.source ?? "npmjs" }),
    ...(pending === undefined ? {} : { pendingVersion: pending.version }),
    ...(bundled === undefined ? {} : { bundledVersion: bundled.version, builtIn: true, override: active?.receipt.source !== "built-in" }),
    displayName: active?.receipt.manifest.displayName ?? bundled?.receipt.manifest.displayName ?? value.extensionId,
    official,
    ...(uploaded ? { provenance: "Uploaded package · Unverified" } : {}),
    enabled: value.enabled,
    compatible: value.state !== "incompatible",
    runtimeState: runtimeState(value, hosts),
    ...(value.failureClass ? { failureMessage: value.failureClass } : {}),
    revision: revisionValue,
  } as JsonValue;
}
function runtimeState(value: InstalledExtensionRecord, hosts?: ExtensionHostManager): "running" | "starting" | "stopped" | "activation-required" | "failed" | "quarantined" {
  if (value.state === "quarantined") return "quarantined";
  if (value.state === "failed") return "failed";
  if (!value.enabled) return "stopped";
  if (hosts === undefined) return "activation-required";
  const status = hosts.statuses().find((item) => item.extensionId === value.extensionId);
  if (status?.state === "running") return "running";
  if (status?.state === "starting") return "starting";
  if (status?.state === "quarantined") return "quarantined";
  if (status?.state === "failed") return "failed";
  return "activation-required";
}
async function activateOrRecordFailure(options: ExtensionOperationOptions, extensionId: string, fallback: ExtensionRegistrySnapshot): Promise<ExtensionRegistrySnapshot> {
  if (options.activate === undefined) return fallback;
  try { await options.activate(extensionId); return options.installer.snapshot(); }
  catch (error) { return options.installer.setFailureState(extensionId, "failed", boundedFailure(error)); }
}
function previewDto(value: Awaited<ReturnType<ExtensionInstaller["preview"]>>): JsonValue { return { previewDigest: value.previewDigest, packageName: value.packageName, exactVersion: value.version, registryIntegrity: value.integrity, source: value.source === "uploaded" ? "uploaded" : "npmjs", ...(value.uploadedFilename ? { filename: value.uploadedFilename } : {}), ...(value.publisher ? { publisher: value.publisher } : {}), maintainers: [...(value.maintainers ?? [])], ...(value.repository ? { repository: value.repository } : {}), extensionId: typeof value.manifestMetadata === "object" && value.manifestMetadata !== null && "id" in value.manifestMetadata ? String(value.manifestMetadata.id) : "", permissions: [...value.declaredPermissions], dependencies: [], provenance: value.provenance === "verified" ? "verified" : value.provenance === "unverified" ? "failed" : "unavailable", audit: value.audit ?? { low: 0, moderate: 0, high: 0, critical: 0 }, official: value.official, ...(value.trustedCodeWarning ? { trustedCodeWarning: value.trustedCodeWarning } : {}) } as JsonValue; }
function exact(value: unknown, allowed: readonly string[]): Record<string, JsonValue> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw failure("validation", "extension request payload is invalid"); const result = value as Record<string, JsonValue>; for (const key of Object.keys(result)) if (!allowed.includes(key)) throw failure("validation", "extension request contains an unsupported field"); return result; }
function text(value: Record<string, JsonValue>, key: string): string { const result = value[key]; if (typeof result !== "string" || result.length === 0 || result.length > 500) throw failure("validation", `${key} is invalid`); return result; }
function revision(payload: Record<string, JsonValue>, context: RequestContext, current: number): void { const expected = payload.expectedRevision ?? context.expectedRevision; if (!Number.isSafeInteger(expected) || expected !== current) throw failure("conflict", "extension registry revision changed"); }
function permission(context: RequestContext, required: string): void { if (!context.permissions?.includes(required)) throw failure("forbidden", `permission ${required} is required`); }
function failure(code: "validation" | "not_found" | "conflict" | "forbidden", message: string): Error & { code: string; retryable: boolean } { return Object.assign(new Error(message), { code, retryable: false }); }
function installFailure(error: unknown): Error & { code: string; retryable: boolean } { const message = error instanceof Error ? error.message.replace(/[\0\r\n]+/gu, " ").slice(0, 512) : "extension installation failed"; return Object.assign(new Error(message || "extension installation failed"), { code: "unavailable", retryable: true }); }
function boundedFailure(error: unknown): string { return error instanceof Error ? error.message.replace(/[\0\r\n]+/gu, " ").slice(0, 512) || "extension activation failed" : "extension activation failed"; }
