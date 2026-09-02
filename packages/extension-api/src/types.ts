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
  | "external-resources:manage"
  | "agent-observation";

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
  /**
   * Optional, declarative behaviour after a successfully saved profile. The
   * absence of this object is an explicit no-side-effect default: providers
   * must not have an environment created merely because a profile was saved.
   */
  profileSave?: ProfileSaveContribution;
  /**
   * Provider-owned public operations that compatible dependent extensions may
   * request through the host. The operation DTO schemas remain provider-owned
   * JSON; this declaration is the host authorization allowlist.
   */
  dependencyOperations?: ProviderDependencyOperation[];
}

/** A profile-save action which an environment provider must opt into. */
export interface ProfileSaveContribution {
  /** Creates one provider environment bound to the just-saved profile. */
  createEnvironment: true;
}

/** One public, host-authorized operation exposed by a provider dependency. */
export interface ProviderDependencyOperation {
  name: string;
}

/** A capability an agent extension needs from the terminal's exact environment. */
export type AgentObservationCapability =
  | "process-observation"
  | "filesystem-observation"
  | "agent-journal";

/** A deliberately small, safe foreground-process matcher declared in a manifest. */
export interface AgentProcessMatcher {
  executableName: string;
  /** Optional exact argument tokens. This is not a regular expression or shell command. */
  arguments?: string[];
}

/** Maps a provider release range to a provider-owned record mapping. */
export interface AgentMappingDeclaration {
  mappingVersion: string;
  providerVersionRange: string;
}

/** Declarative metadata for one coding-agent provider. */
export interface AgentProviderContribution {
  id: string;
  displayName: string;
  description?: string;
  icon?: ExtensionIcon;
  platforms?: Array<"darwin" | "linux" | "win32">;
  processMatchers?: AgentProcessMatcher[];
  mappings?: AgentMappingDeclaration[];
  /** Names requested from the exact foreground/descendant process only. */
  requiredEnvironmentVariables?: string[];
  requiredEnvironmentCapabilities: AgentObservationCapability[];
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
    projectEnvironments?: ProjectEnvironmentContribution[];
    agentProviders?: AgentProviderContribution[];
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
  default?: boolean;
}

interface BaseField {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  disabledReason?: string;
  visibleWhen?: VisibilityCondition;
  defaultValue?: JsonPrimitive;
}

export interface TextField extends BaseField {
  type: "text" | "url" | "secret" | "textarea";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  suggestionSource?: string;
  suggestionLabel?: string;
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
  options?: Array<SelectOption & { icon?: ExtensionIcon }>;
  optionSource?: string;
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
  /** Provider-scoped inventory selection, distinct from VM provisioning. */
  browseForm?: DeclarativeForm;
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
  /** The manifest-contributed provider to call, not an extension module path. */
  providerId: string;
  operation: string;
  payload: JsonValue;
}

/** Host-authenticated identity of the extension/provider making a dependency call. */
export interface ProviderDependencyCaller {
  extensionId: string;
  providerId: string;
}

/** Bounded call context propagated unchanged to the target handler. */
export interface ProviderDependencyCallContext {
  /** Absolute ISO-8601 deadline assigned by the host. */
  deadlineAt: string;
  signal: CancellationSignal;
  /** Present for retryable mutations and stable across retries. */
  idempotencyKey?: string;
  /** Optimistic-concurrency revision for mutations of existing target state. */
  expectedRevision?: number;
}

/**
 * A durable opaque reference scoped by the host to this extension installation
 * and this target provider. It is not a vault path or a host-global secret id.
 */
export interface ProviderVaultBinding {
  readonly bindingRef: string;
}

/** Atomically creates or replaces one target-owned vault binding. */
export interface ProviderVaultPutRequest {
  bindingKey: string;
  purpose: string;
  value: Uint8Array;
  idempotencyKey: string;
  expectedRevision?: number;
}

export interface ProviderVaultPutResult {
  binding: ProviderVaultBinding;
  revision: number;
}

export interface ProviderVaultWithSecretRequest {
  binding: ProviderVaultBinding;
  purpose: string;
}

export interface ProviderVaultRemoveRequest {
  binding: ProviderVaultBinding;
  idempotencyKey: string;
  expectedRevision?: number;
}

export interface ProviderVaultRemoveResult {
  state: "deleted" | "pending";
}

/**
 * The target provider's only secret surface. The host inherits the enclosing
 * target callback deadline and cancellation signal for every operation.
 *
 * `withSecret` transfers a transient copy only to the child-side callback.
 * Its callback result is local: it is never sent over vault IPC and may be any
 * value, including a live local object. Hosts zeroize their parent and child
 * copies after use; extensions must not retain, log, present, or return bytes.
 */
export interface ProviderVaultBroker {
  put(request: ProviderVaultPutRequest): Promise<ProviderVaultPutResult>;
  withSecret<T>(request: ProviderVaultWithSecretRequest, use: (copy: Uint8Array) => T | Promise<T>): Promise<T>;
  remove(request: ProviderVaultRemoveRequest): Promise<ProviderVaultRemoveResult>;
}

/**
 * Target-side context. `vault` is runtime-provided and is intentionally the
 * only target-owned broker: target handlers do not receive profiles, secrets,
 * or an SSH agent.
 */
export interface ProviderDependencyTargetContext extends ProviderDependencyCallContext {
  vault: ProviderVaultBroker;
}

/** Request delivered to a target provider after host authorization. */
export interface ProviderDependencyTargetRequest {
  operation: string;
  payload: JsonValue;
  /** Supplied by the host; a target must not trust caller-provided identity. */
  caller: ProviderDependencyCaller;
}

/**
 * Target-side public contract for a provider dependency. The host dispatches
 * only operations declared by the target provider's manifest contribution and
 * only from an extension that declares a compatible dependency.
 */
export interface ProviderDependencyHandler {
  call(request: ProviderDependencyTargetRequest, context: ProviderDependencyTargetContext): Promise<JsonValue>;
}

export interface ProviderDependencyBroker {
  call(request: ProviderDependencyRequest, context: ProviderDependencyCallContext): Promise<JsonValue>;
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
  /** Optional target handler for this provider's manifest-declared dependency operations. */
  dependencyOperations?: ProviderDependencyHandler;
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
  /** Agent observation is available only to manifests granted agent-observation. */
  agents: AgentProviderRegistry;
  /** Host-disposed registrations and observers owned by this activation. */
  subscriptions: ExtensionSubscriptions;
}

export interface TerminayExtension {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

/**
 * Authoring entry: default-export the value returned by `defineExtension`.
 * There is no global Terminay singleton. Every grant arrives on `context`
 * or a callback argument. Node APIs may be used for ordinary work on the
 * Terminay Server account; terminal-scoped evidence must use `observation`.
 */
export function defineExtension(extension: TerminayExtension): TerminayExtension {
  return extension;
}

/** Idempotent registration/observer cleanup supplied by the extension host. */
export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface ExtensionSubscriptions {
  add(subscription: Disposable): Disposable;
}

/** Opaque handles are valid only for the issued terminal observation context. */
export interface AgentTerminalHandle { readonly id: string; readonly __agentTerminalHandle: unique symbol; }
export interface AgentProjectHandle { readonly id: string; readonly __agentProjectHandle: unique symbol; }
export interface AgentEnvironmentHandle { readonly id: string; readonly __agentEnvironmentHandle: unique symbol; }
export interface AgentProcessHandle { readonly id: string; readonly __agentProcessHandle: unique symbol; }
export interface AgentFileHandle { readonly id: string; readonly __agentFileHandle: unique symbol; }
/** An opaque, terminal-scoped directory root. It is only usable for bounded discovery. */
export interface AgentDirectoryHandle { readonly id: string; readonly __agentDirectoryHandle: unique symbol; }

/**
 * A bounded fact about the terminal device. It can be used to derive a
 * provider-specific terminal identifier, but is never accepted as a path or
 * filesystem authority by this API.
 */
export interface AgentTerminalTtyFact {
  deviceId: string;
  deviceName?: string;
}

export interface AgentForegroundProcess {
  executableName: string;
  /** Safe, bounded process arguments supplied only when the environment can prove them. */
  arguments?: readonly string[];
  startedAt?: string;
}

export interface AgentProcessSnapshot {
  handle: AgentProcessHandle;
  executableName: string;
  startedAt?: string;
  cwd?: string;
  /**
   * Host-observed OS pid for this descendant, when the environment can prove
   * it. Providers may join it to a provider-owned live-session registry; it is
   * not a path and does not grant filesystem authority.
   */
  pid?: number;
}

export interface AgentOpenFile {
  handle: AgentFileHandle;
  /** A safe environment-routed display path, never an authority to read a local path. */
  path: string;
  access: "readable" | "writable" | "read-write";
}

export interface AgentFileStat {
  handle: AgentFileHandle;
  kind: "file";
  size: number;
  modifiedAt?: string;
}

export interface AgentCanonicalFileOptions {
  beneath?: { homeRelative: string };
  extension?: string;
  signal?: CancellationSignal;
}

/** Constraints for resolving one known file beneath the environment home. */
export interface AgentHomeRelativeFileOptions {
  beneath?: { homeRelative: string };
  extension?: string;
  signal?: CancellationSignal;
}

/** Closed, serializable form of a home-relative resolution request. */
export interface AgentHomeRelativeFileRequest {
  relativePath: string;
  beneath?: { homeRelative: string };
  extension?: string;
}

/** Constraints for one provider-record path canonicalized beneath an allowed home root. */
export interface AgentPathUnderHomeOptions {
  beneath: { homeRelative: string };
  extension?: string;
  signal?: CancellationSignal;
}

/** Closed, serializable form of a constrained provider-record path request. */
export interface AgentPathUnderHomeRequest {
  providerPath: string;
  beneath: { homeRelative: string };
  extension?: string;
}

/** Constraints for a fact-only normalized path lookup on an opaque file handle. */
export interface AgentHomeRelativePathOptions {
  beneath: { homeRelative: string };
  signal?: CancellationSignal;
}

/** Closed transport shape for a fact-only home-relative path lookup. */
export interface AgentHomeRelativePathRequest {
  handle: AgentFileHandle;
  beneath: { homeRelative: string };
}

/** A regular file discovered below an already-issued opaque directory root. */
export interface AgentDiscoveredFile {
  handle: AgentFileHandle;
  /** A normalized non-escaping fact relative to the opaque root; never authority. */
  relativePath: string;
  size: number;
  modifiedAt?: string;
}

/** Explicit caller limits for a provider's journal discovery. */
export interface AgentDirectoryListOptions {
  /** Only these file suffixes are returned. At least one suffix is required. */
  extensions: readonly string[];
  /** Directory nesting below the opaque root, where zero is the root itself. */
  maxDepth: number;
  maxEntries: number;
  maxBytes: number;
  signal?: CancellationSignal;
}

export interface AgentDirectoryListing {
  entries: readonly AgentDiscoveredFile[];
  /** True when a declared limit stopped the snapshot early. */
  truncated: boolean;
}

/** A host-driven snapshot stream for one opaque directory root. */
export interface AgentDirectoryWatcher extends AsyncIterable<AgentDirectoryListing>, Disposable {}

/** Resolves a provider-known directory under the terminal environment's home. */
export interface AgentHomeRelativeDirectoryOptions {
  beneath?: { homeRelative: string };
  signal?: CancellationSignal;
}

/** Resolves a provider-known directory below one exact terminal environment value. */
export interface AgentEnvironmentRelativeDirectoryOptions {
  environmentVariable: string;
  beneathRelative?: string;
  signal?: CancellationSignal;
}

export interface AgentReadOptions {
  maxBytes: number;
  signal?: CancellationSignal;
}

export interface AgentJsonLineOptions extends AgentReadOptions {
  position: "first" | "last";
}

export interface AgentFileWatchOptions {
  signal?: CancellationSignal;
  /** Maximum bytes delivered per chunk; the host may lower this value. */
  maxChunkBytes?: number;
}

export interface AgentFileWatchChunk {
  type: "append" | "replace" | "truncate";
  bytes: Uint8Array;
}

export interface AgentFileWatcher extends AsyncIterable<AgentFileWatchChunk>, Disposable {}

export interface AgentProcessObservationBroker {
  descendants(options?: { signal?: CancellationSignal }): Promise<AgentProcessSnapshot[]>;
  openFiles(processes: readonly AgentProcessSnapshot[] | readonly AgentProcessHandle[], options: {
    access: "writable" | "readable";
    signal?: CancellationSignal;
  }): Promise<AgentOpenFile[]>;
  /**
   * Reads only manifest-declared, bounded values from the exact terminal's
   * foreground process or descendant. It never exposes the extension host's
   * ambient Node environment.
   */
  environment(names: readonly string[], options?: { signal?: CancellationSignal }): Promise<Record<string, string>>;
}

/** Closed transport form for an environment fact request. */
export interface AgentProcessEnvironmentRequest {
  names: string[];
}

/** Constraints for resolving a known path below one declared process environment value. */
export interface AgentRelativeToEnvironmentOptions {
  environmentVariable: string;
  extension?: string;
  signal?: CancellationSignal;
}

export interface AgentRelativeToEnvironmentRequest {
  relativePath: string;
  environmentVariable: string;
  extension?: string;
}

/** Constraints for canonicalizing provider-record path data below one declared environment value. */
export interface AgentPathUnderEnvironmentOptions {
  environmentVariable: string;
  beneathRelative?: string;
  extension?: string;
  signal?: CancellationSignal;
}

export interface AgentPathUnderEnvironmentRequest {
  providerPath: string;
  environmentVariable: string;
  beneathRelative?: string;
  extension?: string;
}

/** Constraints for a fact-only path lookup below one terminal environment value. */
export interface AgentEnvironmentRelativePathOptions {
  environmentVariable: string;
  beneathRelative?: string;
  signal?: CancellationSignal;
}

export interface AgentEnvironmentRelativePathRequest {
  handle: AgentFileHandle;
  environmentVariable: string;
  beneathRelative?: string;
}

export interface AgentFileObservationBroker {
  /**
   * Issues an opaque root for bounded discovery below the terminal home. A
   * provider cannot turn a returned relative path into read authority.
   */
  resolveHomeDirectory(relativePath: string, options?: AgentHomeRelativeDirectoryOptions): Promise<AgentDirectoryHandle | undefined>;
  /** Issues an opaque root below one declared terminal environment variable. */
  resolveDirectoryRelativeToEnvironment(relativePath: string, options: AgentEnvironmentRelativeDirectoryOptions): Promise<AgentDirectoryHandle | undefined>;
  /** Lists only regular files below an opaque root, subject to all supplied limits. */
  listDirectory(root: AgentDirectoryHandle, options: AgentDirectoryListOptions): Promise<AgentDirectoryListing>;
  /**
   * Follows bounded changes below an opaque root. The first iteration is the
   * current snapshot; later iterations are emitted only after it changes.
   */
  watchDirectory(root: AgentDirectoryHandle, options: AgentDirectoryListOptions): Promise<AgentDirectoryWatcher>;
  /**
   * Resolves a non-escaping path below the value of one declared terminal
   * process environment variable. The host holds the root value internally.
   */
  resolveRelativeToEnvironment(relativePath: string, options: AgentRelativeToEnvironmentOptions): Promise<AgentFileHandle | undefined>;
  /**
   * Canonicalizes provider-record absolute path data only below the value of
   * one declared terminal process environment variable; it is not arbitrary
   * absolute-path access.
   */
  resolvePathUnderEnvironment(providerPath: string, options: AgentPathUnderEnvironmentOptions): Promise<AgentFileHandle | undefined>;
  /**
   * Returns a normalized relative path fact below one declared terminal
   * environment value (and optional contained subdirectory). It grants no
   * read authority: read and follow still require the opaque file handle.
   */
  environmentRelativePath(handle: AgentFileHandle, options: AgentEnvironmentRelativePathOptions): Promise<string | undefined>;
  /**
   * Resolves one known non-escaping path in the selected environment's home.
   * The returned opaque handle is the only authority for subsequent reads or
   * follows; the input path itself never grants local filesystem access.
   */
  resolveHomeRelative(relativePath: string, options?: AgentHomeRelativeFileOptions): Promise<AgentFileHandle | undefined>;
  /**
   * Canonicalizes a provider-record absolute path only beneath the explicit
   * home-relative root. This is not arbitrary absolute-path access.
   */
  resolvePathUnderHome(providerPath: string, options: AgentPathUnderHomeOptions): Promise<AgentFileHandle | undefined>;
  /**
   * Returns a normalized path fact relative to the explicit home-relative
   * constraint for a canonical regular file. The string cannot be passed to
   * read or follow; those methods continue to require the original opaque
   * handle.
   */
  homeRelativePath(handle: AgentFileHandle, options: AgentHomeRelativePathOptions): Promise<string | undefined>;
  canonicalFile(handle: AgentFileHandle, options?: AgentCanonicalFileOptions): Promise<AgentFileHandle | undefined>;
  realpath(handle: AgentFileHandle, options?: { signal?: CancellationSignal }): Promise<AgentFileHandle | undefined>;
  stat(handle: AgentFileHandle, options?: { signal?: CancellationSignal }): Promise<AgentFileStat | undefined>;
  read(handle: AgentFileHandle, options: AgentReadOptions): Promise<Uint8Array>;
  readJson<T = JsonValue>(handle: AgentFileHandle, options: AgentReadOptions): Promise<T | undefined>;
  readJsonLine<T = JsonValue>(handle: AgentFileHandle, options: AgentJsonLineOptions): Promise<T | undefined>;
  follow(handle: AgentFileHandle, options?: AgentFileWatchOptions): Promise<AgentFileWatcher>;
}

/** All observation operations are terminal-scoped and environment-routed. */
export interface AgentObservationBroker {
  processes: AgentProcessObservationBroker;
  files: AgentFileObservationBroker;
}

export interface AgentBindingFingerprint {
  kind: string;
  /** Only scoped process/file handles and bounded primitive metadata are allowed. */
  process?: AgentProcessHandle;
  file?: AgentFileHandle;
  metadata?: Record<string, JsonPrimitive>;
}

export interface AgentSessionBindingRequest {
  providerSessionId: string;
  mappingVersion: string;
  journal?: AgentFileHandle;
  fingerprint: AgentBindingFingerprint;
  metadata?: Record<string, JsonPrimitive>;
}

/** Host-validated session identity, opaque outside its issuing terminal context. */
export interface AgentSessionBinding {
  readonly providerSessionId: string;
  readonly mappingVersion: string;
  readonly journal?: AgentFileHandle;
  readonly __agentSessionBinding: unique symbol;
}

export type AgentUnavailableReason =
  | "environment-capability-missing"
  | "process-not-recognized"
  | "session-not-found"
  | "session-not-bound"
  | "unsupported-provider-version"
  | "malformed-observation"
  | "observation-limit-exceeded"
  | "cancelled";

export interface AgentObservationDiagnostic {
  reason: AgentUnavailableReason;
  /** Safe display text only; it must not contain paths, prompts, credentials, or raw records. */
  message?: string;
}

export type AgentObservationResult =
  | AgentJsonlSession
  | { state: "not-bound" }
  | { state: "unavailable"; reason: AgentUnavailableReason };

export interface AgentTerminalContext {
  terminal: AgentTerminalHandle;
  project: AgentProjectHandle;
  environment: AgentEnvironmentHandle;
  process: AgentProcessHandle;
  foreground: AgentForegroundProcess;
  /** Present only when the environment can prove the registered PTY's TTY. */
  tty?: AgentTerminalTtyFact;
  capabilities: ReadonlySet<AgentObservationCapability>;
  observation: AgentObservationBroker;
  signal: CancellationSignal;
  bindSession(request: AgentSessionBindingRequest): Promise<AgentSessionBinding>;
}

export interface AgentModelMetadata {
  id: string;
  displayName?: string;
  reasoningEffort?: string;
  contextWindowTokens?: number;
}

export type AgentCompletionOutcome = "success" | "error" | "cancelled";
export type AgentWaitState = "waiting" | "blocked";

export type AgentLifecycleEvent =
  | { kind: "session.started"; title?: string; promptText?: string; model?: AgentModelMetadata; occurredAt?: string }
  | { kind: "agent.metadata"; agentId?: string; title?: string; promptText?: string; model?: AgentModelMetadata; occurredAt?: string }
  | { kind: "turn.started"; agentId?: string; turnId: string; promptText?: string; occurredAt?: string }
  | { kind: "tool.started"; agentId?: string; toolId: string; name: string; description?: string; occurredAt?: string }
  | { kind: "tool.finished"; agentId?: string; toolId: string; outcome?: AgentCompletionOutcome; occurredAt?: string }
  | { kind: "wait.started"; agentId?: string; waitId: string; state: AgentWaitState; reason?: string; occurredAt?: string }
  | { kind: "wait.finished"; agentId?: string; waitId: string; occurredAt?: string }
  | { kind: "agent.done"; agentId?: string; outcome: AgentCompletionOutcome; summary?: string; occurredAt?: string }
  | { kind: "agent.exited"; agentId?: string; exitCode?: number; signal?: string; occurredAt?: string }
  | { kind: "session.stopped"; reason?: string; occurredAt?: string }
  | { kind: "subagent.started"; subagentId: string; parentAgentId?: string; title?: string; promptText?: string; model?: AgentModelMetadata; occurredAt?: string }
  | { kind: "subagent.done"; subagentId: string; outcome: AgentCompletionOutcome; summary?: string; occurredAt?: string };

export interface AgentLifecyclePublisher {
  sessionStarted(event: Omit<Extract<AgentLifecycleEvent, { kind: "session.started" }>, "kind">): void | Promise<void>;
  metadataChanged(event: Omit<Extract<AgentLifecycleEvent, { kind: "agent.metadata" }>, "kind">): void | Promise<void>;
  turnStarted(event: Omit<Extract<AgentLifecycleEvent, { kind: "turn.started" }>, "kind">): void | Promise<void>;
  toolStarted(event: Omit<Extract<AgentLifecycleEvent, { kind: "tool.started" }>, "kind">): void | Promise<void>;
  toolFinished(event: Omit<Extract<AgentLifecycleEvent, { kind: "tool.finished" }>, "kind">): void | Promise<void>;
  waitStarted(event: Omit<Extract<AgentLifecycleEvent, { kind: "wait.started" }>, "kind">): void | Promise<void>;
  waitFinished(event: Omit<Extract<AgentLifecycleEvent, { kind: "wait.finished" }>, "kind">): void | Promise<void>;
  done(event: Omit<Extract<AgentLifecycleEvent, { kind: "agent.done" }>, "kind">): void | Promise<void>;
  exited(event: Omit<Extract<AgentLifecycleEvent, { kind: "agent.exited" }>, "kind">): void | Promise<void>;
  sessionStopped(event: Omit<Extract<AgentLifecycleEvent, { kind: "session.stopped" }>, "kind">): void | Promise<void>;
  subagentStarted(event: Omit<Extract<AgentLifecycleEvent, { kind: "subagent.started" }>, "kind">): void | Promise<void>;
  subagentDone(event: Omit<Extract<AgentLifecycleEvent, { kind: "subagent.done" }>, "kind">): void | Promise<void>;
}

export interface AgentRecordContext {
  binding: AgentSessionBinding;
  /** Identifies which journal under this one root binding produced the record. */
  journal: { role: "root" } | { role: "child"; childId: string };
  publish: AgentLifecyclePublisher;
  signal: CancellationSignal;
}

/**
 * A provider-native child journal. It is attached to the existing root
 * binding and must carry a stable child id; it cannot create another root.
 */
export interface AgentChildJournalSource {
  childId: string;
  journal: AgentFileHandle;
  source: AgentFileWatcher | Promise<AgentFileWatcher>;
}

/** A host-driven JSONL observer declaration. The host owns replay limits and flow control. */
export interface AgentJsonlSession {
  state: "bound";
  binding: AgentSessionBinding;
  source: AgentFileWatcher | Promise<AgentFileWatcher>;
  childSources?: readonly AgentChildJournalSource[];
  /** New provider-native children discovered after root observation begins. */
  childSourceDiscovery?: AsyncIterable<AgentChildJournalSource> | Promise<AsyncIterable<AgentChildJournalSource>>;
  mapRecord(record: unknown, session: AgentRecordContext): void | Promise<void>;
}

export interface AgentJsonlSessionOptions {
  binding: AgentSessionBinding;
  source: AgentFileWatcher | Promise<AgentFileWatcher>;
  childSources?: readonly AgentChildJournalSource[];
  childSourceDiscovery?: AsyncIterable<AgentChildJournalSource> | Promise<AsyncIterable<AgentChildJournalSource>>;
  mapRecord(record: unknown, session: AgentRecordContext): void | Promise<void>;
}

export interface AgentProviderDefinition {
  mappingVersion: string;
  matchesForeground(process: AgentForegroundProcess): boolean;
  observe(terminal: AgentTerminalContext): Promise<AgentObservationResult>;
}

export type AgentProviderRuntime = AgentProviderDefinition;

export interface AgentProviderRegistration extends Disposable {
  readonly providerId: string;
}

export interface AgentProviderRegistry {
  registerProvider(providerId: string, runtime: AgentProviderRuntime): AgentProviderRegistration;
}

export function defineAgentProvider(provider: AgentProviderDefinition): AgentProviderDefinition {
  return provider;
}
