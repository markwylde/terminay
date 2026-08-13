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
  readonly audit?: (event: Readonly<Record<string, unknown>>) => Promise<void> | void;
}

/** Fixed application-protocol surface. Renderer clients receive bounded DTOs,
 * never package paths, code, npm configuration, or extension-owned state. */
export function createExtensionOperationHandlers(options: ExtensionOperationOptions): OperationRegistries {
  const idempotency = new Map<string, Promise<{ result: JsonValue; revision: number }>>();
  const queries: Record<string, QueryHandler> = {
    "extensions.list": async (request) => { permission(request.context, "extensions:read"); return listDto(await options.installer.snapshot(), options.authorityLabel); },
    "extensions.get": async (request) => { permission(request.context, "extensions:read"); const payload = exact(request.envelope.payload, ["extensionId"]); const state = await options.installer.snapshot(); const value = state.extensions[text(payload, "extensionId")]; if (value === undefined) throw failure("not_found", "extension is not installed"); return extensionDto(value, state.revision); },
    "extensions.preview-install": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["spec"]); return previewDto(await options.installer.preview(text(payload, "spec"), request.context.signal)); },
    "extensions.preview-update": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["extensionId", "spec"]); const state = await options.installer.snapshot(); const value = state.extensions[text(payload, "extensionId")]; if (value === undefined) throw failure("not_found", "extension is not installed"); const spec = payload.spec === undefined ? `${value.packageName}@latest` : text(payload, "spec"); const preview = await options.installer.preview(spec, request.context.signal); if (preview.packageName !== value.packageName) throw failure("validation", "an update cannot change package identity"); return previewDto(preview); },
  };
  const mutation = (work: (payload: Record<string, JsonValue>, signal: AbortSignal) => Promise<ExtensionRegistrySnapshot>): CommandHandler => async (request) => {
    permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["extensionId", "previewDigest", "expectedRevision", "confirmation", "idempotencyKey", "deadlineAt"]); const idempotencyKey = text(payload, "idempotencyKey"); const key = `${request.context.clientId}:${request.envelope.operation}:${idempotencyKey}`; const existing = idempotency.get(key); if (existing !== undefined) return existing;
    const operation = (async () => { const before = await options.installer.snapshot(); revision(payload, request.context, before.revision); const next = await work(payload, request.context.signal); const result = listDto(next, options.authorityLabel); options.onChanged?.({ revision: next.revision }); await options.audit?.({ kind: request.envelope.operation, clientId: request.context.clientId, extensionId: payload.extensionId, revision: next.revision }); return { result, revision: next.revision }; })();
    idempotency.set(key, operation); if (idempotency.size > 1_024) idempotency.delete(idempotency.keys().next().value as string); try { return await operation; } catch (error) { idempotency.delete(key); throw error; }
  };
  const commands: Record<string, CommandHandler> = {
    "extensions.preview-package-file": async (request) => { permission(request.context, "extensions:manage"); const payload = exact(request.envelope.payload, ["filename", "idempotencyKey", "deadlineAt"]); return { result: previewDto(await options.installer.previewArchive(text(payload, "filename"), request.body)), revision: (await options.installer.snapshot()).revision }; },
    "extensions.install": mutation(async (payload, signal) => { if (payload.confirmation !== true) throw failure("validation", "extension installation requires confirmation"); return options.installer.confirm(text(payload, "previewDigest"), signal); }),
    "extensions.update": mutation(async (payload, signal) => { if (payload.confirmation !== true) throw failure("validation", "extension update requires confirmation"); const digest = text(payload, "previewDigest"); const extensionId = text(payload, "extensionId"); const preview = options.installer.confirmedPreview(digest); if (preview === undefined || typeof preview.manifestMetadata !== "object" || preview.manifestMetadata === null || !("id" in preview.manifestMetadata) || preview.manifestMetadata.id !== extensionId) throw failure("validation", "update preview did not resolve the selected extension"); return options.installer.confirm(digest, signal); }),
    "extensions.enable": mutation((payload) => options.installer.enable(text(payload, "extensionId"))),
    "extensions.disable": mutation((payload) => options.installer.disable(text(payload, "extensionId"))),
    "extensions.remove": mutation((payload) => options.installer.remove(text(payload, "extensionId"))),
    "extensions.rollback": mutation((payload) => options.installer.rollback(text(payload, "extensionId"))),
    "extensions.restart": mutation(async (payload) => { const extensionId = text(payload, "extensionId"); if (options.restart !== undefined) await options.restart(extensionId); else await options.hosts?.stop(extensionId); return options.installer.snapshot(); }),
  };
  const policies = Object.fromEntries([...Object.keys(queries).map((operation) => [operation, { scope: "read" }]), ...Object.keys(commands).map((operation) => [operation, { scope: "write" }])]) as OperationRegistries["policies"];
  return { queries, commands, policies };
}

function listDto(state: ExtensionRegistrySnapshot, authorityLabel: string): JsonValue { return { authorityLabel, revision: state.revision, catalogue: OFFICIAL_EXTENSION_CATALOGUE.map((item) => ({ extensionId: item.extensionId, packageName: item.packageName, displayName: item.displayName, description: item.description, official: true })), extensions: Object.values(state.extensions).sort((a, b) => a.extensionId.localeCompare(b.extensionId)).map((item) => extensionDto(item, state.revision)) } as JsonValue; }
function extensionDto(value: InstalledExtensionRecord, revisionValue: number): JsonValue { const active = value.activeSlotId === undefined ? undefined : value.slots[value.activeSlotId]; const pending = value.pendingSlotId === undefined ? undefined : value.slots[value.pendingSlotId]; const uploaded = active?.receipt.source === "uploaded"; const official = !uploaded && OFFICIAL_EXTENSION_CATALOGUE.some((item) => item.extensionId === value.extensionId); return { extensionId: value.extensionId, packageName: value.packageName, ...(active === undefined ? {} : { activeVersion: active.version }), ...(pending === undefined ? {} : { pendingVersion: pending.version }), displayName: active?.receipt.manifest.displayName ?? value.extensionId, official, ...(uploaded ? { provenance: "Uploaded package · Unverified" } : {}), enabled: value.enabled, compatible: value.state !== "incompatible", runtimeState: value.state === "quarantined" ? "quarantined" : value.state === "failed" ? "failed" : "stopped", ...(value.failureClass ? { failureMessage: value.failureClass } : {}), revision: revisionValue } as JsonValue; }
function previewDto(value: Awaited<ReturnType<ExtensionInstaller["preview"]>>): JsonValue { return { previewDigest: value.previewDigest, packageName: value.packageName, exactVersion: value.version, registryIntegrity: value.integrity, source: value.source === "uploaded" ? "uploaded" : "npmjs", ...(value.uploadedFilename ? { filename: value.uploadedFilename } : {}), ...(value.publisher ? { publisher: value.publisher } : {}), maintainers: [...(value.maintainers ?? [])], ...(value.repository ? { repository: value.repository } : {}), extensionId: typeof value.manifestMetadata === "object" && value.manifestMetadata !== null && "id" in value.manifestMetadata ? String(value.manifestMetadata.id) : "", permissions: [...value.declaredPermissions], dependencies: [], provenance: value.provenance === "verified" ? "verified" : value.provenance === "unverified" ? "failed" : "unavailable", audit: value.audit ?? { low: 0, moderate: 0, high: 0, critical: 0 }, official: value.official, ...(value.trustedCodeWarning ? { trustedCodeWarning: value.trustedCodeWarning } : {}) } as JsonValue; }
function exact(value: unknown, allowed: readonly string[]): Record<string, JsonValue> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw failure("validation", "extension request payload is invalid"); const result = value as Record<string, JsonValue>; for (const key of Object.keys(result)) if (!allowed.includes(key)) throw failure("validation", "extension request contains an unsupported field"); return result; }
function text(value: Record<string, JsonValue>, key: string): string { const result = value[key]; if (typeof result !== "string" || result.length === 0 || result.length > 500) throw failure("validation", `${key} is invalid`); return result; }
function revision(payload: Record<string, JsonValue>, context: RequestContext, current: number): void { const expected = payload.expectedRevision ?? context.expectedRevision; if (!Number.isSafeInteger(expected) || expected !== current) throw failure("conflict", "extension registry revision changed"); }
function permission(context: RequestContext, required: string): void { if (!context.permissions?.includes(required)) throw failure("forbidden", `permission ${required} is required`); }
function failure(code: "validation" | "not_found" | "conflict" | "forbidden", message: string): Error & { code: string; retryable: boolean } { return Object.assign(new Error(message), { code, retryable: false }); }
