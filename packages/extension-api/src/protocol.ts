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
  "extensions.restart", "extensions.remove", "extensions.previewInstall",
  "extensions.install", "extensions.previewUpdate", "extensions.update", "extensions.rollback",
  "projectEnvironments.listProviders", "projectEnvironments.listProfiles",
  "projectEnvironments.getProfileForm", "projectEnvironments.validateProfile",
  "projectEnvironments.saveProfile", "projectEnvironments.deleteProfile",
  "projectEnvironments.getCreateForm", "projectEnvironments.validateCreate",
  "projectEnvironments.create", "projectEnvironments.getOperation",
  "projectEnvironments.cancelOperation", "projectEnvironments.listEnvironments",
  "projectEnvironments.getEnvironment", "projectEnvironments.invokeAction",
] as const;
export type ExtensionOperationName = (typeof EXTENSION_OPERATION_NAMES)[number];

export const EXTENSION_EVENT_NAMES = [
  "extensions.changed", "extensions.operationChanged",
  "projectEnvironments.providersChanged", "projectEnvironments.profilesChanged",
  "projectEnvironments.environmentsChanged", "projectEnvironments.operationChanged",
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
  "extensions.previewInstall": "extensions:manage",
  "extensions.install": "extensions:manage",
  "extensions.previewUpdate": "extensions:manage",
  "extensions.update": "extensions:manage",
  "extensions.rollback": "extensions:manage",
  "projectEnvironments.listProviders": "project-environments:read",
  "projectEnvironments.listProfiles": "project-environments:read",
  "projectEnvironments.getProfileForm": "project-environments:read",
  "projectEnvironments.validateProfile": "project-environments:manage",
  "projectEnvironments.saveProfile": "project-environments:manage",
  "projectEnvironments.deleteProfile": "project-environments:manage",
  "projectEnvironments.getCreateForm": "project-environments:read",
  "projectEnvironments.validateCreate": "project-environments:use",
  "projectEnvironments.create": "project-environments:use",
  "projectEnvironments.getOperation": "project-environments:read",
  "projectEnvironments.cancelOperation": "project-environments:use",
  "projectEnvironments.listEnvironments": "project-environments:read",
  "projectEnvironments.getEnvironment": "project-environments:read",
  "projectEnvironments.invokeAction": "project-environments:lifecycle",
});
