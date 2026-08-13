export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ExtensionPermission =
  | "configuration:read"
  | "configuration:write"
  | "data:read"
  | "data:write"
  | "cache:write"
  | "network"
  | "secrets:resolve"
  | "ssh-agent:use"
  | "provider:depend"
  | "external-resources:manage";

export type EnvironmentCapability =
  | "terminal"
  | "filesystem"
  | "filesystem-observation"
  | "git"
  | "process-observation"
  | "agent-journal"
  | "mcp-bridge"
  | "infrastructure"
  | "shell-discovery";

export interface ExtensionDependency {
  extensionId: string;
  apiRange: string;
  optional?: boolean;
}

export interface ProjectEnvironmentContribution {
  id: string;
  displayName: string;
  description?: string;
  icon?: ExtensionIcon;
  capabilities: EnvironmentCapability[];
}

export interface TerminayExtensionManifest {
  manifestVersion: 1;
  id: string;
  displayName: string;
  description?: string;
  api: string;
  engines: {
    terminay: string;
    node: string;
  };
  entrypoint: string;
  platforms?: Array<"darwin" | "linux" | "win32">;
  permissions: ExtensionPermission[];
  extensionDependencies?: ExtensionDependency[];
  contributes: {
    projectEnvironments: ProjectEnvironmentContribution[];
  };
}

export type ExtensionIcon =
  | "terminal"
  | "server"
  | "cloud"
  | "key"
  | "folder"
  | "network"
  | "database"
  | "warning"
  | "info";

export interface VisibilityCondition {
  fieldId: string;
  equals?: JsonPrimitive;
  notEquals?: JsonPrimitive;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabledReason?: string;
}

interface BaseField {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  disabledReason?: string;
  visibleWhen?: VisibilityCondition;
}

export interface TextField extends BaseField {
  type: "text" | "url" | "secret" | "textarea";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface NumberField extends BaseField {
  type: "number";
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface BooleanField extends BaseField {
  type: "checkbox" | "switch";
}

export interface SelectField extends BaseField {
  type: "select";
  options?: SelectOption[];
  optionSource?: string;
  searchable?: boolean;
  multiple?: boolean;
}

export interface PresetCardsField extends BaseField {
  type: "preset-cards";
  options: Array<SelectOption & { icon?: ExtensionIcon }>;
}

export type FormField = TextField | NumberField | BooleanField | SelectField | PresetCardsField;

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  disclosure?: "always" | "expanded" | "collapsed";
  fields: FormField[];
}

export interface DeclarativeForm {
  id: string;
  title: string;
  description?: string;
  sections: FormSection[];
  submitLabel: string;
}

export interface ValidationIssue {
  fieldId?: string;
  code: string;
  message: string;
}

export interface ProgressStage {
  id: string;
  label: string;
  state: "pending" | "active" | "complete" | "failed";
  detail?: string;
}

export interface ProgressPresentation {
  operationId: string;
  title: string;
  stages: ProgressStage[];
  resumable: boolean;
}

export interface ConfirmationPresentation {
  title: string;
  message: string;
  kind: "ordinary" | "destructive";
  confirmLabel: string;
  expectedRevision: number;
}

export interface PresentationAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "destructive";
  disabledReason?: string;
  confirmation?: ConfirmationPresentation;
}

export interface StatusCard {
  id: string;
  title: string;
  summary: string;
  icon?: ExtensionIcon;
  tone?: "neutral" | "positive" | "warning" | "danger";
  facts?: Array<{ label: string; value: string }>;
  actions?: PresentationAction[];
  httpsLink?: { label: string; url: string };
}

export interface ProviderDefinition {
  providerId: string;
  displayName: string;
  description?: string;
  icon?: ExtensionIcon;
  capabilities: EnvironmentCapability[];
  profileForm?: DeclarativeForm;
  createForm?: DeclarativeForm;
}

export interface ProviderCallContext {
  /** Absolute ISO-8601 deadline assigned by the host. */
  deadlineAt: string;
  signal: CancellationSignal;
  /** Present for retryable mutations and stable across retries. */
  idempotencyKey?: string;
  /** Optimistic-concurrency revision for mutations of existing state. */
  expectedRevision?: number;
  dependencies: ProviderDependencyBroker;
  profiles: ProviderProfileBroker;
  secrets: ProviderSecretBroker;
  sshAgent: ProviderSshAgentBroker;
}

export interface ProviderProfileSnapshot {
  profileId: string;
  providerId: string;
  /** Non-secret persisted values only; secret fields are omitted. */
  values: Record<string, JsonValue>;
  secretFields: string[];
  revision: number;
}

export interface ProviderProfileBroker {
  /** Reads an own-provider profile after host ownership/permission checks. */
  get(profileId: string): Promise<ProviderProfileSnapshot>;
}

export interface ProviderSecretRequest {
  profileId: string;
  fieldId: string;
  purpose: string;
}

export interface ProviderSecretBroker {
  /**
   * Resolves an own-extension/profile/field binding in the parent, transfers a
   * transient copy to the child, invokes `use` there, then zeroizes the child
   * copy in a finally block. `use` must not return the bytes or place them in
   * provider state, presentation DTOs, logs, or errors.
   */
  withValue<T>(request: ProviderSecretRequest, use: (bytes: Uint8Array) => T | Promise<T>): Promise<T>;
}

export type SshSignatureAlgorithm =
  | "ssh-ed25519"
  | "rsa-sha2-256"
  | "rsa-sha2-512"
  | "ecdsa-sha2-nistp256"
  | "ecdsa-sha2-nistp384"
  | "ecdsa-sha2-nistp521";

export interface SshAgentIdentity {
  /** Host-issued opaque id; never a filesystem/socket/keychain identifier. */
  identityId: string;
  algorithm: SshSignatureAlgorithm;
  publicKey: Uint8Array;
  fingerprint: string;
  comment?: string;
}

export interface SshAgentScope {
  profileId: string;
  purpose: "ssh-user-authentication";
}

export interface SshAgentSignRequest extends SshAgentScope {
  identityId: string;
  algorithm: SshSignatureAlgorithm;
  /** SSH user-authentication challenge; bounded by the child/parent broker. */
  challenge: Uint8Array;
}

export interface SshAgentSignature {
  algorithm: SshSignatureAlgorithm;
  signature: Uint8Array;
}

export interface ProviderSshAgentBroker {
  /** Lists bounded public identity metadata from the selected Terminay Server. */
  listIdentities(scope: SshAgentScope): Promise<SshAgentIdentity[]>;
  /** Signs one bounded SSH authentication challenge after profile authorization. */
  sign(request: SshAgentSignRequest): Promise<SshAgentSignature>;
}

export interface ProviderDependencyRequest {
  providerId: string;
  operation: string;
  payload: JsonValue;
}

export interface ProviderDependencyBroker {
  call(request: ProviderDependencyRequest, context: {
    deadlineAt: string;
    signal: CancellationSignal;
    idempotencyKey?: string;
  }): Promise<JsonValue>;
}

export interface ProfileValuesRequest {
  profileId?: string;
  values: Record<string, JsonValue>;
}

export interface ResolveOptionsRequest {
  sourceId: string;
  profileId?: string;
  query?: string;
  cursor?: string;
  values: Record<string, JsonValue>;
}

export interface OptionSourceResult {
  options: SelectOption[];
  nextCursor?: string;
}

export interface EnvironmentRuntimeRequest {
  environmentId: string;
  profileId?: string;
  providerState: JsonValue;
}

export interface EnvironmentCreateRequest extends ProfileValuesRequest {
  environmentId: string;
  displayName: string;
}

export interface ProviderEnvironmentStatus {
  state: "available" | "connecting" | "unavailable" | "failed" | "deleting";
  message?: string;
  defaultRoot?: string;
  card?: StatusCard;
  progress?: ProgressPresentation;
  revision: number;
}

export type ProvisioningResult =
  | {
      state: "ready";
      providerState: JsonValue;
      status: ProviderEnvironmentStatus;
    }
  | {
      state: "pending";
      operationId: string;
      providerState: JsonValue;
      progress: ProgressPresentation;
      pollAfterMs?: number;
    };

export interface ResumeOperationRequest extends EnvironmentRuntimeRequest {
  operationId: string;
}

export interface InvokeEnvironmentActionRequest extends EnvironmentRuntimeRequest {
  actionId: string;
  values?: Record<string, JsonValue>;
}

/** Server-internal, environment-bound service call. This is deliberately not
 * an arbitrary extension command surface: the host derives the provider state
 * and binding, while each provider accepts only its documented capability and
 * operation DTOs. */
export interface EnvironmentServiceRequest extends EnvironmentRuntimeRequest {
  capability: EnvironmentCapability;
  operation: string;
  projectId: string;
  environmentRevision: number;
  input: JsonValue;
}

export type EnvironmentActionResult =
  | { state: "complete"; providerState: JsonValue; status: ProviderEnvironmentStatus }
  | { state: "pending"; operationId: string; providerState: JsonValue; progress: ProgressPresentation };

export interface ProviderRuntime {
  testProfile(request: ProfileValuesRequest, context: ProviderCallContext): Promise<ValidationIssue[]>;
  resolveOptions(request: ResolveOptionsRequest, context: ProviderCallContext): Promise<OptionSourceResult>;
  createEnvironment(request: EnvironmentCreateRequest, context: ProviderCallContext): Promise<ProvisioningResult>;
  resumeOperation(request: ResumeOperationRequest, context: ProviderCallContext): Promise<ProvisioningResult>;
  getStatus(request: EnvironmentRuntimeRequest, context: ProviderCallContext): Promise<ProviderEnvironmentStatus>;
  invokeAction(request: InvokeEnvironmentActionRequest, context: ProviderCallContext): Promise<EnvironmentActionResult>;
  invokeService?(request: EnvironmentServiceRequest, context: ProviderCallContext): Promise<JsonValue>;
  updateEnvironment?(request: EnvironmentRuntimeRequest & { values: Record<string, JsonValue> }, context: ProviderCallContext): Promise<EnvironmentActionResult>;
  deleteEnvironment?(request: EnvironmentRuntimeRequest, context: ProviderCallContext): Promise<EnvironmentActionResult>;
}

export type ProviderRuntimeMethod = keyof ProviderRuntime;

export interface ProviderRuntimeCall {
  callId: string;
  providerId: string;
  method: ProviderRuntimeMethod;
  deadlineAt: string;
  idempotencyKey?: string;
  expectedRevision?: number;
  request: JsonValue;
}

export interface ProviderRuntimeReply {
  callId: string;
  ok: boolean;
  result?: JsonValue;
  error?: { code: string; message: string; retryable: boolean };
}

export interface ProviderRegistration {
  definition: ProviderDefinition;
  runtime: ProviderRuntime;
}

export interface CancellationSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

export interface ExtensionContext {
  extensionId: string;
  apiVersion: string;
  paths: { configuration: string; data: string; cache: string };
  registerProjectEnvironmentProvider(registration: ProviderRegistration): void;
}

export interface TerminayExtension {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export function defineExtension(extension: TerminayExtension): TerminayExtension {
  return extension;
}
