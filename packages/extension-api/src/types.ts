export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

export type ExtensionPermission =
	| 'configuration:read'
	| 'configuration:write'
	| 'data:read'
	| 'data:write'
	| 'cache:write'
	| 'network'
	| 'secrets:resolve'
	| 'agent-observation';

export interface ExtensionDependency {
	extensionId: string;
	apiRange: string;
	optional?: boolean;
}

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
	platforms?: Array<'darwin' | 'linux' | 'win32'>;
	processMatchers?: AgentProcessMatcher[];
	mappings?: AgentMappingDeclaration[];
	/** Names requested from the exact foreground/descendant process only. */
	requiredEnvironmentVariables?: string[];
}

/**
 * Declarative metadata for one language server. The extension declares which
 * languages and files it serves; the host owns spawning the server, stdio
 * framing, LSP initialise, lifecycle, deadlines, and translation into core's
 * bounded DTOs.
 */
export interface LanguageServerContribution {
	/** Stable, extension-local, kebab-case, e.g. `typescript`. */
	id: string;
	displayName: string;
	description?: string;
	/** Language ids served, e.g. `typescript`, `javascriptreact`. */
	languageIds: string[];
	/** Lower-case file extensions including the leading dot, e.g. `.tsx`. */
	fileExtensions: string[];
	/** Shown in Settings, e.g. "Uses the project's TypeScript when installed". */
	runtimeNotes?: string;
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
	platforms?: Array<'darwin' | 'linux' | 'win32'>;
	permissions: ExtensionPermission[];
	extensionDependencies?: ExtensionDependency[];
	contributes: {
		agentProviders?: AgentProviderContribution[];
		languageServers?: LanguageServerContribution[];
	};
}

export type ExtensionIcon =
	| 'terminal'
	| 'server'
	| 'cloud'
	| 'key'
	| 'folder'
	| 'network'
	| 'database'
	| 'warning'
	| 'info';

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
	withValue<T>(
		request: ProviderSecretRequest,
		use: (bytes: Uint8Array) => T | Promise<T>,
	): Promise<T>;
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
	state: 'deleted' | 'pending';
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
	withSecret<T>(
		request: ProviderVaultWithSecretRequest,
		use: (copy: Uint8Array) => T | Promise<T>,
	): Promise<T>;
	remove(
		request: ProviderVaultRemoveRequest,
	): Promise<ProviderVaultRemoveResult>;
}

export interface CancellationSignal {
	readonly aborted: boolean;
	throwIfAborted(): void;
}

/** What the host asks the extension to launch: one project, on this server. */
export interface LanguageServerLaunchRequest {
	languageServerId: string;
	/** Absolute path on the server. The host decides cwd; the extension may read it. */
	projectRoot: string;
}

/** How to start one language server. The host spawns and owns the process. */
export interface LanguageServerLaunch {
	/** An absolute path, or an executable the host can resolve on PATH. */
	command: string;
	args: string[];
	/** Overlaid on a minimal host environment, never inherited wholesale. */
	env?: Record<string, string>;
	initializationOptions?: JsonValue;
	/** Bounded, safe detail for Settings, e.g. "project typescript 5.6.2". */
	description?: string;
}

export interface LanguageServerProviderRuntime {
	launch(
		request: LanguageServerLaunchRequest,
		signal: AbortSignal,
	): Promise<LanguageServerLaunch>;
}

export interface LanguageServerRegistration {
	id: string;
	runtime: LanguageServerProviderRuntime;
}

export interface ExtensionContext {
	extensionId: string;
	apiVersion: string;
	paths: { configuration: string; data: string; cache: string };
	/** Agent observation is available only to manifests granted agent-observation. */
	agents: AgentProviderRegistry;
	/** Host-disposed registrations and observers owned by this activation. */
	subscriptions: ExtensionSubscriptions;
	/**
	 * Registers a language server this manifest contributed. An undeclared id,
	 * or a second registration of the same id, is refused.
	 */
	registerLanguageServerProvider(registration: LanguageServerRegistration): void;
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
export function defineExtension(
	extension: TerminayExtension,
): TerminayExtension {
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
export interface AgentTerminalHandle {
	readonly id: string;
	readonly __agentTerminalHandle: unique symbol;
}
export interface AgentProjectHandle {
	readonly id: string;
	readonly __agentProjectHandle: unique symbol;
}
export interface AgentEnvironmentHandle {
	readonly id: string;
	readonly __agentEnvironmentHandle: unique symbol;
}
export interface AgentProcessHandle {
	readonly id: string;
	readonly __agentProcessHandle: unique symbol;
}
export interface AgentFileHandle {
	readonly id: string;
	readonly __agentFileHandle: unique symbol;
}
/** An opaque, terminal-scoped directory root. It is only usable for bounded discovery. */
export interface AgentDirectoryHandle {
	readonly id: string;
	readonly __agentDirectoryHandle: unique symbol;
}

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
	/**
	 * The process's own command line after its executable, bounded, when the
	 * environment can read it. It is per-process evidence: a session id or a
	 * resume flag on it belongs to exactly this process.
	 */
	arguments?: readonly string[];
}

export interface AgentOpenFile {
	handle: AgentFileHandle;
	/** A safe display path, never an authority to read a local path. */
	path: string;
	access: 'readable' | 'writable' | 'read-write';
}

export interface AgentFileStat {
	handle: AgentFileHandle;
	kind: 'file';
	size: number;
	modifiedAt?: string;
	/** File creation time where the environment can prove one. */
	createdAt?: string;
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
	/**
	 * File creation time, where the environment can prove one. Providers compare
	 * it against a descendant process `startedAt` to admit a journal the provider
	 * wrote for that process. It is provider-documented association, not a
	 * nearest-file heuristic: `modifiedAt` remains unusable for selection.
	 */
	createdAt?: string;
}

/** Explicit caller limits for a provider's journal discovery. */
export interface AgentDirectoryListOptions {
	/** Only these file suffixes are returned. At least one suffix is required. */
	extensions: readonly string[];
	/**
	 * Only files with exactly these names are considered, and only they are
	 * charged against the limits below.
	 *
	 * A caller that already knows the filename it wants — a provider resolving
	 * one session's journal, say — would otherwise spend its whole byte budget
	 * on unrelated files and be truncated before reaching the one file it asked
	 * for. Declaring the name keeps the walk bounded by what was actually
	 * requested rather than by everything that happens to share the directory.
	 * Each entry is one path segment; omit the field to return every match.
	 */
	names?: readonly string[];
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
export interface AgentDirectoryWatcher
	extends AsyncIterable<AgentDirectoryListing>,
		Disposable {}

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
	position: 'first' | 'last';
}

export interface AgentFileWatchOptions {
	signal?: CancellationSignal;
	/** Maximum bytes delivered per chunk; the host may lower this value. */
	maxChunkBytes?: number;
}

export interface AgentFileWatchChunk {
	type: 'append' | 'replace' | 'truncate';
	bytes: Uint8Array;
}

export interface AgentFileWatcher
	extends AsyncIterable<AgentFileWatchChunk>,
		Disposable {}

export interface AgentProcessObservationBroker {
	descendants(options?: {
		signal?: CancellationSignal;
	}): Promise<AgentProcessSnapshot[]>;
	openFiles(
		processes: readonly AgentProcessSnapshot[] | readonly AgentProcessHandle[],
		options: {
			access: 'writable' | 'readable';
			signal?: CancellationSignal;
		},
	): Promise<AgentOpenFile[]>;
	/**
	 * Reads only manifest-declared, bounded values from the exact terminal's
	 * foreground process or descendant. It never exposes the extension host's
	 * ambient Node environment.
	 */
	environment(
		names: readonly string[],
		options?: { signal?: CancellationSignal },
	): Promise<Record<string, string>>;
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
	resolveHomeDirectory(
		relativePath: string,
		options?: AgentHomeRelativeDirectoryOptions,
	): Promise<AgentDirectoryHandle | undefined>;
	/** Issues an opaque root below one declared terminal environment variable. */
	resolveDirectoryRelativeToEnvironment(
		relativePath: string,
		options: AgentEnvironmentRelativeDirectoryOptions,
	): Promise<AgentDirectoryHandle | undefined>;
	/** Lists only regular files below an opaque root, subject to all supplied limits. */
	listDirectory(
		root: AgentDirectoryHandle,
		options: AgentDirectoryListOptions,
	): Promise<AgentDirectoryListing>;
	/**
	 * Follows bounded changes below an opaque root. The first iteration is the
	 * current snapshot; later iterations are emitted only after it changes.
	 */
	watchDirectory(
		root: AgentDirectoryHandle,
		options: AgentDirectoryListOptions,
	): Promise<AgentDirectoryWatcher>;
	/**
	 * Resolves a non-escaping path below the value of one declared terminal
	 * process environment variable. The host holds the root value internally.
	 */
	resolveRelativeToEnvironment(
		relativePath: string,
		options: AgentRelativeToEnvironmentOptions,
	): Promise<AgentFileHandle | undefined>;
	/**
	 * Canonicalizes provider-record absolute path data only below the value of
	 * one declared terminal process environment variable; it is not arbitrary
	 * absolute-path access.
	 */
	resolvePathUnderEnvironment(
		providerPath: string,
		options: AgentPathUnderEnvironmentOptions,
	): Promise<AgentFileHandle | undefined>;
	/**
	 * Returns a normalized relative path fact below one declared terminal
	 * environment value (and optional contained subdirectory). It grants no
	 * read authority: read and follow still require the opaque file handle.
	 */
	environmentRelativePath(
		handle: AgentFileHandle,
		options: AgentEnvironmentRelativePathOptions,
	): Promise<string | undefined>;
	/**
	 * Resolves one known non-escaping path in the selected environment's home.
	 * The returned opaque handle is the only authority for subsequent reads or
	 * follows; the input path itself never grants local filesystem access.
	 */
	resolveHomeRelative(
		relativePath: string,
		options?: AgentHomeRelativeFileOptions,
	): Promise<AgentFileHandle | undefined>;
	/**
	 * Canonicalizes a provider-record absolute path only beneath the explicit
	 * home-relative root. This is not arbitrary absolute-path access.
	 */
	resolvePathUnderHome(
		providerPath: string,
		options: AgentPathUnderHomeOptions,
	): Promise<AgentFileHandle | undefined>;
	/**
	 * Returns a normalized path fact relative to the explicit home-relative
	 * constraint for a canonical regular file. The string cannot be passed to
	 * read or follow; those methods continue to require the original opaque
	 * handle.
	 */
	homeRelativePath(
		handle: AgentFileHandle,
		options: AgentHomeRelativePathOptions,
	): Promise<string | undefined>;
	canonicalFile(
		handle: AgentFileHandle,
		options?: AgentCanonicalFileOptions,
	): Promise<AgentFileHandle | undefined>;
	realpath(
		handle: AgentFileHandle,
		options?: { signal?: CancellationSignal },
	): Promise<AgentFileHandle | undefined>;
	stat(
		handle: AgentFileHandle,
		options?: { signal?: CancellationSignal },
	): Promise<AgentFileStat | undefined>;
	read(handle: AgentFileHandle, options: AgentReadOptions): Promise<Uint8Array>;
	readJson<T = JsonValue>(
		handle: AgentFileHandle,
		options: AgentReadOptions,
	): Promise<T | undefined>;
	readJsonLine<T = JsonValue>(
		handle: AgentFileHandle,
		options: AgentJsonLineOptions,
	): Promise<T | undefined>;
	follow(
		handle: AgentFileHandle,
		options?: AgentFileWatchOptions,
	): Promise<AgentFileWatcher>;
}

/** All observation operations are terminal-scoped and run on the server host. */
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
	| 'process-not-recognized'
	| 'session-not-found'
	| 'session-not-bound'
	| 'unsupported-provider-version'
	| 'malformed-observation'
	| 'observation-limit-exceeded'
	| 'cancelled';

export interface AgentObservationDiagnostic {
	reason: AgentUnavailableReason;
	/** Safe display text only; it must not contain paths, prompts, credentials, or raw records. */
	message?: string;
}

export type AgentObservationResult =
	| AgentJsonlSession
	| { state: 'not-bound' }
	| { state: 'unavailable'; reason: AgentUnavailableReason };

export interface AgentTerminalContext {
	terminal: AgentTerminalHandle;
	project: AgentProjectHandle;
	environment: AgentEnvironmentHandle;
	process: AgentProcessHandle;
	foreground: AgentForegroundProcess;
	/** Present only when the environment can prove the registered PTY's TTY. */
	tty?: AgentTerminalTtyFact;
	observation: AgentObservationBroker;
	signal: CancellationSignal;
	bindSession(
		request: AgentSessionBindingRequest,
	): Promise<AgentSessionBinding>;
}

export interface AgentModelMetadata {
	id: string;
	displayName?: string;
	reasoningEffort?: string;
	contextWindowTokens?: number;
}

export type AgentCompletionOutcome = 'success' | 'error' | 'cancelled';
export type AgentWaitState = 'waiting' | 'blocked';

export type AgentLifecycleEvent =
	| {
			kind: 'session.started';
			title?: string;
			promptText?: string;
			model?: AgentModelMetadata;
			occurredAt?: string;
	  }
	| {
			kind: 'agent.metadata';
			agentId?: string;
			title?: string;
			promptText?: string;
			model?: AgentModelMetadata;
			occurredAt?: string;
	  }
	| {
			kind: 'turn.started';
			agentId?: string;
			turnId: string;
			promptText?: string;
			occurredAt?: string;
	  }
	| {
			kind: 'tool.started';
			agentId?: string;
			toolId: string;
			name: string;
			description?: string;
			occurredAt?: string;
	  }
	| {
			kind: 'tool.finished';
			agentId?: string;
			toolId: string;
			outcome?: AgentCompletionOutcome;
			occurredAt?: string;
	  }
	| {
			kind: 'wait.started';
			agentId?: string;
			waitId: string;
			state: AgentWaitState;
			reason?: string;
			/**
			 * True when the state was derived from the provider's journal rather
			 * than read from an explicit record. Surfaces may label it; it never
			 * changes how the state itself is reduced.
			 */
			inferred?: boolean;
			occurredAt?: string;
	  }
	| {
			kind: 'wait.finished';
			agentId?: string;
			waitId: string;
			occurredAt?: string;
	  }
	| {
			kind: 'agent.done';
			agentId?: string;
			outcome: AgentCompletionOutcome;
			summary?: string;
			occurredAt?: string;
	  }
	| {
			kind: 'agent.exited';
			agentId?: string;
			exitCode?: number;
			signal?: string;
			occurredAt?: string;
	  }
	| { kind: 'session.stopped'; reason?: string; occurredAt?: string }
	| {
			kind: 'subagent.started';
			subagentId: string;
			parentAgentId?: string;
			title?: string;
			promptText?: string;
			model?: AgentModelMetadata;
			occurredAt?: string;
	  }
	| {
			kind: 'subagent.done';
			subagentId: string;
			outcome: AgentCompletionOutcome;
			summary?: string;
			occurredAt?: string;
	  };

export interface AgentLifecyclePublisher {
	sessionStarted(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'session.started' }>,
			'kind'
		>,
	): void | Promise<void>;
	metadataChanged(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'agent.metadata' }>,
			'kind'
		>,
	): void | Promise<void>;
	turnStarted(
		event: Omit<Extract<AgentLifecycleEvent, { kind: 'turn.started' }>, 'kind'>,
	): void | Promise<void>;
	toolStarted(
		event: Omit<Extract<AgentLifecycleEvent, { kind: 'tool.started' }>, 'kind'>,
	): void | Promise<void>;
	toolFinished(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'tool.finished' }>,
			'kind'
		>,
	): void | Promise<void>;
	waitStarted(
		event: Omit<Extract<AgentLifecycleEvent, { kind: 'wait.started' }>, 'kind'>,
	): void | Promise<void>;
	waitFinished(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'wait.finished' }>,
			'kind'
		>,
	): void | Promise<void>;
	done(
		event: Omit<Extract<AgentLifecycleEvent, { kind: 'agent.done' }>, 'kind'>,
	): void | Promise<void>;
	exited(
		event: Omit<Extract<AgentLifecycleEvent, { kind: 'agent.exited' }>, 'kind'>,
	): void | Promise<void>;
	sessionStopped(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'session.stopped' }>,
			'kind'
		>,
	): void | Promise<void>;
	subagentStarted(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'subagent.started' }>,
			'kind'
		>,
	): void | Promise<void>;
	subagentDone(
		event: Omit<
			Extract<AgentLifecycleEvent, { kind: 'subagent.done' }>,
			'kind'
		>,
	): void | Promise<void>;
}

export interface AgentRecordContext {
	binding: AgentSessionBinding;
	/** Identifies which journal under this one root binding produced the record. */
	journal: { role: 'root' } | { role: 'child'; childId: string };
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
	state: 'bound';
	binding: AgentSessionBinding;
	source: AgentFileWatcher | Promise<AgentFileWatcher>;
	childSources?: readonly AgentChildJournalSource[];
	/** New provider-native children discovered after root observation begins. */
	childSourceDiscovery?:
		| AsyncIterable<AgentChildJournalSource>
		| Promise<AsyncIterable<AgentChildJournalSource>>;
	mapRecord(record: unknown, session: AgentRecordContext): void | Promise<void>;
}

export interface AgentJsonlSessionOptions {
	binding: AgentSessionBinding;
	source: AgentFileWatcher | Promise<AgentFileWatcher>;
	childSources?: readonly AgentChildJournalSource[];
	childSourceDiscovery?:
		| AsyncIterable<AgentChildJournalSource>
		| Promise<AsyncIterable<AgentChildJournalSource>>;
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
	registerProvider(
		providerId: string,
		runtime: AgentProviderRuntime,
	): AgentProviderRegistration;
}

export function defineAgentProvider(
	provider: AgentProviderDefinition,
): AgentProviderDefinition {
	return provider;
}
