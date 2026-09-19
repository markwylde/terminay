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
	| 'agent-observation'
	| 'mcp-registration';

export interface ExtensionDependency {
	extensionId: string;
	apiRange: string;
	optional?: boolean;
}

export type ExtensionPlatform = 'darwin' | 'linux' | 'win32';

/** One coding-agent harness a session source can report, e.g. Claude Code. */
export interface AgentSessionHarnessDeclaration {
	/** Stable, source-local, kebab-case, e.g. `claude-code`. */
	id: string;
	displayName: string;
}

/**
 * Declarative metadata for one machine-wide agent session source. The source
 * reports live sessions on the server's machine; the host decides which
 * project each belongs to and which terminal, if any, it binds to.
 */
export interface AgentSessionSourceContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	displayName: string;
	description?: string;
	platforms?: ExtensionPlatform[];
	harnesses: AgentSessionHarnessDeclaration[];
	/**
	 * Server environment variable names the source needs, such as a harness's
	 * home-directory override. The host passes each one to the extension child
	 * when it is set on the server.
	 */
	environmentVariables?: string[];
}

/** Declarative metadata for one client the Terminay MCP server can be registered with. */
export interface McpInstallTargetContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	/** The client's name as the install surface shows it, e.g. `Claude Code`. */
	displayName: string;
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
	platforms?: ExtensionPlatform[];
	permissions: ExtensionPermission[];
	extensionDependencies?: ExtensionDependency[];
	contributes: {
		agentSessionSources?: AgentSessionSourceContribution[];
		mcpInstallTargets?: McpInstallTargetContribution[];
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
	/** Session sources are available only to manifests granted agent-observation. */
	agents: AgentSessionSourceRegistry;
	/** MCP install targets are available only to manifests granted mcp-registration. */
	mcp: McpInstallTargetRegistry;
	/** Host-disposed registrations and observers owned by this activation. */
	subscriptions: ExtensionSubscriptions;
	/**
	 * Registers a language server this manifest contributed. An undeclared id,
	 * or a second registration of the same id, is refused.
	 */
	registerLanguageServerProvider(
		registration: LanguageServerRegistration,
	): void;
}

export interface TerminayExtension {
	activate(context: ExtensionContext): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

/**
 * Authoring entry: default-export the value returned by `defineExtension`.
 * There is no global Terminay singleton. Every grant arrives on `context`
 * or a callback argument. Node APIs may be used for ordinary work on the
 * Terminay Server account. The host, never an extension, decides which
 * terminal a reported session belongs to.
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

export type AgentSessionStatus = 'running' | 'waiting' | 'blocked' | 'idle';
export type AgentSessionTurnOutcome = 'completed' | 'failed' | 'interrupted';
export type AgentSubagentStatus =
	| 'running'
	| 'completed'
	| 'failed'
	| 'cancelled';

/** One subagent a session launched. Ids are stable within the session. */
export interface AgentSubagentSnapshot {
	id: string;
	/** Another subagent of the same session, for nested subagents. */
	parentId?: string;
	type: string;
	title?: string;
	status: AgentSubagentStatus;
}

/**
 * Bounded facts about one live session. Only these fields cross to the host:
 * transcripts, prompts beyond the title, tool arguments, and raw records never
 * do. Times are epoch milliseconds.
 */
export interface AgentSessionSnapshot {
	/** Source-scoped and stable for the conversation. */
	id: string;
	/** A harness id the source declared and that is switched on. */
	harness: string;
	/** The live process holding the session. */
	pid: number;
	/** Absolute working directory of the session. */
	cwd: string;
	title?: string;
	model?: string;
	status?: AgentSessionStatus;
	/** What a `waiting` or `blocked` session waits for, e.g. a tool approval. */
	waitingFor?: string;
	/** Name of the tool currently running. */
	tool?: string;
	lastTurn?: AgentSessionTurnOutcome;
	lastTurnEndedAt?: number;
	/** Bounded, redacted message for a failed turn. */
	error?: string;
	subagents?: AgentSubagentSnapshot[];
}

/**
 * A typed, bounded diagnostic. It must carry no paths or conversation
 * content. `code` is kebab-case, e.g. `provider-error`.
 */
export interface AgentSessionSourceDiagnostic {
	code: string;
	message: string;
}

/**
 * Publishes a source's live sessions. A `reset` replaces every session the
 * source reported before; `upsert` replaces one session by id; `remove`
 * forgets one. Calls take effect in order. After the start signal aborts,
 * every call is ignored.
 */
export interface AgentSessionPublisher {
	reset(sessions: readonly AgentSessionSnapshot[]): void;
	upsert(session: AgentSessionSnapshot): void;
	remove(sessionId: string): void;
	diagnostic(diagnostic: AgentSessionSourceDiagnostic): void;
}

export interface AgentSessionSourceStart {
	/** Declared harness ids currently switched on. */
	enabledHarnesses: readonly string[];
	publisher: AgentSessionPublisher;
	/**
	 * Aborts when the source is disposed, the extension is disabled, or agent
	 * status is switched off. The source must then release every watch.
	 */
	signal: AbortSignal;
	/**
	 * Called with the new enabled set whenever the user switches a harness. The
	 * source must stop reporting a harness switched off and report the live
	 * sessions of a harness switched on.
	 */
	onEnabledHarnessesChanged(
		listener: (enabledHarnesses: readonly string[]) => void,
	): Disposable;
}

export interface AgentSessionSourceRuntime {
	/**
	 * Starts watching. Resolves once the source is running; it keeps publishing
	 * until `signal` aborts.
	 */
	start(start: AgentSessionSourceStart): void | Promise<void>;
}

export interface AgentSessionSourceRegistration extends Disposable {
	readonly sourceId: string;
}

export interface AgentSessionSourceRegistry {
	/**
	 * Registers a session source this manifest contributed. An undeclared id,
	 * a second registration of the same id, or a registration after
	 * deactivation is refused.
	 */
	registerSessionSource(
		sourceId: string,
		runtime: AgentSessionSourceRuntime,
	): AgentSessionSourceRegistration;
}

export function defineSessionSource(
	runtime: AgentSessionSourceRuntime,
): AgentSessionSourceRuntime {
	return runtime;
}

/**
 * The host-supplied launch command for the Terminay MCP server. A target
 * writes exactly this into its client's configuration and nothing else.
 */
export interface McpServerCommand {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export type McpInstallTargetState =
	| 'not-installed'
	| 'installed'
	| 'changed'
	| 'unavailable'
	| 'error';

export interface McpInstallTargetStatus {
	state: McpInstallTargetState;
	/** The provider-owned configuration file the target inspects. */
	configPath: string;
	/** Bounded, redacted detail, e.g. why the registration differs. */
	message?: string;
}

export interface McpInstallTargetActionResult {
	ok: boolean;
	installed: boolean;
	message?: string;
	error?: string;
}

export interface McpInstallTargetRequest {
	server: McpServerCommand;
	/** Aborts on the call's deadline or when the target is disposed. */
	signal: AbortSignal;
}

export interface McpInstallTargetRuntime {
	status(request: McpInstallTargetRequest): Promise<McpInstallTargetStatus>;
	install(
		request: McpInstallTargetRequest,
	): Promise<McpInstallTargetActionResult>;
	uninstall(
		request: McpInstallTargetRequest,
	): Promise<McpInstallTargetActionResult>;
}

export interface McpInstallTargetRegistration extends Disposable {
	readonly targetId: string;
}

export interface McpInstallTargetRegistry {
	/**
	 * Registers an MCP install target this manifest contributed. An undeclared
	 * or duplicate id is refused.
	 */
	registerInstallTarget(
		targetId: string,
		runtime: McpInstallTargetRuntime,
	): McpInstallTargetRegistration;
}

export function defineMcpInstallTarget(
	runtime: McpInstallTargetRuntime,
): McpInstallTargetRuntime {
	return runtime;
}
