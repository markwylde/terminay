import type {
  DeclarativeForm,
  JsonValue,
  ProgressPresentation,
  ProviderDefinition,
  StatusCard,
  ValidationIssue,
} from "./types.js";

export const EXTENSION_OPERATION_NAMES = [
  "extensions.list", "extensions.get", "extensions.enable", "extensions.disable",
  "extensions.restart", "extensions.remove", "extensions.preview-install",
  "extensions.install", "extensions.preview-update", "extensions.update", "extensions.rollback",
  "project-environments.list-providers", "project-environments.list-profiles",
  "project-environments.get-profile-form", "project-environments.validate-profile",
  "project-environments.save-profile", "project-environments.delete-profile",
  "project-environments.get-create-form", "project-environments.validate-create",
  "project-environments.create", "project-environments.get-operation",
  "project-environments.cancel-operation", "project-environments.list-environments",
  "project-environments.get-environment", "project-environments.invoke-action",
] as const;
export type ExtensionOperationName = (typeof EXTENSION_OPERATION_NAMES)[number];

export const EXTENSION_EVENT_NAMES = [
  "extensions.changed", "extensions.operation-changed",
  "project-environments.providers-changed", "project-environments.profiles-changed",
  "project-environments.environments-changed", "project-environments.operation-changed",
] as const;
export type ExtensionEventName = (typeof EXTENSION_EVENT_NAMES)[number];

export type ExtensionPermissionPolicy =
  | "extensions:read"
  | "extensions:manage"
  | "project-environments:read"
  | "project-environments:use"
  | "project-environments:manage"
  | "project-environments:manage-secrets"
  | "project-environments:ssh-trust-override"
  | "project-environments:lifecycle";

export interface RevisionedRequest { expectedRevision: number }
export interface IdempotentRequest { idempotencyKey: string }
export interface BoundedRequest { deadlineAt: string }

export interface ExtensionSummary {
  extensionId: string;
  packageName: string;
  activeVersion?: string;
  pendingVersion?: string;
  displayName: string;
  official: boolean;
  enabled: boolean;
  compatible: boolean;
  runtimeState: "stopped" | "starting" | "running" | "failed" | "quarantined";
  failureMessage?: string;
  revision: number;
}

export interface ExtensionInstallPreview {
  previewDigest: string;
  packageName: string;
  exactVersion: string;
  registryIntegrity: string;
  publisher?: string;
  maintainers: string[];
  repository?: string;
  extensionId: string;
  permissions: string[];
  dependencies: Array<{ name: string; exactVersion: string }>;
  provenance: "verified" | "unavailable" | "failed";
  audit: { low: number; moderate: number; high: number; critical: number };
}

export interface InstallExtensionRequest extends RevisionedRequest, IdempotentRequest, BoundedRequest {
  previewDigest: string;
  confirmation: true;
}

export interface ProviderSummary extends ProviderDefinition {
  extensionId: string;
  available: boolean;
  unavailableReason?: string;
}

export interface EnvironmentProfileSummary {
  profileId: string;
  providerId: string;
  displayName: string;
  defaultRoot?: string;
  redactedValues: Record<string, JsonValue>;
  secretFields: string[];
  revision: number;
}

export interface SaveProfileRequest extends RevisionedRequest, IdempotentRequest, BoundedRequest {
  profileId?: string;
  providerId: string;
  values: Record<string, JsonValue>;
}

export interface ValidateFormResponse {
  valid: boolean;
  issues: ValidationIssue[];
  normalizedValues?: Record<string, JsonValue>;
}

export interface CreateEnvironmentRequest extends RevisionedRequest, IdempotentRequest, BoundedRequest {
  providerId: string;
  profileId?: string;
  values: Record<string, JsonValue>;
}

export interface ProjectEnvironmentSummary {
  environmentId: string;
  providerId: string;
  profileId?: string;
  displayName: string;
  state: "available" | "connecting" | "unavailable" | "failed" | "deleting";
  statusMessage?: string;
  defaultRoot?: string;
  card?: StatusCard;
  revision: number;
}

export interface EnvironmentOperation {
  operationId: string;
  kind: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: ProgressPresentation;
  result?: JsonValue;
  error?: { code: string; message: string; retryable: boolean };
  revision: number;
}

export interface OrderedExtensionEvent<T = JsonValue> {
  event: ExtensionEventName;
  cursor: string;
  sequence: number;
  revision: number;
  occurredAt: string;
  payload: T;
}

export interface ProtocolOperation<Request = JsonValue, Response = JsonValue> {
  name: ExtensionOperationName;
  permission: ExtensionPermissionPolicy;
  request: Request;
  response: Response;
}

export interface FormResponse { form: DeclarativeForm; revision: number }

export const OPERATION_POLICIES: Readonly<Record<ExtensionOperationName, ExtensionPermissionPolicy>> = Object.freeze({
  "extensions.list": "extensions:read",
  "extensions.get": "extensions:read",
  "extensions.enable": "extensions:manage",
  "extensions.disable": "extensions:manage",
  "extensions.restart": "extensions:manage",
  "extensions.remove": "extensions:manage",
  "extensions.preview-install": "extensions:manage",
  "extensions.install": "extensions:manage",
  "extensions.preview-update": "extensions:manage",
  "extensions.update": "extensions:manage",
  "extensions.rollback": "extensions:manage",
  "project-environments.list-providers": "project-environments:read",
  "project-environments.list-profiles": "project-environments:read",
  "project-environments.get-profile-form": "project-environments:read",
  "project-environments.validate-profile": "project-environments:manage",
  "project-environments.save-profile": "project-environments:manage",
  "project-environments.delete-profile": "project-environments:manage",
  "project-environments.get-create-form": "project-environments:read",
  "project-environments.validate-create": "project-environments:use",
  "project-environments.create": "project-environments:use",
  "project-environments.get-operation": "project-environments:read",
  "project-environments.cancel-operation": "project-environments:use",
  "project-environments.list-environments": "project-environments:read",
  "project-environments.get-environment": "project-environments:read",
  "project-environments.invoke-action": "project-environments:lifecycle",
});
