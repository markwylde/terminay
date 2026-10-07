import { nodeTerminalLaunchPathAuthority } from './terminalService/launchResolver.js';
import {
	FEATURE_CAPABILITIES,
	LANGUAGE_CAPABILITY,
	type JsonValue,
	protocolError,
} from '@terminay/protocol';
import {
	type AgentOperationRegistry,
	createAgentEventProjector,
	createAgentOperationRegistry,
} from './activity/agentProtocol.js';
import { AgentStatusService } from './activity/agentService.js';
import { createAgentInactivityHold } from './activity/inactivityHold.js';
import type { ProjectAgentScope } from './activity/projectAgentScope.js';
import type { SessionSourceBridge } from './activity/sessionSourceBridge.js';
import type { SessionSourceSupervisor } from './extensions/sessionSources.js';
import {
	type ActivityOperationRegistry,
	createActivityEventProjector,
	createActivityOperationRegistry,
} from './activity/protocol.js';
import type { TerminalActivityService } from './activity/service.js';
import {
	type AiService,
	createAiOperationHandlers,
} from './aiService/index.js';
import { createServerCore, type ServerCore } from './connection.js';
import { OrderedEventJournal } from './events.js';
import {
	createExtensionOperationHandlers,
	type ExtensionOperationOptions,
} from './extensions/index.js';
import {
	createFileObservationEventProjector,
	type ServerFileObservationAdapter,
} from './fileService/observationAdapter.js';
import type { ServerGitAdapter } from './gitService/adapter.js';
import {
	type LanguageAdapterOptions,
	ServerLanguageAdapter,
} from './languageService/adapter.js';
import {
	type LanguageExtensionBridge,
	LanguageSessionManager,
} from './languageService/sessions.js';
import type { MacroRepository, MacroRunner } from './macroService/index.js';
// --- automations (home-sidebar-and-automations, task 4.4) ---
import {
	type AutomationOperationRegistry,
	createAutomationOperationRegistry,
	unavailableAutomationRunController,
} from './automationService/protocol.js';
import {
	type AutomationMcpOperations,
	createAutomationMcpOperations,
} from './automationService/mcp.js';
import {
	DEFAULT_MCP_PERMISSIONS,
	McpApprovalService,
	mcpPermissionsFromSettings,
} from './mcpApprovals/index.js';
import {
	type AppWindowAttachment,
	AppWindowService,
	type AppWindowView,
} from './appWindows/index.js';
import {
	type ConnectedServerBackend,
	ConnectedServerRegistry,
	type ConnectedServerVault,
} from './connectedServers/index.js';
import { commandSubmissionInput } from './terminalService/commandSubmission.js';
import type { AutomationRepository } from './automationService/repository.js';
import type { AutomationRunLog } from './automationService/runLog.js';
import type { AutomationRunController } from './automationService/types.js';
// --- automations: executor and audit (tasks 7.1-7.5) ---
import {
	AutomationAuditLog,
	type AutomationAuditEntry,
} from './automationService/audit.js';
import { AutomationExecutor } from './automationService/executor.js';
// --- end automations: executor and audit ---
// --- automations: scheduler and triggers (tasks 6.1-6.4) ---
import { localTimeZone } from '@terminay/cron';
import { AutomationScheduler } from './automationService/scheduler.js';
import { AutomationTriggers } from './automationService/triggers.js';
import type { RemoteConnectionAdmission } from './remote/transport.js';
import { projectLifecycleEventProjector } from './workspaceProtocol.js';
// --- end automations ---
import {
	createMacroOperationRegistry,
	type MacroOperationRegistry,
} from './macroService/protocol.js';
import type {
	MacroExecutionEnvironment,
	MacroTarget,
} from './macroService/types.js';
import type { RecordingAdapter } from './recordingService/adapter.js';
import {
	createSettingsOperationRegistry,
	type SettingsOperationRegistry,
} from './settings/protocol.js';
import type { ServerSettingsRepository } from './settings/repository.js';
import {
	createShellProfileOperationRegistry,
	type ShellProfileCatalogueService,
	type ShellStartupMode,
} from './shellProfiles/index.js';
import { TerminalServiceAdapter } from './terminalService/adapter.js';
import { TerminalServiceError } from './terminalService/errors.js';
import { TerminalInputSourceAdapter } from './terminalService/inputSources.js';
import {
	type ShellProfileLaunchAuthority,
	type TerminalLaunchPathAuthority,
	TerminalLaunchResolver,
} from './terminalService/launchResolver.js';
import { TerminalPresentationCheckpointAuthority } from './terminalService/presentationCheckpoint.js';
import {
	createTerminalOperationRegistry,
	type TerminalOperationRegistry,
} from './terminalService/protocol.js';
import { TerminalService } from './terminalService/service.js';
import type { TerminalSessionLifecycle } from './terminalService/types.js';
import {
	type PtyFactory,
	TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
	type TerminalServiceOptions,
} from './terminalService/types.js';
import type {
	CommandHandler,
	OperationPolicy,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryHandler,
	ServerConnectionLike,
	ServerCoreOptions,
} from './types.js';
import type { SessionHolderPtyFactory } from './sessionHolder/factory.js';
import { isHolderSessionId } from './sessionHolder/paths.js';
import { reattachHeldSessions } from './sessionHolder/reattach.js';
import { backgroundTerminalLimitMs } from './settings/backgroundTerminals.js';
import { WorkspaceStore } from './workspace.js';
import {
	restoreWorkspaceOnStartup,
	type WorkspaceStartupRestoreOptions,
} from './workspaceStartup.js';
import {
	createAutomationSpaceEventProjector,
	createAutomationSpaceVisibility,
	withholdAutomationSpaceOperations,
} from './automationSpaceVisibility.js';
import {
	automationSpaceRetainsExitedSession,
	automationSpaceSessionGuard,
	createWorkspaceOperationRegistry,
	type WorkspaceOperationRegistryOptions,
} from './workspaceProtocol.js';

/**
 * Internal lifecycle evidence emitted by a host PTY adapter when foreground
 * process observation is available. It deliberately remains outside the
 * terminal protocol: it is input to server-owned agent reconciliation, not
 * terminal output or client-visible state.
 */
export interface TerminalForegroundProcessLifecycle {
	readonly foregroundProcessChanged?: (
		identity: import('./terminalService/types.js').TerminalIdentity,
		event: Readonly<{
			processName: string;
			shellForeground: boolean;
			observation?: 'available' | 'limited';
		}>,
	) => void;
}

export type ComposedTerminalSessionLifecycle = TerminalSessionLifecycle &
	TerminalForegroundProcessLifecycle;

/** All dispatch tables are present so a transport adapter can pass this
 * registry directly to ServerCore without filling in optional fields. */
export interface CompleteServerCoreOperationRegistry {
	readonly queries: ReadonlyMap<string, QueryHandler>;
	readonly commands: ReadonlyMap<string, CommandHandler>;
	readonly policies: ReadonlyMap<string, OperationPolicy>;
}

/**
 * Host-neutral inputs for composing one server authority.
 *
 * The PTY implementation is deliberately injected. An embedded Desktop host
 * can adapt node-pty (or a test double) without making this package aware of
 * Electron, windows, renderers, or MessagePort. `operations` is the extension
 * point for other server-owned services; terminal operations are always added
 * by this factory.
 */
export interface ServerCoreCompositionOptions
	extends Omit<
		ServerCoreOptions,
		'queries' | 'commands' | 'policies' | 'eventJournal' | 'onConnectionClosed'
	> {
	/** Existing service for hosts that have already composed the PTY factory. */
	readonly terminalService?: TerminalService;
	/** Used to create the server-owned service when `terminalService` is absent. */
	readonly ptyFactory?: PtyFactory;
	/**
	 * A PTY factory whose processes live in a detached session holder
	 * (ADR-0035). Supplying it instead of `ptyFactory` is what makes terminals
	 * survive this server: start-up reattaches to held sessions and keeps their
	 * panels, and shutdown lets go of sessions instead of ending them.
	 */
	readonly sessionHolder?: SessionHolderPtyFactory;
	/** Additional TerminalService limits/hooks, excluding its identity/factory. */
	readonly terminalOptions?: Omit<
		TerminalServiceOptions,
		'serverId' | 'ptyFactory'
	>;
	/** Server-owned shell catalogue used to build the canonical launch resolver. */
	readonly terminalProfiles?: ShellProfileLaunchAuthority;
	/** Concrete server profile authority. When supplied its privileged
	 * catalogue/mutation operations are composed alongside terminal launch. */
	readonly shellProfiles?: ShellProfileCatalogueService;
	readonly terminalLaunchPathAuthority?: TerminalLaunchPathAuthority;
	readonly terminalLaunchEnvironment?: Readonly<
		Record<string, string | undefined>
	>;
	/** Host-owned, per-session launch environment reserved for ephemeral
	 * authority material such as local control capabilities. */
	readonly terminalLaunchEnvironmentFor?: import('./terminalService/launchResolver.js').TerminalLaunchResolverOptions['environmentFor'];
	readonly terminalEnvironmentCaseInsensitive?: boolean;
	readonly terminalSystemDefaultStartupMode?: ShellStartupMode;
	/** @internal Explicit escape hatch for low-level composition tests only. */
	readonly allowUnresolvedTestSessions?: boolean;
	/** Optional adapters supplied by a host; defaults are server-owned. */
	readonly terminalAttachments?: TerminalServiceAdapter;
	readonly terminalInputSources?: TerminalInputSourceAdapter;
	/** Bounded canonical emulator used for fresh terminal presentation recovery.
	 * Hosts that inject a TerminalService supply the same authority to the
	 * service and this composition; normal compositions create one here. */
	readonly presentationCheckpoints?: TerminalPresentationCheckpointAuthority;
	/** Optional canonical workspace authority. When supplied, workspace
	 * queries and authenticated project.move commands are composed into the
	 * same server dispatcher as terminal operations. */
	readonly workspace?: WorkspaceStore;
	readonly workspaceOperations?: WorkspaceOperationRegistryOptions;
	/** Optional canonical terminal activity authority exposed through the same
	 * authenticated protocol and ordered event journal as terminal streams. */
	readonly activity?: TerminalActivityService;
	/** Optional server-owned provider-journal and agent status authority. It shares
	 * the terminal lifecycle with activity; it is never a renderer service. */
	readonly agents?: AgentStatusService;
	/** Optional extension session sources: the supervisor that starts them,
	 * the bridge that reduces their snapshots, and the project scope that
	 * places each session. Generic terminal activity remains the fallback. */
	readonly agentSessions?: AgentSessionComposition;
	/** Other server-owned operation handlers to merge with terminal handlers. */
	readonly operations?: OperationRegistries;
	/** Optional selected-server extension manager. Fixed operations are merged
	 * into every transport and changes use the canonical ordered event stream. */
	readonly extensions?: Omit<ExtensionOperationOptions, 'onChanged'>;
	/** Optional server-owned macro repository, runner, and exact PTY/vault environment. */
	readonly macros?: {
		readonly repository: MacroRepository;
		readonly runner?: MacroRunner;
		readonly environmentFor: (
			request: import('./types.js').CommandRequest,
			target: MacroTarget,
		) => MacroExecutionEnvironment;
	};
	/** Optional server-owned automation definitions and run log. Without a
	 * `controller`, "run now" is refused until an executor is composed. */
	readonly automations?: {
		readonly repository: AutomationRepository;
		readonly runLog: AutomationRunLog;
		readonly controller?: AutomationRunController;
		/** Durable sink for the metadata-only automation audit trail. */
		readonly auditSink?: (entry: AutomationAuditEntry) => void;
	};
	/** Optional server-owned AI authority exposed identically by embedded,
	 * local HTTP, and framed transports. */
	readonly ai?: AiService;
	/** Optional server-owned Git protocol authority. */
	readonly git?: ServerGitAdapter;
	/** Optional server-owned recording protocol authority. */
	readonly recordings?: RecordingAdapter;
	/** Optional durable server settings authority. No settings capability is
	 * registered when a host has not supplied a concrete repository. */
	readonly settings?: ServerSettingsRepository;
	/** Compose the MCP permission approval service (ADR-0031). Only a host
	 * that serves the MCP control socket asks for it; its policy is read from
	 * `settings` when present. */
	readonly mcpApprovals?: boolean;
	/** Compose server-owned app windows (ADR-0037). Needs `mcpApprovals`, whose
	 * Window Messages policy gates what a view types into its terminal. */
	readonly appWindows?: {
		/** The display title of a terminal, for an approval prompt. */
		readonly terminalTitle?: (terminalSessionId: string) => string | undefined;
		/** Where window message attachments are written. Defaults to a server-owned directory under os.tmpdir(). */
		readonly attachmentDirectory?: string;
	};
	/** Compose the registry of user-connected MCP servers (ADR-0037). The host
	 * that serves MCP supplies where the list is kept and the vault that holds
	 * its credentials. */
	readonly connectedServers?: {
		readonly backend: ConnectedServerBackend;
		readonly vault: ConnectedServerVault;
	};
	/** Optional project-scoped filesystem watch and folder-size authority. */
	readonly fileObservations?: ServerFileObservationAdapter;
	/**
	 * Optional server-owned language intelligence.
	 *
	 * Present only when this server both owns project files and runs extensions:
	 * a language session is a child of an extension on the server that owns the
	 * project, and nowhere else.
	 */
	readonly language?: {
		readonly extensions: LanguageExtensionBridge;
		readonly projects: LanguageAdapterOptions['projects'];
		/** Canonical absolute project root; defaults to the project resolver. */
		readonly projectRoot?: (projectId: string) => Promise<string>;
		readonly maxSessions?: number;
		readonly idleMs?: number;
		readonly diagnosticsDebounceMs?: number;
		/** Disk changes fed into open sessions. */
		readonly watch?: {
			observe(
				listener: (event: {
					readonly projectId: string;
					readonly resource: string;
					readonly kind: string;
				}) => void,
			): () => void;
		};
	};
	/** Host-neutral startup/cleanup for optional authorities that require
	 * asynchronous binding before any transport listener becomes ready. */
	readonly serviceLifecycle?: {
		readonly start?: () => void | Promise<void>;
		readonly stop?: () => void | Promise<void>;
	};
	/**
	 * Startup restore for the workspace's terminals.
	 *
	 * The policy is server-owned and lives in `workspaceStartup.ts`; only the act
	 * of creating a session differs by host, so a host supplies that and nothing
	 * else. Omitted only by focused tests that inject no durable workspace.
	 */
	readonly workspaceStartup?: Pick<
		WorkspaceStartupRestoreOptions,
		'createTerminal' | 'firstRun'
	> & {
		/**
		 * Host work that must happen before the restore reads the workspace —
		 * rebuilding process-local project bindings, for instance. Returns the
		 * projects whose roots could not be bound, which therefore get no
		 * replacement terminal.
		 */
		readonly prepare?: () => Promise<ReadonlySet<string>> | ReadonlySet<string>;
	};
	/** Shared ordered journal used by terminal events and ServerConnection. */
	readonly eventJournal?: OrderedEventJournalLike;
	/** Host observer invoked after terminal connection cleanup is performed. */
	readonly onConnectionClosed?: (
		connectionId: string,
		clientId: string,
	) => void;
}

export interface AgentSessionComposition {
	readonly supervisor: SessionSourceSupervisor;
	readonly bridge: SessionSourceBridge;
	readonly scope: ProjectAgentScope;
}

/**
 * The complete server-side surface needed by a transport adapter.
 *
 * A future Electron MessagePort adapter only needs `core.accept(transport)`;
 * it does not need to know how PTYs, attachments, journals, or operation
 * maps were composed. `coreOptions` and `operations` are exposed for hosts
 * that need to pass the canonical registry to another transport-neutral
 * endpoint such as the local UI server.
 */
export interface ServerCoreComposition {
	readonly core: ServerCore;
	readonly coreOptions: ServerCoreOptions;
	readonly operations: CompleteServerCoreOperationRegistry;
	readonly eventJournal: OrderedEventJournalLike;
	readonly terminal: TerminalService;
	readonly terminalLaunchResolver?: TerminalLaunchResolver;
	readonly workspace?: WorkspaceStore;
	readonly activity?: TerminalActivityService;
	readonly agents?: AgentStatusService;
	readonly agentSessions?: AgentSessionComposition;
	readonly activityOperations?: ActivityOperationRegistry;
	readonly agentOperations?: AgentOperationRegistry;
	readonly terminalOperations: TerminalOperationRegistry;
	readonly macroOperations?: MacroOperationRegistry;
	readonly automationOperations?: AutomationOperationRegistry;
	/** MCP's route to automations, behind the MCP permission gate. */
	readonly automationMcp?: AutomationMcpOperations;
	/** Pending MCP approvals and session grants, when composed. */
	readonly mcpApprovals?: McpApprovalService;
	/** Server-owned app windows, when composed. */
	readonly appWindows?: AppWindowService;
	/** The user's connected MCP servers, when composed. */
	readonly connectedServers?: ConnectedServerRegistry;
	/** The composed run executor, when no host `controller` was supplied. */
	readonly automationExecutor?: AutomationExecutor;
	/** Audit trail of automation definition changes and runs. */
	readonly automationAudit?: AutomationAuditLog;
	/** The schedule trigger: one timer armed to the earliest due time. */
	readonly automationScheduler?: AutomationScheduler;
	/** Event triggers. The executor registers each run terminal here with
	 * `markRunTerminal` so a run never triggers on itself. */
	readonly automationTriggers?: AutomationTriggers;
	/** Host hook, the counterpart of connection close: call once per admitted
	 * remote device connection. Drives the Remote device connected trigger. */
	readonly onConnectionAdmitted: (admission: RemoteConnectionAdmission) => void;
	readonly settingsOperations?: SettingsOperationRegistry;
	readonly shellProfileOperations?: ReturnType<
		typeof createShellProfileOperationRegistry
	>;
	readonly workspaceOperations?: import('./workspaceProtocol.js').WorkspaceOperationRegistry;
	readonly languageSessions?: LanguageSessionManager;
	/** Start host-facing services that must be live before a terminal is
	 * created. The composition, not ServerRuntime, owns these instances. */
	readonly start: () => Promise<void>;
	readonly shutdown: () => Promise<void>;
	/**
	 * End every terminal session and remove their panels, leaving no session
	 * holder running. This is the explicit "end my terminals" a host offers
	 * before it shuts the composition down; shutdown alone keeps held sessions.
	 */
	readonly endAllTerminalSessions: () => Promise<void>;
}

/**
 * Compose the server-owned terminal authority and the canonical ServerCore.
 *
 * Operation-name collisions are rejected instead of silently choosing one
 * handler. That keeps a Desktop host from accidentally shadowing a privileged
 * terminal operation while it incrementally adds the remaining services.
 */
export function createServerCoreComposition(
	options: ServerCoreCompositionOptions,
): ServerCoreComposition {
	const presentationCheckpoints =
		options.presentationCheckpoints ??
		options.terminalOptions?.presentationCheckpoints ??
		(options.terminalService === undefined
			? new TerminalPresentationCheckpointAuthority()
			: undefined);
	const terminal = composeTerminal({
		...options,
		...(presentationCheckpoints === undefined ||
		options.terminalService !== undefined
			? {}
			: {
					terminalOptions: {
						...options.terminalOptions,
						presentationCheckpoints,
					},
				}),
	});
	if (terminal.serverId !== options.serverId) {
		throw new TypeError(
			'terminal service server id does not match server core identity',
		);
	}

	const eventJournal = options.eventJournal ?? new OrderedEventJournal();
	if (
		options.terminalProfiles !== undefined &&
		options.workspace === undefined
	) {
		throw new TypeError(
			'workspace is required for canonical terminal launch resolution',
		);
	}
	const terminalLaunchResolver =
		options.terminalProfiles === undefined || options.workspace === undefined
			? undefined
			: new TerminalLaunchResolver({
					serverId: options.serverId,
					profiles: options.terminalProfiles,
					workspaceSnapshot: () =>
						options.workspace?.state as import('./workspace.js').WorkspaceState,
					observeTerminalCwd: async (sessionId) => {
						const session = terminal.getSession(sessionId);
						return session === undefined
							? null
							: (await terminal.currentCwd(session)).cwd;
					},
					...(options.terminalLaunchPathAuthority === undefined
						? {}
						: { pathAuthority: options.terminalLaunchPathAuthority }),
					...(options.terminalLaunchEnvironment === undefined
						? {}
						: { defaultEnvironment: options.terminalLaunchEnvironment }),
					...(options.terminalLaunchEnvironmentFor === undefined
						? {}
						: { environmentFor: options.terminalLaunchEnvironmentFor }),
					...(options.terminalEnvironmentCaseInsensitive === undefined
						? {}
						: {
								environmentCaseInsensitive:
									options.terminalEnvironmentCaseInsensitive,
							}),
					...(options.terminalSystemDefaultStartupMode === undefined
						? {}
						: {
								systemDefaultStartupMode:
									options.terminalSystemDefaultStartupMode,
							}),
				});
	if (
		terminalLaunchResolver === undefined &&
		options.allowUnresolvedTestSessions !== true
	) {
		throw new TypeError(
			'terminalProfiles and workspace are required for production terminal composition',
		);
	}
	const unsubscribeGitEvents =
		typeof options.git?.subscribeEvents === 'function'
			? options.git.subscribeEvents((event) => {
					eventJournal.append(event.type, event as unknown as JsonValue);
				})
			: undefined;
	const workspaceOperations =
		options.workspace === undefined
			? undefined
			: createWorkspaceOperationRegistry(options.workspace, {
					defaultProjectRoot: (
						options.terminalLaunchPathAuthority ??
						nodeTerminalLaunchPathAuthority
					).homeDirectory,
					...options.workspaceOperations,
					closeTerminalSessions: async (sessionIds) => {
						await Promise.allSettled(
							sessionIds.map((sessionId) => terminal.kill(sessionId)),
						);
						await options.workspaceOperations?.closeTerminalSessions?.(
							sessionIds,
						);
					},
					closeProjectTerminalSessions: async (sessionIds) => {
						await options.workspaceOperations?.closeProjectTerminalSessions?.(
							sessionIds,
						);
					},
					releaseProject: async (projectId) => {
						// Each owner releases independently: one failing must not leave
						// the others running for a project that no longer exists.
						await Promise.allSettled([
							Promise.resolve().then(() =>
								options.git?.releaseProject(projectId),
							),
							Promise.resolve().then(() =>
								options.fileObservations?.closeProject(projectId),
							),
							Promise.resolve().then(() =>
								language?.sessions.closeProject(projectId),
							),
							Promise.resolve().then(() =>
								options.workspaceOperations?.releaseProject?.(projectId),
							),
						]);
					},
					rehomeTerminalSession: (move) => {
						// Each owner follows independently, and none may undo a move
						// the workspace has already committed.
						const retired = {
							serverId: terminal.serverId,
							projectId: move.sourceProjectId,
							sessionId: move.sessionId,
						};
						for (const follow of [
							() => terminalOperations.retireIdentity(retired),
							() =>
								terminal.rehomeSession(move.sessionId, move.targetProjectId),
							() =>
								options.activity?.rehomeSession(
									move.sessionId,
									move.targetProjectId,
								),
							() =>
								options.agents?.rehomeTerminal(
									move.sessionId,
									move.targetProjectId,
								),
							() => {
								const recordings = options.recordings?.service;
								if (recordings?.getSessionScope(move.sessionId) !== undefined)
									recordings.updateSessionMetadata(move.sessionId, {
										projectId: move.targetProjectId,
									});
							},
							() => options.workspaceOperations?.rehomeTerminalSession?.(move),
						]) {
							try {
								follow();
							} catch {
								// The workspace is the record of where a terminal lives.
							}
						}
					},
					eventJournal,
					...(options.shellProfiles === undefined
						? {}
						: {
								shellProfileExists: (profileId: string) =>
									options.shellProfiles?.isDurableProfile(profileId) ?? false,
							}),
				});
	terminal.onEvent((event) => {
		if (event.type !== 'exit') return;
		workspaceOperations?.applyHostCommand(
			`terminal-exit:${event.sessionId}`.slice(0, 128),
			{
				type: 'terminal.markExited',
				sessionId: event.sessionId,
				exitCode: event.exitCode,
			},
		);
	});
	const macroOperations =
		options.macros === undefined
			? undefined
			: createMacroOperationRegistry({
					serverId: options.serverId,
					repository: options.macros.repository,
					...(options.macros.runner === undefined
						? {}
						: { runner: options.macros.runner }),
					eventJournal,
					environmentFor: options.macros.environmentFor,
				});
	// --- automations: executor and audit (tasks 7.1-7.5) ---
	// A host-supplied controller wins; otherwise runs execute here, under the
	// automation principal, through the canonical launch resolver (so the MCP
	// launch-environment hook sees every run terminal).
	const automationAudit =
		options.automations === undefined
			? undefined
			: new AutomationAuditLog({
					serverId: options.serverId,
					...(options.automations.auditSink === undefined
						? {}
						: { sink: options.automations.auditSink }),
				});
	const automationExecutor =
		options.automations === undefined ||
		options.automations.controller !== undefined ||
		options.workspace === undefined ||
		workspaceOperations === undefined ||
		terminalLaunchResolver === undefined
			? undefined
			: new AutomationExecutor({
					serverId: options.serverId,
					runLog: options.automations.runLog,
					terminal,
					workspace: options.workspace,
					workspaceOperations,
					resolveLaunch: (intent) => terminalLaunchResolver.resolve(intent),
					...(options.terminalLaunchPathAuthority === undefined
						? {}
						: {
								homeDirectory:
									options.terminalLaunchPathAuthority.homeDirectory,
							}),
					...(options.macros === undefined || macroOperations === undefined
						? {}
						: {
								macros: {
									repository: options.macros.repository,
									runner: macroOperations.runner,
									environmentFor: options.macros.environmentFor,
								},
							}),
					...(options.recordings === undefined
						? {}
						: { recordings: options.recordings.service }),
					// Bound lazily: the trigger module is composed below.
					runTerminalRegistry: {
						mark: (sessionId) => automationTriggers?.markRunTerminal(sessionId),
						unmark: (sessionId) =>
							automationTriggers?.unmarkRunTerminal(sessionId),
					},
					...(automationAudit === undefined ? {} : { audit: automationAudit }),
				});
	const composedAutomationController: AutomationRunController | undefined =
		options.automations?.controller ?? automationExecutor;
	// --- end automations: executor and audit ---
	// --- automations ---
	// One zone for evaluating schedules and for the previews clients show.
	const automationTimeZone = localTimeZone();
	const automationOperations =
		options.automations === undefined
			? undefined
			: createAutomationOperationRegistry({
					timeZone: automationTimeZone,
					serverId: options.serverId,
					repository: options.automations.repository,
					runLog: options.automations.runLog,
					eventJournal,
					...(composedAutomationController === undefined
						? {}
						: { controller: composedAutomationController }),
					...(automationAudit === undefined
						? {}
						: {
								onAudit: (record) => automationAudit.recordRequest(record),
							}),
				});
	const automationMcp =
		options.automations === undefined
			? undefined
			: createAutomationMcpOperations({
					repository: options.automations.repository,
					runLog: options.automations.runLog,
					controller: composedAutomationController ?? unavailableAutomationRunController,
					timeZone: automationTimeZone,
					...(automationAudit === undefined
						? {}
						: {
								onAudit: (record) => automationAudit.recordRequest(record),
							}),
				});
	// --- end automations ---
	// --- MCP permission approvals (ADR-0031) ---
	// Settings may not be loaded yet; `start` applies the stored policy once
	// they are, and until then nothing can reach the MCP endpoint.
	const storedMcpPermissions = () => {
		try {
			return mcpPermissionsFromSettings(options.settings?.settings);
		} catch {
			return DEFAULT_MCP_PERMISSIONS;
		}
	};
	const mcpApprovals =
		options.mcpApprovals === true
			? new McpApprovalService({
					eventJournal,
					policies: storedMcpPermissions(),
				})
			: undefined;
	const removeMcpPolicyObserver =
		mcpApprovals === undefined || options.settings === undefined
			? undefined
			: options.settings.onChange((state) =>
					mcpApprovals.setPolicies(mcpPermissionsFromSettings(state.settings)),
				);
	// --- end MCP permission approvals ---
	// --- app windows (ADR-0037) ---
	/** Evaluate Window Messages for one message, with the files it carries. */
	const authorizeWindowMessage = async (
		window: AppWindowView,
		text: string,
		attachments: readonly AppWindowAttachment[],
		signal: AbortSignal,
	): Promise<void> => {
		if (mcpApprovals === undefined)
			throw protocolError('unavailable', 'window messages are unavailable');
		const outcome = await mcpApprovals.authorize({
			terminalSessionId: window.terminalSessionId,
			projectId: window.projectId,
			operation: 'window_message',
			group: 'windowMessages',
			agent: `The window "${window.title}"`,
			terminalTitle:
				options.appWindows?.terminalTitle?.(window.terminalSessionId) ??
				'this terminal',
			summary:
				attachments.length === 0
					? 'type a message into the terminal and send it'
					: `type a message into the terminal and send it, with ${attachments.length === 1 ? 'a file' : `${attachments.length} files`} saved on this server`,
			details: [
				...(text.length === 0
					? []
					: [{ label: 'Message', value: text, code: true }]),
				...attachments.map((attachment) => ({
					label: 'Attachment',
					value: `${attachment.name} (${formatByteSize(attachment.size)})`,
				})),
			],
			signal,
		});
		if (!outcome.ok) throw protocolError('forbidden', outcome.error.message);
	};
	/** Paste a window's message into its terminal and submit it once. */
	const typeWindowMessage = async (
		window: AppWindowView,
		text: string,
	): Promise<void> => {
		const authorization = {
			serverId: options.serverId,
			projectId: window.projectId,
			sessionId: window.terminalSessionId,
			scope: 'write',
		} as const;
		const bracketed = await terminal.bracketedPasteMode(
			window.terminalSessionId,
			authorization,
		);
		await terminal.input(
			window.terminalSessionId,
			// Without bracketed paste every line break would submit a line
			// of its own; a window message is submitted once.
			commandSubmissionInput(
				// A tab is a keystroke there too: a plain shell completes on it.
				bracketed
					? text
					: text.replace(/\s*\r?\n\s*/g, ' ').replace(/\t/g, ' ').trim(),
				bracketed,
			),
			authorization,
		);
	};
	const appWindows =
		options.appWindows === undefined || mcpApprovals === undefined
			? undefined
			: new AppWindowService({
					eventJournal,
					// Resolved at request time: the terminal registry is composed below.
					// The lease belongs to one attachment, made on one connection. A
					// second connection that only names the same client is not the
					// controller: a client id is what a client says it is.
					isPresentationHolder: (window, context) => {
						const holder = terminalOperations.presentationHolder({
							projectId: window.projectId,
							sessionId: window.terminalSessionId,
						});
						return (
							holder !== undefined &&
							holder.clientId === context.clientId &&
							(holder.connectionId === undefined ||
								holder.connectionId === context.connectionId)
						);
					},
					presentationHolder: (window) =>
						terminalOperations.presentationHolder({
							projectId: window.projectId,
							sessionId: window.terminalSessionId,
						})?.clientId,
					deliverMessage: async (window, text, signal) => {
						await authorizeWindowMessage(window, text, [], signal);
						await typeWindowMessage(window, text);
					},
					attachments: {
						authorize: authorizeWindowMessage,
						type: (window, text) => typeWindowMessage(window, text),
						...(options.appWindows.attachmentDirectory === undefined
							? {}
							: { directory: options.appWindows.attachmentDirectory }),
					},
				});
	const removeAppWindowExitObserver =
		appWindows === undefined
			? undefined
			: terminal.onEvent((event) => {
					if (event.type === 'exit') appWindows.endSession(event.sessionId);
				});
	const connectedServers =
		options.connectedServers === undefined
			? undefined
			: new ConnectedServerRegistry({
					backend: options.connectedServers.backend,
					vault: options.connectedServers.vault,
					eventJournal,
				});
	// --- end app windows ---
	// --- automations: scheduler and triggers (tasks 6.1-6.4) ---
	// Both consume the run controller only through the `automations.controller`
	// injection point, resolved at fire time.
	const automationController = (): AutomationRunController | undefined =>
		composedAutomationController;
	const automationScheduler =
		options.automations === undefined
			? undefined
			: new AutomationScheduler({
					repository: options.automations.repository,
					runLog: options.automations.runLog,
					controller: automationController,
					timeZone: automationTimeZone,
				});
	const automationTriggers =
		options.automations === undefined
			? undefined
			: new AutomationTriggers({
					serverId: options.serverId,
					repository: options.automations.repository,
					runLog: options.automations.runLog,
					controller: automationController,
					...(options.agents === undefined ? {} : { agents: options.agents }),
					...(options.activity === undefined
						? {}
						: { activity: options.activity }),
					eventJournal,
					describeTerminal: (sessionId) => {
						const session = terminal.getSession(sessionId);
						const state = options.workspace?.state;
						const projectId =
							session?.projectId ?? state?.terminalSessions[sessionId]?.projectId;
						if (projectId === undefined) return undefined;
						const panel = Object.values(state?.panels ?? {}).find(
							(candidate) =>
								candidate.type === 'terminal' &&
								candidate.sessionId === sessionId,
						);
						const projectTitle = state?.projects[projectId]?.name;
						return {
							projectId,
							...(panel?.title === undefined ? {} : { title: panel.title }),
							...(projectTitle === undefined ? {} : { projectTitle }),
							...(session === undefined
								? {}
								: { sessionCreatedAt: session.createdAt }),
						};
					},
				});
	const onConnectionAdmitted = (admission: RemoteConnectionAdmission): void => {
		automationTriggers?.deviceConnected(admission);
	};
	// --- end automations: scheduler and triggers ---
	// Automation terminal space (ADR-0030): withheld from connections without
	// automations.v1 across terminal, activity, and agent surfaces.
	const automationSpace =
		options.workspace === undefined
			? undefined
			: {
					workspace: options.workspace,
					visibility: createAutomationSpaceVisibility(options.workspace, () =>
						terminal.listSessions(),
					),
				};
	const automationRetainsExitedSession =
		automationSpace === undefined
			? undefined
			: automationSpaceRetainsExitedSession(automationSpace.workspace);
	const heldEndedSessionRetained =
		options.sessionHolder === undefined || options.workspace === undefined
			? undefined
			: endedSessionWithOpenPanel(options.workspace);
	const terminalOperations = createTerminalOperationRegistry({
		service: terminal,
		eventJournal,
		...(presentationCheckpoints === undefined
			? {}
			: { checkpoints: presentationCheckpoints }),
		...(terminalLaunchResolver === undefined
			? {}
			: { launchResolver: terminalLaunchResolver }),
		...(options.allowUnresolvedTestSessions === true
			? { allowUnresolvedTestSessions: true }
			: {}),
		...(options.maxTerminalUnconfirmedBytes === undefined
			? {}
			: { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
		// Automation terminal space (ADR-0030): visibility and live-terminal cap.
		...(automationSpace === undefined
			? {}
			: {
					beforeSessionCreate: automationSpaceSessionGuard(automationSpace.workspace),
					isProjectHidden: automationSpace.visibility.isProjectHidden,
				}),
		// Which ended sessions may still be read. A kept automation terminal
		// always may. With a session holder, so may any ended session whose
		// panel is still open: its panel shows the output it ended with.
		...(automationSpace === undefined && heldEndedSessionRetained === undefined
			? {}
			: {
					retainsExitedSession: (identity: {
						readonly projectId: string;
						readonly sessionId: string;
					}) =>
						automationRetainsExitedSession?.(identity) === true ||
						heldEndedSessionRetained?.(identity) === true,
				}),
		...(options.workspace === undefined
			? {}
			: {
					onSessionCreated: (
						session: import('./terminalService/types.js').TerminalSessionSnapshot,
					): void => {
						const workspace = options.workspace;
						if (workspace === undefined) return;
						let state = workspace.state;
						if (state.projects[session.projectId] === undefined) {
							const viewId = state.viewOrder[0];
							if (viewId === undefined)
								throw new Error('workspace has no view for terminal project');
							const created = workspaceOperations?.applyHostCommand(
								`tp:${session.sessionId}`.slice(0, 128),
								{
									type: 'project.create',
									projectId: session.projectId,
									viewId,
									root: session.cwd,
									name: session.projectId,
								},
							);
							if (created === undefined)
								throw new Error('workspace operation registry is unavailable');
							if (!created.ok) throw new Error(created.conflict.message);
							state = created.state;
						}
						if (state.terminalSessions[session.sessionId] === undefined) {
							const panelCount = Object.values(state.panels).filter(
								(panel) =>
									panel.projectId === session.projectId &&
									panel.type === 'terminal',
							).length;
							const created = workspaceOperations?.applyHostCommand(
								`tcp:${session.sessionId}`.slice(0, 128),
								{
									type: 'terminal.createPanel',
									sessionId: session.sessionId,
									projectId: session.projectId,
									panelId: `p:${session.sessionId}`.slice(0, 128),
									title: `Terminal ${panelCount + 1}`,
									cwd: session.cwd,
									createdAt: session.createdAt,
									...(session.launch === undefined
										? {}
										: { launch: session.launch }),
								},
							);
							if (created === undefined)
								throw new Error('workspace operation registry is unavailable');
							if (!created.ok) throw new Error(created.conflict.message);
							state = created.state;
						}
						if (
							!Object.values(state.panels).some(
								(panel) =>
									panel.type === 'terminal' &&
									panel.sessionId === session.sessionId,
							)
						) {
							const panelCount = Object.values(state.panels).filter(
								(panel) =>
									panel.projectId === session.projectId &&
									panel.type === 'terminal',
							).length;
							const created = workspaceOperations?.applyHostCommand(
								`pc:${session.sessionId}`.slice(0, 128),
								{
									type: 'panel.create',
									panel: {
										id: `p:${session.sessionId}`.slice(0, 128),
										projectId: session.projectId,
										type: 'terminal',
										sessionId: session.sessionId,
										title: `Terminal ${panelCount + 1}`,
										cwd: session.cwd,
										createdAt: session.createdAt,
									},
								},
							);
							if (created === undefined)
								throw new Error('workspace operation registry is unavailable');
							if (!created.ok) throw new Error(created.conflict.message);
						}
					},
				}),
		...(options.terminalAttachments === undefined
			? {}
			: { attachments: options.terminalAttachments }),
		...(options.terminalInputSources === undefined
			? {}
			: { inputSources: options.terminalInputSources }),
	});
	const activityOperations =
		options.activity === undefined
			? undefined
			: createActivityOperationRegistry({
					service: options.activity,
					eventJournal,
					observeForeground: async (request, scope) => {
						const readScope =
							request.context.authScope === 'none'
								? ('none' as const)
								: ('read' as const);
						const authorization = {
							serverId: terminal.serverId,
							projectId: scope.projectId,
							clientId: request.context.clientId,
							scope: readScope,
						};
						try {
							if (scope.sessionId !== undefined) {
								const snapshot = terminal.getSession(scope.sessionId);
								if (snapshot === undefined || snapshot.status !== 'running') {
									return [
										{
											sessionId: scope.sessionId,
											projectId: scope.projectId,
											observation: 'available' as const,
											foregroundBusy: false,
										},
									];
								}
								return [
									await terminal.observeForegroundProcess(
										scope.sessionId,
										{
											...authorization,
											projectId: snapshot.projectId,
											sessionId: scope.sessionId,
										},
										TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
									),
								];
							}
							return [
								...(await terminal.observeProjectForegroundProcesses(
									scope.projectId,
									authorization,
									TERMINAL_CLOSE_OBSERVATION_TIMEOUT_MS,
								)),
							];
						} catch (error) {
							if (
								error instanceof TerminalServiceError &&
								(error.code === 'session_not_found' ||
									error.code === 'session_exited' ||
									error.code === 'session_interrupted')
							) {
								return [
									{
										sessionId: scope.sessionId ?? '',
										projectId: scope.projectId,
										observation: 'available' as const,
										foregroundBusy: false,
									},
								].filter((observation) => observation.sessionId.length > 0);
							}
							if (scope.sessionId !== undefined) {
								return [
									{
										sessionId: scope.sessionId,
										projectId: scope.projectId,
										observation: 'limited' as const,
										foregroundBusy: false,
										observationError: 'failed' as const,
									},
								];
							}
							return [];
						}
					},
				});
	const agentOperations =
		options.agents === undefined
			? undefined
			: createAgentOperationRegistry({ service: options.agents, eventJournal });
	const aiOperations =
		options.ai === undefined
			? undefined
			: createAiOperationHandlers(options.ai);
	const gitOperations = options.git?.operations();
	const recordingOperations = options.recordings?.operations();
	if (options.recordings !== undefined) {
		terminal.onEvent((event) => {
			if (event.type === 'output' && !event.replay) {
				options.recordings?.service.appendOutput(
					event.sessionId,
					new TextDecoder().decode(event.bytes),
				);
			} else if (event.type === 'exit') {
				options.recordings?.service.finalize(
					event.sessionId,
					event.exitCode,
					event.signal,
				);
			}
		});
	}
	const language = composeLanguageService(options, eventJournal);
	const settingsOperations =
		options.settings === undefined
			? undefined
			: createSettingsOperationRegistry(options.settings, eventJournal);
	const shellProfileOperations =
		options.shellProfiles === undefined
			? undefined
			: createShellProfileOperationRegistry(options.shellProfiles);
	const extensionOperations =
		options.extensions === undefined
			? undefined
			: createExtensionOperationHandlers({
					...options.extensions,
					onChanged: (payload) => {
						eventJournal.append('extensions.changed', payload);
					},
				});
	const operations = mergeOperationRegistries(
		mergeOperationRegistries(
			mergeOperationRegistries(
				mergeOperationRegistries(
					mergeOperationRegistries(
						mergeOperationRegistries(
							options.operations ?? {},
							extensionOperations ?? {},
						),
						options.fileObservations?.operations ?? {},
					),
					mergeOperationRegistries(
						mergeOperationRegistries(
							macroOperations?.operations ?? {},
							automationOperations?.operations ?? {},
						),
						mergeOperationRegistries(
							mcpApprovals?.operations() ?? {},
							mergeOperationRegistries(
								appWindows?.operations() ?? {},
								connectedServers?.operations() ?? {},
							),
						),
					),
				),
				workspaceOperations?.operations ?? {},
			),
			mergeOperationRegistries(
				mergeOperationRegistries(
					activityOperations?.operations ?? {},
					agentOperations?.operations ?? {},
				),
				mergeOperationRegistries(aiOperations ?? {}, gitOperations ?? {}),
			),
		),
		mergeOperationRegistries(
			mergeOperationRegistries(
				mergeOperationRegistries(
					recordingOperations ?? {},
					settingsOperations?.operations ?? {},
				),
				language?.adapter.operations() ?? {},
			),
			shellProfileOperations?.operations ?? {},
		),
	);
	const mergedOperations = mergeOperationRegistries(
		operations,
		terminalOperations.operations,
	);
	const completeOperations =
		automationSpace === undefined
			? mergedOperations
			: withholdAutomationSpaceOperations(
					mergedOperations,
					automationSpace.visibility,
				);
	const onConnectionClosed = (connectionId: string, clientId: string): void => {
		terminalOperations.closeConnection(connectionId);
		macroOperations?.closeConnection(connectionId);
		options.fileObservations?.closeConnection(connectionId);
		appWindows?.closeConnection(connectionId);
		options.onConnectionClosed?.(connectionId, clientId);
	};
	const coreOptions: ServerCoreOptions = {
		serverId: options.serverId,
		serverVersion: options.serverVersion,
		capabilities: uniqueCapabilities(options),
		eventJournal,
		...(options.activity === undefined &&
		options.agents === undefined &&
		options.fileObservations === undefined &&
		automationSpace === undefined
			? {}
			: {
					projectEvent: composeProjectEventProjectors(
						options.workspace === undefined
							? undefined
							: projectLifecycleEventProjector,
						options.activity === undefined
							? undefined
							: createActivityEventProjector(options.activity),
						options.agents === undefined
							? undefined
							: createAgentEventProjector(options.agents),
						options.fileObservations === undefined
							? undefined
							: createFileObservationEventProjector,
						automationSpace === undefined
							? undefined
							: createAutomationSpaceEventProjector(
									automationSpace.visibility,
								),
					),
				}),
		...optionalCoreOptions(options),
		...completeOperations,
		onConnectionClosed,
		onTerminalCongestion: (attachmentId, clientId, connectionId) => {
			terminalOperations.suppressOutput(attachmentId, connectionId);
			options.onTerminalCongestion?.(attachmentId, clientId, connectionId);
		},
	};
	const baseCore = createServerCore(coreOptions);
	const connections = new Set<ServerConnectionLike>();
	const core: ServerCore = {
		accept: (transport, connectionOptions) => {
			let connection: ReturnType<typeof baseCore.accept>;
			connection = baseCore.accept(transport, {
				...connectionOptions,
				onClosed: () => {
					connections.delete(connection);
					connectionOptions?.onClosed?.();
				},
			});
			connections.add(connection);
			return connection;
		},
	};
	let lifecycle:
		| 'created'
		| 'starting'
		| 'ready'
		| 'stopping'
		| 'stopped'
		| 'failed' = 'created';
	let startPromise: Promise<void> | undefined;
	let shutdownPromise: Promise<void> | undefined;
	const start = (): Promise<void> => {
		if (lifecycle === 'ready') return Promise.resolve();
		if (lifecycle === 'starting' && startPromise !== undefined)
			return startPromise;
		if (lifecycle === 'stopping' || lifecycle === 'stopped')
			return Promise.reject(new Error(`server composition is ${lifecycle}`));
		lifecycle = 'starting';
		startPromise = (async () => {
			try {
				if (options.extensions?.initialize !== undefined)
					await options.extensions.initialize();
				else {
					await options.extensions?.installer.initialize();
					await options.extensions?.activateEnabled?.();
				}
				await options.settings?.load();
				// The unattached limit is a server setting; the holder is told it
				// now and again whenever it changes.
				if (
					options.sessionHolder !== undefined &&
					options.settings !== undefined
				) {
					const holder = options.sessionHolder;
					const applyLimit = (settings: {
						readonly keepTerminalsAfterQuit?: unknown;
					}): void =>
						holder.setLimit(
							backgroundTerminalLimitMs(settings.keepTerminalsAfterQuit),
						);
					applyLimit(options.settings.settings);
					unsubscribeBackgroundLimit ??= options.settings.onChange((state) =>
						applyLimit(state.settings),
					);
				}
				mcpApprovals?.setPolicies(storedMcpPermissions());
				await options.serviceLifecycle?.start?.();
				await options.agents?.start();
				// Every service the restore needs is now up, and a host's way of
				// making a session may itself await `start()` — Desktop's does.
				// Becoming ready before the restore keeps that re-entrant call
				// from awaiting the promise it is running inside, while the
				// restore is still awaited before `start()` resolves.
				if (lifecycle === 'starting') lifecycle = 'ready';
				// Terminals whose process did not survive the restart are reaped
				// and replaced here, for every host. Doing it in a host bootstrap
				// is how Desktop and the standalone server came to restore the
				// same repository differently.
				if (
					options.workspaceStartup !== undefined &&
					options.workspace !== undefined
				) {
					const unavailableProjectIds =
						(await options.workspaceStartup.prepare?.()) ?? new Set<string>();
					// The first start with a holder on a data root that never had one
					// (an upgrade from a release whose terminals ended with the
					// server) has nothing to reattach and nothing saved to show.
					// Keeping those panels would greet every project with dead,
					// empty tabs, so that one start restores as it always did:
					// stale terminals are discarded and each project gets a fresh one.
					const keepsTerminalPanels =
						options.sessionHolder !== undefined &&
						(options.sessionHolder.hadPriorState?.() ?? true);
					if (options.sessionHolder !== undefined && keepsTerminalPanels)
						await reattachHeldSessions({
							serverId: options.serverId,
							workspace: options.workspace,
							terminal,
							holder: options.sessionHolder,
							freshWorkspace: options.workspaceStartup.firstRun,
						});
					await restoreWorkspaceOnStartup({
						preserveTerminalPanels: keepsTerminalPanels,
						workspace: options.workspace,
						liveSessionCount: () => terminal.listSessions().length,
						hasSession: (sessionId) =>
							terminal.getSession(sessionId) !== undefined,
						unavailableProjectIds,
						firstRun: options.workspaceStartup.firstRun,
						createTerminal: options.workspaceStartup.createTerminal,
					});
				}
				// Automations start last: a schedule that came due while the
				// server was down is counted as missed, and nothing fires before
				// the services a run needs are up.
				await automationTriggers?.start();
				await automationScheduler?.start();
			} catch (error) {
				// Including the window above, where this start had already
				// published readiness: a start that throws did not succeed.
				if (lifecycle === 'starting' || lifecycle === 'ready')
					lifecycle = 'failed';
				throw error;
			}
		})();
		return startPromise;
	};
	// A session whose record leaves the workspace is one whose panel was
	// closed. The holder must not keep its process, its ring, or its tail.
	const unsubscribeHeldSessionRelease =
		options.sessionHolder === undefined || options.workspace === undefined
			? undefined
			: releaseClosedHeldSessions(options.workspace, options.sessionHolder);
	let unsubscribeBackgroundLimit: (() => void) | undefined;
	const endAllTerminalSessions = async (): Promise<void> => {
		await startPromise?.catch(() => undefined);
		unsubscribeHeldSessionRelease?.();
		await terminal.shutdown();
		await options.sessionHolder?.endAll();
		options.workspace?.discardStaleTerminalState();
	};
	const shutdown = (): Promise<void> => {
		if (shutdownPromise !== undefined) return shutdownPromise;
		if (lifecycle === 'stopped') return Promise.resolve();
		lifecycle = 'stopping';
		shutdownPromise = (async () => {
			// If startup was still binding a hook receiver, wait for it before
			// teardown so it cannot resurrect after shutdown begins.
			await startPromise?.catch(() => undefined);
			const failures: unknown[] = [];
			const attempt = async (
				operation: () => Promise<unknown> | unknown,
			): Promise<void> => {
				try {
					await operation();
				} catch (error) {
					failures.push(error);
				}
			};
			await attempt(() => {
				automationScheduler?.stop();
				automationTriggers?.stop();
			});
			await attempt(() => automationExecutor?.dispose());
			await attempt(() =>
				Promise.allSettled(
					[...connections].map((connection) => connection.close()),
				),
			);
			connections.clear();
			await attempt(() => options.agentSessions?.supervisor.dispose());
			await attempt(() => options.agentSessions?.bridge.dispose());
			await attempt(() => options.agentSessions?.scope.dispose());
			// Terminal exit is a final agent lifecycle input, so terminal stops
			// before the agent service. Every later cleanup still runs if it fails.
			// With a session holder, shutting down is letting go: the shells keep
			// running for the next server. Ending them is `endAllTerminalSessions`.
			await attempt(() =>
				terminal.shutdown(
					options.sessionHolder === undefined ? {} : { detach: true },
				),
			);
			await attempt(() => options.sessionHolder?.detach());
			await attempt(() => unsubscribeHeldSessionRelease?.());
			await attempt(() => unsubscribeBackgroundLimit?.());
			await attempt(() => presentationCheckpoints?.close());
			await attempt(() => options.recordings?.service.shutdown());
			await attempt(() => options.serviceLifecycle?.stop?.());
			await attempt(() => unsubscribeGitEvents?.());
			await attempt(() => options.git?.close?.());
			await attempt(() => options.agents?.stop());
			await attempt(() => activityOperations?.close());
			await attempt(() => agentOperations?.close());
			await attempt(() => options.fileObservations?.close());
			await attempt(() => options.activity?.shutdown());
			await attempt(() => language?.dispose());
			await attempt(() => automationOperations?.dispose());
			await attempt(() => {
				removeMcpPolicyObserver?.();
				mcpApprovals?.revokeAll();
				removeAppWindowExitObserver?.();
				appWindows?.endAll();
			});
			lifecycle = 'stopped';
			if (failures.length > 0)
				throw cleanupFailure('server composition shutdown failed', failures);
		})();
		return shutdownPromise;
	};

	return {
		core,
		coreOptions,
		operations: completeOperations,
		eventJournal,
		terminal,
		...(options.workspace === undefined
			? {}
			: { workspace: options.workspace }),
		...(workspaceOperations === undefined ? {} : { workspaceOperations }),
		...(language === undefined ? {} : { languageSessions: language.sessions }),
		...(options.activity === undefined ? {} : { activity: options.activity }),
		...(options.agents === undefined ? {} : { agents: options.agents }),
		...(options.agentSessions === undefined
			? {}
			: { agentSessions: options.agentSessions }),
		...(activityOperations === undefined ? {} : { activityOperations }),
		...(agentOperations === undefined ? {} : { agentOperations }),
		terminalOperations,
		...(terminalLaunchResolver === undefined ? {} : { terminalLaunchResolver }),
		...(macroOperations === undefined ? {} : { macroOperations }),
		...(automationOperations === undefined ? {} : { automationOperations }),
		...(automationExecutor === undefined ? {} : { automationExecutor }),
		...(automationMcp === undefined ? {} : { automationMcp }),
		...(mcpApprovals === undefined ? {} : { mcpApprovals }),
		...(appWindows === undefined ? {} : { appWindows }),
		...(connectedServers === undefined ? {} : { connectedServers }),
		...(automationAudit === undefined ? {} : { automationAudit }),
		...(automationScheduler === undefined ? {} : { automationScheduler }),
		...(automationTriggers === undefined ? {} : { automationTriggers }),
		onConnectionAdmitted,
		...(settingsOperations === undefined ? {} : { settingsOperations }),
		...(shellProfileOperations === undefined ? {} : { shellProfileOperations }),
		start,
		shutdown,
		endAllTerminalSessions,
	};
}

function cleanupFailure(message: string, failures: readonly unknown[]): Error {
	const error = new Error(message);
	Object.defineProperty(error, 'errors', {
		value: [...failures],
		enumerable: false,
	});
	return error;
}

/** An ended session is still readable while a terminal panel points at it. */
function endedSessionWithOpenPanel(
	workspace: WorkspaceStore,
): (identity: {
	readonly projectId: string;
	readonly sessionId: string;
}) => boolean {
	return (identity) => {
		const state = workspace.state;
		if (state.terminalSessions[identity.sessionId] === undefined) return false;
		return Object.values(state.panels).some(
			(panel) =>
				panel.type === 'terminal' &&
				panel.projectId === identity.projectId &&
				panel.sessionId === identity.sessionId,
		);
	};
}

function releaseClosedHeldSessions(
	workspace: WorkspaceStore,
	holder: SessionHolderPtyFactory,
): () => void {
	return workspace.subscribe((event) => {
		for (const id of event.changedIds) {
			if (!isHolderSessionId(id)) continue;
			if (workspace.state.terminalSessions[id] !== undefined) continue;
			void holder.end(id).catch(() => undefined);
		}
	});
}

function composeTerminal(
	options: ServerCoreCompositionOptions,
): TerminalService {
	if (
		options.terminalService !== undefined &&
		options.ptyFactory !== undefined
	) {
		throw new TypeError('provide terminalService or ptyFactory, not both');
	}
	if (
		options.sessionHolder !== undefined &&
		(options.terminalService !== undefined || options.ptyFactory !== undefined)
	) {
		throw new TypeError(
			'provide sessionHolder alone, without terminalService or ptyFactory',
		);
	}
	if (options.terminalService !== undefined) {
		if (!(options.terminalService instanceof TerminalService)) {
			throw new TypeError('terminalService must be a TerminalService');
		}
		bindTerminalActivity(options.terminalService, options.activity);
		return options.terminalService;
	}
	const ptyFactory = options.sessionHolder ?? options.ptyFactory;
	if (ptyFactory === undefined) {
		throw new TypeError(
			'ptyFactory is required when terminalService is absent',
		);
	}
	const terminalOptions = options.terminalOptions ?? {};
	const terminal = new TerminalService({
		...terminalOptions,
		serverId: options.serverId,
		ptyFactory,
		...(options.agents === undefined ||
		terminalOptions.inactivityHold !== undefined
			? {}
			: { inactivityHold: createAgentInactivityHold(options.agents) }),
		...(options.activity === undefined && options.agents === undefined
			? {}
			: {
					sessionLifecycle: composeActivityLifecycle(
						options.activity,
						options.agents,
						terminalOptions.sessionLifecycle,
					),
				}),
	});
	bindTerminalActivity(terminal, options.activity);
	return terminal;
}

/** Bind the PTY byte boundary to canonical activity exactly once. This is
 * server composition, never a renderer callback; raw bytes stay untouched. */
function bindTerminalActivity(
	terminal: TerminalService,
	activity: TerminalActivityService | undefined,
): void {
	if (activity === undefined) return;
	for (const session of terminal.listSessions())
		ensureActivitySession(activity, session);
	terminal.onInput((identity, bytes) => {
		if (isTerminalFocusReport(bytes)) return;
		ensureActivitySession(activity, identity);
		activity.ingestSignal(identity, { kind: 'userInput' });
	});
	terminal.onEvent((event) => {
		const identity = {
			serverId: event.serverId,
			projectId: event.projectId,
			sessionId: event.sessionId,
		};
		ensureActivitySession(activity, identity);
		if (event.type === 'output')
			activity.ingestPtyOutput(identity, event.bytes);
		else if (event.type === 'exit') activity.markExited(identity);
	});
}

function isTerminalFocusReport(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength === 3 &&
		bytes[0] === 0x1b &&
		bytes[1] === 0x5b &&
		(bytes[2] === 0x49 || bytes[2] === 0x4f)
	);
}

export function composeActivityLifecycle(
	activity: TerminalActivityService | undefined,
	agents: AgentStatusService | undefined,
	lifecycle: ComposedTerminalSessionLifecycle | undefined,
): ComposedTerminalSessionLifecycle {
	return {
		prepareTerminalSession: (identity) => {
			if (activity !== undefined) ensureActivitySession(activity, identity);
			agents?.register(identity);
			const hostEnvironment = lifecycle?.prepareTerminalSession(identity) ?? {};
			return { ...hostEnvironment };
		},
		terminalStarted: (identity, shellPid) => {
			agents?.terminalStarted(identity, shellPid);
			lifecycle?.terminalStarted?.(identity, shellPid);
		},
		terminalInput: (identity) => {
			lifecycle?.terminalInput?.(identity);
		},
		terminalExited: (identity, exit) => {
			if (activity !== undefined) {
				try {
					activity.markExited(identity);
				} catch {
					/* terminal exit remains authoritative */
				}
			}
			agents?.terminalExited(identity);
			lifecycle?.terminalExited(identity, exit);
		},
		foregroundProcessChanged: (identity, event) => {
			// Foreground observation is trusted host lifecycle input. It does not
			// cross the terminal event stream or any renderer-controlled boundary.
			if (activity !== undefined) {
				try {
					activity.ingestSignal(
						identity,
						event.observation === 'limited'
							? { kind: 'foreground', observation: 'limited' }
							: {
									kind: 'foreground',
									busy: !event.shellForeground,
									processName: event.processName,
								},
					);
				} catch {
					// Foreground observation cannot change PTY supervision.
				}
			}
			agents?.foregroundProcessChanged(
				identity,
				event.processName,
				event.shellForeground,
			);
			lifecycle?.foregroundProcessChanged?.(identity, event);
		},
	};
}

function ensureActivitySession(
	activity: TerminalActivityService,
	identity: {
		readonly serverId: string;
		readonly projectId: string;
		readonly sessionId: string;
	},
): void {
	activity.register(identity);
}

function optionalCoreOptions(
	options: ServerCoreCompositionOptions,
): Pick<
	ServerCoreOptions,
	| 'authenticate'
	| 'limits'
	| 'maxConnections'
	| 'maxTerminalUnconfirmedBytes'
	| 'defaultQueryScope'
	| 'defaultCommandScope'
> {
	return {
		...(options.authenticate === undefined
			? {}
			: { authenticate: options.authenticate }),
		...(options.limits === undefined ? {} : { limits: options.limits }),
		...(options.maxConnections === undefined
			? {}
			: { maxConnections: options.maxConnections }),
		...(options.maxTerminalUnconfirmedBytes === undefined
			? {}
			: { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
		...(options.defaultQueryScope === undefined
			? {}
			: { defaultQueryScope: options.defaultQueryScope }),
		...(options.defaultCommandScope === undefined
			? {}
			: { defaultCommandScope: options.defaultCommandScope }),
	};
}

function uniqueCapabilities(
	options: ServerCoreCompositionOptions,
): readonly string[] {
	return Object.freeze([
		...new Set([
			...options.capabilities,
			FEATURE_CAPABILITIES.terminal,
			...(options.workspace === undefined
				? []
				: [FEATURE_CAPABILITIES.workspace]),
			...(options.activity === undefined && options.agents === undefined
				? []
				: [FEATURE_CAPABILITIES.agents]),
			...(options.macros === undefined ? [] : [FEATURE_CAPABILITIES.macros]),
			...(options.automations === undefined
				? []
				: [FEATURE_CAPABILITIES.automations]),
			...(options.mcpApprovals === true
				? [FEATURE_CAPABILITIES.mcpApprovals]
				: []),
			...(options.appWindows !== undefined && options.mcpApprovals === true
				? [
						FEATURE_CAPABILITIES.appWindows,
						FEATURE_CAPABILITIES.appWindowMirror,
						FEATURE_CAPABILITIES.appWindowAttachments,
					]
				: []),
			...(options.ai === undefined ? [] : [FEATURE_CAPABILITIES.dictation]),
			...(options.git === undefined ? [] : [FEATURE_CAPABILITIES.git]),
			...(options.recordings === undefined
				? []
				: [FEATURE_CAPABILITIES.recording]),
			...(options.settings === undefined
				? []
				: [FEATURE_CAPABILITIES.settings]),
			...(options.shellProfiles === undefined
				? []
				: [FEATURE_CAPABILITIES.settings]),
			...(options.extensions === undefined
				? []
				: [FEATURE_CAPABILITIES.extensions]),
			...(options.fileObservations === undefined
				? []
				: [FEATURE_CAPABILITIES.files]),
			...(options.language === undefined ? [] : [LANGUAGE_CAPABILITY]),
		]),
	]) as readonly string[];
}

/**
 * Compose the language session manager, its protocol adapter, and the disk
 * changes they consume. The order matters: the adapter is the only thing that
 * writes diagnostics to the journal, and it must exist before the session
 * manager can publish one.
 */
function composeLanguageService(
	options: ServerCoreCompositionOptions,
	eventJournal: OrderedEventJournalLike,
):
	| {
			readonly sessions: LanguageSessionManager;
			readonly adapter: ServerLanguageAdapter;
			readonly dispose: () => Promise<void>;
	  }
	| undefined {
	const language = options.language;
	if (language === undefined) return undefined;
	let adapter: ServerLanguageAdapter | undefined;
	const projects = language.projects as ReadonlyMap<
		string,
		{ readonly resolver: { root(): Promise<string> } }
	>;
	const sessions = new LanguageSessionManager({
		extensions: language.extensions,
		projectRoot:
			language.projectRoot ??
			(async (projectId) => {
				const project =
					typeof projects.get === 'function'
						? projects.get(projectId)
						: (
								language.projects as Readonly<
									Record<string, { readonly resolver: { root(): Promise<string> } }>
								>
							)[projectId];
				if (project === undefined)
					throw new Error('language project is unavailable');
				return project.resolver.root();
			}),
		onDiagnostics: (event) => adapter?.publishDiagnostics(event),
		...(language.maxSessions === undefined
			? {}
			: { maxSessions: language.maxSessions }),
		...(language.idleMs === undefined ? {} : { idleMs: language.idleMs }),
	});
	adapter = new ServerLanguageAdapter({
		serverId: options.serverId,
		sessions,
		projects: language.projects,
		eventJournal,
		...(language.diagnosticsDebounceMs === undefined
			? {}
			: { diagnosticsDebounceMs: language.diagnosticsDebounceMs }),
	});
	const unwatch = language.watch?.observe((event) => {
		if (event.resource.length === 0) return;
		sessions.notifyWatchedFiles(event.projectId, [
			{
				path: event.resource,
				kind:
					event.kind === 'created'
						? 'created'
						: event.kind === 'deleted'
							? 'deleted'
							: 'changed',
			},
		]);
	});
	return {
		sessions,
		adapter,
		dispose: async () => {
			unwatch?.();
			adapter?.dispose();
			// Shutdown has to drain: every live session is told to stop, and a
			// disposal that returned early would leave language servers running.
			await sessions.shutdown();
		},
	};
}

function composeProjectEventProjectors(
	...projectors: readonly (
		| NonNullable<ServerCoreOptions['projectEvent']>
		| undefined
	)[]
): NonNullable<ServerCoreOptions['projectEvent']> {
	return (event, client, connection) => {
		let current: import('./types.js').OrderedEvent | undefined = event;
		for (const projector of projectors) {
			if (projector === undefined || current === undefined) continue;
			current = projector(current, client, connection);
		}
		return current;
	};
}

function mergeOperationRegistries(
	extension: OperationRegistries,
	terminal: OperationRegistries,
): CompleteServerCoreOperationRegistry {
	const queries = mergeEntries('query', extension.queries, terminal.queries);
	const commands = mergeEntries(
		'command',
		extension.commands,
		terminal.commands,
	);
	for (const operation of queries.keys()) {
		if (commands.has(operation))
			throw new TypeError(
				`operation is registered as both query and command: ${operation}`,
			);
	}
	return {
		queries,
		commands,
		policies: mergeEntries('policy', extension.policies, terminal.policies),
	};
}

function mergeEntries<T>(
	kind: string,
	first: ReadonlyMap<string, T> | Record<string, T> | undefined,
	second: ReadonlyMap<string, T> | Record<string, T> | undefined,
): ReadonlyMap<string, T> {
	const result = new Map<string, T>();
	for (const [name, handler] of entries(first)) result.set(name, handler);
	for (const [name, handler] of entries(second)) {
		if (result.has(name))
			throw new TypeError(
				`${kind} operation is registered more than once: ${name}`,
			);
		result.set(name, handler);
	}
	return result;
}

function entries<T>(
	value: ReadonlyMap<string, T> | Record<string, T> | undefined,
): readonly (readonly [string, T])[] {
	if (value === undefined) return [];
	if (typeof (value as ReadonlyMap<string, T>).get === 'function') {
		return [...(value as ReadonlyMap<string, T>).entries()];
	}
	return Object.entries(value as Record<string, T>);
}

/** A file size for a person to read. */
function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
